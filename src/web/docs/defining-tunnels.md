# Defining Tunnels

A tunnel definition describes *where* traffic goes and *how* the SSH connection
behaves. Open the editor with **+** (Add) or by editing an existing tunnel.

## The three addresses

Port Hippo routes traffic through three points:

| Field | What it is | Examples |
| --- | --- | --- |
| **Entry port** | The local port Port Hippo binds and listens on. | `5432` (binds `127.0.0.1:5432`), `0.0.0.0:5432` |
| **Target server** | The SSH server the tunnel connects to (the last hop). | `bastion.example.com`, `bastion.example.com:2222` |
| **Exit port** | *(optional)* Where the SSH server forwards your traffic. | `db.internal:5432` |

Read a tunnel as **entry port → (SSH through the target server) → exit port**. If
you leave the exit port blank, traffic is delivered to the target server itself.

### Entry port and binding scope

A **bare port** binds to loopback (`127.0.0.1`) — reachable only from your own
machine. This is the default and the safe choice.

To expose the port to your LAN, enter an explicit address such as `0.0.0.0:5432`.
This lets **other devices on your network** reach the tunnel, so only do it when
you mean to. See [Security → Binding scope](security.md#binding-scope).

The default bind host for bare ports is configurable in **Settings → Defaults**.

## Authentication

Each tunnel uses an **SSH credential** — a saved identity (user + auth method).
Pick or create one in the editor's authentication section. Credentials are
reusable across tunnels and jump hosts. See [Authentication](authentication.md).

## Jump hosts

Add one or more **jump hosts** to route through a chain of SSH servers before
reaching the target. Jump hosts are reusable records; see
[Jump Hosts](jump-hosts.md).

## Connection behaviour

Three options control the SSH connection's lifecycle:

### Idle linger (ms)

How long Port Hippo holds the SSH connection open after the **last** client
disconnects, before tearing it down. The default is **10 000 ms** (10 seconds).

- A **longer** linger avoids reconnect churn for apps that open and close
  connections frequently.
- A **shorter** linger frees the remote session sooner.
- The local entry port stays bound regardless — linger only governs the SSH
  connection.

The default for new tunnels lives in **Settings → Defaults**.

### Keep SSH connected while armed

Off by default. When **on**, the SSH connection is opened as soon as the tunnel is
armed and held open continuously — trading the "only connect when used" savings
for zero first-byte latency. Use it for a destination you hit constantly.

### Reconnect automatically if the connection drops

Off by default. When **off**, if a live SSH connection drops unexpectedly, Port
Hippo returns the tunnel to **Listening** and re-establishes it on the next access
— no wasted reconnects to a destination you're done with. When **on**, it
re-establishes the connection immediately (with backoff) so a long-lived client
survives a transient network blip.

## Enabling and arming

A tunnel is **enabled** if it should participate in *Arm All* and auto-arm at
launch. **Arming** is the live action that binds the entry port. Disabling a
tunnel keeps its definition but leaves it out of bulk arming.

## Editing a live tunnel

You can edit an armed or connected tunnel. Port Hippo **reconciles** the change:
edits that don't affect the live connection apply immediately; edits that change
the route (addresses, auth, jumps) take effect on the next connection, so an
in-flight session isn't ripped out from under a connected client.

## Testing resolution

Before saving, use **Test resolution** to check that every host in the chain
resolves and is reachable. This walks the real SSH chain and probes the
destination from the far end — it's **protocol-only** (it never runs a command on
a remote host) and prompts for host-key trust exactly as arming would. See
[Host Keys & Trust](host-keys.md).
