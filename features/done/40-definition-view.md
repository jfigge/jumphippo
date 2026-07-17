# Feature 40 — Definition view (UI)

## Context
The engine (20), stats (30), and store (10) are all reachable over `window.jumphippo.*`,
but the only UI so far is Feature 00's empty two-view shell. This stage builds the first
real view: **Definition** — where the user creates and edits tunnel definitions, including
the auth picker and the jump-host chain builder — and fleshes out the **single-page,
two-view** shell that hosts both this and the Monitoring view (Feature 50). It follows
Rest Hippo's renderer conventions to the letter: no framework, class-based ES-module
components, `PopupManager` for dialogs, design tokens in `theme.css`, and the
`prefix-name` / `block--modifier` class-naming rule.

## Goal
A Definition view listing all tunnel definitions with an editor form for each — local
port + bind host, destination host/port, SSH server (host/port/user/auth), an ordered
**jump-host chain** builder, linger/keep-alive options — with inline validation, create/
edit/delete/reorder, an **arm/disarm** toggle per tunnel, and a warning when a definition
binds beyond loopback. The two-view shell (toggle + optional split) is finalized here.

## Design decisions (settled — do not relitigate)
- **Single page, two views, user-flippable, split-capable.** A top-level app shell owns a
  view mode: `definition`, `monitoring`, or `split` (both side-by-side). A header toggle
  switches modes; the choice persists in settings. This stage builds the shell + the
  Definition pane; Feature 50 fills the Monitoring pane. In `split` mode both render; the
  shell just lays them out (CSS grid) — the panes are independent components.
- **Component structure mirrors Rest Hippo.** `app.js` bootstraps and mounts top-level
  panels; each view is a class-based component under `src/web/scripts/components/`
  (`definition-view.js`, plus `tunnel-editor.js`, `jump-host-editor.js`,
  `auth-editor.js`). Widgets report to their parent via **constructor callbacks**;
  app-wide changes go out as **`jumphippo:*` events**.
- **The editor is form-first, not modal-first.** Editing a definition happens in an inline
  editor pane (master-list on the left, editor on the right) rather than a popup, because
  definitions are dense (chain + auth). `PopupManager` is still used for confirmations
  (delete), the host-key trust prompt, and any pickers.
