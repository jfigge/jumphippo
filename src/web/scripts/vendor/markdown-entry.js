/**
 * markdown-entry.js — Markdown renderer bundle entry point.
 *
 * Bundles `marked` (CommonMark / GFM parser) + `DOMPurify` (HTML sanitizer) into
 * one safe renderer for the bundled user-guide pages (src/web/docs/*.md). marked
 * turns Markdown into HTML; DOMPurify then strips any scripts, inline event
 * handlers and javascript: URLs, so the output is safe to assign via innerHTML in
 * the sandboxed docs window.
 *
 * Every link is forced to target="_blank" + rel="noopener" so the main process
 * opens it in the system browser (see setWindowOpenHandler in main.js) rather
 * than navigating the docs window; the DocsViewer intercepts in-guide *.md links
 * before this ever matters.
 *
 * This file is NOT imported at runtime — it is compiled by esbuild into
 *   web/scripts/vendor/markdown.js
 * via `npm run vendor-markdown` (or `make vendor-markdown`). Regenerate the
 * bundle after bumping marked/DOMPurify.
 */

import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: false });

// Open every link in the system browser; never navigate the docs window.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Render a Markdown source string to sanitized HTML. */
export function renderMarkdown(src) {
  const rawHtml = marked.parse(src ?? "", { async: false });
  return DOMPurify.sanitize(rawHtml);
}

export default renderMarkdown;
