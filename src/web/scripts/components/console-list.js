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

// console-list.js — the CONSOLES section of the sidebar (Feature 200): a list of
// console rows, one each with a session status signal, a terminal glyph, and the
// name. An Add icon sits in the header; open / edit / delete / assign-to-group live
// on the row's right-click context menu (owned by ConsolesView). Double-click or
// Enter opens the console.
//
// Grouping mirrors the tunnel sidebar (Feature 140), reusing the same DOM-free
// grouping model + CSS: consoles belong to zero or one of the SHARED groups, which
// render as collapsible sections with a drag-to-reassign / drag-to-reorder tree.
// Consoles have no arm/pause, so the group header carries no arm-all/pause-all
// controls (just a chevron, colour swatch, name, and an open/total rollup). Unlike
// tunnels, an EMPTY group is hidden here (it stays available in the "Assign to
// group" menu); only groups that actually hold a console get a section.

import { el, clear } from "../dom.js";
import { t } from "../i18n.js";
import { icons } from "../icons.js";
import { buildSignal, signalLamp } from "./tunnel-list.js";
import {
  buildSections,
  groupColorKey,
  UNGROUPED_ID,
} from "./tunnel-grouping.js";

/** A console counts as "open" for the group rollup once it has a live session. */
function isOpenState(state) {
  return Boolean(state) && state !== "disarmed";
}

/** Open / total rollup for a section's consoles. */
function sectionOpenRollup(defs, states) {
  const get = states instanceof Map ? (id) => states.get(id) : () => undefined;
  let open = 0;
  for (const d of defs) if (isOpenState(get(d.id))) open++;
  return { open, total: defs.length };
}

export class ConsoleList {
  #el;
  #listEl;
  #emptyEl;
  #defs = [];
  #states = new Map(); // consoleId → session state (connecting|connected|…)
  #selectedId = null;
  #rows = new Map(); // id → { root, signal }
  #sections = new Map(); // sectionId → { header, rollupEl, defs }

  // Grouping (shared groups): empty groups → flat list, unchanged.
  #groups = [];
  #collapsedIds = new Set();
  #drag = null; // { kind: "console"|"group", id } during a drag
  #dropSectionId = null;
  #dropHeaderOnly = false;
  #placeholder = null;
  #insert = null; // { groupId, beforeId } pending drop, or null

  #onSelect;
  #onAdd;
  #onOpen;
  #onContextMenu;
  #onToggleCollapse;
  #onGroupMenu;
  #onMoveConsole;
  #onReorderGroups;

  constructor({
    onSelect,
    onAdd,
    onOpen,
    onContextMenu,
    onToggleCollapse,
    onGroupMenu,
    onMoveConsole,
    onReorderGroups,
  } = {}) {
    this.#onSelect = onSelect || (() => {});
    this.#onAdd = onAdd || (() => {});
    this.#onOpen = onOpen || (() => {});
    this.#onContextMenu = onContextMenu || (() => {});
    this.#onToggleCollapse = onToggleCollapse || (() => {});
    this.#onGroupMenu = onGroupMenu || (() => {});
    this.#onMoveConsole = onMoveConsole || (() => {});
    this.#onReorderGroups = onReorderGroups || (() => {});
    this.#el = this.#build();
  }

  get element() {
    return this.#el;
  }

