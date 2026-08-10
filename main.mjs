import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { load as loadHtml } from "cheerio";
import { parseFile } from "music-metadata";
import NodeID3 from "node-id3";
import { parseSunoLink, sunoSongIdFromLink } from "./suno-links.mjs";
import { looksLikeLyrics } from "./content-validation.mjs";

const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus"]);
const EDITABLE_FIELDS = [
  "title", "artist", "album", "persona", "genre", "year", "track", "tags",
  "sunoUrl", "prompt", "lyrics", "syncedLyrics", "lyricsOffsetMs", "notes", "favorite", "artwork",
  "localVideoPath", "youtubeUrl", "videoOffsetMs",
];
const BULK_FIELDS = new Set(["album", "persona", "genre", "year", "tags"]);
const PUBLISHED_MANIFEST = ".sera-fm-published-library.json";
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
const defaultLibrary = { version: 4, sources: [], overrides: {}, settings: defaultSettings, published: {}, publishedEntries: {}, playlists: [] };

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
      version: 4,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      overrides: parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
      settings: mergeSettings(parsed.settings),
      published: parsed.published && typeof parsed.published === "object" ? parsed.published : {},
      publishedEntries: parsed.publishedEntries && typeof parsed.publishedEntries === "object" ? parsed.publishedEntries : {},
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read library:", error);
    return structuredClone(defaultLibrary);
  }
}

