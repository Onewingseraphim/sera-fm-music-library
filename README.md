# SERA.FM Music Library

An open-source, local-first Windows music player and organizer for downloaded music collections, with additional support for Suno song pages.

## Highlights

- Scan multiple music folders without moving or rewriting originals.
- Organize songs by persona, album, favorites, publication status, and configurable missing metadata.
- Edit one song or mass edit persona, album, genre, and year.
- View artwork, details, prompts, notes, and lyrics on a full Now Playing page.
- Import synchronized `.lrc`, `.vtt`, and `.srt` lyrics with line and word highlighting.
- Read embedded ID3 synchronized lyrics and write them to published MP3 copies.
- Attach a local video and/or YouTube link to each song.
- Use built-in spectrum, waveform, radial, mirrored, and SERA.FM Cosmic visualizers.
- Choose from audio output devices currently available in Windows.
- Accept both `suno.com/song/...` and Link Only `suno.com/s/...` share links.
- Publish managed copies with rewritten MP3 metadata, lyrics, artwork, and SERA.FM fields.
- Customize the interface theme and back up or restore the complete catalog.
- Read patch notes and check GitHub Releases from inside the app.

## Safety and privacy

Catalog edits are stored under the Windows application-data folder. Source audio and attached video files stay in their original locations. Files are only copied and rewritten when **Publish copy** is used. Suno page reading is user-triggered and does not use account cookies or a private API.

## Windows installation

Download the newest build from [GitHub Releases](https://github.com/Onewingseraphim/sera-fm-music-library/releases), extract the ZIP, and open `SERA.FM Music Library.exe`. Windows SmartScreen may warn because early community builds are not digitally signed.

The in-app update checker opens the newest GitHub Release. Fully automatic install-and-restart updates will arrive with the signed installer distribution.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

Create a Windows x64 portable build:

```bash
npm run build
npm run package:win
```

## Project status

Version 0.3.0 is a functional preview. Suno page import and YouTube embedding depend on third-party page availability. Automatic lyric alignment and per-device Windows loopback visualization are planned; imported or embedded timings are supported now.

## License

[MIT](LICENSE)
