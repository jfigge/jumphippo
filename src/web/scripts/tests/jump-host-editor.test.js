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

import { resetDom, typeInto } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { JumpHostEditor } from "../components/jump-host-editor.js";

function mount(opts = {}) {
  resetDom();
  const editor = new JumpHostEditor(opts);
  document.body.appendChild(editor.element);
  return editor;
}

/** Fill hop `i`'s host/port/user text inputs. */
function fillHop(editor, i, { host, port, user }) {
  const hop = editor.element.querySelectorAll(".jump-host")[i];
  if (host !== undefined) typeInto(hop.querySelector(".hop-input-host"), host);
  if (port !== undefined) typeInto(hop.querySelector(".hop-input-port"), port);
  if (user !== undefined) typeInto(hop.querySelector(".hop-input-user"), user);
}

test("starts empty — a direct connection", () => {
  const editor = mount();
  assert.deepEqual(editor.getValue(), []);
  assert.equal(editor.element.querySelector(".jumps-empty").hidden, false);
});

test("adding a hop yields one jump with defaults, editable in place", () => {
  const editor = mount();
  editor.element.querySelector(".jumps-add-btn").click();
  assert.equal(editor.element.querySelectorAll(".jump-host").length, 1);

  fillHop(editor, 0, { host: "bastion.example", user: "jump" });
  assert.deepEqual(editor.getValue(), [
    {
      host: "bastion.example",
      port: 22,
      user: "jump",
      auth: [{ type: "agent" }],
    },
  ]);
});

test("reordering hops reorders the emitted jumps[] and their error prefixes", () => {
  const editor = mount();
  editor.element.querySelector(".jumps-add-btn").click();
  editor.element.querySelector(".jumps-add-btn").click();
  fillHop(editor, 0, { host: "first", user: "a" });
  fillHop(editor, 1, { host: "second", user: "b" });

  // Move the second hop up (its row's "move up" is the 4th jump tool button).
  editor.element.querySelectorAll(".jump-tool-btn")[3].click();

  const jumps = editor.getValue();
  assert.deepEqual(
    jumps.map((h) => h.host),
    ["second", "first"],
  );
  // Error keys must track the new position, not the creation order.
  const firstHostField = editor.element
    .querySelectorAll(".jump-host")[0]
    .querySelector(".hop-field-host");
  assert.equal(firstHostField.dataset.errorKey, "jumps[0].host");
});

test("removing a hop drops it from jumps[]", () => {
  const editor = mount();
  editor.element.querySelector(".jumps-add-btn").click();
  editor.element.querySelector(".jumps-add-btn").click();
  fillHop(editor, 0, { host: "keep", user: "a" });
  fillHop(editor, 1, { host: "drop", user: "b" });

  editor.element.querySelectorAll(".jump-remove-btn")[1].click();
  assert.deepEqual(
    editor.getValue().map((h) => h.host),
    ["keep"],
  );
});

test("setValue round-trips a chain and preserves order", () => {
  const editor = mount();
  editor.setValue([
    { host: "h1", port: 2201, user: "u1", auth: [{ type: "agent" }] },
    {
      host: "h2",
      port: 2202,
      user: "u2",
      auth: [{ type: "password", hasSecret: true }],
    },
  ]);
  const out = editor.getValue();
  assert.equal(out.length, 2);
  assert.equal(out[0].host, "h1");
  assert.equal(out[1].port, 2202);
  // The stored secret is retained without a plaintext round-trip.
  assert.deepEqual(out[1].auth, [{ type: "password", hasSecret: true }]);
});
