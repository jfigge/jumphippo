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

// main.js — Electron main process for Port Hippo.
//
// This is the Feature 00 scaffold: it creates a single window hosting the empty
// Definition / Monitoring two-view shell and exposes the minimal IPC seam
// (app:version) that later features extend. All native I/O — sockets, SSH,
// filesystem — will live in this process; the renderer talks to it only through
// the window.porthippo bridge in preload.js.
"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const { parseArgs } = require("./cli-args");

const { dev: isDev, hotReload: isHotReload } = parseArgs(process.argv);

// Resolve the app's own version. In a packaged build app.getVersion() returns
// the productName version, but when running unpackaged (make debug) it falls
// back to Electron's version — so prefer the package.json value and fall back
// to app.getVersion() only if that read ever fails.
function resolveAppVersion() {
  try {
    return require("../package.json").version;
  } catch {
    return app.getVersion();
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
// Keep every ipcMain.handle channel mirrored by a preload.js export (lockstep).
// Feature 10 adds an automated parity test once there are channels worth
// checking; for now the single round-trip proves the bridge works end-to-end.
function registerIpc() {
  const version = resolveAppVersion();
  ipcMain.handle("app:version", () => version);
}

// ─── Hot reload (dev only) ────────────────────────────────────────────────────
// Under `make debug` (--hot-reload) watch the renderer tree and reload the
// window on change. Deliberately dependency-free (fs.watch) — no chokidar.
function installHotReload(win) {
  const webDir = path.join(__dirname, "..", "web");
  let timer = null;
  try {
    fs.watch(webDir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
      }, 120);
    });
  } catch (err) {
    // Non-fatal: recursive watch is unsupported on some platforms.
    console.error("[main] hot-reload watcher failed:", err && err.message);
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#1e1e2e",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // renderer cannot touch Node directly
      nodeIntegration: false, // keep Node out of the renderer
      sandbox: true, // extra process isolation
    },
  });

  win.loadFile(path.join(__dirname, "..", "web", "index.html"));

  win.once("ready-to-show", () => win.show());

  if (isDev || isHotReload) {
    win.webContents.openDevTools({ mode: "detach" });
  }
  if (isHotReload) {
    installHotReload(win);
  }

  return win;
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Feature 60 makes Port Hippo a background/tray app that keeps tunnels alive
  // when the window closes. For the scaffold, follow the standard convention:
  // quit on all-windows-closed except on macOS.
  if (process.platform !== "darwin") app.quit();
});
