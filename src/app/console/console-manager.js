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

/**
 * console-manager.js — the single `ConsoleManager` that owns every live console
 * session (Feature 200). The console-side sibling of the tunnel engine.
 *
 * It holds a `Map<sessionId, ConsoleSession>`, reads resolved+decrypted console
 * definitions from the store, and reuses the SHARED host-key mediator + injected
 * `keyReader` so a console connects exactly like a tunnel. It never imports
 * Electron: opening / revealing / closing the terminal window and pushing bytes to
 * it are injected (`openWindow` / `revealWindow` / `destroyWindow` / `sendToWindow`),
 * and live session state reaches the renderer through the injected `broadcast`.
 *
 * Two broadcast channels feed the Console Manager (Feature 210), both secret-free:
 *   - `jumphippo:console-state` — a runtime metadata snapshot on each discrete change
 *     (state / window visibility), NO output. Superset of the old `{ id, sessionId,
 *     state }`, so existing lamp consumers keep working.
 *   - `jumphippo:console-activity` — a coalesced byte/output heartbeat, streamed ONLY
 *     for sessions the main window is actively watching (`watch()`), and carrying
 *     recent-output `lines` only when the consoleShowOutput setting permits it.
 *
 * Connect is deferred: `open()` mints the session + window immediately, then the
 * window signals `ready(cols, rows)` once its terminal is sized, and only then
 * does the session dial out — so the remote pty is created at the right size.
 */
"use strict";

const crypto = require("crypto");

const { ConsoleSession } = require("./console-session");

// How long to coalesce byte/output activity before broadcasting one
// `jumphippo:console-activity` per watched session (event-driven, never polled).
const ACTIVITY_FLUSH_MS = 150;
// Lines shipped to a watching renderer per activity flush (the view renders ~20).
const ACTIVITY_LINE_MAX = 40;

class ConsoleManager {
  #getStores;
  #broadcast;
  #hostKeys;
  #keyReader;
  #getSshKeepaliveMs;
  #getShowOutput;
  #openWindow;
  #sendToWindow;
  #revealWindow;
  #destroyWindow;
  #now;

  #sessions = new Map(); // sessionId → ConsoleSession
  #windowSeq = 0; // monotonic "Window #N" counter
  #watched = new Set(); // sessionIds the main window is currently watching
  #dirty = new Set(); // watched sessions with pending activity to flush
  #flushTimer = null;

  /**
   * @param {object} deps
   * @param {() => import('../store/stores').Stores} deps.getStores
   * @param {(channel: string, payload: object) => void} [deps.broadcast]
   * @param {import('../tunnel/host-key-mediator').HostKeyMediator} deps.hostKeys
   * @param {typeof import('fs').readFileSync} [deps.keyReader]
   * @param {() => number} [deps.getSshKeepaliveMs]  ssh2 keepalive interval (0 = off)
   * @param {() => boolean} [deps.getShowOutput]  whether recent output may cross to the UI
   * @param {() => number} [deps.now]  clock (injected for tests)
   * @param {(sessionId: string, meta: {title: string}) => void} deps.openWindow
   * @param {(sessionId: string, channel: string, payload: object) => void} deps.sendToWindow
   * @param {(sessionId: string) => void} [deps.revealWindow]  bring a console window forward
   * @param {(sessionId: string) => void} [deps.destroyWindow]  close a console window
   */
  constructor({
    getStores,
    broadcast,
    hostKeys,
    keyReader,
    getSshKeepaliveMs,
    getShowOutput,
    now,
    openWindow,
    sendToWindow,
    revealWindow,
    destroyWindow,
  }) {
    this.#getStores = getStores;
    this.#broadcast = broadcast;
    this.#hostKeys = hostKeys;
    this.#keyReader = keyReader;
    this.#getSshKeepaliveMs = getSshKeepaliveMs || (() => 0);
    this.#getShowOutput = getShowOutput || (() => true);
    this.#now = now || Date.now;
    this.#openWindow = openWindow || (() => {});
    this.#sendToWindow = sendToWindow || (() => {});
    this.#revealWindow = revealWindow || (() => {});
    this.#destroyWindow = destroyWindow || (() => {});
  }

