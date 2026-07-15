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

import { resetDom, change } from "./jsdom-setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ImportExportDialog } from "../components/import-export-dialog.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(io = {}) {
  resetDom();
  const calls = { export: [], importBundle: [], importSshConfig: [] };
  const porthippo = {
    io: {
      export: async (o) => (
        calls.export.push(o),
        { ok: true, path: "/b.porthippo" }
      ),
      previewBundle: async () => io.preview,
      importBundle: async (o) => (calls.importBundle.push(o), { ok: true }),
      scanSshConfig: async () => io.scan,
      importSshConfig: async (o) => (
        calls.importSshConfig.push(o),
        { ok: true, created: { tunnels: (o.selected || []).length } }
      ),
      ...io.overrides,
    },
  };
  return { dlg: new ImportExportDialog({ porthippo }), calls };
}

const q = (dlg, sel) => dlg.element.querySelector(sel);
const primary = (dlg) =>
  dlg.element.querySelector(".dialog-footer .btn--primary");

// Check a radio and fire its change event (the shared change() helper only knows
// checkboxes; a radio needs `.checked`, not `.value`).
function pickRadio(radio) {
  radio.checked = true;
  radio.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("export: choosing a passphrase reveals the passphrase fields", () => {
  const { dlg } = mount();
  dlg.openExport();
  assert.ok(dlg.element.open);
  assert.ok(
    q(dlg, ".impexp-passphrase").hidden,
    "hidden for the stripped default",
  );
  pickRadio(q(dlg, 'input[value="encp"]'));
  assert.equal(q(dlg, ".impexp-passphrase").hidden, false, "shown for encp");
});

test("export: mismatched passphrases block the export", async () => {
  const { dlg, calls } = mount();
  dlg.openExport();
  pickRadio(q(dlg, 'input[value="encp"]'));
  const [p1, p2] = dlg.element.querySelectorAll(".impexp-passphrase input");
  p1.value = "one";
  p2.value = "two";
  primary(dlg).click();
  await flush();
  assert.equal(calls.export.length, 0, "no export on mismatch");
  assert.equal(q(dlg, ".dialog-error").hidden, false, "an error is shown");
});

test("export: the stripped default sends secretMode stripped", async () => {
  const { dlg, calls } = mount();
  dlg.openExport();
  primary(dlg).click();
  await flush();
  assert.equal(calls.export.length, 1);
  assert.equal(calls.export[0].secretMode, "stripped");
});

test("import: the diff summary renders and Import applies the chosen mode", async () => {
  const { dlg, calls } = mount({
    preview: {
      ok: true,
      path: "/backup.porthippo",
      needsPassphrase: false,
      counts: {
        tunnels: { add: 2, update: 0, conflict: 1 },
        credentials: { add: 1, update: 0, conflict: 0 },
        jumpHosts: { add: 0, update: 0, conflict: 0 },
      },
    },
  });

  let imported = false;
  window.addEventListener("porthippo:data-imported", () => (imported = true));

  await dlg.startImport();
  await flush();
  assert.ok(dlg.element.open, "the preview dialog opened");
  // Two record sections have a non-zero total (tunnels, credentials).
  assert.equal(dlg.element.querySelectorAll(".impexp-diff-row").length, 2);

  // Switch to Replace, then import.
  pickRadio(q(dlg, 'input[value="replace"]'));
  primary(dlg).click();
  await flush();
  assert.equal(calls.importBundle.length, 1);
  assert.equal(calls.importBundle[0].mode, "replace");
  assert.equal(calls.importBundle[0].path, "/backup.porthippo");
  assert.ok(imported, "a data-imported event fires so views reload");
});

test("ssh import: hosts render as checkboxes and only ticked ones commit", async () => {
  const { dlg, calls } = mount({
    scan: {
      ok: true,
      path: "/home/me/.ssh/config",
      proposal: {
        credentials: [
          { tempId: "c1", label: "deploy (agent)", authType: "agent" },
        ],
        jumpHosts: [],
        tunnels: [
          {
            tempId: "t1",
            name: "prod",
            sshHost: "prod.example.com",
            jumpHostTempIds: [],
          },
          {
            tempId: "t2",
            name: "web",
            sshHost: "web.example.com",
            jumpHostTempIds: [],
          },
        ],
      },
    },
  });

  await dlg.startSshImport();
  await flush();
  const boxes = dlg.element.querySelectorAll(
    ".impexp-host-item input[type=checkbox]",
  );
  assert.equal(boxes.length, 2);

  // Untick "web" (the second host), then import.
  change(boxes[1], false);
  primary(dlg).click();
  await flush();
  assert.equal(calls.importSshConfig.length, 1);
  assert.deepEqual(
    calls.importSshConfig[0].selected,
    ["t1"],
    "only 'prod' committed",
  );
});
