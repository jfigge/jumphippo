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

/**
 * ansi.test.js — the recent-output preview helper (Feature 210). Proves stripAnsi
 * removes escape sequences + control bytes and that OutputBuffer stays bounded,
 * surfaces a partial line, and decodes multi-byte UTF-8 across chunk boundaries.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { stripAnsi, OutputBuffer } = require("../ansi");

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test("stripAnsi removes SGR colour sequences", () => {
  assert.equal(stripAnsi(`${ESC}[31mred${ESC}[0m`), "red");
  assert.equal(stripAnsi(`${ESC}[1;32mGET /health${ESC}[0m`), "GET /health");
});

test("stripAnsi removes an OSC title sequence", () => {
  assert.equal(stripAnsi(`${ESC}]0;my title${BEL}hello`), "hello");
});

test("stripAnsi approximates a carriage return as an overwrite", () => {
  assert.equal(stripAnsi("loading...\rdone"), "done");
});

test("stripAnsi drops stray control bytes but keeps tabs", () => {
  assert.equal(stripAnsi(`a\tb${String.fromCharCode(8)}c`), "a\tbc");
});

test("OutputBuffer keeps only the last N completed lines", () => {
  const b = new OutputBuffer(3);
  b.push(Buffer.from("a\nb\nc\nd\ne\n"));
  assert.deepEqual(b.recent(10), ["c", "d", "e"]);
});

test("OutputBuffer surfaces the in-progress partial line", () => {
  const b = new OutputBuffer(200);
  b.push(Buffer.from("one\ntwo\npar"));
  assert.deepEqual(b.recent(10), ["one", "two", "par"]);
  b.push(Buffer.from("tial\n"));
  assert.deepEqual(b.recent(10), ["one", "two", "partial"]);
});

test("OutputBuffer strips ANSI from completed lines", () => {
  const b = new OutputBuffer(200);
  b.push(Buffer.from(`$ ls\n${ESC}[34mfile.txt${ESC}[0m\n`));
  assert.deepEqual(b.recent(5), ["$ ls", "file.txt"]);
});

test("OutputBuffer decodes multi-byte UTF-8 split across chunks", () => {
  const b = new OutputBuffer(200);
  const bytes = Buffer.from("é", "utf8"); // 2 bytes
  b.push(bytes.slice(0, 1));
  b.push(bytes.slice(1));
  b.push(Buffer.from("\n"));
  assert.deepEqual(b.recent(5), ["é"]);
});

test("OutputBuffer.recent(0) returns nothing and clear() empties it", () => {
  const b = new OutputBuffer(10);
  b.push(Buffer.from("x\ny\n"));
  assert.deepEqual(b.recent(0), []);
  b.clear();
  assert.deepEqual(b.recent(10), []);
});

test("stripAnsi treats a trailing CR (CRLF ending) as a line end, not an overwrite", () => {
  assert.equal(stripAnsi("ls\r"), "ls"); // CRLF split leaves a trailing CR
  assert.equal(stripAnsi("file1  file2\r"), "file1  file2");
  // A real in-line CR still overwrites (progress redraw keeps the final segment).
  assert.equal(stripAnsi("loading...\rdone\r"), "done");
});

test("OutputBuffer keeps CRLF-terminated command + output lines (real pty)", () => {
  const b = new OutputBuffer(200);
  // What an interactive shell actually sends: echoed command, its output, prompt.
  b.push(Buffer.from("ls\r\nfile1  file2\r\nec2-user@linux:~> "));
  assert.deepEqual(b.recent(10), ["ls", "file1  file2", "ec2-user@linux:~> "]);
});
