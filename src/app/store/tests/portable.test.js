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

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Stores } = require("../stores");
const portable = require("../portable");

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "porthippo-portable-"));
}
function readRaw(dir) {
  return fs.readFileSync(path.join(dir, "tunnels.json"), "utf8");
}

/** Seed a store with two credentials, a jump host, and two tunnels. */
function seed(stores) {
  const cs = stores.credentialStore();
  const js = stores.jumpHostStore();
  const ts = stores.tunnelStore();
  const cred = cs.create({
    label: "prod",
    user: "jason",
    authType: "password",
    password: "s3cr3t",
  });
  const jumpCred = cs.create({
    label: "bastion-cred",
    user: "j",
    authType: "agent",
  });
  const jump = js.create({
    label: "bastion",
    host: "bastion.example.com",
    port: 22,
    credentialId: jumpCred.id,
  });
  const t1 = ts.create({
    name: "db",
    localPort: 5432,
    destination: { host: "db.internal", port: 5432 },
    sshHost: "gateway.example.com",
    credentialId: cred.id,
    jumpHostIds: [jump.id],
  });
  const t2 = ts.create({
    name: "web",
    localPort: 8080,
    destination: { host: "127.0.0.1", port: 80 },
    sshHost: "web.example.com",
    credentialId: cred.id,
  });
  return { cred, jumpCred, jump, t1, t2 };
}

