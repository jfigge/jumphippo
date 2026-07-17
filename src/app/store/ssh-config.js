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
 * ssh-config.js — a dependency-free, read-only parser for the common `~/.ssh/config`
 * subset, plus a mapper that PROPOSES Jump Hippo credentials / jump hosts / tunnel
 * drafts from it (Feature 120). Nothing is written here — the renderer reviews the
 * proposal and the user commits a selection (portable.applySshProposal).
 *
 * Parsed directives (case-insensitive keywords): `Host`, `HostName`, `User`,
 * `Port`, `IdentityFile`, `ProxyJump`, and `Include` (expanded with a depth cap).
 * `Match` blocks are ignored (too dynamic to map statically). We read a key file's
 * PATH only, never its contents; passwords are never invented (a host maps to an
 * agent credential, or a key credential when it names an IdentityFile).
 *
 * Everything is pure: `Include` expansion takes an injected `readInclude`, and `~`
 * expansion an injected `homeDir`, so the whole module is unit-testable against
 * fixtures with no filesystem access.
 */
"use strict";

// A tunnel drafted from an SSH host has no forwarding of its own (an ssh config
// describes how to REACH a server, not a port-forward), so the draft carries a
// suggested local port and a loopback destination placeholder for the user to edit.
const BASE_LOCAL_PORT = 10022;
const DEFAULT_DEST_PORT = 8080;
const DEFAULT_SSH_PORT = 22;
const MAX_INCLUDE_DEPTH = 8;

// Keywords we extract; everything else in a Host block is ignored.
const KNOWN_KEYS = new Set([
  "hostname",
  "user",
  "port",
  "identityfile",
  "proxyjump",
]);

/** Strip a matching pair of surrounding quotes from a value. */
function unquote(v) {
  const s = String(v).trim();
  if (
    s.length >= 2 &&
    (s[0] === '"' || s[0] === "'") &&
    s[s.length - 1] === s[0]
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/** Expand a leading `~` / `~/` to `homeDir`. Absolute + relative paths pass through. */
function expandHome(p, homeDir) {
  if (typeof p !== "string" || !homeDir) return p;
  if (p === "~") return homeDir;
  if (p.startsWith("~/")) return `${homeDir}/${p.slice(2)}`;
  return p;
}

/** True for an SSH `Host` pattern that names a concrete host (no glob / negation). */
function isConcretePattern(pattern) {
  return (
    typeof pattern === "string" && pattern.length > 0 && !/[*?!]/.test(pattern)
  );
}

/**
 * Tokenize SSH-config text into `{ keyword, value }` pairs (keyword lowercased).
 * Full-line comments and blanks are dropped; a `Key Value` or `Key=Value` split is
 * accepted (SSH allows either).
 */
function tokenize(text) {
  const tokens = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.*)$/.exec(line);
    if (!m) continue;
    tokens.push({ keyword: m[1].toLowerCase(), value: m[2].trim() });
  }
  return tokens;
}

/**
 * Flatten SSH-config text into a token stream, expanding `Include` directives via
 * the injected `readInclude(globValue) => string | string[] | null`. Bounded by a
 * depth cap so a self-referential include can't loop forever.
 *
 * @param {string} rootText
 * @param {object} [opts]
 * @param {(value: string) => (string|string[]|null)} [opts.readInclude]
 * @param {number} [opts.maxDepth]
 * @returns {{keyword:string, value:string}[]}
 */
function loadTokens(
  rootText,
  { readInclude, maxDepth = MAX_INCLUDE_DEPTH } = {},
) {
  const out = [];
  const expand = (text, depth) => {
    for (const tok of tokenize(text)) {
      if (tok.keyword === "include") {
        if (depth >= maxDepth || typeof readInclude !== "function") continue;
        let contents;
        try {
          contents = readInclude(tok.value);
        } catch {
          contents = null;
        }
        const arr = Array.isArray(contents) ? contents : [contents];
        for (const c of arr) if (typeof c === "string") expand(c, depth + 1);
      } else {
        out.push(tok);
      }
    }
  };
  expand(rootText, 0);
  return out;
}

/**
 * Parse a flat token stream into Host blocks. `Match` blocks and any global
 * directives before the first `Host` are ignored.
 *
 * @returns {{ patterns: string[], settings: object }[]}
 */
function parseBlocks(tokens) {
  const blocks = [];
  let current = null;
  for (const { keyword, value } of tokens) {
    if (keyword === "host") {
      current = { patterns: value.split(/\s+/).filter(Boolean), settings: {} };
      blocks.push(current);
      continue;
    }
    if (keyword === "match") {
      current = null; // Match is too dynamic to map — skip its block
      continue;
    }
    if (!current || !KNOWN_KEYS.has(keyword)) continue;
    const s = current.settings;
    switch (keyword) {
      case "hostname":
        s.hostName = unquote(value);
        break;
      case "user":
        s.user = unquote(value);
        break;
      case "port": {
        const port = parseInt(value, 10);
        if (Number.isInteger(port)) s.port = port;
        break;
      }
      case "identityfile":
        (s.identityFiles ||= []).push(unquote(value));
        break;
      case "proxyjump":
        s.proxyJump = unquote(value);
        break;
    }
  }
  return blocks;
}

/**
 * Parse SSH-config text into concrete hosts. Each host is the first concrete
 * (non-glob) pattern of a `Host` block plus its resolved settings.
 *
 * @param {string} text
 * @param {object} [opts]  same as {@link loadTokens}
 * @returns {{ hosts: object[] }}
 */
