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

// tunnel-detail.js — the detail panel for the selected tunnel. Its title is a
// virtual breadcrumb of the route (local → jump hosts → SSH server → target) with
// arm/disarm + pause/resume icon controls on the right; below it is a grid of
// drag-and-drop rearrangeable stat cards. It is a pure view: numbers arrive via
// updateSnap(), state via updateState(), and every action is reported back through
// constructor callbacks. Card order is fed in / reported out (persisted by the
// owner in settings).

import { el, clear } from "../dom.js";
import { t } from "../i18n.js";
import { icons } from "../icons.js";
import {
  formatRate,
  formatBytes,
  formatDuration,
  formatRelativeTime,
} from "../utils/format.js";

/** Armed = the engine holds this tunnel (anything but disarmed / error). */
function isArmed(state) {
  return Boolean(state) && state !== "disarmed" && state !== "error";
}

// The card catalogue. `value(ctx)` maps a snapshot (+ now + live state) to a
// display string; `tone` colours the value. Order here is the DEFAULT order.
const CARDS = [
  {
    key: "download",
    labelKey: "card.download",
    tone: "down",
    value: (c) => formatRate(c.snap?.rateDown ?? 0),
  },
  {
    key: "upload",
    labelKey: "card.upload",
    tone: "up",
    value: (c) => formatRate(c.snap?.rateUp ?? 0),
  },
  {
    key: "connections",
    labelKey: "card.connections",
    value: (c) => String(c.snap?.activeConnections ?? 0),
  },
  {
    key: "transferred",
    labelKey: "card.transferred",
    value: (c) => formatBytes(c.snap?.totalBytes ?? 0),
  },
  {
    key: "openFor",
    labelKey: "card.openFor",
    value: (c) =>
      c.snap?.openedAt
        ? formatDuration(c.now - c.snap.openedAt)
        : t("card.none"),
  },
  {
    key: "state",
    labelKey: "card.state",
    stateTone: true,
    value: (c) => t(`state.${c.state}`),
  },
  {
    key: "sent",
    labelKey: "card.sent",
    value: (c) => formatBytes(c.snap?.bytesUp ?? 0),
  },
  {
    key: "received",
    labelKey: "card.received",
    value: (c) => formatBytes(c.snap?.bytesDown ?? 0),
  },
  {
    key: "connectionCount",
    labelKey: "card.connectionCount",
    value: (c) => String(c.snap?.connectionCount ?? 0),
  },
  {
    key: "errors",
    labelKey: "card.errors",
    toneFn: (c) => ((c.snap?.errorCount ?? 0) > 0 ? "error" : null),
    value: (c) => String(c.snap?.errorCount ?? 0),
  },
  {
    key: "idle",
    labelKey: "card.idle",
    value: (c) =>
      c.snap?.lastActiveAt
        ? formatDuration(c.now - c.snap.lastActiveAt)
        : t("card.none"),
  },
  {
    key: "firstConnection",
    labelKey: "card.firstConnection",
    value: (c) => formatRelativeTime(c.snap?.firstConnectedAt, c.now),
  },
  {
    key: "lastConnection",
    labelKey: "card.lastConnection",
    value: (c) => formatRelativeTime(c.snap?.openedAt, c.now),
  },
  {
    key: "lastDisconnect",
    labelKey: "card.lastDisconnect",
    value: (c) => formatRelativeTime(c.snap?.lastDisconnectedAt, c.now),
  },
];

const CARD_BY_KEY = new Map(CARDS.map((cd) => [cd.key, cd]));
export const DEFAULT_CARD_ORDER = CARDS.map((cd) => cd.key);

/**
 * The VISIBLE cards, in order, for a saved value. A saved array IS the visible
 * set (unknown keys dropped, de-duped); any valid card absent from it is hidden
 * and available to add. A missing/invalid value is "first run" → every card is
 * shown. An empty array is honoured (the user hid them all).
 */
