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
 * console-session.test.js — the ConsoleSession runtime snapshot + window-state
 * plumbing (Feature 210), unit-tested without a network connect. Byte counting +
 * recent output over a live shell are covered end-to-end in console-manager.test.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ConsoleSession } = require("../console-session");

function makeSession(overrides = {}) {
  return new ConsoleSession({
    def: { id: "c1", name: "db shell", sshServer: {}, jumps: [] },
    sessionId: "s1",
    hostKeys: { buildVerifier: () => () => {} },
    keyReader: () => Buffer.alloc(0),
    keepaliveMs: 0,
    windowNumber: 4,
    now: () => 1000,
    send: () => {},
    onState: () => {},
    onActivity: () => {},
    onEnd: () => {},
    ...overrides,
  });
}

test("a fresh session snapshot is metadata-only with no secret and no output", () => {
  const s = makeSession();
  const snap = s.snapshot();
  assert.equal(snap.id, "c1");
  assert.equal(snap.sessionId, "s1");
  assert.equal(snap.state, "idle");
  assert.equal(snap.windowNumber, 4);
  assert.equal(snap.openedAt, 1000); // stamped from the injected clock
  assert.equal(snap.connectedAt, null);
  assert.equal(snap.lastActivityAt, null);
  assert.equal(snap.bytesIn, 0);
  assert.equal(snap.bytesOut, 0);
  assert.deepEqual(snap.windowState, {
    visible: true,
    minimized: false,
    focused: false,
    fullScreen: false,
  });
  // No output unless explicitly requested…
  assert.equal("recentLines" in snap, false);
  // …and even then it carries no host/credential material.
  const withOutput = s.snapshot({ includeOutput: true });
  assert.deepEqual(withOutput.recentLines, []);
  const json = JSON.stringify(withOutput);
  assert.equal(/password|sshServer|jumps/.test(json), false);
});

test("setWindowState merges a partial visibility patch", () => {
  const s = makeSession();
  s.setWindowState({ minimized: true });
  assert.deepEqual(s.snapshot().windowState, {
    visible: true,
    minimized: true,
    focused: false,
    fullScreen: false,
  });
  s.setWindowState({ visible: false, focused: false });
  assert.deepEqual(s.snapshot().windowState, {
    visible: false,
    minimized: true,
    focused: false,
    fullScreen: false,
  });
});

test("consoleId/sessionId/state getters are stable", () => {
  const s = makeSession();
  assert.equal(s.consoleId, "c1");
  assert.equal(s.sessionId, "s1");
  assert.equal(s.state, "idle");
});
