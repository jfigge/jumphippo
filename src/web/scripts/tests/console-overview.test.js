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

// console-overview.test.js — the "Open Consoles" card grid (Feature 210): a card
// per running session, live output + status, reveal on double-click / button, and
// the empty state.

import { resetDom } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConsoleOverview } from "../components/console-overview.js";
import { t } from "../i18n.js";

function snap(id, over = {}) {
  return {
    id,
    sessionId: `s-${id}`,
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
    recentLines: [],
    ...over,
  };
}

function mount(tc) {
  resetDom();
  const revealed = [];
  const overview = new ConsoleOverview({
    now: () => 60_000,
    onReveal: (sid) => revealed.push(sid),
  });
  document.body.appendChild(overview.element);
  tc.after(() => overview.destroy());
  return { overview, revealed };
}

const cards = (o) => [...o.element.querySelectorAll(".console-card")];

test("renders a card per running session with name, status and duration", (tc) => {
  const { overview } = mount(tc);
  // lastActivityAt near `now` so the session reads Connected, not Idle.
  overview.setSessions([
    {
      sessionId: "s-a",
      name: "Ping Admin",
      snap: snap("a", { lastActivityAt: 60_000 }),
    },
    { sessionId: "s-b", name: "Sandbox Shell", snap: snap("b") },
  ]);
  const c = cards(overview);
  assert.equal(c.length, 2);
  assert.ok(overview.element.textContent.includes("Ping Admin"));
  assert.ok(overview.element.textContent.includes("Sandbox Shell"));
  assert.equal(
    c[0].querySelector(".console-status-pill").textContent,
    t("console.state.connected"),
  );
  // openedAt 0, now 60s → running 1m.
  assert.ok(
    c[0].querySelector(".console-card-duration").textContent.includes("1m"),
  );
});

test("shows the empty state when no sessions are open", (tc) => {
  const { overview } = mount(tc);
  overview.setSessions([]);
  assert.equal(
    overview.element.querySelector(".console-overview-empty").hidden,
    false,
  );
  assert.equal(cards(overview).length, 0);
});

test("a card shows recent output and folds in live activity", (tc) => {
  const { overview } = mount(tc);
  overview.setSessions([
    {
      sessionId: "s-a",
      name: "db",
      snap: snap("a", { recentLines: ["INFO started"] }),
    },
  ]);
  assert.ok(
    overview.element
      .querySelector(".console-card-output")
      .textContent.includes("INFO started"),
  );
  overview.applyActivity({ sessionId: "s-a", lines: ["GET /ping"] });
  assert.ok(
    overview.element
      .querySelector(".console-card-output")
      .textContent.includes("GET /ping"),
  );
});

test("double-clicking a card and the forward button both reveal it", (tc) => {
  const { overview, revealed } = mount(tc);
  overview.setSessions([{ sessionId: "s-a", name: "db", snap: snap("a") }]);
  const card = overview.element.querySelector(".console-card");
  card.dispatchEvent(new window.Event("dblclick", { bubbles: true }));
  card.querySelector(".console-card-forward").click();
  assert.deepEqual(revealed, ["s-a", "s-a"]);
});

test("with output disabled the card shows the disabled message", (tc) => {
  const { overview } = mount(tc);
  overview.setSessions(
    [
      {
        sessionId: "s-a",
        name: "db",
        snap: snap("a", { recentLines: ["secret output"] }),
      },
    ],
    { showOutput: false },
  );
  const out = overview.element.querySelector(".console-card-output");
  assert.ok(out.textContent.includes(t("console.output.disabled")));
  assert.equal(out.textContent.includes("secret output"), false);
});
