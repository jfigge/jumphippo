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

// jsdom-setup.js — a fresh DOM per test. The renderer components reference the
// bare globals `window`/`document`/`CustomEvent`, so `resetDom()` installs a new
// jsdom window onto Node's globals (isolating window-level listeners between
// tests) and returns it so the test can attach `window.jumphippo` stubs.

import { JSDOM } from "jsdom";

/**
 * Install a clean jsdom document on the Node globals and return its `window`.
 * Call at the top of every test that mounts a component.
 * @returns {Window}
 */
export function resetDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  global.window = window;
  global.document = window.document;
  // NOTE: `global.navigator` is a read-only getter in modern Node — don't assign
  // it. The components don't need it; jsdom's own window.navigator suffices.
  global.HTMLElement = window.HTMLElement;
  global.Node = window.Node;
  global.Element = window.Element;
  global.Event = window.Event;
  global.CustomEvent = window.CustomEvent;
  global.KeyboardEvent = window.KeyboardEvent;
  global.getComputedStyle = window.getComputedStyle.bind(window);

  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }

  // jsdom (27) doesn't implement the <dialog> modal surface the editor dialogs
  // use. Polyfill just enough of it — showModal/show set `open`; close clears it
  // and fires a `close` event; Escape is simulated by the test dispatching a
  // `cancel` event, which native <dialog> also fires. Production uses the real
  // element in Electron/Chromium.
  const dialogProto = window.HTMLDialogElement
    ? window.HTMLDialogElement.prototype
    : window.HTMLElement.prototype;
  if (!dialogProto.showModal) {
    dialogProto.showModal = function showModal() {
      this.open = true;
      this.setAttribute("open", "");
    };
    dialogProto.show = dialogProto.showModal;
    dialogProto.close = function close(returnValue) {
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.open = false;
      this.removeAttribute("open");
      this.dispatchEvent(new window.Event("close"));
    };
  }
  return window;
}

/** Fire a bubbling `input` event so a component's onInput handler runs. */
export function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new global.Event("input", { bubbles: true }));
}

/** Fire a bubbling `change` event (for <select> / checkbox). */
export function change(control, value) {
  if (value !== undefined) {
    if (control.type === "checkbox") control.checked = value;
    else control.value = value;
  }
  control.dispatchEvent(new global.Event("change", { bubbles: true }));
}
