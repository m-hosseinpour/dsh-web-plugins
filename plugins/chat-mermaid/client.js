window.__ModuleLoader__.load({
  id: 'dsh-chat-mermaid',
  factory() {
    /* Chat renders a ```mermaid fence through the same Markdown code-block
     * component as any other language: a `.md-code-block` whose banner names the
     * language and whose content holds the source. There is no fence-renderer
     * slot to register into, so the plugin swaps the rendered code for a diagram
     * after the host has painted it — the same surface treatment chat-bidi uses.
     *
     * The source itself is never removed, only hidden: the host's own copy button
     * keeps reading it, and the toggle brings it back. A React re-render of the
     * block (streaming text, history paging, row recycling) is repaired by the
     * observer sweep, which re-reads every block instead of trusting cached DOM. */
    const NS = 'chat-mermaid';
    const LIBRARY_ROUTE = '/dsh-mermaid/mermaid.min.js';
    const CHAT_ROW = '[data-slot="conversation.chat.node"]';
    const BLOCK = '.md-code-block';
    const BANNER = '[data-code-block-banner]';
    const CONTENT = '[data-code-block-content]';
    const MERMAID_LABELS = new Set(['mermaid', 'mermaidjs']);
    /* Mermaid is not a shiki language, so the host labels that block with its
     * generic "Code block" text and the fence name never reaches the DOM. The
     * source is therefore the only identifier: accept an unhighlighted block
     * whose first meaningful line is a Mermaid diagram directive. A block the
     * host did highlight is a real language and is never rewritten. */
    const DIAGRAM_HEAD = /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|zenuml|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|radar-beta|treemap-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|ishikawa-beta)\b/;
    const SWEEP_DELAY = 250;
    const SETTLE_DELAY = 2500;
    const LIBRARY_DELAY = 600;
    const LOAD_RETRY = 5000;
    const CACHE_LIMIT = 80;

    const en = {
      'action.source': 'Source',
      'action.diagram': 'Diagram',
      'label.diagram': 'Mermaid diagram',
      'error.render': 'Diagram could not be rendered',
      'error.library': 'Mermaid could not be loaded',
    };

    const fa = {
      'action.source': 'متن',
      'action.diagram': 'نمودار',
      'label.diagram': 'نمودار Mermaid',
      'error.render': 'نمودار رندر نشد',
      'error.library': 'کتابخانهٔ Mermaid بارگذاری نشد',
    };

    const CSS = `
.dsh-chat-mermaid { padding: 0 22px 10px; }
.dsh-chat-mermaid[data-mode="loading"] { display: none; }
.dsh-chat-mermaid__bar {
  display: flex; justify-content: flex-end; align-items: center;
  min-height: 20px; margin: 2px 0 0;
}
.dsh-chat-mermaid__toggle {
  appearance: none; border: 0; margin: 0; padding: 0 8px; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary, #61666b);
  font-family: inherit; font-size: 12px; line-height: 20px; cursor: pointer;
}
.dsh-chat-mermaid__toggle:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #0f1115);
}
.dsh-chat-mermaid__toggle:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #2f6bff); outline-offset: 1px;
}
.dsh-chat-mermaid__stage {
  display: flex; justify-content: safe center; align-items: flex-start;
  padding: 2px 0 4px;
}
.dsh-chat-mermaid__stage svg { max-width: 100%; height: auto; }
.dsh-chat-mermaid__note {
  display: none; margin: 0; padding: 0 0 10px; white-space: pre-wrap;
  color: var(--dsw-alias-state-warn-primary, #8a5a00);
  font-size: 12px; line-height: 18px;
}
.dsh-chat-mermaid[data-mode="source"] { padding-bottom: 0; }
.dsh-chat-mermaid[data-mode="source"] .dsh-chat-mermaid__stage,
.dsh-chat-mermaid[data-mode="error"] .dsh-chat-mermaid__stage { display: none; }
.dsh-chat-mermaid[data-mode="error"] .dsh-chat-mermaid__bar { display: none; }
.dsh-chat-mermaid[data-mode="error"] .dsh-chat-mermaid__note { display: block; }
`;

    return {
      inject: ['locale', 'theme'],
      apply(ctx) {
        let translate = ctx.locale.bind(NS);
        const label = (key) => translate(key);

        const states = new WeakMap();
        const live = new Set();
        const cache = new Map();

        let scheme = ctx.theme.getTheme().active.colorScheme;
        let api = null;
        let loading = null;
        let loadFailedAt = 0;
        let sequence = 0;
        let queue = Promise.resolve();
        let sweepTimer = 0;
        let observer = null;
        let disposed = false;

        const styleTag = document.createElement('style');
        styleTag.dataset.pluginCss = NS;
        styleTag.textContent = CSS;
        document.head.append(styleTag);

        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'chat-mermaid: en');
        ctx.effect(() => ctx.locale.register(NS, 'fa', fa), 'chat-mermaid: fa');

        function describe(error) {
          const raw = error instanceof Error ? error.message : String(error);
          const line = raw.split('\n').find((part) => part.trim() !== '') ?? raw;
          return line.length > 160 ? `${line.slice(0, 157)}…` : line;
        }

        function cacheKey(source) {
          return `${scheme}\u0000${source}`;
        }

        function remember(source, svg) {
          const key = cacheKey(source);
          cache.delete(key);
          cache.set(key, svg);
          while (cache.size > CACHE_LIMIT) {
            const oldest = cache.keys().next();
            if (oldest.done) break;
            cache.delete(oldest.value);
          }
        }

        function initialize() {
          if (api === null) return;
          api.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            suppressErrorRendering: true,
            theme: scheme === 'dark' ? 'dark' : 'default',
            fontFamily: getComputedStyle(document.body).fontFamily,
            flowchart: { useMaxWidth: true },
            sequence: { useMaxWidth: true },
            gantt: { useMaxWidth: true },
          });
        }

        function library() {
          if (api !== null) return Promise.resolve(api);
          if (loading !== null) return loading;
          const ready = globalThis.mermaid;
          if (ready !== undefined && typeof ready.render === 'function') {
            api = ready;
            initialize();
            return Promise.resolve(api);
          }
          if (loadFailedAt !== 0 && Date.now() - loadFailedAt < LOAD_RETRY) {
            return Promise.reject(new Error('library unavailable'));
          }
          loading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = LIBRARY_ROUTE;
            script.async = true;
            script.dataset.pluginAsset = NS;
            script.addEventListener('load', () => {
              const candidate = globalThis.mermaid;
              if (candidate === undefined || typeof candidate.render !== 'function') {
                reject(new Error('the library did not expose mermaid'));
                return;
              }
              api = candidate;
              initialize();
              resolve(api);
            }, { once: true });
            script.addEventListener('error', () => reject(new Error('the library request failed')), { once: true });
            document.head.append(script);
          })
            .catch((error) => {
              loadFailedAt = Date.now();
              throw error;
            })
            .finally(() => {
              loading = null;
            });
          return loading;
        }

        /* Mermaid keeps render state in one module-global instance, so concurrent
         * render() calls interleave their temporary DOM and ids. One at a time. */
        function render(source) {
          const task = () => {
            sequence += 1;
            return api.render(`dsh-chat-mermaid-${sequence}`, source);
          };
          const next = queue.then(task, task);
          queue = next.then(() => {}, () => {});
          return next;
        }

        function applyMode(state, mode) {
          state.figure.dataset.mode = mode;
          state.toggle.textContent = label(mode === 'source' ? 'action.diagram' : 'action.source');
          state.toggle.setAttribute('aria-pressed', mode === 'source' ? 'true' : 'false');
          if (state.content !== null) {
            state.content.style.display = mode === 'diagram' ? 'none' : state.displayBefore;
          }
        }

        function clearNote(state) {
          if (state.noteTimer !== 0) {
            clearTimeout(state.noteTimer);
            state.noteTimer = 0;
          }
          state.note.textContent = '';
          state.note.removeAttribute('title');
        }

        function commit(state, source, svg) {
          state.status = 'done';
          state.source = source;
          state.svg = svg;
          state.error = null;
          clearNote(state);
          state.stage.innerHTML = svg;
          applyMode(state, 'diagram');
        }

        function fail(state, source, error, libraryFailed) {
          state.status = 'failed';
          state.svg = null;
          state.source = source;
          const detail = describe(error);
          state.error = { source, detail, library: libraryFailed, at: Date.now() };
          applyMode(state, 'source');
          clearNote(state);
          state.noteTimer = setTimeout(() => {
            state.noteTimer = 0;
            if (state.error === null || state.error.source !== source) return;
            if (state.source !== source) return;
            state.note.textContent = libraryFailed ? label('error.library') : label('error.render');
            state.note.title = detail;
            state.figure.dataset.mode = 'error';
          }, libraryFailed ? LIBRARY_DELAY : SETTLE_DELAY);
          if (libraryFailed) scheduleSweep(LOAD_RETRY);
        }

        async function paint(state, source) {
          state.status = 'pending';
          state.key = source;
          state.error = null;
          clearNote(state);
          const cached = cache.get(cacheKey(source));
          if (cached !== undefined) {
            commit(state, source, cached);
            return;
          }
          let result;
          try {
            await library();
            if (state.status !== 'pending' || state.key !== source) return;
            result = await render(source);
          } catch (error) {
            if (state.status !== 'pending' || state.key !== source) return;
            fail(state, source, error, api === null);
            return;
          }
          if (state.status !== 'pending' || state.key !== source) return;
          const svg = typeof result?.svg === 'string' ? result.svg : '';
          if (svg === '') {
            fail(state, source, new Error('the renderer returned no diagram'), false);
            return;
          }
          remember(source, svg);
          commit(state, source, svg);
          if (typeof result.bindFunctions === 'function') {
            try {
              result.bindFunctions(state.stage);
            } catch (error) {
              // Interactive links are optional; a binding failure does not affect the drawing.
            }
          }
        }

        function create(block, content) {
          const figure = document.createElement('div');
          figure.className = 'dsh-chat-mermaid';
          figure.dataset.mode = 'loading';
          figure.setAttribute('role', 'group');
          figure.setAttribute('aria-label', label('label.diagram'));

          const bar = document.createElement('div');
          bar.className = 'dsh-chat-mermaid__bar';

          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'dsh-chat-mermaid__toggle';
          toggle.textContent = label('action.source');
          bar.append(toggle);

          const stage = document.createElement('div');
          stage.className = 'dsh-chat-mermaid__stage';

          const note = document.createElement('p');
          note.className = 'dsh-chat-mermaid__note';

          figure.append(stage, note, bar);

          const state = {
            block,
            figure,
            toggle,
            stage,
            note,
            content: null,
            displayBefore: '',
            key: null,
            source: null,
            svg: null,
            status: 'idle',
            error: null,
            noteTimer: 0,
          };

          toggle.addEventListener('click', () => {
            if (state.figure.dataset.mode === 'source' || state.figure.dataset.mode === 'error') {
              if (state.svg !== null) {
                applyMode(state, 'diagram');
                return;
              }
              if (state.key !== null) void paint(state, state.key);
              return;
            }
            applyMode(state, 'source');
          });

          states.set(block, state);
          live.add(state);
          attach(state, content);
          return state;
        }

        function attach(state, content) {
          if (state.content === content) return;
          if (state.content !== null) state.content.style.display = state.displayBefore;
          state.displayBefore = content.style.display;
          state.content = content;
          if (state.figure.parentElement !== content.parentElement || state.figure.nextSibling !== content) {
            content.before(state.figure);
          }
          applyMode(state, state.figure.dataset.mode);
        }

        function teardown(state) {
          live.delete(state);
          states.delete(state.block);
          clearNote(state);
          if (state.content !== null) state.content.style.display = state.displayBefore;
          state.figure.remove();
        }

        function settled(state, source) {
          if (state.key !== source) return false;
          if (state.status === 'pending' || state.status === 'done') return true;
          if (state.status === 'failed' && state.error !== null && state.error.source === source) {
            // A library failure is retried on a cooldown; a parse failure waits for an edit.
            return !(state.error.library && Date.now() - state.error.at >= LOAD_RETRY);
          }
          return false;
        }

        /** The first line that carries a Mermaid directive, past frontmatter and %% directives. */
        function diagramHead(source) {
          let text = source.replace(/^\uFEFF/, '').trimStart();
          if (text.startsWith('---')) {
            const end = text.indexOf('\n---', 3);
            if (end === -1) return '';
            text = text.slice(end + 4).trimStart();
          }
          while (text.startsWith('%%')) {
            const newline = text.indexOf('\n');
            if (newline === -1) return '';
            text = text.slice(newline + 1).trimStart();
          }
          return text.split('\n', 1)[0].trim();
        }

        function read(block) {
          if (block.closest(CHAT_ROW) === null) return null;
          const content = block.querySelector(CONTENT);
          const pre = content === null ? null : content.querySelector('pre');
          if (pre === null) return null;
          const source = pre.textContent;
          if (source.trim() === '') return null;
          const banner = block.querySelector(BANNER);
          const heading = banner === null ? null : banner.firstElementChild;
          const text = ((heading === null ? banner?.textContent : heading.textContent) ?? '').trim();
          const word = /^[\w-]+/.exec(text);
          const labelled = word !== null && MERMAID_LABELS.has(word[0].toLowerCase());
          const highlighted = pre.className.includes('shiki');
          if (!labelled && (highlighted || !DIAGRAM_HEAD.test(diagramHead(source)))) return null;
          return { content, source };
        }

        function sweep() {
          const seen = new Set();
          for (const block of document.querySelectorAll(BLOCK)) {
            if (block.closest(CHAT_ROW) === null) continue;
            seen.add(block);
            const info = read(block);
            if (info === null) {
              const stale = states.get(block);
              if (stale !== undefined) teardown(stale);
              continue;
            }
            const state = states.get(block) ?? create(block, info.content);
            attach(state, info.content);
            if (settled(state, info.source)) continue;
            void paint(state, info.source);
          }
          for (const state of [...live]) {
            if (!seen.has(state.block) || !state.block.isConnected) teardown(state);
          }
        }

        function scheduleSweep(delay) {
          if (sweepTimer !== 0) clearTimeout(sweepTimer);
          sweepTimer = setTimeout(() => {
            sweepTimer = 0;
            if (!disposed) sweep();
          }, delay);
        }

        function refreshLabels() {
          translate = ctx.locale.bind(NS);
          for (const state of live) {
            state.figure.setAttribute('aria-label', label('label.diagram'));
            applyMode(state, state.figure.dataset.mode);
            if (state.figure.dataset.mode === 'error' && state.error !== null) {
              state.note.textContent = state.error.library ? label('error.library') : label('error.render');
            }
          }
        }

        function dispose() {
          disposed = true;
          if (observer !== null) observer.disconnect();
          observer = null;
          if (sweepTimer !== 0) clearTimeout(sweepTimer);
          sweepTimer = 0;
          for (const state of [...live]) teardown(state);
          cache.clear();
          styleTag.remove();
          const asset = document.querySelector(`script[data-plugin-asset="${NS}"]`);
          if (asset !== null) asset.remove();
        }

        ctx.effect(() => dispose, 'chat-mermaid: DOM and timers');

        ctx.on('theme/change', (snapshot) => {
          const next = snapshot.active.colorScheme;
          if (next === scheme) return;
          scheme = next;
          cache.clear();
          if (api !== null) initialize();
          for (const state of live) {
            state.svg = null;
            state.status = 'idle';
            state.key = null;
            state.error = null;
            clearNote(state);
          }
          scheduleSweep(0);
        });

        ctx.on('locale/change', () => refreshLabels());

        sweep();
        observer = new MutationObserver(() => scheduleSweep(SWEEP_DELAY));
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      },
    };
  },
});
