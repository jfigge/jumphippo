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
  const calls = {
    update: [],
    set: [],
    reorder: [],
    watch: [],
    reveal: [],
    restart: [],
    close: [],
    session: [],
    clipboard: [],
  };
  const jumphippo = {
    consoles: {
      list: async () => over.consoles || [],
      sessions: async () => over.sessions || [],
      update: async (id, p) => (calls.update.push({ id, p }), { id, ...p }),
      delete: async (id) => ({ id }),
      open: async (id) => ({ sessionId: "s1", id }),
      reorder: async (ids) => (calls.reorder.push(ids), []),
      session: async (sid) => (calls.session.push(sid), over.session ?? null),
      watch: async (ids) => (calls.watch.push(ids), { ok: true }),
      reveal: async (sid) => (calls.reveal.push(sid), { ok: true }),
      restart: async (sid) => (
        calls.restart.push(sid),
        { sessionId: "s2", id: "c1" }
      ),
      close: async (sid) => (calls.close.push(sid), { ok: true }),
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
    jumpHosts: { list: async () => over.jumps || [] },
    clipboard: {
      write: async (text) => (calls.clipboard.push(text), { ok: true }),
    },
    schedule: { currentNetwork: async () => ({ ssid: null }) },
    contextMenu: { popup: async () => over.popupResult ?? null },
  };
  return { jumphippo, calls };
}

async function mount(over = {}, cleanup) {
  resetDom();
  const { jumphippo, calls } = stub(over);
  const selected = [];
  const view = new ConsolesView({
    jumphippo,
    onConsoleSelected: (id) => selected.push(id),
  });
  // The Console Manager details pane starts a 1 s ticker on show(); dispose the
  // whole view after the test so the timer can't leak past it.
  if (cleanup) cleanup(() => view.destroy());
  document.body.appendChild(view.element);
  document.body.appendChild(view.detailElement);
  await view.load();
  await settle();
  return { view, calls, selected };
}

