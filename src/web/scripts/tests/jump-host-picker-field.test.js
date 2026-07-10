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
import { JumpHostPickerField } from "../components/jump-host-picker-field.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function stub(jumps) {
  const list = [...jumps];
  return {
    jumpHosts: { list: async () => list },
    credentials: { list: async () => [] },
    _list: list,
  };
}

async function mount(jumps, onChange) {
  resetDom();
  const porthippo = stub(
    jumps || [
      { id: "j1", label: "relay1", host: "r1", port: 22 },
      { id: "j2", label: "relay2", host: "r2", port: 22 },
    ],
  );
  const picker = new JumpHostPickerField({ porthippo, onChange });
  document.body.appendChild(picker.element);
  await picker.load();
  return { picker, porthippo };
}

const addSelect = (p) => p.element.querySelector(".jumps-add-select");
const rows = (p) => p.element.querySelectorAll(".jumps-chain-row");

test("an empty chain shows the direct-connection hint", async () => {
  const { picker } = await mount();
  assert.equal(picker.element.querySelector(".jumps-empty").hidden, false);
  assert.equal(rows(picker).length, 0);
});

test("adding a jump host appends it and reports the chain", async () => {
  const emitted = [];
  const { picker } = await mount(undefined, (ids) => emitted.push(ids));
  change(addSelect(picker), "j1");
  assert.deepEqual(picker.value, ["j1"]);
  assert.deepEqual(emitted.at(-1), ["j1"]);
  assert.equal(rows(picker).length, 1);
  // The add-select no longer offers an already-chosen host.
  const optionValues = [...addSelect(picker).querySelectorAll("option")].map(
    (o) => o.value,
  );
  assert.deepEqual(optionValues, ["", "j2"]);
});

test("reorder + remove keep the chain in sync", async () => {
  const { picker } = await mount();
  picker.setValue(["j1", "j2"]);
  // Move the second up.
  picker.element
    .querySelectorAll(".jumps-chain-row")[1]
    .querySelector('[aria-label="Move up"]')
    .click();
  assert.deepEqual(picker.value, ["j2", "j1"]);
  // Remove the first.
  picker.element
    .querySelector(".jumps-chain-row")
    .querySelector('[aria-label="Remove jump host"]')
    .click();
  assert.deepEqual(picker.value, ["j1"]);
});

test("refresh prunes a chain entry whose jump host was deleted", async () => {
  const emitted = [];
  const { picker, porthippo } = await mount(undefined, (ids) =>
    emitted.push(ids),
  );
  picker.setValue(["j1", "j2"]);
  porthippo._list.splice(0, 1); // delete j1
  window.dispatchEvent(new CustomEvent("porthippo:jumphosts-changed"));
  await flush();
  assert.deepEqual(picker.value, ["j2"]);
});

test("New… opens the jump-host editor dialog", async () => {
  const { picker } = await mount();
  picker.element.querySelector(".jumps-new-btn").click();
  await flush();
  const dialog = document.querySelector(".jump-host-dialog");
  assert.ok(dialog && dialog.open);
});
