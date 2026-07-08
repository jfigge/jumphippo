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

// validate-parity.test.js — the renderer's validator (web/scripts/validate.js) is
// a hand-kept copy of the authoritative store validator (app/store/validate.js).
// This guards against drift: both must return identical {valid, errors} for every
// fixture, and expose the same AUTH_TYPES / secretFieldForAuthType. If this fails,
// the two copies diverged — reconcile them.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as renderer from "../validate.js";
import main from "../../../app/store/validate.js"; // CJS module.exports (default)

const hop = (over = {}) => ({
  host: "h",
  port: 22,
  user: "u",
  auth: [{ type: "agent" }],
  ...over,
});
const def = (over = {}) => ({
  name: "n",
  localPort: 8080,
  destination: { host: "d", port: 80 },
  sshServer: hop(),
  jumps: [],
  ...over,
});

const FIXTURES = [
  def(), // fully valid
  {}, // everything missing
  null,
  [],
  "not-an-object",
  def({ name: "" }),
  def({ name: undefined }),
  def({ localPort: 0 }),
  def({ localPort: 70000 }),
  def({ localPort: 3.5 }),
  def({ bindHost: "" }),
  def({ bindHost: 123 }),
  def({ bindHost: "0.0.0.0" }),
  def({ destination: undefined }),
  def({ destination: { host: "", port: 80 } }),
  def({ destination: { host: "d", port: -1 } }),
  def({ sshServer: undefined }),
  def({ sshServer: hop({ auth: [] }) }),
  def({ sshServer: hop({ auth: [{ type: "key" }] }) }),
  def({ sshServer: hop({ auth: [{ type: "key", privateKeyPath: "/k" }] }) }),
  def({ sshServer: hop({ auth: [{ type: "password", password: "pw" }] }) }),
  def({ sshServer: hop({ auth: [{ type: "bogus" }] }) }),
  def({ sshServer: hop({ host: "", port: 0, user: "" }) }),
  def({ jumps: "nope" }),
  def({ jumps: [hop(), hop({ host: "", auth: [] })] }),
  def({ jumps: [hop({ auth: [{ type: "key", privateKeyPath: "/id" }] })] }),
  def({ lingerMs: -5 }),
  def({ lingerMs: 1.5 }),
  def({ lingerMs: 0 }),
  def({ keepAlive: "yes" }),
  def({ enabled: 1 }),
  def({ autoReconnect: "no" }),
];

test("renderer and store validators agree on {valid, errors} for every fixture", () => {
  FIXTURES.forEach((fixture, i) => {
    const a = renderer.validateDefinition(fixture);
    const b = main.validateDefinition(fixture);
    assert.deepEqual(
      a,
      b,
      `fixture #${i} diverged: ${JSON.stringify(fixture)}`,
    );
  });
});

test("the auth taxonomy matches", () => {
  assert.deepEqual(renderer.AUTH_TYPES, main.AUTH_TYPES);
  for (const type of [...renderer.AUTH_TYPES, "nope"]) {
    assert.equal(
      renderer.secretFieldForAuthType(type),
      main.secretFieldForAuthType(type),
      `secret field for "${type}" diverged`,
    );
  }
});
