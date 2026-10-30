window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'session-delete';
    const ENDPOINT = '/plugin/session-delete/delete';

    /* Two-click confirmation inside the menu itself: the first click only
     * arms the row, so a stray click on "..." cannot destroy history. */
    const en = {
      'menu.delete': 'Delete session',
      'menu.confirm': 'Click again to delete forever',
      'menu.deleting': 'Deleting…',
      'menu.hint': 'Permanently removes this session and its history from disk.',
      'menu.failed': 'Could not delete the session: {message}',
    };
    const fa = {
      'menu.delete': 'حذف سشن',
      'menu.confirm': 'برای حذف همیشگی دوباره کلیک کنید',
      'menu.deleting': 'در حال حذف…',
      'menu.hint': 'این سشن و تاریخچه‌اش را برای همیشه از دیسک پاک می‌کند.',
      'menu.failed': 'حذف سشن انجام نشد: {message}',
    };

    const CSS = [
      '.sd_item{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 10px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1;text-align:start;cursor:pointer;white-space:nowrap}',
      '.sd_item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.sd_item:disabled{opacity:.6;cursor:default}',
      '.sd_item[data-armed]{color:var(--dsw-alias-state-error-primary);font-weight:600}',
      '.sd_icon{display:inline-flex;flex:0 0 auto;color:currentColor}',
    ].join('\n');

    /**
     * Build the menu row over the Client context it acts through.
     * @param ctx - Client Cordis context.
     * @returns the menu row component.
     */
    function createMenuItem(ctx) {
      /**
       * One "..." menu row that deletes its Session on the second click.
       * @param props - owner share, retention hook, menu open state, translate.
       */
      return function DeleteSessionMenuItem({ sessionId, useSessionRetainInfo, useMenuOpenState, t }) {
        const [, setMenuOpen] = useMenuOpenState();
        const [armed, setArmed] = React.useState(false);
        const [busy, setBusy] = React.useState(false);
        const retained = useSessionRetainInfo(sessionId, (info) => (info?.retainedBy?.mainView ?? 0) > 0);
        const label = busy ? t('menu.deleting') : armed ? t('menu.confirm') : t('menu.delete');

        const onSelect = async () => {
          if (busy) return;
          if (!armed) {
            setArmed(true);
            return;
          }
          setBusy(true);
          try {
            if (retained) {
              /* Leave the Session before its log disappears, so no composer can
               * append to a file that no longer exists. */
              ctx.get('uiWorkspace')?.startSession();
              await new Promise((done) => setTimeout(done, 600));
            }
            const response = await fetch(ENDPOINT, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ sessionId }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok !== true) {
              throw new Error(typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`);
            }
            setMenuOpen(false);
          } catch (error) {
            setBusy(false);
            setArmed(false);
            window.alert(t('menu.failed', { message: error instanceof Error ? error.message : String(error) }));
          }
        };

        return h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'sd_item',
            title: t('menu.hint'),
            'aria-busy': busy || undefined,
            'data-armed': armed ? '' : undefined,
            disabled: busy,
            onClick: onSelect,
          },
          h(
            'span',
            { className: 'sd_icon', 'aria-hidden': 'true' },
            h(
              'svg',
              { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
              h('path', {
                d: 'M2.5 4h11M6.5 4V2.5h3V4M4 4l.6 9a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4L12 4M6.5 6.5v5M9.5 6.5v5',
                stroke: 'currentColor',
                'stroke-width': 1.2,
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
              }),
            ),
          ),
          label,
        );
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'session-delete: en');
        ctx.effect(() => ctx.locale.register(NS, 'fa', fa), 'session-delete: fa');

        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.pluginCss = 'dsh-session-delete';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'session-delete: styles');

        const translate = ctx.locale.bind(NS);
        const Row = createMenuItem(ctx);
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'session-delete',
              order: 500,
            },
            (props) => h(Row, { ...props, t: translate }),
          ),
        );
      },
    };
  },
});
