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

// tunnel-detail.test.js — the detail panel: the route breadcrumb (direct + jump
// chain), the arm/pause controls, the stat cards' values, and drag-and-drop card
// reordering (incl. the pure reorder/normalize helpers).

import test from "node:test";
import assert from "node:assert/strict";

import { resetDom } from "./jsdom-setup.js";
import {
  TunnelDetail,
  reorderCards,
  normalizeOrder,
  DEFAULT_CARD_ORDER,
} from "../components/tunnel-detail.js";

const NOW = 1_000_000;

function mount(opts = {}) {
  resetDom();
  const calls = { arm: [], pause: [], reorder: [] };
  const detail = new TunnelDetail({
    now: () => NOW,
    onToggleArm: (id) => calls.arm.push(id),
    onTogglePause: (id) => calls.pause.push(id),
    onReorder: (order) => calls.reorder.push(order),
    ...opts,
  });
  document.body.appendChild(detail.element);
  return { detail, calls };
}

const cards = (el) =>
  [...el.querySelectorAll(".detail-card")].map((c) => c.dataset.card);
const routeText = (el) =>
  [...el.querySelectorAll(".route-seg")].map((s) => s.textContent);

// ── Pure helpers ────────────────────────────────────────────────────────────

test("reorderCards moves a key to the target slot", () => {
  assert.deepEqual(reorderCards(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(reorderCards(["a", "b", "c"], "a", "c"), ["b", "a", "c"]);
  assert.deepEqual(reorderCards(["a", "b", "c"], "b", "b"), ["a", "b", "c"]);
});

test("normalizeOrder keeps known keys, drops unknown, appends the rest", () => {
  const out = normalizeOrder(["errors", "bogus", "download"]);
  assert.deepEqual(out.slice(0, 2), ["errors", "download"]);
  assert.ok(!out.includes("bogus"));
  // Every default key is present exactly once.
  assert.deepEqual([...out].sort(), [...DEFAULT_CARD_ORDER].sort());
});

// ── Breadcrumb ──────────────────────────────────────────────────────────────

test("breadcrumb of a direct tunnel is local → target", () => {
  const { detail } = mount();
  detail.show(
    {
      id: "t1",
      bindHost: "127.0.0.1",
      localPort: 18001,
      destination: { host: "127.0.0.1", port: 7000 },
    },
    { state: "disarmed" },
  );
  assert.deepEqual(routeText(detail.element), [
    "127.0.0.1:18001",
    "127.0.0.1:7000",
  ]);
  assert.ok(
    detail.element
      .querySelector(".route-seg--target")
      .textContent.includes("7000"),
  );
});

test("breadcrumb of a jump-chain is local → jump → ssh server → target", () => {
  const { detail } = mount();
  const jumpsById = new Map([
    ["j1", { id: "j1", label: "Docker jump", host: "127.0.0.1", port: 2201 }],
  ]);
  detail.show(
    {
      id: "t2",
      bindHost: "127.0.0.1",
      localPort: 18002,
      jumpHostIds: ["j1"],
      sshHost: "172.29.0.12",
      sshPort: 22,
      destination: { host: "127.0.0.1", port: 7000 },
    },
    { state: "connected", jumpsById },
  );
  assert.deepEqual(routeText(detail.element), [
    "127.0.0.1:18002",
    "Docker jump",
    "172.29.0.12:22",
    "127.0.0.1:7000",
  ]);
});

// ── Controls ────────────────────────────────────────────────────────────────

test("arm control reflects state and fires the intent", () => {
  const { detail, calls } = mount();
  detail.show(
    { id: "t1", localPort: 1, destination: { host: "h", port: 2 } },
    { state: "disarmed" },
  );
  const armBtn = detail.element.querySelector(".detail-arm-btn");
  assert.ok(!armBtn.classList.contains("detail-arm-btn--armed"));

  detail.updateState("connected");
  assert.ok(
    armBtn.classList.contains("detail-arm-btn--armed"),
    "armed when connected",
  );

  armBtn.click();
  assert.deepEqual(calls.arm, ["t1"]);
});

test("pause control is disabled unless connected/paused and fires the intent", () => {
  const { detail, calls } = mount();
  detail.show(
    { id: "t1", localPort: 1, destination: { host: "h", port: 2 } },
    { state: "listening" },
  );
  const pauseBtn = detail.element.querySelector(".detail-pause-btn");
  assert.equal(pauseBtn.disabled, true, "can't pause a listening tunnel");

  detail.updateState("connected");
  assert.equal(pauseBtn.disabled, false);
  pauseBtn.click();
  assert.deepEqual(calls.pause, ["t1"]);
});

// ── Cards ───────────────────────────────────────────────────────────────────

test("cards render values from the snapshot, incl. the new counters", () => {
  const { detail } = mount();
  detail.show(
    { id: "t1", localPort: 1, destination: { host: "h", port: 2 } },
    {
      state: "connected",
      snap: {
        rateDown: 1500,
        rateUp: 300,
        activeConnections: 3,
        connectionCount: 9,
        errorCount: 2,
        totalBytes: 2048,
        bytesUp: 1024,
        bytesDown: 1024,
        openedAt: NOW - 5000,
        firstConnectedAt: NOW - 60000,
        lastDisconnectedAt: NOW - 120000,
        lastActiveAt: NOW - 2000,
      },
    },
  );
  const value = (key) =>
    detail.element.querySelector(`.detail-card[data-card="${key}"] .card-value`)
      .textContent;

  assert.match(value("download"), /\/s$/);
  assert.equal(value("connections"), "3");
  assert.equal(value("connectionCount"), "9");
  assert.equal(value("errors"), "2");
  assert.equal(value("state"), "Connected");

  // A non-zero error count is toned danger; zero is not.
  const errEl = detail.element.querySelector(
    '.detail-card[data-card="errors"] .card-value',
  );
  assert.ok(errEl.classList.contains("card-value--error"));
});

test("the errors card is not red when the count is zero", () => {
  const { detail } = mount();
  detail.show(
    { id: "t1", localPort: 1, destination: { host: "h", port: 2 } },
    { state: "listening", snap: { errorCount: 0 } },
  );
  const errEl = detail.element.querySelector(
    '.detail-card[data-card="errors"] .card-value',
  );
  assert.ok(!errEl.classList.contains("card-value--error"));
});

test("empty state shows until a tunnel is selected", () => {
  const { detail } = mount();
  assert.equal(detail.element.querySelector(".detail-content").hidden, true);
  assert.equal(detail.element.querySelector(".detail-empty").hidden, false);
  detail.show(
    { id: "t1", localPort: 1, destination: { host: "h", port: 2 } },
    { state: "disarmed" },
  );
  assert.equal(detail.element.querySelector(".detail-content").hidden, false);
  detail.clear();
  assert.equal(detail.element.querySelector(".detail-content").hidden, true);
});

// ── Drag-and-drop reorder ─────────────────────────────────────────────────────

test("dragging one card onto another reorders and reports the new order", () => {
  const { detail, calls } = mount();
  detail.show(
    { id: "t1", localPort: 1, destination: { host: "h", port: 2 } },
    { state: "disarmed" },
  );

  const order = cards(detail.element);
  const from = order[0];
  const to = order[2];
  const cardEl = (key) =>
    detail.element.querySelector(`.detail-card[data-card="${key}"]`);

  cardEl(from).dispatchEvent(new Event("dragstart", { bubbles: true }));
  cardEl(to).dispatchEvent(new Event("drop", { bubbles: true }));

  assert.equal(calls.reorder.length, 1, "onReorder fired once");
  assert.deepEqual(calls.reorder[0], reorderCards(order, from, to));
  // The DOM reflects the new order.
  assert.deepEqual(cards(detail.element), reorderCards(order, from, to));
});
