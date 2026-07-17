# Feature 160 — Persistent activity history & bandwidth trends

## Context

Depends on: **30** (stats snapshots), **50** (Monitoring view), **60** (logging/diagnostics +
`redact()`). Complements **130** (which adds the lifecycle *events* this feature persists).

Two things reset to nothing every time Jump Hippo restarts. First, the per-tunnel **event
log** — `error-history-dialog.js` already renders `window.jumphippo.tunnels.events(id)` as
`{ at, level, message }` rows (with a `warning` level scaffolded next to `error`) — is held
only in memory, so "why did this tunnel drop at 2am?" is unanswerable after a relaunch.
Second, **stats** are instantaneous: the Monitoring view shows the current rate and monotonic
totals but no history, so there's no way to see "was it busy an hour ago?" or spot a periodic
spike. For a tool whose job is to babysit long-lived connections, having **no memory** is the
gap this closes.

## Goal

Promote the ephemeral per-tunnel event log to a **persistent, capped, redacted on-disk
activity log** (info/warning/error, typed events), and add a **bounded on-disk metrics
history** (downsampled throughput buckets) that drives **sparklines** in the Monitoring rows
and a **detail trend chart** — all with plain SVG, no chart library, bounded storage, and an
opt-out with a retention cap. Secrets never touch either store.

## Design decisions (settled — do not relitigate)

- **Two small, bounded, append-mostly stores in main — never in `tunnels.json`.** Activity and
  metrics history are operational telemetry, not configuration, so they live in their own files
  under `userData` (e.g. `activity.log` / `metrics/*.bin` or a compact JSONL), independent of
  the encrypted definitions doc. They are **rotated/capped by size and age** like `logger.js`
  (which already does 1 MB × 5), never growing unbounded.
- **Everything written is redacted and secret-free.** Both stores pass every string through the
  existing `diagnostics.js` `redact()` (PEM keys, `password:`-style pairs, URL creds) and record
  **only** ids, tunnel names, event types, levels, timestamps, and numeric byte counts — never a
  host, username, or secret. The existing "secrets never reach a report or the log" test is
  extended to cover them.
- **The event log is a superset of today's shape, so the existing dialog just works.** Keep
  `{ at, level, message }` and add an event `type` (`armed | connected | dropped | reconnecting
  | recovered | gave-up | hostkey-unknown | hostkey-changed | error | …`) so filtering/labels are
  structured, not string-matched. `error-history-dialog.js` becomes an **activity** view (all
  levels, filterable) reading the persisted log; the current in-memory ring becomes the write-
  through cache in front of the store. Feature 130's lifecycle transitions are the primary event
  source.
- **Metrics history is downsampled and fixed-size per tunnel.** The engine already emits ~1 Hz
  `jumphippo:stats` snapshots. A `metrics-history.js` aggregator folds them into fixed buckets
  at a couple of resolutions (e.g. a few minutes of ~5 s buckets for the live sparkline + a few
  hours of ~1 min buckets for the detail chart) held in a **ring buffer per tunnel**, flushed to
  disk periodically and on quit, reloaded on launch. No per-snapshot disk write; storage is
  O(tunnels × fixed buckets), not O(time).
- **Charts are hand-rolled SVG against the design tokens — no chart library.** A tiny
  `components/sparkline.js` (a path/polyline builder, pure + unit-testable on data → SVG points)
  renders inline in each Monitoring row; the tunnel detail shows a larger up/down trend built
  from the same component. Colours/sizes come from `theme.css` tokens (no hardcoded values), and
  it must read in light and dark.
- **Bounded, opt-outable, and clearable.** Settings: `historyEnabled` (default on),
  `historyRetentionDays` (cap), and a **Clear history** action. Diagnostics (Feature 60) may
  optionally append the **recent, redacted** activity tail to a copied report (it already reads
  the sealed tunnel list + redacted log tail — this slots in beside it).
- **The renderer only reads and renders.** Persistence, rotation, redaction, and downsampling
  live in main; the renderer subscribes to the live `jumphippo:stats` (unchanged) for the
  moving edge and pulls history/activity over IPC for the backfill.

## Data shapes (reference)

