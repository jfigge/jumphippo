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

// credential-status.js — shared derivation for a credential's UI status.
//
// A password credential imported without its secret (Feature 120's stripped
// bundle / SSH-config import) can't authenticate until the password is re-entered.
// That state is DERIVED from the secret-stripped renderer view — a `password`
// credential with `hasSecret === false` — so no new stored field is needed. It's
// meaningful only for password auth: `key` auth legitimately runs with no
// passphrase, and `agent` auth carries no secret at all.

/**
 * True when a credential (renderer, secret-stripped shape) is a password
 * credential with no stored secret — i.e. it needs its password re-entered.
 * @param {{authType?: string, hasSecret?: boolean}} cred
 * @returns {boolean}
 */
export function credentialNeedsSecret(cred) {
  return (
    Boolean(cred) && cred.authType === "password" && cred.hasSecret !== true
  );
}