  /**
   * Open a console by id: resolve it, create a session, and open its terminal
   * window. The SSH connect is deferred to `ready()`. Returns `{ sessionId, id }`.
   * Throws NOT_FOUND for an unknown / unresolvable console.
   */
  open(consoleId) {
    const def = this.#getStores().consoleStore().getDecrypted(consoleId);
    if (!def) {
      const err = new Error(`console not found: ${consoleId}`);
      err.code = "NOT_FOUND";
      throw err;
    }
    const view = this.#getStores().consoleStore().get(consoleId);
    const title = (view && view.name) || def.name || "Console";

    const sessionId = crypto.randomUUID();
    const windowNumber = ++this.#windowSeq;
    const session = new ConsoleSession({
      def,
      sessionId,
      hostKeys: this.#hostKeys,
      keyReader: this.#keyReader,
      keepaliveMs: this.#getSshKeepaliveMs(),
      windowNumber,
      now: this.#now,
      send: (channel, payload) =>
        this.#sendToWindow(sessionId, channel, payload),
      onState: (snapshot) =>
        this.#broadcast?.("jumphippo:console-state", snapshot),
      onActivity: (sid) => this.#markActivity(sid),
      onEnd: () => this.#sessions.delete(sessionId),
    });
    this.#sessions.set(sessionId, session);

    // Announce the pending session so the sidebar row lamp lights immediately. Carry
    // the window ordinal + open time so the details view can title/clock it at once.
    this.#broadcast?.("jumphippo:console-state", {
      id: consoleId,
      sessionId,
      state: "connecting",
      windowNumber,
      openedAt: this.#now(),
    });

    this.#openWindow(sessionId, { title });
    return { sessionId, id: consoleId };
  }

  /** The window is ready + sized — dial out and open the shell. */
  ready(sessionId, { cols, rows } = {}) {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    session.start({ cols, rows }).catch((err) => {
      console.error(
        `[console] session ${sessionId} start failed:`,
        err && err.message,
      );
    });
  }

  /** Forward the window's keystrokes to the shell. */
  input(sessionId, data) {
    this.#sessions.get(sessionId)?.write(data);
  }

  /** Forward a window resize to the remote pty. */
  resize(sessionId, cols, rows) {
    this.#sessions.get(sessionId)?.setWindow(cols, rows);
  }

  /**
   * The window closed (or an explicit close intent) — tear the session down AND
   * close its terminal window. A no-op if the session already ended on its own
   * (shell exit / drop). Safe to call from the window's own `closed` handler: the
   * window is already gone there, so `destroyWindow` is a guarded no-op.
   */
  close(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    this.#sessions.delete(sessionId);
    this.#watched.delete(sessionId);
    this.#dirty.delete(sessionId);
    session.dispose(); // onEnd is a no-op delete after the map entry is gone
    this.#destroyWindow(sessionId);
    this.#broadcast?.("jumphippo:console-state", {
      id: session.consoleId,
      sessionId,
      state: "closed",
    });
  }

  /**
   * A full runtime snapshot for one session (Console Manager details), or null.
   * `includeOutput` is honoured only when the consoleShowOutput setting allows it,
   * so a caller can request output freely and the gate is enforced here.
   */
  session(sessionId, { includeOutput = false } = {}) {
    const s = this.#sessions.get(sessionId);
    if (!s) return null;
    return s.snapshot({
      includeOutput: includeOutput && this.#getShowOutput(),
    });
  }

  /**
   * Set the sessions the main window is watching (details = one, overview = all,
   * null/[] = none). Enables the coalesced `jumphippo:console-activity` stream for
   * exactly those sessions and immediately seeds each with its current snapshot.
   */
  watch(sessionIds) {
    this.#watched = new Set(Array.isArray(sessionIds) ? sessionIds : []);
    for (const sid of this.#watched) this.#flushOne(sid);
  }

  /** Bring a session's terminal window forward (restore + raise + focus). */
  reveal(sessionId) {
    if (!this.#sessions.has(sessionId)) return { ok: false };
    this.#revealWindow(sessionId);
    return { ok: true };
  }

  /**
   * Restart a session: close it (and its window) and open a fresh session for the
   * same console. Returns the new `{ sessionId, id }`, or null for an unknown id.
   */
  restart(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) return null;
    const consoleId = session.consoleId;
    this.close(sessionId);
    return this.open(consoleId);
  }

  /** Fold a window-visibility change into a session and broadcast the new state. */
  setWindowState(sessionId, windowState) {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    session.setWindowState(windowState);
    this.#broadcast?.("jumphippo:console-state", session.snapshot());
  }

  /** Active-session runtime snapshots (metadata only, no output) for the sidebar +
   *  overview on (re)load. Live changes arrive over jumphippo:console-state. */
  sessions() {
    return [...this.#sessions.values()].map((s) => s.snapshot());
  }

  /** Dispose every session (app quit). */
  disposeAll() {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    this.#watched.clear();
    this.#dirty.clear();
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    for (const s of sessions) {
      try {
        s.dispose();
      } catch {
        /* best-effort teardown */
      }
    }
  }

  // ── Activity coalescing (Feature 210) ─────────────────────────────────────────

  /** A watched session produced byte/output activity — schedule a coalesced flush. */
  #markActivity(sessionId) {
    if (!this.#watched.has(sessionId)) return; // gate: only watched sessions stream
    this.#dirty.add(sessionId);
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      const ids = [...this.#dirty];
      this.#dirty.clear();
      for (const sid of ids) this.#flushOne(sid);
    }, ACTIVITY_FLUSH_MS);
    if (typeof this.#flushTimer.unref === "function") this.#flushTimer.unref();
  }

  /** Broadcast one session's current activity (+ recent output when permitted). */
  #flushOne(sessionId) {
    const s = this.#sessions.get(sessionId);
    if (!s || !this.#watched.has(sessionId)) return;
    const showOutput = this.#getShowOutput();
    const snap = s.snapshot({ includeOutput: showOutput });
    this.#broadcast?.("jumphippo:console-activity", {
      sessionId,
      bytesIn: snap.bytesIn,
      bytesOut: snap.bytesOut,
      lastActivityAt: snap.lastActivityAt,
      cols: snap.cols,
      rows: snap.rows,
      ...(showOutput
        ? { lines: snap.recentLines.slice(-ACTIVITY_LINE_MAX) }
        : {}),
    });
  }
}

module.exports = { ConsoleManager };
