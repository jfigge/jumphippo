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
 * console-session.js — one live interactive-shell session (Feature 200).
 *
 * A session owns the SSH chain to a console's target server (built with the SAME
 * `connectChain()` a tunnel uses — jump-host chaining, per-hop auth, host-key TOFU
 * through the shared mediator, and the injected `keyReader`) and, on top of the
 * final hop, an ssh2 `shell()` pty channel. Bytes the shell emits are relayed to
 * the console window (`console:data`); the window's keystrokes come back through
 * `write()` and its resizes through `setWindow()`. There is no forwarding and no
 * listener — a console is not a tunnel; the chain terminates at the target server
 * and a shell is opened there. It does keep lightweight runtime telemetry for the
 * Console Manager (Feature 210) — byte counters, timestamps, size, window state and
 * a bounded ANSI-stripped recent-output preview — exposed via `snapshot()`. None of
 * it is a secret and the output preview is never logged, persisted, or exported.
 *
 * Lifecycle is one-shot and fail-closed: `connecting → connected → (closed|error)`.
 * A dropped connection or a shell exit ends the session and tells the window; the
 * user reopens (shell state is in-memory and must never be silently re-established).
 */
"use strict";

const { connectChain } = require("../tunnel/ssh-chain");
const { OutputBuffer } = require("./ansi");

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const TERM = "xterm-256color";

// Recent-output ring buffer (Feature 210): keep the last N lines in memory so the
// Console Manager can show a preview; a bounded buffer keeps memory constant. The
// view is seeded with at most VIEW_MAX lines (it renders ~20). Output NEVER reaches
// a log, the diagnostics report, or an export — it lives only here and, while a
// console is being watched, on the main renderer.
const OUTPUT_CAP = 200;
const OUTPUT_VIEW_MAX = 40;

/** Byte length of a keystroke/paste payload (string or Buffer/typed-array). */
function byteLength(data) {
  if (typeof data === "string") return Buffer.byteLength(data);
  return data && typeof data.length === "number" ? data.length : 0;
}

class ConsoleSession {
  #def;
  #sessionId;
  #hostKeys;
  #keyReader;
  #keepaliveMs;
  #send;
  #onState;
  #onEnd;

  #now;
  #onActivity;
  #windowNumber;

  #chain = null; // { client, dispose } from connectChain
  #stream = null; // the ssh2 shell channel
  #state = "idle";
  #terminal = false; // set once the session reaches a closed/error end state

