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

// console-detail.js — the Console Manager details pane (Feature 210): a live
// dashboard for ONE console session in the centre pane, the console analogue of
// TunnelDetail. It is a pure view — the definition + session snapshot arrive via
// show()/updateSnapshot(), live output via applyActivity(), and every action is
// reported through constructor callbacks. It is NOT a terminal: the recent-output
// panel is a read-only, ANSI-stripped preview (last ~20 lines), never a live
// terminal, and it is only populated while the setting permits it. A 1 s ticker
// refreshes the elapsed-time fields in place. Host/route come from the non-secret
// console definition view; no secret ever reaches here.

import { el, clear } from "../dom.js";
import { t } from "../i18n.js";
import { icons } from "../icons.js";
import { typeIcon } from "./tunnel-list.js";
import {
  formatBytes,
  formatDuration,
  formatRelativeTime,
} from "../utils/format.js";

// A session is "idle" once it has been quiet this long (connected, no byte traffic).
const IDLE_MS = 30_000;
// Recent-output lines rendered in the preview.
const OUTPUT_LINES = 20;

/** Resolve the status pill { key, tone } from a session snapshot. Shared with the
 *  overview cards so both read a session's lifecycle identically. */
export function statusInfo(snap, now) {
  if (!snap) return { key: "console.state.notRunning", tone: "none" };
  switch (snap.state) {
    case "connecting":
      return { key: "console.state.connecting", tone: "connecting" };
    case "connected": {
      const quiet =
        snap.lastActivityAt != null && now - snap.lastActivityAt > IDLE_MS;
      return quiet
        ? { key: "console.state.idle", tone: "idle" }
        : { key: "console.state.connected", tone: "connected" };
    }
    case "error":
      return { key: "console.state.error", tone: "error" };
    case "closed":
      return { key: "console.state.closed", tone: "closed" };
    default:
      return { key: "console.state.notRunning", tone: "none" };
  }
}

/** The jump-host route as human labels, or null when there are none. */
function jumpLabels(def, jumpsById) {
  const ids = Array.isArray(def?.jumpHostIds) ? def.jumpHostIds : [];
  if (ids.length === 0) return null;
  return ids
    .map((id) => {
      const jh = jumpsById.get(id);
      return jh ? jh.label || `${jh.host}:${jh.port}` : id;
    })
    .join(" › ");
}

/** `host:port` for the console's target server. */
function destination(def) {
  const d = def || {};
  if (typeof d.sshHost !== "string" || d.sshHost.trim() === "") return null;
  return `${d.sshHost}:${d.sshPort ?? 22}`;
}

export class ConsoleDetail {
  #el;
  #emptyEl;
  #contentEl;
  #nameEl;
  #pillEl;
  #subEl;
  #switcherEl;
  #chipsEl;
  #outputEl;
  #infoVals = new Map(); // field key → value element
  #actions = {}; // name → button
  #pills = new Map(); // sessionId → switcher pill button

  #def = null;
  #snap = null;
  #sessions = []; // every open session for this console (for the window switcher)
  #jumpsById = new Map();
  #showOutput = true;
  #lines = [];
  #now;
  #tickId = null;

  #onBringForward;
  #onRestart;
  #onClose;
  #onOpenNew;
  #onCopyInfo;
  #onSelectSession;

  constructor({
    now,
    onBringForward,
    onRestart,
    onClose,
    onOpenNew,
    onCopyInfo,
    onSelectSession,
  } = {}) {
    this.#now = now || Date.now;
    this.#onBringForward = onBringForward || (() => {});
    this.#onRestart = onRestart || (() => {});
    this.#onClose = onClose || (() => {});
    this.#onOpenNew = onOpenNew || (() => {});
    this.#onCopyInfo = onCopyInfo || (() => {});
    this.#onSelectSession = onSelectSession || (() => {});
    this.#el = this.#build();
  }

  get element() {
    return this.#el;
  }

