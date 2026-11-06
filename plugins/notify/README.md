# dsh-notify

A desktop notification and a short sound for the moments a Session actually needs
a person: the turn finished, a decision is waiting, or the turn died. Everything
else stays silent.

This is a **Host-only** bundle — there is no `client.js` and no `dsh.client`
entry. It listens to Host events and talks to the desktop's notification server
over D-Bus, so it works in any profile (`web`, `tui`, `headless`) on a Linux
desktop.

## States

| State | Trigger | Notification |
| --- | --- | --- |
| ✅ finished | `agent/status` → idle, `turn/end` = `completed`, and nothing else runs for the Session | `task-complete`, `low`, 4 s, `complete.oga` |
| 🔐 needs permission | `approval/request` — only when the session policy actually asks | `dialog-password`, `normal`, stays, `message-new-instant.oga` |
| ❓ needs an answer | `user-questions/request` (the in-chat question card) | `dialog-question`, `normal`, stays, `message-new-instant.oga` |
| 💥 API error | `turn/end` = `error` | `dialog-error`, `critical`, stays, `dialog-error.ogg` |
| ⚠️ token limit | `turn/end` = `max-tokens` | `dialog-warning`, `normal`, stays, `message-new-instant.oga` |

The body is the project folder (the Session's `cwd` basename), the Session title
when one exists, and one line of detail for the pending or failed state.

"Stays" is an `expire` of 0 (`-t 0` in the `notify-send` fallback): the card does
not expire on its own and waits to be dismissed. It is separate from urgency, so
a 🔐 card can be `normal` and still persist, and a ✅ card can be `low` and still
disappear after four seconds.

## What stays silent

- **Background work still running.** A turn that started a background job, a
  subagent or a schedule before closing is not the end of the work.
- **A turn the human cancelled** (`turn/end` = `aborted`, whatever the cause) —
  the person who pressed Stop is at the keyboard.
- **Subagent Sessions.** Only a root Session (`delegationDepth === 0`) announces
  completions; the parent's turn reports the outcome. Approval requests are the
  exception: they block an agent at any depth, so they always notify, with the
  Subagent's own project folder in the body.
- **`blocked`, `interrupted` and `forked` turns** — a pre-step gate rejection, a
  crash-orphaned turn closed on resume, and a fork boundary, none of which is
  news.

## How it decides

Two Host facts replace the guessing a hook has to do:

1. **Why the turn closed** is `turn/end` in the Session's own log. The plugin
   subscribes to `session/event` and keeps the last reason per Session, then
   consumes it on the next `agent/status` → idle. A failed turn is therefore
   reported as a failure, not as "finished", without reading transcripts.
2. **Whether the Session still runs something** is the
   `workspace/session-activity` waterfall — the same question the Workspace
   registry asks before archiving a Session. It answers with the Session's
   `job`s (background jobs), `subagent` descendants and `schedule`s. The `turn`
   family is absent by the time the Agent is idle, so an empty or missing list
   really means nothing is left.

Only when both agree — a clean turn and an empty activity list — does the ✅
notification fire. If the activity list cannot be read, the turn ends silently
rather than claiming a false "finished".

## Delivery

`notify-send` from libnotify:

```
notify-send -a DSH -i <icon> -u <urgency> -t <expire> -- <title> <body>
```

Sound is played by the first of `paplay`, `pw-play`, `ffplay` found on `PATH`,
in the background, killed after four seconds. `notify-send` is killed after five.
Both are best-effort: a missing daemon or player logs one warning and never
reaches the agent loop.

A launcher or a service manager can start the Host without a session bus. When
`DBUS_SESSION_BUS_ADDRESS` or `XDG_RUNTIME_DIR` is missing, they are filled from
`/run/user/<uid>/` if that path exists — `notify-send` needs only the bus, and
the players need only the runtime directory.

A click on the card does nothing. A focus-on-click action was implemented and
then dropped: this Plasma advertises the `actions` capability, but libnotify
0.8.8 refuses to attach an action to a notification from it ("Actions are not
supported by this notifications server"), and raising an existing window needs a
window-manager hook of its own (KWin scripting, `wmctrl`, `kdotool`) — more
moving parts than a notification is worth.

## Install

Requires DSH `^0.2.1-rc.5`. From this repository's checkout, open **Plugins** in
the DSH Web sidebar, choose **Add plugin**, paste the absolute path to this
directory (`plugins/notify`), and choose **Install**.

Or, from an agent in Creator mode:

```
plugin_manager install_bundle target=<absolute path>/plugins/notify
```

The profile links the directory instead of copying it; moving it breaks the link.
Unlike the web plugins, an edited `index.js` is Host code — toggle the row off
and on (or restart the Harness) to load it.

## Configuration

The bundle row in `cordis.patch.yml` accepts:

| Key | Default | Meaning |
| --- | --- | --- |
| `desktop` | `true` | Send the desktop notification |
| `sound` | `true` | Play the sound |
| `appName` | `DSH` | The application name the daemon shows |
| `soundComplete` | `/usr/share/sounds/freedesktop/stereo/complete.oga` | ✅ sound |
| `soundAttention` | `/usr/share/sounds/freedesktop/stereo/message-new-instant.oga` | 🔐, ❓ and ⚠️ sound |
| `soundError` | `/usr/share/sounds/oxygen/stereo/dialog-error.ogg` | 💥 sound |
| `notifyFinished` | `true` | Enable the ✅ state |
| `notifyPermission` | `true` | Enable the 🔐 state |
| `notifyQuestion` | `true` | Enable the ❓ state |
| `notifyError` | `true` | Enable the 💥 state |
| `notifyTokenLimit` | `true` | Enable the ⚠️ state |

The plugin merges these over its own defaults, so a partial override is fine.

## Platform support

**Linux only.** The notification protocol, the icon names and the sound files
are freedesktop things; macOS and Windows have no `notify-send` and no
`org.freedesktop.Notifications`. A Host on a server notifies that server, which
usually has no desktop at all — set `desktop: false` and `sound: false` there,
or skip the plugin.

Tested on **KDE Plasma 6.6** (X11). What is KDE-specific:

- The icon names (`task-complete`, `dialog-password`, …) and the error sound
  `/usr/share/sounds/oxygen/…` come from KDE's theme and sound packages. On
  GNOME the notification still appears, but a missing icon or sound file only
  silences that part of that state.
- `-t 0` ("stay until dismissed") is up to the daemon; Plasma honours it.

The freedesktop sounds ship with `sound-theme-freedesktop` on Debian/Ubuntu; the
error sound comes from `oxygen-sounds` on KDE. One of `paplay`, `pw-play` or
`ffplay` is required for any sound.

No suppression while the page is focused: unlike a browser tab, the Host cannot
tell what the person is looking at, so it always notifies. A second copy of the
same rule (for example the old Claude Code hook) doubles every notification;
keep one.

## Layout

| File | Role |
| --- | --- |
| `index.js` | Host half: turn-reason tracking, activity check, `notify-send` and player spawning. |
| `cordis.patch.yml` | Inserts the `notify` row, with the defaults above. |
| `locale/*.json` | Plugins-page title and description (en, fa). |
| `icon.svg` | Artwork in the Plugins list. |

`index.js` is the whole plugin: no Client half, no build step, no dependencies.
