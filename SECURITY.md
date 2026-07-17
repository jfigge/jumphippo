# Security Policy

Jump Hippo manages SSH tunnels and stores SSH credentials, so we take security
reports seriously. Thank you for helping keep users safe.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report privately using one of:

- **GitHub Security Advisories** — the preferred channel. On the repository, open
  **Security → Report a vulnerability** to start a private advisory:
  <https://github.com/jfigge/jumphippo/security/advisories/new>
- **Email** — <jason.figge@gmail.com> with the subject line
  `Jump Hippo security`.

Please include enough detail to reproduce:

- the affected version and platform (macOS / Windows / Linux),
- a description of the issue and its impact,
- steps to reproduce, a proof of concept, or affected source, and
- any suggested remediation, if you have one.

You'll receive an acknowledgement, and we'll work with you on a fix and a
coordinated disclosure. Please give us a reasonable window to release a fix before
any public disclosure.

## Scope

Security-relevant areas include, but aren't limited to:

- **Secret handling** — leakage of stored SSH passwords / key passphrases, or a
  decrypted secret escaping the main process.
- **Host-key verification** — any way to bypass trust-on-first-use or connect to a
  server with a changed/unverified host key.
- **Binding scope** — a tunnel binding more broadly than configured.
- **Logs / diagnostics** — secrets appearing in the log or a diagnostics report.
- **Update integrity** — tampering with the auto-update path.

## Supported versions

Jump Hippo is distributed as a rolling release; **the latest published release**
receives security fixes. Please upgrade to the newest version (Help → Check for
Updates, or [jumphippo.com](https://jumphippo.com/#downloads)) before reporting,
and confirm the issue still reproduces there.

| Version | Supported |
| --- | --- |
| Latest release | ✅ |
| Older releases | ❌ (please upgrade) |

## Good-practice reminders for users

- Keep tunnel entry ports on **loopback** unless you deliberately need LAN
  exposure.
- Use the **SSH agent** or **key auth** rather than passwords where you can.
- Never dismiss a **"host key changed"** warning without verifying the change out
  of band.
- On a shared or portable machine, use the **OS keychain** or a **master
  password** for secret storage (Settings → Security).

See the in-app **Security** guide (Help → Jump Hippo User Guide → Security) for
details.