async function saveLibrary(library) {
  await fs.mkdir(path.dirname(libraryFile), { recursive: true });
  const temporaryFile = `${libraryFile}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify({ ...library, version: 4 }, null, 2), "utf8");
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

function normalizedPath(value) {
  return path.resolve(String(value || "")).toLowerCase();
}

function isInside(parent, child) {
  if (!parent || !child) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function publishedMetadata(song) {
  return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, song[field] ?? (field === "favorite" ? false : "")]));
}

async function loadPublishedManifest(folder) {
  if (!folder) return {};
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(folder, PUBLISHED_MANIFEST), "utf8"));
    return parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
  } catch {
    return {};
  }
}

async function savePublishedManifest(library) {
  const folder = library.settings.publishFolder;
  if (!folder) return;
  await fs.mkdir(folder, { recursive: true });
  const manifestPath = path.join(folder, PUBLISHED_MANIFEST);
  const temporaryPath = `${manifestPath}.tmp`;
  const payload = { version: 1, updatedAt: new Date().toISOString(), entries: library.publishedEntries || {} };
  await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(temporaryPath, manifestPath);
}

async function embeddedPublishedId(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".mp3") return "";
  try {
    const tags = NodeID3.read(filePath);
    return cleanString((tags.userDefinedText || []).find((item) => item.description === "SERA.FM Published ID")?.value);
  } catch {
    return "";
  }
}

async function reconcilePublishedEntries(library) {
  const folder = library.settings.publishFolder;
  if (!folder) return [];
  try { await fs.access(folder); } catch { return []; }
  const manifestEntries = await loadPublishedManifest(folder);
  library.publishedEntries = { ...manifestEntries, ...(library.publishedEntries || {}) };

  // Migrate the older original-path map without throwing away its organization data.
  for (const [originalPath, legacy] of Object.entries(library.published || {})) {
    if (!legacy?.path) continue;
    const existing = Object.values(library.publishedEntries).find((entry) => normalizedPath(entry.path) === normalizedPath(legacy.path));
    if (existing) continue;
    const publishedId = legacy.publishedId || crypto.randomUUID();
    library.publishedEntries[publishedId] = {
      id: publishedId,
      path: legacy.path,
      relativePath: isInside(folder, legacy.path) ? path.relative(folder, legacy.path) : path.basename(legacy.path),
      originalPath,
      publishedAt: legacy.publishedAt || new Date().toISOString(),
      metadata: { ...(library.overrides[originalPath] || {}) },
    };
    legacy.publishedId = publishedId;
  }

  const files = await walk(folder);
  const unmatchedEntries = () => Object.values(library.publishedEntries).filter((entry) => !entry.__matched);
  for (const filePath of files) {
    const relativePath = path.relative(folder, filePath);
    let entry = Object.values(library.publishedEntries).find((item) => normalizedPath(item.path) === normalizedPath(filePath)
      || String(item.relativePath || "").toLowerCase() === relativePath.toLowerCase());
    if (!entry) {
      const embeddedId = await embeddedPublishedId(filePath);
      if (embeddedId) entry = library.publishedEntries[embeddedId];
    }
    if (!entry) {
      const sameName = unmatchedEntries().filter((item) => path.basename(item.path || item.relativePath || "").toLowerCase() === path.basename(filePath).toLowerCase());
      if (sameName.length === 1) entry = sameName[0];
    }
    if (!entry) {
      const id = crypto.randomUUID();
      entry = library.publishedEntries[id] = { id, originalPath: "", publishedAt: new Date().toISOString(), metadata: {} };
    }
    entry.id ||= Object.keys(library.publishedEntries).find((id) => library.publishedEntries[id] === entry) || crypto.randomUUID();
    entry.path = filePath;
    entry.relativePath = relativePath;
    entry.__matched = true;
  }
  const active = Object.values(library.publishedEntries).filter((entry) => entry.__matched);
  for (const entry of Object.values(library.publishedEntries)) delete entry.__matched;
  return active;
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
  const publishedEntries = await reconcilePublishedEntries(library);
  const canonicalOriginals = new Set(publishedEntries.filter((entry) => entry.originalPath).map((entry) => normalizedPath(entry.originalPath)));
  for (const source of library.sources) {
    try {
      await fs.access(source.path);
    } catch {
      missingSources.push(source.id);
      continue;
    }
    const filePaths = (await walk(source.path)).filter((filePath) => {
      if (library.settings.publishFolder && isInside(library.settings.publishFolder, filePath)) return false;
      return !canonicalOriginals.has(normalizedPath(filePath));
    });
    for (let index = 0; index < filePaths.length; index += 12) {
      const batch = filePaths.slice(index, index + 12);
      const results = await Promise.all(
        batch.map((filePath) => readSong(filePath, source, library.overrides, library.published).catch(() => null)),
      );
      songs.push(...results.filter(Boolean));
    }
  }
  const publishedSource = { id: "sera-published", name: "Published Library", path: library.settings.publishFolder || "" };
  for (let index = 0; index < publishedEntries.length; index += 12) {
    const batch = publishedEntries.slice(index, index + 12);
    const results = await Promise.all(batch.map(async (entry) => {
      try {
        const base = await readSong(entry.path, publishedSource, {}, {});
        const merged = { ...base, ...(entry.metadata || {}) };
        merged.id = `published:${entry.id}`;
        merged.publishedId = entry.id;
        merged.filePath = entry.path;
        merged.fileUrl = pathToFileURL(entry.path).href;
        merged.fileName = path.basename(entry.path);
        merged.relativePath = path.relative(publishedSource.path, entry.path);
        merged.sourceId = publishedSource.id;
        merged.sourceName = publishedSource.name;
        merged.originalPath = entry.originalPath || "";
        merged.publishedPath = entry.path;
        merged.publishedAt = entry.publishedAt || "";
        merged.isPublished = true;
        merged.localVideoUrl = merged.localVideoPath ? pathToFileURL(merged.localVideoPath).href : "";
        return merged;
      } catch { return null; }
    }));
    songs.push(...results.filter(Boolean));
  }
  songs.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  await saveLibrary(library);
  if (library.settings.publishFolder) await savePublishedManifest(library).catch((error) => console.warn("Could not update published manifest:", error.message));
  return { songs, sources: library.sources, missingSources, settings: library.settings, playlists: library.playlists };
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

function firstLyricsCandidate(songObjects) {
  const paths = [
    "metadata.lyrics", "metadata.displayed_lyrics", "metadata.generated_lyrics", "lyrics", "displayed_lyrics",
    "metadata.prompt",
  ];
  for (const object of songObjects) {
    for (const keyPath of paths) {
      const value = firstValue(object, [keyPath]);
      if (looksLikeLyrics(value)) return value;
    }
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
  const rankedObjects = objects.sort((a, b) => scoreSongObject(b, songId) - scoreSongObject(a, songId));
  const song = rankedObjects[0] || {};
  const metadata = song.metadata && typeof song.metadata === "object" ? song.metadata : {};
  let title = firstValue(song, ["title", "name"]);
  if (!title) title = meta("og:title").replace(/\s*[|–-]\s*Suno\s*$/i, "").trim();
  const lyrics = firstLyricsCandidate(rankedObjects);
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

async function publishSong(song, settings, publishedId) {
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
  if (normalizedPath(song.filePath) !== normalizedPath(destination)) await fs.copyFile(song.filePath, destination);
  if (extension === ".mp3") {
    const artwork = dataUrlToImage(song.artwork);
    const userDefinedText = [
      ["Persona", song.persona], ["Suno URL", song.sunoUrl], ["Style Prompt", song.prompt], ["Notes", song.notes],
      ["YouTube URL", song.youtubeUrl], ["SERA.FM Published ID", publishedId],
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
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["*://*.youtube.com/*", "*://youtube.com/*", "*://*.googlevideo.com/*"] }, (details, callback) => {
    details.requestHeaders.Referer ||= "https://www.youtube.com/";
    details.requestHeaders.Origin ||= "https://www.youtube.com";
    callback({ requestHeaders: details.requestHeaders });
  });
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
  const metadata = publishedMetadata(song);
  if (song.publishedId && library.publishedEntries[song.publishedId]) {
    library.publishedEntries[song.publishedId].metadata = metadata;
    await savePublishedManifest(library);
  } else library.overrides[song.filePath] = metadata;
  await saveLibrary(library);
  return metadata;
});

ipcMain.handle("library:bulkSaveSongs", async (_event, { filePaths, changes }) => {
  if (!Array.isArray(filePaths) || !filePaths.length) throw new Error("Select at least one song.");
  const safeChanges = Object.fromEntries(Object.entries(changes || {}).filter(([field]) => BULK_FIELDS.has(field)));
  if (!Object.keys(safeChanges).length) throw new Error("Choose at least one field to update.");
  const library = await loadLibrary();
  for (const target of filePaths) {
    const id = typeof target === "object" ? target.publishedId : String(target).startsWith("published:") ? String(target).slice(10) : "";
    const filePath = typeof target === "object" ? target.filePath : target;
    if (id && library.publishedEntries[id]) library.publishedEntries[id].metadata = { ...(library.publishedEntries[id].metadata || {}), ...safeChanges };
    else library.overrides[filePath] = { ...(library.overrides[filePath] || {}), ...safeChanges };
  }
  if (library.settings.publishFolder) await savePublishedManifest(library);
  await saveLibrary(library);
  return safeChanges;
});

ipcMain.handle("library:savePlaylists", async (_event, playlists) => {
  const library = await loadLibrary();
  library.playlists = Array.isArray(playlists) ? playlists.slice(0, 200) : [];
  await saveLibrary(library);
  return library.playlists;
});

ipcMain.handle("window:toggleFullscreen", async () => {
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});

ipcMain.handle("window:exitFullscreen", async () => {
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  return false;
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
  const parts = (version) => String(version).replace(/^v/i, "").split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const current = parts(app.getVersion()); const latest = parts(latestVersion);
  let comparison = 0;
  for (let index = 0; index < 3; index++) { if ((latest[index] || 0) !== (current[index] || 0)) { comparison = (latest[index] || 0) > (current[index] || 0) ? 1 : -1; break; } }
  const available = comparison > 0;
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
      const originalPath = song.originalPath || song.filePath;
      const legacy = library.published[originalPath] || {};
      const publishedId = song.publishedId || legacy.publishedId || crypto.randomUUID();
      const result = await publishSong(song, library.settings, publishedId);
      const publishedAt = new Date().toISOString();
      if (!result.skipped) {
        library.published[originalPath] = { path: result.path, publishedAt, publishedId };
        library.publishedEntries[publishedId] = {
          id: publishedId, path: result.path, relativePath: path.relative(library.settings.publishFolder, result.path),
          originalPath, publishedAt, metadata: publishedMetadata(song),
        };
      }
      results.push({ filePath: song.filePath, title: song.title, status: result.skipped ? "skipped" : "published", path: result.path, publishedId });
    } catch (error) {
      results.push({ filePath: song.filePath, title: song.title, status: "failed", error: error.message });
    }
  }
  await savePublishedManifest(library);
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
    version: 4,
    sources: parsed.sources,
    overrides: parsed.overrides,
    settings: mergeSettings(parsed.settings),
    published: parsed.published && typeof parsed.published === "object" ? parsed.published : {},
    publishedEntries: parsed.publishedEntries && typeof parsed.publishedEntries === "object" ? parsed.publishedEntries : {},
    playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
  });
  return scanLibrary();
});
