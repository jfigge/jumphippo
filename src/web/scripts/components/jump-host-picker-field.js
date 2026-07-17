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

// jump-host-picker-field.js — build the ordered jump-host chain a tunnel routes
// through. It renders the chosen hops as a reorderable list, plus an "add" row (a
// <select> of the remaining jump hosts and a "New…" that opens the
// JumpHostEditorDialog). Row order IS hop order; the chosen ids are reported up as
// `jumpHostIds[]` via the `onChange` callback. Reloads on
// `jumphippo:jumphosts-changed`, preserving the chain (dropping any deleted ref).

import { el, clear } from "../dom.js";
import { t } from "../i18n.js";
import { JumpHostEditorDialog } from "./jump-host-editor-dialog.js";

export class JumpHostPickerField {
  #el;
  #listEl;
  #emptyEl;
  #addSelect;
  #jumphippo;
  #openKeyFile;
  #onChange;
  #jumpHosts = []; // available records
  #chain = []; // ordered selected ids
  #editor = null;
  #onJumpsChanged;

  /**
   * @param {object} [opts]
   * @param {object} [opts.jumphippo]
   * @param {(ids: string[]) => void} [opts.onChange]
   * @param {() => Promise<string|null>} [opts.openKeyFile]
   */
  constructor({ jumphippo, onChange, openKeyFile } = {}) {
    this.#jumphippo = jumphippo || window.jumphippo;
    this.#openKeyFile = openKeyFile;
    this.#onChange = onChange;
    this.#el = this.#build();

    this.#onJumpsChanged = () => this.refresh();
    window.addEventListener(
      "jumphippo:jumphosts-changed",
      this.#onJumpsChanged,
    );
  }

  get element() {
    return this.#el;
  }

  /** The ordered chain of jump-host ids. */
  get value() {
    return [...this.#chain];
  }

  /** Replace the chain (ids not in the known set are kept until refresh prunes). */
  setValue(ids) {
    this.#chain = Array.isArray(ids)
      ? ids.filter((x) => typeof x === "string")
      : [];
    this.#render();
  }

  /** Load available jump hosts. Call once after mount. */
  async load() {
    await this.refresh();
  }

  /** Reload the available jump hosts, pruning any chain ref that no longer exists. */
  async refresh() {
    const list = (await this.#jumphippo?.jumpHosts?.list?.()) || [];
    this.#jumpHosts = Array.isArray(list) ? list : [];
    const known = new Set(this.#jumpHosts.map((j) => j.id));
    const pruned = this.#chain.filter((id) => known.has(id));
    if (pruned.length !== this.#chain.length) {
      this.#chain = pruned;
      this.#onChange?.(this.value);
    }
    this.#render();
  }

  destroy() {
    window.removeEventListener(
      "jumphippo:jumphosts-changed",
      this.#onJumpsChanged,
    );
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  #build() {
    this.#listEl = el("div", { class: "jumps-chain" });
    this.#emptyEl = el("p", { class: "jumps-empty", text: t("jumps.empty") });
    this.#addSelect = el("select", {
      class: "dialog-input jumps-add-select",
      "aria-label": t("jumps.choose"),
      onChange: (e) => this.#add(e.target.value),
    });
    const newBtn = el("button", {
      class: "btn btn--secondary jumps-new-btn",
      type: "button",
      text: t("jumps.new"),
      onClick: () => this.#openNew(),
    });

    return el("div", { class: "jump-host-picker" }, [
      el("div", { class: "jumps-header" }, [
        el("span", { class: "jumps-header-title", text: t("editor.jumps") }),
      ]),
      this.#emptyEl,
      this.#listEl,
      el("div", { class: "picker-row jumps-add-row" }, [
        this.#addSelect,
        newBtn,
      ]),
    ]);
  }

  #byId(id) {
    return this.#jumpHosts.find((j) => j.id === id);
  }

  #render() {
    // Chain rows.
    clear(this.#listEl);
    this.#emptyEl.hidden = this.#chain.length > 0;
    this.#chain.forEach((id, i) => this.#listEl.appendChild(this.#row(id, i)));

    // Add-select options: only jump hosts not already in the chain.
    clear(this.#addSelect);
    const inChain = new Set(this.#chain);
    const available = this.#jumpHosts.filter((j) => !inChain.has(j.id));
    this.#addSelect.append(
      el("option", { value: "", text: t("jumps.choose") }),
      ...available.map((j) =>
        el("option", { value: j.id, text: this.#label(j) }),
      ),
    );
    this.#addSelect.value = "";
  }

  #row(id, index) {
    const record = this.#byId(id);
    const label = record ? this.#label(record) : t("jumps.missing");
    return el("div", { class: "jumps-chain-row" }, [
      el("span", { class: "jumps-chain-num", text: String(index + 1) }),
      el("span", { class: "jumps-chain-label", text: label }),
      el("div", { class: "jumps-chain-tools" }, [
        this.#tool(t("jumps.moveUp"), "↑", index === 0, () =>
          this.#move(index, -1),
        ),
        this.#tool(
          t("jumps.moveDown"),
          "↓",
          index === this.#chain.length - 1,
          () => this.#move(index, 1),
        ),
        this.#tool(t("jumps.remove"), "✕", false, () => this.#remove(index)),
      ]),
    ]);
  }

  #tool(label, glyph, disabled, onClick) {
    return el("button", {
      class: "btn btn--icon",
      type: "button",
      title: label,
      "aria-label": label,
      text: glyph,
      disabled,
      onClick,
    });
  }

  #label(record) {
    const host = record.host ? ` (${record.host}:${record.port ?? 22})` : "";
    return `${record.label || record.host || record.id}${host}`;
  }

  #add(id) {
    if (!id || this.#chain.includes(id)) return;
    this.#chain.push(id);
    this.#render();
    this.#onChange?.(this.value);
  }

  #remove(index) {
    this.#chain.splice(index, 1);
    this.#render();
    this.#onChange?.(this.value);
  }

  #move(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= this.#chain.length) return;
    const [id] = this.#chain.splice(index, 1);
    this.#chain.splice(to, 0, id);
    this.#render();
    this.#onChange?.(this.value);
  }

  #ensureEditor() {
    if (this.#editor) return this.#editor;
    this.#editor = new JumpHostEditorDialog({
      jumphippo: this.#jumphippo,
      openKeyFile: this.#openKeyFile,
      onSaved: async (record) => {
        await this.refresh();
        if (record && record.id && !this.#chain.includes(record.id)) {
          this.#chain.push(record.id);
          this.#render();
          this.#onChange?.(this.value);
        }
      },
    });
    return this.#editor;
  }

  #openNew() {
    this.#ensureEditor().openCreate();
  }
}
