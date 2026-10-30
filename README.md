# DSH Web Plugins

A small collection of plugins for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
Web UI. Each plugin is a self-contained bundle — a `package.json`, a
`cordis.patch.yml` that inserts its row into a profile, and a `client.js` that runs
in the page — with no build step and no npm dependencies.

These are personal plugins, shared as they are. They are not part of the Harness
and nothing here is required for it to work: install only the behaviour you want.

## Plugins

| Plugin | What it does |
| --- | --- |
| [chat-bidi](plugins/chat-bidi) | Gives every chat block, question-card option, sidebar label and document-preview block the text direction of its own content, so Persian (or any right-to-left language) reads and aligns correctly in an LTR UI. |
| [model-provider-label](plugins/model-provider-label) | Shows the selected model's provider as a tag beside its name in the composer's model selector. |
| [chat-mermaid](plugins/chat-mermaid) | Renders `mermaid` code fences in chat as diagrams, with a toggle back to the source and a safe fallback when a diagram cannot be parsed. |
| [session-delete](plugins/session-delete) | Adds **Delete session** to the sidebar's session menu and removes the session's log and projection from disk. |
| [avalai-credit](plugins/avalai-credit) | Shows the remaining AvalAI package credit and main balance above the message composer. |
| [token-cost](plugins/token-cost) | Adds US-dollar and toman cost lines to the token-usage popover, priced from AvalAI's public rates. |

Each directory has its own README covering what the plugin does, how it works, and
its known limits; screenshots live in the same directory.

## Requirements

- A DeepSeek Harness install with the **Web** profile (`dsh web`). Every plugin
  here is web-only (`platform: "web"`) and does nothing in the TUI or headless
  profiles.
- DSH `0.2.1-rc.5` or a later `0.2.x` release — what these plugins were written and
  tested against, and what each `package.json` declares in `engines.dsh`.
- [avalai-credit](plugins/avalai-credit) and [token-cost](plugins/token-cost) read
  AvalAI endpoints and need an AvalAI provider configured in the profile. Without
  an AvalAI account they are of no use; skip them.
- [chat-mermaid](plugins/chat-mermaid) ships Mermaid 11.17.2 (MIT) in `vendor/`,
  which is why that package is a few megabytes. It is the most optional plugin of
  the set: most conversations have no diagrams.

## Install

Clone the repository once, somewhere the checkout can stay:

```bash
git clone https://github.com/m-hosseinpour/dsh-web-plugins.git
```

Then, for each plugin you want, open **Plugins** in the DSH Web sidebar, choose
**Add plugin**, paste the absolute path to that plugin's directory, and choose
**Install**. The field requires an absolute path and does not expand `~`, so give
the path in full:

```
/path/to/dsh-web-plugins/plugins/chat-bidi
```

An agent running in Creator mode can install the same thing through the plugin
manager tool:

```
plugin_manager install_bundle target=/path/to/dsh-web-plugins/plugins/chat-bidi
```

Installation adds the directory to the `web` profile as a `link:` dependency; the
files are not copied. Two consequences:

- keep the checkout where it is — moving or renaming it breaks the link, and the
  plugin has to be installed again from the new path;
- a page reload is enough to pick up an edited `client.js`, while an edited
  `index.js` needs the plugin row toggled off and on (or the Harness restarted).

Installed plugins can be switched off from the same **Plugins** page without
uninstalling them.

## Compatibility

The plugins extend the host rather than modifying it, but they do so through
internals: declared slots, `data-slot` attributes, CSS-module class names and
server-side services. A Harness release that renames any of those can break a
plugin, and the plugin's README records which host surfaces it depends on. If one
stops working after an upgrade, switch it off and open an issue with the DSH
version.

`engines.dsh` states the range each plugin was tested against. Installing outside
that range is possible with an explicit version exemption in DSH, but it is not
tested.

## Security

A DSH plugin is code, not configuration. The Host half (`index.js`) runs in the
Harness process with your user's permissions; the Client half (`client.js`) runs in
the Web page and can read the DOM, including your conversations. Read a plugin
before installing it, exactly as you would any other package.

What these six do with that access:

- **Network:** [avalai-credit](plugins/avalai-credit) asks `api.avalai.ir` for the
  account's credit, using the key from the Harness credential store; the key is
  never sent to the browser. [token-cost](plugins/token-cost) reads AvalAI's public
  model catalog through the Host and the public exchange rate from the browser.
  [chat-mermaid](plugins/chat-mermaid) serves its own vendored file from the Host.
  Nothing else calls out, and none of the plugins collects telemetry.
- **Disk:** [session-delete](plugins/session-delete) deletes session logs and
  projection caches under `DSH_HOME` — permanently, with no trash — and records the
  deletion there so a resident agent cannot bring the session back. Everything else
  only reads.
- **Page:** [chat-bidi](plugins/chat-bidi) adds direction attributes and alignment
  styles, [model-provider-label](plugins/model-provider-label) adds a provider tag to
  the model button, and [token-cost](plugins/token-cost) appends its two rows inside
  the token-usage popover. None of them touches a React-owned child node.

## Repository layout

```
plugins/<name>/
├── package.json        name, version, engines.dsh, dsh.bundle.patch, dsh.client
├── index.js            Host half — runs in the DSH process
├── client.js           Client half — runs in the Web page
├── cordis.patch.yml    inserts the plugin row into the profile
├── locale/en.json      Plugin Manager title and description (en, fa)
├── locale/fa.json
├── icon.svg            artwork in the Plugins list
├── docs/               screenshots used by the README, where present
└── README.md

scripts/validate.mjs
.github/workflows/validate.yml
```

The directory name is not load-bearing; the names that must agree are the package
name, the `name` of the row in `cordis.patch.yml`, and the `id` passed to
`window.__ModuleLoader__.load` in `client.js`. `scripts/validate.mjs` checks those
three, the manifest fields, the locale files, and the screenshot links.

## Development

No dependencies and no build step: edit a file and reload. To try a change without
touching a profile, point **Add plugin** at your working copy — installation links
the directory, so edits are live immediately.

```bash
node scripts/validate.mjs                    # manifests, patch rows, module ids
find plugins -name '*.js' -print0 | xargs -0 -n1 node --check   # syntax
```

When adding a plugin, follow the same shape: one directory under `plugins/`, one
patch row whose `name` equals the package name, a Client module registered under
that same id, an `engines.dsh` range, and a README with its known limits. Add the
plugin to the table above — the validator checks that this README links it.

## License

[MIT](LICENSE) © 2026 Mahdi Hosseinpour.

[chat-mermaid](plugins/chat-mermaid) bundles Mermaid 11.17.2, which is MIT-licensed;
its license and notice are in
[`plugins/chat-mermaid/vendor/`](plugins/chat-mermaid/vendor).

These plugins are community work, not affiliated with or endorsed by DeepSeek.
