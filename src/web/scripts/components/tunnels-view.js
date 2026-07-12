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

// tunnels-view.js — the single master-detail surface that replaced the old
// Definition + Monitoring split. It owns the data (definitions, live states,
// stats snapshots, jump-host records for the breadcrumb) and the shared
// TunnelEditorDialog, and wires the master TunnelList to the TunnelDetail: the
// list reports selection / add / edit / delete; the detail reports arm / pause /
// card-reorder. All native work still flows through `window.porthippo.*`; the
// existing dialogs are reused unchanged for add/edit/delete.

import { el } from "../dom.js";
import { t } from "../i18n.js";
import { PopupManager } from "../popup-manager.js";
import { TunnelEditorDialog } from "./tunnel-editor-dialog.js";
import { TunnelList } from "./tunnel-list.js";
import { TunnelDetail } from "./tunnel-detail.js";

/** Armed = the engine holds this tunnel (anything but disarmed / error). */
function isArmed(state) {
  return Boolean(state) && state !== "disarmed" && state !== "error";
}

export class TunnelsView {
  #el;
  #list;
  #detail;
  #editor;
  #porthippo;
  #now;

  #defs = [];
  #states = new Map();
  #errors = new Map();
  #snaps = new Map();
  #jumpsById = new Map();
  #selectedId = null;
  #cardOrder = null;

  #onStats;
  #onTunnelState;

