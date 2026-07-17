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

// jump-host-editor-dialog.js — create/edit a reusable SSH jump host in a native
// <dialog>. A jump host is host/port plus a reference to a credential (chosen with
// a nested CredentialPickerField, whose own "New…" opens the credential editor on
// top — native <dialog> stacking). On a successful store write it emits a global
// `jumphippo:jumphosts-changed` so open pickers refresh, and calls back onSaved.

import { el } from "../dom.js";
import { field, applyFieldErrors } from "../field.js";
import { t } from "../i18n.js";
import { Dialog } from "../dialog.js";
import { validateJumpHost } from "../validate.js";
import { CredentialPickerField } from "./credential-picker-field.js";

const DEFAULT_PORT = 22;

function toPort(str) {
  const s = String(str).trim();
  if (s === "") return undefined;
  return Number(s);
}

export class JumpHostEditorDialog {
  #dialog;
  #jumphippo;
  #openKeyFile;
  #onSaved;

  #form = blankForm();
  #editingId = null;

  #labelInput;
  #hostInput;
  #portInput;
  #credPicker;

  /**
   * @param {object} [opts]
   * @param {object} [opts.jumphippo]  IPC bridge (defaults to window.jumphippo)
   * @param {() => Promise<string|null>} [opts.openKeyFile]
   * @param {(record: object) => void} [opts.onSaved]
   */
  constructor({ jumphippo, openKeyFile, onSaved } = {}) {
    this.#jumphippo = jumphippo || window.jumphippo;
    this.#openKeyFile = openKeyFile;
    this.#onSaved = onSaved;

    this.#dialog = new Dialog({
      className: "jump-host-dialog",
      title: t("jump.newTitle"),
      onSubmit: () => this.#save(),
      onCancel: () => this.#dialog.close(),
    });
    this.#buildBody();
  }

  get element() {
    return this.#dialog.element;
  }

  /** Open a blank editor for a new jump host. */
  async openCreate() {
    await this.#load(null);
    this.#dialog.setTitle(t("jump.newTitle"));
    this.#dialog.open();
  }

  /** Open the editor prefilled from an existing jump host. */
  async openEdit(jump) {
    await this.#load(jump);
    this.#dialog.setTitle(t("jump.editTitle"));
    this.#dialog.open();
  }

  async #load(jump) {
    const j = jump && typeof jump === "object" ? jump : {};
    this.#editingId = j.id || null;
    this.#form = {
      label: str(j.label),
      host: str(j.host),
      port:
        j.port === undefined || j.port === null
          ? String(DEFAULT_PORT)
          : String(j.port),
      credentialId: str(j.credentialId),
    };
    this.#labelInput.value = this.#form.label;
    this.#hostInput.value = this.#form.host;
    this.#portInput.value = this.#form.port;
    await this.#credPicker.load();
    this.#credPicker.setValue(this.#form.credentialId);
    applyFieldErrors(this.#dialog.body, {});
    this.#dialog.clearError();
  }

  buildPayload() {
    const port = toPort(this.#form.port);
    return {
      label: this.#form.label.trim(),
      host: this.#form.host.trim(),
      port: port === undefined ? DEFAULT_PORT : port,
      credentialId: this.#form.credentialId,
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  #buildBody() {
    this.#labelInput = el("input", {
      class: "dialog-input",
      type: "text",
      placeholder: t("jump.label.placeholder"),
      "aria-label": t("jump.label"),
      "data-autofocus": true,
      onInput: (e) => (this.#form.label = e.target.value),
    });
    this.#hostInput = el("input", {
      class: "dialog-input",
      type: "text",
      placeholder: t("jump.host.placeholder"),
      "aria-label": t("hop.host"),
      onInput: (e) => (this.#form.host = e.target.value),
    });
    this.#portInput = el("input", {
      class: "dialog-input",
      type: "number",
      value: String(DEFAULT_PORT),
      "aria-label": t("hop.port"),
      onInput: (e) => (this.#form.port = e.target.value),
    });
    this.#credPicker = new CredentialPickerField({
      jumphippo: this.#jumphippo,
      openKeyFile: this.#openKeyFile,
      label: t("editor.credential"),
      onChange: (id) => (this.#form.credentialId = id),
    });

    this.#dialog.body.append(
      field({
        label: t("jump.label"),
        control: this.#labelInput,
        errorKey: "label",
      }),
      el("div", { class: "editor-row" }, [
        field({
          label: t("hop.host"),
          control: this.#hostInput,
          errorKey: "host",
        }),
        field({
          label: t("hop.port"),
          control: this.#portInput,
          errorKey: "port",
        }),
      ]),
      this.#credPicker.element,
    );
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async #save() {
    const payload = this.buildPayload();
    const { valid, errors } = validateJumpHost(payload);
    applyFieldErrors(this.#dialog.body, errors);
    if (!valid) return;

    let result;
    try {
      result = this.#editingId
        ? await this.#jumphippo.jumpHosts.update(this.#editingId, payload)
        : await this.#jumphippo.jumpHosts.create(payload);
    } catch (err) {
      this.#dialog.showError(
        t("editor.saveError", { message: err?.message || String(err) }),
      );
      return;
    }

    if (result && result.__hippoError) {
      if (result.errors) applyFieldErrors(this.#dialog.body, result.errors);
      this.#dialog.showError(
        t("editor.saveError", { message: result.message || result.code || "" }),
      );
      return;
    }

    this.#dialog.close();
    window.dispatchEvent(
      new CustomEvent("jumphippo:jumphosts-changed", {
        detail: { id: result && result.id },
      }),
    );
    this.#onSaved?.(result);
  }
}

function str(v) {
  return typeof v === "string" ? v : "";
}
function blankForm() {
  return { label: "", host: "", port: String(DEFAULT_PORT), credentialId: "" };
}
