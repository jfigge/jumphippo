// seed.mjs — Generate a clean, secret-free demo dataset for documentation
// screenshots. Writes the single definitions document (tunnels.json) and
// settings.json into an Electron user-data dir (default: ../data-docs — a
// DEDICATED dir so the real dev `data/` is never touched). Re-runnable /
// idempotent (fixed UUIDs).
//
//   node .docs-build/seed.mjs             # seeds ../data-docs
//   node .docs-build/seed.mjs /some/dir   # seeds an explicit data dir
//
// Every credential uses `agent` or `key` auth, so NO secret is ever stored —
// the dataset is safe to keep locally and the app boots in the promptless
// device-app-key mode with nothing to decrypt.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = process.argv[2] || join(ROOT, "data-docs");

// ── Deterministic IDs ─────────────────────────────────────────────────────────
const tid = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CRED_DEPLOY = "c0000000-0000-4000-8000-000000000001";
const CRED_ADMIN = "c0000000-0000-4000-8000-000000000002";
const JUMP_BASTION = "50000000-0000-4000-8000-000000000001";
const GRP_WORK = "60000000-0000-4000-8000-000000000001";
const GRP_HOME = "60000000-0000-4000-8000-000000000002";

// ── Reusable records (no secrets) ─────────────────────────────────────────────
const credentials = [
  { id: CRED_DEPLOY, label: "deploy (agent)", user: "deploy", authType: "agent" },
  {
    id: CRED_ADMIN,
    label: "admin key",
    user: "admin",
    authType: "key",
    keyPath: "~/.ssh/id_ed25519",
  },
];

const jumpHosts = [
  {
    id: JUMP_BASTION,
    label: "bastion",
    host: "bastion.example.com",
    port: 22,
    credentialId: CRED_DEPLOY,
  },
];

const groups = [
  { id: GRP_WORK, label: "Work", color: "blue" },
  { id: GRP_HOME, label: "Home lab", color: "green" },
];

// ── Tunnel template ───────────────────────────────────────────────────────────
// A reference-shape tunnel (Feature 45+): references a credential + jump hosts
// by id, carries no secret. `entryAddress` / `exitAddress` are the verbatim
// strings the editor round-trips for the three address fields.
function tunnel(o) {
  const t = {
    id: o.id,
    name: o.name,
    type: o.type ?? "local",
    enabled: o.enabled ?? true,
    keepAlive: o.keepAlive ?? false,
    autoReconnect: o.autoReconnect ?? false,
    credentialId: o.credentialId ?? CRED_DEPLOY,
    jumpHostIds: o.jumpHostIds ?? [],
    sshHost: o.sshHost,
  };
  if (o.sshPort !== undefined) t.sshPort = o.sshPort;
  if (o.localPort !== undefined) t.localPort = o.localPort;
  if (o.destination !== undefined) t.destination = o.destination;
  if (o.remoteBind !== undefined) t.remoteBind = o.remoteBind;
  if (o.lingerMs !== undefined) t.lingerMs = o.lingerMs;
  if (o.entryAddress !== undefined) t.entryAddress = o.entryAddress;
  if (o.exitAddress !== undefined) t.exitAddress = o.exitAddress;
  if (o.groupId !== undefined) t.groupId = o.groupId;
  return t;
}

const tunnels = [
  tunnel({
    id: tid(1),
    name: "Prod database",
    localPort: 5432,
    sshHost: "bastion.example.com",
    destination: { host: "db.internal", port: 5432 },
    entryAddress: "5432",
    exitAddress: "db.internal:5432",
    groupId: GRP_WORK,
  }),
  tunnel({
    id: tid(2),
    name: "Redis cache",
    localPort: 6379,
    sshHost: "cache.example.com",
    destination: { host: "127.0.0.1", port: 6379 },
    entryAddress: "6379",
    exitAddress: "",
    groupId: GRP_WORK,
  }),
  tunnel({
    id: tid(3),
    name: "Staging API",
    localPort: 8080,
    sshHost: "staging.example.com",
    jumpHostIds: [JUMP_BASTION],
    destination: { host: "api.staging.internal", port: 80 },
    entryAddress: "8080",
    exitAddress: "api.staging.internal:80",
    groupId: GRP_WORK,
  }),
  tunnel({
    id: tid(4),
    name: "SOCKS proxy",
    type: "dynamic",
    localPort: 1080,
    sshHost: "bastion.example.com",
    entryAddress: "1080",
    groupId: GRP_WORK,
  }),
  tunnel({
    id: tid(5),
    name: "Grafana",
    localPort: 3000,
    sshHost: "monitor.example.com",
    credentialId: CRED_ADMIN,
    destination: { host: "grafana.internal", port: 3000 },
    entryAddress: "3000",
    exitAddress: "grafana.internal:3000",
    groupId: GRP_HOME,
  }),
  tunnel({
    id: tid(6),
    name: "Home NAS",
    localPort: 5000,
    sshHost: "nas.example.net",
    credentialId: CRED_ADMIN,
    destination: { host: "127.0.0.1", port: 5000 },
    entryAddress: "5000",
    exitAddress: "",
    groupId: GRP_HOME,
  }),
  tunnel({
    id: tid(7),
    name: "Webhook relay",
    type: "remote",
    sshHost: "public.example.com",
    remoteBind: { port: 9000 },
    destination: { host: "127.0.0.1", port: 3000 },
  }),
];

const definitions = {
  schemaVersion: 4, // BASE (1) + 3 migrations — the current tunnels-doc version
  tunnels,
  credentials,
  jumpHosts,
  groups,
};

// ── Settings ──────────────────────────────────────────────────────────────────
// Fixed, deterministic UI state for consistent screenshots. `armOnLaunch: false`
// so launching binds no local listeners — the capture script arms the specific
// tunnels it wants "Listening" for the monitoring shots.
const settings = {
  theme: "dark",
  fontSize: 13,
  fontFamily: "inter",
  viewMode: "definition",
  monitorFilter: "all",
  armOnLaunch: false,
  launchAtLogin: false,
  confirmOnQuit: false,
  groupCollapsed: {},
};

// ── Write it all ──────────────────────────────────────────────────────────────
function writeJSON(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2));
}

// Replace only the docs dataset's definition + settings docs; leave the Electron
// cache/state siblings in the dir untouched.
mkdirSync(DATA, { recursive: true });
rmSync(join(DATA, "tunnels.json"), { force: true });
rmSync(join(DATA, "settings.json"), { force: true });

writeJSON(join(DATA, "tunnels.json"), definitions);
writeJSON(join(DATA, "settings.json"), settings);

console.log(
  `Seeded ${tunnels.length} tunnels, ${credentials.length} credentials, ` +
    `${jumpHosts.length} jump host, ${groups.length} groups into ${DATA}`,
);
