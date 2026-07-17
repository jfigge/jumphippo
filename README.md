<div align="center">

<img src="website/favicon.svg" width="72" height="72" alt="Jump Hippo" />

# Jump Hippo

**SSH tunnels that open on demand.**

[Download](https://jumphippo.com/#downloads) · [User Guide](https://jumphippo.com/docs/) · [Website](https://jumphippo.com)

</div>

Jump Hippo is a cross-platform desktop app (Electron + Vanilla JS/Node) that binds
a local port and **automatically opens an SSH tunnel the moment that port is
accessed** — through a chain of jump hosts if you need them — holds it open while
traffic is flowing, and tears the SSH connection down once the port goes idle. The
local listener stays bound, so the next access re-opens the tunnel automatically.

It runs quietly from the system tray, holds your SSH credentials encrypted at rest,
and **never phones home**.

## Features

- **On-demand tunnels** — connect lazily on first access; idle out automatically.
- **Jump-host chains** — reach a destination several SSH hops away.
- **Flexible auth** — SSH agent, private keys (with passphrases), or passwords.
- **Host-key verification** — trust-on-first-use with an explicit prompt; a changed
  key is refused.
- **Live monitoring** — per-tunnel state, byte rates, and connection stats, in a
  cards or a sortable list view.
- **Pause / resume** — freeze a live tunnel without tearing it down.
- **Background utility** — hide-to-tray, launch-at-login, and graceful quit that
  closes SSH sessions cleanly.
- **Selectable secret storage** — a promptless device key, your OS keychain, or a
  master password.
- **Loopback by default** — LAN exposure is an explicit, warned opt-in.

## Download

Get the latest build for macOS, Windows, or Linux from
**[jumphippo.com](https://jumphippo.com/#downloads)**.

## Documentation

The full **[User Guide](https://jumphippo.com/docs/)** covers defining tunnels,
jump hosts, authentication, host-key trust, monitoring, background behaviour, and
security. It's also available in-app from **Help → Jump Hippo User Guide**.

## Build from source

```bash
make install   # install dependencies (into src/node_modules)
make debug     # run the app with DevTools + hot-reload
make test      # license-header guard + unit tests
make dmg       # build an unsigned macOS .dmg
```

Run `make help` for all targets, and see [`CLAUDE.md`](CLAUDE.md) for the
architecture and conventions.

## Security

Jump Hippo handles SSH credentials and forwards ports. In short: entry ports bind
to **loopback by default**; secrets are **encrypted at rest** and never leave the
main process in cleartext; **every** SSH host key is verified and a *changed* key
is refused; logs and diagnostics are redacted; and the app makes no telemetry
calls. See the [Security guide](https://jumphippo.com/docs/security.html) for the
full picture, and [`SECURITY.md`](SECURITY.md) to report a vulnerability privately.

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev
setup, coding conventions, and the **DCO sign-off** requirement (`git commit -s`).

## License

[Apache-2.0](LICENSE) — see [`NOTICE`](NOTICE) for attributions.