test("stripped round-trip reproduces tunnels/credentials/jump hosts on a fresh profile", () => {
  const src = freshDir();
  const dst = freshDir();
  try {
    const a = new Stores(src);
    seed(a);
    const bundle = portable.buildBundle(a, { secretMode: "stripped" });

    assert.equal(bundle.format, "porthippo-bundle");
    assert.equal(bundle.secrets, "stripped");
    assert.ok(
      !JSON.stringify(bundle).includes("s3cr3t"),
      "a stripped bundle carries no secret",
    );

    const b = new Stores(dst);
    const res = portable.applyBundle(b, bundle, { mode: "merge" });
    assert.ok(res.ok);

    const tunnels = b.tunnelStore().list();
    assert.equal(tunnels.length, 2);
    const db = tunnels.find((t) => t.name === "db");
    assert.ok(db, "the db tunnel reappears");
    // References are intact: the credential + jump host resolve.
    const cred = b.credentialStore().get(db.credentialId);
    assert.equal(cred.label, "prod");
    assert.equal(
      cred.hasSecret,
      false,
      "stripped → credential needs its password",
    );
    const jump = b.jumpHostStore().get(db.jumpHostIds[0]);
    assert.equal(jump.label, "bastion");
    // The jump host's own credential reference resolves too (integrity preserved).
    assert.ok(
      b.credentialStore().get(jump.credentialId),
      "jump credential exists",
    );
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test("encp round-trip restores secrets and re-seals them under the local backend", () => {
  const src = freshDir();
  const dst = freshDir();
  try {
    const a = new Stores(src);
    seed(a);
    const bundle = portable.buildBundle(a, {
      secretMode: "encp",
      passphrase: "correct horse",
    });
    assert.equal(bundle.secrets, "encp:v1");
    const json = JSON.stringify(bundle);
    assert.ok(!json.includes("s3cr3t"), "the encp secret is not in cleartext");
    assert.ok(json.includes("encp:v1:"), "the secret is sealed under encp");

    const b = new Stores(dst);
    const res = portable.applyBundle(b, bundle, {
      mode: "merge",
      passphrase: "correct horse",
    });
    assert.ok(res.ok);

    const imported = b
      .credentialStore()
      .list()
      .find((c) => c.label === "prod");
    assert.equal(imported.hasSecret, true, "the secret restored");
    assert.equal(
      b.credentialStore().getDecrypted(imported.id).password,
      "s3cr3t",
    );
    const raw = readRaw(dst);
    assert.ok(
      !raw.includes("encp:v1:"),
      "not stored under the portable envelope",
    );
    assert.ok(
      raw.includes("enck:v1:"),
      "re-sealed under the local app-key backend",
    );
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test("a wrong passphrase fails cleanly with nothing written", () => {
  const src = freshDir();
  const dst = freshDir();
  try {
    const a = new Stores(src);
    seed(a);
    const bundle = portable.buildBundle(a, {
      secretMode: "encp",
      passphrase: "right",
    });
    const b = new Stores(dst);
    assert.throws(
      () =>
        portable.applyBundle(b, bundle, { mode: "merge", passphrase: "wrong" }),
      (e) => e.code === "BAD_PASSPHRASE",
    );
    assert.equal(b.tunnelStore().list().length, 0, "nothing was written");
    assert.equal(b.credentialStore().list().length, 0);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test("a dangling reference is rejected whole", () => {
  const dst = freshDir();
  try {
    const bundle = {
      format: "porthippo-bundle",
      version: 1,
      exportedAt: 1,
      secrets: "stripped",
      contents: {
        credentials: [{ id: "c1", label: "L", user: "u", authType: "agent" }],
        jumpHosts: [],
        tunnels: [
          {
            id: "t1",
            name: "t",
            localPort: 1,
            destination: { host: "h", port: 2 },
            sshHost: "h",
            credentialId: "does-not-exist",
          },
        ],
      },
    };
    const b = new Stores(dst);
    assert.throws(
      () => portable.applyBundle(b, bundle, { mode: "merge" }),
      (e) => e.code === "DANGLING_REF",
    );
    assert.equal(b.tunnelStore().list().length, 0, "no partial write");
  } finally {
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test("merge reuses a label-collision credential and renames a tunnel-name collision", () => {
  const src = freshDir();
  const dst = freshDir();
  try {
    const a = new Stores(src);
    seed(a);
    const bundle = portable.buildBundle(a, { secretMode: "stripped" });

    // Destination already has a credential "prod" and a tunnel "db".
    const b = new Stores(dst);
    const existingProd = b
      .credentialStore()
      .create({ label: "prod", user: "someone", authType: "agent" });
    b.tunnelStore().create({
      name: "db",
      localPort: 9999,
      destination: { host: "x", port: 1 },
      sshHost: "x",
      credentialId: existingProd.id,
    });

    portable.applyBundle(b, bundle, { mode: "merge" });

    // The "prod" credential is reused (not duplicated).
    const prods = b
      .credentialStore()
      .list()
      .filter((c) => c.label === "prod");
    assert.equal(
      prods.length,
      1,
      "label collision reuses the existing credential",
    );

    // Both "db" tunnels are kept — the imported one is renamed.
    const names = b
      .tunnelStore()
      .list()
      .map((t) => t.name)
      .sort();
    assert.deepEqual(names, ["db", "db (2)", "web"]);

    // The renamed import still resolves to the reused "prod" credential.
    const renamed = b
      .tunnelStore()
      .list()
      .find((t) => t.name === "db (2)");
    assert.equal(renamed.credentialId, existingProd.id);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test("a stripped import never clobbers an existing secret (id-matched update)", () => {
  const dir = freshDir();
  try {
    const stores = new Stores(dir);
    const { cred } = seed(stores);
    // Export stripped, then re-import onto the SAME store: the credential id matches,
    // so it's an "update" — but stripped, so the existing secret must survive.
    const bundle = portable.buildBundle(stores, { secretMode: "stripped" });
    portable.applyBundle(stores, bundle, { mode: "merge" });

    assert.equal(
      stores.credentialStore().getDecrypted(cred.id).password,
      "s3cr3t",
      "the existing secret is not clobbered by a stripped import",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("replace wipes the store and loads the bundle", () => {
  const src = freshDir();
  const dst = freshDir();
  try {
    const a = new Stores(src);
    seed(a);
    const bundle = portable.buildBundle(a, { secretMode: "stripped" });

    const b = new Stores(dst);
    b.credentialStore().create({
      label: "stale",
      user: "u",
      authType: "agent",
    });
    b.tunnelStore().create({
      name: "old",
      localPort: 1,
      destination: { host: "h", port: 2 },
      sshHost: "h",
      credentialId: b.credentialStore().list()[0].id,
    });

    portable.applyBundle(b, bundle, { mode: "replace" });

    const names = b
      .tunnelStore()
      .list()
      .map((t) => t.name)
      .sort();
    assert.deepEqual(names, ["db", "web"], "old records are gone");
    assert.ok(
      !b
        .credentialStore()
        .list()
        .some((c) => c.label === "stale"),
      "the stale credential is wiped",
    );
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test("preview classifies add / update / conflict without writing", () => {
  const src = freshDir();
  const dst = freshDir();
  try {
    const a = new Stores(src);
    seed(a);
    const bundle = portable.buildBundle(a, { secretMode: "stripped" });

    const b = new Stores(dst);
    b.credentialStore().create({ label: "prod", user: "x", authType: "agent" });

    const { readDoc } = require("../definitions-doc");
    const preview = portable.previewBundle(bundle, readDoc(b.paths()));
    assert.ok(preview.ok);
    assert.equal(preview.needsPassphrase, false);
    // "prod" collides by label; "bastion-cred" is new.
    assert.equal(preview.counts.credentials.conflict, 1);
    assert.equal(preview.counts.credentials.add, 1);
    assert.equal(preview.counts.tunnels.add, 2);
    // Nothing was written by previewing.
    assert.equal(b.tunnelStore().list().length, 0);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test("the encp envelope round-trips a secret and rejects a wrong passphrase", () => {
  const sealed = portable.sealPassphrase("hunter2", "pw");
  assert.ok(portable.isPortableSecret(sealed));
  assert.equal(portable.openPassphrase(sealed, "pw"), "hunter2");
  assert.throws(() => portable.openPassphrase(sealed, "nope"));
});
