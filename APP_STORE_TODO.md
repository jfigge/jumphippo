# App Store submission — running checklist

Live TODO for shipping Jump Hippo to the **Mac App Store** (and later the
Microsoft Store). The full how-to is in
[`STORE-PUBLISHING.md`](./STORE-PUBLISHING.md); this file tracks *what's left
and in what order*.

Key facts:

| Thing | Value |
| --- | --- |
| Apple Team ID | `2C564TQ2FY` |
| Bundle id | `com.jumphippo.app` |
| App Store Connect app id | *(not created yet)* |
| App Store Connect API key id | `G9W84MCW73` (`.keys/AuthKey_G9W84MCW73.p8`) |
| CI kill-switch | `vars.STORE_SUBMIT_ENABLED` (off = build only, on = push to store) |
| Signing key backups | `.keys/` (git-ignored; copied from Rest Hippo — the certs are team-level and shared) |

---

## ✅ Done (2026-07-17)

- [x] Store-build feature flag + gating (`src/app/store-build.js`; self-updater +
      "Check for Updates…" menu item disabled in store builds).
- [x] `build.mas` / `build.masDev` / `build.appx` config in `src/package.json` +
      MAS entitlements (`src/packaging/entitlements.mas*.plist` — sandbox with
      network client **and** server for the tunnel listeners).
- [x] `make dist-mas` / `mas-dev` / `dist-appx` targets (graceful-skip without
      profile / identity).
- [x] CI `store-mas` / `store-appx` jobs + gated auto-submit in `release.yml`
      (kill-switch off by default); SignPath Windows signing steps (dormant
      until `vars.SIGNPATH_ORGANIZATION_ID` is set).
- [x] Apple **Distribution** + **Mac Installer Distribution** certs valid in the
      login keychain (shared with Rest Hippo; backups in `.keys/`).
- [x] Repo secrets pushed: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
      `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `MAS_CSC_LINK`,
      `MAS_INSTALLER_CSC_LINK`.

---

## 🍎 Apple — create the Jump Hippo records (blocking `dist-mas`)

- [ ] **App ID**: <https://developer.apple.com/account> → Identifiers → **+** →
      App ID `com.jumphippo.app` with the **App Sandbox** capability.
- [ ] **App Store Connect record**: <https://appstoreconnect.apple.com> → Apps →
      **+ New App** → macOS, bundle id `com.jumphippo.app`, set an SKU. Record
      the app id here when created.
- [ ] **MAS distribution provisioning profile**: Developer portal → Profiles →
      **+** → Mac App Store distribution for `com.jumphippo.app`, bound to the
      existing Apple Distribution cert → save as
      `src/packaging/embedded.provisionprofile` (git-ignored).
- [ ] *(Optional)* **MAS development profile** (for `make mas-dev` local sandbox
      smoke-tests) → save as `src/packaging/development.provisionprofile`.
- [ ] Local smoke test: `make mas-dev` → run the app; then `make dist-mas` →
      universal signed `.pkg` in `build/src/dist/mas-universal/`.
- [ ] **Before submitting**: write the numbered feature plan for MAS sandbox
      fit-and-finish (security-scoped bookmarks for key files; see the caveats
      in STORE-PUBLISHING.md) and decide whether v1 ships with the caveats
      documented or waits for it.
- [ ] Upload the first build via Transporter and submit for review.

### CI Phase A — build in CI, do NOT submit

- [ ] Add repo secrets (the two p12 export passwords — the `.keys/` hint files
      record them):
  - [ ] `MAS_CSC_KEY_PASSWORD`
  - [ ] `MAS_INSTALLER_CSC_KEY_PASSWORD`
  - [ ] `MAS_PROVISIONING_PROFILE_BASE64` = `base64 -i src/packaging/embedded.provisionprofile`
- [ ] Add repo **variable** `MAS_ENABLED = true`.
- [ ] **Leave `STORE_SUBMIT_ENABLED` unset.**
- [ ] Cut a test tag release and confirm the `store-mas` job builds the `.pkg`
      and uploads it as the `store-mas` run artifact.

### CI Phase B — enable auto-submit (after first approval)

- [ ] Add repo secrets for the App Store Connect API key:
  - [ ] `APPLE_API_KEY_ID` = `G9W84MCW73`
  - [ ] `APPLE_API_ISSUER` = Issuer ID (App Store Connect → Users and Access →
        Integrations → App Store Connect API; a copy lives in `.keys/issuer_Id`)
  - [ ] `APPLE_API_KEY_BASE64` = `base64 -i .keys/AuthKey_G9W84MCW73.p8`
- [ ] Set repo **variable** `STORE_SUBMIT_ENABLED = true`.
- [ ] Tag a release → CI uploads the build to App Store Connect automatically;
      **Submit for Review** stays a manual click in ASC.

---

## 🪟 Microsoft Store (dormant until Partner Center)

The `store-appx` job and its submit step exist but stay a no-op until the app
is reserved (`vars.APPX_IDENTITY_NAME` unset).

- [ ] Reserve "Jump Hippo" in Partner Center (account already exists for Rest
      Hippo).
- [ ] Copy the Product identity into repo **variables** `APPX_IDENTITY_NAME`,
      `APPX_PUBLISHER`, `APPX_PUBLISHER_DISPLAY_NAME` (and/or `release.env` /
      `build.appx`).
- [ ] Confirm a tag release builds the `store-appx` artifact; upload it in a
      Partner Center submission.
- [ ] *(Later, for auto-submit)* Azure-AD app → `MS_STORE_TENANT_ID` /
      `MS_STORE_CLIENT_ID` / `MS_STORE_CLIENT_SECRET` secrets +
      `vars.MS_STORE_PRODUCT_ID`.

---

## 🖊 Windows Authenticode for the DIRECT builds (optional, dormant)

The GitHub-release exes ship unsigned until either `WIN_CSC_*` secrets exist or
SignPath Foundation is wired (free for OSS; publisher shows as "SignPath
Foundation"):

- [ ] Apply at <https://signpath.org/apply> for the `jfigge/jumphippo` project;
      install the SignPath GitHub App on the repo.
- [ ] Set `secrets.SIGNPATH_API_TOKEN` + `vars.SIGNPATH_ORGANIZATION_ID` /
      `SIGNPATH_PROJECT_SLUG` / `SIGNPATH_SIGNING_POLICY_SLUG` /
      `SIGNPATH_ARTIFACT_CONFIG_SLUG`.
