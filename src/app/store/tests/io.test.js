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
 * io.test.js — the crash-safety-critical filesystem layer: atomic write (no temp
 * left behind, rollback on failure), corrupt-JSON quarantine (one bad document
 * degrades to "missing" instead of bricking the load), and the startup orphan
 * temp-file GC (age / active-path / recursion rules). Previously exercised only
 * incidentally through the higher stores.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const io = require("../io");

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "porthippo-io-"));
}

function withDir(fn) {
  const dir = freshDir();
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── atomicWrite ────────────────────────────────────────────────────────────────

test("atomicWrite persists the data and leaves no temp file behind", () => {
  withDir((dir) => {
    const file = path.join(dir, "data.txt");
    io.atomicWrite(file, "hello world");
    assert.equal(fs.readFileSync(file, "utf8"), "hello world");
    const leftovers = fs.readdirSync(dir).filter((n) => io.isTempFileName(n));
    assert.deepEqual(leftovers, [], "the write temp is renamed away, not left");
  });
});

test("atomicWrite creates missing parent directories", () => {
  withDir((dir) => {
    const file = path.join(dir, "nested", "deep", "data.txt");
    io.atomicWrite(file, "x");
    assert.equal(fs.readFileSync(file, "utf8"), "x");
  });
});

test("atomicWrite overwrites an existing file in place", () => {
  withDir((dir) => {
    const file = path.join(dir, "data.txt");
    io.atomicWrite(file, "first");
    io.atomicWrite(file, "second");
    assert.equal(fs.readFileSync(file, "utf8"), "second");
  });
});

test("a failed atomicWrite rolls back its temp file and rethrows", () => {
  withDir((dir) => {
    const file = path.join(dir, "data.txt");
    // A non-serializable value forces JSON.stringify → fs.writeFileSync to throw
    // inside atomicWrite (a BigInt cannot be written), exercising the catch/rollback.
    assert.throws(() => io.atomicWrite(file, 10n));
    assert.ok(!fs.existsSync(file), "the target is never created on failure");
    const leftovers = fs.readdirSync(dir).filter((n) => io.isTempFileName(n));
    assert.deepEqual(leftovers, [], "the temp file is unlinked on failure");
  });
});

// ── writeJSON / readJSON ─────────────────────────────────────────────────────────

test("writeJSON + readJSON round-trip an object", () => {
  withDir((dir) => {
    const file = path.join(dir, "doc.json");
    io.writeJSON(file, { hello: "world", n: 42 });
    const read = io.readJSON(file);
    assert.equal(read.hello, "world");
    assert.equal(read.n, 42);
  });
});

test("readJSON returns null for a missing file (no throw)", () => {
  withDir((dir) => {
    assert.equal(io.readJSON(path.join(dir, "absent.json")), null);
  });
});

test("readJSON quarantines a corrupt file aside and degrades to null", () => {
  withDir((dir) => {
    const file = path.join(dir, "doc.json");
    fs.writeFileSync(file, "{ not valid json ]");

    const result = io.readJSON(file);
    assert.equal(result, null, "a corrupt document reads as missing");
    assert.ok(!fs.existsSync(file), "the corrupt original is moved aside");

    const quarantined = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("doc.json.corrupt-"));
    assert.equal(
      quarantined.length,
      1,
      "exactly one quarantine copy is created",
    );
    assert.equal(
      fs.readFileSync(path.join(dir, quarantined[0]), "utf8"),
      "{ not valid json ]",
      "the original bytes are preserved for recovery",
    );
  });
});

test("readJSON rethrows a non-ENOENT read error (e.g. a directory)", () => {
  withDir((dir) => {
    const sub = path.join(dir, "adir");
    fs.mkdirSync(sub);
    assert.throws(() => io.readJSON(sub)); // EISDIR, not silently null
  });
});

// ── gcOrphanTempFiles ────────────────────────────────────────────────────────────

test("gcOrphanTempFiles removes only aged temp files, never real data", () => {
  withDir((dir) => {
    const real = path.join(dir, "data.json");
    const orphan = path.join(dir, "data.json.porthippotmp-1.tmp");
    fs.writeFileSync(real, "{}");
    fs.writeFileSync(orphan, "partial");

    // Reference "now" far in the future so the orphan is comfortably older than
    // maxAgeMs (deterministic — no reliance on wall-clock or sleeps).
    const removed = io.gcOrphanTempFiles(dir, {
      maxAgeMs: 5000,
      now: Date.now() + 60000,
    });

    assert.deepEqual(removed, [orphan]);
    assert.ok(!fs.existsSync(orphan), "the aged orphan is deleted");
    assert.ok(fs.existsSync(real), "a real data file is never touched");
  });
});

test("gcOrphanTempFiles spares a temp file younger than maxAgeMs", () => {
  withDir((dir) => {
    const orphan = path.join(dir, "data.json.porthippotmp-2.tmp");
    fs.writeFileSync(orphan, "in flight");
    const removed = io.gcOrphanTempFiles(dir, {
      maxAgeMs: 5000,
      now: Date.now(), // freshly written → too young to collect
    });
    assert.deepEqual(removed, []);
    assert.ok(fs.existsSync(orphan));
  });
});

test("gcOrphanTempFiles recurses into subdirectories", () => {
  withDir((dir) => {
    const sub = path.join(dir, "keys");
    fs.mkdirSync(sub);
    const orphan = path.join(sub, "host.json.porthippotmp-3.tmp");
    fs.writeFileSync(orphan, "x");
    const removed = io.gcOrphanTempFiles(dir, {
      maxAgeMs: 0,
      now: Date.now() + 1000,
    });
    assert.deepEqual(removed, [orphan]);
  });
});

test("gcOrphanTempFiles is a no-op on a missing directory", () => {
  assert.deepEqual(
    io.gcOrphanTempFiles(
      path.join(os.tmpdir(), "porthippo-does-not-exist-xyz"),
    ),
    [],
  );
});

// ── id / temp-name predicates ────────────────────────────────────────────────────

test("isTempFileName matches only our temp pattern", () => {
  assert.equal(io.isTempFileName("data.json.porthippotmp-7.tmp"), true);
  assert.equal(io.isTempFileName("data.json"), false);
  assert.equal(io.isTempFileName("data.json.tmp"), false);
  assert.equal(io.isTempFileName("data.json.corrupt-123-abcd"), false);
});

test("isValidID / validateID reject traversal and control characters", () => {
  assert.equal(io.isValidID("a-normal_id.123"), true);
  assert.equal(io.isValidID(""), false);
  assert.equal(io.isValidID("."), false);
  assert.equal(io.isValidID(".."), false);
  assert.equal(io.isValidID("a/b"), false);
  assert.equal(io.isValidID("a\\b"), false);
  assert.equal(io.isValidID(42), false);

  io.validateID("ok-id"); // does not throw
  assert.throws(
    () => io.validateID("../escape"),
    (e) => e.code === "INVALID_ID",
  );
  assert.throws(
    () => io.validateID(""),
    (e) => e.code === "INVALID_ID",
  );
});