  constructor({ porthippo, openKeyFile, now } = {}) {
    this.#porthippo = porthippo || window.porthippo;
    this.#now = now || Date.now;

    this.#editor = new TunnelEditorDialog({
      porthippo: this.#porthippo,
      openKeyFile,
      onSubmit: (payload, ctx) => this.#submit(payload, ctx),
      onSaved: (record) => this.#afterSaved(record),
    });

    this.#list = new TunnelList({
      onSelect: (id) => this.#select(id),
      onAdd: () => this.#editor.openCreate(),
      onEdit: (id) => {
        const def = this.#defs.find((d) => d.id === id);
        if (def) this.#editor.openEdit(def);
      },
      onDelete: (id) => this.#confirmDelete(id),
    });

    this.#detail = new TunnelDetail({
      now: this.#now,
      onToggleArm: (id) => this.#toggleArm(id),
      onTogglePause: (id) => this.#togglePause(id),
      onReorder: (order) => this.#persistCardOrder(order),
    });

    this.#el = el("div", { class: "tunnels-view" }, [
      this.#list.element,
      this.#detail.element,
      this.#editor.element,
    ]);

    this.#onStats = (e) => this.#applyStats(e.detail);
    this.#onTunnelState = (e) => this.#applyState(e.detail);
    window.addEventListener("porthippo:stats-updated", this.#onStats);
    window.addEventListener("porthippo:tunnel-state", this.#onTunnelState);
  }

  get element() {
    return this.#el;
  }

  /** Load definitions, jump hosts (breadcrumb), live state + the card order. */
  async load() {
    const [defs, status, jumps, settings] = await Promise.all([
      this.#porthippo?.tunnels?.list?.() ?? [],
      this.#porthippo?.tunnels?.status?.() ?? [],
      this.#porthippo?.jumpHosts?.list?.() ?? [],
      this.#porthippo?.settings?.get?.() ?? {},
    ]);
    this.#defs = Array.isArray(defs) ? defs : [];
    if (Array.isArray(status)) {
      for (const s of status) if (s && s.id) this.#states.set(s.id, s.state);
    }
    this.#jumpsById = new Map(
      (Array.isArray(jumps) ? jumps : []).map((j) => [j.id, j]),
    );
    if (settings && Array.isArray(settings.cardOrder)) {
      this.#cardOrder = settings.cardOrder;
      this.#detail.setCardOrder(this.#cardOrder);
    }

    // Keep the current selection if it still exists, else select the first tunnel.
    if (!this.#defs.some((d) => d.id === this.#selectedId)) {
      this.#selectedId = this.#defs[0]?.id ?? null;
    }
    this.#list.setData(this.#defs, this.#states, this.#selectedId);
    this.#renderDetail();
  }

  /** Open a blank editor (menu/tray "New Tunnel"). */
  createNew() {
    this.#editor.openCreate();
  }

  /** Select + focus a tunnel by id (menu/tray edit affordance). */
  selectById(id) {
    if (this.#defs.some((d) => d.id === id)) this.#select(id);
  }

  destroy() {
    window.removeEventListener("porthippo:stats-updated", this.#onStats);
    window.removeEventListener("porthippo:tunnel-state", this.#onTunnelState);
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  #select(id) {
    this.#selectedId = id;
    this.#list.setSelected(id);
    this.#renderDetail();
  }

  #renderDetail() {
    const def = this.#defs.find((d) => d.id === this.#selectedId);
    if (!def) {
      this.#detail.clear();
      return;
    }
    this.#detail.show(def, {
      state: this.#states.get(def.id) || "disarmed",
      snap: this.#snaps.get(def.id) || null,
      jumpsById: this.#jumpsById,
    });
  }

  // ── Live data ─────────────────────────────────────────────────────────────

  #applyStats(detail) {
    const stats = detail && detail.stats;
    this.#snaps = stats instanceof Map ? stats : new Map();
    for (const snap of this.#snaps.values()) {
      if (!snap || !snap.id) continue;
      this.#states.set(snap.id, snap.state);
      if (snap.error) this.#errors.set(snap.id, snap.error);
      else this.#errors.delete(snap.id);
      this.#list.updateState(snap.id, snap.state);
    }
    if (this.#selectedId) {
      this.#detail.updateSnap(
        this.#snaps.get(this.#selectedId) || null,
        this.#states.get(this.#selectedId),
      );
    }
  }

  #applyState(detail) {
    if (!detail || !detail.id) return;
    if (detail.removed) {
      this.#states.delete(detail.id);
      this.#errors.delete(detail.id);
    } else {
      this.#states.set(detail.id, detail.state);
      if (detail.error) this.#errors.set(detail.id, detail.error);
      else this.#errors.delete(detail.id);
      this.#list.updateState(detail.id, detail.state);
    }
    if (detail.id === this.#selectedId) {
      this.#detail.updateState(this.#states.get(detail.id) || "disarmed");
    }
  }

  // ── Store writes (reuse the existing dialogs) ─────────────────────────────

  #submit(payload, { id }) {
    return id
      ? this.#porthippo.tunnels.update(id, payload)
      : this.#porthippo.tunnels.create(payload);
  }

  async #afterSaved(record) {
    window.dispatchEvent(new CustomEvent("porthippo:tunnels-changed"));
    if (record && record.id) this.#selectedId = record.id; // focus the saved tunnel
    await this.load();
  }

  #confirmDelete(id) {
    const def = this.#defs.find((d) => d.id === id);
    if (!def) return;
    PopupManager.confirmDelete({
      message: t("def.delete.message", { name: def.name || t("def.unnamed") }),
      onConfirm: async () => {
        const result = await this.#porthippo.tunnels.delete(id);
        if (result && result.__hippoError) {
          PopupManager.notify({ message: result.message || "Delete failed" });
          return;
        }
        window.dispatchEvent(new CustomEvent("porthippo:tunnels-changed"));
        if (this.#selectedId === id) this.#selectedId = null;
        await this.load();
      },
    });
  }

  async #toggleArm(id) {
    const armed = isArmed(this.#states.get(id) || "disarmed");
    // Optimistic: reflect the intent; a state broadcast corrects it on success. A
    // refused intent yields no broadcast, so restore the prior state on error.
    const prev = this.#states.get(id) || "disarmed";
    const next = armed ? "disarmed" : "listening";
    this.#setLiveState(id, next);
    const result = await (armed
      ? this.#porthippo?.tunnels?.disarm?.(id)
      : this.#porthippo?.tunnels?.arm?.(id));
    if (result && result.__hippoError) {
      this.#setLiveState(id, prev);
      PopupManager.notify({ message: result.message || "Engine error" });
    }
  }

  async #togglePause(id) {
    const state = this.#states.get(id) || "disarmed";
    if (state !== "connected" && state !== "paused") return;
    const result = await (state === "paused"
      ? this.#porthippo?.tunnels?.resume?.(id)
      : this.#porthippo?.tunnels?.pause?.(id));
    if (result && result.__hippoError) {
      PopupManager.notify({ message: result.message || "Engine error" });
    }
  }

  #setLiveState(id, state) {
    this.#states.set(id, state);
    this.#list.updateState(id, state);
    if (id === this.#selectedId) this.#detail.updateState(state);
  }

  #persistCardOrder(order) {
    this.#cardOrder = order;
    this.#porthippo?.settings?.set?.({ cardOrder: order })?.catch?.(() => {});
  }
}
