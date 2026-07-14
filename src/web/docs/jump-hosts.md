# Jump Hosts

A **jump host** (bastion) is an intermediate SSH server you connect *through* on
the way to the target. Port Hippo supports a **chain** of them, so you can reach a
destination that's several SSH hops away.

```
  entry port ──ssh──▶ jump 1 ──ssh──▶ jump 2 ──ssh──▶ target server ──▶ exit port
```

Each hop is a real SSH connection, chained inside the previous one — Port Hippo
owns the sockets and relays the bytes itself; it never shells out to the system
`ssh` binary.

## Jump hosts are reusable

A jump host is a saved record with:

- **Label** — a name you'll recognise, e.g. `Corp bastion`.
- **Host** and **port** — the bastion's address and SSH port.
- **Credential** — how to authenticate to *this* hop (see
  [Authentication](authentication.md)).

Because they're saved separately, one bastion can be shared by many tunnels. Edit
it once — say, its host key rotates or you move it to a new port — and every
tunnel that references it picks up the change on its next connection.

## Adding a chain to a tunnel

In the tunnel editor, open the **Jump hosts** section and add hosts in the order
they should be traversed — **first entry = first hop from your machine**, last
entry connects to the target server. Reorder or remove them as needed.

An empty jump list means a direct connection to the target server.

## Authentication per hop

Every hop authenticates independently. A common pattern is:

- Jump host: a key or agent identity that the bastion accepts.
- Target server: a different key that only the destination accepts.

Each jump host carries its own credential, and the tunnel's own credential is used
for the final hop to the target server. Mix and match agent, key, and password
auth freely across the chain.

## Host-key trust along the chain

Port Hippo verifies the host key of **every** hop — each jump host and the target
server — against your `known_hosts` and its own accepted-keys store. An unknown
key prompts you to trust it (once); a *changed* key is refused. See
[Host Keys & Trust](host-keys.md).

## Testing the chain

Use **Test resolution** in the editor to walk the whole chain before you rely on
it. Port Hippo connects hop-by-hop and reports, per host, whether it resolved and
was reachable — and probes the destination from the far end. It's protocol-only
and never executes anything on a remote host.

## Tips

- Keep bastions as their own jump-host records rather than baking a host into one
  tunnel — you'll reuse them.
- If a middle hop fails, the whole chain fails; **Test resolution** points at the
  offending hop.
- A jump host and the target server can be the same box reached two ways; that's
  fine, each is verified independently.
