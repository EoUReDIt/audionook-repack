// ===========================================================================
// import.js — turn a dropped/opened document into narratable text.
//
// fileToText(file) resolves to { text, title, author, cover }:
//   text    plain prose, one paragraph per block, blank line between blocks
//   title   the document's own title when it carries one, else the file name
//   author  when the document names one (EPUB / PDF / DOCX / ODT metadata)
//   cover   a Blob image: the EPUB's cover, or a render of a PDF's first page;
//           null for formats that have no pages
//
// Everything is parsed on the device. PDF uses pdf.js; EPUB, DOCX and ODT are
// zip archives of XML read with zip.js (the same library backups use). Both
// load on demand, so opening a .txt never pays for them.
// ===========================================================================

import { ZIP_URL, PDFJS_URL, PDFJS_WORKER_URL } from "./vendor.js";

export const MAX_FILE_BYTES = 48 * 1024 * 1024;
export const ACCEPT = ".txt,.text,.md,.markdown,.html,.htm,.xhtml,.rtf,.pdf,.docx,.epub,.odt,text/plain";

const COVER_MAX_WIDTH = 1200; // px, for the PDF first-page render

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function kindOf(file) {
  const name = String((file && file.name) || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const type = String((file && file.type) || "").toLowerCase();
  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (ext === "epub" || type === "application/epub+zip") return "epub";
  if (ext === "docx" || type.includes("wordprocessingml")) return "docx";
  if (ext === "odt" || type.includes("opendocument.text")) return "odt";
  if (ext === "rtf" || type === "application/rtf" || type === "text/rtf") return "rtf";
  if (ext === "html" || ext === "htm" || ext === "xhtml" || type === "text/html" || type === "application/xhtml+xml") return "html";
  if (ext === "md" || ext === "markdown" || type === "text/markdown") return "md";
  return "txt";
}

export async function fileToText(file, { onProgress } = {}) {
  if (!file) throw new Error("no file");
  if (file.size > MAX_FILE_BYTES) throw new Error("file too large");
  const say = (s) => { if (onProgress) { try { onProgress(s); } catch (e) {} } };
  const kind = kindOf(file);
  let out;
  if (kind === "pdf") out = await readPdf(file, say);
  else if (kind === "epub") out = await readEpub(file, say);
  else if (kind === "docx") out = await readDocx(file, say);
  else if (kind === "odt") out = await readOdt(file, say);
  else if (kind === "rtf") out = { text: rtfToText(await readText(file)) };
  else if (kind === "html") out = readHtml(await readText(file));
  else if (kind === "md") out = { text: markdownToText(await readText(file)) };
  else out = { text: await readText(file) };
  return {
    text: tidy(out.text || ""),
    title: cleanLine(out.title) || titleFromFileName(file.name),
    author: cleanLine(out.author) || "",
    cover: out.cover || null,
  };
}

// "the_final-empire (1).epub" -> "The final empire"
export function titleFromFileName(name) {
  let s = String(name || "").replace(/\.[A-Za-z0-9]{1,8}$/, "");
  s = s.replace(/[_]+/g, " ").replace(/\s*\(\d+\)\s*$/, "").replace(/\s+-\s+/g, " – ").replace(/(\w)-(\w)/g, "$1 $2");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "Untitled";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function cleanLine(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, 200);
}

// Normalise whitespace: no trailing spaces, at most one blank line in a row.
function tidy(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/­/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Decode as UTF-8 unless a byte-order mark or invalid bytes say otherwise.
async function readText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeBytes(bytes);
}
function decodeBytes(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

let zipMod = null;
async function zipLib() {
  if (!zipMod) {
    zipMod = await import(ZIP_URL);
    try { zipMod.configure({ useWebWorkers: false }); } catch (e) {}
  }
  return zipMod;
}

// Open a zip and return lookups by (case-insensitive) path.
async function openZip(file) {
  const zip = await zipLib();
  const reader = new zip.ZipReader(new zip.BlobReader(file));
  const entries = await reader.getEntries();
  const byName = new Map();
  for (const e of entries) if (!e.directory) byName.set(e.filename.toLowerCase(), e);
  const find = (path) => byName.get(String(path).replace(/^\/+/, "").toLowerCase()) || null;
  return {
    has: (path) => !!find(path),
    async text(path) {
      const e = find(path);
      if (!e) return null;
      const bytes = await e.getData(new zip.Uint8ArrayWriter());
      return decodeBytes(bytes);
    },
    async blob(path, type) {
      const e = find(path);
      if (!e) return null;
      return e.getData(new zip.BlobWriter(type || "application/octet-stream"));
    },
    names: () => Array.from(byName.keys()),
    close: () => reader.close().catch(() => {}),
  };
}

function parseXml(str) {
  const doc = new DOMParser().parseFromString(String(str || ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("the file is damaged");
  return doc;
}
// Namespace-agnostic lookups: match on the local part of the tag name.
function byLocal(node, name) {
  const out = [];
  const all = node.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) if (all[i].localName === name) out.push(all[i]);
  return out;
}
function firstLocal(node, name) { return byLocal(node, name)[0] || null; }
function attrLocal(elm, name) {
  if (!elm || !elm.attributes) return null;
  for (const a of Array.from(elm.attributes)) if (a.localName === name) return a.value;
  return null;
}

// Resolve `rel` against the directory of `basePath` inside a zip.
function resolvePath(basePath, rel) {
  rel = decodeURIComponent(String(rel || "").split("#")[0]);
  if (rel.startsWith("/")) return rel.slice(1);
  const parts = String(basePath || "").split("/");
  parts.pop();
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

// ---------------------------------------------------------------------------
// HTML -> text
// ---------------------------------------------------------------------------
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "blockquote", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "dl", "dt", "dd", "tr", "table",
  "figure", "figcaption", "address", "hr", "body",
]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "math", "head", "nav", "form", "button", "iframe", "object", "audio", "video", "canvas"]);

// Walk the tree emitting inline text, with a paragraph break at every block
// boundary. Whitespace inside inline runs collapses the way a browser would.
export function domToText(rootNode) {
  const blocks = [];
  let cur = "";
  const flush = () => {
    const s = cur.replace(/\s+/g, " ").trim();
    if (s) blocks.push(s);
    cur = "";
  };
  const walk = (node) => {
    if (node.nodeType === 3) { cur += node.nodeValue; return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (node.hasAttribute && (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true")) return;
    if (tag === "br") { flush(); return; }
    if (tag === "sup" && /^\s*\[?\d{1,3}\]?\s*$/.test(node.textContent || "")) return; // footnote markers
    const block = BLOCK_TAGS.has(tag);
    if (block) flush();
    for (const child of Array.from(node.childNodes)) walk(child);
    if (block) flush();
    else if (tag === "td" || tag === "th") cur += " ";
  };
  walk(rootNode);
  flush();
  return blocks.join("\n\n");
}

function readHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const title = doc.querySelector("title");
  const author = doc.querySelector('meta[name="author" i]');
  const main = doc.querySelector("article") || doc.querySelector("main") || doc.body || doc.documentElement;
  return {
    text: domToText(main),
    title: title ? title.textContent : "",
    author: author ? author.getAttribute("content") : "",
  };
}

// ---------------------------------------------------------------------------
// Markdown -> text (only strips markup; never tries to render)
// ---------------------------------------------------------------------------
export function markdownToText(md) {
  let s = String(md || "").replace(/\r\n?/g, "\n");
  s = s.replace(/^---\n[\s\S]*?\n---\n/, "");                 // front matter
  s = s.replace(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, "$1"); // fenced code: keep the body
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");             // images -> alt text
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");              // links -> label
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  s = s.replace(/^\[[^\]]+\]:\s+\S+.*$/gm, "");               // reference definitions
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/gm, "$1\n"); // headings
  s = s.replace(/^[ \t]{0,3}(=+|-+)[ \t]*$/gm, "");           // setext underlines / rules
  s = s.replace(/^[ \t]{0,3}([*_]\s*){3,}$/gm, "");
  s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, "");                  // blockquotes
  s = s.replace(/^[ \t]*([-*+]|\d{1,3}[.)])[ \t]+/gm, "");    // list markers
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");      // bold
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2"); // italic *
  s = s.replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2");   // italic _
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
  s = s.replace(/`([^`\n]+)`/g, "$1");
  s = s.replace(/^\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, ""); // table rules
  s = s.replace(/<\/?[a-zA-Z][^>\n]*>/g, "");                  // stray inline HTML
  return s;
}

// ---------------------------------------------------------------------------
// RTF -> text
// ---------------------------------------------------------------------------
// Groups whose contents are never prose.
const RTF_SKIP = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl", "headerr",
  "footerl", "footerr", "footnote", "themedata", "colorschememapping", "latentstyles", "datastore",
  "generator", "listtable", "listoverridetable", "rsidtbl", "xmlnstbl", "fldinst", "bkmkstart", "bkmkend",
  "pgdsctbl", "revtbl", "filetbl", "mmathPr", "wgrffmtfilter", "shpinst",
]);
const RTF_CHARS = {
  par: "\n\n", sect: "\n\n", page: "\n\n", line: "\n", tab: " ", cell: " ", row: "\n",
  emdash: "—", endash: "–", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”",
  bullet: "•", emspace: " ", enspace: " ", "~": " ", "_": "-",
};

export function rtfToText(rtf) {
  const src = String(rtf || "");
  const cp1252 = new TextDecoder("windows-1252");
  let out = "";
  const stack = [];
  let skip = false;     // inside a group whose text is dropped
  let ucSkip = 1;       // fallback chars to drop after a \uN
  let pendingSkip = 0;
  let i = 0;
  const n = src.length;
  const emit = (s) => { if (!skip) out += s; };
  while (i < n) {
    const ch = src[i];
    if (ch === "{") { stack.push({ skip, ucSkip }); i++; continue; }
    if (ch === "}") { const st = stack.pop(); if (st) { skip = st.skip; ucSkip = st.ucSkip; } i++; continue; }
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\\" || next === "{" || next === "}") { if (pendingSkip > 0) pendingSkip--; else emit(next); i += 2; continue; }
      if (next === "'") {
        const code = parseInt(src.substr(i + 2, 2), 16);
        i += 4;
        if (pendingSkip > 0) { pendingSkip--; continue; }
        if (isFinite(code)) emit(cp1252.decode(new Uint8Array([code])));
        continue;
      }
      if (next === "*") { skip = true; i += 2; continue; } // \* marks an ignorable destination
      if (next === "\n" || next === "\r") { emit("\n\n"); i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 48));
      if (!m) { // control symbol such as \~ or \-
        if (next in RTF_CHARS) emit(RTF_CHARS[next]);
        i += 2;
        continue;
      }
      i += m[0].length;
      const word = m[1];
      const arg = m[2] != null ? parseInt(m[2], 10) : null;
      if (RTF_SKIP.has(word)) { skip = true; continue; }
      if (word === "uc") { ucSkip = arg == null ? 1 : arg; continue; }
      if (word === "u" && arg != null) {
        emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg));
        pendingSkip = ucSkip;
        continue;
      }
      if (word === "bin" && arg) { i += arg; continue; }
      if (word in RTF_CHARS) emit(RTF_CHARS[word]);
      continue;
    }
    if (ch === "\r" || ch === "\n") { i++; continue; } // raw newlines are not content in RTF
    if (pendingSkip > 0) { pendingSkip--; i++; continue; }
    emit(ch);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------
async function readDocx(file, say) {
  say("Opening document…");
  const zip = await openZip(file);
  try {
    const xml = await zip.text("word/document.xml");
    if (!xml) throw new Error("not a Word document");
    const doc = parseXml(xml);
    const body = firstLocal(doc, "body") || doc.documentElement;
    const paras = [];
    for (const p of byLocal(body, "p")) {
      let s = "";
      const walk = (node) => {
        for (const c of Array.from(node.childNodes)) {
          if (c.nodeType !== 1) continue;
          const name = c.localName;
          if (name === "t") s += c.textContent;
          else if (name === "tab") s += " ";
          else if (name === "br" || name === "cr") s += "\n";
          else if (name === "noBreakHyphen") s += "-";
          else if (name === "softHyphen") { /* invisible */ }
          else if (name === "del" || name === "moveFrom" || name === "instrText" || name === "footnoteReference" || name === "endnoteReference" || name === "pict" || name === "drawing") { /* tracked deletions, field codes, note marks, images */ }
          else walk(c);
        }
      };
      walk(p);
      s = s.replace(/[ \t]+/g, " ").trim();
      if (s) paras.push(s);
    }
    let title = "", author = "";
    const core = await zip.text("docProps/core.xml");
    if (core) {
      try {
        const cd = parseXml(core);
        const t = firstLocal(cd, "title"), a = firstLocal(cd, "creator");
        title = t ? t.textContent : "";
        author = a ? a.textContent : "";
      } catch (e) {}
    }
    return { text: paras.join("\n\n"), title, author };
  } finally {
    zip.close();
  }
}

// ---------------------------------------------------------------------------
// ODT
// ---------------------------------------------------------------------------
async function readOdt(file, say) {
  say("Opening document…");
  const zip = await openZip(file);
  try {
    const xml = await zip.text("content.xml");
    if (!xml) throw new Error("not an OpenDocument text file");
    const doc = parseXml(xml);
    const body = firstLocal(doc, "text") && firstLocal(doc, "body") ? firstLocal(doc, "body") : doc.documentElement;
    const paras = [];
    const inline = (node) => {
      let s = "";
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === 3) s += c.nodeValue;
        else if (c.nodeType === 1) {
          const name = c.localName;
          if (name === "s") s += " ".repeat(Math.max(1, parseInt(attrLocal(c, "c") || "1", 10) || 1));
          else if (name === "tab") s += " ";
          else if (name === "line-break") s += "\n";
          else if (name === "note" || name === "annotation" || name === "frame" || name === "tracked-changes") { /* footnotes, comments, images */ }
          else s += inline(c);
        }
      }
      return s;
    };
    const walk = (node) => {
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType !== 1) continue;
        const name = c.localName;
        if (name === "p" || name === "h") {
          const s = inline(c).replace(/[ \t]+/g, " ").trim();
          if (s) paras.push(s);
        } else if (name === "tracked-changes" || name === "frame" || name === "annotation") {
          /* skip */
        } else walk(c);
      }
    };
    walk(body);
    let title = "", author = "";
    const meta = await zip.text("meta.xml");
    if (meta) {
      try {
        const md = parseXml(meta);
        const t = firstLocal(md, "title"), a = firstLocal(md, "creator") || firstLocal(md, "initial-creator");
        title = t ? t.textContent : "";
        author = a ? a.textContent : "";
      } catch (e) {}
    }
    return { text: paras.join("\n\n"), title, author };
  } finally {
    zip.close();
  }
}

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------
async function readEpub(file, say) {
  say("Opening book…");
  const zip = await openZip(file);
  try {
    const container = await zip.text("META-INF/container.xml");
    if (!container) throw new Error("not an EPUB");
    const rootfile = firstLocal(parseXml(container), "rootfile");
    const opfPath = rootfile && rootfile.getAttribute("full-path");
    const opfXml = opfPath && (await zip.text(opfPath));
    if (!opfXml) throw new Error("the EPUB has no package file");
    const opf = parseXml(opfXml);

    const manifest = new Map(); // id -> { href, type, props }
    for (const item of byLocal(opf, "item")) {
      manifest.set(item.getAttribute("id"), {
        path: resolvePath(opfPath, item.getAttribute("href")),
        type: (item.getAttribute("media-type") || "").toLowerCase(),
        props: (item.getAttribute("properties") || "").toLowerCase(),
      });
    }

    const titleEl = firstLocal(opf, "title"), creatorEl = firstLocal(opf, "creator");
    const title = titleEl ? titleEl.textContent : "";
    const author = creatorEl ? creatorEl.textContent : "";

    // Reading order. `linear="no"` items are side content (often the cover page).
    const spine = [];
    for (const ref of byLocal(opf, "itemref")) {
      const item = manifest.get(ref.getAttribute("idref"));
      if (!item) continue;
      if ((ref.getAttribute("linear") || "").toLowerCase() === "no") continue;
      if (/nav/.test(item.props)) continue; // the EPUB3 table of contents document
      spine.push(item);
    }

    const parts = [];
    for (let i = 0; i < spine.length; i++) {
      if (i % 5 === 0) say("Reading chapter " + (i + 1) + " of " + spine.length + "…");
      const src = await zip.text(spine[i].path);
      if (!src) continue;
      let doc = new DOMParser().parseFromString(src, "application/xhtml+xml");
      if (doc.getElementsByTagName("parsererror").length) doc = new DOMParser().parseFromString(src, "text/html");
      const body = firstLocal(doc, "body") || doc.documentElement;
      const text = domToText(body);
      if (text) parts.push(text);
    }

    // Cover: EPUB3 marks it with properties="cover-image"; EPUB2 points a
    // <meta name="cover"> at a manifest id. Fall back to an image named cover.
    let coverItem = null;
    for (const item of manifest.values()) if (/\bcover-image\b/.test(item.props)) { coverItem = item; break; }
    if (!coverItem) {
      for (const meta of byLocal(opf, "meta")) {
        if ((meta.getAttribute("name") || "").toLowerCase() === "cover") {
          const item = manifest.get(meta.getAttribute("content"));
          if (item && item.type.startsWith("image/")) { coverItem = item; break; }
        }
      }
    }
    if (!coverItem) {
      for (const item of manifest.values()) {
        if (item.type.startsWith("image/") && /cover/i.test(item.path)) { coverItem = item; break; }
      }
    }
    let cover = null;
    if (coverItem && /^image\/(jpeg|jpg|png|webp|gif)$/.test(coverItem.type)) {
      try { cover = await zip.blob(coverItem.path, coverItem.type); } catch (e) {}
    }

    return { text: parts.join("\n\n"), title, author, cover };
  } finally {
    zip.close();
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
let pdfMod = null;
async function pdfLib() {
  if (!pdfMod) {
    pdfMod = await import(PDFJS_URL);
    pdfMod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  }
  return pdfMod;
}

// pdf.js yields positioned text runs. Rebuild lines from their baselines, then
// paragraphs from the gaps between lines.
function pageToText(items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    const y = it.transform ? it.transform[5] : 0;
    const x = it.transform ? it.transform[4] : 0;
    const h = it.height || (it.transform ? Math.abs(it.transform[3]) : 0) || 10;
    if (!cur || Math.abs(y - cur.y) > Math.max(2, h * 0.5)) {
      if (cur) lines.push(cur);
      cur = { y, h, x, endX: x + (it.width || 0), text: it.str };
    } else {
      const gap = x - cur.endX;
      // A visible gap between runs on one line is a word space pdf.js didn't emit.
      if (gap > h * 0.18 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += " ";
      cur.text += it.str;
      cur.endX = Math.max(cur.endX, x + (it.width || 0));
      cur.h = Math.max(cur.h, h);
    }
    if (it.hasEOL && cur) { lines.push(cur); cur = null; }
  }
  if (cur) lines.push(cur);

  const paras = [];
  let buf = "";
  let prev = null;
  for (const ln of lines) {
    const text = ln.text.replace(/\s+/g, " ").trim();
    if (!text) { if (buf) { paras.push(buf); buf = ""; } prev = null; continue; }
    if (prev) {
      const gap = Math.abs(prev.y - ln.y);
      const newPara = gap > Math.max(prev.h, ln.h) * 1.7 || ln.x - prev.x > ln.h * 1.2;
      if (newPara) { paras.push(buf); buf = text; }
      else if (/[A-Za-zÀ-ɏ]-$/.test(buf) && /^[a-zß-ÿ]/.test(text)) buf = buf.slice(0, -1) + text; // re-join a hyphenated break
      else buf += " " + text;
    } else {
      buf = text;
    }
    prev = ln;
  }
  if (buf) paras.push(buf);
  return paras;
}

async function renderPdfCover(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, COVER_MAX_WIDTH / Math.max(1, base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || null), "image/jpeg", 0.88));
}

async function readPdf(file, say) {
  say("Opening PDF…");
  const pdfjs = await pdfLib();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw new Error("the PDF is password-protected");
    throw new Error("the PDF couldn't be opened");
  }
  try {
    let title = "", author = "";
    try {
      const meta = await pdf.getMetadata();
      const info = (meta && meta.info) || {};
      title = typeof info.Title === "string" ? info.Title : "";
      author = typeof info.Author === "string" ? info.Author : "";
      // Many PDFs carry a junk title: the source file's name or the app that made it.
      if (/\.(docx?|pdf|indd|qxd|tex|rtf|pages|odt)$/i.test(title.trim()) || /^(untitled|microsoft word)/i.test(title.trim())) title = "";
    } catch (e) {}

    let cover = null;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (n === 1 || n % 10 === 0) say("Reading page " + n + " of " + pdf.numPages + "…");
      const page = await pdf.getPage(n);
      if (n === 1) { try { cover = await renderPdfCover(page); } catch (e) {} }
      const content = await page.getTextContent();
      pages.push(pageToText(content.items));
      page.cleanup();
    }

    // A paragraph that runs across a page break arrives as two pieces: glue
    // them when the first doesn't end a sentence and the second starts lowercase.
    const paras = [];
    for (const pagePars of pages) {
      for (let k = 0; k < pagePars.length; k++) {
        const p = pagePars[k];
        const last = paras[paras.length - 1];
        if (k === 0 && last && !/[.!?:;"'”’)\]]$/.test(last) && /^[a-zß-ÿ]/.test(p)) {
          paras[paras.length - 1] = /[A-Za-z]-$/.test(last) ? last.slice(0, -1) + p : last + " " + p;
        } else {
          paras.push(p);
        }
      }
    }
    const text = paras.join("\n\n");
    if (!text.trim()) throw new Error("this PDF has no text layer (it looks like scanned images)");
    return { text, title, author, cover };
  } finally {
    try { await pdf.destroy(); } catch (e) {}
  }
}
