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

// build-info.js — the store-build capability map for the renderer.
//
// The sandboxed renderer can't read Electron's process.mas / process.windowsStore
// globals, so main hands it a capability map over IPC (app:capabilities →
// window.jumphippo.build.info). `init()` fetches it once at startup (awaited in
// app.js BEFORE any dialog/panel is built); `can(feature)` reads the cache
// synchronously thereafter, so UI code needn't be async.
//
// Fails OPEN: if the fetch fails or a key is missing, the feature is treated as
// available, so a broken bridge (or a stale key) can never hide a feature in a
// normal direct build. Only an explicit `false` from main disables one — which
// only a genuine store build sends. See src/app/store-build.js → capabilities().

/** Every capability defaults to available (true) until main says otherwise. */
const DEFAULTS = Object.freeze({
  sshAgentAuth: true,
  launchAtLogin: true,
  sshConfigDefaultPath: true,
  selfUpdate: true,
});

let capabilities = { ...DEFAULTS };
let flavor = "direct";

/**
 * Fetch the build's capability map once and cache it. Non-fatal on any error —
 * the DEFAULTS (everything enabled) stand, so a direct build is never degraded.
 *
 * @param {object} [bridge]  the IPC bridge (defaults to window.jumphippo)
 */
export async function init(bridge = globalThis.window?.jumphippo) {
  try {
    const info = await bridge?.build?.info?.();
    if (info && typeof info === "object") {
      flavor = info.distribution === "store" ? "store" : "direct";
      capabilities = { ...DEFAULTS, ...(info.capabilities || {}) };
    }
  } catch {
    // Fail open: keep DEFAULTS so a broken bridge never hides a feature.
  }
}

/**
 * True when THIS build supports `feature`. Unknown features (and everything
 * before init resolves) default to available.
 * @param {keyof typeof DEFAULTS | string} feature
 * @returns {boolean}
 */
export function can(feature) {
  return capabilities[feature] !== false;
}

/** The distribution flavor of this build: "store" or "direct". */
export function distribution() {
  return flavor;
}
