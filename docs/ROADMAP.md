# Roadmap

Development is paused at 0.1.0, the first stable release. This file is the plan for picking
it back up. Nothing below has been started unless it says so.

## Sprint 3 — improve what exists, fix what's wrong

No new features. The aim is to make the current app dependable and to check the parts that
have only been tested in a headless browser.

### 1. Put the tests in the repository

Every change so far was checked with throwaway browser scripts that were never committed.
Before anything else, turn them into a suite that runs with one command and in the GitHub
Actions build:

- starts with no network access and reaches the Create screen with no errors;
- narrates a short text with a Light voice and produces decodable audio;
- reads one sample of every document format, with title, author and cover;
- the Speech engine setting switches, carries the narrator across and persists;
- the generate-ahead limit holds while playing, lifts when paused and during export;
- MP3 export completes;
- PDF chart debris is dropped.

### 2. Verify on Windows

These work in a browser but are unconfirmed in the installed app. Each needs one pass on a
real machine, and a fix where it fails:

- Download as MP3 (does the file save, and where?)
- Backup, Import, and folder sync
- "From a URL…" through the native fetch
- Installing a new version over an old one keeps the library
- The Best quality engine on a machine with a graphics card
- The portable zip on a machine that has never had the app installed

### 3. Document import quality

The PDF fix in 0.1.0 removes chart debris that contains no letters. Still getting through:

- chart labels and legends made of words;
- figure and table captions, and table contents;
- running headers and footers repeated on every page;
- footnotes and reference lists.

Approach: use what pdf.js already reports — font size relative to the body text, position
on the page, and lines that repeat across pages — rather than guessing from the words.
Make it a visible choice ("Clean up for listening") so the reader can turn it off, and let
it stand in for the disabled AI "Reformat text" button on documents that only need tidying.

Also: a book already in the library keeps the text it was imported with. Offer a way to
re-import a book from its file without losing its position and bookmarks.

### 4. Known rough edges

| Issue | Detail |
|---|---|
| Kokoro downloads as soon as Balanced is chosen | Switching engine rebuilds it immediately. With no internet this shows an error. Download on first use instead, with visible progress. |
| "Untitled" books | Pasted text whose first line is longer than 80 characters gets no title. Fall back to the first few words. |
| Unused code still ships | The Explore, sharing and publish code is unreachable but still loaded. Remove it or stop loading it. |
| Legacy Light voices | Three retired voice engines still point at Hugging Face. Nothing in a fresh install uses them. |
| Graphics self-test | Fetches small test files from Hugging Face before using a graphics card. Decide whether to bundle them or skip the test offline. |
| Security policy | The desktop shell sets no content security policy. Write one that allows only what the app uses. |
| Installer warning | The installer is unsigned, so Windows SmartScreen warns on first run. Needs a code-signing certificate. |

## Saved for later sprints

Ideas raised and deliberately set aside. Each needs its own decision before work starts.

**Smoother listening.** Two changes that would make narration sound continuous:

- *One continuous stream.* Today each sentence or two is its own MP3 clip, and two hidden
  players take turns. Feeding the clips into a single player as one track would remove the
  small hitch between them. Measure the gap first to confirm it is worth the rework.
- *Cut only at sentence ends.* A sentence longer than 300 characters is split at a comma or
  a space. Splitting only at sentence ends, with a short pause between sentences and a
  longer one between paragraphs, puts every seam where a narrator would pause anyway.
- *A shorter first clip*, so speech starts sooner on slow machines.

All three change how a book is divided into clips. Saved positions and bookmarks are stored
as clip numbers, so existing libraries would need converting. Plan that before starting.

**A middle speech engine.** The app has two model sizes, 82M and 8M. "Balanced" is the large
model in its lighter form, not a mid-sized one. A true middle tier means adding a third
engine. Candidates to evaluate — none has been tested here — include KittenTTS, Supertonic
and Piper. For each: speech quality, speed on a laptop with no graphics card, whether it
runs inside the app's existing ONNX runtime, download size, and licence.

**Connect an AI provider.** `platform.js` has the hook (`connectAi`). Supplying a provider
re-enables text clean-up, cover art and automatic titles together. Decide which service,
where the key is stored, and what is sent to it.

**Kokoro without a download.** An optional larger installer, or a "download now" button, so
the full-quality voices work on a machine that is never online.

**Distribution.** Automatic updates, macOS and Linux builds, and settling the licence
position described in `CREDITS.md` before sharing builds more widely.
