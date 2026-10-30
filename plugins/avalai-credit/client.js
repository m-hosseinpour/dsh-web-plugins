window.__ModuleLoader__.load({
  id: 'dsh-avalai-credit',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'avalai-credit';
    const ENDPOINT = '/plugin/avalai-credit/summary';
    const POLL_MS = 60_000;
    const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

    const en = {
      'label.daily': 'Daily',
      'label.weekly': 'Weekly',
      'label.other': 'Package',
      'label.balance': 'Balance',
      'label.unit': 'IRT',
      'label.of': 'of',
      'state.loading': 'Reading credit…',
      'state.failed': 'Credit unavailable',
      'state.empty': 'Nothing left',
      'state.stale': 'last read {age}',
      'state.updated': 'updated {age}',
      'package.none': 'No package on this account',
      'package.lapsed': 'expired',
      'age.now': 'just now',
      'age.minutes': '{n} min ago',
      'age.hours': '{n} h ago',
      'age.days': '{n} d ago',
      'duration.minutes': '{n}m',
      'duration.hours': '{n}h',
      'duration.days': '{n}d',
      'action.refresh': 'Refresh credit',
      'warn.balance-unread': 'balance unread',
      'warn.amount-unread': 'a package amount was unread',
      'warn.malformed': 'provider answer was incomplete',
      'warn.grants': 'grants present on this account',
      'warn.lapsed': '{count} package(s) lapsed with {amount} left',
      'error.credential-missing': 'API key is not configured',
      'error.timeout': 'provider did not answer in time',
      'error.network': 'provider is unreachable',
      'error.bad-json': 'provider answer was unreadable',
      'error.route': 'the credit route did not answer',
      'error.http': 'provider answered {status}',
    };

    const fa = {
      'label.daily': 'روزانه',
      'label.weekly': 'هفتگی',
      'label.other': 'بسته',
      'label.balance': 'اعتبار',
      'label.unit': 'تومان',
      'label.of': 'از',
      'state.loading': 'در حال خواندن اعتبار…',
      'state.failed': 'اعتبار خوانده نشد',
      'state.empty': 'چیزی نمانده',
      'state.stale': 'آخرین خواندن {age}',
      'state.updated': 'به‌روزرسانی {age}',
      'package.none': 'بسته‌ای روی این حساب نیست',
      'package.lapsed': 'منقضی شده',
      'age.now': 'همین حالا',
      'age.minutes': '{n} دقیقه پیش',
      'age.hours': '{n} ساعت پیش',
      'age.days': '{n} روز پیش',
      'duration.minutes': '{n} دقیقه',
      'duration.hours': '{n} ساعت',
      'duration.days': '{n} روز',
      'action.refresh': 'به‌روزرسانی اعتبار',
      'warn.balance-unread': 'اعتبار خوانده نشد',
      'warn.amount-unread': 'مبلغ یک بسته خوانده نشد',
      'warn.malformed': 'پاسخ provider کامل خوانده نشد',
      'warn.grants': 'این حساب آیتم‌هایی در grants دارد',
      'warn.lapsed': '{count} بسته منقضی شده و {amount} تومان از آن استفاده نشده',
      'error.credential-missing': 'کلید API تنظیم نشده',
      'error.timeout': 'provider به‌موقع پاسخ نداد',
      'error.network': 'دسترسی به provider نشد',
      'error.bad-json': 'پاسخ provider خوانا نبود',
      'error.route': 'مسیر اعتبار پاسخ نداد',
      'error.http': 'provider پاسخ داد {status}',
    };

    const CSS = [
      '.ac_dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance));max-width:var(--dsh-composer-card-max-width);margin:0 auto}',
      '.ac_bar{isolation:isolate;box-sizing:border-box;width:100%;--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel);min-height:36px;box-shadow:var(--dsw-elevation-soft);border:0;align-items:center;gap:10px;margin:0 auto;padding:5px 5px 5px 12px;display:flex;position:relative}',
      '.ac_bar:before{z-index:-1;border-radius:inherit;background:var(--dsw-specific-input-major);content:"";pointer-events:none;position:absolute;inset:0}',
      '.ac_glyph{color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex}',
      '.ac_main{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;flex:1 1 auto;min-width:0}',
      '.ac_chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;height:26px;padding:0 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ac_chipLabel{color:var(--dsw-alias-label-tertiary)}',
      '.ac_chipAmount{font-weight:600;font-variant-numeric:tabular-nums}',
      '.ac_chipTime{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;border-inline-start:1px solid var(--dsw-alias-border-l1);padding-inline-start:7px}',
      '.ac_chipOut{opacity:.75}',
      '.ac_sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}',
      '.ac_balance{display:inline-flex;align-items:center;gap:6px;flex:none;white-space:nowrap}',
      '.ac_balanceLabel{color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.ac_balanceAmount{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.ac_muted{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}',
      '.ac_warn{color:var(--dsw-alias-state-warn-label);font-size:11px;white-space:nowrap}',
      '.ac_error{color:var(--dsw-alias-state-error-primary);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ac_refresh{flex:none;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:0 0;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}',
      '.ac_refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.ac_refresh:disabled{opacity:.4;cursor:default}',
      '.ac_refresh[data-busy]{opacity:.6}',
      '.ac_refresh[data-busy] svg{animation:ac_spin 900ms linear infinite}',
      '@keyframes ac_spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.ac_refresh[data-busy] svg{animation:none}}',
      /* Narrow screens: the balance takes its own line instead of colliding with the package. */
      '@media (max-width:460px){.ac_bar{flex-wrap:wrap;row-gap:4px;padding-top:6px;padding-bottom:6px}.ac_glyph{order:1}.ac_main{order:2;flex:1 1 auto;min-width:0}.ac_refresh{order:3;margin-inline-start:auto}.ac_balance{order:4;flex:1 1 100%;padding-inline-start:22px}}',
    ].join('\n');

    const amountText = (value) => (value === null || value === undefined ? '—' : NUM.format(value));

    /** One decimal, with a bare integer left bare: 1 -> "1", 1.46 -> "1.5". */
    function oneDecimal(value) {
      const rounded = Math.round(value * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    }

    /**
     * A short, factual distance in time — no verdict attached. Days keep one
     * decimal; anything under a day is stated in hours.
     * @param seconds - positive seconds, or null when unknown.
     */
    function durationText(seconds, t) {
      if (seconds === null || seconds === undefined || seconds <= 0) return '';
      if (seconds >= 86400) return t('duration.days', { n: oneDecimal(seconds / 86400) });
      if (seconds >= 3600) return t('duration.hours', { n: oneDecimal(seconds / 3600) });
      return t('duration.minutes', { n: Math.max(1, Math.round(seconds / 60)) });
    }

    /** How old the shown reading is, in the same short units. */
    function ageText(seconds, t) {
      if (seconds === null || seconds === undefined || seconds < 60) return t('age.now');
      if (seconds < 3600) return t('age.minutes', { n: Math.floor(seconds / 60) });
      if (seconds < 86400) return t('age.hours', { n: Math.floor(seconds / 3600) });
      return t('age.days', { n: Math.floor(seconds / 86400) });
    }

    const KNOWN_ERRORS = ['credential-missing', 'timeout', 'network', 'bad-json', 'route'];

    /** Localized text for one provider or transport failure code. */
    function errorText(code, t) {
      if (code === '') return '';
      const status = /^http-(\d+)$/.exec(code);
      if (status !== null) return t('error.http', { status: status[1] });
      return t(`error.${KNOWN_ERRORS.includes(code) ? code : 'network'}`);
    }

    /**
     * One package's remaining amount and time. A package that can no longer pay
     * stays visible and dimmed: the money in it was real even though it is spent.
     */
    function PackageChip({ pkg, t }) {
      const label = pkg.tier === 'other' ? pkg.name || t('label.other') : t(`label.${pkg.tier}`);
      const total =
        pkg.amount === null ? '' : `${amountText(pkg.remaining)} ${t('label.of')} ${amountText(pkg.amount)} ${t('label.unit')}`;
      const time =
        pkg.expiresInSeconds === null
          ? ''
          : pkg.expiresInSeconds > 0
            ? durationText(pkg.expiresInSeconds, t)
            : t('package.lapsed');
      const title = [pkg.name, total, time].filter(Boolean).join(' · ');
      return h(
        'span',
        { className: pkg.spendable ? 'ac_chip' : 'ac_chip ac_chipOut', title, dir: 'auto' },
        h('span', { className: 'ac_chipLabel' }, label),
        h('span', { className: 'ac_chipAmount' }, amountText(pkg.remaining)),
        time === '' ? null : h('span', { className: 'ac_chipTime' }, time),
      );
    }

    /** The strip above the composer: every package, then the main balance. */
    function CreditBar({ session, t }) {
      const [data, setData] = React.useState(null);
      const [transport, setTransport] = React.useState('');
      const [busy, setBusy] = React.useState(true);
      const [pending, setPending] = React.useState(0);
      const [waiting, setWaiting] = React.useState(false);
      const sessionId = session?.sessionId;
      // Only the newest request may write: a slow poll must not overwrite a
      // fresher answer the refresh button already produced.
      const sequence = React.useRef(0);
      const applicable = React.useRef(true);
      const retries = React.useRef(0);

      const load = React.useCallback(
        (force, quiet = false) => {
          const mine = sequence.current + 1;
          sequence.current = mine;
          if (!quiet) setBusy(true);
          setPending((count) => count + 1);
          const query = new URLSearchParams();
          if (typeof sessionId === 'string' && sessionId !== '') query.set('session', sessionId);
          if (force) query.set('refresh', '1');
          const url = query.toString() === '' ? ENDPOINT : `${ENDPOINT}?${query}`;
          return fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
            .then(async (response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return await response.json();
            })
            .then((next) => {
              if (sequence.current !== mine) return;
              applicable.current = next.applicable !== false;
              if (next.pending === true) {
                // The Host has not materialized this Session yet; ask again soon
                // instead of reporting another account's numbers.
                setWaiting(true);
                if (retries.current < 5) {
                  retries.current += 1;
                  window.setTimeout(() => load(false, true), 1500);
                }
                return;
              }
              retries.current = 0;
              setWaiting(false);
              setData(next);
              setTransport('');
            })
            .catch((error) => {
              if (sequence.current !== mine) return;
              setWaiting(false);
              setTransport(error instanceof Error ? error.message : String(error));
            })
            .finally(() => {
              setPending((count) => Math.max(0, count - 1));
              if (!quiet) setBusy(false);
            });
        },
        [sessionId],
      );

      React.useEffect(() => {
        load(false);
        const poll = () => {
          if (!document.hidden && applicable.current) load(false, true);
        };
        const timer = window.setInterval(poll, POLL_MS);
        document.addEventListener('visibilitychange', poll);
        return () => {
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', poll);
        };
      }, [load]);

      // This Session spends from another provider, so its credit is not the
      // subject of this strip: show nothing rather than a row about money.
      if (data !== null && data.applicable === false) return null;

      // A route failure means this plugin could not answer; only a provider
      // failure belongs to the `http-*` codes.
      const code = transport !== '' ? 'route' : data?.error ?? '';
      const read = data !== null && data.source !== 'none';
      const age = read ? ageText(data.ageSeconds, t) : '';
      const account = typeof data?.account === 'string' && data.account !== '' ? data.account : '';

      const chips = read
        ? data.packages.map((pkg) => h(PackageChip, { key: `${pkg.name}|${pkg.expiresAt}`, pkg, t }))
        : [];
      const holdsMoney = read && data.packages.some((pkg) => (pkg.remaining ?? 0) > 0);
      if (read && data.packages.length === 0 && data.state !== 'empty') {
        chips.push(h('span', { key: 'none', className: 'ac_muted' }, t('package.none')));
      }

      // A missing key or a rejected one will not fix itself, so it is stated
      // rather than left in a tooltip; a transient failure just ages the numbers.
      const persistent = code === 'credential-missing' || /^http-4\d\d$/.test(code);
      const warningText = (warning) =>
        warning === 'lapsed'
          ? t('warn.lapsed', {
              count: String(data.lapsed?.count ?? 0),
              amount: amountText(data.lapsed?.amount ?? 0),
            })
          : t(`warn.${warning}`);
      const warnings = read ? data.warnings.map(warningText) : [];

      const body = [];
      if (read) {
        body.push(...chips);
        if (code !== '') {
          body.push(
            h(
              'span',
              { key: 'stale', className: 'ac_warn', title: errorText(code, t), dir: 'auto' },
              persistent ? errorText(code, t) : t('state.stale', { age }),
            ),
          );
        } else if (warnings.length > 0) {
          body.push(h('span', { key: 'warn', className: 'ac_warn', dir: 'auto' }, warnings.join(' · ')));
        } else if (data.state === 'empty' && !holdsMoney) {
          body.push(h('span', { key: 'empty', className: 'ac_muted' }, t('state.empty')));
        }
      } else if (busy || pending > 0 || waiting) {
        // Nothing yet: waiting is not worth a row of its own, and a strip for
        // another provider disappears silently rather than flashing first.
        return null;
      } else if (code === '' && transport === '') {
        return null;
      } else {
        body.push(
          h(
            'span',
            { key: 'failed', className: 'ac_error', title: transport || errorText(code, t), dir: 'auto' },
            `${t('state.failed')} — ${errorText(code, t)}`,
          ),
        );
      }

      return h(
        'div',
        { className: 'ac_dock', 'data-avalai-credit': '' },
        h(
          'div',
          { className: 'ac_bar' },
          h(
            'span',
            {
              className: 'ac_glyph',
              title: read ? [account, t('state.updated', { age })].filter(Boolean).join(' · ') : account || undefined,
              'aria-hidden': 'true',
            },
            h(
              'svg',
              { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
              h('rect', {
                x: 1.5,
                y: 3.5,
                width: 13,
                height: 9,
                rx: 2,
                stroke: 'currentColor',
                'stroke-width': 1.2,
              }),
              h('path', { d: 'M1.5 6.5h13', stroke: 'currentColor', 'stroke-width': 1.2 }),
              h('path', { d: 'M4 10h3', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' }),
            ),
          ),
          h('div', { className: 'ac_main' }, ...body),
          read
            ? h(
                'span',
                { key: 'balance', className: 'ac_balance', dir: 'auto' },
                h('span', { className: 'ac_balanceLabel' }, t('label.balance')),
                h('span', { className: 'ac_balanceAmount' }, amountText(data.mainBalance)),
                data.mainBalance === null ? null : h('span', { className: 'ac_balanceLabel' }, t('label.unit')),
              )
            : null,
          read
            ? h('span', { className: 'ac_sr' }, [account, t('state.updated', { age })].filter(Boolean).join(' · '))
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'ac_refresh',
              onClick: () => load(true),
              disabled: pending > 0,
              'data-busy': busy ? '' : undefined,
              'aria-label': t('action.refresh'),
              title: t('action.refresh'),
            },
            h(
              'svg',
              { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
              h('path', {
                d: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5V6h-3.5',
                stroke: 'currentColor',
                'stroke-width': 1.3,
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
              }),
            ),
          ),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'avalai-credit: en');
        ctx.effect(() => ctx.locale.register(NS, 'fa', fa), 'avalai-credit: fa');

        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.pluginCss = 'dsh-avalai-credit';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'avalai-credit: styles');

        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'avalai-credit',
              order: 30,
              locale: NS,
            },
            CreditBar,
          ),
        );
      },
    };
  },
});
