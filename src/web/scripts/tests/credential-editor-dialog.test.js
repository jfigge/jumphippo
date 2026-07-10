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

import { resetDom, typeInto, change } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CredentialEditorDialog } from "../components/credential-editor-dialog.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function stub(calls = {}) {
  return {
    credentials: {
      create: async (p) => ((calls.create ||= []).push(p), { id: "c9", ...p }),
      update: async (id, p) => (
        (calls.update ||= []).push({ id, p }),
        { id, ...p }
      ),
    },
  };
}

function mount(calls = {}, onSaved) {
  resetDom();
  const dlg = new CredentialEditorDialog({
    porthippo: stub(calls),
    openKeyFile: async () => "/picked/key",
    onSaved,
  });
  return dlg;
}

const el = (dlg, sel) => dlg.element.querySelector(sel);

test("a fresh credential defaults to agent auth (no key/secret fields)", () => {
  const dlg = mount();
  dlg.openCreate();
  assert.ok(dlg.element.open);
  assert.ok(el(dlg, ".auth-agent-hint"), "agent hint shown");
  assert.equal(el(dlg, ".cred-keypath-input"), null);
  assert.equal(el(dlg, ".cred-secret-input"), null);
});

test("switching auth type reveals the right fields", () => {
  const dlg = mount();
  dlg.openCreate();

  change(el(dlg, ".cred-type-select"), "key");
  assert.ok(el(dlg, ".cred-keypath-input"), "key path shown for key auth");
  assert.ok(el(dlg, ".cred-secret-input"), "passphrase shown for key auth");

  change(el(dlg, ".cred-type-select"), "password");
  assert.equal(
    el(dlg, ".cred-keypath-input"),
    null,
    "no key path for password",
  );
  assert.ok(el(dlg, ".cred-secret-input"), "password field shown");
});

test("buildPayload carries the fields for the chosen type", () => {
  const dlg = mount();
  dlg.openCreate();
  typeInto(el(dlg, ".cred-label-input"), "Prod");
  typeInto(el(dlg, ".cred-user-input"), "deploy");
  change(el(dlg, ".cred-type-select"), "password");
  typeInto(el(dlg, ".cred-secret-input"), "s3cr3t");

  assert.deepEqual(dlg.buildPayload(), {
    label: "Prod",
    user: "deploy",
    authType: "password",
    password: "s3cr3t",
  });
});

test("Browse fills the key path from the native picker", async () => {
  const dlg = mount();
  dlg.openCreate();
  change(el(dlg, ".cred-type-select"), "key");
  el(dlg, ".auth-browse-btn").click();
  await flush();
  assert.equal(el(dlg, ".cred-keypath-input").value, "/picked/key");
  assert.equal(dlg.buildPayload().keyPath, "/picked/key");
});

test("a valid create persists, closes, emits, and calls onSaved", async () => {
  const calls = {};
  const saved = [];
  const changed = [];
  const dlg = mount(calls, (r) => saved.push(r));
  window.addEventListener("porthippo:credentials-changed", (e) =>
    changed.push(e.detail),
  );
  dlg.openCreate();
  typeInto(el(dlg, ".cred-label-input"), "Prod");
  typeInto(el(dlg, ".cred-user-input"), "deploy");

  dlg.element
    .querySelector("form")
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await flush();

  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].label, "Prod");
  assert.ok(!dlg.element.open, "dialog closed on success");
  assert.deepEqual(changed[0], { id: "c9" });
  assert.equal(saved.length, 1);
});

test("an invalid credential shows a field error and does not persist", async () => {
  const calls = {};
  const dlg = mount(calls);
  dlg.openCreate();
  // No label / user.
  dlg.element
    .querySelector("form")
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await flush();
  assert.equal(calls.create, undefined, "no store write");
  assert.ok(
    dlg.element
      .querySelector('.field[data-error-key="label"]')
      .classList.contains("field--error"),
  );
});

test("editing keeps a stored secret when it isn't retyped", async () => {
  const calls = {};
  const dlg = mount(calls);
  dlg.openEdit({
    id: "c1",
    label: "Prod",
    user: "deploy",
    authType: "password",
    hasSecret: true,
  });
  // The secret field advertises a stored value.
  assert.equal(
    el(dlg, ".auth-secret-status").hidden,
    false,
    "shows •••• set for a stored secret",
  );

  dlg.element
    .querySelector("form")
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await flush();
  assert.deepEqual(calls.update[0].p, {
    label: "Prod",
    user: "deploy",
    authType: "password",
    hasSecret: true, // retained, no plaintext resent
  });
});
