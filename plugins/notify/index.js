/**
 * Host half of dsh-notify — a desktop notification and a short sound for the
 * three moments a Session actually needs a human: a turn finished, a decision
 * is pending, or the turn died.
 *
 * The Harness already knows what the Claude Code hook had to guess. A
 * Session's own log records why each turn closed (`turn/end`), and the
 * `workspace/session-activity` waterfall reports whether that Session still
 * owns live work: background jobs, subagent descendants, schedules. So a turn
 * that closed cleanly while its subagents keep working stays silent, a turn
 * that ended in a provider failure is reported as a failure instead of
 * "finished", and a turn the human cancelled is not announced at all.
 *
 * Only root Sessions announce completions — a subagent settling is not news for
 * a person, and the parent's turn reports the outcome. Approval requests are
 * the exception: they block an agent at any depth, so they always notify.
 *
 * Delivery mirrors the author's Claude Code hook: `notify-send` with the same
 * icons, urgency and expiry per state, plus the same freedesktop sounds played
 * through the first available of paplay → pw-play → ffplay. Everything here is
 * best-effort: a missing daemon or player is logged once and never reaches the
 * agent loop.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { basename } from 'node:path';

/** A notification daemon or a stuck player must never outlive its usefulness. */
const NOTIFY_TIMEOUT_MS = 5_000;
const SOUND_TIMEOUT_MS = 4_000;

/** The freedesktop files the Claude Code hook used, per state. */
const DEFAULT_CONFIG = {
  desktop: true,
  sound: true,
  appName: 'DSH',
  soundComplete: '/usr/share/sounds/freedesktop/stereo/complete.oga',
  soundAttention: '/usr/share/sounds/freedesktop/stereo/message-new-instant.oga',
  soundError: '/usr/share/sounds/oxygen/stereo/dialog-error.ogg',
  notifyFinished: true,
  notifyPermission: true,
  notifyQuestion: true,
  notifyError: true,
  notifyTokenLimit: true,
};

const BOOLEAN_KEYS = [
  'desktop',
  'sound',
  'notifyFinished',
  'notifyPermission',
  'notifyQuestion',
  'notifyError',
  'notifyTokenLimit',
];

const STRING_KEYS = ['appName', 'soundComplete', 'soundAttention', 'soundError'];

/** Playback preference, mirroring the hook: Pulse/PipeWire first, ffplay last. */
const PLAYERS = [
  { command: 'paplay', args: [] },
  { command: 'pw-play', args: [] },
  { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet'] },
];

/** Defaults merged with whatever the profile patch supplies; bad values are ignored. */
function readConfig(raw) {
  const config = { ...DEFAULT_CONFIG };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return config;
  for (const key of BOOLEAN_KEYS) if (typeof raw[key] === 'boolean') config[key] = raw[key];
  for (const key of STRING_KEYS) {
    if (typeof raw[key] === 'string' && raw[key].trim() !== '') config[key] = raw[key].trim();
  }
  return config;
}

function clip(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1))}…`;
}

/** The project folder a person recognizes the Session by. */
function projectOf(session) {
  const cwd = session?.header?.cwd;
  if (typeof cwd !== 'string' || cwd.trim() === '') return 'DSH';
  const name = basename(cwd.replace(/[/\\]+$/, ''));
  return name === '' ? cwd : name;
}

/**
 * `LlmFailure` facts, or any other thrown value, flattened into one line. The
 * code carries the routing decision the provider reported; the message carries
 * what a person can act on.
 */
function describeFailure(error) {
  if (error === null || typeof error !== 'object') return clip(error ?? 'unknown', 140);
  const failure = /** @type {{ message?: unknown, code?: unknown }} */ (error);
  const message = typeof failure.message === 'string' && failure.message.trim() !== '' ? failure.message : undefined;
  const code = typeof failure.code === 'string' && failure.code !== '' ? failure.code : undefined;
  if (message !== undefined && code !== undefined) return clip(`${code}: ${message}`, 140);
  return clip(message ?? code ?? 'unknown', 140);
}

/**
 * A desktop session's D-Bus and runtime addresses live in the user's session
 * environment, which a launcher or a service manager can omit. `notify-send`
 * only needs the bus and players only need the runtime directory, so fill them
 * from the standard per-user paths when they are missing.
 */
function sessionEnv() {
  const env = { ...process.env };
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  if (!env.DBUS_SESSION_BUS_ADDRESS) {
    const bus = `/run/user/${uid}/bus`;
    if (existsSync(bus)) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${bus}`;
  }
  if (!env.XDG_RUNTIME_DIR) {
    const runtime = `/run/user/${uid}`;
    if (existsSync(runtime)) env.XDG_RUNTIME_DIR = runtime;
  }
  return env;
}

