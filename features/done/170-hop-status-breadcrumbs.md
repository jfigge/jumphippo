# Feature 170 — Per-hop status in the route breadcrumb

## Status: Deferred (2026-07-16) — superseded by existing surfaces

Not planned for build. Per-hop status is largely redundant and mostly-idle:

- **Lazy connect** means the SSH chain is down almost all the time for `local`/
  `dynamic` tunnels, so a live per-hop breadcrumb shows nothing new in steady state
  (an armed-but-idle tunnel sits in `listening` with no hop connected).
- **The failing hop is already surfaced as text** — `hopError` (`ssh-chain.js`)
  produces `SSH jump[N] (host:port) failed: …`, shown via the errored State card /
  current-error popup and the error-history dialog.
- **Full per-hop ok/fail/skipped + reason already exists on demand** via Feature 100
  "Test resolution" (`probeChain` → the tunnel-editor probe rows), using the same
  host-key TOFU as arming.
- The plan **predates Feature 110** (remote/dynamic forwarding), so its node→status
  mapping only covers the `local` breadcrumb shape and would need reworking for three.

If per-hop-at-failure ever becomes desirable, the cheap paths are (B) cross only the
failing node on `error`, or (C) surface the existing Test-resolution probe from the
detail panel — not the full live wire protocol described below. The rest of this plan
is kept as the record of what a full build would entail.

## Context

Depends on: **20** (SSH tunnel engine — listener, `connectChain`, relay), **30** (stats +
`porthippo:tunnel-state` broadcast), **45** (the detail-panel breadcrumb), **100** (the
`probeChain` per-hop `{status, reason}` model it mirrors). No data-model change.

The `TunnelDetail` panel titles the selected tunnel with a **route breadcrumb** — the local
bind, each jump host, an optional SSH-server segment, and the target — rendered by
`#renderBreadcrumb()` as plain `route-seg` spans joined by `›` `route-sep` chevrons
(`tunnel-detail.js`). It is purely the *shape* of the route; it says nothing about whether any
hop is actually up.

Meanwhile the engine already knows, moment to moment, exactly which parts are live — it just
collapses them into one aggregate state. The signals exist at three seams:

- **Local node** — the `Listener` (`listener.js`) either bound (`listening`/`connecting`/
  `connected`) or failed (`#handleListenerError` → `error` with an `EADDRINUSE`/privileged-port
  message).
- **Each SSH hop** — `connectChain` walks `[...jumps, sshServer]` in order; `hopError` already
  reports *which* hop failed and why, as `SSH <label> (<host>:<port>) failed: <message>` —
  host/port but **no secret**.
- **Target service** — the relay's `forwardOut` to the destination: `onOpen` means the exit
  point reached the service, `onError` means it was refused/unreachable.

Every one of those points already calls `#emitState()`, so the broadcast *fires* at each
transition — it simply doesn't *carry* the per-hop detail. Feature 100's `probeChain` even
proves the shape is right: it returns `hops: [{ hopLabel, host, port, status, reason }]` +
a destination result for the on-demand "Test resolution". This feature brings that same
per-hop visibility to the **live** tunnel, in the breadcrumb, **accessibly**.

## Goal

Make each breadcrumb node show whether that hop is **up, down, connecting, or idle**, encoded
**by shape (an icon) as well as colour** so it is legible to colour-blind users — a tick to the
right of a connected node, a cross on a failed one, a faint "connecting" pulse mid-handshake,
nothing on an idle node. A **failed** node exposes its error on hover (`title`) and to assistive
tech (focusable + `aria-label`). The **chevron** between two nodes is tinted and iconified to
show the link between them (and, on a break, marks *where* the route failed). Worked example
from the request: arm a tunnel → the **Local** node goes green + tick; a jump host connects →
it goes green + tick; the service is down so the exit point can't reach it → the **Target**
node goes red + cross and hovering it shows the connection error.

## Design decisions (settled — do not relitigate)

- **The engine reports facts; the view owns the node mapping.** The engine does not change the
  connect / reconnect / lazy-connect algorithm — it only *observes* it. `tunnel.status()` gains
  a `route` object of low-level facts the engine actually knows; the renderer maps those onto
  the display nodes it already renders. This keeps the wire format stable and semantic and
  honours the house split ("engine reports, renderer displays").

