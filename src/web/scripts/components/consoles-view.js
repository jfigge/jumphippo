/*
 * Copyright 2026 Jason Figge
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// consoles-view.js — the CONSOLES section controller (Feature 200): the console
// sibling of TunnelsView, but lean. It owns the console IPC (window.jumphippo
// .consoles.*), the ConsoleEditorDialog, the ConsoleList, and — reusing the SAME
// shared groups tunnels use (Feature 140) — a GroupEditorDialog + the group model
// (collapse, assign, reorder). It mounts into the sidebar stack beneath the TUNNELS
// section. Opening a console launches its own terminal window (main process) —
// there is no detail pane here. Live session state arrives over
// `jumphippo:console-state` and drives each row's status lamp.

import { el } from "../dom.js";
import { t } from "../i18n.js";
import { PopupManager } from "../popup-manager.js";
import { ConsoleList } from "./console-list.js";
import { ConsoleEditorDialog } from "./console-editor-dialog.js";
import { ConsoleDetail } from "./console-detail.js";
import { ConsoleOverview } from "./console-overview.js";
import { GroupEditorDialog } from "./group-editor-dialog.js";
import { UNGROUPED_ID } from "./tunnel-grouping.js";
import { formatDuration } from "../utils/format.js";

// A session reads as "idle" once it has been quiet this long (matches ConsoleDetail).
const IDLE_MS = 30_000;
// How often the sidebar runtime sub-lines ("Running 24m") re-tick.
const RUNTIME_TICK_MS = 15_000;

/** Lamp priority when a console has more than one open session. */
function rankState(s) {
  if (s === "connected") return 3;
  if (s === "error") return 2;
  if (s === "connecting") return 1;
  return 0;
}

export class ConsolesView {
  #el;
  #jumphippo;
  #now;
  #list;
  #editor;
  #groupEditor;
  #detail; // Console Manager details pane (mounted in the tunnels view's slot)
  #overview; // Console Manager overview grid (mounted in the same slot)
  #activePane = null; // "detail" | "overview" | null — which slot pane is active

  #defs = [];
  #groups = [];
  #collapsed = new Set();
  #pendingAssignIds = null; // consoles awaiting a just-created group
  #sessions = new Map(); // sessionId → runtime snapshot — the live open sessions
  #states = new Map(); // consoleId → aggregate lamp state
  #jumpsById = new Map(); // jump-host records for the details breadcrumb
  #showOutput = true; // consoleShowOutput setting (recent-output preview)
  #selectedId = null;
  #shownSessionId; // the session currently driving the details pane
  #pinnedSessionId = null; // a window the user picked via the switcher (else newest)
  #runtimeTick = null; // sidebar runtime sub-line ticker

  #onConsoleSelected;
  #onOverviewSelected;
  #onConsolesChanged;
  #onGroupsChanged;
  #onConsoleState;
  #onConsoleActivity;
  #onOutputSetting;
  #onNewConsole;

