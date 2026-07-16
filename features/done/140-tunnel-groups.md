# Feature 140 — Tunnel groups & bulk actions

## Context

Depends on: **45** (reference model with reusable `credentials[]` / `jumpHosts[]` sibling
arrays + referential-integrity guards), **50** (Monitoring + Definition lists), **60** (tray
+ native menu). Later features (**150** scheduling) attach rules at the group level, so groups
land first.

Once a user has more than a handful of tunnels, the flat list stops scaling: there's no way
to see "my *work* tunnels" apart from "my *home-lab* tunnels," and no way to arm, disarm, or
pause a whole set in one action — every tunnel is toggled individually. The reusable-record
pattern from Feature 45 (`credentials[]`, `jumpHosts[]` as sibling arrays with integrity
guards and `*-changed` events) is exactly the shape a **group** wants, so this extends a
proven mechanism rather than inventing one.

## Goal

A first-class, reusable **group** (label + colour + order) that a tunnel can optionally
belong to; grouped, collapsible sections in both the Definition and Monitoring lists with a
per-group **arm-all / disarm-all / pause-all** header control and live counts; group entries
in the tray/native menu; and multi-select **bulk actions** on the current list. Ungrouped
tunnels remain first-class (an implicit "Ungrouped" section).

## Design decisions (settled — do not relitigate)

- **A group is a sibling array, mirroring credentials/jump hosts.** `groups[]` in
  `tunnels.json` alongside `tunnels[]` / `credentials[]` / `jumpHosts[]`; the tunnel gains an
  optional `groupId`. `schemaVersion` bumps **3 → 4** (assuming 110 shipped v3; otherwise the
  next integer) with an idempotent migration that adds an empty `groups: []` and leaves every
  tunnel ungrouped. Same referential-integrity guards as Feature 45: a dangling `groupId` is
  rejected on tunnel create/update; a group **can** be deleted while referenced (its tunnels
  fall back to ungrouped — groups are organisational, not load-bearing like a credential).
- **Membership is single and optional.** A tunnel belongs to zero or one group (not many) —
  it keeps the list a clean tree, matches how people think ("this tunnel is a *work* tunnel"),
  and keeps bulk actions unambiguous. Multi-tag membership is explicitly out of scope.
- **Bulk actions are set operations over ids, added to the engine once.** Add
  `engine.applyToMany(ids, action)` where `action ∈ {arm, disarm, pause, resume}`, iterating
  the existing per-tunnel methods with a single coalesced state broadcast at the end (not one
  per tunnel). "Arm this group" is just `applyToMany(idsInGroup, "arm")`. No per-group engine
  state — a group is a renderer/store concept the engine never needs to know about.
- **The list renders a two-level tree, groups reorderable, tunnels drag-assignable.** Both the
  Definition (`tunnel-list.js`) and Monitoring (`tunnel-table.js`) lists render collapsible
  group sections ordered by `group.order`, each with a header showing the group name, a state
  rollup (`n armed / m total`, aggregate traffic in Monitoring), and the arm/pause-all control.
  Collapsed/expanded state persists in settings. Drag a tunnel onto a group header to assign;
  drag group headers to reorder.
- **Groups reach the tray/menu.** The tray menu (`menu.js` items are injected-Electron built)
  gains a submenu per group with arm-all / disarm-all, teed from the same broadcast that already
  updates the tray — no new polling.
- **Multi-select is a list affordance, not a mode.** The list supports checkbox/shift-click
  multi-select with a bulk-action bar (Arm / Disarm / Pause / Resume / Assign to group…
  / Delete) acting on the selection via `applyToMany` + store writes. Selection is transient
  renderer state.
- **Colour is a fixed token palette, not a free colour picker.** A group colour is one of a
  small set of theme tokens (so it stays legible in light/dark and matches the design system) —
  never a hardcoded hex.

## Data model (next schemaVersion)

