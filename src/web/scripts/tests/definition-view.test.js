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

import { resetDom } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DefinitionView } from "../components/definition-view.js";

function fixtureDefs() {
  return [
    {
      id: "a",
      name: "Alpha",
      localPort: 5432,
      destination: { host: "db", port: 5432 },
      sshServer: { host: "s", port: 22, user: "u", auth: [{ type: "agent" }] },
      jumps: [],
    },
    {
      id: "b",
      name: "Beta",
      localPort: 6379,
      destination: { host: "cache", port: 6379 },
      sshServer: { host: "s", port: 22, user: "u", auth: [{ type: "agent" }] },
      jumps: [],
    },
  ];
}

function stubPorthippo(defs, calls = {}) {
  return {
    tunnels: {
      list: async () => defs,
      status: async () => [],
      arm: async (id) => (
        (calls.arm ||= []).push(id),
        { id, state: "listening" }
      ),
      disarm: async (id) => (
        (calls.disarm ||= []).push(id),
        { id, state: "disarmed" }
      ),
      create: async (def) => ({ id: "new", ...def }),
      update: async (id, patch) => ({ id, ...patch }),
      delete: async (id) => ((calls.delete ||= []).push(id), { id }),
      reorder: async (ids) => (
        (calls.reorder ||= []).push(ids),
        ids.map((id) => ({ id }))
      ),
    },
  };
}

async function mount(defs = fixtureDefs(), calls = {}) {
  resetDom();
  const view = new DefinitionView({ porthippo: stubPorthippo(defs, calls) });
  document.body.appendChild(view.element);
  await view.load();
  return view;
}

test("lists a row per definition with its summary", async () => {
  const view = await mount();
  const rows = view.element.querySelectorAll(".def-row");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector(".def-row-name").textContent, "Alpha");
  assert.match(
    rows[0].querySelector(".def-row-summary").textContent,
    /5432.*db.*5432/,
  );
});

test("selecting a row opens the editor", async () => {
  const view = await mount();
  const editor = view.element.querySelector(".tunnel-editor");
  assert.equal(editor.hidden, true, "editor hidden until a row is chosen");

  view.element.querySelector(".def-row").click();
  assert.equal(editor.hidden, false, "editor shown");
  assert.equal(
    view.element.querySelector(".editor-input-name").value,
    "Alpha",
    "editor loaded the selected definition",
  );
});

test("New tunnel reveals a blank editor", async () => {
  const view = await mount();
  view.element.querySelector(".def-add-btn").click();
  const editor = view.element.querySelector(".tunnel-editor");
  assert.equal(editor.hidden, false);
  assert.equal(view.element.querySelector(".editor-input-name").value, "");
});

test("the arm toggle sends an arm intent for a disarmed tunnel", async () => {
  const calls = {};
  const view = await mount(fixtureDefs(), calls);
  view.element.querySelector(".def-arm-btn").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.arm, ["a"]);
});

test("a tunnel-state broadcast updates the badge", async () => {
  const view = await mount();
  window.dispatchEvent(
    new CustomEvent("porthippo:tunnel-state", {
      detail: { id: "b", state: "connected" },
    }),
  );
  const betaRow = view.element.querySelectorAll(".def-row")[1];
  assert.ok(
    betaRow.querySelector(".def-badge--connected"),
    "Beta badge reflects the connected state",
  );
});

test("deleting confirms then calls delete", async () => {
  const calls = {};
  const view = await mount(fixtureDefs(), calls);
  view.element.querySelector(".def-delete-btn").click();
  // The confirm dialog is mounted on the shared overlay; click its danger button.
  document.querySelector(".popup-confirm .btn--danger").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.delete, ["a"]);
});
