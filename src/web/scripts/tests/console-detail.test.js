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

// console-detail.test.js — the Console Manager details pane (Feature 210). Proves
// it renders a running session (status pill, window chips, recent output, runtime +
// activity), the not-running state, live activity folding, the output-disabled
// state, and that the action buttons report the right ids.

import { resetDom } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConsoleDetail } from "../components/console-detail.js";
import { t } from "../i18n.js";
import { formatBytes } from "../utils/format.js";

const DEF = {
  id: "c1",
  name: "Ping Admin",
  sshHost: "bastion",
  sshPort: 22,
  jumpHostIds: [],
};

function snap(over = {}) {
  return {
    id: "c1",
    sessionId: "s1",
    state: "connected",
    windowNumber: 3,
    openedAt: 0,
    connectedAt: 0,
    lastActivityAt: 9_000,
    bytesIn: 2048,
    bytesOut: 512,
    cols: 100,
    rows: 30,
    windowState: {
      visible: true,
      minimized: false,
      focused: true,
      fullScreen: false,
    },
    recentLines: ["$ tail -f log", "GET /health"],
    ...over,
  };
}

function mount(tc, now = () => 10_000) {
  resetDom();
  const calls = {
    bringForward: [],
    restart: [],
    close: [],
    openNew: [],
    copyInfo: [],
    selectSession: [],
  };
  const detail = new ConsoleDetail({
    now,
    onBringForward: (sid) => calls.bringForward.push(sid),
    onRestart: (sid) => calls.restart.push(sid),
    onClose: (sid) => calls.close.push(sid),
    onOpenNew: (id) => calls.openNew.push(id),
    onCopyInfo: (def) => calls.copyInfo.push(def),
    onSelectSession: (sid) => calls.selectSession.push(sid),
  });
  document.body.appendChild(detail.element);
  tc.after(() => detail.destroy());
  return { detail, calls };
}

const el = (root, sel) => root.element.querySelector(sel);
const btn = (root, labelKey) =>
  root.element.querySelector(`button[title="${t(labelKey)}"]`);

test("clear shows the empty hint and hides the content", (tc) => {
  const { detail } = mount(tc);
  detail.clear();
  assert.equal(el(detail, ".detail-empty").hidden, false);
  assert.equal(el(detail, ".console-detail-content").hidden, true);
});

test("show renders a running session's status, output, runtime and activity", (tc) => {
  const { detail } = mount(tc);
  detail.show(DEF, { snap: snap(), showOutput: true });

  assert.equal(el(detail, ".console-detail-content").hidden, false);
  assert.ok(
    el(detail, ".console-detail-name").textContent.includes("Ping Admin"),
  );

  const pill = el(detail, ".console-status-pill");
  assert.equal(pill.textContent, t("console.state.connected"));
  assert.ok(pill.className.includes("console-status-pill--connected"));

  // Sub-line: connected-to host + window number.
  const sub = el(detail, ".console-detail-sub").textContent;
  assert.ok(sub.includes("bastion:22"));
  assert.ok(sub.includes("#3"));

  // Recent output preview.
  assert.ok(el(detail, ".console-output").textContent.includes("GET /health"));

  // Activity: bytes sent = bytesOut, received = bytesIn.
  const values = [
    ...detail.element.querySelectorAll(".console-info-value"),
  ].map((n) => n.textContent);
  assert.ok(values.includes(formatBytes(512)));
  assert.ok(values.includes(formatBytes(2048)));
  assert.ok(values.includes("100 × 30")); // rows × columns

  // Window chips: visible + focused.
  const chips = [...detail.element.querySelectorAll(".console-chip")].map(
    (n) => n.textContent,
  );
  assert.ok(chips.includes(t("console.window.visible")));
  assert.ok(chips.includes(t("console.window.focused")));
});

test("a quiet connected session reads as Idle", (tc) => {
  const { detail } = mount(tc, () => 100_000);
  detail.show(DEF, {
    snap: snap({ lastActivityAt: 10_000 }),
    showOutput: true,
  });
  assert.equal(
    el(detail, ".console-status-pill").textContent,
    t("console.state.idle"),
  );
});

test("a not-running console disables the session actions", (tc) => {
  const { detail } = mount(tc);
  detail.show(DEF, { snap: null, showOutput: true });
  assert.equal(
    el(detail, ".console-status-pill").textContent,
    t("console.state.notRunning"),
  );
  assert.equal(btn(detail, "console.action.bringForward").disabled, true);
  assert.equal(btn(detail, "console.action.restart").disabled, true);
  assert.equal(btn(detail, "console.action.close").disabled, true);
  assert.equal(btn(detail, "console.action.openNew").disabled, false);
});

test("applyActivity folds in live bytes and output for the shown session", (tc) => {
  const { detail } = mount(tc);
  detail.show(DEF, { snap: snap(), showOutput: true });
  detail.applyActivity({
    sessionId: "s1",
    bytesIn: 4096,
    bytesOut: 512,
    lines: ["POST /login"],
  });
  assert.ok(el(detail, ".console-output").textContent.includes("POST /login"));
  const values = [
    ...detail.element.querySelectorAll(".console-info-value"),
  ].map((n) => n.textContent);
  assert.ok(values.includes(formatBytes(4096)));

  // Activity for a DIFFERENT session is ignored.
  detail.applyActivity({ sessionId: "other", lines: ["should-not-appear"] });
  assert.equal(
    el(detail, ".console-output").textContent.includes("should-not-appear"),
    false,
  );
});

test("with output disabled the preview shows the disabled message", (tc) => {
  const { detail } = mount(tc);
  detail.show(DEF, { snap: snap(), showOutput: false });
  const out = el(detail, ".console-output");
  assert.ok(out.textContent.includes(t("console.output.disabled")));
  assert.equal(out.textContent.includes("GET /health"), false);
});

test("action buttons report the right ids", (tc) => {
  const { detail, calls } = mount(tc);
  detail.show(DEF, { snap: snap(), showOutput: true });
  btn(detail, "console.action.bringForward").click();
  btn(detail, "console.action.openNew").click();
  btn(detail, "console.action.copyInfo").click();
  assert.deepEqual(calls.bringForward, ["s1"]);
  assert.deepEqual(calls.openNew, ["c1"]);
  assert.equal(calls.copyInfo.length, 1);
  assert.equal(calls.copyInfo[0].id, "c1");
});

test("the window switcher shows a pill per session and reports a pick", (tc) => {
  const { detail, calls } = mount(tc);
  const s1 = snap({ sessionId: "s1", windowNumber: 1 });
  const s2 = snap({ sessionId: "s2", windowNumber: 2 });
  detail.show(DEF, { snap: s2, sessions: [s1, s2], showOutput: true });

  const pills = [...detail.element.querySelectorAll(".console-session-pill")];
  assert.equal(pills.length, 2);
  const active = detail.element.querySelector(".console-session-pill--active");
  assert.ok(active.textContent.includes("#2")); // shown session is Window #2

  pills.find((p) => p.textContent.includes("#1")).click();
  assert.deepEqual(calls.selectSession, ["s1"]);
});

test("the window switcher is hidden when a console has one session", (tc) => {
  const { detail } = mount(tc);
  detail.show(DEF, { snap: snap(), sessions: [snap()], showOutput: true });
  assert.equal(
    detail.element.querySelector(".console-session-switcher").hidden,
    true,
  );
});
