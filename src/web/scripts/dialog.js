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

// dialog.js — the shared chrome for the Feature 45 editor dialogs (tunnel /
// credential / jump host). Each is a native `<dialog>` opened with showModal(),
// which gives real top-layer STACKING for free: a credential picker's "New…"
// opens the credential editor ON TOP of the tunnel editor with no custom z-index
// or focus-trap code. (PopupManager stays the seam for lightweight confirm/notify
// prompts, which never stack.)
//
// This class owns only the frame — header title, a body the caller fills, an
// error banner, and a Cancel/Save footer wired to `onCancel` / `onSubmit`. It
// makes no assumptions about the fields inside; each editor composes one and
// drives validation + persistence in its own onSubmit.

import { el } from "./dom.js";
import { t } from "./i18n.js";

export class Dialog {
  #el;
  #titleEl;
  #bodyEl;
  #bannerEl;
  #onSubmit;
  #onCancel;

  /**
   * @param {object} opts
   * @param {string} [opts.className]   extra class on the <dialog>
   * @param {string} [opts.title]
   * @param {string} [opts.saveLabel]   footer submit label (default "Save")
   * @param {() => void} [opts.onSubmit] the form submitted (Enter / Save)
   * @param {() => void} [opts.onCancel] Cancel / Escape
   */
  constructor({
    className = "",
    title = "",
    saveLabel,
    onSubmit,
    onCancel,
  } = {}) {
    this.#onSubmit = onSubmit;
    this.#onCancel = onCancel;

    this.#titleEl = el("h2", { class: "dialog-title", text: title });
    this.#bodyEl = el("div", { class: "dialog-body" });
    this.#bannerEl = el("p", {
      class: "dialog-error",
      hidden: true,
      role: "alert",
    });

    const form = el(
      "form",
      {
        class: "dialog-form",
        onSubmit: (e) => {
          e.preventDefault();
          this.#onSubmit?.();
        },
      },
      [
        this.#bodyEl,
        this.#bannerEl,
        el("div", { class: "dialog-footer" }, [
          el("button", {
            class: "btn btn--secondary dialog-cancel",
            type: "button",
            text: t("common.cancel"),
            onClick: () => this.#cancel(),
          }),
          el("button", {
            class: "btn btn--primary dialog-save",
            type: "submit",
            text: saveLabel || t("common.save"),
          }),
        ]),
      ],
    );

    this.#el = el("dialog", { class: `editor-dialog ${className}`.trim() }, [
      el("div", { class: "dialog-header" }, [this.#titleEl]),
      form,
    ]);

    // Escape fires the native `cancel` event (which would also close the dialog);
    // we take it over so cleanup + the onCancel callback run exactly once.
    this.#el.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.#cancel();
    });
  }

  /** The `<dialog>` element. */
  get element() {
    return this.#el;
  }

  /** The body container the composing editor fills with fields. */
  get body() {
    return this.#bodyEl;
  }

  /** Update the header title (e.g. New vs Edit). */
  setTitle(title) {
    this.#titleEl.textContent = title;
  }

  /** Show as a modal (mounting into <body> on first open), focus the first field. */
  open() {
    if (!this.#el.isConnected) document.body.appendChild(this.#el);
    this.clearError();
    this.#el.showModal();
    const focusTarget =
      this.#bodyEl.querySelector("[data-autofocus]") ||
      this.#bodyEl.querySelector("input, select, textarea");
    focusTarget?.focus();
  }

  /** Close the modal (no-op when already closed). */
  close() {
    if (this.#el.open) this.#el.close();
    this.clearError();
  }

  #cancel() {
    if (this.#onCancel) this.#onCancel();
    else this.close();
  }

  /** Show an error banner above the footer (e.g. a failed store write). */
  showError(message) {
    this.#bannerEl.textContent = message;
    this.#bannerEl.hidden = false;
  }

  /** Clear the error banner. */
  clearError() {
    this.#bannerEl.textContent = "";
    this.#bannerEl.hidden = true;
  }
}
