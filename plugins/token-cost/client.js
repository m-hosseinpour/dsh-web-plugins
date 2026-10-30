window.__ModuleLoader__.load({
  id: 'dsh-token-cost',
  factory(require) {
    const React = require('react');

    const NS = 'token-cost';
    const ENDPOINT = '/plugin/token-cost/summary';
    const RATE_ENDPOINT = 'https://api.avalai.ir/public/exchange-rate';
    const RATE_CACHE_KEY = 'dsh-token-cost:exchange-rate';
    const RATE_TTL_MS = 60 * 60 * 1000;
    const LIST = 'dl[data-session-stats-usage]';
    const ROW = '[data-token-cost]';

    const en = {
      'cost.usd': 'Cost (USD)',
      'cost.tooltip': '{model} · ${input}/1M input · ${cached}/1M cached · ${output}/1M output',
      'cost.irt': 'Cost (IRT)',
      'cost.irtTooltip': 'Estimated at 1 USD = {rate} IRT · AvalAI exchange rate',
    };

    const fa = {
      'cost.usd': 'هزینه (دلار)',
      'cost.tooltip': '{model} · ${input} به‌ازای یک‌میلیون ورودی · ${cached} کش‌شده · ${output} خروجی',
      'cost.irt': 'هزینه (تومان)',
      'cost.irtTooltip': 'تخمینی با نرخ ۱ دلار = {rate} تومان · نرخ ارز AvalAI',
    };

    const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

    /** A published per-million rate: 0.15 → "0.15", 0.003 → "0.003". */
    function rate(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '?';
      return String(Math.round(value * 10_000) / 10_000);
    }

    /**
     * Money people can compare at a glance: cents with two decimals, and four
     * for a sub-dollar reading where two would collapse meaningful digits.
     * @param value - cost in USD.
     */
    function money(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
    }

    function tooltip(summary, t) {
      const pricing = summary?.pricing;
      if (pricing === null || typeof pricing !== 'object') return '';
      return t('cost.tooltip', {
        model: summary.model || '',
        input: rate(pricing.input),
        cached: rate(pricing.cachedInput),
        output: rate(pricing.output),
      });
    }

    /**
     * The last good exchange rate, from this browser's storage. The endpoint is
     * public and CORS-open, so the rate is read directly; the TTL keeps one
     * tab from asking on every render and survives a page reload.
     */
    function readRateCache() {
      try {
        const raw = JSON.parse(window.localStorage.getItem(RATE_CACHE_KEY) ?? 'null');
        if (raw === null || typeof raw !== 'object') return null;
        if (typeof raw.rate !== 'number' || !Number.isFinite(raw.rate) || raw.rate <= 0) return null;
        if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null;
        return { rate: raw.rate, at: raw.at };
      } catch {
        return null;
      }
    }

    function writeRateCache(next) {
      try {
        window.localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(next));
      } catch {
        // Storage can be unavailable; the in-memory value still serves the page.
      }
    }

    /** Drop every row this plugin added, wherever the popover currently is. */
    function removeRows() {
      for (const node of document.querySelectorAll(`${LIST} > ${ROW}`)) node.remove();
    }

    /**
     * Add or refresh the cost rows at the end of the shipped details list.
     *
     * The popover is a React-owned `<dl>` with no extension slot, and the rows
     * have to sit inside its grid. Appending trailing pairs leaves the list's
     * own children untouched, so React keeps reconciling them normally; the
     * observer re-adds the pairs if the popover is closed and reopened.
     * @param rows - `{ key, label, value, title }`, in display order.
     */
    function writeRows(rows) {
      for (const list of document.querySelectorAll(LIST)) {
        const wanted = new Set(rows.map((row) => row.key));
        for (const node of list.querySelectorAll(`:scope > ${ROW}`)) {
          if (!wanted.has(node.getAttribute('data-token-cost'))) node.remove();
        }
        for (const row of rows) {
          let term = list.querySelector(`:scope > dt[data-token-cost="${row.key}"]`);
          let definition = list.querySelector(`:scope > dd[data-token-cost="${row.key}"]`);
          if (term === null) {
            term = document.createElement('dt');
            term.setAttribute('data-token-cost', row.key);
            list.appendChild(term);
          }
          if (definition === null) {
            definition = document.createElement('dd');
            definition.setAttribute('data-token-cost', row.key);
            // Keep the currency sign before the amount in an RTL page.
            definition.dir = 'ltr';
            list.appendChild(definition);
          }
          if (term.textContent !== row.label) term.textContent = row.label;
          if (definition.textContent !== row.value) definition.textContent = row.value;
          if (definition.title !== row.title) definition.title = row.title;
        }
      }
    }

    /**
     * Invisible dock seat that owns the pricing read and the extra rows.
     *
     * It renders nothing itself: the rows belong to the shipped usage popover,
     * which exists only while that popover is open. The seat exists so the read
     * follows the Session and its token projection, and so teardown removes the
     * rows with the rest of the plugin.
     */
    function TokenCostDock({ sessionId, useProjection, t }) {
      const usage = useProjection('tokenUsage');
      const selection = useProjection('modelSelection');
      const [summary, setSummary] = React.useState(null);
      const [rateState, setRateState] = React.useState(() => readRateCache());
      const rateRef = React.useRef(rateState);
      const rateInFlight = React.useRef(false);

      const signature = usage
        ? `${usage.uncachedInputTokens}:${usage.cacheReadTokens}:${usage.cacheWriteTokens}:${usage.outputTokens}`
        : '';
      // A model switch with no new tokens still changes the rates, so the read
      // is keyed on the route as well as on the four counters.
      const routeKey = selection?.next ? `${selection.next.provider}/${selection.next.model}` : '';

      React.useEffect(() => {
        rateRef.current = rateState;
      }, [rateState]);

      /**
       * Refresh the toman rate only when the cached one is past its hour. The
       * endpoint is cheap, but opening the popover should not ask on every look.
       */
      const ensureRate = React.useCallback((force = false) => {
        const current = rateRef.current;
        if (!force && current !== null && Date.now() - current.at < RATE_TTL_MS) return;
        if (rateInFlight.current) return;
        rateInFlight.current = true;
        fetch(RATE_ENDPOINT, { headers: { accept: 'application/json' } })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
          })
          .then((payload) => {
            const value = Number(payload?.exchange_rate);
            if (!Number.isFinite(value) || value <= 0) throw new Error('invalid exchange rate');
            const next = { rate: value, at: Date.now() };
            writeRateCache(next);
            rateRef.current = next;
            setRateState(next);
          })
          .catch(() => {
            // The last known rate stays usable; without one only USD is shown.
          })
          .finally(() => {
            rateInFlight.current = false;
          });
      }, []);

      React.useEffect(() => {
        ensureRate();
      }, [ensureRate, sessionId]);

      // A different Session must not inherit the previous one's amount while
      // its own read is in flight.
      React.useEffect(() => {
        setSummary(null);
      }, [sessionId]);

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '' || signature === '') return undefined;
        const controller = new AbortController();
        let live = true;
        const query = new URLSearchParams({ session: sessionId });
        fetch(`${ENDPOINT}?${query}`, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
          })
          .then((next) => {
            if (live) setSummary(next);
          })
          .catch((error) => {
            if (live && error?.name !== 'AbortError') setSummary({ ok: false, error: 'route' });
          });
        return () => {
          live = false;
          controller.abort();
        };
      }, [sessionId, signature, routeKey]);

      const applicable = summary !== null && summary.ok !== false && summary.applicable !== false;
      const value = applicable ? money(summary.cost) : null;
      const toman =
        value !== null && rateState !== null ? Math.round(summary.cost * rateState.rate) : null;
      const tomanValue = toman === null ? null : COUNT.format(toman);

      const rows = React.useMemo(() => {
        const next = [];
        if (value !== null) {
          next.push({ key: 'usd', label: t('cost.usd'), value, title: tooltip(summary, t) });
        }
        if (tomanValue !== null && rateState !== null) {
          next.push({
            key: 'toman',
            label: t('cost.irt'),
            value: tomanValue,
            title: t('cost.irtTooltip', { rate: COUNT.format(rateState.rate) }),
          });
        }
        return next;
      }, [value, tomanValue, summary, rateState, t]);
      const rowsKey = JSON.stringify(rows);

      React.useEffect(() => {
        if (rows.length === 0) {
          removeRows();
          return undefined;
        }
        const sync = () => writeRows(rows);
        // Streaming and tool output mutate the page constantly; inspect only
        // the records that could carry a newly mounted popover. Opening it is
        // also the moment to refresh a rate older than the cache window.
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (node.matches(LIST) || node.querySelector(LIST) !== null) {
                sync();
                ensureRate();
                return;
              }
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        sync();
        return () => {
          observer.disconnect();
          removeRows();
        };
      }, [rowsKey, ensureRate]);

      // The seat is invisible by design: the rows live in the shipped popover,
      // and the seat's lifetime is what keeps them following this Session.
      return null;
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'token-cost: en');
        ctx.effect(() => ctx.locale.register(NS, 'fa', fa), 'token-cost: fa');

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'token-cost',
              order: 90,
              locale: NS,
            },
            TokenCostDock,
          ),
        );
      },
    };
  },
});
