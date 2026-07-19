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

// console-overview.js — the "Open Consoles" dashboard (Feature 210): a card per
// running session, so a user can compare every console at a glance and jump to the
// right window. Each card shows the name, status pill, a few recent-output lines
// (identify-by-output), and a running duration, plus a Bring Forward button;
// double-clicking a card reveals its window. Cards update live from the session
// snapshots + the activity stream. Like the details pane, the output block is a
// read-only preview — never a terminal — and honours the consoleShowOutput setting.

import { el, clear } from "../dom.js";
import { t } from "../i18n.js";
import { icons } from "../icons.js";
import { formatDuration } from "../utils/format.js";
import { statusInfo } from "./console-detail.js";

const CARD_OUTPUT_LINES = 4;

export class ConsoleOverview {
  #el;
  #gridEl;
  #emptyEl;
  #cards = new Map(); // sessionId → { root, statusEl, outputEl, durationEl, snap }
  #lines = new Map(); // sessionId → recent output lines (survives a re-render)
  #showOutput = true;
  #now;
  #tickId = null;

  #onReveal;

  constructor({ now, onReveal } = {}) {
    this.#now = now || Date.now;
    this.#onReveal = onReveal || (() => {});
    this.#el = this.#build();
  }

  get element() {
    return this.#el;
  }

  #build() {
    this.#emptyEl = el("div", { class: "console-overview-empty" }, [
      el("p", {
        class: "detail-empty-hint",
        text: t("console.overview.empty"),
      }),
      el("p", {
        class: "console-overview-empty-hint",
        text: t("console.overview.emptyHint"),
      }),
    ]);
    this.#gridEl = el("div", { class: "console-overview-grid" });
    return el(
      "section",
      { class: "console-overview", "aria-label": t("console.overview.title") },
      [
        el("h2", {
          class: "console-overview-title",
          text: t("console.overview.title"),
        }),
        this.#emptyEl,
        this.#gridEl,
      ],
    );
  }

  /**
   * Render one card per open session. `cards` is a list of { sessionId, name,
   * snap } built by the owner from the live session snapshots. Starts/stops the
   * duration ticker with the presence of any card.
   */
  setSessions(cards, { showOutput = true } = {}) {
    this.#showOutput = showOutput !== false;
    const list = Array.isArray(cards) ? cards : [];
    clear(this.#gridEl);
    this.#cards.clear();
    this.#emptyEl.hidden = list.length > 0;
    this.#gridEl.hidden = list.length === 0;
    for (const card of list) this.#buildCard(card);
    if (list.length > 0) this.#startTicker();
    else this.#stopTicker();
  }

  /** Live activity for one session → refresh its card's output + duration. */
  applyActivity(activity) {
    if (!activity || !activity.sessionId) return;
    if (Array.isArray(activity.lines)) {
      this.#lines.set(activity.sessionId, activity.lines);
    }
    const rec = this.#cards.get(activity.sessionId);
    if (rec) {
      this.#renderCardOutput(rec);
      this.#renderCardDuration(rec);
    }
  }

  destroy() {
    this.#stopTicker();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  #buildCard({ sessionId, name, snap }) {
    const statusEl = el("span", { class: "console-status-pill" });
    const outputEl = el("pre", { class: "console-card-output" });
    const durationEl = el("span", { class: "console-card-duration" });

    const forwardBtn = el(
      "button",
      {
        class: "btn console-action-btn console-card-forward",
        type: "button",
        title: t("console.action.bringForward"),
        onClick: (e) => {
          e.stopPropagation();
          this.#onReveal(sessionId);
        },
      },
      [
        el("span", {
          class: "console-action-glyph",
          html: icons.externalWindow(),
        }),
        el("span", { text: t("console.action.bringForward") }),
      ],
    );

    const root = el(
      "div",
      {
        class: "console-card",
        role: "button",
        tabindex: "0",
        dataset: { session: sessionId },
        // Double-click (or Enter) reveals the console window — like a window switcher.
        onDblclick: () => this.#onReveal(sessionId),
        onKeydown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.#onReveal(sessionId);
          }
        },
      },
      [
        el("div", { class: "console-card-head" }, [
          el("span", {
            class: "console-card-name",
            text: name || t("consoles.unnamed"),
          }),
          statusEl,
        ]),
        el("div", { class: "console-card-output-wrap" }, [
          el("span", {
            class: "console-card-output-label",
            text: t("console.overview.lastOutput"),
          }),
          outputEl,
        ]),
        el("div", { class: "console-card-foot" }, [durationEl, forwardBtn]),
      ],
    );

    const rec = { root, statusEl, outputEl, durationEl, snap };
    this.#cards.set(sessionId, rec);
    this.#gridEl.appendChild(root);
    this.#renderCardStatus(rec);
    this.#renderCardOutput(rec);
    this.#renderCardDuration(rec);
  }

  #renderCardStatus(rec) {
    const status = statusInfo(rec.snap, this.#now());
    rec.statusEl.textContent = t(status.key);
    rec.statusEl.className = `console-status-pill console-status-pill--${status.tone}`;
  }

  #renderCardOutput(rec) {
    if (!this.#showOutput) {
      rec.outputEl.textContent = t("console.output.disabled");
      rec.outputEl.classList.add("console-card-output--disabled");
      return;
    }
    rec.outputEl.classList.remove("console-card-output--disabled");
    const lines = (
      this.#lines.get(rec.snap.sessionId) ||
      rec.snap.recentLines ||
      []
    ).slice(-CARD_OUTPUT_LINES);
    rec.outputEl.textContent = lines.length
      ? lines.join("\n")
      : t("console.output.empty");
  }

  #renderCardDuration(rec) {
    const startedAt = rec.snap.connectedAt ?? rec.snap.openedAt;
    rec.durationEl.textContent =
      startedAt != null
        ? t("console.sidebar.running", {
            duration: formatDuration(this.#now() - startedAt),
          })
        : t(
            `console.state.${rec.snap.state === "connecting" ? "connecting" : "notRunning"}`,
          );
  }

  #startTicker() {
    this.#stopTicker();
    if (typeof setInterval !== "function") return;
    this.#tickId = setInterval(() => {
      for (const rec of this.#cards.values()) {
        this.#renderCardStatus(rec);
        this.#renderCardDuration(rec);
      }
    }, 1000);
    if (this.#tickId && typeof this.#tickId.unref === "function") {
      this.#tickId.unref();
    }
  }

  #stopTicker() {
    if (this.#tickId) {
      clearInterval(this.#tickId);
      this.#tickId = null;
    }
  }
}
