# SERA.FM Music Library Patch Notes

## 0.3.0 — Library Player Update

### New

- Added the full Now Playing page with artwork, metadata, prompt, notes, lyrics, and media controls.
- Added collapsible Personas, Albums, and Music Folders sidebar sections with remembered state.
- Added configurable Unorganized rules.
- Added local video attachments and embedded YouTube playback.
- Added `.lrc`, `.vtt`, and `.srt` synchronized-lyrics importing.
- Added line highlighting, approximate word highlighting, auto-scroll, click-to-seek, and timing offsets.
- Added reading and publishing of embedded ID3 `SYLT` synchronized lyrics.
- Added Spectrum Bars, Mirrored Spectrum, Waveform, Radial, and SERA.FM Cosmic visualizers.
- Added the Updates & Patch Notes page and GitHub release checker.
- Added GitHub Actions release packaging for version tags.

### Improved

- Renamed Needs Organizing to Unorganized and Published Copies to Published.
- Added a cleaner sidebar hierarchy matching the requested navigation.
- Added a Suno-style detailed presentation for the currently playing song.
- Suno Link Only `/s/...` share URLs now pass validation and resolve to their song page.
- Suno errors no longer expose Electron remote-method wording.
- Published MP3 copies can include synchronized lyrics and YouTube metadata.

### Known limitations

- Suno page import is best effort because Suno does not provide a documented public song-data API.
- YouTube controls and audio are isolated by YouTube; the local audio visualizer cannot inspect the embedded stream.
- The current portable ZIP checks for updates and opens the release page. Automatic install-and-restart requires the future installer build.
- Automatic vocal-to-lyric alignment and exact Windows per-device loopback capture are planned, not included in 0.3.0.

## 0.2.1

### Fixed

- Added validation support for `suno.com/s/...` share links.

## 0.2.0

### New

- Added mass metadata editing, Published Library copies, Suno page reading, output-device selection, themes, artwork editing, and catalog backup/restore.

## 0.1.1

### Fixed

- Corrected the Electron preload bridge used by folder selection and local-library actions.
