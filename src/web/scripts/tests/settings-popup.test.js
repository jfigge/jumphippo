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
import { SettingsPopup } from "../components/settings-popup.js";
import { PopupManager } from "../popup-manager.js";
import { init as initBuildInfo } from "../build-info.js";

// Drive the shared build-info singleton to a capability map, then restore the
// "everything enabled" default (build-info is a module singleton shared across
// tests). Store builds gate launch-at-login and the ssh-config default path.
async function withCaps(capabilities, fn) {
  await initBuildInfo({
    build: { info: async () => ({ distribution: "store", capabilities }) },
  });
  try {
    await fn();
  } finally {
    await initBuildInfo({
      build: {
        info: async () => ({ distribution: "direct", capabilities: {} }),
      },
    });
  }
}

// PopupManager keeps its active popup in module state; resetting the DOM per test
// would strand the popup in a detached document. Use a single DOM for the file
// and just close the popup between tests (each test starts from an idle host).
const window = resetDom();

// Flush the microtasks a not-awaited async handler (e.g. #loadSecurityState)
// leaves pending, so its DOM effects have landed before we assert.
const tick = () => new Promise((r) => setTimeout(r, 0));

function stubBridge(overrides = {}) {
  const { secretStorage: secState, ...settingsOverrides } = overrides;
  const calls = { set: [], copy: 0, setMode: [], unlock: [], lock: 0 };
  const settings = {
    theme: "system",
    language: "system",
    defaultLingerMs: 10000,
    defaultBindHost: "127.0.0.1",
    defaultKeepAlive: false,
    launchAtLogin: false,
    startMinimized: false,
    armOnLaunch: true,
    confirmOnQuit: false,
    ...settingsOverrides,
  };
  const security = {
    mode: "app-key",
    locked: false,
    available: true,
    hasPassword: false,
    ...secState,
  };
  const jumphippo = {
    settings: {
      get: async () => ({ ...settings }),
      set: (patch) => {
        calls.set.push(patch);
        return Promise.resolve(patch);
      },
    },
    diagnostics: {
      copy: () => {
        calls.copy++;
        return Promise.resolve("report");
      },
    },
    secretStorage: {
      getMode: async () => ({ ...security }),
      setMode: (payload) => {
        calls.setMode.push(payload);
        return Promise.resolve({ ok: true });
      },
      unlock: (password) => {
        calls.unlock.push(password);
        return Promise.resolve(
          password === "right"
            ? { ok: true }
            : { ok: false, reason: "bad-password" },
        );
      },
      lock: () => {
        calls.lock++;
        return Promise.resolve({ ok: true });
      },
    },
  };
  return { jumphippo, calls };
}

// Open the popup and reveal its Security tab, returning the mounted root once the
// async state load has settled.
async function openSecurity(jumphippo) {
  const popup = new SettingsPopup({ jumphippo });
  await popup.open();
  const root = document.querySelector(".popup-settings");
  root
    .querySelector('.settings-nav-item[data-panel="security"]')
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick();
  return root;
}

const clickEvent = () => new window.Event("click", { bubbles: true });
const changeEvent = () => new window.Event("change", { bubbles: true });

test("open populates controls from the loaded settings", async () => {
  PopupManager.close(); // start from an idle host (popups now queue, not replace)
  const { jumphippo } = stubBridge({ theme: "dark", defaultLingerMs: 2500 });
  const popup = new SettingsPopup({ jumphippo });
  await popup.open();

  const el = document.querySelector(".popup-settings");
  assert.ok(el, "settings popup mounted");
  assert.equal(el.querySelector("#setting-theme").value, "dark");
  assert.equal(el.querySelector("#setting-lingerMs").value, "2500");
  assert.equal(el.querySelector("#setting-armOnLaunch").checked, true);
});

