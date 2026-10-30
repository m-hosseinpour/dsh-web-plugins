/**
 * Host half of dsh-session-delete: permanently removes one Session's persisted
 * log and cached projections.
 *
 * The Harness itself only archives a Session (a durable "hidden" set), and no
 * generated Remote deletes Session data, so a Client plugin cannot reach a
 * delete operation. This package therefore pairs the Client menu row with one
 * authenticated POST route: the request is admitted through the Host
 * Connection credential and accepted only for the `owner` principal.
 *
 * Deleting a Session whose Agent is still resident cannot dispose that Agent
 * (the disposer is a capability its owner holds), and the JSONL backend opens
 * the log by path on every append — so a late write could recreate a truncated
 * file. Every deleted id is therefore remembered as a tombstone, and a periodic
 * sweep removes any log that reappears for it.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const ROUTE = '/plugin/session-delete/delete';
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const BODY_LIMIT = 4096;
const SWEEP_INTERVAL_MS = 15000;
const STOP_TIMEOUT_MS = 3000;
const TOMBSTONE_LIMIT = 2000;

/** @type {string[]} */
export const inject = ['webServer', 'connection', 'workspaceRegistry', 'sessions', 'agents'];

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Answer one request with JSON.
 * @param {import('node:http').ServerResponse} response - response to own.
 * @param {number} status - HTTP status.
 * @param {unknown} value - JSON body.
 */
function reply(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/**
 * Read a request body with a hard size cap.
 * @param {import('node:http').IncomingMessage} request - request to drain.
 * @returns {Promise<string>} the UTF-8 body.
 */
async function readBody(request) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - owning Host context.
 * @param {Record<string, unknown>} config - plugin row config.
 */
export function apply(ctx, config = {}) {
  const home = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const sessionsRoot = resolve(typeof config.sessionsDir === 'string' ? config.sessionsDir : join(home, 'sessions'));
  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions');
  const stateDir = join(home, 'storages', 'session-delete');
  const tombstoneFile = join(stateDir, 'deleted.json');

  /** @returns {Promise<string[]>} remembered deleted Session ids. */
  async function tombstones() {
    try {
      const parsed = JSON.parse(await readFile(tombstoneFile, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && SESSION_ID.test(id)) : [];
    } catch {
      return [];
    }
  }

  /** @param {string} id - Session id to remember durably. */
  async function remember(id) {
    const known = await tombstones();
    if (known.includes(id)) return;
    const next = [...known, id].slice(-TOMBSTONE_LIMIT);
    await mkdir(stateDir, { recursive: true });
    await writeFile(tombstoneFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  /**
   * Every per-cwd directory holding this Session's log.
   * @param {string} id - exact Session id.
   * @returns {Promise<string[]>} existing session directories.
   */
  async function sessionDirs(id) {
    let keys;
    try {
      keys = await readdir(sessionsRoot);
    } catch {
      return [];
    }
    /** @type {string[]} */
    const found = [];
    for (const key of keys) {
      const candidate = join(sessionsRoot, key, id);
      try {
        if ((await stat(candidate)).isDirectory()) found.push(candidate);
      } catch {
        // Not this Session; keep looking.
      }
    }
    return found;
  }

  /**
   * Remove every artifact of one Session, then hide it from connected Clients.
   * @param {string} id - exact Session id.
   * @returns {Promise<number>} removed log directories.
   */
  async function removeSession(id) {
    const agent = ctx.agents.get(id);
    if (agent?.status === 'running') {
      agent.cancel({ kind: 'user' });
      for (let waited = 0; waited < STOP_TIMEOUT_MS && agent.status === 'running'; waited += 100) {
        await delay(100);
      }
    }
    /* Archive first. The sidebar list is persisted records ∪ live in-memory
     * Sessions, and a Resident Agent cannot be unloaded from a plugin, so a
     * deleted-but-live Session would reappear after a reload. The archive set is
     * the one durable hiding the sidebar honors, and it also rejects the
     * Session's next turn at `agent/pre-step`. The sweep drops this entry once
     * the process no longer holds the Session. */
    await ctx.workspaceRegistry.archiveSession(id, { stopActivity: true }).catch(() => {});
    await ctx.workspaceRegistry.unpinSession(id).catch(() => {});

    const dirs = await sessionDirs(id);
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    await rm(join(cacheDir, `${id}.json`), { force: true });
    await remember(id);
    ctx.emit('api-session/removed', id);
    return dirs.length;
  }

  /** Re-delete any log a resident Agent recreated for a tombstoned Session. */
  async function sweep() {
    for (const id of await tombstones()) {
      for (const dir of await sessionDirs(id)) await rm(dir, { recursive: true, force: true });
      await rm(join(cacheDir, `${id}.json`), { force: true });
      /* A resident Session keeps its archive entry: that entry is what keeps it
       * out of the sidebar. Once the process has let go of the Session, the
       * leftover pin/archive ids are only ghosts, so drop them. */
      if (ctx.sessions.get(id) === undefined) {
        await ctx.workspaceRegistry.unarchiveSession(id).catch(() => {});
        await ctx.workspaceRegistry.unpinSession(id).catch(() => {});
      } else {
        // An id deleted while its Agent was resident (or before this fix) still
        // needs its archive entry; a repeat call is a no-op.
        await ctx.workspaceRegistry.archiveSession(id, { stopActivity: true }).catch(() => {});
      }
    }
  }

  ctx.effect(() => {
    void sweep().catch((error) => ctx.logger.warn(`session-delete: sweep failed: ${String(error)}`));
    const timer = setInterval(() => {
      void sweep().catch((error) => ctx.logger.warn(`session-delete: sweep failed: ${String(error)}`));
    }, SWEEP_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }, 'session-delete: tombstone sweep');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          reply(response, 405, { ok: false, error: 'POST required' });
          return;
        }
        const admission = ctx.connection.admit({ headers: request.headers });
        if ('rejection' in admission) {
          reply(response, admission.rejection, { ok: false, error: 'unauthorized' });
          return;
        }
        if (admission.peer.principal.kind !== 'owner') {
          reply(response, 403, { ok: false, error: 'forbidden' });
          return;
        }

        let payload;
        try {
          payload = JSON.parse(await readBody(request));
        } catch {
          reply(response, 400, { ok: false, error: 'body must be a JSON object' });
          return;
        }
        const id = typeof payload?.sessionId === 'string' ? payload.sessionId : '';
        if (!SESSION_ID.test(id)) {
          reply(response, 400, { ok: false, error: 'invalid session id' });
          return;
        }
        const dirs = await sessionDirs(id);
        if (dirs.length === 0 && ctx.sessions.get(id) === undefined) {
          reply(response, 404, { ok: false, error: 'session not found' });
          return;
        }

        const removed = await removeSession(id);
        reply(response, 200, { ok: true, removed });
      } catch (error) {
        ctx.logger.warn(`session-delete: ${String(error)}`);
        reply(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  }), 'session-delete: route');
}
