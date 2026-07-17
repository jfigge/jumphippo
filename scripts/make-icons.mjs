#!/usr/bin/env node
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

// Regenerate the Windows + Linux application icons from the master PNG.
//
// electron-builder will happily synthesise a Windows `.ico` (and the Linux
// hicolor set) from a single PNG, but its built-in resampling produces blurry,
// pixelated results at the small sizes Windows actually shows in the taskbar and
// Explorer. So instead we downscale crisp rasters at every standard size from the
// master `icons/1024x1024.png` and hand them to electron-builder as a finished
// multi-resolution `.ico` plus a PNG icon-set directory (which also supplies the
// Linux icon referenced by package.json's `build` block).
//
// The macOS app icon (`src/web/jumphippo-mac-icon.png`) is DELIBERATELY NOT
// touched here: it needs custom safe-area padding — the rounded square filling
// ~80% of the canvas that macOS expects — which a plain edge-to-edge downscale
// cannot produce. It is maintained separately; this script never reads or writes
// it.
//
// Outputs (committed to the repo, consumed at build time by package.json):
//   src/web/jumphippo-icon.ico   — Windows icon, PNG-encoded entries 16…256
//   src/web/icons/<N>x<N>.png    — Linux icon set (16…1024)
//
// macOS-only: downscaling uses the system `sips` tool. Run after replacing the
// master:  make icons   (or: node scripts/make-icons.mjs)
import {
  existsSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Master source: a single high-resolution PNG. Every emitted size is a
// downscale of this; nothing scales it up.
const SOURCE = path.join(repoRoot, "icons/1024x1024.png");
const ICO_OUT = path.join(repoRoot, "src/web/jumphippo-icon.ico");
const LINUX_DIR = path.join(repoRoot, "src/web/icons");

// The master source is 1024×1024; every smaller size is a high-quality Lanczos
// downscale of it (sips), which is uniform and sharp.
const MASTER = 1024;
// Linux ships the full freedesktop hicolor ladder; the .ico tops out at 256
// (the largest size the ICO format and Windows shell use).
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16];

function run(cmd, args) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
}

// Resize a copy of the master PNG to a square `size` (in place, Lanczos). The
// master itself is never mutated — sips only ever touches the copy at `outPath`.
function resizeTo(srcPng, size, outPath) {
  copyFileSync(srcPng, outPath);
  run("sips", ["-z", String(size), String(size), outPath]);
}

// Assemble a Vista-style ICO whose entries are PNG-encoded (supported by every
// Windows version this app targets). Layout: 6-byte ICONDIR header, one 16-byte
// ICONDIRENTRY per image, then the raw PNG blobs.
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  const blobs = [];
  let offset = 6 + 16 * count;
  entries.forEach((e, i) => {
    const png = readFileSync(e.path);
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 0); // width  (0 ⇒ 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1); // height (0 ⇒ 256)
    dir.writeUInt8(0, o + 2); // palette colours (0 = none)
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(png.length, o + 8); // size of image data
    dir.writeUInt32LE(offset, o + 12); // offset of image data
    offset += png.length;
    blobs.push(png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

if (!existsSync(SOURCE)) {
  console.error(
    `make-icons: master source not found: ${path.relative(repoRoot, SOURCE)}`,
  );
  process.exit(1);
}

console.log(`Downscaling icons from ${path.relative(repoRoot, SOURCE)}…`);
const work = mkdtempSync(path.join(tmpdir(), "jumphippo-icons-"));
try {
  // Linux icon set.
  mkdirSync(LINUX_DIR, { recursive: true });
  for (const size of LINUX_SIZES) {
    const out = path.join(LINUX_DIR, `${size}x${size}.png`);
    if (size === MASTER) copyFileSync(SOURCE, out);
    else resizeTo(SOURCE, size, out);
    console.log(`  linux  ${size}×${size}`);
  }

  // Windows .ico (downscaled straight from the master).
  const icoEntries = ICO_SIZES.map((size) => {
    const p = path.join(work, `ico-${size}.png`);
    if (size === MASTER) copyFileSync(SOURCE, p);
    else resizeTo(SOURCE, size, p);
    console.log(`  win    ${size}×${size}`);
    return { size, path: p };
  });
  writeFileSync(ICO_OUT, buildIco(icoEntries));

  console.log(`\nWrote ${path.relative(repoRoot, ICO_OUT)}`);
  console.log(`Wrote ${path.relative(repoRoot, LINUX_DIR)}/ (${LINUX_SIZES.length} sizes)`);
  console.log("macOS icon (src/web/jumphippo-mac-icon.png) left untouched — custom padding.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
