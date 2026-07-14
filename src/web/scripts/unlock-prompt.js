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

// unlock-prompt.js — the unlock-on-launch prompt for master-password mode. That
// mode derives its key from the passphrase and holds it in memory only, so the
// app boots LOCKED and can't decrypt any stored SSH secret. Rather than make the
// user hunt for Settings → Security, this checks the lock state on startup and,
// when locked, raises a modal to unlock for the session. Main defers arming
// enabled tunnels until the store is unlocked (here or from Settings), so a
// successful unlock resumes them; "Not now" dismisses and leaves them deferred
// until the user unlocks later. It's app-wide state, so it lives at the shell
// level beside HostKeyPrompt rather than inside a view.

import { PopupManager } from "./popup-manager.js";
import { el } from "./dom.js";
import { t } from "./i18n.js";

export class UnlockPrompt {
  #porthippo;
  #onChanged;
  #open = false;
  #input = null;
  #errorEl = null;
  #unlockBtn = null;

  constructor({ porthippo } = {}) {
    this.#porthippo = porthippo || window.porthippo;
    this.#onChanged = (e) => this.#onStateChanged(e.detail);
  }

  install() {
    window.addEventListener(
      "porthippo:secret-storage-changed",
      this.#onChanged,
    );
    this.#checkLocked();
    return this;
  }

  uninstall() {
    window.removeEventListener(
      "porthippo:secret-storage-changed",
      this.#onChanged,
    );
  }

  /** On startup, raise the prompt when the store booted locked. */
  async #checkLocked() {
    let state;
    try {
      state = await this.#porthippo?.secretStorage?.getMode?.();
    } catch {
      return; // can't read the state → nothing to prompt for
    }
    if (state && state.locked) this.#show();
  }

  /** A state broadcast: if the session was unlocked elsewhere, dismiss us. */
  #onStateChanged(state) {
    if (this.#open && state && !state.locked) this.#close();
  }

  #show() {
    if (this.#open) return;
    this.#open = true;

    this.#input = el("input", {
      type: "password",
      class: "settings-input unlock-input",
      autocomplete: "current-password",
      spellcheck: false,
      "aria-label": t("settings.security.password"),
      placeholder: t("settings.security.password"),
      "data-autofocus": true,
      onKeydown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.#submit();
        }
      },
    });
    this.#errorEl = el("p", { class: "popup-error", hidden: true });

    this.#unlockBtn = el("button", {
      class: "btn popup-btn btn--primary",
      type: "button",
      text: t("settings.security.unlock"),
      onClick: () => this.#submit(),
    });
    const laterBtn = el("button", {
      class: "btn popup-btn btn--secondary",
      type: "button",
      text: t("unlock.later"),
      onClick: () => this.#close(),
    });

    const element = el(
      "div",
      {
        class: "popup popup-unlock",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": t("unlock.title"),
      },
      [
        el("div", { class: "popup-header" }, [
          el("span", { class: "popup-title", text: t("unlock.title") }),
        ]),
        el("div", { class: "popup-body" }, [
          el("p", {
            class: "popup-message",
            text: t("settings.security.lockedNote"),
          }),
          this.#input,
          this.#errorEl,
        ]),
        el("div", { class: "popup-footer" }, [laterBtn, this.#unlockBtn]),
      ],
    );

    PopupManager.open({ element, onMaskClick: () => this.#close() });
  }

  #close() {
    if (!this.#open) return;
    this.#open = false;
    this.#input = null;
    this.#errorEl = null;
    this.#unlockBtn = null;
    PopupManager.close();
  }

  async #submit() {
    const pw = this.#input ? this.#input.value : "";
    if (!pw) {
      this.#showError(t("settings.security.error.passwordRequired"));
      return;
    }
    if (this.#unlockBtn) this.#unlockBtn.disabled = true;
    let res;
    try {
      res = await this.#porthippo?.secretStorage?.unlock?.(pw);
    } catch {
      res = { ok: false, reason: "error" };
    }
    if (this.#unlockBtn) this.#unlockBtn.disabled = false;

    if (res && res.ok) {
      this.#close(); // the secret-storage-changed broadcast also arrives
      return;
    }
    this.#showError(
      res?.reason === "bad-password"
        ? t("settings.security.error.badPassword")
        : t("settings.security.error.generic"),
    );
    if (this.#input) {
      this.#input.value = "";
      this.#input.focus();
    }
  }

  #showError(message) {
    if (!this.#errorEl) return;
    this.#errorEl.textContent = message || "";
    this.#errorEl.hidden = !message;
  }
}
