import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { load as loadHtml } from "cheerio";
import { parseFile } from "music-metadata";
import NodeID3 from "node-id3";
import { parseSunoLink, sunoSongIdFromLink } from "./suno-links.mjs";

const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus"]);
const EDITABLE_FIELDS = [
  "title", "artist", "album", "persona", "genre", "year", "track", "tags",
  "sunoUrl", "prompt", "lyrics", "syncedLyrics", "lyricsOffsetMs", "notes", "favorite", "artwork",
  "localVideoPath", "youtubeUrl", "videoOffsetMs",
];
const BULK_FIELDS = new Set(["album", "persona", "genre", "year"]);
const defaultSettings = {
  audioOutput: "default",
  defaultVolume: 0.85,
  rememberVolume: true,
  autoScan: true,
  publishFolder: "",
  duplicateBehavior: "replace",
  confirmPublishOverwrite: true,
  unorganizedFields: ["persona", "album"],
  collapsedSections: { personas: false, albums: false, folders: true },
  visualizer: { type: "cosmic", sensitivity: 1, smoothing: 0.82, showArtwork: true },
  theme: {
    primary: "#d88a53",
    secondary: "#35b9f1",
    glow: "#b760e6",
    background: "#07090e",
  },
};
const defaultLibrary = { version: 3, sources: [], overrides: {}, settings: defaultSettings, published: {} };

