# Audionook (desktop)

A standalone build of the Audionook text-to-speech audiobook app: paste text or open a
document, pick a narrator, and listen. Speech is generated on your own machine — no
server, no Docker, no account.

## Install on Windows

Every push builds a Windows installer and a portable zip with GitHub Actions. Open the
latest successful run under the repository's **Actions** tab and download the
`audionook-windows` artifact. It contains:

- `Audionook_<version>_x64-setup.exe` — the installer. Installs for the current user, no
  administrator rights needed.
- `Audionook-portable-x64.zip` — unzip and run `Audionook.exe`; nothing is installed.

Both need Microsoft Edge WebView2, which Windows 10 and 11 normally already have (the
installer fetches it if it is missing). The installer is not code-signed, so Windows
SmartScreen will warn the first time it runs.

The Light narrators work with no internet. The full-quality Kokoro narrators download
their model (about 90 MB on a machine without a graphics card, about 325 MB with one)
from Hugging Face the first time one is used.

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
downloads the Light voice model (about 8 MB) once.

To build the installer yourself you also need [Rust](https://rustup.rs) and, on Windows,
the Microsoft C++ Build Tools:

```bash
npm run build
```

## Layout

| Path | What it is |
|---|---|
| `app/` | The app: `index.html`, `src/` modules, generated `vendor/` libraries. See `app/README.md`. |
| `tools/build-vendor.mjs` | Assembles libraries and the Light voice runtime bundle. |
| `tools/serve.mjs` | Development server. |
| `src-tauri/` | The desktop shell (Tauri) and installer settings. |
| `.github/workflows/build.yml` | Builds the installer and portable zip on Windows. |
| `reference/` | Read-only copy of the original web app's source, for comparison. |

## What differs from the original web app

- Explore, public sharing and device-to-device sync are removed: they depended on the
  original host's servers.
- AI text clean-up, AI cover art and AI titles are shown but disabled until an AI provider
  is connected (`app/src/platform.js`).
- Titles come from the document or its file name; covers from an EPUB's cover image or a
  PDF's first page.
- Settings has a Speech engine choice: Best quality (Kokoro-82M on a graphics card),
  Balanced (Kokoro-82M on the processor) or Light & fast (Paradee-8M, built in).
- While audio plays, speech is generated about ten minutes ahead of the listener rather
  than all at once, which keeps small laptops responsive.
- Chart tick marks, axis numbers and bare page numbers are dropped when importing a PDF.
- Nothing loads from a CDN: libraries, fonts and the Light voice model are bundled.

## More

| Document | What it covers |
|---|---|
| [docs/HISTORY.md](docs/HISTORY.md) | How the project came to be, and who decided and did what |
| [CHANGELOG.md](CHANGELOG.md) | What changed, sprint by sprint |
| [docs/ROADMAP.md](docs/ROADMAP.md) | The next sprint and ideas saved for later |
| [CREDITS.md](CREDITS.md) | The original app, voice models, libraries and their licences |
| [AGENTS.md](AGENTS.md) | Working rules for AI agents contributing to this repository |
