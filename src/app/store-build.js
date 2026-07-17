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

// store-build.js — single source of truth for "is this a sandboxed store build?".
//
// Jump Hippo ships ONE codebase to every channel: the direct GitHub-release
// builds (DMG/ZIP, NSIS/portable, AppImage/deb) AND the Mac App Store (MAS) and
// Microsoft Store (MSIX/appx) builds. The store builds run under tighter
// sandbox/policy rules, so store-incompatible features gate on the helpers
// below at runtime rather than branching the build.
//
// Electron sets these globals for us — we never set them ourselves:
//   • process.mas          true in a Mac App Store build (sandboxed MAS Electron).
//   • process.windowsStore true in an appx/MSIX build (full-trust Desktop Bridge).
//
// Gate scopes (see also STORE-PUBLISHING.md):
//   • isStoreBuild() — disable the self-updater (both stores deliver their own
//     updates; electron-builder strips the update feed from MAS/appx anyway)
//     and omit the "Check for Updates…" menu item (menu.js).
//   • isMas()        — reserved for macOS-App-Sandbox-only restrictions (none
//     gated yet; the known sandbox caveats — ssh-agent socket, persisted
//     key-file paths, ~/.ssh/known_hosts — degrade gracefully on their own and
//     are documented in STORE-PUBLISHING.md).
"use strict";

/** True in a Mac App Store (sandboxed) build. */
function isMas() {
  return process.mas === true;
}

/** True in a Microsoft Store (appx/MSIX) build. */
function isAppx() {
  return process.windowsStore === true;
}

/** True in any store build (Mac App Store OR Microsoft Store). */
function isStoreBuild() {
  return isMas() || isAppx();
}

/**
 * Distribution flavor, surfaced in diagnostics so a bug report records which
 * channel produced the build.
 * @returns {"store" | "direct"}
 */
function distribution() {
  return isStoreBuild() ? "store" : "direct";
}

module.exports = { isMas, isAppx, isStoreBuild, distribution };