- **`route` wire shape (added to `tunnel.status()`, secret-free):**

  ```
  route: {
    listener: "up" | "down" | "idle",              // the local bind
    hops: [ { status, reason? }, … ],              // one per [...jumps, sshServer], in order
    forward: { status, reason? }                   // the exit-point → service channel
  }
  // status ∈ "up" | "down" | "pending" | "idle"
  //   up      → succeeded            (green + tick)
  //   down    → failed               (red + cross; `reason` → tooltip / aria)
  //   pending → in flight            (neutral + connecting pulse; no tick/cross)
  //   idle    → not (yet) attempted / disarmed  (neutral; no icon)
  ```

  `route` rides the **existing `porthippo:tunnel-state` broadcast only** — that event already
  fires at every point a node changes (listener bind, each hop, each forward), so no new
  channel and no bloat on the 1 s `porthippo:stats` heartbeat. `reason` strings are host/port-
  level (exactly what the breadcrumb already prints) and **never** a password, passphrase, or
  key — the same redaction posture as everywhere else.

- **The node → status mapping lives in the renderer**, because the renderer owns the node list
  and its two shapes differ from the engine's chain. Let `k = jumpHostIds.length` and
  `bastion = sshHost` is non-blank. Display nodes (from `#routeSegments()`), in order, take
  status from `route` as:
  - `local` ← `listener`
  - `jump[j]` (j = 1…k) ← `hops[j-1]`
  - **bastion**: `ssh` ← `hops[k]`; `target` ← `forward`
  - **no bastion** (blank `sshHost` — SSH terminates *on* the destination box, so there is no
    separate SSH segment and the **Target node doubles as the SSH server**):
    `target` ← `hops[k]` **down/pending** wins (can't reach the service if the exit isn't up),
    else once `hops[k]` is **up** the node follows `forward`.

  This asymmetry is the one real subtlety; it is spelled out here and covered by a test for
  each shape. Alignment is defensive: if `hops.length` ever disagrees with `k+1` (a fail-closed
  resolution error), extra/missing nodes render `idle` and nothing throws.

- **The chevron link is derived, not sent.** The `route-sep` between node *i* and *i+1* takes
  its status from the two nodes it joins: `up` when both ends are `up`; `down` when the
  downstream node is `down` (the break happened *there*); otherwise `pending`/`idle`. No extra
  wire data. On a break the chevron swaps to a shape-distinct "broken link" glyph, so *where*
  the route failed is readable without colour.

- **Accessibility is the point, so colour is never the only signal.** Each node appends a status
  **icon** (`icons.check` / `icons.x`, plus a CSS pulse for pending) — shape encodes status the
  way `power`/`powerOff` already do. Colour (`--color-success` / `--color-danger` /
  `--color-muted`) is redundant reinforcement. Because hover is neither keyboard- nor AT-
  reachable, a **down** node becomes focusable (`tabindex="0"`) with an `aria-label` of
  "`<node>`: failed — `<reason>`" and a matching `title`; up/pending/idle nodes carry a plain
  descriptive `aria-label` ("`<node>`: connected", etc.). All status words come from `i18n`
  `EN` (never bare icons for screen readers).

- **Lazy-connect honesty.** The service is only *known* reachable once a forward is attempted.
  A connected `keepAlive` tunnel with no client traffic shows the Target as `pending`/idle
  ("upstream connected, service not yet probed") — **never** a false tick. `pause` preserves the
  live connections, so it leaves node statuses unchanged.

## Implementation steps

1. **`ssh-chain.js` — per-hop progress.** Add an optional `onHop({ index, phase, hopLabel })`
   callback to `connectChain` (`phase ∈ "connecting"|"up"|"down"`, plus `reason` on `down`),
   invoked around each `connectHop` / `forwardOut`. `connectChain` still rejects on first
   failure (behaviour unchanged) — the callback just makes the live walk observable. `probeChain`
   is untouched (it already reports per-hop).

2. **`tunnel.js` — maintain `#route`.** Track `{ listener, hops[], forward }` and update it at
   the seams that already exist: `arm()` success → `listener:"up"`, hops/forward reset to
   `idle`; `#handleListenerError` → `listener:"down"` + reason; `#ensureConnected` passes
   `onHop` → per-hop `pending`/`up`/`down`; relay `onOpen`/`onError` → `forward:"up"`/`"down"`;
   drop / teardown / disarm reset to the right resting state (`listener:"up"` while still
   `listening`, all `idle` when `disarmed`). Include `route` in `status()`. No new
   `#emitState()` calls are needed — every seam already emits.

