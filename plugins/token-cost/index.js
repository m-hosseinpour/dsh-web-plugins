/**
 * Host half of dsh-token-cost: what the current Session's whole-log token
 * totals cost in US dollars, at the rates AvalAI publishes for its models.
 *
 * The browser only draws the answer. This half owns the pricing request for
 * two reasons: it keeps the public model catalog cached across Sessions, and
 * it reads the billing buckets from the durable `tokenUsage` projection, so
 * every popup reads the same committed numbers instead of re-deriving them.
 *
 * The rates in `GET /public/models` are USD per one million tokens. A Session
 * can switch models mid-log, while `tokenUsage` is one whole-session total, so
 * the cost is necessarily priced at the Session's current route. That is the
 * same route the token popover is describing; when the route is not an AvalAI
 * provider this plugin reports `applicable: false` and the Client adds no row.
 */
export const inject = [
  'webServer',
  'connection',
  'sessions',
  'sessionProjections',
  'agentDefaultModel',
  'configEditor',
];

const ROUTE = '/plugin/token-cost/summary';
const DEFAULT_BASE_URL = 'https://api.avalai.ir';
const DEFAULT_HOSTS = ['api.avalai.ir'];
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const PER_MILLION = 1_000_000;

/** A finite, non-negative number, or null. Booleans and NaN are not prices. */
function amount(value) {
  if (typeof value === 'boolean' || value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** The host part of a URL, or '' when it does not parse. */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** AvalAI's public catalog lives at the origin, not under a versioned API path. */
function pricingEndpoint(baseURL) {
  try {
    const url = new URL(baseURL);
    return `${url.origin}/public/models`;
  } catch {
    return `${String(baseURL).replace(/\/+$/, '')}/public/models`;
  }
}

/** A stable code the Client localizes, never a provider message. */
function failureCode(error) {
  if (error?.name === 'TimeoutError') return 'timeout';
  if (typeof error?.status === 'number') return `http-${error.status}`;
  if (error instanceof SyntaxError) return 'bad-json';
  return 'network';
}

/**
 * USD for one whole-session usage total at one model's published rates.
 *
 * The four buckets are disjoint. Cache writes have their own rate when the
 * model publishes one; otherwise they are ordinary input, which is the
 * conservative reading for a model that does not price cache creation.
 * @param totals - `tokenUsage` projection totals.
 * @param pricing - one entry from the public catalog's `pricing` object.
 */
function costOf(totals, pricing) {
  const input = amount(pricing.input);
  const cached = amount(pricing.cached_input) ?? input;
  const cacheWrite = amount(pricing.cache_creation_input) ?? input;
  const output = amount(pricing.output);
  if (input === null || cached === null || cacheWrite === null || output === null) return null;
  return {
    input: (totals.uncachedInputTokens / PER_MILLION) * input,
    cached: (totals.cacheReadTokens / PER_MILLION) * cached,
    cacheWrite: (totals.cacheWriteTokens / PER_MILLION) * cacheWrite,
    output: (totals.outputTokens / PER_MILLION) * output,
    total:
      (totals.uncachedInputTokens / PER_MILLION) * input +
      (totals.cacheReadTokens / PER_MILLION) * cached +
      (totals.cacheWriteTokens / PER_MILLION) * cacheWrite +
      (totals.outputTokens / PER_MILLION) * output,
  };
}

/** @param {import('@deepseek-ai/cordis').Context} ctx - owning Host context. */
export function apply(ctx, config = {}) {
  const configuredBaseURL = String(config.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const avalaiHosts =
    Array.isArray(config.hosts) && config.hosts.length > 0 ? config.hosts.map(String) : DEFAULT_HOSTS;
  const ttlMs = amount(config.cacheSeconds) ? Math.max(1, amount(config.cacheSeconds)) * 1000 : DEFAULT_TTL_MS;
  const timeoutMs = amount(config.timeoutSeconds)
    ? Math.max(1, amount(config.timeoutSeconds)) * 1000
    : DEFAULT_TIMEOUT_MS;
  const endpoint = pricingEndpoint(configuredBaseURL);

  /** One catalog table for the whole profile, bounded by the refresh deadline. */
  const catalog = { models: new Map(), fetchedAt: 0, error: '', errorAt: 0 };

  /**
   * Every configured provider profile, from every loaded row that declares a
   * `providers` map. A profile split across layers still resolves whole.
   */
  function providerProfiles() {
    /** @type {Record<string, Record<string, unknown>>} */
    const profiles = {};
    let rows;
    try {
      rows = ctx.configEditor.configuration();
    } catch {
      return profiles;
    }
    for (const row of rows) {
      for (const layer of [row?.inherited, row?.override]) {
        const providers = layer?.providers;
        if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) continue;
        for (const [id, profile] of Object.entries(providers)) {
          if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) continue;
          profiles[id] = { ...profiles[id], ...profile };
        }
      }
    }
    return profiles;
  }

  /**
   * The route that produced the Session's tokens: the last used selection,
   * then a pending one for a Session that has not sent a request yet.
   * @param sessionId - Session id from the query, possibly empty.
   */
  function resolveRoute(sessionId) {
    let selection = null;
    let session = null;
    if (typeof sessionId === 'string' && sessionId !== '') {
      session = ctx.sessions.get(sessionId);
      if (session === undefined) return { pending: true, session: null, selection: null };
      try {
        const state = ctx.sessionProjections.stateOf(session, 'modelSelection');
        selection = state?.lastUsed ?? state?.pending ?? null;
      } catch {
        selection = null;
      }
    }
    selection ??= ctx.agentDefaultModel.currentSelection() ?? null;
    if (selection === null) return { pending: false, session, selection: null };

    const profile = providerProfiles()[selection.provider];
    const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL.trim() : '';
    return {
      pending: false,
      session,
      selection,
      baseURL,
      applicable: baseURL !== '' && avalaiHosts.includes(hostOf(baseURL)),
    };
  }

  /** The live or cached catalog, or a stale one after a failed refresh. */
  async function readCatalog(force) {
    const now = Date.now();
    if (!force) {
      if (catalog.fetchedAt !== 0 && now - catalog.fetchedAt < ttlMs) return { models: catalog.models, source: 'cache' };
      if (catalog.error !== '' && now - catalog.errorAt < RETRY_AFTER_MS) {
        return catalog.fetchedAt !== 0
          ? { models: catalog.models, source: 'stale', error: catalog.error }
          : { models: null, source: 'none', error: catalog.error };
      }
    }

    try {
      const response = await fetch(endpoint, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const error = new Error(`catalog answered ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.data)) throw new SyntaxError('catalog data is not a list');

      const models = new Map();
      for (const entry of payload.data) {
        if (entry === null || typeof entry !== 'object') continue;
        if (typeof entry.id !== 'string' || entry.pricing === null || typeof entry.pricing !== 'object') continue;
        models.set(entry.id, entry.pricing);
      }
      if (models.size === 0) throw new SyntaxError('catalog has no priced models');

      catalog.models = models;
      catalog.fetchedAt = Date.now();
      catalog.error = '';
      catalog.errorAt = 0;
      return { models, source: 'live' };
    } catch (error) {
      const code = failureCode(error);
      catalog.error = code;
      catalog.errorAt = Date.now();
      return catalog.fetchedAt !== 0
        ? { models: catalog.models, source: 'stale', error: code }
        : { models: null, source: 'none', error: code };
    }
  }

  function reply(response, status, value) {
    const body = JSON.stringify(value);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  }

  /** Nothing to price yet, with enough context for the Client to stay quiet. */
  function emptySummary(error, route) {
    return {
      ok: true,
      applicable: route?.applicable !== false,
      pending: route?.pending === true,
      provider: route?.selection?.provider ?? '',
      model: route?.selection?.model ?? '',
      cost: null,
      currency: 'USD',
      tokens: null,
      pricing: null,
      source: 'none',
      fetchedAt: catalog.fetchedAt === 0 ? null : new Date(catalog.fetchedAt).toISOString(),
      error,
    };
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (request, response) => {
          try {
            if (request.method !== 'GET') {
              reply(response, 405, { ok: false, error: 'GET required' });
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

            const query = new URL(request.url ?? ROUTE, 'http://localhost').searchParams;
            const route = resolveRoute(query.get('session') ?? '');
            if (route.pending) {
              reply(response, 200, emptySummary('session-pending', route));
              return;
            }
            // Another provider's money is not this plugin's subject.
            if (!route.applicable || route.selection === null) {
              reply(response, 200, { ...emptySummary('', route), applicable: false });
              return;
            }

            let totals = null;
            if (route.session !== null) {
              try {
                const state = ctx.sessionProjections.stateOf(route.session, 'tokenUsage');
                totals = state?.totals ?? null;
              } catch {
                totals = null;
              }
            }
            if (totals === null) {
              reply(response, 200, emptySummary('usage-unread', route));
              return;
            }

            const catalogRead = await readCatalog(query.has('refresh'));
            if (catalogRead.models === null) {
              reply(response, 200, emptySummary(catalogRead.error, route));
              return;
            }
            const pricing = catalogRead.models.get(route.selection.model) ?? null;
            if (pricing === null) {
              reply(response, 200, emptySummary('model-unpriced', route));
              return;
            }
            const cost = costOf(totals, pricing);
            if (cost === null) {
              reply(response, 200, emptySummary('pricing-incomplete', route));
              return;
            }

            reply(response, 200, {
              ok: true,
              applicable: true,
              pending: false,
              provider: route.selection.provider,
              model: route.selection.model,
              cost: cost.total,
              breakdown: {
                input: cost.input,
                cached: cost.cached,
                cacheWrite: cost.cacheWrite,
                output: cost.output,
              },
              currency: 'USD',
              tokens: {
                uncachedInput: totals.uncachedInputTokens,
                cachedInput: totals.cacheReadTokens,
                cacheWrite: totals.cacheWriteTokens,
                output: totals.outputTokens,
              },
              pricing: {
                input: amount(pricing.input),
                cachedInput: amount(pricing.cached_input) ?? amount(pricing.input),
                cacheWrite: amount(pricing.cache_creation_input) ?? amount(pricing.input),
                output: amount(pricing.output),
              },
              source: catalogRead.source,
              error: catalogRead.error ?? '',
              fetchedAt: new Date(catalog.fetchedAt).toISOString(),
            });
          } catch (error) {
            ctx.logger.warn(`token-cost: ${String(error)}`);
            reply(response, 500, { ok: false, error: 'internal' });
          }
        },
      }),
    'token-cost: route',
  );
}