  #build() {
    this.#listEl = el("div", {
      class: "tunnel-list",
      role: "list",
      onDragover: (e) => this.#onListDragOver(e),
      onDrop: (e) => this.#onListDrop(e),
      onDragleave: (e) => this.#onListDragLeave(e),
    });
    this.#emptyEl = el("div", { class: "tunnel-list-empty" }, [
      el("p", { class: "tunnel-list-empty-title", text: t("consoles.empty") }),
      el("p", {
        class: "tunnel-list-empty-hint",
        text: t("consoles.emptyHint"),
      }),
    ]);

    const addBtn = el("button", {
      class: "btn--icon tunnel-add-btn",
      type: "button",
      title: t("consoles.add"),
      "aria-label": t("consoles.add"),
      html: icons.add(),
      onClick: () => this.#onAdd(),
    });

    return el(
      "aside",
      {
        class: "tunnel-sidebar tunnel-sidebar--consoles",
        "aria-label": t("consoles.title"),
      },
      [
        el("div", { class: "tunnel-sidebar-header" }, [
          el("span", {
            class: "tunnel-sidebar-title",
            text: t("consoles.title"),
          }),
          addBtn,
        ]),
        this.#emptyEl,
        this.#listEl,
      ],
    );
  }

  /** Feed the console list + a per-console session-state map + the selection. */
  setData(defs, states, selectedId) {
    this.#defs = Array.isArray(defs) ? defs : [];
    this.#states = states instanceof Map ? states : new Map();
    if (selectedId !== undefined) this.#selectedId = selectedId;
    this.#render();
  }

  /** Feed the grouping context (shared groups + collapsed section ids). */
  setGrouping({ groups, collapsedIds } = {}) {
    if (groups !== undefined)
      this.#groups = Array.isArray(groups) ? groups : [];
    if (collapsedIds !== undefined) this.#collapsedIds = toSet(collapsedIds);
    this.#render();
  }

  /** Highlight the selected row (no re-render). */
  setSelected(id) {
    this.#selectedId = id;
    for (const [rowId, rec] of this.#rows) {
      const on = rowId === id;
      rec.root.classList.toggle("tunnel-row--selected", on);
      rec.root.setAttribute("aria-selected", String(on));
    }
  }

  /** Update one row's session status signal in place from a live-state change. */
  updateState(id, state) {
    if (state) this.#states.set(id, state);
    else this.#states.delete(id);
    const rec = this.#rows.get(id);
    if (rec) {
      const lamp = signalLamp(state);
      rec.signal.className = `tunnel-signal${lamp === "off" ? "" : ` tunnel-signal--${lamp}`}`;
      rec.signal.title = t(`state.${state || "disarmed"}`);
      rec.signal.setAttribute("aria-label", t(`state.${state || "disarmed"}`));
    }
    this.#refreshHeaders();
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  #render() {
    clear(this.#listEl);
    this.#rows.clear();
    this.#sections.clear();
    const empty = this.#defs.length === 0;
    this.#emptyEl.hidden = !empty;
    this.#listEl.hidden = empty;

    const sections = buildSections(
      this.#defs,
      this.#groups,
      this.#collapsedIds,
    );
    if (!sections) {
      // No groups → the flat list, unchanged.
      for (const def of this.#defs) this.#appendRow(def, null);
    } else {
      // buildSections already omits empty groups (they stay in the Assign menu), so
      // every section here holds at least one console.
      for (const section of sections) {
        this.#listEl.appendChild(this.#buildGroupHeader(section));
        if (!section.collapsed) {
          for (const def of section.defs) this.#appendRow(def, section);
        }
      }
    }
    this.setSelected(this.#selectedId);
  }

  #appendRow(def, section) {
    const rec = this.#buildRow(def, section);
    this.#rows.set(def.id, rec);
    this.#listEl.appendChild(rec.root);
  }

  #buildRow(def, section) {
    const state = this.#states.get(def.id) || "disarmed";
    const signal = buildSignal(state);

    const typeIcon = el("span", {
      class: "tunnel-type-icon tunnel-type-icon--console",
      html: icons.terminal(),
      role: "img",
      title: t("consoles.title"),
      "aria-label": t("consoles.title"),
    });

    const root = el(
      "div",
      {
        class: "tunnel-row",
        role: "listitem",
        tabindex: "0",
        draggable: "true",
        dataset: section ? { id: def.id, section: section.id } : { id: def.id },
        onClick: () => this.#onSelect(def.id),
        // Double-click opens the console shell (like double-clicking a file).
        onDblclick: () => this.#onOpen(def.id),
        onKeydown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.#onOpen(def.id);
          } else if (e.key === " ") {
            e.preventDefault();
            this.#onSelect(def.id);
          }
        },
        onContextmenu: (e) => {
          e.preventDefault();
          this.#onContextMenu(def.id);
        },
        onDragstart: (e) => this.#onRowDragStart(e, def.id),
        onDragend: () => this.#clearDrag(),
      },
      [
        signal,
        typeIcon,
        el("span", {
          class: "tunnel-row-name",
          text: def.name || t("consoles.unnamed"),
        }),
      ],
    );

    return { root, signal, sectionId: section ? section.id : null };
  }

  #buildGroupHeader(section) {
    const group = section.group;
    const rollup = sectionOpenRollup(section.defs, this.#states);
    const name = group ? group.label : t("group.ungrouped");

    const chevron = el("button", {
      class: "group-chevron btn--icon",
      type: "button",
      "aria-label": section.collapsed ? t("group.expand") : t("group.collapse"),
      html: icons.chevronDown(),
      onClick: (e) => {
        e.stopPropagation();
        this.#onToggleCollapse(section.id);
      },
    });

    const swatch = group
      ? el("span", {
          class: `group-swatch group-swatch--${groupColorKey(group)} group-chip`,
          "aria-hidden": "true",
        })
      : el("span", { class: "group-chip group-chip--ungrouped" });

    const nameEl = el("span", { class: "group-name", text: name });
    // Reuse the tunnels' `{armed}/{total}` count template — here it reads
    // open-sessions / total, the console analogue of armed / total.
    const rollupEl = el("span", {
      class: "group-count",
      text: t("group.count", { armed: rollup.open, total: rollup.total }),
    });

    const header = el(
      "div",
      {
        class: `group-header group-header--consoles${section.collapsed ? " group-header--collapsed" : ""}`,
        role: "listitem",
        dataset: { section: section.id },
        "aria-expanded": String(!section.collapsed),
        // A real group is draggable to reorder; both kinds accept a row drop.
        draggable: group ? "true" : null,
        onClick: () => this.#onToggleCollapse(section.id),
        onContextmenu: (e) => {
          e.preventDefault();
          this.#onGroupMenu(section.id);
        },
        onDragstart: group
          ? (e) => this.#onHeaderDragStart(e, group.id)
          : undefined,
        onDragend: () => this.#clearDrag(),
      },
      [chevron, swatch, nameEl, rollupEl],
    );

    this.#sections.set(section.id, {
      header,
      rollupEl,
      defs: section.defs,
    });
    return header;
  }

  /** Recompute every group header's open/total rollup in place (no re-render). */
  #refreshHeaders() {
    for (const [, rec] of this.#sections) {
      const rollup = sectionOpenRollup(rec.defs, this.#states);
      rec.rollupEl.textContent = t("group.count", {
        armed: rollup.open,
        total: rollup.total,
      });
    }
  }

  // ── Drag & drop (row → reassign + resequence; group header → reorder) ─────────
  // Ported verbatim from tunnel-list.js so the tree behaves identically; consoles
  // just report onMoveConsole / onReorderGroups instead of the tunnel callbacks.

  #onRowDragStart(e, id) {
    this.#drag = { kind: "console", id };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", id);
      } catch {
        // ignore — jsdom / restricted environments
      }
    }
  }

  #onHeaderDragStart(e, groupId) {
    this.#drag = { kind: "group", id: groupId };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", groupId);
      } catch {
        // ignore
      }
    }
    e.currentTarget.classList.add("group-header--dragging");
  }

  #onListDragOver(e) {
    const drag = this.#drag;
    if (!drag) return;

    if (drag.kind === "group") {
      const headerEl = e.target?.closest?.(".group-header");
      const sectionId = headerEl?.dataset.section;
      if (
        sectionId &&
        sectionId !== drag.id &&
        this.#groups.some((g) => g.id === sectionId)
      ) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        this.#showDrop(sectionId, true);
      } else {
        this.#clearDropHighlight();
      }
      this.#clearPlaceholder();
      return;
    }

    if (
      this.#placeholder &&
      (e.target === this.#placeholder || this.#placeholder.contains(e.target))
    ) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      return;
    }
    const rowEl = e.target?.closest?.(".tunnel-row");
    const headerEl = e.target?.closest?.(".group-header");
    if (rowEl && rowEl.dataset.section != null) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      this.#showDrop(rowEl.dataset.section, false);
      this.#gapAtRow(rowEl, e.clientY);
    } else if (headerEl) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      this.#showDrop(headerEl.dataset.section, false);
      this.#gapAtHeader(headerEl);
    } else if (this.#pointerWithinDropSection(e.clientY)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    } else {
      this.#clearDropHighlight();
      this.#clearPlaceholder();
    }
  }

  #onListDrop(e) {
    const drag = this.#drag;
    const insert = this.#insert;
    const headerOnly = this.#dropHeaderOnly;
    const dropSection = this.#dropSectionId;
    this.#clearDrag();
    if (!drag) return;
    if (drag.kind === "console") {
      if (!insert) return; // dropped off any group → cancel
      e.preventDefault();
      this.#onMoveConsole(drag.id, insert.groupId, insert.beforeId);
    } else if (
      drag.kind === "group" &&
      headerOnly &&
      dropSection &&
      dropSection !== drag.id &&
      this.#groups.some((g) => g.id === dropSection)
    ) {
      e.preventDefault();
      this.#onReorderGroups(drag.id, dropSection);
    }
  }

  #onListDragLeave(e) {
    if (e.relatedTarget && this.#listEl.contains(e.relatedTarget)) return;
    this.#clearDropHighlight();
    this.#clearPlaceholder();
  }

  // ── Drop gap (the "blank entry") ─────────────────────────────────────────────

  #ensurePlaceholder() {
    if (!this.#placeholder) {
      this.#placeholder = el("div", {
        class: "tunnel-row-placeholder",
        "aria-hidden": "true",
      });
    }
    return this.#placeholder;
  }

  #gapAtRow(rowEl, clientY) {
    const ph = this.#ensurePlaceholder();
    if (ph.parentNode) ph.remove();
    const rect = rowEl.getBoundingClientRect();
    const after =
      Number.isFinite(clientY) && clientY > rect.top + rect.height / 2;
    this.#listEl.insertBefore(ph, after ? rowEl.nextSibling : rowEl);
    this.#setDraggedHidden(true);
    this.#recordInsert(rowEl.dataset.section);
  }

  #gapAtHeader(headerEl) {
    const ph = this.#ensurePlaceholder();
    if (ph.parentNode) ph.remove();
    this.#listEl.insertBefore(ph, headerEl.nextSibling);
    this.#setDraggedHidden(true);
    this.#recordInsert(headerEl.dataset.section);
  }

  #setDraggedHidden(hidden) {
    if (this.#drag?.kind !== "console") return;
    this.#rows
      .get(this.#drag.id)
      ?.root.classList.toggle("tunnel-row--dragging", hidden);
  }

  #recordInsert(sectionId) {
    let n = this.#placeholder.nextElementSibling;
    const draggedId = this.#drag?.id;
    while (
      n &&
      n.classList?.contains("tunnel-row") &&
      n.dataset.id === draggedId
    ) {
      n = n.nextElementSibling;
    }
    const beforeId =
      n &&
      n.classList?.contains("tunnel-row") &&
      n.dataset.section === sectionId
        ? n.dataset.id
        : null; // end of the section
    this.#insert = {
      groupId: sectionId === UNGROUPED_ID ? null : sectionId,
      beforeId,
    };
  }

  #pointerWithinDropSection(clientY) {
    if (this.#dropSectionId == null || !Number.isFinite(clientY)) return false;
    const sec = this.#sections.get(this.#dropSectionId);
    if (!sec?.header) return false;
    let top = sec.header.getBoundingClientRect().top;
    let bottom = sec.header.getBoundingClientRect().bottom;
    const extend = (node) => {
      const r = node.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) return;
      if (r.top < top) top = r.top;
      if (r.bottom > bottom) bottom = r.bottom;
    };
    for (const rec of this.#rows.values())
      if (rec.sectionId === this.#dropSectionId) extend(rec.root);
    if (this.#placeholder?.parentNode) extend(this.#placeholder);
    return clientY >= top && clientY <= bottom;
  }

  #clearPlaceholder() {
    if (this.#placeholder?.parentNode) this.#placeholder.remove();
    this.#setDraggedHidden(false);
    this.#insert = null;
  }

  #showDrop(sectionId, headerOnly) {
    if (
      this.#dropSectionId === sectionId &&
      this.#dropHeaderOnly === headerOnly
    )
      return;
    this.#clearDropHighlight();
    this.#dropSectionId = sectionId;
    this.#dropHeaderOnly = headerOnly;
    this.#sections.get(sectionId)?.header?.classList.add("group-header--drop");
    if (!headerOnly) {
      for (const rec of this.#rows.values()) {
        if (rec.sectionId === sectionId)
          rec.root.classList.add("tunnel-row--drop");
      }
    }
  }

  #clearDropHighlight() {
    if (this.#dropSectionId == null) return;
    this.#sections
      .get(this.#dropSectionId)
      ?.header?.classList.remove("group-header--drop");
    for (const rec of this.#rows.values())
      rec.root.classList.remove("tunnel-row--drop");
    this.#dropSectionId = null;
    this.#dropHeaderOnly = false;
  }

  #clearDrag() {
    this.#clearDropHighlight();
    this.#clearPlaceholder();
    if (this.#drag?.kind === "console") {
      this.#rows
        .get(this.#drag.id)
        ?.root.classList.remove("tunnel-row--dragging");
    }
    this.#drag = null;
    for (const rec of this.#sections.values()) {
      rec.header?.classList.remove("group-header--dragging");
    }
  }
}

/** Coerce a Set | array | falsy into a Set. */
function toSet(v) {
  if (v instanceof Set) return v;
  return new Set(Array.isArray(v) ? v : []);
}