export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig);
  const env = sessionEnv();
  const projections = ctx.get('sessionProjections');
  /** Per-Session record of the last turn that closed, consumed at the next idle. */
  const turns = new Map();
  const warned = new Set();
  let player;
  let playerLookedUp = false;

  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    ctx.logger.warn(`notify: ${message}`);
  }

  function findExecutable(command) {
    if (command.includes('/')) return existsSync(command) ? command : undefined;
    const path = env.PATH ?? process.env.PATH ?? '';
    for (const directory of path.split(':')) {
      if (directory === '') continue;
      const candidate = `${directory}/${command}`;
      try {
        accessSync(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
    return undefined;
  }

  function resolvePlayer() {
    for (const candidate of PLAYERS) {
      const command = findExecutable(candidate.command);
      if (command !== undefined) return { command, args: candidate.args };
    }
    return undefined;
  }

  /**
   * Play in the background with a hard time limit. The child is unref'd so a
   * running host never waits on audio, and `timeout` also kills a player whose
   * sink stopped accepting samples.
   */
  function playSound(file) {
    if (!config.sound || typeof file !== 'string' || file === '' || !existsSync(file)) return;
    if (!playerLookedUp) {
      player = resolvePlayer();
      playerLookedUp = true;
    }
    if (player === undefined) {
      warnOnce('sound', 'no audio player on PATH (looked for paplay, pw-play, ffplay)');
      return;
    }
    try {
      const child = spawn(player.command, [...player.args, file], {
        env,
        stdio: 'ignore',
        detached: true,
        timeout: SOUND_TIMEOUT_MS,
      });
      child.on('error', (error) => {
        // A player can disappear between sessions; the next notification re-resolves.
        playerLookedUp = false;
        warnOnce('sound', `playing "${file}" failed: ${describeFailure(error)}`);
      });
      child.unref();
    } catch (error) {
      warnOnce('sound', `playing "${file}" failed: ${describeFailure(error)}`);
    }
  }

  /**
   * `-t 0` means "do not expire on its own" — that is what keeps the pending
   * and error cards on screen until the human dismisses them, independently of
   * their urgency, exactly as the hook did.
   */
  function notifyDesktop(title, body, spec) {
    if (!config.desktop) return;
    const args = [
      '-a',
      config.appName,
      '-i',
      spec.icon,
      '-u',
      spec.urgency,
      '-t',
      String(spec.expire),
      '--',
      title,
      body,
    ];
    try {
      const child = spawn('notify-send', args, { env, stdio: 'ignore', timeout: NOTIFY_TIMEOUT_MS });
      child.on('error', (error) => warnOnce('desktop', `notify-send failed: ${describeFailure(error)}`));
      child.unref();
    } catch (error) {
      warnOnce('desktop', `notify-send failed: ${describeFailure(error)}`);
    }
  }

  function sessionTitle(session) {
    if (typeof projections?.stateOf !== 'function') return undefined;
    try {
      const title = projections.stateOf(session, 'title');
      return typeof title === 'string' && title.trim() !== '' ? title.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  function bodyOf(session, detail) {
    const project = projectOf(session);
    const lines = [project];
    const title = sessionTitle(session);
    if (title !== undefined && title !== project) lines.push(clip(title, 80));
    if (typeof detail === 'string' && detail.trim() !== '') lines.push(clip(detail, 160));
    return lines.join('\n');
  }

  function announce(session, spec) {
    playSound(spec.sound);
    notifyDesktop(spec.title, bodyOf(session, spec.detail), spec);
  }

  /**
   * "Finished" is only true when nothing still runs for that Session. A turn
   * that started a background job or a subagent before closing is not the end
   * of the work, and announcing it would be a false alarm.
   */
  async function announceFinished(agent) {
    const session = agent.session;
    let activity;
    try {
      activity = await ctx.waterfall('workspace/session-activity', { sessionId: session.id }, () => Promise.resolve([]));
    } catch (error) {
      // An unreadable activity list must not silently turn into "finished".
      warnOnce('activity', `reading session activity failed: ${describeFailure(error)}`);
      return;
    }
    if (agent.status !== 'idle') return; // a new turn claimed the Session while we asked
    if (Array.isArray(activity) && activity.length > 0) {
      const kinds = activity.map((entry) => entry?.kind ?? 'unknown').join(', ');
      ctx.logger.debug(`notify: "${session.id}" closed a turn with ${kinds} still running — staying silent`);
      return;
    }
    if (!config.notifyFinished) return;
    announce(session, {
      title: '✅ DSH finished a task',
      icon: 'task-complete',
      urgency: 'low',
      expire: 4_000,
      sound: config.soundComplete,
    });
  }

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return;
    turns.set(session.id, { end: event.data.reason });
  });

  ctx.on('agent/status', ({ agent, status }) => {
    try {
      if (status !== 'idle') return;
      const state = turns.get(agent.session.id);
      if (state?.end === undefined) return;
      const reason = state.end;
      turns.delete(agent.session.id);
      if ((agent.session.header.delegationDepth ?? 0) > 0) return; // the parent's turn reports it
      switch (reason.kind) {
        case 'completed':
          void announceFinished(agent);
          return;
        case 'max-tokens':
          if (!config.notifyTokenLimit) return;
          announce(agent.session, {
            title: '⚠️ DSH stopped at the token limit',
            detail: 'the turn was cut off while the model was still writing',
            icon: 'dialog-warning',
            urgency: 'normal',
            expire: 0,
            sound: config.soundAttention,
          });
          return;
        case 'error':
          if (!config.notifyError) return;
          announce(agent.session, {
            title: '💥 DSH hit an API error',
            detail: describeFailure(reason.error),
            icon: 'dialog-error',
            urgency: 'critical',
            expire: 0,
            sound: config.soundError,
          });
          return;
        default:
          // aborted (human stop, parent disposal), blocked, interrupted, forked
          return;
      }
    } catch (error) {
      warnOnce('status', `handling a closed turn failed: ${describeFailure(error)}`);
    }
  });

  ctx.on('approval/request', (request, next) => {
    try {
      const session = request.agent?.session;
      if (config.notifyPermission && session !== undefined) {
        const reason = request.displayReason?.en ?? request.reason;
        const detail = reason === undefined || reason === '' ? request.toolName : `${request.toolName} — ${reason}`;
        announce(session, {
          title: '🔐 DSH needs permission',
          detail,
          icon: 'dialog-password',
          urgency: 'normal',
          expire: 0,
          sound: config.soundAttention,
        });
      }
    } catch (error) {
      warnOnce('approval', `handling an approval request failed: ${describeFailure(error)}`);
    }
    return next();
  });

  ctx.on('user-questions/request', (request, next) => {
    try {
      const session = request.agent?.session;
      if (config.notifyQuestion && session !== undefined) {
        const first = request.questions?.[0];
        announce(session, {
          title: '❓ DSH is waiting for your answer',
          detail: first?.question ?? first?.header,
          icon: 'dialog-question',
          urgency: 'normal',
          expire: 0,
          sound: config.soundAttention,
        });
      }
    } catch (error) {
      warnOnce('question', `handling a question request failed: ${describeFailure(error)}`);
    }
    return next();
  });

  ctx.on('session/disposed', (session) => {
    turns.delete(session.id);
  });
}
