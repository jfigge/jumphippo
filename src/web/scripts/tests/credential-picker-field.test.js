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

import { resetDom, change } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CredentialPickerField } from "../components/credential-picker-field.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function stub(creds) {
  const list = [...creds];
  return {
    credentials: {
      list: async () => list,
      get: async (id) => list.find((c) => c.id === id) || null,
      create: async (p) => {
        const rec = { id: "cN", ...p };
        list.push(rec);
        return rec;
      },
    },
    _list: list,
  };
}

async function mount(creds = [{ id: "c1", label: "Prod" }], onChange) {
  resetDom();
  const jumphippo = stub(creds);
  const picker = new CredentialPickerField({ jumphippo, onChange });
  document.body.appendChild(picker.element);
  await picker.load();
  return { picker, jumphippo };
}

const sel = (p) => p.element.querySelector(".cred-picker-select");

test("renders a placeholder + one option per credential", async () => {
  const { picker } = await mount([
    { id: "c1", label: "Prod" },
    { id: "c2", label: "Staging" },
  ]);
  const options = sel(picker).querySelectorAll("option");
  assert.equal(options.length, 3); // placeholder + 2
  assert.equal(options[1].value, "c1");
  assert.equal(options[1].textContent, "Prod");
});

test("choosing an option reports the id and enables Edit", async () => {
  const picked = [];
  const { picker } = await mount([{ id: "c1", label: "Prod" }], (id) =>
    picked.push(id),
  );
  assert.equal(
    picker.element.querySelector(".cred-picker-edit").disabled,
    true,
    "Edit disabled with no selection",
  );
  change(sel(picker), "c1");
  assert.deepEqual(picked, ["c1"]);
  assert.equal(picker.value, "c1");
  assert.equal(
    picker.element.querySelector(".cred-picker-edit").disabled,
    false,
  );
});

test("setValue selects, and a deleted selection falls back to none", async () => {
  const { picker } = await mount([{ id: "c1", label: "Prod" }]);
  picker.setValue("c1");
  assert.equal(picker.value, "c1");
  picker.setValue("gone");
  assert.equal(picker.value, "", "a missing id resets to the placeholder");
});

test("a credentials-changed event refreshes the options", async () => {
  const { picker, jumphippo } = await mount([{ id: "c1", label: "Prod" }]);
  jumphippo._list.push({ id: "c2", label: "New one" });
  window.dispatchEvent(new CustomEvent("jumphippo:credentials-changed"));
  await flush();
  assert.equal(sel(picker).querySelectorAll("option").length, 3);
});

test("New… opens the credential editor dialog", async () => {
  const { picker } = await mount([]);
  picker.element.querySelector(".cred-picker-new").click();
  const dialog = document.querySelector(".credential-dialog");
  assert.ok(dialog && dialog.open, "credential editor opened");
});
