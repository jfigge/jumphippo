# Authentication

Every SSH hop — each jump host and the target server — logs in with a
**credential**. A credential is a saved identity: a **username** plus an **auth
method**. Credentials are reusable, so define an identity once and reference it
from as many tunnels and jump hosts as you like.

## Auth methods

Choose the **Type** in the credential's authentication section:

### SSH agent

Uses your running SSH agent (the same one `ssh` uses). No key file or password is
stored in Jump Hippo — the agent holds the keys and does the signing. This is the
most convenient and often the most secure option: nothing secret lives in Port
Hippo's store at all.

Requires an agent to be running with the right key loaded (`ssh-add -l` to check).

### Private key

Point Jump Hippo at a private key file. Use **Browse…** to pick the file, or type
its path (e.g. `~/.ssh/id_ed25519`).

- If the key is protected by a **passphrase**, enter it. The passphrase is
  encrypted at rest (see [Security](security.md)); the renderer never receives it
  back.
- Give the path to the **private** key, not the `.pub` public key.

### Password

Enter the SSH **password** for the account. It's encrypted at rest like a
passphrase. Password auth is the least preferred option where key or agent auth is
available — but it's fully supported for servers that require it.

## Username

The remote account to log in as (the `user` in `user@host`). Set it on the
credential, not the tunnel — so the identity travels with the credential.

## Where secrets go

Passwords and key passphrases are **encrypted at rest** and never leave the main
process in cleartext:

- The renderer only ever shows whether a secret is **set** — never its value.
- When you edit a credential, leave the secret field blank to **keep** the stored
  value; type a new value to replace it.
- You choose the at-rest backend in **Settings → Security**: a device key (no
  prompt), your OS keychain, or a master password. See
  [Security → Where secrets live](security.md#where-secrets-live).

## Reusing credentials

Because a credential is a standalone record, the same identity can authenticate a
jump host *and* a target server, or several tunnels that share one bastion. Update
the credential — rotate a key, change a passphrase — and every reference uses the
new value on its next connection.

## Choosing a method

- **Prefer the SSH agent** when you already run one — nothing sensitive is stored
  in Jump Hippo.
- **Use a key file with a passphrase** for an identity you want Jump Hippo to hold
  independently of an agent.
- **Use a password** only when the server requires it.

Whatever you choose, the server's identity is still verified separately by its host
key — see [Host Keys & Trust](host-keys.md).
