/**
 * Host half of dsh-avalai-credit: what is left on the AvalAI account behind the
 * provider the current Session is using.
 *
 * A Harness profile can hold several AvalAI providers, one per account
 * (`aval-ai`, `aval-ai-s`, …), and each has its own key. Which account a
 * Session spends from is therefore read from the Session itself: its durable
 * `modelSelection` projection names the provider, that provider's profile in
 * the loaded configuration names the credential reference and base URL, and
 * the Host credential seam resolves the key. One profile, several accounts,
 * no duplicated configuration.
 *
 * The browser must never see the key, so this half owns the request and serves
 * one normalized document at `GET /plugin/avalai-credit/summary?session=<id>`,
 * admitted through the Connection credential for the `owner` principal only.
 * Readings are cached per account, and a failed read is remembered for
 * RETRY_AFTER_MS so a polling bar cannot pay the timeout on every tick.
 *
 * It reports only: no threshold below which a balance counts as running out,
 * no advice on what or when to buy, and no ranking between packages. That is a
 * deliberate constraint carried over from the `credit` skill.
 */
export const inject = [
  'webServer',
  'connection',
  'credentials',
  'sessions',
  'sessionProjections',
  'agentDefaultModel',
  'configEditor',
];

const ROUTE = '/plugin/avalai-credit/summary';
const DEFAULT_BASE_URL = 'https://api.avalai.ir';
const DEFAULT_CREDENTIAL = 'AVAL_AI_API_KEY';
const DEFAULT_HOSTS = ['api.avalai.ir'];
const DEFAULT_TTL_MS = 60_000;
const RETRY_AFTER_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const CACHE_LIMIT = 8;
const TIER_RANK = { daily: 0, weekly: 1, other: 2 };

/** A finite number, or null. `true` and NaN must not become an amount. */
function num(value) {
  if (typeof value === 'boolean' || value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** An ISO timestamp, or null when the field is absent or unreadable. */
function toDate(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** daily / weekly / other, from the template prefix or the Persian name. */
function tierOf(pkg) {
  const template = String(pkg?.template_id ?? '');
  const name = String(pkg?.name ?? '');
  if (template.startsWith('d-') || name.includes('روزانه')) return 'daily';
  if (template.startsWith('w-') || name.includes('هفتگی')) return 'weekly';
  return 'other';
}

/** The host part of a URL, or '' when it does not parse. */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * The account's credit route, which sits at the origin rather than under the
 * provider's API version: `<origin>/user/v1/credit`.
 *
 * A provider baseURL carries the version its chat API needs — `…/v1` for
 * `openai-completions`, nothing for the Anthropic-compatible one. Appending the
 * credit path to it verbatim gave `…/v1/user/v1/credit`, which the edge answers
 * 404, so the trailing version segment is dropped first.
 * @param baseURL - the provider's configured base URL.
 */
function creditEndpoint(baseURL) {
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    return `${String(baseURL).replace(/\/+$/, '')}/user/v1/credit`;
  }
  const prefix = url.pathname.replace(/\/+$/, '').replace(/\/v\d+[a-z0-9]*$/i, '');
  return `${url.origin}${prefix}/user/v1/credit`;
}

/**
 * Normalize one provider response into the shape the bar renders.
 *
 * Four facts and no ranking: a package is paying, the main balance is paying,
 * nothing can pay, or the answer could not be read. `unknown` exists so an
 * unread field never turns into a confident zero.
 * @param payload - the provider's `GET /user/v1/credit` body.
 */
function analyze(payload) {
  const now = Date.now();
  const sourcesRaw = payload?.credit_sources;
  const malformed = [];
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  if (sourcesRaw !== undefined && !isRecord(sourcesRaw)) malformed.push('credit_sources');
  const sources = isRecord(sourcesRaw) ? sourcesRaw : {};
  const packagesRaw = sources.packages;
  if ('packages' in sources && !Array.isArray(packagesRaw)) malformed.push('packages');

  const packages = (Array.isArray(packagesRaw) ? packagesRaw : [])
    .filter(isRecord)
    .map((raw) => {
      const end = toDate(raw.end_date);
      const remaining = num(raw.remaining_irt);
      return {
        tier: tierOf(raw),
        name: String(raw.name ?? ''),
        remaining,
        amount: num(raw.amount_irt),
        expiresAt: end ? end.toISOString() : null,
        expiresInSeconds: end ? Math.round((end.getTime() - now) / 1000) : null,
        spendable: (remaining ?? 0) > 0 && (end === null || end.getTime() > now),
      };
    });

  packages.sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      (a.expiresInSeconds ?? Number.POSITIVE_INFINITY) - (b.expiresInSeconds ?? Number.POSITIVE_INFINITY),
  );

  const liveTotal = packages
    .filter((pkg) => pkg.spendable)
    .reduce((sum, pkg) => sum + (pkg.remaining ?? 0), 0);
  const unreadAmounts = packages.filter((pkg) => pkg.remaining === null).length;
  const mainBalance = num(payload?.remaining_irt);

  let state;
  if (liveTotal > 0) state = 'package';
  else if (mainBalance === null || unreadAmounts > 0 || malformed.length > 0) state = 'unknown';
  else if (mainBalance > 0) state = 'main';
  else state = 'empty';

  // Money paid for and never used: worth saying out loud, not hiding behind
  // "nothing is left".
  const lapsed = packages.filter((pkg) => !pkg.spendable && (pkg.remaining ?? 0) > 0);
  const lapsedTotal = lapsed.reduce((sum, pkg) => sum + (pkg.remaining ?? 0), 0);

  const warnings = [];
  if (mainBalance === null) warnings.push('balance-unread');
  if (unreadAmounts > 0) warnings.push('amount-unread');
  if (malformed.length > 0) warnings.push('malformed');
  if (Array.isArray(sources.grants) && sources.grants.length > 0) warnings.push('grants');
  if (lapsed.length > 0) warnings.push('lapsed');

  return {
    state,
    packages,
    mainBalance,
    warnings,
    lapsed: { count: lapsed.length, amount: lapsedTotal },
  };
}

/** One empty document; `source: 'none'` means nothing was read at all. */
function emptySummary(error, account) {
  return {
    ok: true,
    applicable: true,
    account: account?.provider ?? '',
    source: 'none',
    state: 'unknown',
    fetchedAt: null,
    ageSeconds: null,
    packages: [],
    mainBalance: null,
    warnings: [],
    lapsed: { count: 0, amount: 0 },
    error,
  };
}

/** Wrap one read for the wire, including how fresh it is. */
function summarize(payload, source, error, fetchedAt, account) {
  return {
    ok: true,
    applicable: true,
    account: account.provider,
    source,
    ...analyze(payload),
    fetchedAt,
    ageSeconds: fetchedAt === null ? null : Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)),
    error,
  };
}

