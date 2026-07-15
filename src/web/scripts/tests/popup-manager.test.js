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

// popup-manager.test.js — the shared modal host. Covers the top-layer mount and,
// critically, that a second popup is QUEUED rather than dropped (so concurrent
// host-key prompts can't strand a pending SSH connection). Also covers the
// type-to-confirm gate on confirmDelete (the danger button stays disabled until
// the delete word is typed).

import test from "node:test";
import assert from "node:assert/strict";

import { resetDom } from "./jsdom-setup.js";
import { PopupManager } from "../popup-manager.js";
import { el } from "../dom.js";

function popup(cls) {
  return { element: el("div", { class: cls }, [el("button", { text: cls })]) };
}

test("open mounts the popup in a native top-layer <dialog>", () => {
  resetDom();
  PopupManager.open(popup("p-solo"));
  const dialog = document.querySelector(".popup-dialog");
  assert.ok(dialog, "a <dialog> host was created");
  assert.equal(dialog.tagName, "DIALOG");
  assert.ok(dialog.open, "it was shown modally (top layer)");
  assert.ok(dialog.querySelector(".p-solo"), "the popup content is mounted");
  PopupManager.close();
  assert.equal(
    document.querySelector(".popup-dialog"),
    null,
    "closed + removed",
  );
});

test("a second popup is queued (not dropped) and shown after the first closes", () => {
  resetDom();
  PopupManager.open(popup("p-a"));
  PopupManager.open(popup("p-b")); // must NOT replace/drop p-a

  assert.ok(document.querySelector(".p-a"), "the first popup is shown");
  assert.equal(
    document.querySelector(".p-b"),
    null,
    "the second popup waits in the queue rather than replacing the first",
  );

  PopupManager.close(); // close p-a → the queued p-b takes its place
  assert.equal(document.querySelector(".p-a"), null, "first popup closed");
  assert.ok(document.querySelector(".p-b"), "the queued popup is now shown");

  PopupManager.close();
  assert.equal(document.querySelector(".popup-dialog"), null, "host is idle");
});

test("Escape (native cancel) routes to onMaskClick", () => {
  resetDom();
  let dismissed = false;
  PopupManager.open({
    element: el("div", { class: "p-esc" }, [el("button", { text: "x" })]),
    onMaskClick: () => {
      dismissed = true;
      PopupManager.close();
    },
  });
  const dialog = document.querySelector(".popup-dialog");
  dialog.dispatchEvent(new window.Event("cancel"));
  assert.equal(dismissed, true, "cancel invoked onMaskClick");
  assert.equal(document.querySelector(".popup-dialog"), null, "and it closed");
});

test("confirmDelete gates the danger button until the delete word is typed", () => {
  resetDom();
  let confirmed = false;
  PopupManager.confirmDelete({
    message: "Delete “X”?",
    onConfirm: () => {
      confirmed = true;
    },
  });
  const danger = document.querySelector(".popup-confirm .btn--danger");
  const field = document.querySelector(".popup-confirm-input");
  assert.ok(danger && field, "the gated delete confirm mounted with a field");
  assert.equal(danger.disabled, true, "the danger button starts disabled");

  // A wrong entry keeps it disabled.
  field.value = "nope";
  field.dispatchEvent(new window.Event("input"));
  assert.equal(danger.disabled, true, "a non-matching entry stays gated");

  // The word — matched trimmed and case-insensitively — enables it.
  field.value = "  DELETE ";
  field.dispatchEvent(new window.Event("input"));
  assert.equal(danger.disabled, false, "the word (any case) opens the gate");

  danger.click();
  assert.equal(confirmed, true, "confirm ran once the gate opened");
  assert.equal(document.querySelector(".popup-dialog"), null, "and it closed");
});

test("Enter in the confirm field confirms only once the word matches", () => {
  resetDom();
  let confirmed = 0;
  PopupManager.confirmDelete({
    message: "Delete “X”?",
    onConfirm: () => {
      confirmed += 1;
    },
  });
  const field = document.querySelector(".popup-confirm-input");
  const enter = () =>
    field.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
    );

  field.value = "wrong";
  field.dispatchEvent(new window.Event("input"));
  enter();
  assert.equal(confirmed, 0, "Enter is inert while the word doesn't match");

  field.value = "delete";
  field.dispatchEvent(new window.Event("input"));
  enter();
  assert.equal(confirmed, 1, "Enter confirms once the word matches");
});

test("confirmDelete with an empty requireText is ungated", () => {
  resetDom();
  PopupManager.confirmDelete({
    message: "Delete “X”?",
    requireText: "",
    onConfirm: () => {},
  });
  assert.equal(
    document.querySelector(".popup-confirm-input"),
    null,
    "opting out drops the type-to-confirm field",
  );
  const danger = document.querySelector(".popup-confirm .btn--danger");
  assert.equal(
    danger.disabled,
    false,
    "the danger button is immediately usable",
  );
});