  constructor({
    jumphippo,
    openKeyFile,
    now,
    onConsoleSelected,
    onOverviewSelected,
  } = {}) {
    this.#jumphippo = jumphippo || window.jumphippo;
    this.#now = now || Date.now;
    this.#onConsoleSelected = onConsoleSelected || (() => {});
    this.#onOverviewSelected = onOverviewSelected || (() => {});

    this.#editor = new ConsoleEditorDialog({
      jumphippo: this.#jumphippo,
      openKeyFile,
      onSaved: (record) => this.#afterSaved(record),
    });

    this.#groupEditor = new GroupEditorDialog({
      jumphippo: this.#jumphippo,
      onSaved: (record) => this.#afterGroupSaved(record),
    });

    this.#list = new ConsoleList({
      onSelect: (id) => this.#select(id),
      onAdd: () => this.#editor.openCreate(),
      onOpen: (id) => this.#open(id),
      onOverview: () => this.selectOverview(),
      onContextMenu: (id) => this.#showContextMenu(id),
      onToggleCollapse: (sectionId) => this.#toggleCollapse(sectionId),
      onGroupMenu: (sectionId) => this.#showGroupMenu(sectionId),
      onMoveConsole: (id, groupId, beforeId) =>
        this.#moveConsole(id, groupId, beforeId),
      onReorderGroups: (fromId, toId) => this.#reorderGroups(fromId, toId),
    });

    // The Console Manager centre-pane views. Pure views — they report actions back
    // here, and we drive them from the live session snapshots + activity stream.
    // Both mount into the tunnels view's centre slot by the app (detailElement /
    // overviewElement); exactly one is shown at a time.
    this.#detail = new ConsoleDetail({
      now: this.#now,
      onBringForward: (sid) => this.#reveal(sid),
      onRestart: (sid) => this.#restart(sid),
      onClose: (sid) => this.#closeSession(sid),
      onOpenNew: (id) => this.#open(id),
      onCopyInfo: (def) => this.#copyInfo(def),
      onSelectSession: (sid) => this.#switchSession(sid),
    });
    this.#overview = new ConsoleOverview({
      now: this.#now,
      onReveal: (sid) => this.#reveal(sid),
    });
    this.#overview.element.hidden = true; // detail is the default slot pane

    this.#el = el("div", { class: "consoles-view" }, [
      this.#list.element,
      this.#editor.element,
      this.#groupEditor.element,
    ]);

    this.#onConsolesChanged = () => this.load();
    // A group create/edit/delete anywhere (this view's editor, the tunnels view, or
    // another window) re-reads the shared group list so the console tree refreshes.
    this.#onGroupsChanged = () => this.load();
    this.#onConsoleState = (e) => this.#applyState(e.detail);
    this.#onConsoleActivity = (e) => this.#applyActivity(e.detail);
    this.#onOutputSetting = (e) => this.#applyOutputSetting(e.detail);
    this.#onNewConsole = () => this.createNew();
    window.addEventListener(
      "jumphippo:consoles-changed",
      this.#onConsolesChanged,
    );
    window.addEventListener("jumphippo:groups-changed", this.#onGroupsChanged);
    window.addEventListener("jumphippo:console-state", this.#onConsoleState);
    window.addEventListener(
      "jumphippo:console-activity",
      this.#onConsoleActivity,
    );
    window.addEventListener(
      "jumphippo:console-output-changed",
      this.#onOutputSetting,
    );
    window.addEventListener("jumphippo:new-console", this.#onNewConsole);

    // Tick the sidebar runtime sub-lines ("Running 24m") so they count up without a
    // per-second heartbeat. Unref'd so it never keeps the process (or a test) alive.
    if (typeof setInterval === "function") {
      this.#runtimeTick = setInterval(
        () => this.#refreshRuntimes(),
        RUNTIME_TICK_MS,
      );
      if (this.#runtimeTick && typeof this.#runtimeTick.unref === "function") {
        this.#runtimeTick.unref();
      }
    }
  }

  get element() {
    return this.#el;
  }

  /** The Console Manager details pane — mounted into the tunnels view's slot. */
  get detailElement() {
    return this.#detail.element;
  }

  /** The Console Manager overview grid — mounted into the same slot. */
  get overviewElement() {
    return this.#overview.element;
  }

  /** Load the console list, the shared groups, collapse state, and open sessions. */
  async load() {
    const [defs, groups, sessions, jumps, settings] = await Promise.all([
      this.#jumphippo?.consoles?.list?.() ?? [],
      this.#jumphippo?.groups?.list?.() ?? [],
      this.#jumphippo?.consoles?.sessions?.() ?? [],
      this.#jumphippo?.jumpHosts?.list?.() ?? [],
      this.#jumphippo?.settings?.get?.() ?? {},
    ]);
    this.#defs = Array.isArray(defs) ? defs : [];
    this.#groups = Array.isArray(groups) ? groups : [];
    this.#jumpsById = new Map(
      (Array.isArray(jumps) ? jumps : []).map((j) => [j.id, j]),
    );
    this.#showOutput = settings?.consoleShowOutput !== false;

    this.#sessions.clear();
    for (const s of Array.isArray(sessions) ? sessions : []) {
      if (s && s.sessionId) this.#sessions.set(s.sessionId, s);
    }
    this.#recomputeStates();

    // Per-group collapsed state — the consoles' own map, independent of tunnels'.
    const collapsedMap =
      settings && typeof settings.consoleGroupCollapsed === "object"
        ? settings.consoleGroupCollapsed
        : {};
    this.#collapsed = new Set(
      Object.keys(collapsedMap).filter((k) => collapsedMap[k]),
    );

    this.#list.setData(this.#defs, this.#states, this.#selectedId);
    this.#list.setGrouping({
      groups: this.#groups,
      collapsedIds: this.#collapsed,
    });
    // Keep the Console Manager pane in step with the (reloaded) session set.
    if (this.#selectedId != null) this.#syncSelectedDetail();
    if (this.#activePane === "overview") this.#renderOverview();
    this.#refreshRuntimes();
  }

  /** Refresh every console row's runtime sub-line from its primary session. */
  #refreshRuntimes() {
    for (const def of this.#defs) {
      this.#list.updateRuntime(def.id, this.#runtimeLabel(def.id));
    }
  }

  /** The sidebar runtime sub-line for a console: "Running 24m" / "Idle" / …. */
  #runtimeLabel(consoleId) {
    const list = this.#sessionsFor(consoleId);
    const primary = list.length ? list[list.length - 1] : null;
    if (!primary) return ""; // not running → just the name
    switch (primary.state) {
      case "connecting":
        return t("console.sidebar.connecting");
      case "error":
        return t("console.sidebar.disconnected");
      case "connected": {
        const quiet =
          primary.lastActivityAt != null &&
          this.#now() - primary.lastActivityAt > IDLE_MS;
        if (quiet) return t("console.sidebar.idle");
        const startedAt = primary.connectedAt ?? primary.openedAt;
        return startedAt != null
          ? t("console.sidebar.running", {
              duration: formatDuration(this.#now() - startedAt),
            })
          : t("console.sidebar.idle");
      }
      default:
        return "";
    }
  }

  /** Open a blank console editor (the File ▸ New Console menu command). */
  createNew() {
    this.#editor.openCreate();
  }

  /** Remove the global listeners (symmetry with the app teardown). */
  destroy() {
    window.removeEventListener(
      "jumphippo:consoles-changed",
      this.#onConsolesChanged,
    );
    window.removeEventListener(
      "jumphippo:groups-changed",
      this.#onGroupsChanged,
    );
    window.removeEventListener("jumphippo:console-state", this.#onConsoleState);
    window.removeEventListener(
      "jumphippo:console-activity",
      this.#onConsoleActivity,
    );
    window.removeEventListener(
      "jumphippo:console-output-changed",
      this.#onOutputSetting,
    );
    window.removeEventListener("jumphippo:new-console", this.#onNewConsole);
    if (this.#runtimeTick) {
      clearInterval(this.#runtimeTick);
      this.#runtimeTick = null;
    }
    this.#detail.destroy();
    this.#overview.destroy();
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  #select(id) {
    this.#selectedId = id;
    this.#list.setSelected(id);
    this.#activePane = "detail";
    this.#showDetailPane();
    this.#pinnedSessionId = null; // a fresh selection tracks the newest window
    this.#shownSessionId = undefined; // force a fresh show of the details pane
    this.#syncSelectedDetail();
    // Tell the app to hand the centre pane to the Console Manager (Feature 210).
    this.#onConsoleSelected(id);
  }

  /** Show the all-consoles overview (clicking the CONSOLES section title). */
  selectOverview() {
    this.#selectedId = null;
    this.#shownSessionId = undefined;
    this.#list.setSelected(null);
    this.#activePane = "overview";
    this.#showOverviewPane();
    this.#renderOverview();
    this.#watch([...this.#sessions.values()].map((s) => s.sessionId));
    this.#onOverviewSelected();
  }

  /** Drop the console selection (a tunnel took the centre pane) + stop watching. */
  clearSelection() {
    this.#selectedId = null;
    this.#shownSessionId = undefined;
    this.#activePane = null;
    this.#list.setSelected(null);
    this.#detail.clear();
    this.#watch(null);
  }

  #showDetailPane() {
    this.#detail.element.hidden = false;
    this.#overview.element.hidden = true;
  }

  #showOverviewPane() {
    this.#overview.element.hidden = false;
    this.#detail.element.hidden = true;
  }

  /** Rebuild the overview cards from the live sessions + their console names. */
  #renderOverview() {
    const cards = [...this.#sessions.values()].map((snap) => {
      const def = this.#defs.find((d) => d.id === snap.id);
      return {
        sessionId: snap.sessionId,
        name: def ? def.name : t("consoles.unnamed"),
        snap,
      };
    });
    this.#overview.setSessions(cards, { showOutput: this.#showOutput });
  }

  /** The newest open session for a console (the details pane's "primary"), or null. */
  /** Every open session for a console, oldest → newest (so Window #1 sorts first). */
  #sessionsFor(consoleId) {
    return [...this.#sessions.values()]
      .filter((s) => s && s.id === consoleId)
      .sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0));
  }

  /** The session the details pane should track: the pinned window if it's still
   *  open, else the newest. Null when the console has no open session. */
  #targetSession(consoleId) {
    const list = this.#sessionsFor(consoleId);
    if (list.length === 0) return null;
    if (this.#pinnedSessionId) {
      const pinned = list.find((s) => s.sessionId === this.#pinnedSessionId);
      if (pinned) return pinned;
    }
    return list[list.length - 1]; // newest
  }

  /** Switch the details pane to a specific window (session-switcher pill click). */
  #switchSession(sessionId) {
    if (!sessionId || sessionId === this.#shownSessionId) return;
    this.#pinnedSessionId = sessionId;
    this.#shownSessionId = undefined; // force a fresh show of the picked window
    this.#syncSelectedDetail();
  }

  /**
   * Point the details pane at the selected console's target session: a full re-show
   * (+ (re)watch + seed output) when the shown session changes, else a light
   * metadata update. Always keeps the window switcher's session set current. A
   * console with no open session shows the "not running" state.
   */
  #syncSelectedDetail() {
    if (this.#selectedId == null) return;
    const def = this.#defs.find((d) => d.id === this.#selectedId) || null;
    const list = this.#sessionsFor(this.#selectedId);
    const target = this.#targetSession(this.#selectedId);
    const sid = target ? target.sessionId : null;
    if (sid !== this.#shownSessionId) {
      this.#shownSessionId = sid;
      this.#detail.show(def, {
        snap: target,
        sessions: list,
        jumpsById: this.#jumpsById,
        showOutput: this.#showOutput,
      });
      this.#watch(sid ? [sid] : []);
      if (sid) this.#seedSession(sid);
    } else {
      if (target) this.#detail.updateSnapshot(target);
      this.#detail.setSessions(list); // windows opened/closed → refresh the switcher
    }
  }

  /** Fetch a session's full snapshot (incl. recent output) to seed the pane. */
  async #seedSession(sessionId) {
    const full = await this.#jumphippo?.consoles?.session?.(sessionId);
    if (!full || this.#shownSessionId !== sessionId) return;
    const def = this.#defs.find((d) => d.id === full.id) || null;
    this.#detail.show(def, {
      snap: full,
      sessions: this.#sessionsFor(full.id),
      jumpsById: this.#jumpsById,
      showOutput: this.#showOutput,
    });
  }

  /** Set which sessions main streams live activity for (details = one, none = []). */
  #watch(sessionIds) {
    this.#jumphippo?.consoles?.watch?.(sessionIds)?.catch?.(() => {});
  }

  async #open(id) {
    const result = await this.#jumphippo?.consoles?.open?.(id);
    if (result && result.__hippoError) {
      PopupManager.notify({
        message: result.message || t("consoles.openError"),
      });
    }
    // Success opens a terminal window; row state follows via jumphippo:console-state.
  }

  // ── Console Manager actions (Feature 210) ───────────────────────────────────

  #reveal(sessionId) {
    if (sessionId)
      this.#jumphippo?.consoles?.reveal?.(sessionId)?.catch?.(() => {});
  }

  async #restart(sessionId) {
    if (!sessionId) return;
    const res = await this.#jumphippo?.consoles?.restart?.(sessionId);
    if (res && res.__hippoError) {
      PopupManager.notify({ message: res.message || t("consoles.openError") });
    }
    // The new/old sessions announce themselves over jumphippo:console-state.
  }

  #closeSession(sessionId) {
    if (sessionId)
      this.#jumphippo?.consoles?.close?.(sessionId)?.catch?.(() => {});
  }

  /** Copy the (secret-free) connection info for a console to the clipboard. */
  #copyInfo(def) {
    if (!def) return;
    const lines = [def.name || t("consoles.unnamed")];
    if (def.sshHost) lines.push(`ssh ${def.sshHost}:${def.sshPort ?? 22}`);
    const jumps = (Array.isArray(def.jumpHostIds) ? def.jumpHostIds : [])
      .map((jid) => {
        const jh = this.#jumpsById.get(jid);
        return jh ? jh.label || `${jh.host}:${jh.port}` : jid;
      })
      .filter(Boolean);
    if (jumps.length) lines.push(`via ${jumps.join(" › ")}`);
    this.#jumphippo?.clipboard?.write?.(lines.join("\n"))?.catch?.(() => {});
    PopupManager.notify({ message: t("console.action.copied") });
  }

  #editById(id) {
    const def = this.#defs.find((d) => d.id === id);
    if (def) this.#editor.openEdit(def);
  }

  #afterSaved(record) {
    if (record && record.id) this.#selectedId = record.id;
    this.load();
  }

  async #showContextMenu(id) {
    const def = this.#defs.find((d) => d.id === id);
    if (!def) return;
    this.#select(id);
    const items = [
      { id: "open", label: t("consoles.menu.open") },
      { type: "separator" },
      { id: "edit", label: t("consoles.menu.edit") },
      // Assign to one of the shared groups (or create one). Empty groups appear
      // here even though they're hidden from the sidebar tree.
      {
        label: t("consoles.menu.assign"),
        submenu: this.#assignMenuItems(def.groupId || null),
      },
      { type: "separator" },
      { id: "delete", label: t("consoles.menu.delete") },
    ];
    const action = await this.#jumphippo?.contextMenu?.popup?.({ items });
    switch (action) {
      case "open":
        this.#open(id);
        break;
      case "edit":
        this.#editById(id);
        break;
      case "delete":
        this.#confirmDelete(id);
        break;
      default:
        if (typeof action === "string" && action.startsWith("assign:")) {
          this.#handleAssignChoice(action, [id]);
        }
        break;
    }
  }

  #confirmDelete(id) {
    const def = this.#defs.find((d) => d.id === id);
    if (!def) return;
    PopupManager.confirmDelete({
      message: t("consoles.delete.message", {
        name: def.name || t("consoles.unnamed"),
      }),
      onConfirm: async () => {
        const result = await this.#jumphippo.consoles.delete(id);
        if (result && result.__hippoError) {
          PopupManager.notify({ message: result.message || "Delete failed" });
          return;
        }
        window.dispatchEvent(new CustomEvent("jumphippo:consoles-changed"));
        if (this.#selectedId === id) this.#selectedId = null;
        await this.load();
      },
    });
  }

  // ── Groups (shared with tunnels, Feature 140) ─────────────────────────────────

  #toggleCollapse(sectionId) {
    if (this.#collapsed.has(sectionId)) this.#collapsed.delete(sectionId);
    else this.#collapsed.add(sectionId);
    this.#list.setGrouping({
      groups: this.#groups,
      collapsedIds: this.#collapsed,
    });
    this.#persistCollapsed();
  }

  #persistCollapsed() {
    const map = {};
    for (const id of this.#collapsed) map[id] = true;
    this.#jumphippo?.settings
      ?.set?.({ consoleGroupCollapsed: map })
      ?.catch?.(() => {});
  }

  async #showGroupMenu(sectionId) {
    // Consoles have no arm/pause, so a group header menu is just edit / delete
    // (Ungrouped has neither). Both act on the shared group record.
    if (sectionId === UNGROUPED_ID) return;
    const items = [
      { id: "edit", label: t("group.menu.edit") },
      { id: "delete", label: t("group.menu.delete") },
    ];
    const action = await this.#jumphippo?.contextMenu?.popup?.({ items });
    if (action === "edit") this.#editGroup(sectionId);
    else if (action === "delete") this.#confirmDeleteGroup(sectionId);
  }

  #newGroup(assignIds) {
    this.#pendingAssignIds = Array.isArray(assignIds) ? assignIds : null;
    this.#groupEditor.openCreate();
  }

  #editGroup(groupId) {
    const group = this.#groups.find((g) => g.id === groupId);
    if (group) this.#groupEditor.openEdit(group);
  }

  #confirmDeleteGroup(groupId) {
    const group = this.#groups.find((g) => g.id === groupId);
    if (!group) return;
    PopupManager.confirmDelete({
      message: t("group.delete.message", { name: group.label }),
      onConfirm: async () => {
        const result = await this.#jumphippo?.groups?.delete?.(groupId);
        if (result && result.__hippoError) {
          PopupManager.notify({ message: result.message || "Delete failed" });
          return;
        }
        // The delete also cleared the group from any tunnels — tell the tunnels
        // view (and any other listener) to re-read the shared group set.
        window.dispatchEvent(new CustomEvent("jumphippo:groups-changed"));
        await this.load();
      },
    });
  }

  async #afterGroupSaved(record) {
    // A group created to receive a pending selection → move those consoles into it.
    // Otherwise the jumphippo:groups-changed listener reloads.
    if (this.#pendingAssignIds && record && record.id) {
      const ids = this.#pendingAssignIds;
      this.#pendingAssignIds = null;
      await this.#assignMany(ids, record.id);
    } else {
      this.#pendingAssignIds = null;
    }
  }

  /** Move a set of consoles into a group (or to Ungrouped when groupId is null). */
  async #assignMany(ids, groupId) {
    const writes = [];
    for (const id of ids) {
      const def = this.#defs.find((d) => d.id === id);
      if (!def) continue;
      writes.push(
        this.#jumphippo?.consoles?.update?.(
          id,
          this.#assignPayload(def, groupId),
        ),
      );
    }
    try {
      await Promise.all(writes);
    } catch {
      // best-effort; a failed assignment just leaves that console where it was
    }
    window.dispatchEvent(new CustomEvent("jumphippo:consoles-changed"));
    await this.load();
  }

  /**
   * Move a console into a group AND sequence it there (treeview drag): rebuild the
   * global display order with the dragged console re-inserted before `beforeId` (or
   * appended to the target group when `beforeId` is null), flip its group membership
   * if it changed, and persist. `groupId` null → Ungrouped.
   */
  async #moveConsole(id, groupId, beforeId) {
    const def = this.#defs.find((d) => d.id === id);
    if (!def) return;
    const groupOf = (d) =>
      d.groupId && this.#groups.some((g) => g.id === d.groupId)
        ? d.groupId
        : null;
    const target =
      groupId && this.#groups.some((g) => g.id === groupId) ? groupId : null;
    const currentGroupId = groupOf(def);

    const order = this.#defs.map((d) => d.id).filter((x) => x !== id);
    let idx;
    if (beforeId != null && order.includes(beforeId)) {
      idx = order.indexOf(beforeId);
    } else {
      const members = this.#defs.filter(
        (d) => d.id !== id && groupOf(d) === target,
      );
      idx = members.length
        ? order.indexOf(members[members.length - 1].id) + 1
        : order.length;
    }
    order.splice(idx, 0, id);

    const sameOrder =
      order.length === this.#defs.length &&
      order.every((x, i) => x === this.#defs[i].id);
    if (currentGroupId === target && sameOrder) return; // nothing changed

    if (currentGroupId !== target) {
      const res = await this.#jumphippo?.consoles?.update?.(
        id,
        this.#assignPayload(def, target),
      );
      if (res && res.__hippoError) {
        PopupManager.notify({ message: res.message || "Update error" });
        return;
      }
    }
    await this.#jumphippo?.consoles?.reorder?.(order);
    window.dispatchEvent(new CustomEvent("jumphippo:consoles-changed"));
    await this.load();
  }

  /** A full-definition update payload that only changes group membership. */
  #assignPayload(def, groupId) {
    const payload = { ...def };
    delete payload.order; // derived
    delete payload.routeSummary; // derived
    delete payload.group; // derived
    if (groupId) payload.groupId = groupId;
    else delete payload.groupId; // omit → the store drops it (ungrouped)
    return payload;
  }

  async #reorderGroups(fromId, toId) {
    const ids = this.#groups.map((g) => g.id);
    const from = ids.indexOf(fromId);
    if (from === -1 || fromId === toId) return;
    ids.splice(from, 1);
    const at = ids.indexOf(toId);
    ids.splice(at === -1 ? ids.length : at, 0, fromId);
    const result = await this.#jumphippo?.groups?.reorder?.(ids);
    if (result && result.__hippoError) return;
    // Group order is shared — refresh the tunnels view too.
    window.dispatchEvent(new CustomEvent("jumphippo:groups-changed"));
    await this.load();
  }

  /** The "Assign to group" submenu items — ALL groups, incl. currently-empty ones. */
  #assignMenuItems(currentGroupId) {
    const items = this.#groups.map((g) => ({
      id: `assign:${g.id}`,
      label: g.label,
      enabled: g.id !== currentGroupId,
    }));
    items.push({
      id: `assign:${UNGROUPED_ID}`,
      label: t("group.ungrouped"),
      enabled: Boolean(currentGroupId),
    });
    items.push({ type: "separator" });
    items.push({ id: "assign:__new", label: t("group.newEllipsis") });
    return items;
  }

  #handleAssignChoice(choice, ids) {
    if (typeof choice !== "string" || !choice.startsWith("assign:")) return;
    const target = choice.slice("assign:".length);
    if (target === "__new") {
      this.#newGroup(ids);
      return;
    }
    this.#assignMany(ids, target === UNGROUPED_ID ? null : target);
  }

  // ── Live session state → row lamps ────────────────────────────────────────────

  #applyState(detail) {
    if (!detail || !detail.sessionId) return;
    const { id, sessionId, state } = detail;
    const terminal = state === "closed" || state === "error";
    if (terminal) this.#sessions.delete(sessionId);
    else this.#sessions.set(sessionId, detail); // full runtime snapshot
    this.#recomputeStates();
    if (id) {
      this.#list.updateState(id, this.#states.get(id) || null);
      this.#list.updateRuntime(id, this.#runtimeLabel(id));
    }

    // Console Manager details: keep the shown session's pane in step.
    if (this.#selectedId === id) {
      if (terminal && this.#shownSessionId === sessionId) {
        // Keep the pane on the now-dead session so its pill reads Disconnected /
        // Closed (it isn't in #sessions anymore, so drive the pane from `detail`).
        this.#detail.updateSnapshot(detail);
      } else {
        this.#syncSelectedDetail();
      }
    }
    // Overview: a session appeared / changed / ended — rebuild its cards.
    if (this.#activePane === "overview") this.#renderOverview();
  }

  /** Live byte/output heartbeat for a watched session → the shown pane(s). */
  #applyActivity(activity) {
    if (!activity || !activity.sessionId) return;
    if (this.#shownSessionId === activity.sessionId) {
      this.#detail.applyActivity(activity);
    }
    if (this.#activePane === "overview") this.#overview.applyActivity(activity);
  }

  /** The consoleShowOutput setting changed → re-render the shown pane with it. */
  #applyOutputSetting(detail) {
    this.#showOutput = detail?.consoleShowOutput !== false;
    if (this.#activePane === "detail" && this.#selectedId != null) {
      this.#shownSessionId = undefined; // force a fresh show under the new setting
      this.#syncSelectedDetail(); // re-watch reseeds output when re-enabled
    } else if (this.#activePane === "overview") {
      this.#renderOverview();
      this.#watch([...this.#sessions.values()].map((s) => s.sessionId));
    }
  }

  /** Aggregate each console's lamp from its open sessions (connected wins). */
  #recomputeStates() {
    const byConsole = new Map();
    for (const { id, state } of this.#sessions.values()) {
      if (!id) continue;
      const prev = byConsole.get(id);
      if (prev === undefined || rankState(state) > rankState(prev)) {
        byConsole.set(id, state);
      }
    }
    this.#states = byConsole;
  }
}
