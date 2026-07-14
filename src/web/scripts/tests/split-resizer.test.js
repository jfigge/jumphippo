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

// split-resizer.test.js — the draggable divider between the tunnel list and the
// detail cards: it writes --split-left, clamps so the left ≥ minLeft and the
// right ≥ minRight, commits the chosen width (drag end / keyboard) but not on a
// passive restore, and re-clamps on a window resize without losing the picked
// width.

import test from "node:test";
import assert from "node:assert/strict";

import { resetDom } from "./jsdom-setup.js";
import { SplitResizer } from "../components/split-resizer.js";

// jsdom does no layout, so fake the geometry the resizer measures.
function mount(containerWidth = 1000) {
  const window = resetDom();
  const container = window.document.createElement("div");
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: containerWidth,
  });
  container.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: containerWidth,
  });
  window.document.body.appendChild(container);

  const committed = [];
  const resizer = new SplitResizer({
    container,
    minLeft: 150,
    minRight: 300,
    label: "Resize",
    onCommit: (px) => committed.push(px),
  });
  Object.defineProperty(resizer.element, "offsetWidth", {
    configurable: true,
    value: 6,
  });
  container.appendChild(resizer.element);
  return { window, container, resizer, committed };
}

const leftVar = (container) => container.style.getPropertyValue("--split-left");

test("setLeft applies the width to --split-left without committing", () => {
  const { container, resizer, committed } = mount(1000);
  resizer.setLeft(300);
  assert.equal(leftVar(container), "300px");
  assert.equal(committed.length, 0, "restoring a value is not a user commit");
});

test("setLeft clamps below minLeft up to 150", () => {
  const { container, resizer } = mount(1000);
  resizer.setLeft(50);
  assert.equal(leftVar(container), "150px");
});

test("setLeft clamps so the right pane keeps minRight (max = width - divider - 300)", () => {
  const { container, resizer } = mount(1000);
  // maxLeft = 1000 - 6 - 300 = 694.
  resizer.setLeft(900);
  assert.equal(leftVar(container), "694px");
});

test("keyboard ArrowRight/ArrowLeft nudge and commit the width", () => {
  const { window, container, resizer, committed } = mount(1000);
  resizer.setLeft(300);

  resizer.element.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowRight" }),
  );
  assert.equal(leftVar(container), "310px");
  assert.deepEqual(committed, [310]);

  resizer.element.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true }),
  );
  assert.equal(leftVar(container), "270px"); // shift → 40px step
  assert.deepEqual(committed, [310, 270]);
});

test("a pointer drag updates the width live and commits once on release", () => {
  const { window, container, resizer, committed } = mount(1000);
  resizer.setLeft(240);

  const down = new window.Event("pointerdown");
  down.button = 0;
  down.pointerId = 1;
  resizer.element.dispatchEvent(down);

  const move = new window.Event("pointermove");
  move.clientX = 420;
  resizer.element.dispatchEvent(move);
  assert.equal(leftVar(container), "420px");
  assert.equal(committed.length, 0, "no commit mid-drag");

  const up = new window.Event("pointerup");
  resizer.element.dispatchEvent(up);
  assert.deepEqual(committed, [420]);
});

test("a drag past the max is clamped to keep the right pane's minimum", () => {
  const { window, container, resizer, committed } = mount(1000);
  resizer.setLeft(240);

  const down = new window.Event("pointerdown");
  down.button = 0;
  down.pointerId = 1;
  resizer.element.dispatchEvent(down);
  const move = new window.Event("pointermove");
  move.clientX = 950; // beyond maxLeft (694)
  resizer.element.dispatchEvent(move);
  const up = new window.Event("pointerup");
  resizer.element.dispatchEvent(up);

  assert.equal(leftVar(container), "694px");
  assert.deepEqual(committed, [694]);
});

test("a window resize re-clamps the applied width but preserves the preference", () => {
  const { window, container, resizer } = mount(1000);
  resizer.setLeft(600); // fits at width 1000 (max 694)

  // Shrink the container so 600 no longer leaves room for the right pane.
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: 700,
  });
  window.dispatchEvent(new window.Event("resize"));
  // maxLeft = 700 - 6 - 300 = 394 → clamped down.
  assert.equal(leftVar(container), "394px");

  // Grow back: the original 600 preference is restored, not the clamped 394.
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: 1000,
  });
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(leftVar(container), "600px");
});
