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

// popup-manager.js — a single shared modal host, mirroring Rest Hippo's
// PopupManager. One overlay mask, one active popup at a time. A "popup" is any
// object of shape `{ element: HTMLElement, onMaskClick?: () => void }`. The
// `confirm` / `confirmDelete` / `notify` helpers build the standard dialog
// skeleton (`.popup` → header / body / footer) so callers don't repeat it.
//
// This is the only app-wide dialog seam in the renderer; the Definition view uses
// it for delete confirmations and the SSH host-key trust prompt.

import { el } from "./dom.js";
import { t } from "./i18n.js";

const state = {
  active: null, // { popup, dialogEl } currently shown, or null
  queue: [], // popups waiting behind the active one — QUEUED, never dropped
};

function dismiss(popup) {
  (popup.onMaskClick || PopupManager.close)();
}

// Mount a popup as a native modal <dialog>. showModal() puts it in the browser
// TOP LAYER, so a popup raised while an editor <dialog> is open stacks ABOVE it
// (the old plain-overlay popup was occluded by any open editor dialog and left
// inert). Escape → native `cancel`; a click landing on the dialog itself (not its
// content) is a backdrop click.
function mount(popup) {
  const dialogEl = el("dialog", { class: "popup-dialog" }, [popup.element]);
  dialogEl.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss(popup);
  });
  dialogEl.addEventListener("click", (event) => {
    if (event.target === dialogEl) dismiss(popup);
  });
  document.body.appendChild(dialogEl);
  state.active = { popup, dialogEl };
  dialogEl.showModal();

  const focusTarget =
    popup.element.querySelector("[data-autofocus]") ||
    popup.element.querySelector("button");
  focusTarget?.focus();
}

