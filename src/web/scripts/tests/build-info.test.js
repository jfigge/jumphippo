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

// build-info.test.js — the renderer's store-build capability cache. The gate is
// only as safe as its fail-open default, so that's the highest-value case here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { init, can, distribution } from "../build-info.js";

const bridge = (info) => ({ build: { info: async () => info } });

// Reset to the "everything enabled" default after each mutation so cases (and any
// other renderer test sharing this singleton) don't leak.
async function reset() {
  await init(bridge({ distribution: "direct", capabilities: {} }));
}

test("fails open before init: every capability (and unknown ones) default enabled", () => {
  // This is the load-bearing safety property — if the bridge never delivers a
  // map, nothing is hidden, so a direct build is never accidentally degraded.
  assert.equal(can("sshAgentAuth"), true);
  assert.equal(can("launchAtLogin"), true);
  assert.equal(can("anythingUnknown"), true); // unknown → available
  assert.equal(distribution(), "direct");
});

test("applies a store capability map from the bridge", async () => {
  await init(
    bridge({
      distribution: "store",
      capabilities: { sshAgentAuth: false, launchAtLogin: false },
    }),
  );
  assert.equal(can("sshAgentAuth"), false);
  assert.equal(can("launchAtLogin"), false);
  assert.equal(can("sshConfigDefaultPath"), true); // unspecified → default true
  assert.equal(distribution(), "store");
  await reset();
});

test("a failed or missing refetch keeps the last good map and never throws", async () => {
  await init(
    bridge({ distribution: "store", capabilities: { launchAtLogin: false } }),
  );
  assert.equal(can("launchAtLogin"), false);

  // A throwing bridge is swallowed and leaves the current map intact.
  await init({
    build: {
      info: async () => {
        throw new Error("bridge down");
      },
    },
  });
  assert.equal(can("launchAtLogin"), false);

  // A missing bridge / method is a safe no-op (must not throw).
  await init(undefined);
  assert.equal(can("launchAtLogin"), false);

  await reset();
  assert.equal(can("launchAtLogin"), true);
});
