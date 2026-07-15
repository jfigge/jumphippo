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

/**
 * ipc/portable.js — import / export IPC (Feature 120). All bundle building,
 * crypto, SSH-config parsing and store writes happen in main behind these
 * channels; the renderer only picks files (via the native dialogs opened here) and
 * reviews the proposed diff.
 *
 *   portable:export   ({ includeSettings, secretMode, passphrase? }) → save dialog,
 *                      build a `.porthippo` bundle, write it. → { ok, path } | { canceled }
 *   portable:preview  () → open dialog, parse the chosen bundle, return the
 *                      add/update/conflict diff → { ok, path, ... } | { canceled }
 *   portable:import   ({ path, mode, passphrase? }) → re-read + apply → { ok, counts }
 *   sshconfig:scan    () → open dialog (default ~/.ssh/config), parse → { proposal } | { canceled }
 *   sshconfig:import  ({ proposal, selected }) → commit the selection → { ok, created }
 *
 * A successful bundle/ssh-config import reconciles the engine so every affected
 * tunnel re-reads its (possibly new) definition. No decrypted secret ever crosses
 * this boundary: export unseals+re-seals in main, import re-seals in main, and a
 * bundle's only secret form is the portable `encp:` envelope.
 *
 * Every channel registered here MUST have a matching `window.porthippo.*` exposure
 * in preload.js AND this file must be listed in the ipc-parity test's scan set
 * (tests/ipc-parity.test.js) — the guard fails the build otherwise.
 *
 * @param {object} deps
 * @param {Electron.IpcMain} deps.ipcMain
 * @param {() => import('../store/stores').Stores} deps.getStores
 * @param {() => import('../tunnel/engine').TunnelEngine|null} deps.getEngine
 * @param {Electron.Dialog} deps.dialog
 * @param {() => Electron.BrowserWindow | null} [deps.getMainWindow]
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { wrap } = require("./wrap");
const portable = require("../store/portable");
const sshConfig = require("../store/ssh-config");
const { readDoc } = require("../store/definitions-doc");

const BUNDLE_EXT = "porthippo";
const DEFAULT_BUNDLE_NAME = "porthippo-backup.porthippo";

function registerPortableIPC({
  ipcMain,
  getStores,
  getEngine,
  dialog,
  getMainWindow,
}) {
  const parent = () => getMainWindow?.() ?? undefined;

  // Reconcile every tunnel after an import changed the stored definitions.
  const reconcile = () => {
    try {
      const pending = getEngine()?.reconcileAll?.();
      if (pending && typeof pending.catch === "function") {
        pending.catch((err) =>
          console.error("[ipc] portable reconcile failed:", err && err.message),
        );
      }
    } catch (err) {
      console.error("[ipc] portable reconcile failed:", err && err.message);
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────
  ipcMain.handle(
    "portable:export",
    wrap("portable:export", async (opts = {}) => {
      const result = await dialog.showSaveDialog(parent(), {
        title: "Export Port Hippo bundle",
        defaultPath: DEFAULT_BUNDLE_NAME,
        filters: [{ name: "Port Hippo bundle", extensions: [BUNDLE_EXT] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };

      const bundle = portable.buildBundle(getStores(), {
        includeSettings: Boolean(opts.includeSettings),
        secretMode: opts.secretMode === "encp" ? "encp" : "stripped",
        passphrase: opts.passphrase,
      });
      // A user-chosen path OUTSIDE the store dir — write plain JSON (no schema
      // stamping) and never a temp/atomic dance the store's io layer would apply.
      fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2));
      return { ok: true, path: result.filePath };
    }),
  );

  // ── Import preview ──────────────────────────────────────────────────────────
  ipcMain.handle(
    "portable:preview",
    wrap("portable:preview", async () => {
      const result = await dialog.showOpenDialog(parent(), {
        title: "Import Port Hippo bundle",
        properties: ["openFile"],
        filters: [
          { name: "Port Hippo bundle", extensions: [BUNDLE_EXT] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const filePath = result.filePaths[0];
      const bundle = readBundle(filePath);
      if (!bundle) return { ok: false, error: "unreadable", path: filePath };
      const preview = portable.previewBundle(
        bundle,
        readDoc(getStores().paths()),
      );
      return { ...preview, path: filePath };
    }),
  );

  // ── Import apply ────────────────────────────────────────────────────────────
  ipcMain.handle(
    "portable:import",
    wrap("portable:import", ({ path: filePath, mode, passphrase } = {}) => {
      const bundle = readBundle(filePath);
      if (!bundle) {
        const err = new Error("bundle could not be read");
        err.code = "INVALID_BUNDLE";
        throw err;
      }
      const res = portable.applyBundle(getStores(), bundle, {
        mode: mode === "replace" ? "replace" : "merge",
        passphrase,
      });
      reconcile();
      return res;
    }),
  );

  // ── SSH-config scan ─────────────────────────────────────────────────────────
  ipcMain.handle(
    "sshconfig:scan",
    wrap("sshconfig:scan", async () => {
      const sshDir = path.join(os.homedir(), ".ssh");
      const result = await dialog.showOpenDialog(parent(), {
        title: "Import from SSH config",
        defaultPath: path.join(sshDir, "config"),
        properties: ["openFile", "showHiddenFiles"],
        filters: [{ name: "All files", extensions: ["*"] }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const filePath = result.filePaths[0];
      let text;
      try {
        text = fs.readFileSync(filePath, "utf8");
      } catch {
        return { ok: false, error: "unreadable", path: filePath };
      }
      const proposal = sshConfig.proposeFromConfig(text, {
        homeDir: os.homedir(),
        readInclude: makeIncludeReader(),
      });
      return { ok: true, path: filePath, proposal };
    }),
  );

  // ── SSH-config import ───────────────────────────────────────────────────────
  ipcMain.handle(
    "sshconfig:import",
    wrap("sshconfig:import", ({ proposal, selected } = {}) => {
      const res = portable.applySshProposal(getStores(), {
        proposal,
        selected,
      });
      reconcile();
      return res;
    }),
  );
}

/** Read + JSON-parse a bundle file, or null if unreadable / not JSON. */
function readBundle(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Build the `Include` reader for ssh-config.js: resolve an include value (absolute,
 * `~`, or relative to ~/.ssh per ssh_config) and read the matching file(s),
 * expanding a trailing `*` glob. Returns each file's contents; unreadable paths are
 * skipped. Reads only whole config files — never a key's contents.
 */
function makeIncludeReader() {
  const home = os.homedir();
  const sshDir = path.join(home, ".ssh");
  return (value) => {
    let spec = value;
    if (spec.startsWith("~/")) spec = path.join(home, spec.slice(2));
    else if (!path.isAbsolute(spec)) spec = path.join(sshDir, spec);

    const dir = path.dirname(spec);
    const pattern = path.basename(spec);
    const out = [];
    try {
      if (pattern.includes("*")) {
        const re = new RegExp(
          "^" +
            pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
            "$",
        );
        for (const name of fs.readdirSync(dir)) {
          if (re.test(name)) {
            try {
              out.push(fs.readFileSync(path.join(dir, name), "utf8"));
            } catch {
              /* skip an unreadable include */
            }
          }
        }
      } else {
        out.push(fs.readFileSync(spec, "utf8"));
      }
    } catch {
      /* missing include dir / file — ignore (best-effort, like ssh) */
    }
    return out;
  };
}

module.exports = { registerPortableIPC };