export const PopupManager = {
  /**
   * Mount a popup. If one is already open the new popup is QUEUED (shown when the
   * current one closes) rather than replacing it — so a second host-key prompt
   * can't silently strand the first's pending SSH connection. Focuses the first
   * `[data-autofocus]` control, or the first button, so Enter/Escape work at once.
   * @param {{ element: HTMLElement, onMaskClick?: () => void }} popup
   */
  open(popup) {
    if (!popup || !popup.element) return;
    // Defensive: a detached active dialog means the previous popup is gone (e.g.
    // the DOM was reset under tests) — treat the host as idle, don't queue behind
    // a ghost. A node still attached to a *different* (orphaned) document counts as
    // gone too, since it's no longer in the live tree. In production there is only
    // ever one document, so this only fires when the DOM is swapped under tests.
    if (
      state.active &&
      (!state.active.dialogEl.isConnected ||
        state.active.dialogEl.ownerDocument !== document)
    ) {
      state.active = null;
      state.queue = [];
    }
    if (state.active) {
      state.queue.push(popup);
      return;
    }
    mount(popup);
  },

  /** Close the active popup, then show the next queued one. Safe to call idle. */
  close() {
    const active = state.active;
    state.active = null;
    if (active) {
      try {
        active.dialogEl.close();
      } catch {
        // already closed
      }
      active.dialogEl.remove();
    }
    const next = state.queue.shift();
    if (next) mount(next);
  },

  /**
   * A two-button confirmation dialog. `onConfirm` / `onCancel` fire after the
   * dialog closes. `confirmClass` styles the confirm button (e.g. "btn--danger").
   *
   * Pass `requireText` to gate the confirm button behind a typed word: it stays
   * disabled until the user types that word into a field (matched trimmed and
   * case-insensitively), so a destructive action takes a deliberate keystroke.
   * `requireTextLabel` is the prompt shown above the field.
   * @param {object} opts
   */
  confirm({
    title,
    message,
    note,
    confirmLabel,
    cancelLabel,
    confirmClass = "btn--primary",
    requireText,
    requireTextLabel,
    onConfirm,
    onCancel,
  } = {}) {
    const done = (fn) => () => {
      this.close();
      fn?.();
    };

    const gate = typeof requireText === "string" && requireText.trim() !== "";

    const confirmBtn = el("button", {
      class: `btn popup-btn ${confirmClass}`,
      type: "button",
      text: confirmLabel || t("common.confirm"),
      onClick: done(onConfirm),
      // Gated: start disabled and let the field enable us. Ungated: take focus so
      // Enter confirms immediately (the field takes focus in the gated case).
      disabled: gate,
      "data-autofocus": !gate,
    });
    const cancelBtn = el("button", {
      class: "btn popup-btn btn--secondary",
      type: "button",
      text: cancelLabel || t("common.cancel"),
      onClick: done(onCancel),
    });

    let confirmField = null;
    if (gate) {
      const target = requireText.trim().toLowerCase();
      const matches = (v) => v.trim().toLowerCase() === target;
      confirmField = el("input", {
        type: "text",
        class: "settings-input popup-confirm-input",
        autocomplete: "off",
        spellcheck: false,
        placeholder: requireText,
        "aria-label": requireTextLabel || requireText,
        "data-autofocus": true,
        onInput: (e) => {
          confirmBtn.disabled = !matches(e.target.value);
        },
        onKeydown: (e) => {
          if (e.key === "Enter" && matches(e.target.value)) {
            e.preventDefault();
            done(onConfirm)();
          }
        },
      });
    }

    const element = el(
      "div",
      {
        class: "popup popup-confirm",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": title || message || "",
      },
      [
        title &&
          el("div", { class: "popup-header" }, [
            el("span", { class: "popup-title", text: title }),
          ]),
        el(
          "div",
          { class: "popup-body" },
          [
            message && el("p", { class: "popup-message", text: message }),
            note && el("p", { class: "popup-note", text: note }),
            gate &&
              requireTextLabel &&
              el("p", {
                class: "popup-confirm-prompt",
                text: requireTextLabel,
              }),
            confirmField,
          ].filter(Boolean),
        ),
        el("div", { class: "popup-footer" }, [cancelBtn, confirmBtn]),
      ].filter(Boolean),
    );

    this.open({ element, onMaskClick: done(onCancel) });
  },

  /**
   * A destructive-action confirm preset (danger button, Delete label). Gated by
   * default: the user must type the localized delete word before confirming. Pass
   * a falsey `requireText` to opt out of the gate for a lower-stakes delete.
   */
  confirmDelete({
    title,
    message,
    requireText,
    requireTextLabel,
    onConfirm,
    onCancel,
  } = {}) {
    const word =
      requireText === undefined ? t("def.delete.confirmWord") : requireText;
    this.confirm({
      title: title || t("def.delete.title"),
      message,
      confirmLabel: t("common.delete"),
      confirmClass: "btn--danger",
      requireText: word,
      requireTextLabel:
        requireTextLabel || t("def.delete.confirmPrompt", { word }),
      onConfirm,
      onCancel,
    });
  },

  /**
   * A single-button acknowledgement dialog (no cancel). Used for the host-key
   * "changed" warning, where there's nothing to accept — only to dismiss.
   * @param {object} opts
   */
  notify({ title, message, okLabel, okClass = "btn--primary", onClose } = {}) {
    const okBtn = el("button", {
      class: `btn popup-btn ${okClass}`,
      type: "button",
      text: okLabel || t("common.dismiss"),
      onClick: () => {
        this.close();
        onClose?.();
      },
      "data-autofocus": true,
    });

    const element = el(
      "div",
      {
        class: "popup popup-notify",
        role: "alertdialog",
        "aria-modal": "true",
        "aria-label": title || message || "",
      },
      [
        title &&
          el("div", { class: "popup-header" }, [
            el("span", { class: "popup-title", text: title }),
          ]),
        el("div", { class: "popup-body" }, [
          message && el("p", { class: "popup-message", text: message }),
        ]),
        el("div", { class: "popup-footer" }, [okBtn]),
      ].filter(Boolean),
    );

    this.open({
      element,
      onMaskClick: () => {
        this.close();
        onClose?.();
      },
    });
  },
};
