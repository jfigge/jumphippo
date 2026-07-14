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

// icons.js — a tiny set of Feather-style inline SVG icons as static markup
// strings, used with `el("button", { html: icon.edit() })`. The markup is a
// fixed constant (never user data), so innerHTML use is XSS-safe. 16×16 on a 24
// viewBox, stroking currentColor so they inherit the button's colour.

function stroke(paths) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
  );
}

function fill(paths) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" ` +
    `viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${paths}</svg>`
  );
}

export const icons = {
  add: () =>
    stroke(
      '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    ),
  edit: () =>
    stroke(
      '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    ),
  delete: () =>
    stroke(
      '<polyline points="3 6 5 6 21 6"/>' +
        '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    ),
  power: () =>
    stroke(
      '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
    ),
  pause: () =>
    fill(
      '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    ),
  play: () => fill('<polygon points="6 4 20 12 6 20 6 4"/>'),
  chevronDown: () => stroke('<polyline points="6 9 12 15 18 9"/>'),
};
