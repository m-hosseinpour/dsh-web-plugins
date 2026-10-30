# dsh-avalai-credit

Shows what is left on the AvalAI account in a strip **above the message
composer** (`conversation.input.dock`, the same seat the goal bar uses):

- one chip per package the account holds, with its remaining amount and the
  remaining time (`1.5d`, `7h`, `40m` — days keep one decimal, anything under a
  day is stated in hours, under an hour in minutes);
- the main balance at the trailing edge;
- a refresh button, and the account and read age on the strip's icon.

Hovering a chip names the package, the bought amount, and the time left. A
package that can no longer pay stays visible, dimmed, because the money in it
was real.

It reports and does nothing else: no threshold below which a balance counts as
running out, no colour that judges one amount against another, and no advice on
what or when to buy. That constraint comes from the `credit` skill and is
deliberate.

## Which account it reads

A profile can hold several AvalAI providers, one per account, each with its own
key. The strip follows the account of the provider **the current Session is
using**, so two Sessions on two accounts show their own numbers:

1. The Client passes its Session id (`?session=<id>`).
2. The Host reads that Session's `modelSelection` projection (`pending`, else
   `lastUsed`) and takes its `provider`; a Session with no selection yet falls
   back to `ctx.agentDefaultModel.currentSelection()`.
3. That provider's profile is read from the loaded configuration
   (`ctx.configEditor.configuration()`, both layers merged per provider), which
   names its `apiKeyEnv` and `baseURL`.
4. `ctx.credentials.resolve(ref)` reads the key from the harness credential
   store (`$DSH_HOME/.credentials.yaml`, then the process environment), so a
   key saved through the Models page works unchanged.

No per-account mapping is configured here: adding a provider to the profile is
enough. When the resolved provider is not an AvalAI host (`config.hosts`), the
route answers `applicable: false` and the strip renders nothing rather than
reporting a failed read about money that provider never had.

## The route

The browser never sees the API key. The Host half owns the request: it calls
`GET <origin>/user/v1/credit`, normalizes the answer, keeps it per account for
`cacheSeconds`, and serves it at `GET /plugin/avalai-credit/summary`, admitted
through `ctx.connection.admit()` for the `owner` principal only.

The credit route is an origin-level route, not one under the provider's API
version, so it is not built by appending to `baseURL` verbatim. The trailing
version segment (`/v1`, `/v1beta`) of the provider's base URL is dropped first:
`https://api.avalai.ir/v1` and `https://api.avalai.ir` both resolve to
`https://api.avalai.ir/user/v1/credit`, and a base URL with a path prefix keeps
that prefix. Appending to the raw base URL produced `…/v1/user/v1/credit`, which
the edge answers 404 — the strip then said "provider answered 404" about an
account that was in fact fine.

A failed read is remembered for two minutes, so the polling bar cannot pay the
timeout on every tick while the provider is down; a failure with a previous
answer behind it serves that answer marked stale.

A Session the Host has not materialized yet is answered `pending`, and the
Client asks again a moment later — never with another account's numbers. A
provider whose profile does not name its own `baseURL` and `apiKeyEnv` is
answered `applicable: false`, for the same reason: silence beats a
plausible-looking wrong account.

Only `remaining_irt` fields are used. `remaining_unit` and `total_unit` are not
the toman figures under any single conversion, so they are ignored.

## States

The summary carries one of four states, and none of them is ranked:

| state | meaning |
|---|---|
| `package` | a package still has money in it |
| `main` | no package is left; the main balance is paying |
| `empty` | neither is left |
| `unknown` | a field could not be read, so no verdict is given |

`unknown` is separate from `empty` on purpose: an unread balance shows `—`, not
`0`. Provider failures travel as codes (`timeout`, `http-401`, …) that the
Client localizes, and the route's own failures are never shown as an amount.

## Configuration

The `avalai-credit` row accepts:

| Key | Default | Meaning |
|---|---|---|
| `credentialRef` | `AVAL_AI_API_KEY` | Key reference for the no-provider case; a named provider always uses its own. |
| `baseURL` | `https://api.avalai.ir` | Origin for the no-provider case; a named provider always uses its own. |
| `hosts` | `["api.avalai.ir"]` | Hosts whose credit this strip reports. A provider resolving elsewhere is skipped. |
| `cacheSeconds` | `60` | How long one reading is reused (per account). |
| `timeoutSeconds` | `12` | Hard limit on one provider request. |

Cache and retry state are kept per credential reference and endpoint, so two
accounts never read each other's numbers.

## Install

Requires DSH `^0.2.1-rc.5` on the `web` profile, with an AvalAI provider configured
in the profile (Models page) and its key in the credential store. From this
repository's checkout, open **Plugins** in the DSH Web sidebar, choose
**Add plugin**, paste the absolute path to this directory
(`plugins/avalai-credit`), and choose **Install**.

Or, from an agent in Creator mode:

```
plugin_manager install_bundle target=<absolute path>/plugins/avalai-credit
```

The profile links the directory instead of copying it. A Host edit needs the row
toggled off and on (or the Harness restarted); a page reload only picks up
`client.js`.

## Layout

| File | Role |
|---|---|
| `index.js` | Host half: Session → provider → account, credential lookup, provider fetch, per-account cache, authenticated route. |
| `client.js` | Client half: the `conversation.input.dock` strip and its polling. |
| `cordis.patch.yml` | Inserts the `avalai-credit` Host row and its config. |
| `locale/*.json` | Plugin Manager title/description (en, fa). |

The Client polls once a minute and when the tab becomes visible again, refetches
when the Session changes, and refetches immediately from the refresh button. The
result is read-only: nothing here buys a package or changes the account.

Editing this package needs the `include:avalai-credit` row toggled off and on
(Plugin Manager, or the Harness restarted): Node caches the Host module by path,
so a page reload alone serves fresh Client code but keeps the old Host code.
