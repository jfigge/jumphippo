# Feature 80 — Docs, user guide & project hygiene

## Context
Jump Hippo is shippable (Feature 70) but under-documented. Rest Hippo keeps a single
Markdown source (`src/web/docs/*.md`) that feeds **both** an in-app user guide (a
`DocsViewer` window) **and** the hosted guide on the website (`scripts/build-docs.mjs`
renders the same Markdown into `website/docs/*.html`, auto-published by `deploy-site.yml`),
so the two can never drift. It also carries the open-source project hygiene files
(`README`, `CONTRIBUTING`, `SECURITY`, `NOTICE`, `DCO`, export-compliance notes). This
final stage brings that documentation layer to Jump Hippo, tuned to a security-sensitive
tunnelling tool.

## Goal
A single-source user guide rendered both in-app and on the website, covering how tunnels
work, defining tunnels + jump hosts, auth and host-key trust, monitoring/pause, tray/
background behaviour, and security guidance — plus complete repo hygiene docs (README,
CONTRIBUTING, SECURITY, DCO, license/NOTICE) so the project is a credible open-source
release.

## Design decisions (settled — do not relitigate)
- **One Markdown source, two renderers** (Rest Hippo's model). `src/web/docs/*.md` is the
  source of truth; a `DocsViewer` shows it in-app; `scripts/build-docs.mjs` renders it to
  `website/docs/*.html`; `deploy-site.yml` (Feature 70) publishes on every push to `main`.
  Never hand-edit `website/docs/` — it's generated. The one manual touchpoint is keeping the
  `PAGES` list in lockstep between `build-docs.mjs` and the in-app viewer.
- **Markdown rendered with the bundled `marked`** (dev dep, as in Rest Hippo) + sanitized;
  no CDN. If in-app rendering needs it, vendor via esbuild like Rest Hippo does.
- **Security guidance is a first-class page.** Because this app holds SSH credentials and
  forwards ports, the guide must explicitly cover: loopback-vs-LAN binding, host-key
  trust/TOFU and what a "changed key" warning means, where secrets are stored and how
  they're encrypted, agent vs key vs password trade-offs, and that Jump Hippo never phones
  home.
- **Guide pages (initial set):** `getting-started.md`, `defining-tunnels.md` (local port,
  destination, SSH server), `jump-hosts.md` (multi-hop chains), `authentication.md`
  (agent/key/password + passphrases + key-file Browse), `host-keys.md` (verification/TOFU),
  `monitoring.md` (stats, all/active, pause/resume), `tray-and-background.md`
  (hide-to-tray, launch-at-login, quit semantics), `security.md`, and
  `troubleshooting.md` (port in use, privileged ports <1024, connection failures,
  reconnect/backoff). Keep the guide **in step with features** — a user-facing change updates
  the relevant page in the same change.
- **Repo hygiene mirrors Rest Hippo**: `README.md` (what it is, screenshots/gif, download
  links to the site, quick build-from-source, security note), `CONTRIBUTING.md` (dev setup,
  `make` commands, DCO sign-off requirement, no-framework/i18n/license-header rules),
  `SECURITY.md` (private disclosure contact + supported versions), `NOTICE`, `DCO`, and
  `packaging/export-compliance.md` (SSH/crypto export-compliance note — relevant since the
  app ships cryptography).
- **Optional: a printable PDF** of the guide (Rest Hippo's `make pdf` via Chromium
  printToPDF) — nice-to-have, defer unless cheap.

## Implementation steps
1. **DocsViewer.** Port `docs-viewer.js` (+ a `docs-window.js`/preload if a separate window)
   to render `src/web/docs/*.md` in-app, reachable from Help → User Guide (and the tray).
   Localize its chrome via `t()`.
2. **`scripts/build-docs.mjs`.** Port the Markdown→HTML site renderer with a `PAGES` array
   (slug + title, ordered) matching the in-app viewer's; output to `website/docs/`. Keep the
   two `PAGES` lists in lockstep (document this in `CLAUDE.md`).
3. **Write the guide pages** listed above, matching the app's real behaviour and the
   security posture; add screenshots (a `docs-originals/` → capture pipeline is optional —
   static images are fine to start).
4. **Wire into the site.** Ensure `deploy-site.yml` (Feature 70) builds the guide (it
   already runs `build-docs.mjs`); add a "Docs" link in the website nav; confirm the hosted
   guide renders.
5. **README + hygiene files.** Write `README.md` (positioning, screenshot/gif, download
   badges/links to jumphippo.com, build-from-source via `make`, security summary),
   `CONTRIBUTING.md`, `SECURITY.md`, `NOTICE`, `DCO`, and
   `packaging/export-compliance.md`. Cross-link the DCO requirement enforced by
   `dco.yml` (Feature 70).
6. **CLAUDE.md doc rules.** Add the "User Guide" section (single-source, keep-in-step,
   PAGES-lockstep, never hand-edit `website/docs/`) mirroring Rest Hippo's.
7. **(Optional) PDF.** If included, port `scripts/build-pdf.mjs` + a `make pdf` target.
8. **License headers** on any new scripts/JS; `make test` stays green (the license-header
   guard skips `*.md`/`*.html`).

## Acceptance criteria
- The in-app Help → User Guide opens and renders every guide page from
  `src/web/docs/*.md`.
- The same Markdown renders on the website under `/docs`, published automatically by
  `deploy-site.yml`, with a nav link; `website/docs/` is generated, not hand-edited, and the
  two `PAGES` lists match.
- The guide covers getting started, defining tunnels, jump hosts, authentication, host-key
  trust, monitoring/pause, tray/background behaviour, security, and troubleshooting,
  accurately reflecting the shipped app.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `NOTICE`, `DCO`, and the export-compliance
  note exist and are consistent with the project; CONTRIBUTING documents the DCO sign-off
  and the coding conventions.
- `make test` is green; new source files carry the license header.

## Constraints
- One Markdown source for both in-app and hosted guides; never hand-edit generated
  `website/docs/`. Keep the `PAGES` lists in lockstep.
- No CDN for doc rendering (bundle `marked` like Rest Hippo). No framework.
- Security documentation must be accurate about secret storage, host-key trust, and binding
  scope — this is a credential-handling app.
- Keep docs in step with features going forward (a user-facing change updates its page in
  the same change).

## Verify
`make fmt && make lint && make test`. Run `make debug` and open Help → User Guide;
confirm every page renders in-app. Run `scripts/build-docs.mjs` locally and open the
generated `website/docs/*.html`; confirm parity with the in-app guide. Review `README.md`
rendered on GitHub for correct links (site, downloads, security) and confirm
`CONTRIBUTING.md` states the DCO sign-off requirement enforced by `dco.yml`.