test("changing a control persists the full settings and broadcasts", async () => {
  PopupManager.close();
  const { jumphippo, calls } = stubBridge();
  const popup = new SettingsPopup({ jumphippo });
  await popup.open();

  const events = [];
  window.addEventListener("jumphippo:settings-changed", (e) =>
    events.push(e.detail),
  );

  change(document.querySelector("#setting-theme"), "light");

  assert.equal(calls.set.length, 1);
  assert.equal(calls.set[0].theme, "light");
  // The whole object is sent, not just the delta.
  assert.equal(calls.set[0].defaultBindHost, "127.0.0.1");
  assert.equal(events.length, 1);
  assert.equal(events[0].theme, "light");
});

test("the reliability panel round-trips notification + reconnect settings (Feature 130)", async () => {
  PopupManager.close();
  const { jumphippo, calls } = stubBridge({
    notificationsEnabled: true,
    notifyOnDrop: true,
    notifyCooldownMs: 60000,
    sshKeepaliveSeconds: 15,
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30000,
    reconnectMaxAttempts: 6,
  });
  const popup = new SettingsPopup({ jumphippo });
  await popup.open();
  const el = document.querySelector(".popup-settings");

  // Loaded values populate the controls.
  assert.equal(el.querySelector("#setting-notifyOnDrop").checked, true);
  assert.equal(el.querySelector("#setting-sshKeepaliveSeconds").value, "15");
  assert.equal(el.querySelector("#setting-reconnectMaxAttempts").value, "6");

  // Editing a reliability field persists the whole (typed) settings object.
  change(el.querySelector("#setting-notifyOnDrop"), false);
  change(el.querySelector("#setting-sshKeepaliveSeconds"), "30");
  const last = calls.set[calls.set.length - 1];
  assert.equal(last.notifyOnDrop, false);
  assert.equal(last.sshKeepaliveSeconds, 30);
  assert.equal(last.reconnectMaxAttempts, 6); // untouched fields ride along
  assert.equal(typeof last.reconnectBaseMs, "number");
});

test("switching tabs shows the matching panel", async () => {
  PopupManager.close(); // start from an idle host (popups now queue, not replace)
  const { jumphippo } = stubBridge();
  const popup = new SettingsPopup({ jumphippo });
  await popup.open();

  const el = document.querySelector(".popup-settings");
  const behaviourTab = el.querySelector(
    '.settings-nav-item[data-panel="behaviour"]',
  );
  behaviourTab.dispatchEvent(new window.Event("click", { bubbles: true }));

  assert.equal(
    el.querySelector('.settings-panel[data-panel="behaviour"]').hidden,
    false,
  );
  assert.equal(
    el.querySelector('.settings-panel[data-panel="appearance"]').hidden,
    true,
  );
  assert.equal(
    behaviourTab.classList.contains("settings-nav-item--active"),
    true,
  );
});

test("the copy-diagnostics button calls the bridge", async () => {
  PopupManager.close();
  const { jumphippo, calls } = stubBridge();
  const popup = new SettingsPopup({ jumphippo });
  await popup.open();

  const btn = [...document.querySelectorAll(".settings-footer .btn")].find(
    (b) => b.classList.contains("btn--ghost"),
  );
  btn.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(calls.copy, 1);
});

// ── Security tab (Feature 90) ────────────────────────────────────────────────

test("the Security tab loads the current mode and reflects it", async () => {
  PopupManager.close();
  const { jumphippo } = stubBridge();
  const root = await openSecurity(jumphippo);

  assert.equal(
    root.querySelector('.settings-panel[data-panel="security"]').hidden,
    false,
  );
  assert.equal(
    root.querySelector('.security-mode-radio[value="app-key"]').checked,
    true,
  );
  // OS keychain is available in this stub, so its radio is enabled.
  assert.equal(
    root.querySelector('.security-mode-radio[value="os-keychain"]').disabled,
    false,
  );
});

test("OS keychain is disabled when safeStorage is unavailable", async () => {
  PopupManager.close();
  const { jumphippo } = stubBridge({ secretStorage: { available: false } });
  const root = await openSecurity(jumphippo);
  assert.equal(
    root.querySelector('.security-mode-radio[value="os-keychain"]').disabled,
    true,
  );
});