/** A stable code the Client localizes, never a provider message. */
function failureCode(error) {
  if (error?.name === 'TimeoutError') return 'timeout';
  if (typeof error?.status === 'number') return `http-${error.status}`;
  if (error instanceof SyntaxError) return 'bad-json';
  return 'network';
}

/** @param {import('@deepseek-ai/cordis').Context} ctx - owning Host context. */
export function apply(ctx, config = {}) {
  const fallbackCredential = typeof config.credentialRef === 'string' ? config.credentialRef : DEFAULT_CREDENTIAL;
  const fallbackBaseURL = String(config.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const avalaiHosts = Array.isArray(config.hosts) && config.hosts.length > 0 ? config.hosts.map(String) : DEFAULT_HOSTS;
  const ttlMs = num(config.cacheSeconds) ? Math.max(1, num(config.cacheSeconds)) * 1000 : DEFAULT_TTL_MS;
  const timeoutMs = num(config.timeoutSeconds) ? Math.max(1, num(config.timeoutSeconds)) * 1000 : DEFAULT_TIMEOUT_MS;

  /** @type {Map<string, { payload: object | null, fetchedAt: number | null, error: string, errorAt: number }>} */
  const caches = new Map();

  /**
   * Every configured provider profile, from every loaded row that declares a
   * `providers` map. The override layer wins over the inherited one field by
   * field, so a profile split across layers still resolves whole.
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
   * The provider this Session is spending from, and the account behind it.
   *
   * A named provider is resolved from its own profile only: falling back to
   * the configured default for a provider we know nothing about would report
   * one account's money as another's. `pending` reports a Session this Host
   * has not materialized yet, which is a question to ask again, not a default.
   */
  function resolveAccount(sessionId) {
    let provider = '';
    const asked = typeof sessionId === 'string' && sessionId !== '';
    if (asked) {
      const session = ctx.sessions.get(sessionId);
      if (session === undefined) return { pending: true, provider: '' };
      const state = ctx.sessionProjections.stateOf(session, 'modelSelection');
      provider = state?.pending?.provider ?? state?.lastUsed?.provider ?? '';
    }
    if (provider === '') provider = ctx.agentDefaultModel.currentSelection()?.provider ?? '';

    // No provider at all: the configured account is the only thing to report.
    if (provider === '') {
      return {
        pending: false,
        provider,
        credentialRef: fallbackCredential,
        baseURL: fallbackBaseURL,
        endpoint: creditEndpoint(fallbackBaseURL),
        applicable: avalaiHosts.includes(hostOf(fallbackBaseURL)),
      };
    }

    // A named provider must name its own endpoint and key, or this strip cannot
    // tell which account it is looking at and must stay silent.
    const profile = providerProfiles()[provider];
    const declaredURL = typeof profile?.baseURL === 'string' ? profile.baseURL.trim() : '';
    const declaredKey = typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv.trim() : '';
    if (declaredURL === '' || declaredKey === '') return { pending: false, provider, applicable: false };

    const baseURL = declaredURL.replace(/\/+$/, '');
    return {
      pending: false,
      provider,
      credentialRef: declaredKey,
      baseURL,
      endpoint: creditEndpoint(baseURL),
      applicable: avalaiHosts.includes(hostOf(baseURL)),
    };
  }

  /** The cache slot of one account, created on first use and bounded overall. */
  function cacheFor(account) {
    const key = `${account.credentialRef}|${account.endpoint}`;
    let entry = caches.get(key);
    if (entry === undefined) {
      entry = { payload: null, fetchedAt: null, error: '', errorAt: 0 };
      caches.set(key, entry);
      if (caches.size > CACHE_LIMIT) caches.delete(caches.keys().next().value);
    }
    return entry;
  }

  async function fetchCredit(account, key) {
    const response = await fetch(account.endpoint, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const error = new Error(`provider answered ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  }

  /** The current answer for one account, from cache or the provider, never throwing. */
  async function read(account, force) {
    const now = Date.now();
    // The slot is mutated in place: it is the object the map holds, so a write
    // here and the next read see the same state.
    const entry = cacheFor(account);
    const commit = (next) => Object.assign(entry, next);

    if (!force) {
      if (entry.payload !== null && entry.fetchedAt !== null && now - entry.fetchedAt < ttlMs) {
        return summarize(entry.payload, 'cache', '', entry.fetchedAt, account);
      }
      if (entry.error !== '' && now - entry.errorAt < RETRY_AFTER_MS) {
        return entry.payload !== null
          ? summarize(entry.payload, 'stale', entry.error, entry.fetchedAt, account)
          : emptySummary(entry.error, account);
      }
    }

    try {
      const resolved = await ctx.credentials.resolve(account.credentialRef);
      if (!resolved?.value) {
        commit({ payload: entry.payload, fetchedAt: entry.fetchedAt, error: 'credential-missing', errorAt: now });
        return entry.payload !== null
          ? summarize(entry.payload, 'stale', 'credential-missing', entry.fetchedAt, account)
          : emptySummary('credential-missing', account);
      }
      const payload = await fetchCredit(account, resolved.value);
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new SyntaxError('not an object');
      }
      const fetchedAt = Date.now();
      commit({ payload, fetchedAt, error: '', errorAt: 0 });
      return summarize(payload, 'live', '', fetchedAt, account);
    } catch (error) {
      const code = failureCode(error);
      commit({ payload: entry.payload, fetchedAt: entry.fetchedAt, error: code, errorAt: Date.now() });
      return entry.payload !== null
        ? summarize(entry.payload, 'stale', code, entry.fetchedAt, account)
        : emptySummary(code, account);
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
            const account = resolveAccount(query.get('session') ?? '');
            if (account.pending) {
              reply(response, 200, { ...emptySummary('session-pending', account), pending: true });
              return;
            }
            // Another provider's account is not this strip's subject.
            if (!account.applicable) {
              reply(response, 200, { ok: true, applicable: false, account: account.provider });
              return;
            }
            reply(response, 200, await read(account, query.has('refresh')));
          } catch (error) {
            ctx.logger.warn(`avalai-credit: ${String(error)}`);
            reply(response, 500, { ok: false, error: 'internal' });
          }
        },
      }),
    'avalai-credit: route',
  );
}
