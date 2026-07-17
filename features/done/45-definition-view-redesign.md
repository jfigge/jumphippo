# Feature 45 — Definition View Redesign (clean list + modal editor, reusable credentials & jump hosts)

> Status: **complete** — data layer (steps 1–2) + UI (steps 3–7) landed; `make fmt && lint && test` green.
> Supersedes the always-open form behaviour introduced under Stage 40.
> Amends the data model from Stage 10 and consumes the resolver seam from Stage 20.

## Context

The Definition view pairs a tunnel list with an always-open form carrying every field for
the selected tunnel — local host, destination, SSH server, auth, and an inline jump-host
builder — regardless of whether each is needed. Most fields have an obvious default, so the
form is noisy and hard to read.

Two facts drive the redesign:

- Almost every listener binds locally, so the **local host** is `127.0.0.1` unless the user
  deliberately exposes it (a warned opt-in).
- The **SSH server** is usually the same box the service runs on, so it can be implied from
  the destination; a separate SSH server is only needed when a bastion forwards onward.

Auth was embedded per tunnel and jump hosts were built inline. Neither was reusable. This
feature promotes both to first-class, reusable records selected from pick lists.

## Reconciliation with the real code (settled once source was in hand)

The original plan assumed a flatter model than what Stage 10 actually shipped. Reconciled:

- **Keep `bindHost` and nested `destination:{host,port}`** — the engine, relay, and validator
  already use them; renaming to `localHost`/`destHost` was pure churn.
