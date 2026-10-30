# dsh-session-delete

Adds **Delete session** to every Session's `...` menu in the sidebar, after the
shipped `Archive` row. A second click on the row (which turns red and reads
"Click again to delete forever") permanently removes the Session.

## What "delete" removes

The Harness only *archives* a Session: archiving is a durable hidden-set entry
and the log stays on disk. A plugin cannot call the Harness's generated RPCs, so
this package pairs a Client menu row with one authenticated `POST` route on the
Host:

- the Session's log directory under `<DSH_HOME>/sessions/<cwd-key>/<id>/` is
  removed for every cwd key that holds it;
- its projection cache file
  `<DSH_HOME>/storages/session_projcache/sessions/<id>.json` is removed;
- the id is added to the archive set (`workspaceRegistry.archiveSession` with
  `stopActivity`, which also drops its pin), because that set is the only
  durable hiding the sidebar honors;
- the Host emits `api-session/removed`, so a connected sidebar drops the row
  immediately instead of waiting for a reload.

The route is registered at `/plugin/session-delete/delete`, is admitted through
`ctx.connection.admit()`, and accepts only the `owner` principal.

## Why deleting a live Session used to come back

The sidebar list is `sessionQuery.listSessions()`: **persisted records ∪ live
in-memory Sessions** (`dsh-session-query`, `SessionCorpus.listSessions`). A
plugin cannot unload a Session whose Agent is resident — the disposer is a
capability the agent loop holds, and the controller discards it — so removing
only the log left the Session live and the host kept listing it after every
reload.

The archive entry is what fixes that: the sidebar filters archived Sessions out
of its default view on every load, and the archived gate rejects the Session's
next turn at `agent/pre-step`. So:

1. a running turn is cancelled and awaited up to 3 seconds;
2. if the Session is the one open in the main view, a new chat starts first so
   no composer can append to the removed log;
3. the files go, the archive entry hides the row, and the id is recorded in
   `<DSH_HOME>/storages/session-delete/deleted.json`.

A sweep at startup and every 15 seconds removes any log a still-resident Agent
recreates for a tombstoned id. It also keeps the archive entry asserted while
the Session is resident, and drops the leftover pin/archive ids (and with them
the ghost row) once the process no longer holds the Session — so after a Host
restart a deleted Session is gone entirely, with nothing left in
`workspace.json`.

## Install

Requires DSH `^0.2.1-rc.5` on the `web` profile. From this repository's checkout,
open **Plugins** in the DSH Web sidebar, choose **Add plugin**, paste the absolute
path to this directory (`plugins/session-delete`), and choose **Install**.

Or, from an agent in Creator mode:

```
plugin_manager install_bundle target=<absolute path>/plugins/session-delete
```

The profile links the directory instead of copying it; moving it breaks the link.

Deleting is permanent and has no undo: the Session's log is removed from disk, not
moved to a trash. Archive a Session instead when it only needs to disappear from
the sidebar.

## Layout

| File | Role |
|---|---|
| `index.js` | Host half: the route, the deletion, the tombstone sweep. |
| `client.js` | Client half: the `sidebar.workspaces.session.menu.item` row. |
| `cordis.patch.yml` | Inserts the `session-delete` Host row. |
| `locale/*.json` | Plugin Manager title/description (en, fa). |

`DSH_HOME` defaults to `~/.dsh`; the row accepts an optional
`config.sessionsDir` when a profile stores logs elsewhere.
