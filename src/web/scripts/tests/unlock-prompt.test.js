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

// unlock-prompt.test.js — the unlock-on-launch modal: it only appears when the
// store booted locked, a wrong password keeps it open with an error, a correct
// one dismisses it (so main resumes the deferred arm), "Not now" dismisses
// without unlocking, and an unlock from elsewhere auto-closes it.

import test from "node:test";
import assert from "node:assert/strict";

import { resetDom } from "./jsdom-setup.js";
import { UnlockPrompt } from "../unlock-prompt.js";
import { PopupManager } from "../popup-manager.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function stub({ locked = true, unlockResults = [] } = {}) {
  const calls = { unlock: [], getMode: 0 };
  return {
    calls,
    porthippo: {
      secretStorage: {
        getMode: async () => {
          calls.getMode += 1;
          return {
            mode: locked ? "master-password" : "app-key",
            locked,
            available: false,
            hasPassword: locked,
          };
        },
        unlock: async (pw) => {
          calls.unlock.push(pw);
          return unlockResults.shift() ?? { ok: true };
        },
      },
    },
  };
}

const modal = () => document.querySelector(".popup-unlock");
const changed = (detail) =>
  window.dispatchEvent(
    new CustomEvent("porthippo:secret-storage-changed", { detail }),
  );

test("a locked store raises the unlock modal on install", async () => {
  resetDom();
  const { porthippo } = stub({ locked: true });
  const prompt = new UnlockPrompt({ porthippo }).install();
  try {
    await tick();
    assert.ok(modal(), "the unlock modal is shown");
    assert.ok(modal().querySelector(".unlock-input"), "with a password field");
  } finally {
    prompt.uninstall();
    PopupManager.close();
  }
});

test("an unlocked store shows no modal", async () => {
  resetDom();
  const { porthippo } = stub({ locked: false });
  const prompt = new UnlockPrompt({ porthippo }).install();
  try {
    await tick();
    assert.equal(modal(), null, "nothing to unlock → no prompt");
  } finally {
    prompt.uninstall();
    PopupManager.close();
  }
});

test("an empty password shows a required error and never calls unlock", async () => {
  resetDom();
  const { porthippo, calls } = stub({ locked: true });
  const prompt = new UnlockPrompt({ porthippo }).install();
  try {
    await tick();
    modal().querySelector(".btn--primary").click();
    await tick();
    assert.equal(calls.unlock.length, 0, "unlock is not attempted");
    const err = modal().querySelector(".popup-error");
    assert.ok(err && !err.hidden && err.textContent, "a required error shows");
    assert.ok(modal(), "the modal stays open");
  } finally {
    prompt.uninstall();
    PopupManager.close();
  }
});

test("a wrong password keeps the modal open with an error and clears the field", async () => {
  resetDom();
  const { porthippo, calls } = stub({
    locked: true,
    unlockResults: [{ ok: false, reason: "bad-password" }],
  });
  const prompt = new UnlockPrompt({ porthippo }).install();
  try {
    await tick();
    const input = modal().querySelector(".unlock-input");
    input.value = "wrong";
    modal().querySelector(".btn--primary").click();
    await tick();

    assert.deepEqual(calls.unlock, ["wrong"]);
    assert.ok(modal(), "the modal stays open on a bad password");
    const err = modal().querySelector(".popup-error");
    assert.ok(err && !err.hidden && err.textContent, "an error is shown");
    assert.equal(
      modal().querySelector(".unlock-input").value,
      "",
      "the field is cleared for a retry",
    );
  } finally {
    prompt.uninstall();
    PopupManager.close();
  }
});

test("a correct password unlocks and dismisses the modal", async () => {
  resetDom();
  const { porthippo, calls } = stub({
    locked: true,
    unlockResults: [{ ok: true }],
  });
  const prompt = new UnlockPrompt({ porthippo }).install();
  try {
    await tick();
    modal().querySelector(".unlock-input").value = "hunter2";
    modal().querySelector(".btn--primary").click();
    await tick();

    assert.deepEqual(calls.unlock, ["hunter2"]);
    assert.equal(modal(), null, "the modal closes on a successful unlock");
  } finally {
    prompt.uninstall();
    PopupManager.close();
  }
});

test("'Not now' dismisses without unlocking", async () => {
  resetDom();
  const { porthippo, calls } = stub({ locked: true });
  const prompt = new UnlockPrompt({ porthippo }).install();
  try {
    await tick();
    modal().querySelector(".btn--secondary").click();
    await tick();
    assert.equal(calls.unlock.length, 0, "no unlock attempted");
    assert.equal(modal(), null, "the modal is dismissed");
  } finally {
    prompt.uninstall();
    PopupManager.close();
  }
});

test("an unlock from elsewhere auto-closes the launch modal", async () => {
  resetDom();
  const { porthippo } = stub({ locked: true });
  const prompt = new UnlockPrompt({ porthippo }).install();
  try {
    await tick();
    assert.ok(modal(), "modal open while locked");
    changed({ mode: "master-password", locked: false });
    assert.equal(modal(), null, "an unlocked broadcast dismisses it");
  } finally {
    prompt.uninstall();
    PopupManager.close();
  }
});
