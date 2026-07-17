# Jump Hippo — Encryption / Export-Compliance Summary

**Product:** Jump Hippo (`com.jumphippo.app`)
**Item type:** Cross-platform desktop application (Electron) — SSH tunnel manager
**Manufacturer / Author:** Jason Figge

> **What this document is.** A technical description of every cryptographic
> function Jump Hippo contains, written to support U.S. export-compliance
> classification (EAR Category 5, Part 2), the App Store Connect *App Encryption
> Documentation* upload, and equivalent declarations. It is a factual engineering
> description of the shipping code, **not legal advice**; the classification
> statements below are a good-faith self-assessment that you should confirm before
> filing (see *Disclaimer*).

---

## 1. Summary determination

- Jump Hippo's **primary function is a networking client** — it establishes SSH
  connections and forwards TCP traffic through them on the user's behalf.
  Cryptography is **ancillary** to that function: it is used only to (a) secure the
  SSH transport to servers the user configures, (b) authenticate to those servers,
  and (c) protect the user's saved SSH secrets at rest on their own machine.
- **All algorithms are standard and published** (NIST / FIPS / IETF RFC).
  **No proprietary or non-standard encryption is implemented.**
- The strongest data-confidentiality primitive Jump Hippo invokes directly is
  **AES-256-GCM**, used only for local at-rest protection of user-entered secrets;
  symmetric key length is 256 bits. SSH transport ciphers are negotiated and
  computed by the bundled SSH library / OS crypto, not implemented by Jump Hippo.
- **Candidate U.S. classification:** **ECCN 5D992.c** — *mass-market encryption
  software* — eligible for self-classification under License Exception ENC,
  §740.17(b)(1). An "ancillary cryptography" argument (Note 4 to Category 5,
  Part 2 → **EAR99**) is also plausible given the networking-client primary
  function. Either way the item is **not** on the more tightly controlled
  5A002/5D002 lines. Confirm before you file.

This maps to the App Store Connect questionnaire as:

| App Store Connect question | Answer |
| --- | --- |
| Does your app use encryption? | **Yes** |
| Proprietary / non-standard algorithms? | **No** |
| Standard algorithms beyond Apple's OS crypto? | **Yes** — the app bundles its own crypto runtime (Node/OpenSSL + an SSH library) |
| Qualifies for a Category 5 Part 2 exemption? | **Likely yes** (mass-market / ancillary) |

> The app's macOS `Info.plist` sets `ITSAppUsesNonExemptEncryption = false`,
> reflecting the exempt (mass-market / ancillary) self-assessment above.

---

## 2. Cryptographic inventory

Every cryptographic operation in the shipping product. "Where" cites the
first-party source; "Provider" names what actually computes it.

### 2.1 Data confidentiality (symmetric encryption, at rest)

Jump Hippo encrypts exactly one class of data: **saved SSH passwords and key
passphrases**, on the user's own disk.

| Function | Algorithm | Key length | Standard | Where | Provider |
| --- | --- | --- | --- | --- | --- |
| Encrypt saved secrets — *device app-key* mode (`enck:v1:`) | AES-256-GCM (96-bit IV, 128-bit tag) | 256-bit | NIST SP 800-38D, FIPS 197 | `src/app/store/crypto.js` | Node/OpenSSL (bundled) |
| Encrypt saved secrets — *master-password* mode (`encm:v1:`) | AES-256-GCM | 256-bit | NIST SP 800-38D, FIPS 197 | `src/app/store/crypto.js` | Node/OpenSSL (bundled) |
| Encrypt saved secrets — *OS keychain* mode (`enc:v1:`) | OS-provided (AES via Keychain / DPAPI / libsecret) | OS-defined | — | `src/app/store/crypto.js` (`safeStorage`) | **macOS Keychain / Windows DPAPI / Linux libsecret (OS)** |

### 2.2 Key derivation

| Function | Algorithm | Params | Standard | Where |
| --- | --- | --- | --- | --- |
| Derive a 256-bit key from the master password | PBKDF2-HMAC-SHA256 | 210,000 iterations, 16-byte salt, 32-byte output | NIST SP 800-132 / RFC 8018 | `src/app/store/crypto.js` (`deriveKey`) |

The *device app-key* mode uses a 256-bit key generated with a CSPRNG
(`crypto.randomBytes`) and stored in a 0600 file; no KDF is involved.

### 2.3 Secure transport (SSH)

| Function | Algorithm(s) | Standard | Where | Provider |
| --- | --- | --- | --- | --- |
| SSH transport (key exchange, ciphers, MAC, host-key + user authentication) | Negotiated SSH suites (e.g. curve25519 / ECDH, AES-GCM/CTR, HMAC-SHA2, Ed25519/RSA/ECDSA) | IETF SSH RFCs 4251–4254, 8709 | `src/app/tunnel/` (via the `ssh2` dependency) | `ssh2` library + Node/OpenSSL (bundled) |

Jump Hippo does **not** implement any SSH cipher itself; it uses the standard
`ssh2` library, which in turn uses Node/OpenSSL. Host keys are verified against the
user's `known_hosts` and an accepted-keys store (trust-on-first-use).

### 2.4 What Jump Hippo does *not* do

- No proprietary or non-standard cryptographic algorithms.
- No cryptography beyond the at-rest secret protection and the SSH transport above
  (no cryptocurrency, no DRM, no full-disk encryption, no bulk file encryption, no
  portable encrypted export/import).
- The renderer never handles key material; all crypto happens in the main process.

---

## 3. Distribution

Jump Hippo is distributed as a signed desktop application for macOS, Windows, and
Linux, downloadable at no charge from `jumphippo.com` and GitHub releases. It is
**publicly available** and designed for the general public, supporting the
mass-market self-classification.

---

## 4. Bundled crypto runtime

The cryptographic providers shipped inside the app bundle:

- **Node.js / OpenSSL** (bundled with Electron) — computes AES-256-GCM and
  PBKDF2-HMAC-SHA256 for at-rest secret protection, and underlies SSH transport.
- **`ssh2`** (npm dependency) — the SSH protocol implementation, delegating ciphers
  to Node/OpenSSL.
- **OS keychain services** (macOS Keychain / Windows DPAPI / Linux libsecret) —
  used only in *OS keychain* secret-storage mode, via Electron `safeStorage`.

---

## Disclaimer

This summary is a good-faith engineering description prepared to assist export and
app-store encryption declarations. It is **not legal advice**. Export
classifications and filing obligations depend on jurisdiction and can change;
confirm the applicable ECCN, license exceptions, and reporting requirements with
qualified counsel before relying on this document.
