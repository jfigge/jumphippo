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

import { resetDom, change, typeInto } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthEditor } from "../components/auth-editor.js";

function mount(opts = {}) {
  resetDom();
  const editor = new AuthEditor(opts);
  document.body.appendChild(editor.element);
  return editor;
}

const typeSelect = (editor, i = 0) =>
  editor.element.querySelectorAll(".auth-type-select")[i];

test("defaults to a single agent method with the agent hint", () => {
  const editor = mount();
  assert.equal(editor.element.querySelectorAll(".auth-method").length, 1);
  assert.deepEqual(editor.getValue(), [{ type: "agent" }]);
  assert.ok(editor.element.querySelector(".auth-agent-hint"));
});

test("switching to key reveals key path + passphrase and builds the entry", () => {
  const editor = mount();
  change(typeSelect(editor), "key");

  const keyPath = editor.element.querySelector(".auth-keypath-input");
  const passphrase = editor.element.querySelector('[aria-label="Passphrase"]');
  assert.ok(keyPath, "key path input shown");
  assert.ok(passphrase, "passphrase input shown");

  typeInto(keyPath, "/home/me/.ssh/id_ed25519");
  typeInto(passphrase, "s3cret");
  assert.deepEqual(editor.getValue(), [
    {
      type: "key",
      privateKeyPath: "/home/me/.ssh/id_ed25519",
      passphrase: "s3cret",
    },
  ]);
});

test("switching to password reveals only the password field", () => {
  const editor = mount();
  change(typeSelect(editor), "password");
  assert.ok(editor.element.querySelector('[aria-label="Password"]'));
  assert.equal(editor.element.querySelector(".auth-keypath-input"), null);

  typeInto(editor.element.querySelector('[aria-label="Password"]'), "hunter2");
  assert.deepEqual(editor.getValue(), [
    { type: "password", password: "hunter2" },
  ]);
});

test("a stored secret is retained (hasSecret) until the user types a new one", () => {
  const editor = mount();
  editor.setValue([{ type: "password", hasSecret: true }]);

  // Shows the "set" affordance and re-sends hasSecret with no plaintext.
  assert.ok(
    editor.element.querySelector(".auth-secret-status"),
    "•••• set indicator shown",
  );
  assert.deepEqual(editor.getValue(), [{ type: "password", hasSecret: true }]);

  // Typing a new value overrides the retain and sends plaintext instead.
  typeInto(editor.element.querySelector('[aria-label="Password"]'), "newpw");
  assert.deepEqual(editor.getValue(), [
    { type: "password", password: "newpw" },
  ]);
});

test("switching away from the loaded type drops the retained secret", () => {
  const editor = mount();
  editor.setValue([{ type: "password", hasSecret: true }]);
  change(typeSelect(editor), "agent");
  assert.deepEqual(editor.getValue(), [{ type: "agent" }]);
});

test("add / remove / reorder changes the auth[] array", () => {
  const changes = [];
  const editor = mount({ onChange: (v) => changes.push(v) });

  editor.element.querySelector(".auth-add-btn").click();
  assert.equal(editor.getValue().length, 2);

  // Make the two rows distinguishable, then move the second up.
  change(editor.element.querySelectorAll(".auth-type-select")[1], "password");
  editor.element.querySelectorAll(".auth-tool-btn")[3].click(); // 2nd row "move up"
  assert.equal(editor.getValue()[0].type, "password");

  // Remove a row — back to one.
  editor.element.querySelector(".auth-remove-btn").click();
  assert.equal(editor.getValue().length, 1);
  assert.ok(changes.length > 0, "onChange fired");
});

test("Browse fills the key path from the injected picker", async () => {
  const editor = mount({ openKeyFile: async () => "/picked/key.pem" });
  change(typeSelect(editor), "key");
  editor.element.querySelector(".auth-browse-btn").click();
  await new Promise((r) => setTimeout(r, 0)); // let the async picker resolve
  assert.equal(
    editor.element.querySelector(".auth-keypath-input").value,
    "/picked/key.pem",
  );
});
