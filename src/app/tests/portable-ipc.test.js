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
 * tests/portable-ipc.test.js — the Feature 120 import/export IPC contract, end to
 * end through the real registerPortableIPC: export writes a `.porthippo` file via a
 * (faked) save dialog, preview + import read it back via a (faked) open dialog, and
 * a successful import reconciles the engine. Uses real Stores over temp profiles.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Stores } = require("../store/stores");
const { registerPortableIPC } = require("../ipc/portable");

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "porthippo-ioipc-"));
}

// A harness wiring registerPortableIPC to real Stores with a scriptable dialog.
function harness(dir) {
  const stores = new Stores(dir);
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const engineCalls = [];
  const getEngine = () => ({
    reconcileAll: async () => {
      engineCalls.push("reconcile");
    },
  });
  // The next dialog result each opener returns (set per call).
  const dialogResult = { save: null, open: null };
  const dialog = {
    showSaveDialog: async () => dialogResult.save,
    showOpenDialog: async () => dialogResult.open,
  };
  registerPortableIPC({
    ipcMain,
    getStores: () => stores,
    getEngine,
    dialog,
    getMainWindow: () => null,
  });
  return {
    stores,
    engineCalls,
    dialogResult,
    invoke: (channel, arg) => handlers.get(channel)(null, arg),
  };
}

function seed(stores) {
  const cred = stores
    .credentialStore()
    .create({ label: "prod", user: "j", authType: "agent" });
  stores.tunnelStore().create({
    name: "db",
    localPort: 5432,
    destination: { host: "db", port: 5432 },
    sshHost: "gw",
    credentialId: cred.id,
  });
}

test("export writes a bundle; preview + import round-trip it and reconcile", async () => {
  const srcDir = freshDir();
  const dstDir = freshDir();
  const bundlePath = path.join(srcDir, "backup.porthippo");
  try {
    const a = harness(srcDir);
    seed(a.stores);

    // Export (fake save dialog → bundlePath).
    a.dialogResult.save = { canceled: false, filePath: bundlePath };
    const exp = await a.invoke("portable:export", { secretMode: "stripped" });
    assert.ok(exp.ok);
    assert.equal(exp.path, bundlePath);
    assert.ok(fs.existsSync(bundlePath), "the bundle file was written");
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
    assert.equal(bundle.format, "porthippo-bundle");

    // Preview on a fresh profile (fake open dialog → bundlePath).
    const b = harness(dstDir);
    b.dialogResult.open = { canceled: false, filePaths: [bundlePath] };
    const preview = await b.invoke("portable:preview");
    assert.ok(preview.ok);
    assert.equal(preview.path, bundlePath);
    assert.equal(preview.counts.tunnels.add, 1);

    // Import it — reconcile fires and the tunnel appears.
    const imp = await b.invoke("portable:import", {
      path: bundlePath,
      mode: "merge",
    });
    assert.ok(imp.ok);
    assert.equal(b.engineCalls.length, 1, "the engine reconciled after import");
    assert.equal(b.stores.tunnelStore().list().length, 1);
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(dstDir, { recursive: true, force: true });
  }
});

test("a cancelled save/open dialog is a no-op", async () => {
  const dir = freshDir();
  try {
    const h = harness(dir);
    h.dialogResult.save = { canceled: true };
    assert.deepEqual(await h.invoke("portable:export", {}), { canceled: true });

    h.dialogResult.open = { canceled: true, filePaths: [] };
    assert.deepEqual(await h.invoke("portable:preview"), { canceled: true });
    assert.deepEqual(await h.invoke("sshconfig:scan"), { canceled: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scanning + importing an SSH config commits the selected host", async () => {
  const dir = freshDir();
  const cfgPath = path.join(dir, "config");
  fs.writeFileSync(
    cfgPath,
    "Host prod\n  HostName prod.example.com\n  User deploy\n",
  );
  try {
    const h = harness(dir);
    h.dialogResult.open = { canceled: false, filePaths: [cfgPath] };
    const scan = await h.invoke("sshconfig:scan");
    assert.ok(scan.ok);
    const tun = scan.proposal.tunnels.find((t) => t.name === "prod");
    assert.ok(tun);

    const res = await h.invoke("sshconfig:import", {
      proposal: scan.proposal,
      selected: [tun.tempId],
    });
    assert.ok(res.ok);
    assert.equal(res.created.tunnels, 1);
    assert.equal(h.engineCalls.length, 1, "reconcile after ssh import");
    assert.equal(h.stores.tunnelStore().list()[0].name, "prod");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
