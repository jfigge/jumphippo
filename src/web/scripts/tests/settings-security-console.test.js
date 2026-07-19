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

// settings-security-console.test.js — the Settings → Security "Show recent console
// output" toggle (Feature 210): load reflects the persisted value, and toggling it
// persists consoleShowOutput and broadcasts jumphippo:console-output-changed so open
// Console Manager panes re-read it.

import { resetDom } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SecuritySettings } from "../components/settings-security.js";

function mount(settings = {}) {
  resetDom();
  const calls = { set: [] };
  const jumphippo = {
    settings: {
      get: async () => settings,
      set: async (p) => (calls.set.push(p), {}),
    },
    secretStorage: {
      getMode: async () => ({
        mode: "app-key",
        locked: false,
        available: true,
        hasPassword: false,
      }),
    },
  };
  const view = new SecuritySettings({ jumphippo });
  document.body.appendChild(view.element);
  return { view, calls };
}

const check = (view) =>
  view.element.querySelector(".security-console-output-check");

test("load reflects the persisted consoleShowOutput value", async () => {
  const { view } = mount({ consoleShowOutput: false });
  await view.load();
  assert.equal(check(view).checked, false);

  const { view: on } = mount({ consoleShowOutput: true });
  await on.load();
  assert.equal(check(on).checked, true);
});

test("toggling persists the setting and broadcasts the change", async () => {
  const { view, calls } = mount({ consoleShowOutput: true });
  await view.load();

  let broadcast = null;
  window.addEventListener(
    "jumphippo:console-output-changed",
    (e) => (broadcast = e.detail),
  );

  const box = check(view);
  box.checked = false;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));

  assert.deepEqual(calls.set, [{ consoleShowOutput: false }]);
  assert.deepEqual(broadcast, { consoleShowOutput: false });
});
