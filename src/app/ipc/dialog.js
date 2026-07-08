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
 * ipc/dialog.js — native file-dialog IPC.
 *
 * The renderer is sandboxed and can't read a typed filesystem path, so the
 * Definition view's auth editor asks the main process to open a native picker for
 * a private-key file. Only the chosen absolute path crosses back — never file
 * bytes (the engine reads the key itself at connect time, Feature 20).
 *
 * Every channel registered here MUST have a matching `window.porthippo.*`
 * exposure in preload.js AND this file must be listed in the ipc-parity test's
 * scan set (tests/ipc-parity.test.js) — the guard fails the build otherwise.
 *
 * @param {object} deps
 * @param {Electron.IpcMain} deps.ipcMain
 * @param {Electron.Dialog} deps.dialog
 * @param {() => Electron.BrowserWindow | null} [deps.getMainWindow]  parent window
 *        for the modal dialog (falls back to a detached dialog when absent).
 */
function registerDialogIPC({ ipcMain, dialog, getMainWindow }) {
  ipcMain.handle("dialog:open-key-file", async () => {
    const parent = getMainWindow?.() ?? undefined;
    const result = await dialog.showOpenDialog(parent, {
      title: "Select SSH private key",
      properties: ["openFile", "showHiddenFiles"],
      filters: [
        { name: "Private keys", extensions: ["pem", "key", "ppk", "pub"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}

module.exports = { registerDialogIPC };
