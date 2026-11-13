// ===========================================================================
// vendor.js — where third-party libraries are loaded from.
//
// Every library the app needs is bundled under app/vendor/ so the desktop
// build never touches a CDN. URLs are absolute because several of them are
// imported from inside blob-URL workers, where relative paths don't resolve.
// ===========================================================================

const base = new URL("../vendor/", import.meta.url);
const at = (p) => new URL(p, base).href;

export const ZIP_URL = at("zipjs/zip.min.js");
export const PDFJS_URL = at("pdfjs/pdf.min.mjs");
export const PDFJS_WORKER_URL = at("pdfjs/pdf.worker.min.mjs");