  // ── Runtime telemetry (Feature 210) — surfaced to the Console Manager, never a
  //    secret. `#output` is the bounded recent-lines ring; the rest are counters +
  //    timestamps the details/overview views render.
  #openedAt;
  #connectedAt = null;
  #lastActivityAt = null;
  #bytesIn = 0;
  #bytesOut = 0;
  #cols = DEFAULT_COLS;
  #rows = DEFAULT_ROWS;
  #windowState = {
    visible: true,
    minimized: false,
    focused: false,
    fullScreen: false,
  };
  #output = new OutputBuffer(OUTPUT_CAP);

  /**
   * @param {object} opts
   * @param {object} opts.def          resolved console `{ id, name, sshServer, jumps }`
   * @param {string} opts.sessionId
   * @param {import('../tunnel/host-key-mediator').HostKeyMediator} opts.hostKeys
   * @param {typeof import('fs').readFileSync} opts.keyReader
   * @param {number} opts.keepaliveMs  ssh2 keepalive interval (0 = off)
   * @param {number} [opts.windowNumber]  monotonic per-open window ordinal ("Window #N")
   * @param {() => number} [opts.now]     clock (injected for tests)
   * @param {(channel: string, payload: object) => void} opts.send  push to the window
   * @param {(snapshot: object) => void} opts.onState  state-transition callback
   * @param {(sessionId: string) => void} [opts.onActivity]  byte/output activity tick
   * @param {() => void} opts.onEnd     called exactly once when the session terminates
   */
  constructor({
    def,
    sessionId,
    hostKeys,
    keyReader,
    keepaliveMs,
    windowNumber,
    now,
    send,
    onState,
    onActivity,
    onEnd,
  }) {
    this.#def = def || {};
    this.#sessionId = sessionId;
    this.#hostKeys = hostKeys;
    this.#keyReader = keyReader;
    this.#keepaliveMs = keepaliveMs || 0;
    this.#windowNumber = windowNumber || 0;
    this.#now = now || Date.now;
    this.#send = send || (() => {});
    this.#onState = onState || (() => {});
    this.#onActivity = onActivity || (() => {});
    this.#onEnd = onEnd || (() => {});
    this.#openedAt = this.#now();
  }

  get sessionId() {
    return this.#sessionId;
  }

  get consoleId() {
    return this.#def.id;
  }

  get state() {
    return this.#state;
  }

  /**
   * A serializable runtime snapshot for the Console Manager. Carries counters,
   * timestamps, size and window state — NEVER a secret (host/route come from the
   * store's non-secret console view in the renderer, not from here). `recentLines`
   * is included only when `includeOutput` is set (the caller gates that on the
   * consoleShowOutput setting + an active watch).
   */
  snapshot({ includeOutput = false } = {}) {
    return {
      id: this.#def.id,
      sessionId: this.#sessionId,
      state: this.#state,
      windowNumber: this.#windowNumber,
      openedAt: this.#openedAt,
      connectedAt: this.#connectedAt,
      lastActivityAt: this.#lastActivityAt,
      bytesIn: this.#bytesIn,
      bytesOut: this.#bytesOut,
      cols: this.#cols,
      rows: this.#rows,
      windowState: { ...this.#windowState },
      ...(includeOutput
        ? { recentLines: this.#output.recent(OUTPUT_VIEW_MAX) }
        : {}),
    };
  }

  /** Merge a window-visibility change in (fed by main's BrowserWindow events). */
  setWindowState(patch) {
    if (patch && typeof patch === "object") {
      this.#windowState = { ...this.#windowState, ...patch };
    }
  }

  /**
   * Connect the chain and open the shell, sized to the window's real grid. Called
   * once, when the window signals it is ready. Never throws for an expected failure
   * — a connect/shell error ends the session and notifies the window instead.
   */
  async start({ cols, rows } = {}) {
    if (this.#terminal || this.#chain) return;
    const w = { cols: cols || DEFAULT_COLS, rows: rows || DEFAULT_ROWS };
    this.#cols = w.cols;
    this.#rows = w.rows;
    this.#setState("connecting");

    let chain;
    try {
      chain = await connectChain({
        hops: [
          ...(Array.isArray(this.#def.jumps) ? this.#def.jumps : []),
          this.#def.sshServer,
        ],
        tunnelId: this.#def.id || this.#sessionId,
        hostVerifierFactory: (ctx) => this.#hostKeys.buildVerifier(ctx),
        readFileSync: this.#keyReader,
        keepaliveInterval: this.#keepaliveMs,
      });
    } catch (err) {
      this.#end("error", (err && err.message) || "connection failed");
      return;
    }
    // Disposed while connecting (window closed) — drop the freshly-built chain.
    if (this.#terminal) {
      try {
        chain.dispose();
      } catch {
        /* already torn down */
      }
      return;
    }
    this.#chain = chain;

    // A drop at the SSH layer (dead peer, server close) ends the session.
    chain.client.on("close", () => this.#end("closed", "connection closed"));
    chain.client.on("error", (err) =>
      this.#end("error", (err && err.message) || "connection error"),
    );

    chain.client.shell(
      { term: TERM, cols: w.cols, rows: w.rows, width: 0, height: 0 },
      (err, stream) => {
        if (err) {
          this.#end("error", (err && err.message) || "shell failed");
          return;
        }
        if (this.#terminal) {
          try {
            stream.close();
          } catch {
            /* already gone */
          }
          return;
        }
        this.#stream = stream;
        this.#connectedAt = this.#now();
        this.#setState("connected");

        stream.on("data", (chunk) => this.#emit(chunk));
        // With a pty, stderr is folded into the main channel — relay it too in the
        // rare case a server splits it, so nothing is silently dropped.
        stream.stderr?.on("data", (chunk) => this.#emit(chunk));
        stream.on("close", () => this.#end("closed", "session closed"));
        stream.on("error", () => {
          /* the close handler drives teardown; swallow the error event */
        });
      },
    );
  }

  /** Write the window's keystrokes to the shell (best-effort). */
  write(data) {
    if (this.#terminal || !this.#stream) return;
    try {
      this.#stream.write(data);
      this.#bytesOut += byteLength(data);
      this.#lastActivityAt = this.#now();
      this.#onActivity(this.#sessionId);
    } catch {
      /* the stream may be mid-teardown */
    }
  }

  /** Apply a window resize to the remote pty (rows, cols order for ssh2). */
  setWindow(cols, rows) {
    if (this.#terminal || !this.#stream) return;
    this.#cols = cols || DEFAULT_COLS;
    this.#rows = rows || DEFAULT_ROWS;
    try {
      this.#stream.setWindow(this.#rows, this.#cols, 0, 0);
    } catch {
      /* resize is best-effort */
    }
  }

  /** Tear the session down (the window closed). Silent — no window notification. */
  dispose() {
    this.#end("closed", "window closed", { notifyWindow: false });
  }

  /** Relay one output chunk to the window as raw bytes (byte-safe for UTF-8). */
  #emit(chunk) {
    if (this.#terminal) return;
    this.#bytesIn += chunk.length;
    this.#lastActivityAt = this.#now();
    this.#output.push(chunk); // ANSI-stripped, bounded — for the Console Manager
    this.#send("console:data", { data: new Uint8Array(chunk) });
    this.#onActivity(this.#sessionId);
  }

  #setState(state, detail) {
    this.#state = state;
    // Broadcast the full runtime snapshot (metadata only — no output, no secret) so
    // the sidebar + details update on each discrete change without a follow-up fetch.
    this.#onState({
      ...this.snapshot(),
      ...(detail ? { detail } : {}),
    });
  }

  /**
   * Reach a terminal state exactly once: broadcast the final state, optionally tell
   * the window why it closed, dispose the SSH resources, and fire onEnd so the
   * manager forgets the session.
   */
  #end(state, reason, { notifyWindow = true } = {}) {
    if (this.#terminal) return;
    this.#terminal = true;
    this.#setState(state, reason);
    if (notifyWindow) {
      this.#send("console:closed", { reason, error: state === "error" });
    }
    try {
      this.#stream?.close();
    } catch {
      /* already closed */
    }
    this.#stream = null;
    try {
      this.#chain?.dispose();
    } catch {
      /* already disposed */
    }
    this.#chain = null;
    this.#output.clear(); // drop the recent-output buffer on end (never persisted)
    this.#onEnd();
  }
}

module.exports = { ConsoleSession };