function parseSshConfig(text, opts = {}) {
  const blocks = parseBlocks(loadTokens(text, opts));
  const hosts = [];
  for (const block of blocks) {
    const alias = block.patterns.find(isConcretePattern);
    if (!alias) continue; // a pure wildcard block (e.g. `Host *`) — not a host
    const s = block.settings;
    hosts.push({
      alias,
      hostName: s.hostName || alias,
      user: s.user || "",
      port: Number.isInteger(s.port) ? s.port : undefined,
      identityFile: (s.identityFiles && s.identityFiles[0]) || "",
      proxyJump: s.proxyJump || "",
    });
  }
  return { hosts };
}

/** Parse one ProxyJump hop `[user@]host[:port]`. */
function parseJumpSpec(spec) {
  let rest = spec.trim();
  let user = "";
  const at = rest.lastIndexOf("@");
  if (at !== -1) {
    user = rest.slice(0, at);
    rest = rest.slice(at + 1);
  }
  let port;
  // IPv6 literals aren't supported in this subset; a single ':' is host:port.
  const colon = rest.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(rest.slice(colon + 1))) {
    port = parseInt(rest.slice(colon + 1), 10);
    rest = rest.slice(0, colon);
  }
  return { host: rest, user, port };
}

// A small deterministic temp-id minter (per-kind counters) — so a proposal is a
// pure function of its input (no randomUUID), which keeps it unit-testable.
function tempIds(prefix) {
  let n = 0;
  return () => `${prefix}${(n += 1)}`;
}

/**
 * Map parsed hosts to a proposal of credential / jump-host / tunnel DRAFTS, each
 * linked by a temporary id. Identical credentials (same user + auth + key path)
 * collapse to one; identical jump hosts (same label) collapse to one. Pure.
 *
 * @param {{hosts: object[]}} parsed
 * @param {object} [opts]
 * @param {string} [opts.homeDir]  for `~` expansion of key paths
 * @returns {{ credentials: object[], jumpHosts: object[], tunnels: object[] }}
 */
function toProposal({ hosts } = {}, { homeDir } = {}) {
  const list = Array.isArray(hosts) ? hosts : [];
  const byAlias = new Map(list.map((h) => [h.alias, h]));

  const credentials = [];
  const jumpHosts = [];
  const tunnels = [];
  const nextCred = tempIds("c");
  const nextJump = tempIds("j");
  const nextTun = tempIds("t");

  // Reuse identical credentials / jump hosts across hosts within one proposal.
  const credBySig = new Map();
  const jumpByLabel = new Map();

  const credentialFor = ({ user, hostName, alias, identityFile }) => {
    const keyPath = expandHome(identityFile, homeDir);
    const authType = keyPath ? "key" : "agent";
    const sig = `${authType}|${user}|${keyPath}`;
    if (credBySig.has(sig)) return credBySig.get(sig);
    const who = user || alias || hostName;
    const label = keyPath ? `${who} (${basename(keyPath)})` : `${who} (agent)`;
    const cred = { tempId: nextCred(), label, user, authType };
    if (authType === "key") cred.keyPath = keyPath;
    credentials.push(cred);
    credBySig.set(sig, cred.tempId);
    return cred.tempId;
  };

  const jumpHostFor = (spec) => {
    const { host, user, port } = parseJumpSpec(spec);
    if (!host) return null;
    const def = byAlias.get(host); // resolve against a defined Host block if any
    const hostName = (def && def.hostName) || host;
    const label = host;
    if (jumpByLabel.has(label)) return jumpByLabel.get(label);
    const credentialTempId = credentialFor({
      user: user || (def && def.user) || "",
      hostName,
      alias: host,
      identityFile: (def && def.identityFile) || "",
    });
    const jump = {
      tempId: nextJump(),
      label,
      host: hostName,
      port: port || (def && def.port) || DEFAULT_SSH_PORT,
      credentialTempId,
    };
    jumpHosts.push(jump);
    jumpByLabel.set(label, jump.tempId);
    return jump.tempId;
  };

  list.forEach((h, index) => {
    const credentialTempId = credentialFor({
      user: h.user,
      hostName: h.hostName,
      alias: h.alias,
      identityFile: h.identityFile,
    });
    const jumpHostTempIds = [];
    if (h.proxyJump && h.proxyJump.toLowerCase() !== "none") {
      for (const spec of h.proxyJump.split(",")) {
        const id = jumpHostFor(spec.trim());
        if (id) jumpHostTempIds.push(id);
      }
    }
    tunnels.push({
      tempId: nextTun(),
      name: h.alias,
      type: "local",
      sshHost: h.hostName,
      sshPort: h.port || DEFAULT_SSH_PORT,
      localPort: BASE_LOCAL_PORT + index,
      bindHost: "127.0.0.1",
      destination: { host: "127.0.0.1", port: DEFAULT_DEST_PORT },
      credentialTempId,
      jumpHostTempIds,
    });
  });

  return { credentials, jumpHosts, tunnels };
}

/** Last path segment of a POSIX/Windows path (no `path` dependency — stays pure). */
function basename(p) {
  const parts = String(p).split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/**
 * Parse + map in one call (the shape the IPC layer uses): text in, proposal out.
 *
 * @param {string} text
 * @param {object} [opts]  { readInclude, maxDepth, homeDir }
 * @returns {{ credentials: object[], jumpHosts: object[], tunnels: object[] }}
 */
function proposeFromConfig(text, opts = {}) {
  return toProposal(parseSshConfig(text, opts), opts);
}

module.exports = {
  parseSshConfig,
  toProposal,
  proposeFromConfig,
  // Exposed for the IPC include-reader and focused unit tests.
  tokenize,
  loadTokens,
  parseJumpSpec,
  expandHome,
};