function session(over = {}) {
  return {
    id: "a",
    sessionId: "s1",
    state: "connected",
    windowNumber: 1,
    openedAt: 0,
    connectedAt: 0,
    lastActivityAt: 0,
    bytesIn: 0,
    bytesOut: 0,
    cols: 80,
    rows: 24,
    windowState: {
      visible: true,
      minimized: false,
      focused: false,
      fullScreen: false,
    },
    ...over,
  };
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

// ── Console Manager: selection → details pane (Feature 210) ───────────────────

test("selecting a running console shows its details, watches it, notifies app", async (tc) => {
  const { view, calls, selected } = await mount(
    {
      consoles: [
        { id: "a", name: "db", sshHost: "h", sshPort: 22, jumpHostIds: [] },
      ],
      sessions: [session()],
    },
    (fn) => tc.after(fn),
  );
  view.element.querySelector(".tunnel-row").click();
  await settle();

  assert.deepEqual(selected, ["a"]);
  assert.ok(
    calls.watch.some((ids) => Array.isArray(ids) && ids[0] === "s1"),
    "watched the selected session",
  );
  assert.ok(view.detailElement.textContent.includes("db"));
});

test("clearSelection stops watching and empties the pane", async (tc) => {
  const { view, calls } = await mount(
    {
      consoles: [{ id: "a", name: "db", sshHost: "h", jumpHostIds: [] }],
      sessions: [session()],
    },
    (fn) => tc.after(fn),
  );
  view.element.querySelector(".tunnel-row").click();
  await settle();
  view.clearSelection();
  await settle();

  assert.ok(calls.watch.includes(null), "unwatched on clear");
  assert.equal(
    view.detailElement.querySelector(".console-detail-content").hidden,
    true,
  );
});

test("the Bring Window Forward action reveals the session's window", async (tc) => {
  const { view, calls } = await mount(
    {
      consoles: [{ id: "a", name: "db", sshHost: "h", jumpHostIds: [] }],
      sessions: [session()],
    },
    (fn) => tc.after(fn),
  );
  view.element.querySelector(".tunnel-row").click();
  await settle();
  view.detailElement
    .querySelector(`button[title="${t("console.action.bringForward")}"]`)
    .click();
  await settle();

  assert.deepEqual(calls.reveal, ["s1"]);
});

test("a console-activity event updates the shown session's output", async (tc) => {
  const { view } = await mount(
    {
      consoles: [{ id: "a", name: "db", sshHost: "h", jumpHostIds: [] }],
      sessions: [session()],
    },
    (fn) => tc.after(fn),
  );
  view.element.querySelector(".tunnel-row").click();
  await settle();

  window.dispatchEvent(
    new CustomEvent("jumphippo:console-activity", {
      detail: { sessionId: "s1", bytesIn: 12, lines: ["live-output-line"] },
    }),
  );
  await settle();

  assert.ok(
    view.detailElement
      .querySelector(".console-output")
      .textContent.includes("live-output-line"),
  );
});

test("clicking the CONSOLES title shows the overview and watches all sessions", async (tc) => {
  const { view, calls } = await mount(
    {
      consoles: [{ id: "a", name: "db", sshHost: "h", jumpHostIds: [] }],
      sessions: [session()],
    },
    (fn) => tc.after(fn),
  );
  view.element.querySelector(".tunnel-sidebar-title--btn").click();
  await settle();

  assert.equal(view.overviewElement.hidden, false);
  assert.ok(view.overviewElement.querySelector(".console-card"));
  assert.ok(
    calls.watch.some((ids) => Array.isArray(ids) && ids.includes("s1")),
    "watched all open sessions for the overview",
  );
});

test("a quiet running console shows an Idle runtime sub-line", async (tc) => {
  const { view } = await mount(
    {
      consoles: [{ id: "a", name: "db", sshHost: "h", jumpHostIds: [] }],
      sessions: [session()], // lastActivityAt 0 vs the real clock → idle
    },
    (fn) => tc.after(fn),
  );
  assert.equal(
    view.element.querySelector(".console-row-sub").textContent,
    t("console.sidebar.idle"),
  );
});

test("a connecting console shows a Connecting runtime sub-line", async (tc) => {
  const { view } = await mount(
    {
      consoles: [{ id: "a", name: "db", sshHost: "h", jumpHostIds: [] }],
      sessions: [session({ state: "connecting" })],
    },
    (fn) => tc.after(fn),
  );
  assert.equal(
    view.element.querySelector(".console-row-sub").textContent,
    t("console.sidebar.connecting"),
  );
});

test("a multi-session console shows a window switcher and can switch windows", async (tc) => {
  const { view, calls } = await mount(
    {
      consoles: [{ id: "a", name: "db", sshHost: "h", jumpHostIds: [] }],
      sessions: [
        session({ sessionId: "s1", windowNumber: 1, openedAt: 1 }),
        session({ sessionId: "s2", windowNumber: 2, openedAt: 2 }),
      ],
    },
    (fn) => tc.after(fn),
  );
  view.element.querySelector(".tunnel-row").click();
  await settle();

  const pills = [
    ...view.detailElement.querySelectorAll(".console-session-pill"),
  ];
  assert.equal(pills.length, 2);
  // Newest (s2 / Window #2) is tracked by default.
  assert.ok(
    view.detailElement
      .querySelector(".console-session-pill--active")
      .textContent.includes("#2"),
  );

  // Switch to Window #1 → the pane re-watches s1.
  calls.watch.length = 0;
  pills.find((p) => p.textContent.includes("#1")).click();
  await settle();
  assert.ok(calls.watch.some((ids) => Array.isArray(ids) && ids[0] === "s1"));
});

test("the detail and overview panes are mutually exclusive", async (tc) => {
  const { view } = await mount(
    {
      consoles: [{ id: "a", name: "db", sshHost: "h", jumpHostIds: [] }],
      sessions: [session()],
    },
    (fn) => tc.after(fn),
  );
  view.element.querySelector(".tunnel-row").click();
  await settle();
  assert.equal(view.detailElement.hidden, false);
  assert.equal(view.overviewElement.hidden, true);

  view.element.querySelector(".tunnel-sidebar-title--btn").click();
  await settle();
  assert.equal(view.overviewElement.hidden, false);
  assert.equal(view.detailElement.hidden, true);
});