```
group  { id, label, color, order }     # color = a theme-token key, not a hex
tunnel { …existing…, groupId? }        # optional, single membership
```

## Implementation steps

1. **Store + migration.** `group-store.js` over the shared `definitions-doc.js` (CRUD +
   ordering), the `groupId` field on the tunnel schema + `validate.js` (dangling-ref reject),
   and the migration adding `groups: []`. `tunnel-store.list()` already attaches display
   helpers — add the resolved group (label/colour) to the row shape so the list needn't join.
2. **Engine bulk op.** `engine.applyToMany(ids, action)` with one coalesced `tunnel-state`
   broadcast; unit-test that N tunnels toggle with a single broadcast.
3. **IPC + preload.** `groups:list|create|update|delete|reorder` and
   `tunnels:apply-many` (or reuse `engine:*`), registered in `ipc/store.js` + `ipc/engine.js`,
   exposed under `window.porthippo.groups.*` / `window.porthippo.tunnels.applyMany`, preload
   in lockstep; the `ipc-parity` test stays green (no new file needed if folded into existing
   handlers — otherwise add it to the scan list). A group write triggers no engine reconcile
   (groups don't change routing).
4. **Group editor.** A small `group-editor-dialog.js` (label + colour-token picker), reachable
   from a "New group…" affordance and from a group header's context menu, following the
   credential/jump-host editor pattern; emits `porthippo:groups-changed`.
5. **Definition list.** `tunnel-list.js` renders collapsible group sections with header
   arm/disarm-all + counts; drag-assign a tunnel to a group and drag-reorder groups; persist
   expand/collapse in settings.
6. **Monitoring list.** `tunnel-table.js` renders the same grouping with a per-group traffic
   rollup and pause/resume-all; respects the existing all/active filter within groups.
7. **Multi-select + bulk bar.** Checkbox/shift-click selection + a bulk-action bar wired to
   `applyToMany` and store writes (assign-to-group, delete-with-confirm).
8. **Tray/menu.** Per-group submenus (arm-all / disarm-all) fed by the broadcast tee.
9. **i18n + docs + tests.** Labels into `EN`, regenerate `en.json`. Update
   `docs/defining-tunnels.md` (and `monitoring.md`) to cover groups + bulk actions. Tests:
   `group-store.test.js` (CRUD, integrity, migration), an `applyToMany` engine test, and
   renderer tests for grouped rendering + selection. Fold into `make test`; header-stamp new
   files.

## Acceptance criteria

- A group can be created with a name + palette colour and reused across tunnels; a tunnel
  shows its group in both lists; ungrouped tunnels appear under an implicit "Ungrouped" section.
- A group header's arm-all / disarm-all / pause-all toggles every tunnel in that group with a
  **single** coalesced state update, not one per tunnel.
- Deleting a group leaves its tunnels intact and ungrouped; a dangling `groupId` on
  create/update is rejected.
- Multi-select + the bulk bar can arm/disarm/pause/resume/assign/delete an arbitrary selection.
- The tray exposes per-group arm-all/disarm-all; group colours read correctly in light and dark.
- Existing configs migrate to an empty `groups[]` with all tunnels ungrouped; `make fmt &&
  make lint && make test` green.

## Constraints

- Single, optional group membership per tunnel — no multi-tagging.
- Groups are organisational: the **engine** stays group-unaware (bulk ops are id-set calls);
  deleting a group never disarms or deletes a tunnel.
- Colours come from theme tokens, never hardcoded values (CSS-naming + token rules apply).
- Bulk actions coalesce their broadcast — no per-tunnel IPC storm.

## Verify

```
make fmt && make lint && make test
make debug   # create two groups, assign tunnels by drag; collapse/expand and reload (state
             # persists); arm-all a group and confirm one coalesced update; multi-select three
             # tunnels across groups and pause them from the bulk bar; delete a group and
             # confirm its tunnels survive as ungrouped; use the tray group submenu to disarm-all.
```