export function visibleCards(saved) {
  if (!Array.isArray(saved)) return [...DEFAULT_CARD_ORDER];
  const seen = new Set();
  const out = [];
  for (const k of saved) {
    if (CARD_BY_KEY.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** The cards NOT currently visible, in default order — the "add" list. */
export function hiddenCards(visible) {
  const shown = new Set(visible);
  return DEFAULT_CARD_ORDER.filter((k) => !shown.has(k));
}

/** Label for a card key (for the manage-cards checklist). */
export function cardLabel(key) {
  const c = CARD_BY_KEY.get(key);
  return c ? t(c.labelKey) : key;
}

/** Move `fromKey` to `toKey`'s slot; pure so it can be unit-tested. */
export function reorderCards(order, fromKey, toKey) {
  if (fromKey === toKey) return [...order];
  const without = order.filter((k) => k !== fromKey);
  const idx = without.indexOf(toKey);
  if (idx === -1) return [...without, fromKey];
  without.splice(idx, 0, fromKey);
  return without;
}

export class TunnelDetail {
  #el;
  #emptyEl;
  #contentEl;
  #breadcrumbEl;
  #armBtn;
  #pauseBtn;
  #cardsEl;

  #cardsBtn;
  #cardMenu;
  #menuBoxes = new Map(); // card key → checkbox input

  #def = null;
  #state = "disarmed";
  #snap = null;
  #jumpsById = new Map();
  #visible = [...DEFAULT_CARD_ORDER]; // ordered VISIBLE card keys
  #cardNodes = new Map(); // key → { root, valueEl }
  #dragKey = null;
  #menuOpen = false;
  #onDocPointerDown;
  #onMenuKeydown;

  #now;
  #onToggleArm;
  #onTogglePause;
  #onCardsChange;

  constructor({ now, onToggleArm, onTogglePause, onCardsChange } = {}) {
    this.#now = now || Date.now;
    this.#onToggleArm = onToggleArm || (() => {});
    this.#onTogglePause = onTogglePause || (() => {});
    this.#onCardsChange = onCardsChange || (() => {});
    // Close the manage-cards menu on an outside click / Escape.
    this.#onDocPointerDown = (e) => {
      if (this.#menuOpen && !this.#cardMenu.parentNode.contains(e.target)) {
        this.#closeCardMenu();
      }
    };
    this.#onMenuKeydown = (e) => {
      if (e.key === "Escape") this.#closeCardMenu();
    };
    this.#el = this.#build();
  }

  get element() {
    return this.#el;
  }

  #build() {
    this.#emptyEl = el("div", { class: "detail-empty" }, [
      el("p", { class: "detail-empty-hint", text: t("tunnels.selectHint") }),
    ]);

    this.#breadcrumbEl = el("div", {
      class: "detail-route",
      "aria-label": t("detail.route.target"),
    });

    this.#armBtn = el("button", {
      class: "btn--icon detail-ctrl detail-arm-btn",
      type: "button",
      html: icons.power(),
      onClick: () => this.#def && this.#onToggleArm(this.#def.id),
    });
    this.#pauseBtn = el("button", {
      class: "btn--icon detail-ctrl detail-pause-btn",
      type: "button",
      html: icons.pause(),
      onClick: () => this.#def && this.#onTogglePause(this.#def.id),
    });

    this.#cardsEl = el("div", { class: "detail-cards", role: "list" });

    // "Cards" control: a button that toggles a checklist of every card
    // (checked = shown). Anchored in a relative wrapper so the menu drops beneath.
    this.#cardsBtn = el("button", {
      class: "detail-ctrl detail-cards-btn",
      type: "button",
      title: t("detail.cards.title"),
      "aria-haspopup": "true",
      "aria-expanded": "false",
      onClick: (e) => {
        e.stopPropagation();
        this.#toggleCardMenu();
      },
    });
    this.#cardsBtn.append(
      document.createTextNode(t("detail.cards")),
      el("span", { class: "detail-cards-caret", html: icons.chevronDown() }),
    );
    this.#cardMenu = this.#buildCardMenu();
    const cardsMenuWrap = el("div", { class: "detail-cards-menu-wrap" }, [
      this.#cardsBtn,
      this.#cardMenu,
    ]);

    this.#contentEl = el("div", { class: "detail-content", hidden: true }, [
      el("div", { class: "detail-title" }, [
        this.#breadcrumbEl,
        el("div", { class: "detail-controls" }, [
          cardsMenuWrap,
          this.#pauseBtn,
          this.#armBtn,
        ]),
      ]),
      this.#cardsEl,
    ]);

    return el(
      "section",
      { class: "tunnel-detail", "aria-label": t("tunnels.title") },
      [this.#emptyEl, this.#contentEl],
    );
  }

  /** Adopt the persisted set of visible cards, in order (re-renders if shown). */
  setCardOrder(order) {
    this.#visible = visibleCards(order);
    this.#syncCardMenu();
    if (this.#def) this.#renderCards();
  }

  /** Show a tunnel's details. `ctx` carries the live state, latest snapshot, and
   *  a jumpHost-by-id map for the breadcrumb. */
  show(def, { state = "disarmed", snap = null, jumpsById } = {}) {
    this.#def = def || null;
    this.#state = state;
    this.#snap = snap;
    if (jumpsById instanceof Map) this.#jumpsById = jumpsById;
    this.#renderAll();
  }

  /** No tunnel selected → the empty hint. */
  clear() {
    this.#def = null;
    this.#renderAll();
  }

  /** Fold in a fresh snapshot (+ optional state) and update values in place. */
  updateSnap(snap, state) {
    this.#snap = snap;
    if (state) this.#state = state;
    if (!this.#def) return;
    this.#updateValues();
    this.#updateControls();
  }

  /** A discrete state change: refresh the controls + the State card. */
  updateState(state) {
    this.#state = state;
    if (!this.#def) return;
    this.#updateControls();
    this.#updateValues();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  #renderAll() {
    const has = Boolean(this.#def);
    this.#emptyEl.hidden = has;
    this.#contentEl.hidden = !has;
    if (!has) return;
    this.#renderBreadcrumb();
    this.#renderCards();
    this.#updateControls();
  }

  #routeSegments() {
    const d = this.#def || {};
    const segs = [`${d.bindHost || "127.0.0.1"}:${d.localPort ?? "?"}`];
    for (const id of d.jumpHostIds || []) {
      const jh = this.#jumpsById.get(id);
      segs.push(jh ? jh.label || `${jh.host}:${jh.port}` : id);
    }
    if (typeof d.sshHost === "string" && d.sshHost.trim() !== "") {
      segs.push(`${d.sshHost}:${d.sshPort ?? 22}`);
    }
    segs.push(`${d.destination?.host ?? "?"}:${d.destination?.port ?? "?"}`);
    return segs;
  }

  #renderBreadcrumb() {
    clear(this.#breadcrumbEl);
    const segs = this.#routeSegments();
    segs.forEach((seg, i) => {
      if (i > 0) {
        this.#breadcrumbEl.appendChild(
          el("span", { class: "route-sep", "aria-hidden": "true", text: "›" }),
        );
      }
      const last = i === segs.length - 1;
      this.#breadcrumbEl.appendChild(
        el("span", {
          class: `route-seg${last ? " route-seg--target" : ""}${i === 0 ? " route-seg--local" : ""}`,
          text: seg,
        }),
      );
    });
  }

  #renderCards() {
    clear(this.#cardsEl);
    this.#cardNodes.clear();
    if (this.#visible.length === 0) {
      this.#cardsEl.appendChild(
        el("p", {
          class: "detail-cards-empty",
          text: t("detail.cards.empty"),
        }),
      );
      return;
    }
    for (const key of this.#visible) {
      const card = CARD_BY_KEY.get(key);
      if (!card) continue;
      const valueEl = el("div", { class: "card-value" });
      const root = el(
        "div",
        {
          class: "detail-card",
          role: "listitem",
          draggable: "true",
          dataset: { card: key },
          onDragstart: (e) => this.#onDragStart(e, key),
          onDragover: (e) => this.#onDragOver(e, key),
          onDragleave: () => root.classList.remove("detail-card--drop"),
          onDrop: (e) => this.#onDrop(e, key),
          onDragend: () => this.#clearDropMarks(),
        },
        [el("div", { class: "card-label", text: t(card.labelKey) }), valueEl],
      );
      this.#cardNodes.set(key, { root, valueEl, card });
      this.#cardsEl.appendChild(root);
    }
    this.#updateValues();
  }

  #updateValues() {
    const ctx = { snap: this.#snap, now: this.#now(), state: this.#state };
    for (const [, rec] of this.#cardNodes) {
      rec.valueEl.textContent = rec.card.value(ctx);
      rec.valueEl.className = "card-value";
      const tone = rec.card.toneFn ? rec.card.toneFn(ctx) : rec.card.tone;
      if (tone) rec.valueEl.classList.add(`card-value--${tone}`);
      if (rec.card.stateTone) {
        rec.valueEl.classList.add(`card-value--state-${this.#state}`);
      }
    }
  }

  #updateControls() {
    const armed = isArmed(this.#state);
    this.#armBtn.classList.toggle("detail-arm-btn--armed", armed);
    const armLabel = armed ? t("detail.disarm") : t("detail.arm");
    this.#armBtn.title = armLabel;
    this.#armBtn.setAttribute("aria-label", armLabel);

    const paused = this.#state === "paused";
    const canPause = this.#state === "connected" || paused;
    this.#pauseBtn.innerHTML = paused ? icons.play() : icons.pause();
    const pauseLabel = paused ? t("detail.resume") : t("detail.pause");
    this.#pauseBtn.title = pauseLabel;
    this.#pauseBtn.setAttribute("aria-label", pauseLabel);
    this.#pauseBtn.disabled = !canPause;
  }

  // ── Drag-and-drop card ordering ───────────────────────────────────────────

  #onDragStart(e, key) {
    this.#dragKey = key;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // Firefox requires data to be set for a drag to start.
      try {
        e.dataTransfer.setData("text/plain", key);
      } catch {
        // ignore — jsdom / restricted environments
      }
    }
    this.#cardNodes.get(key)?.root.classList.add("detail-card--dragging");
  }

  #onDragOver(e, key) {
    if (!this.#dragKey || this.#dragKey === key) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rec = this.#cardNodes.get(key);
    if (rec) rec.root.classList.add("detail-card--drop");
  }

  #onDrop(e, key) {
    e.preventDefault();
    const from = this.#dragKey;
    this.#clearDropMarks();
    if (!from || from === key) return;
    this.#visible = reorderCards(this.#visible, from, key);
    this.#renderCards();
    this.#onCardsChange([...this.#visible]);
  }

  #clearDropMarks() {
    this.#dragKey = null;
    for (const [, rec] of this.#cardNodes) {
      rec.root.classList.remove("detail-card--drop", "detail-card--dragging");
    }
  }

  // ── Manage cards (the checklist menu — add + remove) ──────────────────────

  #buildCardMenu() {
    this.#menuBoxes.clear();
    const items = DEFAULT_CARD_ORDER.map((key) => {
      const box = el("input", {
        type: "checkbox",
        class: "card-menu-check",
        dataset: { card: key },
        onChange: (e) => this.#toggleCard(key, e.target.checked),
      });
      this.#menuBoxes.set(key, box);
      return el("label", { class: "card-menu-item" }, [
        box,
        el("span", { class: "card-menu-label", text: cardLabel(key) }),
      ]);
    });
    return el("div", { class: "card-menu", role: "menu", hidden: true }, [
      el("div", {
        class: "card-menu-title",
        text: t("detail.cards.menuTitle"),
      }),
      el("div", { class: "card-menu-grid" }, items),
    ]);
  }

  #syncCardMenu() {
    const shown = new Set(this.#visible);
    for (const [key, box] of this.#menuBoxes) box.checked = shown.has(key);
  }

  #toggleCardMenu() {
    if (this.#menuOpen) this.#closeCardMenu();
    else this.#openCardMenu();
  }

  #openCardMenu() {
    this.#syncCardMenu();
    this.#menuOpen = true;
    this.#cardMenu.hidden = false;
    this.#cardsBtn.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", this.#onDocPointerDown, true);
    document.addEventListener("keydown", this.#onMenuKeydown);
  }

  #closeCardMenu() {
    this.#menuOpen = false;
    this.#cardMenu.hidden = true;
    this.#cardsBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.#onDocPointerDown, true);
    document.removeEventListener("keydown", this.#onMenuKeydown);
  }

  /** Show/hide a card from the checklist (appends when re-shown). */
  #toggleCard(key, show) {
    const shown = this.#visible.includes(key);
    if (show === shown) return;
    this.#visible = show
      ? [...this.#visible, key]
      : this.#visible.filter((k) => k !== key);
    this.#renderCards();
    this.#onCardsChange([...this.#visible]);
  }
}
