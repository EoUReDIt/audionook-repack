# Audionook (desktop)

A standalone build of the Audionook text-to-speech audiobook app: paste text or open a
document, pick a narrator, and listen. Speech is generated on your own machine — no
server, no Docker, no account.

**Status: in progress.** The app runs in a browser from this repo and narrates fully
offline with the Light voices. The Windows installer is not built yet.

## Run it from source

Needs [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
```

```bash
npm run vendor
```

```bash
npm run serve
```

Then open http://localhost:5173. `npm run vendor` gathers the third-party libraries and
downloads the Light voice model (about 8 MB) once; after that the Light voices need no
internet. The full-quality Kokoro voices download their model (about 325 MB) from Hugging
Face the first time one is used.

## Layout

| Path | What it is |
|---|---|
| `app/` | The app: `index.html`, `src/` modules, generated `vendor/` libraries. See `app/README.md`. |
| `tools/build-vendor.mjs` | Assembles libraries and the Light voice runtime bundle. |
| `tools/serve.mjs` | Development server. |
| `reference/` | Read-only copy of the original web app's source, for comparison. |

## What differs from the original web app

- Explore, public sharing and device-to-device sync are removed: they depended on the
  original host's servers.
- AI text clean-up, AI cover art and AI titles are switched off until an AI provider is
  connected (`app/src/platform.js`).
- Titles come from the document or its file name; covers from an EPUB's cover image or a
  PDF's first page.
