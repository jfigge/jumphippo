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
 * console-manager.test.js — end-to-end console session tests against an in-process
 * ssh2 server with an echo shell (harness `startSsh({ shell: true })`). Proves the
 * ConsoleManager + ConsoleSession connect the chain, open a shell, relay bytes both
 * ways, resize, and tear down — reusing the same connectChain the tunnel engine uses.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

const { ConsoleManager } = require("../console-manager");
const {
  startSsh,
  sshHop,
  waitFor,
  freePort,
} = require("../../tunnel/tests/harness");

// A host-key mediator stand-in that trusts every hop (the real TOFU path is
// covered by host-key-mediator.test.js + host-verifier.test.js).
const trustHostKeys = {
  buildVerifier: () => (_key, verify) => verify(true),
};

function fakeStores(def) {
  return {
    consoleStore: () => ({
      getDecrypted: (id) => (id === def.id ? def : null),
      get: (id) => (id === def.id ? { id, name: def.name } : null),
    }),
  };
}

/** Concatenate every console:data payload (Uint8Array) sent to the window. */
function decodeSent(sent) {
  return sent
    .filter((m) => m.channel === "console:data")
    .map((m) => Buffer.from(m.payload.data).toString("utf8"))
    .join("");
}

function makeSinks() {
  return {
    states: [],
    opened: [],
    sent: [],
    activity: [],
    revealed: [],
    destroyed: [],
  };
}

function makeManager(def, sinks, deps = {}) {
  return new ConsoleManager({
    getStores: () => fakeStores(def),
    broadcast: (channel, payload) => {
      if (channel === "jumphippo:console-state") sinks.states.push(payload);
      if (channel === "jumphippo:console-activity")
        sinks.activity.push(payload);
    },
    hostKeys: trustHostKeys,
    keyReader: fs.readFileSync,
    getSshKeepaliveMs: () => 0,
    openWindow: (sessionId, meta) => sinks.opened.push({ sessionId, meta }),
    sendToWindow: (sessionId, channel, payload) =>
      sinks.sent.push({ sessionId, channel, payload }),
    revealWindow: (sessionId) => sinks.revealed.push(sessionId),
    destroyWindow: (sessionId) => sinks.destroyed.push(sessionId),
    ...deps,
  });
}

test("a console session relays a remote shell end-to-end", async () => {
  const ssh = await startSsh({ shell: true });
  const def = {
    id: "c1",
    name: "test console",
    sshServer: sshHop(ssh.port),
    jumps: [],
  };
  const sinks = makeSinks();
  const manager = makeManager(def, sinks);

  const { sessionId } = manager.open("c1");
  assert.equal(sinks.opened.length, 1);
  assert.equal(sinks.opened[0].sessionId, sessionId);
  assert.equal(sinks.opened[0].meta.title, "test console");

  // The window signals ready → the session connects and opens the shell.
  manager.ready(sessionId, { cols: 80, rows: 24 });
  await waitFor(() => sinks.states.some((s) => s.state === "connected"), {
    timeout: 5000,
  });
  assert.equal(manager.sessions().length, 1);

  // A keystroke round-trips through the echo shell back to the window.
  manager.input(sessionId, "hello\n");
  await waitFor(() => decodeSent(sinks.sent).includes("hello"), {
    timeout: 5000,
  });

  // Resize is best-effort and must not throw.
  manager.resize(sessionId, 100, 40);

  // Closing tears the session down and drops it from the registry.
  manager.close(sessionId);
  assert.equal(manager.sessions().length, 0);
  assert.ok(sinks.states.some((s) => s.state === "closed"));

  await ssh.close();
});

test("opening an unknown console throws NOT_FOUND", () => {
  const manager = makeManager(
    { id: "known", name: "x", sshServer: sshHop(1), jumps: [] },
    makeSinks(),
  );
  assert.throws(() => manager.open("missing"), /console not found/);
});

test("a failed connect ends the session with an error", async () => {
  const deadPort = await freePort(); // nothing listening → connect refused
  const def = {
    id: "c2",
    name: "bad",
    sshServer: sshHop(deadPort),
    jumps: [],
  };
  const sinks = makeSinks();
  const manager = makeManager(def, sinks);

  const { sessionId } = manager.open("c2");
  manager.ready(sessionId, { cols: 80, rows: 24 });

  await waitFor(() => sinks.states.some((s) => s.state === "error"), {
    timeout: 5000,
  });
  // The window is told the session closed with an error, and it's dropped.
  assert.ok(
    sinks.sent.some((m) => m.channel === "console:closed" && m.payload.error),
  );
  assert.equal(manager.sessions().length, 0);
});

