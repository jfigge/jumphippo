# Contributing to Port Hippo

Thanks for your interest in improving Port Hippo! This document explains how to
get set up, the conventions the project follows, and — importantly — how to
certify your contributions via the **Developer Certificate of Origin (DCO)**.

## License of contributions

Port Hippo is licensed under the [Apache License, Version 2.0](LICENSE). By
contributing, you agree that your contributions are licensed under the same terms
(Apache-2.0), as set out in section 5 ("Submission of Contributions") of the
license.

## Developer Certificate of Origin (DCO)

Instead of a Contributor License Agreement, this project uses the
[Developer Certificate of Origin](DCO) — a lightweight statement that you wrote
the patch, or otherwise have the right to submit it under the project's open
source license. The full text is in the [`DCO`](DCO) file.

You certify the DCO by adding a `Signed-off-by` line to **every** commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and email must match your Git author identity. Git adds this line for you
automatically with the `-s`/`--signoff` flag:

```bash
git commit -s -m "Fix host-key prompt race on rapid re-arm"
```

### Set it up once

So you never forget the flag, configure your identity and (optionally) an alias:

```bash
git config user.name  "Your Name"
git config user.email "your.email@example.com"
git config alias.ci   "commit -s"   # then use: git ci -m "…"
```

### Fixing missing sign-offs

If CI reports a commit without a sign-off, add it retroactively and re-push:

```bash
# Last commit only:
git commit --amend --signoff --no-edit && git push --force-with-lease

# A whole branch (against the PR base branch, usually main):
git rebase --signoff origin/main && git push --force-with-lease
```

A GitHub Actions check ([`.github/workflows/dco.yml`](.github/workflows/dco.yml))
enforces this on every pull request; a PR cannot merge until all of its commits are
signed off.

## Development setup

```bash
make install      # Install npm dependencies (into src/node_modules)
make debug        # Run Electron with DevTools + hot-reload (primary dev workflow)
make fmt          # Format JS/CSS/HTML via Prettier
make lint         # Lint JS via ESLint
make test         # License-header guard + unit tests
make build        # Build an unsigned macOS app bundle (dir only)
```

Run `make help` for the full list of targets. See [`CLAUDE.md`](CLAUDE.md) for the
architecture and the complete set of conventions — please follow them, as several
are enforced by tests.

## Conventions in brief

- **No UI framework.** The renderer is Vanilla JS (ES modules) + plain CSS with
  the design tokens in `src/web/styles/theme.css`. Don't introduce React/Vue or an
  event-bus library, and don't hardcode colours/sizes — use the tokens.
- **Keep modules focused.** Split a file along its seams before it grows into a
  god-file.
- **IPC in lockstep.** Every `ipcMain.handle` channel needs a matching
  `window.porthippo.*` exposure in `preload.js`; a static test guards this.
- **i18n is single-source.** Edit the embedded `EN` catalog in
  `src/web/scripts/i18n.js`, then regenerate `src/web/locales/en.json` (a test
  asserts they stay byte-identical and that every `t("…")` key exists).
- **Keep docs in step with features.** The user guide is one Markdown source
  (`src/web/docs/*.md`) rendered both in-app and on the website. A user-facing
  change updates the relevant page in the *same* change; never hand-edit the
  generated `website/docs/`. Keep the `PAGES` list in
  `src/web/scripts/components/docs-viewer.js` and `scripts/build-docs.mjs` in
  lockstep.
- **Security accuracy.** This app handles SSH credentials and forwards ports —
  documentation about secret storage, host-key trust, and binding scope must be
  accurate.

## License headers

Every first-party source file must carry the standard Apache 2.0 header comment at
the top (after any shebang). When you add a new `.js`/`.css` file under `src/` or a
build script under `scripts/`, prepend:

```js
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
```

This is checked by `make test-license-headers` (part of `make test`) and runs in
CI. Generated bundles and vendored third-party code under `vendor/` are exempt. You
can stamp any missing headers automatically with `make license-headers`.

## Submitting changes

1. Make your change with focused commits, each signed off (`git commit -s`).
2. Run `make fmt lint test` locally — these must pass.
3. If your change is user-facing, update the relevant `src/web/docs/*.md` page.
4. Open a pull request describing the change and the motivation.
5. Ensure the **DCO** and **CI** checks are green.

## Reporting security issues

Please do **not** open a public issue for a vulnerability. Follow the private
disclosure process in [`SECURITY.md`](SECURITY.md).

Thanks for contributing! 🦛
