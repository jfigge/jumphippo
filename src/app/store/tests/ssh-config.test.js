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

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sshConfig = require("../ssh-config");
const portable = require("../portable");
const { Stores } = require("../stores");

const CONFIG = `
# A sample ~/.ssh/config
Host *
  ServerAliveInterval 60

Host prod
  HostName prod.example.com
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_prod
  ProxyJump bastion

Host bastion
  HostName bastion.example.com
  User jump
  IdentityFile ~/.ssh/id_jump

Host web
  Hostname web.example.com
  User admin
`;

test("parses Host/HostName/User/Port/IdentityFile/ProxyJump, skipping wildcards", () => {
  const { hosts } = sshConfig.parseSshConfig(CONFIG, { homeDir: "/home/me" });
  const aliases = hosts.map((h) => h.alias).sort();
  assert.deepEqual(
    aliases,
    ["bastion", "prod", "web"],
    "the `Host *` block is skipped",
  );

  const prod = hosts.find((h) => h.alias === "prod");
  assert.equal(prod.hostName, "prod.example.com");
  assert.equal(prod.user, "deploy");
  assert.equal(prod.port, 2222);
  assert.equal(prod.identityFile, "~/.ssh/id_prod");
  assert.equal(prod.proxyJump, "bastion");
});

test("maps to a credential / jump-host / tunnel proposal, expanding ~ and ProxyJump", () => {
  const proposal = sshConfig.proposeFromConfig(CONFIG, { homeDir: "/home/me" });

  // prod's tunnel references a key credential (expanded key path) and the bastion.
  const prodTun = proposal.tunnels.find((t) => t.name === "prod");
  assert.equal(prodTun.sshHost, "prod.example.com");
  assert.equal(prodTun.sshPort, 2222);
  assert.equal(prodTun.jumpHostTempIds.length, 1);

  const prodCred = proposal.credentials.find(
    (c) => c.tempId === prodTun.credentialTempId,
  );
  assert.equal(prodCred.authType, "key");
  assert.equal(prodCred.keyPath, "/home/me/.ssh/id_prod");

  // The ProxyJump resolved against the `Host bastion` block (its HostName/User/key).
  const jump = proposal.jumpHosts.find(
    (j) => j.tempId === prodTun.jumpHostTempIds[0],
  );
  assert.equal(jump.host, "bastion.example.com");
  const jumpCred = proposal.credentials.find(
    (c) => c.tempId === jump.credentialTempId,
  );
  assert.equal(jumpCred.authType, "key");
  assert.equal(jumpCred.keyPath, "/home/me/.ssh/id_jump");

  // web has no key → an agent credential; no proxy → no jump hosts.
  const webTun = proposal.tunnels.find((t) => t.name === "web");
  const webCred = proposal.credentials.find(
    (c) => c.tempId === webTun.credentialTempId,
  );
  assert.equal(webCred.authType, "agent");
  assert.equal(webTun.jumpHostTempIds.length, 0);

  // Every drafted tunnel is a valid, armable tunnel (a suggested port + placeholder).
  for (const t of proposal.tunnels) {
    assert.ok(Number.isInteger(t.localPort) && t.localPort > 0);
    assert.ok(t.destination && Number.isInteger(t.destination.port));
  }
});

test("Include is expanded (with a depth cap) via the injected reader", () => {
  const root = `
Host main
  HostName main.example.com
Include extra
`;
  const included = `
Host inc
  HostName inc.example.com
  User u
`;
  const { hosts } = sshConfig.parseSshConfig(root, {
    readInclude: (value) => (value === "extra" ? included : null),
  });
  assert.deepEqual(hosts.map((h) => h.alias).sort(), ["inc", "main"]);
});

test("a self-referential Include can't loop forever", () => {
  const root = `Host a\n  HostName a\nInclude self`;
  // readInclude always returns text that includes itself again.
  const { hosts } = sshConfig.parseSshConfig(root, {
    readInclude: () => `Host b\n  HostName b\nInclude self`,
    maxDepth: 3,
  });
  // It terminates and yields the hosts it saw before the cap.
  assert.ok(hosts.some((h) => h.alias === "a"));
  assert.ok(hosts.some((h) => h.alias === "b"));
});

test("parseJumpSpec handles [user@]host[:port]", () => {
  assert.deepEqual(sshConfig.parseJumpSpec("bastion"), {
    host: "bastion",
    user: "",
    port: undefined,
  });
  assert.deepEqual(sshConfig.parseJumpSpec("jane@relay:2200"), {
    host: "relay",
    user: "jane",
    port: 2200,
  });
});

test("committing a selected subset writes only those hosts + their dependencies", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jumphippo-sshimport-"));
  try {
    const stores = new Stores(dir);
    const proposal = sshConfig.proposeFromConfig(CONFIG, {
      homeDir: "/home/me",
    });
    const prodTun = proposal.tunnels.find((t) => t.name === "prod");

    // Commit only "prod" — it should pull in its credential + the bastion jump host.
    const res = portable.applySshProposal(stores, {
      proposal,
      selected: [prodTun.tempId],
    });
    assert.ok(res.ok);
    assert.equal(res.created.tunnels, 1);
    assert.equal(res.created.jumpHosts, 1, "the bastion dependency is created");
    assert.equal(res.created.credentials, 2, "prod's key + the bastion's key");

    const tunnels = stores.tunnelStore().list();
    assert.equal(tunnels.length, 1);
    assert.equal(tunnels[0].name, "prod");
    // References resolve to the created records.
    const cred = stores.credentialStore().get(tunnels[0].credentialId);
    assert.equal(cred.authType, "key");
    const jump = stores.jumpHostStore().get(tunnels[0].jumpHostIds[0]);
    assert.equal(jump.host, "bastion.example.com");

    // "web" was not selected, so it wasn't written.
    assert.ok(!tunnels.some((t) => t.name === "web"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
