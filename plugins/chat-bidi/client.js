window.__ModuleLoader__.load({
  id: 'dsh-chat-bidi',
  factory() {
    /* Chat renders message text with an LTR base direction, so a Persian block is
     * reordered by the bidi algorithm yet stays left-aligned and keeps its list
     * marker on the left. Each block instead gets the base direction of its own
     * words, ignoring inline code: a Persian sentence that starts with
     * `~/.config/...` is still a Persian sentence.
     *
     * Code spans and blocks get an explicit LTR direction of their own. The `dir`
     * attribute also makes Chromium isolate them, which is what stops a path that
     * begins with `~/.` from being reordered inside surrounding RTL text.
     *
     * The question card the agent asks with is a second surface: it sits outside
     * chat rows, pins its option buttons to `text-align: left`, and lays each
     * option out as a flex row, so it needs the start-alignment pinned alongside.
     *
     * The sidebar's session and workspace labels are a third surface. A title
     * there is a clipping one-line cell, so its own direction decides which edge
     * the ellipsis lands on and which side the text hugs; the hover card's full
     * title and the session search field follow the same rule. The composer needs
     * nothing: Lexical already emits `dir="auto"` paragraphs.
     *
     * The document preview in the right sidebar is a fourth surface. Rendered
     * Markdown gets the same block treatment as chat; a plain-text preview, whose
     * lines are preformatted, decides each line on its own. A code preview stays
     * LTR like a code block, and previews the page owns elsewhere — the HTML
     * iframe, PDF and Office renderings — are out of reach. */
    const CHAT_NODE = '[data-slot="conversation.chat.node"]';
    const QUESTION_CARD = '[data-question-key]';
    const QUESTION_TEXT = '[role="radio"], [role="checkbox"], header > div';
    const ANSWER_FIELD = 'textarea';
    const ROWS = `${CHAT_NODE}, ${QUESTION_CARD}`;
    const USER_TEXT = '[data-slot="conversation.user.text.node"]';
    const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,figcaption,table,ul,ol';
    /* A table is decided once, on the table element, and its cells inherit it:
     * per-cell directions let a column's header and body disagree on their edge,
     * and leave the column order LTR in an RTL table. Cells are therefore absent
     * from BLOCKS on purpose. */
    const CODE = 'pre,code,kbd,samp';
    /* Sidebar labels have no slot of their own: the row key scopes the tree row,
     * and the CSS-module local names (hash-prefixed) are the only hooks left. */
    const SIDEBAR_LABEL = '[data-row-key] [class*="_title"], [class*="_hoverTitle"], [class*="_searchResultTitle"], [class*="_searchResultWorkspace"]';
    const SIDEBAR_FIELD = '[data-slot="sidebar.workspaces"] input[type="text"]';
    /* The preview frame wraps every document implementation; the body markers
     * inside it pick out the ones made of prose. */
    const PREVIEW = '[data-document-preview]';
    const PLAIN_TEXT = '[data-textpreview-plain]';
    const LINES = '[data-textpreview-line]';

    const LETTER = /\p{L}/u;
    const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}]/u;

    /* Ownership of every `dir` attribute the plugin writes; a dir the page set
     * itself is never claimed and is therefore left alone. */
    let owned = new WeakSet();
    const pinned = new WeakSet();

    function readDirection(el) {
      let first = null;
      let codeFirst = null;
      const words = { rtl: 0, ltr: 0 };
      let word = { rtl: 0, ltr: 0, first: null };
      const endWord = () => {
        if (word.first === null) return;
        const side = word.rtl === word.ltr ? word.first : word.rtl > word.ltr ? 'rtl' : 'ltr';
        words[side] += 1;
        word = { rtl: 0, ltr: 0, first: null };
      };
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) !== null) {
        const inCode = node.parentElement !== null && node.parentElement.closest(CODE) !== null;
        /* A code span always ends the prose word it interrupts, and its own
         * letters only matter when the block has no prose at all. */
        if (inCode) {
          endWord();
          for (const character of node.nodeValue) {
            if (!LETTER.test(character)) continue;
            if (codeFirst === null) codeFirst = RTL_LETTER.test(character) ? 'rtl' : 'ltr';
          }
          continue;
        }
        for (const character of node.nodeValue) {
          if (!LETTER.test(character)) {
            /* A space ends a word; punctuation inside one does not, so an
             * identifier such as `finishing-a-development-branch` stays one. */
            if (/\s/.test(character)) endWord();
            continue;
          }
          const direction = RTL_LETTER.test(character) ? 'rtl' : 'ltr';
          if (first === null) first = direction;
          if (word.first === null) word.first = direction;
          word[direction] += 1;
        }
      }
      endWord();
      if (first === null) return codeFirst;
      if (words.rtl === words.ltr) return first;
      /* Majority of words, not of letters: "آیا اسکیل `using-git-worktrees`
       * مستقل از `finishing-a-development-branch` هست؟" is a Persian question,
       * but its two long identifiers hold more letters than its five Persian
       * words and counted as a Latin majority — which laid the bubble out LTR,
       * left-aligned, and reordered the Persian words beside them. Counting a
       * whole identifier as one word keeps the prose in charge. */
      return words.rtl > words.ltr ? 'rtl' : 'ltr';
    }

    /** A table's column labels decide its side; long mixed body values would outvote them. */
    function directionOf(el) {
      if (el.tagName !== 'TABLE') return readDirection(el);
      const head = el.tHead;
      return (head === null ? null : readDirection(head)) ?? readDirection(el);
    }

    /** Give one block the base direction of its own text; an authored dir wins. */
    function applyDirection(el) {
      if (el === null || el === undefined) return;
      if (el.hasAttribute('dir') && !owned.has(el)) return;
      const direction = directionOf(el);
      if (direction === null) {
        if (owned.has(el)) el.removeAttribute('dir');
        return;
      }
      if (el.getAttribute('dir') !== direction) el.setAttribute('dir', direction);
      owned.add(el);
    }

    function applyCodeDirection(el) {
      if (el === null || el === undefined) return;
      if (el.hasAttribute('dir') && !owned.has(el)) return;
      if (el.getAttribute('dir') !== 'ltr') el.setAttribute('dir', 'ltr');
      owned.add(el);
    }

    /** The block whose line boxes contain an inline run (skips display:contents wrappers). */
    function blockOf(run) {
      let el = run.parentElement;
      while (el !== null && getComputedStyle(el).display === 'contents') {
        if (el.matches(ROWS)) return null;
        el = el.parentElement;
      }
      return el;
    }

    /** The question card pins `text-align: left`, which `dir` alone cannot flip. */
    function applyQuestionText(el) {
      applyDirection(el);
      if (el.getAttribute('dir') === 'rtl') {
        if (el.style.textAlign !== 'start') {
          el.style.textAlign = 'start';
          pinned.add(el);
        }
      } else if (pinned.has(el)) {
        el.style.removeProperty('text-align');
        pinned.delete(el);
      }
    }

    /** An empty field keeps the English placeholder; typed Persian flips it. */
    function applyAutoDirection(el) {
      if (el.hasAttribute('dir') && !owned.has(el)) return;
      if (el.getAttribute('dir') !== 'auto') el.setAttribute('dir', 'auto');
      owned.add(el);
    }

    /** The free-text answer box: a plain textarea plus its sizing mirror. */
    function applyAnswerField(field) {
      applyAutoDirection(field);
      const mirror = field.previousElementSibling;
      if (mirror !== null && mirror.getAttribute('aria-hidden') === 'true') applyAutoDirection(mirror);
    }

    function applyRow(root) {
      if (root.matches(BLOCKS) && root.closest('pre') === null) applyDirection(root);
      for (const block of root.querySelectorAll(BLOCKS)) {
        if (block.closest('pre') === null) applyDirection(block);
      }
      if (root.matches(CODE)) applyCodeDirection(root);
      for (const code of root.querySelectorAll(CODE)) applyCodeDirection(code);
      if (root.matches(USER_TEXT)) applyDirection(blockOf(root));
      for (const run of root.querySelectorAll(USER_TEXT)) applyDirection(blockOf(run));
      if (root.closest(QUESTION_CARD) === null) return;
      if (root.matches(QUESTION_TEXT)) applyQuestionText(root);
      for (const text of root.querySelectorAll(QUESTION_TEXT)) applyQuestionText(text);
      if (root.matches(ANSWER_FIELD)) applyAnswerField(root);
      for (const field of root.querySelectorAll(ANSWER_FIELD)) applyAnswerField(field);
    }

    /** Sidebar labels and the session search field, outside every chat row. */
    function applySidebar(root) {
      if (root.matches(SIDEBAR_LABEL)) applyDirection(root);
      for (const label of root.querySelectorAll(SIDEBAR_LABEL)) applyDirection(label);
      if (root.matches(SIDEBAR_FIELD)) applyAutoDirection(root);
      for (const field of root.querySelectorAll(SIDEBAR_FIELD)) applyAutoDirection(field);
    }

    /* A plain-text preview's page element is a `pre` too, so the code rule skips
     * it: its lines carry their own direction instead. */
    function applyPreview(root) {
      if (root.matches(BLOCKS) && root.closest('pre') === null) applyDirection(root);
      for (const block of root.querySelectorAll(BLOCKS)) {
        if (block.closest('pre') === null) applyDirection(block);
      }
      if (root.matches(CODE) && root.closest(PLAIN_TEXT) === null) applyCodeDirection(root);
      for (const code of root.querySelectorAll(CODE)) {
        if (code.closest(PLAIN_TEXT) === null) applyCodeDirection(code);
      }
      if (root.matches(LINES)) applyDirection(root);
      for (const line of root.querySelectorAll(LINES)) applyDirection(line);
    }

    function applySubtree(root) {
      if (!(root instanceof Element)) return;
      if (root.closest(ROWS) !== null) {
        applyRow(root);
        return;
      }
      if (root.closest(PREVIEW) !== null) {
        applyPreview(root);
        return;
      }
      for (const row of root.querySelectorAll(ROWS)) applyRow(row);
      for (const preview of root.querySelectorAll(PREVIEW)) applyPreview(preview);
      applySidebar(root);
    }

    /** The block a changed or inserted text belongs to, inside a user bubble too. */
    function blockFor(node) {
      const block = node.parentElement?.closest(BLOCKS);
      if (block !== undefined && block !== null) return block;
      const run = node.parentElement?.closest(USER_TEXT);
      return run !== undefined && run !== null ? blockOf(run) : null;
    }

    /** The element a changed or inserted node must re-evaluate, on either surface. */
    function editableFor(node) {
      const element = node instanceof Element ? node : node.parentElement;
      if (element === null || element === undefined) return null;
      if (element.closest(ROWS) !== null) return blockFor(node);
      if (element.closest(PREVIEW) !== null) return previewEditableFor(element);
      return element.closest(SIDEBAR_LABEL);
    }

    /** A changed node inside a preview re-evaluates its text line or prose block. */
    function previewEditableFor(element) {
      const line = element.closest(LINES);
      if (line !== null) return line;
      const block = element.closest(BLOCKS);
      return block !== null && block.closest('pre') === null ? block : null;
    }

    const targets = new Set();
    const edits = new Set();
    let frame = 0;

    function flush() {
      frame = 0;
      for (const block of edits) if (block.isConnected) applyDirection(block);
      edits.clear();
      for (const root of targets) if (root.isConnected) applySubtree(root);
      targets.clear();
    }

    function schedule() {
      if (frame === 0) frame = requestAnimationFrame(flush);
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) targets.add(node);
          // Text, or an element that changes a block's or label's first strong letter.
          const added = editableFor(node);
          if (added !== null) edits.add(added);
        }
        if (record.removedNodes.length > 0) {
          const removed = editableFor(record.target);
          if (removed !== null) edits.add(removed);
        }
        if (record.type !== 'characterData') continue;
        const block = editableFor(record.target);
        if (block !== null) edits.add(block);
      }
      if (targets.size > 0 || edits.size > 0) schedule();
    });

    function dispose() {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      targets.clear();
      edits.clear();
      for (const el of document.querySelectorAll('[dir]')) {
        if (owned.has(el)) el.removeAttribute('dir');
      }
      for (const el of document.querySelectorAll('[style*="text-align"]')) {
        if (!pinned.has(el)) continue;
        el.style.removeProperty('text-align');
        if (el.getAttribute('style') === '') el.removeAttribute('style');
      }
      owned = new WeakSet();
    }

    return {
      apply(ctx) {
        applySubtree(document.documentElement);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        ctx.effect(() => dispose);
      },
    };
  },
});
