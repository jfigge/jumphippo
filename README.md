# Port Hippo

**On-demand SSH tunnel manager** — a cross-platform desktop app (Electron + Vanilla
JS/Node) that binds a local port and automatically opens an SSH tunnel the moment that port
is accessed, holds it open while a connection is live, and cleans it up once the port goes
idle. Supports jump-host chains, live traffic monitoring, and pausing tunnels without
tearing them down.

> **Status:** under construction, built stage-by-stage from the plans in
> [`features/`](features/ROADMAP.md). Feature 00 (project scaffold) is in place.

## Development

```bash
make install   # install dependencies
make debug     # run the app with DevTools + hot-reload
make test      # license-header guard + unit tests
make build     # build an unsigned macOS app bundle
```

See `make help` for all targets and [`CLAUDE.md`](CLAUDE.md) for the project guide.

## License

[Apache-2.0](LICENSE).
