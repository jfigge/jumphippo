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

// tunnels-view.test.js — the master-detail container: load renders the list and
// auto-selects, selection drives the detail breadcrumb, live stats/state flow to
// the selected tunnel, arm/delete route through the bridge (delete via the shared
// confirm dialog), and card reordering persists to settings.

import test from "node:test";
import assert from "node:assert/strict";

import { resetDom } from "./jsdom-setup.js";
import { PopupManager } from "../popup-manager.js";
import { TunnelsView } from "../components/tunnels-view.js";

const NOW = 2_000_000;

function stub(
  defs,
  { status = [], jumps = [], settings = {}, calls = {} } = {},
) {
  return {
    tunnels: {
      list: async () => defs,
      status: async () => status,
      arm: async (id) => (
        (calls.arm ||= []).push(id),
        { id, state: "listening" }
      ),
      disarm: async (id) => (
        (calls.disarm ||= []).push(id),
        { id, state: "disarmed" }
      ),
      pause: async (id) => ((calls.pause ||= []).push(id), { id }),
      resume: async (id) => ((calls.resume ||= []).push(id), { id }),
      create: async (d) => ((calls.create ||= []).push(d), { id: "new", ...d }),
      update: async (id, p) => (
        (calls.update ||= []).push({ id, p }),
        { id, ...p }
      ),
      delete: async (id) => ((calls.delete ||= []).push(id), { id }),
    },
    jumpHosts: { list: async () => jumps },
    credentials: { list: async () => [] },
    settings: {
      get: async () => settings,
      set: async (p) => ((calls.set ||= []).push(p), p),
    },
  };
}

const DEFS = [
  {
    id: "a",
    name: "Alpha",
    bindHost: "127.0.0.1",
    localPort: 18001,
    destination: { host: "127.0.0.1", port: 7000 },
  },
  {
    id: "b",
    name: "Beta",
    bindHost: "127.0.0.1",
    localPort: 18002,
    sshHost: "172.29.0.12",
    sshPort: 22,
    destination: { host: "127.0.0.1", port: 5432 },
  },
];

async function mount(opts = {}) {
  resetDom();
  const calls = opts.calls || {};
  const view = new TunnelsView({
    porthippo: stub(opts.defs || DEFS, { ...opts, calls }),
    now: () => NOW,
  });
  document.body.appendChild(view.element);
  await view.load();
  return { view, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const routeText = (view) =>
  [...view.element.querySelectorAll(".route-seg")].map((s) => s.textContent);

test("load renders the list and auto-selects the first tunnel's detail", async () => {
  const { view } = await mount();
  assert.equal(view.element.querySelectorAll(".tunnel-row").length, 2);
  assert.ok(
    view.element.querySelector(
      ".tunnel-row--selected [class*='tunnel-row-name']",
    )
      ? true
      : view.element.querySelector(".tunnel-row--selected"),
    "a row is selected",
  );
  assert.deepEqual(routeText(view), ["127.0.0.1:18001", "127.0.0.1:7000"]);
});

test("selecting another row updates the detail breadcrumb", async () => {
  const { view } = await mount();
  view.element.querySelectorAll(".tunnel-row")[1].click();
  assert.deepEqual(routeText(view), [
    "127.0.0.1:18002",
    "172.29.0.12:22",
    "127.0.0.1:5432",
  ]);
});

test("a stats snapshot updates the selected tunnel's cards and its dot", async () => {
  const { view } = await mount();
  window.dispatchEvent(
    new CustomEvent("porthippo:stats-updated", {
      detail: {
        stats: new Map([
          [
            "a",
            {
              id: "a",
              state: "connected",
              activeConnections: 4,
              connectionCount: 7,
            },
          ],
        ]),
      },
    }),
  );
  const val = (key) =>
    view.element.querySelector(`.detail-card[data-card="${key}"] .card-value`)
      .textContent;
  assert.equal(val("connections"), "4");
  assert.equal(val("connectionCount"), "7");
  // The list dot for 'a' went green (armed/connected).
  const row = view.element.querySelector('.tunnel-row[data-id="a"]');
  assert.ok(row.querySelector(".tunnel-dot--armed"));
});

test("the detail arm control routes to tunnels.arm for the selected tunnel", async () => {
  const calls = {};
  const { view } = await mount({ calls });
  view.element.querySelector(".detail-arm-btn").click();
  await tick();
  assert.deepEqual(calls.arm, ["a"]);
});

test("deleting a tunnel confirms via the shared dialog then calls delete", async () => {
  const calls = {};
  await mount({ calls });
  document.querySelector('.tunnel-row[data-id="b"] .tunnel-delete-btn').click();
  const danger = document.querySelector(".popup-confirm .btn--danger");
  assert.ok(danger, "a delete confirm dialog opened");
  danger.click();
  await tick();
  assert.deepEqual(calls.delete, ["b"]);
});

test("reordering cards persists the new order to settings", async () => {
  const calls = {};
  const { view } = await mount({ calls });
  const cardEls = [...view.element.querySelectorAll(".detail-card")];
  cardEls[0].dispatchEvent(new Event("dragstart", { bubbles: true }));
  cardEls[2].dispatchEvent(new Event("drop", { bubbles: true }));
  await tick();
  assert.ok(calls.set && calls.set.length >= 1, "settings.set was called");
  assert.ok(
    Array.isArray(calls.set[0].cardOrder),
    "persisted a cardOrder array",
  );
  // Clean up the singleton popup host between tests.
  PopupManager.close();
});

test("a persisted cardOrder is applied to the detail grid", async () => {
  const { view } = await mount({
    settings: { cardOrder: ["errors", "download"] },
  });
  const order = [...view.element.querySelectorAll(".detail-card")].map(
    (c) => c.dataset.card,
  );
  assert.equal(order[0], "errors", "saved order leads");
  assert.equal(order[1], "download");
});
