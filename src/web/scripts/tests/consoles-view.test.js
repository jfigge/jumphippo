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

// consoles-view.test.js — the CONSOLES section controller: grouped rendering (with
// empty groups hidden), assign-to-group via the row context menu, and per-group
// collapse persistence. Exercises the whole wiring (list + editors + group model).

import { resetDom } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConsolesView } from "../components/consoles-view.js";
import { t } from "../i18n.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await flush();
};

function stub(over = {}) {
  const calls = { update: [], set: [], reorder: [] };
  const jumphippo = {
    consoles: {
      list: async () => over.consoles || [],
      sessions: async () => over.sessions || [],
      update: async (id, p) => (calls.update.push({ id, p }), { id, ...p }),
      delete: async (id) => ({ id }),
      open: async (id) => ({ sessionId: "s1", id }),
      reorder: async (ids) => (calls.reorder.push(ids), []),
    },
    groups: {
      list: async () => over.groups || [],
      delete: async () => ({}),
      reorder: async () => [],
    },
    settings: {
      get: async () => over.settings || {},
      set: async (p) => (calls.set.push(p), {}),
    },
    credentials: { list: async () => [] },
    jumpHosts: { list: async () => [] },
    schedule: { currentNetwork: async () => ({ ssid: null }) },
    contextMenu: { popup: async () => over.popupResult ?? null },
  };
  return { jumphippo, calls };
}

async function mount(over = {}) {
  resetDom();
  const { jumphippo, calls } = stub(over);
  const view = new ConsolesView({ jumphippo });
  document.body.appendChild(view.element);
  await view.load();
  await settle();
  return { view, calls };
}

const groupNames = (view) =>
  [...view.element.querySelectorAll(".group-name")].map((h) => h.textContent);

test("renders a section per non-empty group + Ungrouped, hiding empty groups", async () => {
  const { view } = await mount({
    consoles: [
      { id: "a", name: "db", groupId: "g1" },
      { id: "b", name: "cache" },
    ],
    groups: [
      { id: "g1", label: "Work", color: "blue" },
      { id: "g2", label: "Home", color: "teal" }, // empty → hidden
    ],
  });
  assert.deepEqual(groupNames(view), ["Work", t("group.ungrouped")]);
});

test("assigning a console to a group via the row menu updates it", async () => {
  const { view, calls } = await mount({
    consoles: [{ id: "a", name: "db" }],
    groups: [{ id: "g1", label: "Work", color: "blue" }],
    popupResult: "assign:g1",
  });
  view.element
    .querySelector(".tunnel-row")
    .dispatchEvent(
      new Event("contextmenu", { bubbles: true, cancelable: true }),
    );
  await settle();

  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].id, "a");
  assert.equal(calls.update[0].p.groupId, "g1");
});

test("collapsing a group persists the consoles' own collapse map", async () => {
  const { view, calls } = await mount({
    consoles: [{ id: "a", name: "db", groupId: "g1" }],
    groups: [{ id: "g1", label: "Work", color: "blue" }],
  });
  view.element.querySelector(".group-chevron").click();
  await settle();

  const setCall = calls.set.find((p) => "consoleGroupCollapsed" in p);
  assert.ok(setCall, "persisted the console collapse map");
  assert.deepEqual(setCall.consoleGroupCollapsed, { g1: true });
});
