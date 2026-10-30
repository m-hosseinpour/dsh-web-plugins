window.__ModuleLoader__.load({
  id: 'dsh-model-provider-label',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /* The trigger truncates its label and caps the button at min(360px, 45cqw).
     * The model name keeps a floor so it never vanishes; the provider tag takes
     * the remaining shortage. Below a narrow composer the tag is dropped: at
     * that width it would collapse to one letter while eating the model name. */
    const CSS = `
.dsh-mpl-root{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;vertical-align:middle}
.dsh-mpl-model{flex:1 1 auto;min-width:4.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mpl-provider{flex:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;padding:0 4px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:14px;letter-spacing:.01em;white-space:nowrap}
@container (max-width: 380px){.dsh-mpl-provider{display:none}}
`;

    /* The slot also feeds the root menu's current-value row and every selectable
     * option. Those keep the plain catalog name: options already sit under a
     * provider heading, and the menu row is a compact copy of the trigger. */
    function ModelProviderLabel({ provider, model, placement }) {
      if (placement !== 'trigger') return model.name;
      return h(
        'span',
        { className: 'dsh-mpl-root' },
        h('span', { className: 'dsh-mpl-model' }, model.name),
        h('span', { className: 'dsh-mpl-provider' }, provider.name),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-model-provider-label';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        });
        /* The shipped 1017 badge already occupies this single cell at priority 0;
         * an equal priority would sort after it and never render. */
        ctx.slots.inject('conversation.input.model.label', () =>
          ctx.slots.register(
            { name: 'conversation.input.model.label', priority: -1 },
            ModelProviderLabel,
          ),
        );
      },
    };
  },
});