  #build() {
    this.#emptyEl = el("div", { class: "detail-empty" }, [
      el("p", {
        class: "detail-empty-hint",
        text: t("console.details.notRunningHint"),
      }),
    ]);

    this.#nameEl = el("span", { class: "console-detail-name" });
    this.#pillEl = el("span", { class: "console-status-pill" });
    this.#subEl = el("div", { class: "console-detail-sub" });
    // When a console has more than one open window, a row of pills lets the user
    // pick which session (window) the details + output track.
    this.#switcherEl = el("div", {
      class: "console-session-switcher",
      role: "tablist",
      "aria-label": t("console.section.window"),
      hidden: true,
    });

    const header = el("header", { class: "console-detail-header" }, [
      el("div", { class: "console-detail-heading" }, [
        this.#nameEl,
        this.#pillEl,
      ]),
      this.#subEl,
      this.#switcherEl,
    ]);

    const actions = el("div", { class: "console-detail-actions" }, [
      this.#actionBtn(
        "bringForward",
        icons.externalWindow(),
        "console.action.bringForward",
        () => this.#onBringForward(this.#snap?.sessionId),
        true,
      ),
      this.#actionBtn(
        "openNew",
        icons.terminal(),
        "console.action.openNew",
        () => this.#onOpenNew(this.#def?.id),
      ),
      this.#actionBtn(
        "restart",
        icons.refresh(),
        "console.action.restart",
        () => this.#onRestart(this.#snap?.sessionId),
      ),
      this.#actionBtn("close", icons.x(), "console.action.close", () =>
        this.#onClose(this.#snap?.sessionId),
      ),
      this.#actionBtn("copyInfo", icons.copy(), "console.action.copyInfo", () =>
        this.#onCopyInfo(this.#def),
      ),
    ]);

    this.#chipsEl = el("div", { class: "console-window-chips" });
    this.#outputEl = el("pre", {
      class: "console-output",
      tabindex: "0",
      "aria-label": t("console.section.output"),
    });

    this.#contentEl = el(
      "div",
      { class: "console-detail-content", hidden: true },
      [
        header,
        actions,
        this.#cardGroup("console.section.window", this.#chipsEl),
        this.#cardGroup("console.section.output", this.#outputEl),
        this.#cardGroup(
          "console.section.runtime",
          this.#infoGrid([
            ["started", "console.runtime.started"],
            ["runningTime", "console.runtime.runningTime"],
            ["destination", "console.runtime.destination"],
            ["jumpHost", "console.runtime.jumpHost"],
            ["size", "console.runtime.size"],
          ]),
        ),
        this.#cardGroup(
          "console.section.activity",
          this.#infoGrid([
            ["sent", "console.activity.sent"],
            ["received", "console.activity.received"],
            ["lastActivity", "console.activity.lastActivity"],
          ]),
        ),
      ],
    );

    return el(
      "section",
      { class: "console-detail", "aria-label": t("consoles.title") },
      [this.#emptyEl, this.#contentEl],
    );
  }

  #actionBtn(name, glyph, labelKey, onClick, primary = false) {
    const btn = el(
      "button",
      {
        class: `btn console-action-btn${primary ? " console-action-btn--primary" : ""}`,
        type: "button",
        title: t(labelKey),
        onClick,
      },
      [
        el("span", { class: "console-action-glyph", html: glyph }),
        el("span", { class: "console-action-label", text: t(labelKey) }),
      ],
    );
    this.#actions[name] = btn;
    return btn;
  }

  #cardGroup(titleKey, body) {
    return el("section", { class: "console-card-group" }, [
      el("h3", { class: "console-card-title", text: t(titleKey) }),
      body,
    ]);
  }

  #infoGrid(fields) {
    const rows = [];
    for (const [key, labelKey] of fields) {
      const valueEl = el("dd", { class: "console-info-value" });
      this.#infoVals.set(key, valueEl);
      rows.push(el("dt", { class: "console-info-label", text: t(labelKey) }));
      rows.push(valueEl);
    }
    return el("dl", { class: "console-info-grid" }, rows);
  }

  /**
   * Show a console. `ctx`: { snap, sessions, jumpsById, showOutput }. `snap` is the
   * running session the pane tracks (null when the console has no open session);
   * `sessions` is every open session for this console (drives the window switcher).
   */
  show(def, { snap = null, sessions = [], jumpsById, showOutput = true } = {}) {
    this.#def = def || null;
    this.#snap = snap;
    this.#sessions = Array.isArray(sessions) ? sessions : [];
    this.#showOutput = showOutput !== false;
    if (jumpsById instanceof Map) this.#jumpsById = jumpsById;
    this.#lines = Array.isArray(snap?.recentLines) ? snap.recentLines : [];
    this.#renderAll();
    this.#startTicker();
  }

  /** Update just the switcher's session set (windows opened/closed for this
   *  console) without disturbing the shown session's output. */
  setSessions(sessions) {
    this.#sessions = Array.isArray(sessions) ? sessions : [];
    if (this.#def) this.#renderSwitcher();
  }

  /** No console selected → the empty hint; stop the elapsed-time ticker. */
  clear() {
    this.#def = null;
    this.#snap = null;
    this.#stopTicker();
    this.#renderAll();
  }

  /** Fold in a fresh session-state snapshot (metadata only — no output). */
  updateSnapshot(snap) {
    if (!snap || !this.#def) return;
    if (this.#snap && snap.sessionId !== this.#snap.sessionId) return;
    this.#snap = snap;
    this.#renderValues();
  }

  /** Fold in a live activity heartbeat (bytes + optional recent output lines). */
  applyActivity(activity) {
    if (
      !activity ||
      !this.#snap ||
      activity.sessionId !== this.#snap.sessionId
    ) {
      return;
    }
    this.#snap = {
      ...this.#snap,
      bytesIn: activity.bytesIn ?? this.#snap.bytesIn,
      bytesOut: activity.bytesOut ?? this.#snap.bytesOut,
      lastActivityAt: activity.lastActivityAt ?? this.#snap.lastActivityAt,
      cols: activity.cols ?? this.#snap.cols,
      rows: activity.rows ?? this.#snap.rows,
    };
    if (Array.isArray(activity.lines)) this.#lines = activity.lines;
    this.#renderValues();
    this.#renderOutput();
  }

  destroy() {
    this.#stopTicker();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  #renderAll() {
    const has = Boolean(this.#def);
    this.#emptyEl.hidden = has;
    this.#contentEl.hidden = !has;
    if (!has) return;
    this.#renderSwitcher();
    this.#renderValues();
    this.#renderOutput();
  }

  /** Rebuild the window switcher — one pill per open session, active = the shown
   *  one. Hidden entirely unless the console has more than one window open. */
  #renderSwitcher() {
    clear(this.#switcherEl);
    this.#pills.clear();
    const multi = this.#sessions.length > 1;
    this.#switcherEl.hidden = !multi;
    if (!multi) return;
    for (const s of this.#sessions) {
      const pill = el("button", {
        class: "console-session-pill",
        type: "button",
        role: "tab",
        text: t("console.details.window", { n: s.windowNumber }),
        onClick: () => this.#onSelectSession(s.sessionId),
      });
      this.#pills.set(s.sessionId, pill);
      this.#switcherEl.appendChild(pill);
    }
    this.#syncSwitcherActive();
  }

  /** Mark the pill for the currently-shown session active. */
  #syncSwitcherActive() {
    const active = this.#snap?.sessionId;
    for (const [sid, pill] of this.#pills) {
      const on = sid === active;
      pill.classList.toggle("console-session-pill--active", on);
      pill.setAttribute("aria-selected", String(on));
    }
  }

  #renderValues() {
    if (!this.#def) return;
    const now = this.#now();
    const snap = this.#snap;
    const running = Boolean(snap);

    // Heading + status pill.
    clear(this.#nameEl);
    this.#nameEl.appendChild(typeIcon(this.#def));
    this.#nameEl.appendChild(
      el("span", { text: this.#def.name || t("consoles.unnamed") }),
    );
    const status = statusInfo(snap, now);
    this.#pillEl.textContent = t(status.key);
    this.#pillEl.className = `console-status-pill console-status-pill--${status.tone}`;

    // Sub-line: connected-to host · Window #N · running for …
    clear(this.#subEl);
    const dest = destination(this.#def);
    if (running && dest) {
      this.#subEl.appendChild(
        el("span", { text: t("console.details.connectedTo", { host: dest }) }),
      );
    }
    if (running && snap.windowNumber) {
      this.#subEl.appendChild(
        el("span", {
          class: "console-detail-sub-item",
          text: t("console.details.window", { n: snap.windowNumber }),
        }),
      );
    }

    // Window-status chips + the active window pill.
    this.#renderChips();
    this.#syncSwitcherActive();

    // Runtime.
    const startedAt = snap ? (snap.connectedAt ?? snap.openedAt) : null;
    this.#setInfo(
      "started",
      startedAt != null ? formatRelativeTime(startedAt, now) : dash(),
    );
    this.#setInfo(
      "runningTime",
      startedAt != null ? formatDuration(now - startedAt) : dash(),
    );
    this.#setInfo("destination", dest || dash());
    this.#setInfo("jumpHost", jumpLabels(this.#def, this.#jumpsById) || dash());
    this.#setInfo(
      "size",
      running && snap.cols && snap.rows
        ? `${snap.cols} × ${snap.rows}`
        : dash(),
    );

    // Activity.
    this.#setInfo("sent", running ? formatBytes(snap.bytesOut || 0) : dash());
    this.#setInfo(
      "received",
      running ? formatBytes(snap.bytesIn || 0) : dash(),
    );
    this.#setInfo(
      "lastActivity",
      running && snap.lastActivityAt
        ? formatRelativeTime(snap.lastActivityAt, now)
        : dash(),
    );

    // Action availability.
    this.#actions.bringForward.disabled = !running;
    this.#actions.restart.disabled = !running;
    this.#actions.close.disabled = !running;
  }

  #renderChips() {
    clear(this.#chipsEl);
    const ws = this.#snap?.windowState;
    if (!this.#snap || !ws) {
      this.#chipsEl.appendChild(chip("console.state.notRunning", "none"));
      return;
    }
    this.#chipsEl.appendChild(
      ws.visible
        ? chip("console.window.visible", "on")
        : chip("console.window.hidden", "off"),
    );
    if (ws.minimized)
      this.#chipsEl.appendChild(chip("console.window.minimized", "off"));
    if (ws.fullScreen)
      this.#chipsEl.appendChild(chip("console.window.fullScreen", "on"));
    if (ws.focused)
      this.#chipsEl.appendChild(chip("console.window.focused", "on"));
  }

  #renderOutput() {
    if (!this.#showOutput) {
      this.#outputEl.textContent = "";
      this.#outputEl.classList.add("console-output--disabled");
      this.#outputEl.textContent = `${t("console.output.disabled")} ${t("console.output.disabledHint")}`;
      return;
    }
    this.#outputEl.classList.remove("console-output--disabled");
    const lines = this.#lines.slice(-OUTPUT_LINES);
    if (lines.length === 0) {
      this.#outputEl.textContent = t("console.output.empty");
      this.#outputEl.classList.add("console-output--empty");
      return;
    }
    this.#outputEl.classList.remove("console-output--empty");
    this.#outputEl.textContent = lines.join("\n");
    // Auto-scroll to the newest line.
    this.#outputEl.scrollTop = this.#outputEl.scrollHeight;
  }

  #setInfo(key, text) {
    const node = this.#infoVals.get(key);
    if (node) node.textContent = text;
  }

  #startTicker() {
    this.#stopTicker();
    // Refresh elapsed-time fields (running time, relative timestamps, idle pill)
    // once a second while a session is shown.
    if (typeof setInterval !== "function") return;
    this.#tickId = setInterval(() => {
      if (this.#def) this.#renderValues();
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

/** The em-dash placeholder for an unavailable field. */
function dash() {
  return t("console.runtime.none");
}

/** A window-status chip. */
function chip(labelKey, tone) {
  return el("span", {
    class: `console-chip console-chip--${tone}`,
    text: t(labelKey),
  });
}
