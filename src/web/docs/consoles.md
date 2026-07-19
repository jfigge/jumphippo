# Consoles

A **console** is an interactive **remote shell** — the terminal equivalent of a
tunnel. Where a tunnel forwards a port, a console opens a live SSH shell to a
server and drops you at its prompt in a dedicated terminal window.

Consoles live in their own **CONSOLES** section of the sidebar, below **TUNNELS**,
and are managed the same way: add, edit, and delete them, and pick a target server,
a credential, and an optional jump-host chain.

```
  Open ──ssh──▶ jump 1 ──ssh──▶ … ──ssh──▶ target server  ──▶  interactive shell
```

A console reuses **exactly** the same machinery as a tunnel: the encrypted
[credential](authentication.md) store, the [jump-host](jump-hosts.md) chain, and
host-key [trust-on-first-use](host-keys.md). Jump Hippo owns the SSH connection and
relays the shell itself — it never shells out to the system `ssh` binary.

## Defining a console

Click the **+** in the CONSOLES header (or **File ▸ New Console**) and fill in:

- **Name** — a label you'll recognise, e.g. `db-prod shell`.
- **Target server** — the host to open the shell on, optionally with a port
  (`db.example.com` or `db.example.com:22`; the port defaults to 22).
- **Credential** — how to authenticate to the target server. This is the same pool
  of saved credentials your tunnels use.
- **Jump hosts** — an optional ordered chain of bastions to connect *through*,
  exactly like a tunnel's chain.

Because credentials and jump hosts are shared records, a console and a tunnel to the
same server can reuse the same saved credential and bastion.

## Opening a console

**Double-click** a console (or press **Enter** on it, or right-click ▸ **Open**). A
terminal window opens, Jump Hippo connects the SSH chain, and you're dropped at the
remote shell. The window is a full, interactive terminal:

- Run anything — `ls`, `vim`, `htop`, `tail -f` — with full colour, cursor
  addressing, and the alternate screen.
- **Resize** the window and the remote terminal reflows to match.
- The row's status lamp lights **amber** while connecting and **green** once
  connected.

Open the same console more than once for multiple independent shells; each gets its
own window.

## The Console Manager

The terminal always lives in its own window — Jump Hippo never embeds it in the main
window. Instead, the main window is a **manager** for your console windows: a
lightweight window switcher and dashboard for your live SSH shells.

- In the **CONSOLES** sidebar, consoles read as running processes: a status dot plus
  a runtime line (**Running 24m**, **Idle**, **Connecting…**), so you can see at a
  glance which are live.
- **Select a console** (single click) and the centre pane becomes its **details**
  view — no terminal, just information to help you manage the session:
  - its **status** and which server it's **connected to**, the **window number**,
    and how long it's been **running**;
  - the **window state** — visible, hidden, minimized, or full screen;
  - a read-only **recent-output** preview (the last lines the shell printed, with
    colour codes stripped) so you can tell one console from another at a glance;
  - **runtime** and **activity** — start time, running time, SSH destination and jump
    host, terminal size, and bytes sent/received.
- **Click the CONSOLES title** to open the **Open Consoles** overview: a card per
  running session, each with its status, last output, and a **Bring Forward** button.
  Double-click a card to jump to that window.

### Actions

The details view's big buttons act on the session:

- **Bring Window Forward** — restores, raises, and focuses that console's window,
  even from behind another app. (Double-clicking its sidebar row or overview card
  does the same.)
- **Open New Console** — starts another session for this console.
- **Restart** — closes this session and opens a fresh one.
- **Close Console** — ends the session and closes its window.
- **Copy Connection Info** — copies the host, port, and jump chain (no secrets) to
  the clipboard.

### Recent output & your privacy

The recent-output preview is a convenience for telling consoles apart — it is **not**
a second terminal. It shows only the last handful of lines, control codes removed,
and it is streamed to the main window **only while you're looking at that console**.
Because a shell can echo secrets (a password you type, a token in a command's
output), the preview **never leaves your device** and is **never written to a log,
the diagnostics report, or an export**, and it's dropped the moment the session ends.

If you'd rather no shell output reach the main window at all, turn it off in
**Settings ▸ Security ▸ Console Manager** ("Show recent console output"). The rest of
the manager — status, window state, runtime, activity — keeps working.

## Host-key trust

The first time you open a console to an unrecognised server (or through an
unrecognised bastion), Jump Hippo prompts you to trust its host key — the same
trust-on-first-use prompt arming a tunnel raises. A *changed* key is refused. See
[Host Keys & Trust](host-keys.md).

## Closing a console

**Close the window** to end the session — Jump Hippo tears the SSH connection down
cleanly. If the connection drops or the remote shell exits, the terminal shows a
`[connection closed]` line; open the console again to reconnect. Because a shell's
state lives only in that session, consoles never silently reconnect on their own.

Quitting Jump Hippo closes every open console window and ends its session.

## Tips

- Consoles share credentials and jump hosts with tunnels — define a bastion once and
  use it for both.
- A console has no local port, forwarding, or scheduling — it's just a shell. For
  port forwarding, use a [tunnel](defining-tunnels.md) instead.
- Deleting a credential or jump host that a console still uses is blocked until the
  console is updated or removed, just as it is for tunnels.
