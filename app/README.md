# app/

The standalone (Docker-free, server-free) build of the Audionook text-to-speech app.

- `src/` — the app's modules. Most are unmodified copies of `reference/perchance-src/`.
  Written for this build:
  - `platform.js` — local replacement for the hosting site's plugins, plus the feature
    switches (`explore`, `sharing`, `deviceSync`, `ai`).
  - `vendor.js` — the single list of where bundled third-party libraries load from.
  - `import.js` — reads TXT, Markdown, HTML, RTF, PDF, DOCX, ODT and EPUB into text,
    with title, author and cover where the document has them.
  - `crop.js` — cover cropper.
  - `devicePerf.js` — first-run check that picks a Light narrator on slow machines.
  - `syncmeta.js` — revision stamps for library records.
  - `net.js`, `devicesync.js` — inert stand-ins for the server-backed originals.
- `vendor/` — third-party libraries, bundled so nothing loads from a CDN.

The desktop wrapper lives in `../src-tauri/`.
