# Changelog

Changes are grouped by sprint, newest first. Versions follow the app version in
`package.json` and `src-tauri/tauri.conf.json`.

## Unreleased — fixes from testing on a high-end PC

- **Fixed: a book stopped loading after the speech engine was switched.** Changing between
  Kokoro levels with a book open left the player with no narrator, so every segment failed
  and the book stayed on "buffering". The book now reloads with the new narrator.
- **Fixed: switching Kokoro levels replayed old audio.** Audio from the full model, the
  compact model, and the graphics card is now cached separately, so a change can be heard.
- **Best quality now always uses the full Kokoro model**, on the graphics card when there is
  one and otherwise on the processor. Before, a machine without a graphics card silently
  got the compact model under both Kokoro levels. Measured on a processor, the compact
  model is no faster than the full one; it is only a smaller download.
- **Graphics card On/Off** appears under Best quality on machines that have one, to work
  round graphics drivers that produce garbled speech.
- **Loading progress is shown for a newly selected engine.** The status line used to keep
  saying "Narration ready" while Kokoro was still downloading.
- A superseded engine start-up can no longer mark the new engine as failed.

## 0.1.0 — first stable release

### After the first hands-on test

- **Speech engine setting.** Settings offers Best quality (Kokoro-82M on a graphics card),
  Balanced (Kokoro-82M on the processor) and Light & fast (Paradee-8M). The narrator list
  shows the chosen engine's voices, and the narrator carries across when one exists in both.
  Replaces the earlier Graphics acceleration switch.
- **Generate-ahead limit.** While audio plays, speech is generated about ten minutes ahead
  of the listener instead of racing through the whole book. The limit lifts when paused and
  during an MP3 export.
- **Engine warm-up.** The Light engine loads shortly after the app opens and stays loaded,
  so the first Play does not wait for it.
- **PDF chart debris removed.** Text drawn at an angle and paragraphs with no letters
  (chart tick marks, axis numbers, bare page numbers) are no longer imported.

### Sprint 2 — a working app and an installer

- Page skeleton rebuilt; the app starts and narrates with no network access.
- Libraries, fonts and the Light voice model bundled by `npm run vendor`.
- Books made from a file take its title, author and cover (EPUB cover image, or a PDF's
  first page).
- AI text clean-up and AI cover art shown but disabled; AI titling off.
- Explore, public sharing and device sync removed from the interface.
- "From a URL…" keeps paragraph breaks, and in the desktop app fetches pages natively.
- The Create box empties once a book is made.
- Desktop shell (Tauri) and a GitHub Actions build producing an NSIS installer and a
  portable zip.
- The unrelated upstream files (README, Makefile, Docker files, licence) removed.

### Sprint 1 — foundations

- Original app source recovered and stored in `reference/perchance-src/`.
- New modules: `import.js` (TXT, Markdown, HTML, RTF, PDF, DOCX, ODT, EPUB), `crop.js`,
  `devicePerf.js`, `syncmeta.js`.
- `platform.js`: local replacement for the host's plugins, with the feature switches.
- Inert stand-ins for the Explore client and device sync.