- **Credentials hold a single auth method** (user's decision): `{ authType, keyPath?, secret }`
  rather than an ordered `auth[]` list. Migration keeps each old hop's **first** auth method
  (`auth[0]`); any additional fallback methods on a multi-method hop are dropped.
- **Secrets stay inline as sealed `{enc}`** in the credential record (reusing the Stage 90
  crypto), not a separate `secretRef` blob — CLAUDE.md forbids a second secrets path.
- **One document, not three files.** `credentials[]` and `jumpHosts[]` are sibling arrays in
  `tunnels.json` so the v1→v2 migration is a single pure `(doc)=>doc` transform (migrations
  run per-document and can't move data across files).

## Data model (v2, as built)

```
tunnels.json = { schemaVersion: 2, tunnels[], credentials[], jumpHosts[] }

tunnel      { id, name, bindHost?, localPort,
              destination: { host, port },
              sshHost?, sshPort?,          # blank sshHost ⇒ SSH into the destination box
              credentialId,                # the SSH server's credential (required)
              jumpHostIds: [],             # ordered reusable jump-host refs
              enabled, keepAlive, autoReconnect, lingerMs? }

credential  { id, label, user, authType: "agent"|"key"|"password",
              keyPath?,                    # authType "key"
              password?|passphrase? }      # sealed { enc } at rest; write-only over IPC

jumpHost    { id, label, host, port, credentialId }
```

## Resolver (Stage 20 seam) — `src/app/store/resolve.js`

`resolveDefinition(tunnel, { credentialsById, jumpHostsById })` turns a stored reference
tunnel + its (already-decrypted) referenced records into the engine-shaped
`{ destination, sshServer, jumps }` def the Feature 20 engine already consumes — so the
engine / ssh-chain / relay are untouched. Implication rules (single source of truth):

- `bindHost ??= 127.0.0.1`, `sshPort ??= 22`.
- blank `sshHost` ⇒ `sshServer.host = destHost`, forward target `127.0.0.1:destPort`.
- non-blank `sshHost` ⇒ bastion: SSH to `sshHost`, forward target `destHost:destPort`.
- prepend the ordered `jumpHostIds` chain; a missing ref fails closed (never silently skips).

`summariseRoute(tunnel, { jumpHostsById })` reuses the same implication for the list-row
string; `tunnelStore.list()/get()` attach it as `routeSummary` so display and behaviour
can't drift. Examples: `:5432 → db.example.com:5432` · `… via bastion` · `… (jump: relay1)`.

## Store, IPC, migration (built)

- `credential-store.js` / `jump-host-store.js` over the shared `definitions-doc.js`, with
  referential-integrity guards: a dangling `credentialId` / `jumpHostId` is rejected on
  tunnel create/update; a credential/jump host still referenced can't be deleted (`IN_USE`).
- `tunnel-store.js`: reference shape, no secrets; `getDecrypted/listDecrypted` resolve refs.
- IPC `credentials:* / jumphosts:*` (main `ipc/store.js` + `preload.js`, kept in lockstep;
  `ipc-parity` green). A credential/jump-host write triggers `engine.reconcileAll()`.
- `migrations.js` v1→v2: idempotent, type-guarded extraction of embedded auth → `credentials[]`
  (deduped) and inline jumps → `jumpHosts[]`, rewriting tunnels to references. Behaviour-
  preserving: `sshHost` is set explicitly from the old `sshServer.host` (never blanked), so a
  migrated tunnel forwards exactly as before.
- `secret-storage.js`: backend re-encryption now walks `credentials[].{password|passphrase}`
  (was the old per-hop `auth[]`) so a mode switch still re-encrypts every secret.

## UI (Stage 40 rewrite) — DONE (steps 3–7)

- **`DefinitionView`** is now list-first: compact rows (state badge, name, `routeSummary`, arm
  toggle, and edit / duplicate / delete revealed on hover). Add / Edit open the modal editor.
- **`TunnelEditorDialog`** — native `<dialog>` (`dialog.js` provides the shared chrome). Primary
  fields (name, destination host + port, local port, credential picker); a collapsed native
  `<details>` holds the local bind address (+ loopback warning), the SSH-server override
  (placeholder "Same as destination"), SSH port, the jump-host chain, and options. Advanced
  auto-opens when a tunnel actually uses an advanced field.
- **`CredentialPickerField` / `CredentialEditorDialog`** and **`JumpHostPickerField` /
  `JumpHostEditorDialog`** (ordered chain builder). Each picker's inline "New…" opens the matching
  editor; native `<dialog>` STACKING lets a jump-host editor's credential picker open the credential
  editor on top. On save each editor emits `jumphippo:credentials-changed` /
  `jumphippo:jumphosts-changed`, and open pickers refresh (preserving/pruning selections).
- Validation: `validateDefinition` drives inline field errors; two soft, non-blocking warnings
  (privileged local port, a port already claimed by another tunnel); the store's `IN_USE` guard
  blocks deleting a referenced credential / jump host; empty states throughout.
- Native `<dialog>` is unsupported in jsdom 27, so `jsdom-setup.js` polyfills showModal/close/
  cancel; production uses the real element in Electron/Chromium.
- The obsolete inline `tunnel-editor.js` / `hop-editor.js` / `auth-editor.js` /
  `jump-host-editor.js` (and their tests) are removed; each modal editor + picker has its own test.

## Acceptance criteria

- A common tunnel is creatable with ≤4 visible fields; local host & SSH server only under Advanced.
- A credential and a jump host can each be defined once and reused across tunnels.
- Deleting a referenced credential/jump host is blocked/warned. ✅ (store `IN_USE` guard)
- Existing configs migrate with no loss of data (single-method credentials keep `auth[0]`). ✅
- Local listeners still bind `127.0.0.1` by default; LAN exposure stays a warned opt-in.
- Secrets never appear in tunnel records, logs, or exports. ✅

## Verify

```
make fmt && make lint && make test        # green: 131 + 17 + 74 pass, 0 fail, 0 skipped
make debug   # create a tunnel with only destination + local port + credential;
             # confirm arm/forward; define a bastion + a jump-host chain; reuse one credential
             # across two tunnels; delete a referenced credential and confirm the guard fires;
             # reload and confirm migrated config is intact.
```