let mainWindow;
let libraryFile;

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLyrics(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === "string" ? entry : cleanString(entry?.text) || (Array.isArray(entry?.syncText) ? entry.syncText.map((part) => cleanString(part?.text)).filter(Boolean).join("\n") : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractSynchronizedLyrics(value) {
  if (!Array.isArray(value)) return [];
  const timed = value.find((entry) => Array.isArray(entry?.syncText) && entry.syncText.length);
  if (!timed) return [];
  return timed.syncText
    .map((part) => ({ startMs: Number(part.timestamp), text: cleanString(part.text) }))
    .filter((part) => Number.isFinite(part.startMs) && part.startMs >= 0 && part.text)
    .map((part, index, lines) => ({ ...part, endMs: lines[index + 1]?.startMs ?? part.startMs + 4000, words: [] }));
}

function mergeSettings(settings = {}) {
  return {
    ...defaultSettings,
    ...settings,
    collapsedSections: { ...defaultSettings.collapsedSections, ...(settings.collapsedSections || {}) },
    visualizer: { ...defaultSettings.visualizer, ...(settings.visualizer || {}) },
    unorganizedFields: Array.isArray(settings.unorganizedFields) ? settings.unorganizedFields : defaultSettings.unorganizedFields,
    theme: { ...defaultSettings.theme, ...(settings.theme || {}) },
  };
}

async function loadLibrary() {
  try {
    const raw = await fs.readFile(libraryFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: 3,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      overrides: parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
      settings: mergeSettings(parsed.settings),
      published: parsed.published && typeof parsed.published === "object" ? parsed.published : {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read library:", error);
    return structuredClone(defaultLibrary);
  }
}

async function saveLibrary(library) {
  await fs.mkdir(path.dirname(libraryFile), { recursive: true });
  const temporaryFile = `${libraryFile}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify({ ...library, version: 3 }, null, 2), "utf8");
  await fs.rename(temporaryFile, libraryFile);
}

async function walk(directory) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function artworkToDataUrl(picture) {
  if (!picture?.data || !picture?.format) return "";
  return `data:${picture.format};base64,${Buffer.from(picture.data).toString("base64")}`;
}

async function readSong(filePath, source, overrides, published) {
  const stat = await fs.stat(filePath);
  let metadata = { common: {}, format: {} };
  try {
    metadata = await parseFile(filePath, { duration: true, skipCovers: false });
  } catch (error) {
    console.warn(`Metadata could not be read for ${filePath}:`, error.message);
  }
  const common = metadata.common || {};
  const base = {
    id: filePath,
    filePath,
    fileUrl: pathToFileURL(filePath).href,
    sourceId: source.id,
    sourceName: source.name,
    relativePath: path.relative(source.path, filePath),
    fileName: path.basename(filePath),
    extension: path.extname(filePath).toLowerCase(),
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    title: cleanString(common.title) || path.basename(filePath, path.extname(filePath)),
    artist: cleanString(common.artist),
    album: cleanString(common.album),
    persona: "",
    genre: Array.isArray(common.genre) ? common.genre.join(", ") : cleanString(common.genre),
    year: common.year ? String(common.year) : "",
    track: common.track?.no ? String(common.track.no) : "",
    tags: "",
    sunoUrl: "",
    prompt: "",
    lyrics: normalizeLyrics(common.lyrics),
    syncedLyrics: extractSynchronizedLyrics(common.lyrics),
    lyricsOffsetMs: 0,
    notes: "",
    favorite: false,
    artwork: artworkToDataUrl(common.picture?.[0]),
    localVideoPath: "",
    localVideoUrl: "",
    youtubeUrl: "",
    videoOffsetMs: 0,
    duration: Number(metadata.format?.duration || 0),
    bitrate: Number(metadata.format?.bitrate || 0),
    publishedPath: published[filePath]?.path || "",
    publishedAt: published[filePath]?.publishedAt || "",
  };
  const merged = { ...base, ...(overrides[filePath] || {}) };
  merged.localVideoUrl = merged.localVideoPath ? pathToFileURL(merged.localVideoPath).href : "";
  return merged;
}

async function scanLibrary() {
  const library = await loadLibrary();
  const songs = [];
  const missingSources = [];
  for (const source of library.sources) {
    try {
      await fs.access(source.path);
    } catch {
      missingSources.push(source.id);
      continue;
    }
    const filePaths = await walk(source.path);
    for (let index = 0; index < filePaths.length; index += 12) {
      const batch = filePaths.slice(index, index + 12);
      const results = await Promise.all(
        batch.map((filePath) => readSong(filePath, source, library.overrides, library.published).catch(() => null)),
      );
      songs.push(...results.filter(Boolean));
    }
  }
  songs.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return { songs, sources: library.sources, missingSources, settings: library.settings };
}

function isSunoSongUrl(value) {
  return Boolean(parseSunoLink(value));
}

function firstValue(object, paths) {
  for (const keyPath of paths) {
    let current = object;
    for (const key of keyPath.split(".")) current = current?.[key];
    if (typeof current === "string" && current.trim()) return current.trim();
    if (typeof current === "number") return String(current);
  }
  return "";
}

function findSongObjects(value, songId, results = [], depth = 0) {
  if (!value || depth > 14) return results;
  if (Array.isArray(value)) {
    for (const entry of value) findSongObjects(entry, songId, results, depth + 1);
    return results;
  }
  if (typeof value !== "object") return results;
  const id = String(value.id || value.clip_id || value.song_id || "");
  const metadata = value.metadata;
  if (id === songId || (metadata && typeof metadata === "object" && (value.title || metadata.prompt || metadata.tags))) {
    results.push(value);
  }
  for (const child of Object.values(value)) findSongObjects(child, songId, results, depth + 1);
  return results;
}

function scoreSongObject(object, songId) {
  let score = String(object.id || object.clip_id || object.song_id || "") === songId ? 100 : 0;
  for (const key of ["title", "metadata", "image_url", "display_name", "duration"]) if (object[key]) score += 5;
  return score;
}

async function imageUrlToDataUrl(imageUrl) {
  if (!imageUrl || !/^https:\/\//i.test(imageUrl)) return "";
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 12 * 1024 * 1024) return "";
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

function normalizeTimedLyrics(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const startMs = Number(entry?.startMs ?? entry?.start_time_ms ?? (entry?.start_s != null ? entry.start_s * 1000 : undefined) ?? (entry?.start != null ? entry.start * 1000 : undefined));
    const endMs = Number(entry?.endMs ?? entry?.end_time_ms ?? (entry?.end_s != null ? entry.end_s * 1000 : undefined) ?? (entry?.end != null ? entry.end * 1000 : undefined));
    const text = cleanString(entry?.text || entry?.word || entry?.lyric);
    return { startMs, endMs: Number.isFinite(endMs) ? endMs : startMs + 1200, text, words: [] };
  }).filter((entry) => Number.isFinite(entry.startMs) && entry.startMs >= 0 && entry.text);
}

async function readSunoPage(sunoUrl) {
  const requestedLink = parseSunoLink(sunoUrl);
  if (!requestedLink) throw new Error("Enter a valid https://suno.com/song/... or https://suno.com/s/... link.");
  const response = await fetch(requestedLink.url.href, {
    headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SERA.FM-Music-Library/0.3" },
    redirect: "follow",
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new Error(`Suno returned ${response.status}. The song may require login or may not be publicly readable.`);
  const finalLink = parseSunoLink(response.url);
  if (!finalLink) throw new Error("Suno redirected this link somewhere the app cannot safely read.");
  const html = await response.text();
  const $ = loadHtml(html);
  const meta = (property) => $(`meta[property="${property}"], meta[name="${property}"]`).first().attr("content")?.trim() || "";
  const canonicalCandidates = [
    $("link[rel='canonical']").first().attr("href") || "",
    meta("og:url"),
    response.url,
    requestedLink.url.href,
  ];
  const canonicalLink = canonicalCandidates
    .map((candidate) => parseSunoLink(candidate, response.url))
    .find((candidate) => candidate?.kind === "song") || finalLink;
  const songId = sunoSongIdFromLink(canonicalLink.url.href)
    || (requestedLink.kind === "song" ? requestedLink.token : "");
  const objects = [];
  $("script").each((_index, element) => {
    const text = $(element).html()?.trim();
    if (!text || (!text.startsWith("{") && !text.startsWith("["))) return;
    try { findSongObjects(JSON.parse(text), songId, objects); } catch { /* Non-JSON script. */ }
  });
  const song = objects.sort((a, b) => scoreSongObject(b, songId) - scoreSongObject(a, songId))[0] || {};
  const metadata = song.metadata && typeof song.metadata === "object" ? song.metadata : {};
  let title = firstValue(song, ["title", "name"]);
  if (!title) title = meta("og:title").replace(/\s*[|–-]\s*Suno\s*$/i, "").trim();
  const lyrics = firstValue({ song, metadata }, ["metadata.lyrics", "metadata.prompt", "song.lyrics"]);
  const prompt = firstValue({ song, metadata }, [
    "metadata.tags", "metadata.style_prompt", "metadata.style", "song.style_prompt", "song.tags",
  ]);
  const persona = firstValue({ song, metadata }, [
    "metadata.persona_model_name", "metadata.persona_name", "song.persona_name", "song.voice_name",
  ]);
  const artist = firstValue(song, ["display_name", "handle", "artist", "creator.display_name", "user.display_name"]);
  const imageUrl = firstValue(song, ["image_large_url", "image_url", "artwork_url"]) || meta("og:image");
  const artwork = await imageUrlToDataUrl(imageUrl);
  const timingCandidates = [metadata.aligned_words, metadata.word_timestamps, metadata.lyric_timestamps, song.aligned_words, song.word_timestamps];
  const syncedLyrics = timingCandidates.map(normalizeTimedLyrics).find((value) => value.length) || [];
  const fields = {
    title,
    artist,
    persona,
    lyrics,
    prompt,
    artwork,
    syncedLyrics,
    genre: firstValue({ song, metadata }, ["metadata.genre", "song.genre"]),
    year: firstValue(song, ["created_at"]).slice(0, 4),
  };
  const available = Object.fromEntries(Object.entries(fields).filter(([, value]) => Array.isArray(value) ? value.length : Boolean(value)));
  if (!Object.keys(available).length) {
    throw new Error("The page loaded, but Suno did not expose readable song information. It may require login or its page format may have changed.");
  }
  return {
    fields: available,
    canonicalUrl: canonicalLink.url.href,
    originalUrl: requestedLink.url.href,
    foundFields: Object.keys(available),
  };
}

function sanitizePathPart(value, fallback) {
  const cleaned = String(value || "").replace(/[<>:\"/\\|?*\u0000-\u001F]/g, "-").replace(/[. ]+$/g, "").trim();
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  return !cleaned || reserved.test(cleaned) ? fallback : cleaned.slice(0, 120);
}

function dataUrlToImage(value) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value || "");
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function nextAvailablePath(targetPath) {
  const extension = path.extname(targetPath);
  const base = targetPath.slice(0, -extension.length);
  for (let number = 2; number < 10000; number += 1) {
    const candidate = `${base} (${number})${extension}`;
    try { await fs.access(candidate); } catch { return candidate; }
  }
  throw new Error("Could not create a unique published filename.");
}

async function publishSong(song, settings) {
  await fs.access(song.filePath);
  const persona = sanitizePathPart(song.persona || song.artist, "Unknown Artist");
  const album = sanitizePathPart(song.album, "Singles");
  const title = sanitizePathPart(song.title, path.basename(song.filePath, path.extname(song.filePath)));
  const trackPrefix = song.track ? `${String(song.track).padStart(2, "0")} - ` : "";
  const extension = path.extname(song.filePath).toLowerCase() || ".mp3";
  const directory = path.join(settings.publishFolder, persona, album);
  await fs.mkdir(directory, { recursive: true });
  let destination = path.join(directory, `${trackPrefix}${title}${extension}`);
  let exists = false;
  try { await fs.access(destination); exists = true; } catch { /* Available. */ }
  if (exists && settings.duplicateBehavior === "skip") return { skipped: true, path: destination };
  if (exists && settings.duplicateBehavior === "number") destination = await nextAvailablePath(destination);
  await fs.copyFile(song.filePath, destination);
  if (extension === ".mp3") {
    const artwork = dataUrlToImage(song.artwork);
    const userDefinedText = [
      ["Persona", song.persona], ["Suno URL", song.sunoUrl], ["Style Prompt", song.prompt], ["Notes", song.notes],
      ["YouTube URL", song.youtubeUrl],
    ].filter(([, value]) => cleanString(value)).map(([description, value]) => ({ description, value: String(value) }));
    const tags = {
      title: cleanString(song.title),
      artist: cleanString(song.artist || song.persona),
      performerInfo: cleanString(song.persona || song.artist),
      album: cleanString(song.album),
      genre: cleanString(song.genre),
      year: cleanString(song.year),
      trackNumber: cleanString(song.track),
      unsynchronisedLyrics: cleanString(song.lyrics) ? { language: "eng", text: song.lyrics } : undefined,
      synchronisedLyrics: Array.isArray(song.syncedLyrics) && song.syncedLyrics.length ? [{
        language: "eng",
        timeStampFormat: NodeID3.TagConstants.TimeStampFormat.MILLISECONDS,
        contentType: NodeID3.TagConstants.SynchronisedLyrics.ContentType.LYRICS,
        shortText: "SERA.FM synchronized lyrics",
        synchronisedText: song.syncedLyrics.map((line) => ({ text: cleanString(line.text), timeStamp: Math.max(0, Math.round(Number(line.startMs) || 0)) })).filter((line) => line.text),
      }] : undefined,
      userDefinedText: userDefinedText.length ? userDefinedText : undefined,
      image: artwork ? {
        mime: artwork.mime,
        type: { id: 3, name: "front cover" },
        description: "Cover",
        imageBuffer: artwork.buffer,
      } : undefined,
    };
    const success = NodeID3.update(Object.fromEntries(Object.entries(tags).filter(([, value]) => value !== undefined && value !== "")), destination);
    if (!success) throw new Error(`Could not write MP3 metadata for ${song.title}.`);
  }
  return { skipped: false, path: destination };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: "#07090e",
    title: "SERA.FM Music Library",
    icon: path.join(import.meta.dirname, "assets", "sera-logo.png"),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(import.meta.dirname, "src", "index.html"));
}

app.whenReady().then(() => {
  libraryFile = path.join(app.getPath("userData"), "library.json");
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === "speaker-selection");
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === "speaker-selection"));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

ipcMain.handle("library:selectFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a folder containing your music",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const selectedPath = result.filePaths[0];
  const library = await loadLibrary();
  const existing = library.sources.find((source) => source.path.toLowerCase() === selectedPath.toLowerCase());
  if (!existing) {
    library.sources.push({ id: crypto.randomUUID(), name: path.basename(selectedPath) || selectedPath, path: selectedPath, addedAt: new Date().toISOString() });
    await saveLibrary(library);
  }
  return scanLibrary();
});

ipcMain.handle("library:get", scanLibrary);

ipcMain.handle("library:saveSong", async (_event, song) => {
  if (!song?.filePath) throw new Error("A song file location is required.");
  const library = await loadLibrary();
  library.overrides[song.filePath] = Object.fromEntries(
    EDITABLE_FIELDS.map((field) => [field, song[field] ?? (field === "favorite" ? false : "")]),
  );
  await saveLibrary(library);
  return library.overrides[song.filePath];
});

ipcMain.handle("library:bulkSaveSongs", async (_event, { filePaths, changes }) => {
  if (!Array.isArray(filePaths) || !filePaths.length) throw new Error("Select at least one song.");
  const safeChanges = Object.fromEntries(Object.entries(changes || {}).filter(([field]) => BULK_FIELDS.has(field)));
  if (!Object.keys(safeChanges).length) throw new Error("Choose at least one field to update.");
  const library = await loadLibrary();
  for (const filePath of filePaths) library.overrides[filePath] = { ...(library.overrides[filePath] || {}), ...safeChanges };
  await saveLibrary(library);
  return safeChanges;
});

ipcMain.handle("library:removeSource", async (_event, sourceId) => {
  const library = await loadLibrary();
  library.sources = library.sources.filter((source) => source.id !== sourceId);
  await saveLibrary(library);
  return scanLibrary();
});

ipcMain.handle("library:reveal", async (_event, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle("library:openExternal", async (_event, url) => {
  const parsed = parseSunoLink(url);
  if (!parsed) throw new Error("Enter a valid Suno song or share link first.");
  await shell.openExternal(parsed.url.href);
  return true;
});
ipcMain.handle("library:readSunoPage", async (_event, url) => readSunoPage(url));

ipcMain.handle("library:selectArtwork", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose song or album artwork",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const bytes = await fs.readFile(filePath);
  if (bytes.length > 12 * 1024 * 1024) throw new Error("Choose artwork smaller than 12 MB.");
  const mime = ({ ".png": "image/png", ".webp": "image/webp" })[path.extname(filePath).toLowerCase()] || "image/jpeg";
  return { artwork: `data:${mime};base64,${bytes.toString("base64")}`, fileName: path.basename(filePath) };
});

ipcMain.handle("library:selectVideo", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a video for this song",
    properties: ["openFile"],
    filters: [{ name: "Videos", extensions: ["mp4", "webm", "mkv", "mov", "m4v"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  return { filePath, fileUrl: pathToFileURL(filePath).href, fileName: path.basename(filePath) };
});

ipcMain.handle("library:selectLyricsFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import synchronized lyrics",
    properties: ["openFile"],
    filters: [{ name: "Timed lyrics", extensions: ["lrc", "vtt", "srt"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const stat = await fs.stat(filePath);
  if (stat.size > 2 * 1024 * 1024) throw new Error("Choose a timed-lyrics file smaller than 2 MB.");
  return { text: await fs.readFile(filePath, "utf8"), fileName: path.basename(filePath), extension: path.extname(filePath).toLowerCase() };
});

ipcMain.handle("library:openTrustedExternal", async (_event, value) => {
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid web link."); }
  const host = url.hostname.toLowerCase();
  const trusted = url.protocol === "https:" && (host === "github.com" || host.endsWith(".github.com") || host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host === "suno.com" || host.endsWith(".suno.com"));
  if (!trusted) throw new Error("Only trusted Suno, YouTube, and GitHub links can be opened.");
  await shell.openExternal(url.href);
  return true;
});

ipcMain.handle("library:getAppInfo", async () => ({
  version: app.getVersion(),
  repositoryUrl: "https://github.com/Onewingseraphim/sera-fm-music-library",
  releasesUrl: "https://github.com/Onewingseraphim/sera-fm-music-library/releases",
  changelog: await fs.readFile(path.join(import.meta.dirname, "CHANGELOG.md"), "utf8").catch(() => "# Patch notes\n\nNo patch notes are bundled with this build."),
}));

ipcMain.handle("library:checkUpdates", async () => {
  const response = await fetch("https://api.github.com/repos/Onewingseraphim/sera-fm-music-library/releases/latest", {
    headers: { "accept": "application/vnd.github+json", "user-agent": `SERA.FM-Music-Library/${app.getVersion()}` },
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 404) return { available: false, currentVersion: app.getVersion(), message: "No public releases have been published yet." };
  if (!response.ok) throw new Error(`GitHub returned ${response.status} while checking for updates.`);
  const release = await response.json();
  const latestVersion = String(release.tag_name || release.name || "").replace(/^v/i, "");
  const parts = (version) => String(version).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const current = parts(app.getVersion()); const latest = parts(latestVersion);
  const available = latest.some((part, index) => part > (current[index] || 0) && latest.slice(0, index).every((earlier, earlierIndex) => earlier === (current[earlierIndex] || 0)));
  return { available, currentVersion: app.getVersion(), latestVersion, releaseName: release.name || `Version ${latestVersion}`, releaseNotes: release.body || "", releaseUrl: release.html_url, publishedAt: release.published_at };
});

ipcMain.handle("library:getSettings", async () => (await loadLibrary()).settings);
ipcMain.handle("library:saveSettings", async (_event, settings) => {
  const library = await loadLibrary();
  library.settings = mergeSettings(settings);
  await saveLibrary(library);
  return library.settings;
});
ipcMain.handle("library:selectPublishFolder", async () => {
  const library = await loadLibrary();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose the Published Music Library folder",
    defaultPath: library.settings.publishFolder || path.join(app.getPath("documents"), "SERA.FM Published Library"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  library.settings.publishFolder = result.filePaths[0];
  await saveLibrary(library);
  return library.settings;
});

ipcMain.handle("library:publishSongs", async (_event, songs) => {
  if (!Array.isArray(songs) || !songs.length) throw new Error("Select at least one song to publish.");
  const library = await loadLibrary();
  if (!library.settings.publishFolder) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose the Published Music Library folder",
      defaultPath: path.join(app.getPath("documents"), "SERA.FM Published Library"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    library.settings.publishFolder = result.filePaths[0];
  }
  const results = [];
  for (const song of songs) {
    try {
      const result = await publishSong(song, library.settings);
      if (!result.skipped) library.published[song.filePath] = { path: result.path, publishedAt: new Date().toISOString() };
      results.push({ filePath: song.filePath, title: song.title, status: result.skipped ? "skipped" : "published", path: result.path });
    } catch (error) {
      results.push({ filePath: song.filePath, title: song.title, status: "failed", error: error.message });
    }
  }
  await saveLibrary(library);
  return { results, settings: library.settings };
});

ipcMain.handle("library:backup", async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Back up your music catalog",
    defaultPath: `SERA-FM-library-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON backup", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, JSON.stringify(await loadLibrary(), null, 2), "utf8");
  return true;
});

ipcMain.handle("library:restore", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Restore a music catalog backup",
    properties: ["openFile"],
    filters: [{ name: "JSON backup", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const parsed = JSON.parse(await fs.readFile(result.filePaths[0], "utf8"));
  if (!Array.isArray(parsed.sources) || typeof parsed.overrides !== "object") throw new Error("That file is not a valid music-library backup.");
  await saveLibrary({
    version: 3,
    sources: parsed.sources,
    overrides: parsed.overrides,
    settings: mergeSettings(parsed.settings),
    published: parsed.published && typeof parsed.published === "object" ? parsed.published : {},
  });
  return scanLibrary();
});