test("picking a no-password mode shows an inline confirm; confirming calls setMode", async () => {
  PopupManager.close();
  const { jumphippo, calls } = stubBridge();
  const root = await openSecurity(jumphippo);

  const keychain = root.querySelector(
    '.security-mode-radio[value="os-keychain"]',
  );
  keychain.checked = true;
  keychain.dispatchEvent(changeEvent());

  const confirmRow = root.querySelector(".security-confirm-row");
  assert.equal(confirmRow.hidden, false, "the inline confirm bar appears");
  assert.equal(calls.setMode.length, 0, "no switch until confirmed");

  root.querySelector(".security-confirm-apply").dispatchEvent(clickEvent());
  await tick();
  assert.deepEqual(calls.setMode, [{ mode: "os-keychain" }]);
});

test("setting a master password validates the match before switching", async () => {
  PopupManager.close();
  const { jumphippo, calls } = stubBridge();
  const root = await openSecurity(jumphippo);

  const master = root.querySelector(
    '.security-mode-radio[value="master-password"]',
  );
  master.checked = true;
  master.dispatchEvent(changeEvent());
  assert.equal(root.querySelector(".security-master-fields").hidden, false);

  // Mismatched confirmation → an error, no switch.
  root.querySelector(".security-master-pw").value = "hunter2";
  root.querySelector(".security-master-pw-confirm").value = "different";
  root.querySelector(".security-master-apply").dispatchEvent(clickEvent());
  await tick();
  assert.equal(calls.setMode.length, 0);
  assert.equal(
    root
      .querySelector(".security-status")
      .classList.contains("security-status--error"),
    true,
  );

  // Matching → the switch is sent with the password.
  root.querySelector(".security-master-pw-confirm").value = "hunter2";
  root.querySelector(".security-master-apply").dispatchEvent(clickEvent());
  await tick();
  assert.deepEqual(calls.setMode.at(-1), {
    mode: "master-password",
    password: "hunter2",
  });
});

test("a locked session shows the unlock row and sends the password to unlock", async () => {
  PopupManager.close();
  const { jumphippo, calls } = stubBridge({
    secretStorage: { mode: "master-password", locked: true, hasPassword: true },
  });
  const root = await openSecurity(jumphippo);

  assert.equal(root.querySelector(".security-locked-row").hidden, false);

  root.querySelector(".security-unlock-pw").value = "right";
  root.querySelector(".security-unlock-btn").dispatchEvent(clickEvent());
  await tick();
  assert.deepEqual(calls.unlock, ["right"]);
});

// ── Store-build gating ────────────────────────────────────────────────────────

test("launch-at-login is disabled with a store hint in a build that can't honour it", async () => {
  await withCaps({ launchAtLogin: false }, async () => {
    PopupManager.close();
    const { jumphippo } = stubBridge();
    const popup = new SettingsPopup({ jumphippo });
    await popup.open();

    const root = document.querySelector(".popup-settings");
    const check = root.querySelector("#setting-launchAtLogin");
    assert.equal(check.disabled, true, "launch-at-login checkbox disabled");
    assert.ok(
      check.closest(".settings-check--disabled"),
      "row marked disabled",
    );
    // The other behaviour toggles stay live.
    assert.equal(root.querySelector("#setting-armOnLaunch").disabled, false);
  });
});

test("launch-at-login stays enabled in a normal (direct) build", async () => {
  PopupManager.close();
  const { jumphippo } = stubBridge();
  const popup = new SettingsPopup({ jumphippo });
  await popup.open();

  const check = document
    .querySelector(".popup-settings")
    .querySelector("#setting-launchAtLogin");
  assert.equal(check.disabled, false);
});

test("the SSH-config import shows a manual-pick note when the default path is gated", async () => {
  await withCaps({ sshConfigDefaultPath: false }, async () => {
    PopupManager.close();
    const { jumphippo } = stubBridge();
    const popup = new SettingsPopup({ jumphippo });
    await popup.open();

    const root = document.querySelector(".popup-settings");
    root
      .querySelector('.settings-nav-item[data-panel="data"]')
      .dispatchEvent(clickEvent());
    assert.ok(
      root.querySelector(".settings-store-note"),
      "ssh-config store note shown",
    );
  });
});
