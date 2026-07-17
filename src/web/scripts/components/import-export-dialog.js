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

// import-export-dialog.js — the Feature 120 Import/Export flows, opened from
// Settings → Data. A single native <dialog> re-rendered for each flow:
//   - Export      choose contents + secret mode (strip / passphrase), then save.
//   - Import      pick a .jumphippo bundle → review the add/update/conflict diff →
//                 Merge or Replace (+ passphrase for an encp: bundle).
//   - SSH config  pick a ~/.ssh/config → tick the proposed hosts → commit.
//
// Every store write, all crypto and the SSH-config parse happen in main behind
// window.jumphippo.io.*; this component only gathers intent and renders the diff.
// A successful import fires the app-wide refresh events so open views reload.

import { el, clear } from "../dom.js";
import { t } from "../i18n.js";
import { PopupManager } from "../popup-manager.js";

export class ImportExportDialog {
  #jumphippo;
  #el;
  #titleEl;
  #bodyEl;
  #footerEl;
  #bannerEl;
  #busy = false;

  constructor({ jumphippo } = {}) {
    this.#jumphippo = jumphippo || window.jumphippo;
    this.#build();
  }

  get element() {
    return this.#el;
  }

  #build() {
    this.#titleEl = el("h2", { class: "dialog-title" });
    this.#bodyEl = el("div", { class: "dialog-body impexp-body" });
    this.#footerEl = el("div", { class: "dialog-footer" });
    this.#bannerEl = el("p", {
      class: "dialog-error",
      hidden: true,
      role: "alert",
    });
    this.#el = el("dialog", { class: "editor-dialog impexp-dialog" }, [
      el("div", { class: "dialog-header" }, [this.#titleEl]),
      this.#bodyEl,
      this.#bannerEl,
      this.#footerEl,
    ]);
    this.#el.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.#close();
    });
  }

  // ── Phase rendering ──────────────────────────────────────────────────────────

  #render({ title, bodyNodes, actions }) {
    this.#titleEl.textContent = title;
    clear(this.#bodyEl);
    for (const n of bodyNodes) if (n) this.#bodyEl.appendChild(n);
    clear(this.#footerEl);
    for (const a of actions) {
      this.#footerEl.appendChild(
        el("button", {
          class:
            `btn ${a.primary ? "btn--primary" : "btn--secondary"} ${a.class || ""}`.trim(),
          type: "button",
          text: a.label,
          disabled: a.disabled,
          onClick: a.onClick,
        }),
      );
    }
    this.#clearError();
  }

  #open() {
    if (!this.#el.isConnected) document.body.appendChild(this.#el);
    this.#clearError();
    if (!this.#el.open) this.#el.showModal();
  }

  #close() {
    if (this.#el.open) this.#el.close();
  }

  #showError(message) {
    this.#bannerEl.textContent = message;
    this.#bannerEl.hidden = false;
  }

  #clearError() {
    this.#bannerEl.textContent = "";
    this.#bannerEl.hidden = true;
  }

  #cancelAction() {
    return { label: t("common.cancel"), onClick: () => this.#close() };
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  openExport() {
    const state = { includeSettings: false, secretMode: "stripped" };

    const settingsCheck = checkboxRow(
      "impexp-include-settings",
      t("io.export.includeSettings"),
      (checked) => (state.includeSettings = checked),
    );

    const passphrase = el("input", {
      class: "dialog-input",
      type: "password",
      autocomplete: "new-password",
      "aria-label": t("io.export.passphrase"),
    });
    const passphrase2 = el("input", {
      class: "dialog-input",
      type: "password",
      autocomplete: "new-password",
      "aria-label": t("io.export.passphraseConfirm"),
    });
    const passphraseBlock = el(
      "div",
      { class: "impexp-passphrase", hidden: true },
      [
        labelled(t("io.export.passphrase"), passphrase),
        labelled(t("io.export.passphraseConfirm"), passphrase2),
        el("p", {
          class: "field-hint impexp-warn",
          text: t("io.export.passphraseWarn"),
        }),
      ],
    );

    const secretRadios = radioGroup(
      "impexp-secret-mode",
      [
        {
          value: "stripped",
          label: t("io.export.secrets.stripped"),
          desc: t("io.export.secrets.strippedDesc"),
        },
        {
          value: "encp",
          label: t("io.export.secrets.encp"),
          desc: t("io.export.secrets.encpDesc"),
        },
      ],
      state.secretMode,
      (value) => {
        state.secretMode = value;
        passphraseBlock.hidden = value !== "encp";
      },
    );

    this.#render({
      title: t("io.export.title"),
      bodyNodes: [
        el("p", { class: "impexp-desc", text: t("io.data.exportDesc") }),
        settingsCheck,
        el("div", {
          class: "impexp-section-label",
          text: t("io.export.secrets"),
        }),
        secretRadios,
        passphraseBlock,
      ],
      actions: [
        this.#cancelAction(),
        {
          label: t("io.export.submit"),
          primary: true,
          onClick: () =>
            this.#doExport(state, passphrase.value, passphrase2.value),
        },
      ],
    });
    this.#open();
  }

  async #doExport(state, pass, pass2) {
    if (this.#busy) return;
    if (state.secretMode === "encp") {
      if (!pass)
        return this.#showError(t("io.export.error.passphraseRequired"));
      if (pass !== pass2)
        return this.#showError(t("io.export.error.passphraseMismatch"));
    }
    this.#busy = true;
    try {
      const res = await this.#jumphippo.io.export({
        includeSettings: state.includeSettings,
        secretMode: state.secretMode,
        passphrase: state.secretMode === "encp" ? pass : undefined,
      });
      if (res && res.__hippoError) {
        this.#showError(res.message || t("io.import.error.generic"));
        return;
      }
      this.#close();
      if (res && res.ok) PopupManager.notify({ message: t("io.export.done") });
    } finally {
      this.#busy = false;
    }
  }

  // ── Import a bundle ──────────────────────────────────────────────────────────

  async startImport() {
    if (this.#busy) return;
    this.#busy = true;
    let preview;
    try {
      preview = await this.#jumphippo.io.previewBundle();
    } finally {
      this.#busy = false;
    }
    if (!preview || preview.canceled) return;
    if (!preview.ok) {
      PopupManager.notify({ message: t("io.import.error.invalid") });
      return;
    }
    this.#renderImport(preview);
    this.#open();
  }

  #renderImport(preview) {
    const state = { mode: "merge" };

    const passphrase = el("input", {
      class: "dialog-input",
      type: "password",
      autocomplete: "off",
      "aria-label": t("io.import.passphrase"),
    });
    const passphraseBlock = preview.needsPassphrase
      ? el("div", { class: "impexp-passphrase" }, [
          labelled(t("io.import.passphrase"), passphrase),
        ])
      : null;

    const replaceWarn = el("p", {
      class: "field-hint impexp-warn",
      text: t("io.import.replaceWarn"),
      hidden: true,
    });

    const modeRadios = radioGroup(
      "impexp-import-mode",
      [
        {
          value: "merge",
          label: t("io.import.mode.merge"),
          desc: t("io.import.mode.mergeDesc"),
        },
        {
          value: "replace",
          label: t("io.import.mode.replace"),
          desc: t("io.import.mode.replaceDesc"),
        },
      ],
      state.mode,
      (value) => {
        state.mode = value;
        replaceWarn.hidden = value !== "replace";
      },
    );

    this.#render({
      title: t("io.import.title"),
      bodyNodes: [
        el("p", {
          class: "impexp-file",
          text: t("io.import.file", { name: baseName(preview.path) }),
        }),
        this.#diffSummary(preview),
        el("div", { class: "impexp-section-label", text: t("io.import.mode") }),
        modeRadios,
        replaceWarn,
        passphraseBlock,
      ],
      actions: [
        this.#cancelAction(),
        {
          label: t("io.import.submit"),
          primary: true,
          onClick: () =>
            this.#doImport(preview.path, state.mode, passphrase.value),
        },
      ],
    });
  }

  #diffSummary(preview) {
    const rows = [];
    const sections = [
      ["tunnels", t("io.import.section.tunnels")],
      ["credentials", t("io.import.section.credentials")],
      ["jumpHosts", t("io.import.section.jumpHosts")],
    ];
    for (const [key, label] of sections) {
      const c = preview.counts[key] || { add: 0, update: 0, conflict: 0 };
      const total = c.add + c.update + c.conflict;
      if (total === 0) continue;
      const parts = [];
      if (c.add) parts.push(t("io.import.status.add", { n: c.add }));
      if (c.update) parts.push(t("io.import.status.update", { n: c.update }));
      if (c.conflict)
        parts.push(t("io.import.status.conflict", { n: c.conflict }));
      rows.push(
        el("li", { class: "impexp-diff-row" }, [
          el("span", { class: "impexp-diff-label", text: label }),
          el("span", { class: "impexp-diff-counts", text: parts.join(" · ") }),
        ]),
      );
    }
    if (rows.length === 0) {
      return el("p", { class: "impexp-desc", text: t("io.import.nothing") });
    }
    return el("ul", { class: "impexp-diff" }, rows);
  }

  async #doImport(path, mode, passphrase) {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const res = await this.#jumphippo.io.importBundle({
        path,
        mode,
        passphrase,
      });
      if (res && res.__hippoError) {
        this.#showError(importErrorMessage(res.code));
        return;
      }
      this.#close();
      PopupManager.notify({ message: t("io.import.done") });
      announceDataChanged();
    } finally {
      this.#busy = false;
    }
  }

  // ── Import from SSH config ───────────────────────────────────────────────────

  async startSshImport() {
    if (this.#busy) return;
    this.#busy = true;
    let scan;
    try {
      scan = await this.#jumphippo.io.scanSshConfig();
    } finally {
      this.#busy = false;
    }
    if (!scan || scan.canceled) return;
    if (!scan.ok) {
      PopupManager.notify({ message: t("io.ssh.error") });
      return;
    }
    this.#renderSshImport(scan.proposal || {});
    this.#open();
  }

  #renderSshImport(proposal) {
    const tunnels = Array.isArray(proposal.tunnels) ? proposal.tunnels : [];
    const jumpsByTemp = new Map(
      (proposal.jumpHosts || []).map((j) => [j.tempId, j]),
    );
    const selected = new Set(tunnels.map((t2) => t2.tempId)); // all on by default

    const submit = () => this.#doSshImport(proposal, [...selected]);

    const footerActions = () => [
      this.#cancelAction(),
      {
        label: t("io.ssh.submit", { count: selected.size }),
        primary: true,
        disabled: selected.size === 0,
        onClick: submit,
      },
    ];
    const refreshFooter = () => {
      clear(this.#footerEl);
      for (const a of footerActions()) {
        this.#footerEl.appendChild(
          el("button", {
            class: `btn ${a.primary ? "btn--primary" : "btn--secondary"}`,
            type: "button",
            text: a.label,
            disabled: a.disabled,
            onClick: a.onClick,
          }),
        );
      }
    };

    const list =
      tunnels.length === 0
        ? el("p", { class: "impexp-desc", text: t("io.ssh.empty") })
        : el(
            "ul",
            { class: "impexp-host-list" },
            tunnels.map((tun) => {
              const jumpLabels = (tun.jumpHostTempIds || [])
                .map((id) => jumpsByTemp.get(id)?.label || id)
                .join(", ");
              const sub = jumpLabels
                ? t("io.ssh.host.via", { host: tun.sshHost, jumps: jumpLabels })
                : tun.sshHost;
              const cb = el("input", {
                type: "checkbox",
                class: "settings-check-input",
                checked: true,
                onChange: (e) => {
                  if (e.target.checked) selected.add(tun.tempId);
                  else selected.delete(tun.tempId);
                  refreshFooter();
                },
              });
              return el("li", { class: "impexp-host-item" }, [
                el("label", { class: "impexp-host-label" }, [
                  cb,
                  el("span", { class: "impexp-host-name", text: tun.name }),
                  el("span", { class: "impexp-host-sub", text: sub }),
                ]),
              ]);
            }),
          );

    this.#render({
      title: t("io.ssh.title"),
      bodyNodes: [
        el("p", { class: "impexp-desc", text: t("io.ssh.desc") }),
        list,
        tunnels.length > 0 &&
          el("p", { class: "field-hint", text: t("io.ssh.note") }),
      ],
      actions: footerActions(),
    });
  }

  async #doSshImport(proposal, selected) {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const res = await this.#jumphippo.io.importSshConfig({
        proposal,
        selected,
      });
      if (res && res.__hippoError) {
        this.#showError(res.message || t("io.import.error.generic"));
        return;
      }
      this.#close();
      const created = (res && res.created) || {};
      PopupManager.notify({
        message: t("io.ssh.done", { count: created.tunnels || 0 }),
      });
      announceDataChanged();
    } finally {
      this.#busy = false;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** After an import, refresh every open view / picker. */
function announceDataChanged() {
  for (const name of [
    "jumphippo:data-imported",
    "jumphippo:credentials-changed",
    "jumphippo:jumphosts-changed",
  ]) {
    window.dispatchEvent(new CustomEvent(name));
  }
}

/** Map an import error code to a user-facing message. */
function importErrorMessage(code) {
  switch (code) {
    case "BAD_PASSPHRASE":
      return t("io.import.error.badPassphrase");
    case "PASSPHRASE_REQUIRED":
      return t("io.import.error.passphraseRequired");
    case "DANGLING_REF":
      return t("io.import.error.dangling");
    case "INVALID_BUNDLE":
      return t("io.import.error.invalid");
    default:
      return t("io.import.error.generic");
  }
}

/** A `<label>[✓] text</label>` checkbox row wired to `onChange(checked)`. */
function checkboxRow(id, label, onChange) {
  const input = el("input", {
    id,
    type: "checkbox",
    class: "settings-check-input",
    onChange: (e) => onChange(e.target.checked),
  });
  return el("div", { class: "field settings-check" }, [
    el("label", { class: "settings-check-label", for: id }, [
      input,
      el("span", { text: label }),
    ]),
  ]);
}

/** A label above a control, matching the editor field layout. */
function labelled(label, control) {
  return el("div", { class: "field" }, [
    el("label", { class: "field-label", text: label }),
    control,
  ]);
}

/**
 * A radio group of `{ value, label, desc }` options wired to `onChange(value)`.
 */
function radioGroup(name, options, initial, onChange) {
  return el(
    "div",
    { class: "impexp-radio-group" },
    options.map((o) => {
      const input = el("input", {
        type: "radio",
        name,
        value: o.value,
        class: "impexp-radio-input",
        checked: o.value === initial,
        onChange: (e) => {
          if (e.target.checked) onChange(o.value);
        },
      });
      return el("label", { class: "impexp-radio" }, [
        input,
        el("span", { class: "impexp-radio-body" }, [
          el("span", { class: "impexp-radio-label", text: o.label }),
          o.desc && el("span", { class: "impexp-radio-desc", text: o.desc }),
        ]),
      ]);
    }),
  );
}

/** Last path segment of an absolute path (for display only). */
function baseName(p) {
  if (typeof p !== "string") return "";
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}