```jsonc
// activity event (persisted, redacted)
{ "id": "uuid", "at": 1720300000000, "type": "dropped", "level": "warning", "message": "…" }

// metrics history reply (per tunnel, per resolution)
{ "id": "uuid", "resolution": "5s", "startAt": …, "step": 5000,
  "up": [Int, …], "down": [Int, …] }     // bytes/bucket, fixed length ring
```

## Implementation steps

1. **`store/activity-log.js`.** Append/read/clear a capped, rotated, redacted event log keyed
   by tunnel id (size + age caps like `logger.js`); a bounded in-memory tail as the write-through
   cache. Emit no secrets; reuse `redact()`.
2. **`tunnel/metrics-history.js`.** A per-tunnel ring-buffer aggregator fed by the stats stream,
   at two resolutions, with periodic + on-quit flush and load-on-launch. Pure bucketing logic
   unit-tested with an injected clock (reuse the `stats.js` clock seam).
3. **Wire sources.** Route Feature 130's lifecycle transitions (and host-key events) into
   `activity-log.append(...)` from `main.js`/`engine.js`; feed `metrics-history` from the same
   snapshot tee that updates the tray/stats.
4. **IPC + preload.** Extend `tunnels:events` to read the persisted log with an optional level/
   type filter + paging; add `activity:clear` and `metrics:history(id, resolution)`. Register in
   `ipc/store.js` (or `ipc/shell.js`), expose under `window.jumphippo.tunnels.*`, preload in
   lockstep, `ipc-parity` green.
5. **`components/sparkline.js`.** A pure data→SVG builder (points, min/max scaling, up/down
   overlay) using theme tokens; unit-test the point math.
6. **Monitoring UI.** Add an inline sparkline to each `tunnel-table.js` row (last few minutes)
   and an up/down trend + a filterable **Activity** list to `tunnel-detail.js`; rename/extend the
   error-history popup into the activity view (all levels + type filter). Empty/paused states
   handled.
7. **Settings + diagnostics.** `historyEnabled` / `historyRetentionDays` + **Clear history** in
   Settings; optionally append the redacted activity tail to the diagnostics report.
8. **i18n + docs + tests.** Labels/event-type names into `EN`, regenerate `en.json`. Update
   `docs/monitoring.md` (activity log, trends, retention/clear, the privacy note) and
   `docs/troubleshooting.md`. Tests: `activity-log.test.js` (rotation/cap, redaction, filter),
   `metrics-history.test.js` (bucketing/ring/flush-reload with a fake clock), `sparkline.test.js`
   (point math), and an extension of the diagnostics secret-free test. Fold into `make test`;
   header-stamp new files.

## Acceptance criteria

- A tunnel's activity (arm/connect/drop/reconnect/host-key/error events) **survives a restart**
  and is viewable, filterable by level/type, newest-first, in the (renamed) activity view.
- Monitoring rows show a live sparkline of recent throughput; the detail view shows an up/down
  trend over a longer window; both backfill from persisted history on open and track the live
  stream at the edge.
- History is bounded (size + retention cap), can be disabled, and can be cleared; disabling stops
  new writes and clearing empties both stores.
- No host, username, or secret appears in either store or in a diagnostics report that includes
  the activity tail (existing redaction test extended and passing).
- No chart library, no unbounded growth, no per-snapshot disk write; `make fmt && make lint &&
  make test` green.

## Constraints

- Activity/metrics history live in **their own capped files** under `userData`, never in the
  encrypted definitions doc; rotation + retention bound both.
- Everything persisted is redacted and secret-free (reuse `diagnostics.js` `redact()`).
- Charts are hand-rolled SVG on theme tokens — no chart/plotting dependency, no hardcoded colours.
- Persistence/downsampling/redaction stay in main; the renderer reads and renders only.

## Verify

```
make fmt && make lint && make test
make debug   # push traffic through a tunnel and watch its Monitoring sparkline fill; drop and
             # reconnect it, restart the app, and confirm the drop/reconnect events + the recent
             # trend are still there. Toggle historyEnabled off (writes stop), Clear history
             # (both stores empty), and copy diagnostics to confirm the activity tail is present
             # and fully redacted.
```