// ── Console Manager runtime (Feature 210) ─────────────────────────────────────

/** Open + connect a session against an echo shell; returns the live handles. */
async function connectedSession(deps = {}) {
  const ssh = await startSsh({ shell: true });
  const def = {
    id: "c1",
    name: "test console",
    sshServer: sshHop(ssh.port),
    jumps: [],
  };
  const sinks = makeSinks();
  const manager = makeManager(def, sinks, deps);
  const { sessionId } = manager.open("c1");
  manager.ready(sessionId, { cols: 80, rows: 24 });
  await waitFor(() => sinks.states.some((s) => s.state === "connected"), {
    timeout: 5000,
  });
  return { ssh, def, sinks, manager, sessionId };
}

test("sessions() returns a runtime metadata snapshot with no output", async () => {
  const { ssh, manager, sessionId } = await connectedSession();
  const [snap] = manager.sessions();
  assert.equal(snap.sessionId, sessionId);
  assert.equal(snap.state, "connected");
  assert.equal(snap.windowNumber, 1);
  assert.equal(typeof snap.openedAt, "number");
  assert.equal(typeof snap.connectedAt, "number");
  assert.deepEqual(Object.keys(snap.windowState).sort(), [
    "focused",
    "fullScreen",
    "minimized",
    "visible",
  ]);
  assert.equal("recentLines" in snap, false); // metadata only on the list snapshot
  manager.close(sessionId);
  await ssh.close();
});

test("a watched session streams coalesced activity with recent output", async () => {
  const { ssh, manager, sinks, sessionId } = await connectedSession();
  manager.watch([sessionId]);
  manager.input(sessionId, "hello\n");
  await waitFor(
    () =>
      sinks.activity.some(
        (a) =>
          a.sessionId === sessionId &&
          Array.isArray(a.lines) &&
          a.lines.some((l) => l.includes("hello")),
      ),
    { timeout: 5000 },
  );
  const last = sinks.activity[sinks.activity.length - 1];
  assert.ok(last.bytesIn > 0);
  assert.ok(last.bytesOut > 0);
  manager.close(sessionId);
  await ssh.close();
});

test("activity carries no output lines when the setting disables it", async () => {
  const { ssh, manager, sinks, sessionId } = await connectedSession({
    getShowOutput: () => false,
  });
  manager.watch([sessionId]);
  manager.input(sessionId, "secret\n");
  await waitFor(() => sinks.activity.some((a) => a.sessionId === sessionId), {
    timeout: 5000,
  });
  assert.ok(sinks.activity.every((a) => !("lines" in a)));
  manager.close(sessionId);
  await ssh.close();
});

test("watch gates activity — an unwatched session never streams", async () => {
  const { ssh, manager, sinks, sessionId } = await connectedSession();
  manager.input(sessionId, "quiet\n");
  // Give any (erroneous) coalescing flush time to fire.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sinks.activity.length, 0);
  manager.close(sessionId);
  await ssh.close();
});

test("reveal brings a live session's window forward", async () => {
  const { ssh, manager, sinks, sessionId } = await connectedSession();
  assert.deepEqual(manager.reveal(sessionId), { ok: true });
  assert.deepEqual(sinks.revealed, [sessionId]);
  assert.deepEqual(manager.reveal("nope"), { ok: false });
  manager.close(sessionId);
  await ssh.close();
});

test("restart closes the old session + window and opens a fresh one", async () => {
  const { ssh, manager, sinks, sessionId } = await connectedSession();
  const res = manager.restart(sessionId);
  assert.ok(res && res.sessionId && res.sessionId !== sessionId);
  assert.equal(res.id, "c1");
  assert.ok(sinks.destroyed.includes(sessionId)); // old window torn down
  assert.equal(sinks.opened.length, 2); // a fresh window opened
  assert.ok(!manager.sessions().some((s) => s.sessionId === sessionId));
  manager.close(res.sessionId);
  await ssh.close();
});

test("setWindowState updates the snapshot and broadcasts state", async () => {
  const { ssh, manager, sinks, sessionId } = await connectedSession();
  const before = sinks.states.length;
  manager.setWindowState(sessionId, { minimized: true });
  assert.equal(manager.sessions()[0].windowState.minimized, true);
  assert.ok(sinks.states.length > before);
  const last = sinks.states[sinks.states.length - 1];
  assert.equal(last.windowState.minimized, true);
  manager.close(sessionId);
  await ssh.close();
});

test("close destroys the console window", async () => {
  const { ssh, manager, sinks, sessionId } = await connectedSession();
  manager.close(sessionId);
  assert.ok(sinks.destroyed.includes(sessionId));
  await ssh.close();
});
