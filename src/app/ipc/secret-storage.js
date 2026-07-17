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
 * ipc/secret-storage.js — Feature 90 selectable-secret-storage IPC.
 *
 * The renderer's Settings → Security tab drives the at-rest backend through four
 * channels; all crypto, keychain access and re-encryption happen behind
 * `getStores().secretStorage()` (the store layer) — this module is thin
 * delegation plus the two side-effects a mode/lock change needs that the store
 * layer stays out of: reconciling the live tunnel engine and telling every
 * renderer to refresh.
 *
 *   secret-storage:get-mode  → { mode, locked, available, hasPassword }
 *   secret-storage:set-mode  ({ mode, password? }) → { ok, reason?, failures? }
 *   secret-storage:unlock    ({ password })        → { ok, reason? }
 *   secret-storage:lock                            → { ok }
 *
 * On a successful unlock or mode switch the engine is asked to `reconcileAll()`
 * so tunnels that armed while a secret was undecryptable (a locked master key)
 * pick up the now-decryptable definition and can (re)connect, and a one-way
 * `jumphippo:secret-storage-changed` broadcast lets the UI reflect the new
 * mode/lock status. A successful unlock additionally fires the optional
 * `onUnlock` hook, which main uses to run any startup arming it DEFERRED because
 * the store booted locked (the unlock-on-launch prompt). Reason codes are
 * machine-readable only; a secret never crosses this boundary.
 *
 * Every channel registered here MUST have a matching `window.jumphippo.*`
 * exposure in preload.js AND this file must be listed in the ipc-parity test's
 * scan set (tests/ipc-parity.test.js) — the guard fails the build otherwise.
 *
 * @param {object} deps
 * @param {Electron.IpcMain} deps.ipcMain
 * @param {() => import('../store/stores').Stores} deps.getStores
 * @param {() => import('../tunnel/engine').TunnelEngine|null} deps.getEngine
 * @param {(channel: string, payload: object) => void} deps.broadcast
 * @param {(channel: string, fn: Function, fallback?: any) => any} deps.safeCall
 * @param {() => void} [deps.onUnlock]  fired after a successful unlock (main runs
 *        any startup arming it deferred while the store booted locked)
 */
function registerSecretStorageIPC({
  ipcMain,
  getStores,
  getEngine,
  broadcast,
  safeCall,
  onUnlock,
}) {
  const state = () =>
    safeCall(
      "secret-storage:state",
      () => getStores().secretStorage().getState(),
      {
        mode: "app-key",
        locked: false,
        available: false,
        hasPassword: false,
      },
    );

  // Announce a mode/lock change: proactively reconcile the engine (so enabled
  // tunnels can connect with the new key state) then refresh every renderer.
  const announce = ({ reconcile }) => {
    if (reconcile) {
      try {
        const pending = getEngine()?.reconcileAll?.();
        if (pending && typeof pending.catch === "function") {
          pending.catch((err) =>
            console.error(
              "[ipc] secret-storage reconcile failed:",
              err && err.message,
            ),
          );
        }
      } catch (err) {
        console.error(
          "[ipc] secret-storage reconcile failed:",
          err && err.message,
        );
      }
    }
    broadcast?.("jumphippo:secret-storage-changed", state());
  };

  ipcMain.handle("secret-storage:get-mode", () => state());

  ipcMain.handle(
    "secret-storage:set-mode",
    (_event, { mode, password } = {}) => {
      const res = safeCall(
        "secret-storage:set-mode",
        () => getStores().secretStorage().setMode(mode, password),
        { ok: false, reason: "error" },
      );
      if (res && res.ok && !res.unchanged) announce({ reconcile: true });
      return res;
    },
  );

  ipcMain.handle("secret-storage:unlock", (_event, { password } = {}) => {
    const res = safeCall(
      "secret-storage:unlock",
      () => getStores().secretStorage().unlock(password),
      { ok: false, reason: "error" },
    );
    if (res && res.ok) {
      announce({ reconcile: true });
      // Resume any launch arming main deferred while the store was locked.
      try {
        onUnlock?.();
      } catch (err) {
        console.error(
          "[ipc] secret-storage onUnlock failed:",
          err && err.message,
        );
      }
    }
    return res;
  });

  ipcMain.handle("secret-storage:lock", () => {
    const res = safeCall(
      "secret-storage:lock",
      () => getStores().secretStorage().lock(),
      { ok: false },
    );
    // Locking can't enable new connections, so no reconcile — just refresh the UI.
    if (res && res.ok) announce({ reconcile: false });
    return res;
  });
}

module.exports = { registerSecretStorageIPC };