3. **Engine + bridge — pass-through.** `engine.js` broadcasts `tunnel.status()` verbatim, so
   `route` flows for free; confirm `preload.js`'s generic re-dispatch carries it. No new IPC,
   so `ipc-parity` is unaffected.

4. **`icons.js` — tick + cross.** Add `check` (`<polyline points="20 6 9 17 4 12"/>`) and `x`
   (two crossed lines), 16×16 stroking `currentColor` like the rest.

5. **`tunnel-detail.js` — decorate the breadcrumb.** Add `updateRoute(route)` (stores + re-
   renders in place) and a `#routeNodeStatuses()` helper implementing the mapping above.
   `#renderBreadcrumb()` appends a `route-seg-status` icon slot per node, sets `title` /
   `aria-label` / focusability on `down` nodes, and tags each `route-sep` with its derived link
   status. `show()` accepts an initial `route`.

6. **`tunnels-view.js` — thread the payload.** Keep a `#routes` Map; `#applyState(detail)`
   stores `detail.route` and calls `#detail.updateRoute(route)` for the selected tunnel;
   `#renderDetail()` / `#select()` pass the stored route so a re-selection restores the icons.

7. **CSS (`components.css`).** `.route-seg--up/--down/--pending`, a `.route-seg-status` icon
   slot, `.route-sep--up/--down/--pending` with the broken-link glyph on down, and a reduced-
   motion-safe pending pulse — all off `--color-*` tokens, no hardcoded colours.

8. **i18n + docs + tests.** Add `detail.route.status.{up,down,pending,idle}` and the
   `aria`/tooltip templates to `EN`; **regenerate `en.json`** (byte-identical test). Update the
   relevant `src/web/docs/*.md` (monitoring page) to describe the ticks/crosses and what a
   Target cross vs. a hop cross means. Tests: engine — `route` transitions (listener up on arm,
   a hop `down` with a secret-free reason on connect failure, `forward:"down"` on a refused
   destination); renderer — `tunnel-detail.test.js` asserts each status renders the right
   icon + `aria-label` + `title`, and covers **both** the bastion and blank-`sshHost` target
   mappings; a redaction check that no `reason` carries a secret. Fold into `make test`;
   header-stamp any new file.

## Acceptance criteria

- Arming a tunnel turns the **Local** node green with a tick; a connected jump host and SSH
  server each get a tick; a hop that fails to connect gets a red cross whose error shows on
  hover and is announced to assistive tech.
- When the exit point cannot reach the service, the **Target** node shows a red cross with the
  connection error on hover — including the blank-`sshHost` case where Target *is* the SSH box.
- Every status is distinguishable **without colour** (tick / cross / pulse / none) and every
  node exposes an `aria-label`; a failed node is keyboard-focusable and reveals its reason.
- The chevron between two nodes reflects the link and marks where a break occurred.
- No `reason`, log, or diagnostic gains a secret (host/port only). No new IPC channel; the
  `porthippo:stats` heartbeat is unchanged. `make fmt && make lint && make test` green.

## Constraints

- **Do not change the connect / reconnect / lazy-connect / linger algorithm** — observe and
  report only. The `route` object is derived from state the engine already computes.
- Reasons are host/port-level and secret-free; `route` rides the existing `tunnel-state`
  broadcast, never a new channel and never the stats heartbeat.
- No colour-only status; shape (icon) is the primary signal, colour is redundant.
- Renderer owns the node→status mapping (view-specific); the engine stays UI-agnostic.
- Scope is the **detail-panel** breadcrumb only; the list/table view is out of scope (a
  possible follow-on).

## Verify

```
make fmt && make lint && make test
make debug   # select a tunnel and arm it → Local goes green + tick. Add a jump host and a
             # bastion; watch each node tick as the chain comes up. Point the destination at a
             # dead port → the Target node shows a red cross; hover it for the error; tab to it
             # and confirm the screen-reader label. Kill a jump host mid-route → its node crosses
             # and the chevron into it marks the break. Blank the SSH server (SSH into the
             # destination box) and confirm the Target node reflects both the SSH connect and
             # the service reach.
```