- **Auth picker is a discriminated-union editor.** A per-hop control choosing `agent` /
  `key` / `password`, revealing only the relevant fields (key path + Browse + optional
  passphrase; or password). Secrets are **write-only**: the field shows "•••• set"
  (from `hasSecret`) and only sends a new value when the user types one — it never reads
  the stored secret back (Feature 10 doesn't expose it).
- **Jump-host builder is an ordered, add/remove/reorder list**, each row an SSH-server
  editor (host/port/user/auth) identical in shape to the terminating server. Zero rows =
  direct connection. Order is the hop order.
- **Loopback-exposure guard.** If `bindHost` is set to anything other than `127.0.0.1`/
  `localhost`, show a persistent inline warning ("reachable by other machines on your
  network") — an explicit, acknowledged choice, per the security posture.
- **Arm from the Definition view too.** Each definition row has an arm/disarm toggle
  (calls `tunnels.arm/disarm`), reflecting live `jumphippo:tunnel-state`, so the user can
  define-and-run without leaving the view.
- **File Browse is native.** The key-file picker uses a main-process native dialog IPC
  (renderer is sandboxed and can't read a typed path directly), mirroring Rest Hippo's
  import Browse pattern.

## Implementation steps
1. **App shell / layout.** In `app.js`, build the header (app title, view-mode toggle
   Definition | Monitoring | Split) and a content area that mounts the Definition pane and
   (from Feature 50) the Monitoring pane. Persist `viewMode` via `settings-store`. Add
   `src/web/styles/components.css` for component styles; extend `theme.css` tokens as
   needed. Emit `jumphippo:view-changed` on toggle.
2. **`definition-view.js`.** Master list of definitions (name, local port → destination
   summary, state badge, arm toggle, add/delete/reorder controls) + an editor region. Loads
   via `window.jumphippo.tunnels.list()`; refreshes on `jumphippo:tunnels-changed`.
3. **`tunnel-editor.js`.** The editor form: name, `localPort`, `bindHost` (with the
   loopback-exposure guard), destination host/port, the SSH-server sub-editor, the jump-host
   list, `lingerMs`, `keepAlive`. Save calls `tunnels.create`/`update`; surfaces
   `validateDefinition` field errors inline (Feature 10). Cancel/dirty handling.
4. **`auth-editor.js`.** Reusable per-hop auth control (type select + conditional fields +
   native Browse for key path + write-only secret fields). Emits its value up via callback.
5. **`jump-host-editor.js`.** Ordered list of SSH-server sub-editors (reusing the same
   host/port/user + `auth-editor`), with add/remove/reorder. Emits the `jumps[]` array up.
6. **Arm/disarm + state reflection.** Wire the per-row toggle to `tunnels.arm/disarm`;
   subscribe to `jumphippo:tunnel-state` to render live badges (listening/connecting/
   connected/paused/error) with an error tooltip.
7. **Host-key trust prompt.** Listen for `jumphippo:hostkey-unknown` and show a
   `PopupManager` confirm ("Trust the host key for `<host>`? fingerprint `<fp>`") wired to
   `hostkeys.trust`/`reject`. Handle `jumphippo:hostkey-changed` with a stronger warning
   dialog.
8. **Native key-file picker IPC.** Add `dialog:openKeyFile` in main (returns a path) and
   `window.jumphippo.dialog.openKeyFile()` in preload; the auth editor's Browse uses it.
   Keep main/preload in lockstep.
9. **Delete confirmation** via `PopupManager.confirmDelete`, and reorder persisted through
   `tunnels.reorder`.
10. **Tests (jsdom).** Component render/interaction tests (Rest Hippo style) for
    `tunnel-editor` (renders fields, shows validation errors, builds the correct payload),
    `auth-editor` (type switching reveals/hides fields; secret stays write-only), and
    `jump-host-editor` (add/remove/reorder produces the right `jumps[]`). Add a
    `test-renderer` Make target; fold into `test`.
11. **License headers**; **i18n-ready strings** — route display text through a `t()` seam
    if Feature 60's i18n is already in; otherwise centralize strings in one module so the
    later i18n pass is mechanical (note this so 60 can wire it).

## Acceptance criteria
- The Definition view lists all definitions and lets the user create, edit, delete, and
  reorder them, persisting across restart.
- The editor validates inline (bad port, empty host, malformed auth) and builds a correct
  definition payload including an ordered jump-host chain and per-hop auth.
- Secrets are write-only in the UI: an existing password/passphrase shows as "set" and is
  only overwritten when the user types a new value.
- Setting `bindHost` beyond loopback shows the network-exposure warning.
- Arming a definition from the view starts the engine and the row badge reflects live
  state; an unknown host key raises the trust prompt and, once trusted, the tunnel proceeds.
- The view-mode toggle switches Definition / Monitoring / Split and persists.
- jsdom component tests pass; `make test` green; new files carry the license header.

## Constraints
- No framework; class-based ES modules + plain DOM. `PopupManager` for dialogs; design
  tokens in `theme.css`; class naming `prefix-name` / `block--modifier` (no bare state
  classes).
- Parent-owned widgets → constructor callbacks; app-wide changes → `jumphippo:*` events.
- The renderer never reads secrets or touches the filesystem/SSH directly — only
  `window.jumphippo.*`. Native file Browse goes through main.
- Keep main/preload in lockstep for the new dialog IPC.

## Verify
`make fmt && make lint && make test`, then `make debug`: create a definition with a
jump-host chain and a key-file auth (via Browse), save it, restart, and confirm it
persisted with the secret still masked. Trigger a validation error and confirm the inline
message. Set `bindHost` to `0.0.0.0` and confirm the warning. Arm the tunnel and confirm
the badge tracks state and (against a real host) the host-key trust prompt appears on first
connect. Toggle Definition / Monitoring / Split and confirm the layout and persistence.
