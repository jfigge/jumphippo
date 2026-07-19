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
 * ansi.js — turn raw pty output into a bounded, plain-text "recent lines" preview
 * (Feature 210 Console Manager). This is a LOSSY, read-only rendering meant only to
 * help a user recognise which console is which — it is NOT a terminal emulator: we
 * strip ANSI/OSC escape sequences and other control bytes, approximate a carriage
 * return as an overwrite of the current line, and keep only the last N completed
 * lines. It never interprets cursor movement, colours, or alternate screens.
 *
 * The `OutputBuffer` decodes incoming Buffers with a StringDecoder so multi-byte
 * UTF-8 that straddles a chunk boundary is not corrupted, and holds a partial
 * trailing line until its newline arrives (so an escape sequence split across
 * chunks is only stripped once the line is complete).
 */
"use strict";

const { StringDecoder } = require("string_decoder");

// OSC sequences (ESC ] … terminated by BEL U+0007 or ST "ESC \\"). Their payload —
// e.g. a window title — is arbitrary text and may contain spaces, so consume it
// non-greedily up to the terminator. Built via RegExp from doubled-backslash
// escapes so no raw control byte lives in this source.
const OSC_RE = new RegExp("\\u001B\\][\\s\\S]*?(?:\\u0007|\\u001B\\\\)", "g");

// CSI / two-character escape sequences (ESC = U+001B, CSI = U+009B). Deliberately
// broad — a preview would rather drop an odd byte than leak a raw escape.
const ANSI_RE = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])",
  "g",
);

// Remaining C0/C1 control bytes to drop AFTER carriage-return handling. Keeps tab
// (U+0009); newline (U+000A) is consumed by the line split so it never reaches here.
const CTRL_RE = new RegExp(
  "[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]",
  "g",
);

/**
 * Approximate carriage returns. A CRLF line ending leaves a trailing `\r` on the
 * split line — that is a line terminator, NOT an overwrite, so drop it first. Any
 * `\r` that remains is a real in-line cursor return (progress bars, redraws): the
 * text after the last one overwrites what came before, so keep that tail.
 */
function applyCarriageReturns(line) {
  const s = line.endsWith("\r") ? line.slice(0, -1) : line;
  const cr = s.lastIndexOf("\r");
  return cr === -1 ? s : s.slice(cr + 1);
}

/** Strip ANSI/OSC escape sequences + control bytes from a single line of text. */
function stripAnsi(str) {
  if (typeof str !== "string") return "";
  const noEsc = str.replace(OSC_RE, "").replace(ANSI_RE, "");
  return applyCarriageReturns(noEsc).replace(CTRL_RE, "");
}

/**
 * A bounded rolling buffer of the most recent plain-text output lines.
 * Feed it raw pty Buffers (or strings) via `push`; read the tail via `recent`.
 */
class OutputBuffer {
  #capacity;
  #lines = []; // completed, ANSI-stripped lines (at most #capacity)
  #pending = ""; // raw (un-stripped) text of the line still being built
  #decoder = new StringDecoder("utf8");

  constructor(capacity = 200) {
    this.#capacity = Math.max(1, capacity | 0);
  }

  /** Append a chunk of raw pty output. Accepts a Buffer or a string. */
  push(chunk) {
    if (chunk == null) return;
    const text = typeof chunk === "string" ? chunk : this.#decoder.write(chunk);
    if (!text) return;
    this.#pending += text;
    let nl = this.#pending.indexOf("\n");
    while (nl !== -1) {
      const raw = this.#pending.slice(0, nl);
      this.#lines.push(stripAnsi(raw));
      if (this.#lines.length > this.#capacity) {
        this.#lines.splice(0, this.#lines.length - this.#capacity);
      }
      this.#pending = this.#pending.slice(nl + 1);
      nl = this.#pending.indexOf("\n");
    }
  }

  /**
   * The last `max` lines as plain strings, including the in-progress partial line
   * (stripped) when it is non-empty — so live output shows before its newline.
   */
  recent(max = 20) {
    const n = Math.max(0, max | 0);
    const partial = stripAnsi(this.#pending);
    const done = partial ? [...this.#lines, partial] : this.#lines;
    return n === 0 ? [] : done.slice(-n);
  }

  /** Drop all buffered output (session end). */
  clear() {
    this.#lines = [];
    this.#pending = "";
  }
}

module.exports = { stripAnsi, OutputBuffer };
