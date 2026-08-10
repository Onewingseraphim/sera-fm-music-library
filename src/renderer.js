const DEFAULT_SETTINGS = {
  audioOutput: "default", defaultVolume: 0.85, rememberVolume: true, autoScan: true,
  publishFolder: "", duplicateBehavior: "replace", confirmPublishOverwrite: true,
  unorganizedFields: ["persona", "album"], collapsedSections: { personas: false, albums: false, folders: true },
  visualizer: { type: "cosmic", sensitivity: 1, smoothing: 0.82, showArtwork: true },
  theme: { primary: "#d88a53", secondary: "#35b9f1", glow: "#b760e6", background: "#07090e" },
};

if (!window.seraLibrary && new URLSearchParams(location.search).has("preview")) {
  const previewLyrics = [
    { startMs: 0, endMs: 4200, text: "This is an example lyric line", words: [] },
    { startMs: 4200, endMs: 8200, text: "The next line highlights with the music", words: [] },
    { startMs: 8200, endMs: 12600, text: "Timed lyrics can scroll automatically", words: [] },
  ];
  const songs = [
    { id: "preview-1", filePath: "C:\\Music\\Example Artist\\Example Song.mp3", fileUrl: "", sourceId: "preview", sourceName: "Example Music", relativePath: "Example Artist\\Example Song.mp3", fileName: "Example Song.mp3", extension: ".mp3", title: "Example Song", artist: "Example Artist", persona: "Example Persona", album: "Example Album", genre: "Electronic / Rock", year: "2026", track: "1", tags: "example, organized", sunoUrl: "", prompt: "Example style prompt for preview mode.", lyrics: previewLyrics.map((line) => line.text).join("\n"), syncedLyrics: previewLyrics, lyricsOffsetMs: 0, notes: "Generic preview entry.", favorite: true, artwork: "", duration: 248, bitrate: 320000, publishedPath: "C:\\Published Music\\Example Persona\\Example Album\\01 - Example Song.mp3", localVideoPath: "", localVideoUrl: "", youtubeUrl: "", videoOffsetMs: 0 },
    { id: "preview-2", filePath: "C:\\Music\\Second Example.mp3", fileUrl: "", sourceId: "preview", sourceName: "Example Music", relativePath: "Second Example.mp3", fileName: "Second Example.mp3", extension: ".mp3", title: "Second Example", artist: "Demo Artist", persona: "Demo Voice", album: "Demo Collection", genre: "Pop", year: "2026", track: "1", tags: "example", sunoUrl: "", prompt: "Another generic preview prompt.", lyrics: "Example lyric text.", syncedLyrics: [], lyricsOffsetMs: 0, notes: "", favorite: false, artwork: "", duration: 213, bitrate: 320000, publishedPath: "", localVideoPath: "", localVideoUrl: "", youtubeUrl: "", videoOffsetMs: 0 },
    { id: "preview-3", filePath: "C:\\Music\\Unorganized Example.mp3", fileUrl: "", sourceId: "preview", sourceName: "Example Music", relativePath: "Unorganized Example.mp3", fileName: "Unorganized Example.mp3", extension: ".mp3", title: "Unorganized Example", artist: "", persona: "", album: "", genre: "", year: "", track: "", tags: "needs review", sunoUrl: "", prompt: "", lyrics: "", syncedLyrics: [], lyricsOffsetMs: 0, notes: "Example of an unorganized catalog entry.", favorite: false, artwork: "", duration: 301, bitrate: 256000, publishedPath: "", localVideoPath: "", localVideoUrl: "", youtubeUrl: "", videoOffsetMs: 0 },
  ];
  window.seraLibrary = {
    selectFolder: async () => null, getLibrary: async () => ({ songs, sources: [{ id: "preview", name: "Example Music", path: "C:\\Music" }], missingSources: [], settings: DEFAULT_SETTINGS }),
    saveSong: async () => ({}), bulkSaveSongs: async (_paths, changes) => changes, savePlaylists: async (items) => items, removeSource: async () => ({ songs, sources: [], missingSources: [], settings: DEFAULT_SETTINGS }),
    revealFile: async () => {}, openExternal: async () => true, openTrustedExternal: async () => true,
    readSunoPage: async () => ({ fields: { title: "Example Song", persona: "Example Persona", prompt: "Example style prompt", lyrics: "Example lyric text" } }),
    selectArtwork: async () => null, selectVideo: async () => null, selectLyricsFile: async () => null,
    getSettings: async () => DEFAULT_SETTINGS, saveSettings: async (settings) => settings, selectPublishFolder: async () => ({ ...DEFAULT_SETTINGS, publishFolder: "C:\\Published Music" }),
    publishSongs: async (items) => ({ results: items.map((song) => ({ filePath: song.filePath, status: "published", path: `C:\\Published Music\\${song.fileName}` })), settings: DEFAULT_SETTINGS }),
    backup: async () => true, restore: async () => null,
    getAppInfo: async () => ({ version: "0.4.1", repositoryUrl: "https://github.com/Onewingseraphim/sera-fm-music-library", releasesUrl: "https://github.com/Onewingseraphim/sera-fm-music-library/releases", changelog: "# SERA.FM Music Library\n\n## 0.4.1\n\n### New\n- Reliable published library\n- Full player controls\n- Queue and playlists" }),
    checkUpdates: async () => ({ available: false, currentVersion: "0.4.1", message: "Preview mode" }),
    toggleFullscreen: async () => true, exitFullscreen: async () => false,
  };
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  songs: [], sources: [], missingSources: [], settings: structuredClone(DEFAULT_SETTINGS), settingsDraft: structuredClone(DEFAULT_SETTINGS),
  view: "library", activeFilter: { type: "all", value: "" }, search: "", selectedSong: null, selectedIds: new Set(),
  playingSong: null, mediaSource: "audio", draftArtwork: "", draftSyncedLyrics: [], draftVideoUrl: "", pendingSunoFields: {},
  themeEditingKey: "primary", lyricsAutoScroll: true, lyricsFontSize: 24, appInfo: null, latestReleaseUrl: "",
  queue: [], queueIndex: -1, playlists: [], shuffle: false, repeatMode: "off", massEditorVisible: false, lastVisualizerType: "cosmic",
};

const audio = $("#audioPlayer");
const video = $("#localVideoPlayer");
let audioContext = null;
let analyser = null;
let audioNode = null;
let videoNode = null;
let visualFrame = 0;
let youtubePlayer = null;
let youtubeApiPromise = null;
let plainLyricsLastScroll = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function friendlyError(error, fallback = "Something went wrong.") {
  return String(error?.message || fallback).replace(/^Error invoking remote method '[^']+': Error:\s*/i, "");
}

function showToast(message, isError = false) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.toggle("error", isError); toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 3300);
}

function formatTime(seconds) {
  if (!Number.isFinite(Number(seconds))) return "0:00";
  const value = Math.max(0, Math.floor(Number(seconds))); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function formatDurationTotal(seconds) {
  const minutes = Math.round(Number(seconds || 0) / 60); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function mergeSettings(value = {}) {
  return { ...DEFAULT_SETTINGS, ...value, theme: { ...DEFAULT_SETTINGS.theme, ...(value.theme || {}) }, visualizer: { ...DEFAULT_SETTINGS.visualizer, ...(value.visualizer || {}) }, collapsedSections: { ...DEFAULT_SETTINGS.collapsedSections, ...(value.collapsedSections || {}) }, unorganizedFields: Array.isArray(value.unorganizedFields) ? value.unorganizedFields : DEFAULT_SETTINGS.unorganizedFields };
}

function applyTheme(theme) {
  const root = document.documentElement; root.style.setProperty("--primary", theme.primary); root.style.setProperty("--primary-bright", theme.primary); root.style.setProperty("--secondary", theme.secondary); root.style.setProperty("--glow", theme.glow); root.style.setProperty("--bg", theme.background);
}

function unique(field) { return [...new Set(state.songs.map((song) => String(song[field] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function isUnorganized(song) { return state.settings.unorganizedFields.some((field) => !String(song[field] || "").trim()); }

function getFilteredSongs() {
  let songs = state.songs;
  const { type, value } = state.activeFilter;
  if (type === "unorganized") songs = songs.filter(isUnorganized);
  if (type === "favorites") songs = songs.filter((song) => song.favorite);
  if (type === "published") songs = songs.filter((song) => song.publishedPath);
  if (type === "persona") songs = songs.filter((song) => song.persona === value);
  if (type === "album") songs = songs.filter((song) => song.album === value);
  if (type === "source") songs = songs.filter((song) => song.sourceId === value);
  const query = state.search.trim().toLowerCase();
  return query ? songs.filter((song) => [song.title, song.artist, song.persona, song.album, song.genre, song.tags, song.fileName].some((field) => String(field || "").toLowerCase().includes(query))) : songs;
}

function setCollapsedState() {
  for (const section of ["personas", "albums", "folders"]) $(`[data-section="${section}"]`)?.classList.toggle("collapsed", Boolean(state.settings.collapsedSections[section]));
}

function renderSidebar() {
  const personas = unique("persona"); const albums = unique("album");
  $("#allCount").textContent = state.songs.length; $("#unorganizedCount").textContent = state.songs.filter(isUnorganized).length;
  $("#favoritesCount").textContent = state.songs.filter((song) => song.favorite).length; $("#publishedCount").textContent = state.songs.filter((song) => song.publishedPath).length;
  $("#personaSectionCount").textContent = personas.length; $("#albumSectionCount").textContent = albums.length; $("#folderSectionCount").textContent = state.sources.length;
  $("#personaList").innerHTML = personas.length ? personas.map((value) => `<button class="dynamic-item" data-filter="persona" data-value="${escapeHtml(value)}"><span>${escapeHtml(value)}</span><b>${state.songs.filter((song) => song.persona === value).length}</b></button>`).join("") : '<span class="side-empty">No personas yet</span>';
  $("#albumList").innerHTML = albums.length ? albums.map((value) => `<button class="dynamic-item" data-filter="album" data-value="${escapeHtml(value)}"><span>${escapeHtml(value)}</span><b>${state.songs.filter((song) => song.album === value).length}</b></button>`).join("") : '<span class="side-empty">No albums yet</span>';
  $("#sourceList").innerHTML = state.sources.length ? state.sources.map((source) => `<div class="source-card"><button class="dynamic-item" data-filter="source" data-value="${escapeHtml(source.id)}"><strong>${escapeHtml(source.name)}</strong></button><span title="${escapeHtml(source.path)}">${escapeHtml(source.path)}</span><button data-remove-source="${escapeHtml(source.id)}">Remove from catalog</button></div>`).join("") : '<span class="side-empty">No folders yet</span>';
  $("#personaOptions").innerHTML = personas.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  $("#albumOptions").innerHTML = albums.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  setCollapsedState();
  $$(".nav-item, .dynamic-item").forEach((button) => button.classList.toggle("active", state.view === "library" && button.dataset.filter === state.activeFilter.type && (button.dataset.value || "") === state.activeFilter.value));
  $("[data-view='now-playing']").classList.toggle("active", state.view === "now-playing");
  $("#updatesButton").classList.toggle("active", state.view === "updates");
  $("#playingIndicator").textContent = state.playingSong ? "●" : "—";
}

function renderSelection() {
  $("#bulkBar").classList.toggle("hidden", !state.selectedIds.size); $("#selectedCount").textContent = state.selectedIds.size;
  $("#massEditCount").textContent = state.selectedIds.size;
  const visible = getFilteredSongs(); $("#selectAllCheckbox").checked = visible.length > 0 && visible.every((song) => state.selectedIds.has(song.id));
  if (state.selectedIds.size > 1 && !state.massEditorVisible) openMassEditor();
  else if (state.selectedIds.size < 2 && state.massEditorVisible) closeMassEditor();
}

function renderSongList() {
  const songs = getFilteredSongs();
  $("#songList").innerHTML = songs.map((song) => `<div class="song-row ${state.selectedIds.has(song.id) ? "selected" : ""}" data-song-id="${escapeHtml(song.id)}" tabindex="0"><div class="song-cell"><input class="song-check" data-select-id="${escapeHtml(song.id)}" type="checkbox" ${state.selectedIds.has(song.id) ? "checked" : ""}/><div class="song-cover">${song.artwork ? `<img src="${song.artwork}" alt="" />` : "♫"}</div><div class="song-copy"><strong>${song.favorite ? '<span class="favorite-star">★</span>' : ""}${escapeHtml(song.title || song.fileName)}</strong><span>${song.publishedPath ? '<i class="published-dot"></i>' : ""}${escapeHtml(song.artist || song.fileName)}</span></div></div><span class="${song.persona ? "" : "missing"}">${escapeHtml(song.persona || "Unassigned")}</span><span class="${song.album ? "" : "missing"}">${escapeHtml(song.album || "No album")}</span><span>${escapeHtml(song.genre || "—")}</span><span>${formatTime(song.duration)}</span><div class="row-actions"><button class="row-queue" data-queue-id="${escapeHtml(song.id)}" title="Add to queue">＋</button><button class="row-play" data-play-id="${escapeHtml(song.id)}">▶</button></div></div>`).join("");
  $("#noResults").classList.toggle("hidden", Boolean(songs.length)); renderSelection();
}

function renderLibrary() {
  $("#songTotal").textContent = state.songs.length; $("#personaTotal").textContent = unique("persona").length; $("#albumTotal").textContent = unique("album").length; $("#durationTotal").textContent = formatDurationTotal(state.songs.reduce((sum, song) => sum + Number(song.duration || 0), 0));
  $("#emptyState").classList.toggle("hidden", Boolean(state.songs.length)); $("#libraryView").classList.toggle("hidden", !state.songs.length); renderSongList();
}

function setView(view) {
  state.view = view;
  $("#libraryPage").classList.toggle("hidden", view !== "library"); $("#nowPlayingPage").classList.toggle("hidden", view !== "now-playing"); $("#updatesPage").classList.toggle("hidden", view !== "updates");
  renderSidebar(); if (view === "now-playing") renderNowPlaying(); if (view === "updates") loadUpdatesPage();
}

function applyPayload(payload) {
  const previousPlaying = state.playingSong; const previousQueue = state.queue;
  state.songs = payload?.songs || []; state.sources = payload?.sources || []; state.missingSources = payload?.missingSources || []; state.playlists = payload?.playlists || state.playlists || []; state.selectedIds = new Set([...state.selectedIds].filter((id) => state.songs.some((song) => song.id === id)));
  if (previousPlaying) state.playingSong = state.songs.find((song) => song.id === previousPlaying.id || song.originalPath === (previousPlaying.originalPath || previousPlaying.filePath)) || previousPlaying;
  state.queue = previousQueue.map((queued) => state.songs.find((song) => song.id === queued.id || song.originalPath === (queued.originalPath || queued.filePath))).filter(Boolean);
  if (state.playingSong && state.queue.length) state.queueIndex = Math.max(0, state.queue.findIndex((song) => song.id === state.playingSong.id));
  state.settings = mergeSettings(payload?.settings || state.settings); state.settingsDraft = structuredClone(state.settings); applyTheme(state.settings.theme);
  setPlaybackVolume(state.settings.defaultVolume); $("#volumeBar").value = String(audio.volume); render();
}

function render() { renderSidebar(); renderLibrary(); if (state.playingSong) renderNowPlaying(); }

async function refreshLibrary() {
  $("#rescanButton").disabled = true; $("#rescanButton").textContent = "Scanning…";
  try { applyPayload(await window.seraLibrary.getLibrary()); } catch (error) { showToast(friendlyError(error, "The library could not be scanned."), true); }
  finally { $("#rescanButton").disabled = false; $("#rescanButton").textContent = "↻ Rescan folders"; }
}

async function addFolder() { try { const result = await window.seraLibrary.selectFolder(); if (result) { applyPayload(result); showToast("Music folder added."); } } catch (error) { showToast(friendlyError(error), true); } }

function setEditorArtwork(value) { state.draftArtwork = value || ""; $("#editorCover").innerHTML = value ? `<img src="${value}" alt="Selected artwork" />` : "<span>♫</span>"; }

function updateSyncedLyricsStatus() { $("#syncedLyricsStatus").value = state.draftSyncedLyrics.length ? `${state.draftSyncedLyrics.length} timed ${state.draftSyncedLyrics.length === 1 ? "line" : "lines"}` : "No timing data"; }

function openEditor(song) {
  if (state.selectedIds.size > 1) return openMassEditor();
  state.selectedSong = song; state.draftSyncedLyrics = structuredClone(song.syncedLyrics || []); state.draftVideoUrl = song.localVideoUrl || ""; setEditorArtwork(song.artwork);
  closeMassEditor(); document.body.classList.add("editor-open"); $("#editorPanel").setAttribute("aria-hidden", "false"); $("#editorFileName").textContent = song.fileName;
  const fields = ["Title", "Artist", "Persona", "Album", "Genre", "Year", "Track", "Tags", "SunoUrl", "Prompt", "Lyrics", "LyricsOffsetMs", "LocalVideoPath", "YoutubeUrl", "VideoOffsetMs", "Notes"];
  for (const field of fields) { const key = field[0].toLowerCase() + field.slice(1); $(`#field${field}`).value = song[key] ?? ""; }
  $("#fieldFavorite").checked = Boolean(song.favorite); updateSyncedLyricsStatus(); $("#infoLocation").textContent = song.filePath; $("#infoFormat").textContent = `${(song.extension || ".mp3").slice(1).toUpperCase()} · ${song.bitrate ? `${Math.round(song.bitrate / 1000)} kbps · ` : ""}${formatTime(song.duration)}`;
  $("#publishedCard").classList.toggle("hidden", !song.publishedPath); $("#publishedPath").textContent = song.publishedPath || "";
}

function closeEditor() { document.body.classList.remove("editor-open"); $("#editorPanel").setAttribute("aria-hidden", "true"); state.selectedSong = null; }

function collectEditorSong() {
  if (!state.selectedSong) return null; const values = Object.fromEntries(new FormData($("#songForm")).entries());
  return { ...state.selectedSong, ...values, favorite: $("#fieldFavorite").checked, artwork: state.draftArtwork, syncedLyrics: structuredClone(state.draftSyncedLyrics), localVideoUrl: state.draftVideoUrl, lyricsOffsetMs: Number(values.lyricsOffsetMs || 0), videoOffsetMs: Number(values.videoOffsetMs || 0) };
}

async function saveSong(song, message = "Song details and lyrics saved.") {
  await window.seraLibrary.saveSong(song); const index = state.songs.findIndex((item) => item.id === song.id); if (index >= 0) state.songs[index] = song;
  if (state.playingSong?.id === song.id) state.playingSong = song; state.selectedSong = song; render(); showToast(message); return song;
}

async function saveSelectedSong() {
  const song = collectEditorSong(); if (!song) return; $("#saveButton").disabled = true; $("#saveStatus").textContent = "Saving…";
  try { await saveSong(song); $("#saveStatus").textContent = "Saved"; } catch (error) { $("#saveStatus").textContent = ""; showToast(friendlyError(error, "The song could not be saved."), true); }
  finally { $("#saveButton").disabled = false; }
}

function parseTimestamp(value) {
  const parts = String(value).trim().replace(",", ".").split(":").map(Number); if (parts.some((part) => !Number.isFinite(part))) return NaN;
  return parts.length === 3 ? ((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000) : ((parts[0] * 60 + parts[1]) * 1000);
}

function finishTimedLines(lines) {
  return lines.filter((line) => Number.isFinite(line.startMs) && line.text).sort((a, b) => a.startMs - b.startMs).map((line, index, all) => ({ ...line, endMs: Number.isFinite(line.endMs) ? line.endMs : (all[index + 1]?.startMs ?? line.startMs + 4000), words: Array.isArray(line.words) ? line.words : [] }));
}

function parseLrc(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g)]; if (!stamps.length) continue;
    const body = raw.replace(/\[[^\]]+\]/g, "").trim();
    const wordMatches = [...body.matchAll(/<(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)>([^<]+)/g)];
    const words = wordMatches.map((match) => ({ startMs: parseTimestamp(match[1]), text: match[2].trim() })).filter((word) => Number.isFinite(word.startMs) && word.text);
    const plain = words.length ? words.map((word) => word.text).join(" ") : body.replace(/<[^>]+>/g, "").trim();
    for (const stamp of stamps) lines.push({ startMs: parseTimestamp(stamp[1].replace(/\.(\d{1,2})$/, (_match, fraction) => `.${fraction.padEnd(3, "0")}`)), text: plain, words });
  }
  return finishTimedLines(lines);
}

function parseSubtitle(text) {
  const lines = [];
  for (const block of String(text).replace(/^WEBVTT[^\n]*\n/i, "").split(/\r?\n\s*\r?\n/)) {
    const match = block.match(/(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/); if (!match) continue;
    const timing = match[0].split(/\s*-->\s*/); const body = block.slice((match.index || 0) + match[0].length).replace(/<[^>]+>/g, "").trim().replace(/\r?\n/g, " ");
    lines.push({ startMs: parseTimestamp(timing[0]), endMs: parseTimestamp(timing[1]), text: body, words: [] });
  }
  return finishTimedLines(lines);
}

function parseTimedLyrics(text, extension) { return extension === ".lrc" ? parseLrc(text) : parseSubtitle(text); }

function effectiveTimedLyrics(song) {
  return finishTimedLines((song?.syncedLyrics || []).map((line) => ({ ...line, startMs: Number(line.startMs), endMs: Number(line.endMs), words: Array.isArray(line.words) ? line.words : [] })));
}

function estimatedWords(line) {
  if (line.words?.length) return line.words;
  const parts = line.text.split(/\s+/).filter(Boolean); const duration = Math.max(500, line.endMs - line.startMs);
  return parts.map((text, index) => ({ text, startMs: line.startMs + (duration * index / Math.max(1, parts.length)) }));
}

function renderLyrics(song) {
  const container = $("#lyricsDisplay"); const timed = effectiveTimedLyrics(song);
  container.style.fontSize = `${state.lyricsFontSize}px`;
  $("#lyricsHeading").textContent = timed.length ? "Synced lyrics" : "Lyrics";
  if (timed.length) {
    container.innerHTML = timed.map((line, index) => `<p class="lyric-line" data-line-index="${index}" data-start-ms="${line.startMs}">${estimatedWords(line).map((word) => `<span class="lyric-word" data-word-start="${Number(word.startMs)}">${escapeHtml(word.text)} </span>`).join("")}</p>`).join("");
  } else if (song?.lyrics) { container.innerHTML = `<div class="plain-lyrics">${escapeHtml(song.lyrics)}</div>`; container.scrollTop = 0; plainLyricsLastScroll = performance.now(); }
  else container.innerHTML = '<p class="lyrics-placeholder">No lyrics have been saved for this song.</p>';
}

function updateLyricsAt(timeSeconds) {
  if (!state.playingSong) return; const timed = effectiveTimedLyrics(state.playingSong); if (!timed.length) return;
  let timeMs = Number(timeSeconds || 0) * 1000; if (state.mediaSource !== "audio") timeMs += Number(state.playingSong.videoOffsetMs || 0); timeMs -= Number(state.playingSong.lyricsOffsetMs || 0);
  let activeIndex = timed.findIndex((line) => timeMs >= line.startMs && timeMs < line.endMs); if (activeIndex < 0 && timeMs >= timed[timed.length - 1].startMs) activeIndex = timed.length - 1;
  $$(".lyric-line").forEach((element, index) => {
    const active = index === activeIndex; element.classList.toggle("active", active);
    element.querySelectorAll(".lyric-word").forEach((word) => word.classList.toggle("sung", active && timeMs >= Number(word.dataset.wordStart)));
    if (active && state.lyricsAutoScroll && element.dataset.scrolled !== "true") { $$(".lyric-line").forEach((line) => { line.dataset.scrolled = "false"; }); element.dataset.scrolled = "true"; element.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
}

function youtubeId(value) {
  try { const url = new URL(value); if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || ""; if (url.hostname.endsWith("youtube.com")) return url.searchParams.get("v") || (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/") ? url.pathname.split("/")[2] : ""); } catch { /* Invalid URL. */ } return "";
}

function ensureYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT); if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = "https://www.youtube.com/iframe_api"; script.onerror = () => reject(new Error("YouTube player could not be loaded.")); window.onYouTubeIframeAPIReady = () => resolve(window.YT); document.head.append(script); }); return youtubeApiPromise;
}

function youtubeState() {
  try { return youtubePlayer?.getPlayerState?.(); } catch { return -1; }
}

function activeMedia() { return state.mediaSource === "video" ? video : audio; }
function currentPlaybackTime() { if (state.mediaSource === "youtube") { try { return Number(youtubePlayer?.getCurrentTime?.() || 0); } catch { return 0; } } return Number(activeMedia().currentTime || 0); }
function currentPlaybackDuration() { if (state.mediaSource === "youtube") { try { return Number(youtubePlayer?.getDuration?.() || state.playingSong?.duration || 0); } catch { return Number(state.playingSong?.duration || 0); } } return Number(activeMedia().duration || state.playingSong?.duration || 0); }
function playbackIsPaused() { if (state.mediaSource === "youtube") return youtubeState() !== window.YT?.PlayerState?.PLAYING; return activeMedia().paused; }

function updateFooter() {
  if (!state.playingSong) return;
  const current = currentPlaybackTime(); const duration = currentPlaybackDuration();
  $("#currentTime").textContent = formatTime(current); $("#totalTime").textContent = formatTime(duration);
  $("#seekBar").value = duration ? String(current / duration * 100) : "0";
  $("#playPauseButton").textContent = playbackIsPaused() ? "▶" : "❚❚";
  updateLyricsAt(current);
  const timed = effectiveTimedLyrics(state.playingSong);
  if (!timed.length && state.lyricsAutoScroll && !playbackIsPaused()) {
    const now = performance.now(); const elapsed = Math.min(250, now - (plainLyricsLastScroll || now)); plainLyricsLastScroll = now;
    const display = $("#lyricsDisplay"); if (display.scrollHeight > display.clientHeight) display.scrollTop += elapsed * 0.006;
  } else plainLyricsLastScroll = performance.now();
}

function handleYoutubeError(event) {
  const messages = { 2: "The YouTube link is invalid.", 5: "This video cannot play in the embedded player.", 100: "This YouTube video is unavailable.", 101: "The owner does not allow this video to be embedded.", 150: "The owner does not allow this video to be embedded.", 153: "YouTube rejected the embedded player identity. Try reopening the app or use Open in YouTube." };
  showToast(messages[event.data] || `YouTube playback error ${event.data}.`, true);
}

async function showYoutube(song) {
  const id = youtubeId(song.youtubeUrl); if (!id) return showToast("Add a valid YouTube link to this song first.", true);
  $("#openYoutubeExternalButton").classList.remove("hidden"); $("#visualizerToggleButton").classList.add("hidden"); $("#quickVisualizerSelect").classList.add("hidden");
  audio.pause(); video.pause(); $("#localVideoPlayer").classList.add("hidden"); $("#youtubeStage").classList.remove("hidden"); $("#visualizerCanvas").classList.add("hidden"); $("#visualizerStatus").textContent = "YouTube playback · visualizer unavailable";
  try {
    if (youtubePlayer?.destroy) youtubePlayer.destroy(); $("#youtubePlayerHost").innerHTML = ""; await ensureYoutubeApi();
    youtubePlayer = new window.YT.Player("youtubePlayerHost", { videoId: id, host: "https://www.youtube.com", playerVars: { autoplay: 1, rel: 0, enablejsapi: 1, origin: "https://www.youtube.com", widget_referrer: "https://www.youtube.com/" }, events: {
      onReady: (event) => { event.target.setVolume(Math.round(Number($("#volumeBar").value) * 100)); event.target.playVideo(); updateFooter(); },
      onStateChange: (event) => { updateFooter(); if (event.data === window.YT.PlayerState.ENDED) handleMediaEnded(); },
      onError: handleYoutubeError,
    } });
  } catch (error) { $("#youtubePlayerHost").innerHTML = `<iframe allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen src="https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1"></iframe>`; showToast(friendlyError(error), true); }
}

function stopYoutube() { if (youtubePlayer?.stopVideo) youtubePlayer.stopVideo(); $("#youtubeStage").classList.add("hidden"); }

async function ensureAudioGraph(media) {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  if (!audioContext) { audioContext = new (window.AudioContext || window.webkitAudioContext)(); analyser = audioContext.createAnalyser(); analyser.fftSize = 512; analyser.connect(audioContext.destination); }
  analyser.smoothingTimeConstant = Number(state.settings.visualizer.smoothing || 0.82);
  if (media === audio && !audioNode) { audioNode = audioContext.createMediaElementSource(audio); audioNode.connect(analyser); }
  if (media === video && !videoNode) { videoNode = audioContext.createMediaElementSource(video); videoNode.connect(analyser); }
  if (audioContext.state === "suspended") await audioContext.resume();
  if (typeof audioContext.setSinkId === "function") await audioContext.setSinkId(state.settings.audioOutput === "default" ? "" : state.settings.audioOutput).catch(() => {});
  drawVisualizer();
}

async function applyAudioOutput(deviceId, quiet = false) {
  try {
    if (audioContext && typeof audioContext.setSinkId === "function") await audioContext.setSinkId(deviceId === "default" ? "" : deviceId);
    else for (const media of [audio, video]) if (typeof media.setSinkId === "function") await media.setSinkId(deviceId === "default" ? "" : deviceId);
  } catch (error) { if (!quiet) showToast(`That output could not be selected: ${error.message}`, true); }
}

function drawVisualizer() {
  cancelAnimationFrame(visualFrame); const canvas = $("#visualizerCanvas"); if (!canvas || !analyser || state.settings.visualizer.type === "off") { canvas?.classList.add("hidden"); return; }
  canvas.classList.remove("hidden"); const context = canvas.getContext?.("2d"); if (!context) return; const frequency = new Uint8Array(analyser.frequencyBinCount); const wave = new Uint8Array(analyser.fftSize);
  const loop = () => {
    const width = canvas.clientWidth || 800; const height = canvas.clientHeight || 500; const ratio = Math.min(2, window.devicePixelRatio || 1); if (canvas.width !== width * ratio || canvas.height !== height * ratio) { canvas.width = width * ratio; canvas.height = height * ratio; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height); analyser.smoothingTimeConstant = Number(state.settings.visualizer.smoothing); const type = state.settings.visualizer.type; const sensitivity = Number(state.settings.visualizer.sensitivity || 1);
    const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(); const secondary = getComputedStyle(document.documentElement).getPropertyValue("--secondary").trim(); const glow = getComputedStyle(document.documentElement).getPropertyValue("--glow").trim();
    if (type === "wave") { analyser.getByteTimeDomainData(wave); context.beginPath(); context.lineWidth = 3; context.strokeStyle = secondary; context.shadowBlur = 18; context.shadowColor = glow; wave.forEach((value, index) => { const x = index / (wave.length - 1) * width; const y = height / 2 + ((value - 128) / 128) * height * .3 * sensitivity; index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke(); }
    else {
      analyser.getByteFrequencyData(frequency); const bins = type === "radial" ? 96 : 72; const centerX = width / 2, centerY = height / 2; const radius = Math.min(width, height) * .18;
      if (type === "radial") { context.save(); context.translate(centerX, centerY); for (let index = 0; index < bins; index++) { const sourceIndex = 4 + Math.floor(index / bins * Math.max(1, frequency.length - 8)); const previous = frequency[Math.max(4, sourceIndex - 1)]; const next = frequency[Math.min(frequency.length - 1, sourceIndex + 1)]; const value = Math.min(1, ((previous + frequency[sourceIndex] * 2 + next) / 4) / 255 * sensitivity); const angle = index / bins * Math.PI * 2; const length = 12 + value * Math.min(width, height) * .22; context.save(); context.rotate(angle); context.fillStyle = index % 3 ? secondary : primary; context.shadowBlur = 8; context.shadowColor = glow; context.fillRect(radius, -1.5, length, 3); context.restore(); } context.restore(); }
      else if (type === "cosmic") { context.save(); context.translate(centerX, centerY); const bass = frequency.slice(4, 16).reduce((sum, value) => sum + value, 0) / 12 / 255 * sensitivity; const mid = frequency.slice(16, 64).reduce((sum, value) => sum + value, 0) / 48 / 255 * sensitivity; for (let orbit = 0; orbit < 7; orbit++) { const energy = Math.min(1, frequency[8 + orbit * 9] / 255 * sensitivity); context.save(); context.rotate(orbit * .46 + performance.now() * .000025 * (orbit % 2 ? -1 : 1)); context.scale(1, .48 + orbit * .035); context.beginPath(); context.arc(0, 0, radius * (1.1 + orbit * .36 + energy * .18), 0, Math.PI * 2); context.strokeStyle = orbit % 2 ? `${secondary}88` : `${primary}88`; context.lineWidth = 1 + energy * 1.8; context.shadowBlur = 12 + energy * 20; context.shadowColor = orbit % 2 ? secondary : glow; context.stroke(); context.restore(); } for (let particle = 0; particle < 44; particle++) { const band = 6 + (particle * 7) % Math.max(8, frequency.length - 12); const energy = Math.min(1, frequency[band] / 255 * sensitivity); const angle = particle * 2.399963 + performance.now() * .00003 * (1 + particle % 3); const distance = radius * (1.2 + (particle % 11) * .25 + energy * .8); const x = Math.cos(angle) * distance; const y = Math.sin(angle) * distance * (.58 + (particle % 5) * .045); context.beginPath(); context.arc(x, y, 1.4 + energy * 3.4, 0, Math.PI * 2); context.fillStyle = particle % 3 ? secondary : primary; context.shadowBlur = 10 + energy * 16; context.shadowColor = particle % 3 ? secondary : glow; context.fill(); } context.beginPath(); context.arc(0, 0, radius * (.72 + bass * .18), 0, Math.PI * 2); context.fillStyle = `rgba(5,9,18,${.35 + mid * .2})`; context.strokeStyle = primary; context.lineWidth = 2 + bass * 3; context.shadowBlur = 25; context.shadowColor = primary; context.fill(); context.stroke(); context.restore(); }
      else { const gap = 3; const barWidth = width / bins - gap; for (let index = 0; index < bins; index++) { const value = Math.min(1, frequency[index] / 255 * sensitivity); const barHeight = 6 + value * height * (type === "mirror" ? .38 : .78); const x = index * (barWidth + gap); const gradient = context.createLinearGradient(0, height, 0, height - barHeight); gradient.addColorStop(0, primary); gradient.addColorStop(1, secondary); context.fillStyle = gradient; context.shadowBlur = 10; context.shadowColor = glow; if (type === "mirror") { context.fillRect(x, height / 2 - barHeight, barWidth, barHeight); context.fillRect(x, height / 2, barWidth, barHeight); } else context.fillRect(x, height - barHeight, barWidth, barHeight); } }
    }
    visualFrame = requestAnimationFrame(loop);
  }; loop();
}

async function playAudio(song) {
  $("#openYoutubeExternalButton").classList.add("hidden"); $("#visualizerToggleButton").classList.remove("hidden"); $("#quickVisualizerSelect").classList.remove("hidden");
  state.mediaSource = "audio"; stopYoutube(); video.pause(); video.classList.add("hidden"); $("#visualizerCanvas").classList.toggle("hidden", state.settings.visualizer.type === "off");
  if (audio.src !== song.fileUrl) audio.src = song.fileUrl; await ensureAudioGraph(audio); await applyAudioOutput(state.settings.audioOutput, true); await audio.play(); $("#visualizerStatus").textContent = "Visualizer · SERA.FM Player"; renderNowPlaying();
}

async function playVideo(song) {
  if (!song.localVideoUrl) return showToast("Attach a local video to this song first.", true); $("#openYoutubeExternalButton").classList.add("hidden"); $("#visualizerToggleButton").classList.remove("hidden"); $("#quickVisualizerSelect").classList.remove("hidden"); state.mediaSource = "video"; stopYoutube(); audio.pause(); video.src = song.localVideoUrl; video.classList.remove("hidden"); $("#visualizerCanvas").classList.toggle("hidden", state.settings.visualizer.type === "off"); await ensureAudioGraph(video); await applyAudioOutput(state.settings.audioOutput, true); await video.play(); $("#visualizerStatus").textContent = "Visualizer · Attached video"; renderNowPlaying();
}

async function selectMediaSource(source) {
  if (!state.playingSong) return; state.mediaSource = source;
  $("#openYoutubeExternalButton").classList.toggle("hidden", source !== "youtube"); $("#visualizerToggleButton").classList.toggle("hidden", source === "youtube"); $("#quickVisualizerSelect").classList.toggle("hidden", source === "youtube");
  try { if (source === "audio") await playAudio(state.playingSong); else if (source === "video") await playVideo(state.playingSong); else { state.mediaSource = "youtube"; await showYoutube(state.playingSong); renderNowPlaying(); } } catch (error) { showToast(friendlyError(error, "This media could not be played."), true); }
}

async function playSong(song, openPage = false, preserveQueue = false) {
  if (!preserveQueue) { state.queue = [...getFilteredSongs()]; state.queueIndex = state.queue.findIndex((item) => item.id === song.id); if (state.queueIndex < 0) { state.queue = [song]; state.queueIndex = 0; } }
  state.playingSong = song; $("#player").classList.remove("hidden"); $("#playerTitle").textContent = song.title; $("#playerArtist").textContent = song.artist || song.persona || song.fileName; await playAudio(song).catch((error) => showToast(friendlyError(error, "This song could not be played."), true)); renderSidebar(); renderQueue(); if (openPage) setView("now-playing");
}

function addToQueue(song) { if (!state.queue.some((item) => item.id === song.id)) state.queue.push(song); renderQueue(); showToast(`${song.title} added to the queue.`); }
function shuffledIndex() { if (state.queue.length < 2) return state.queueIndex; let value = state.queueIndex; while (value === state.queueIndex) value = Math.floor(Math.random() * state.queue.length); return value; }
async function playQueueIndex(index) { if (!state.queue.length) return; state.queueIndex = (index + state.queue.length) % state.queue.length; await playSong(state.queue[state.queueIndex], false, true); }
async function playNext(fromEnded = false) {
  if (!state.queue.length) return;
  if (fromEnded && state.repeatMode === "one") { seekPlayback(0); togglePlayback(); return; }
  if (!state.shuffle && state.queueIndex >= state.queue.length - 1 && state.repeatMode !== "all") return;
  await playQueueIndex(state.shuffle ? shuffledIndex() : state.queueIndex + 1);
}
async function playPrevious() { if (currentPlaybackTime() > 4) return seekPlayback(0); await playQueueIndex(state.shuffle ? shuffledIndex() : state.queueIndex - 1); }
function handleMediaEnded() { playNext(true).catch((error) => showToast(friendlyError(error), true)); }
function seekPlayback(seconds) { const value = Math.max(0, Number(seconds || 0)); if (state.mediaSource === "youtube") youtubePlayer?.seekTo?.(value, true); else activeMedia().currentTime = value; updateFooter(); }
function setPlaybackVolume(value) { const volume = Math.max(0, Math.min(1, Number(value))); audio.volume = volume; video.volume = volume; try { youtubePlayer?.setVolume?.(Math.round(volume * 100)); } catch { /* YouTube is not ready. */ } }
function togglePlayback() { if (!state.playingSong) return; if (state.mediaSource === "youtube") { if (playbackIsPaused()) youtubePlayer?.playVideo?.(); else youtubePlayer?.pauseVideo?.(); } else if (activeMedia().paused) activeMedia().play().catch((error) => showToast(friendlyError(error), true)); else activeMedia().pause(); }

function renderQueue() {
  $("#queueList").innerHTML = state.queue.length ? state.queue.map((song, index) => `<div class="queue-item ${index === state.queueIndex ? "current" : ""}"><button class="queue-item-copy" data-queue-play="${index}"><strong>${escapeHtml(song.title)}</strong><span>${escapeHtml(song.artist || song.persona || song.fileName)}</span></button><button data-queue-remove="${index}" title="Remove">×</button></div>`).join("") : '<p class="modal-intro">The queue is empty. Use ＋ beside any song.</p>';
  $("#playlistList").innerHTML = state.playlists.length ? state.playlists.map((playlist) => `<div class="playlist-item"><button data-playlist-load="${escapeHtml(playlist.id)}">${escapeHtml(playlist.name)} <small>(${playlist.songIds.length})</small></button><button data-playlist-delete="${escapeHtml(playlist.id)}">×</button></div>`).join("") : '<span class="side-empty">No saved playlists</span>';
}

async function savePlaylists() { state.playlists = await window.seraLibrary.savePlaylists(state.playlists); renderQueue(); }

function renderNowPlaying() {
  const song = state.playingSong; $("#nowPlayingEmpty").classList.toggle("hidden", Boolean(song)); $("#nowPlayingContent").classList.toggle("hidden", !song); if (!song) return;
  $("#nowArtwork").src = song.artwork || "../assets/sera-logo.png"; $("#nowArtwork").style.opacity = state.settings.visualizer.showArtwork ? ".72" : "0"; $("#nowTitle").textContent = song.title; $("#nowArtist").textContent = song.artist || "Unknown artist"; $("#nowPersona").textContent = (song.persona || "Unassigned persona").toUpperCase(); $("#nowFavoriteButton").textContent = song.favorite ? "★" : "☆";
  $("#nowChips").innerHTML = [song.album, song.genre, song.year, song.tags].filter(Boolean).flatMap((value) => String(value).split(",")).map((value) => `<span class="chip">${escapeHtml(value.trim())}</span>`).join("");
  $("#nowPrompt").textContent = song.prompt || "No style prompt saved."; $("#nowNotes").textContent = song.notes || "No notes saved.";
  $("#nowDetails").innerHTML = [["Persona", song.persona || "Unassigned"], ["Album", song.album || "No album"], ["Track", song.track || "—"], ["Duration", formatTime(song.duration)], ["File", song.fileName], ["Published", song.publishedPath ? "Yes" : "No"]].map(([term, value]) => `<div><dt>${term}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  $$('[data-media-source]').forEach((button) => { button.classList.toggle("active", button.dataset.mediaSource === state.mediaSource); button.disabled = (button.dataset.mediaSource === "video" && !song.localVideoPath) || (button.dataset.mediaSource === "youtube" && !youtubeId(song.youtubeUrl)); });
  $("#nowOpenSunoButton").disabled = !song.sunoUrl; $("#nowPlayButton").textContent = playbackIsPaused() ? `▶ Play ${state.mediaSource === "youtube" ? "YouTube" : state.mediaSource === "video" ? "video" : "audio"}` : "❚❚ Pause"; $("#quickVisualizerSelect").value = state.settings.visualizer.type === "off" ? state.lastVisualizerType : state.settings.visualizer.type; $("#visualizerToggleButton").textContent = `Visuals: ${state.settings.visualizer.type === "off" ? "Off" : "On"}`; renderLyrics(song);
}

function openModal(id) { $(`#${id}`).classList.remove("hidden"); }
function closeModal(id) { $(`#${id}`).classList.add("hidden"); if (id === "settingsModal") applyTheme(state.settings.theme); }
function selectedSongs() { return state.songs.filter((song) => state.selectedIds.has(song.id)); }

function openMassEditor() {
  if (state.selectedIds.size < 2) return;
  closeEditor(); state.massEditorVisible = true; document.body.classList.add("mass-editor-open"); $("#massEditorPanel").setAttribute("aria-hidden", "false"); $("#massEditCount").textContent = state.selectedIds.size;
  $$('[data-mass-apply]').forEach((checkbox) => { checkbox.checked = false; const input = $(`#mass${checkbox.dataset.massApply[0].toUpperCase()}${checkbox.dataset.massApply.slice(1)}`); input.disabled = true; input.value = ""; });
}

function closeMassEditor() { state.massEditorVisible = false; document.body.classList.remove("mass-editor-open"); $("#massEditorPanel")?.setAttribute("aria-hidden", "true"); }

async function applyBulkChanges() {
  const changes = {}; for (const checkbox of $$('[data-mass-apply]')) if (checkbox.checked) { const field = checkbox.dataset.massApply; changes[field] = $(`#mass${field[0].toUpperCase()}${field.slice(1)}`).value.trim(); }
  if (!Object.keys(changes).length) return showToast("Enable at least one field to mass edit.", true);
  try { const targets = selectedSongs().map((song) => ({ filePath: song.filePath, publishedId: song.publishedId || "" })); await window.seraLibrary.bulkSaveSongs(targets, changes); state.songs = state.songs.map((song) => state.selectedIds.has(song.id) ? { ...song, ...changes } : song); $("#massEditStatus").textContent = "Saved"; render(); showToast(`${state.selectedIds.size} songs updated safely.`); } catch (error) { showToast(friendlyError(error, "Mass edit failed."), true); }
}

async function publishSongs(songs) {
  if (!songs.length) return showToast("Select at least one song to publish.", true); if (state.settings.confirmPublishOverwrite && !confirm(`Publish ${songs.length} managed ${songs.length === 1 ? "copy" : "copies"}?`)) return;
  try { const response = await window.seraLibrary.publishSongs(songs); if (!response) return; state.settings = mergeSettings(response.settings || state.settings); let published = 0, skipped = 0, failed = 0; for (const result of response.results) { if (result.status === "published") published++; else if (result.status === "skipped") skipped++; else failed++; } await refreshLibrary(); render(); showToast([`${published} published`, skipped ? `${skipped} skipped` : "", failed ? `${failed} failed` : ""].filter(Boolean).join(" · "), failed > 0); } catch (error) { showToast(friendlyError(error, "Publishing failed."), true); }
}

function sunoFieldLabel(field) { return ({ title: "Title", artist: "Creator", persona: "Persona / voice", lyrics: "Lyrics", syncedLyrics: "Synchronized lyrics", prompt: "Style prompt", artwork: "Artwork", genre: "Genre", year: "Year" })[field] || field; }

async function readSunoPage() {
  const button = $("#syncSunoButton"); button.disabled = true; button.textContent = "Reading…";
  try { const result = await window.seraLibrary.readSunoPage($("#fieldSunoUrl").value.trim()); state.pendingSunoFields = result.fields || {}; $("#sunoFieldList").innerHTML = Object.entries(state.pendingSunoFields).map(([field, value]) => `<label class="sync-field"><input type="checkbox" data-suno-field="${field}" checked /><strong>${sunoFieldLabel(field)}</strong>${field === "artwork" ? `<p><img src="${value}" alt="Detected artwork" width="72" height="72" /></p>` : field === "syncedLyrics" ? `<p>${value.length} timing points detected</p>` : `<p>${escapeHtml(String(value).slice(0, 1600))}</p>`}</label>`).join(""); openModal("sunoModal"); } catch (error) { showToast(friendlyError(error, "Suno information could not be read."), true); } finally { button.disabled = false; button.textContent = "Read page"; }
}

function applySunoFields() {
  let count = 0; $$('[data-suno-field]:checked').forEach((checkbox) => { const field = checkbox.dataset.sunoField; const value = state.pendingSunoFields[field]; if (field === "artwork") setEditorArtwork(value); else if (field === "syncedLyrics") { state.draftSyncedLyrics = structuredClone(value); updateSyncedLyricsStatus(); } else { const input = $(`#field${field[0].toUpperCase()}${field.slice(1)}`); if (input) input.value = value; } count++; }); closeModal("sunoModal"); showToast(`${count} Suno ${count === 1 ? "field" : "fields"} copied. Save the song to keep them.`);
}

function hexToRgb(hex) { const value = String(hex).replace("#", ""); return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) }; }
function rgbToHex(r, g, b) { return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, "0")).join("")}`; }
function renderThemeSwatches() { $$('[data-theme-key]').forEach((button) => button.style.setProperty("--swatch-color", state.settingsDraft.theme[button.dataset.themeKey])); }
function setThemeEditor(key) { state.themeEditingKey = key; $$('[data-theme-key]').forEach((button) => button.classList.toggle("active", button.dataset.themeKey === key)); const color = state.settingsDraft.theme[key]; const rgb = hexToRgb(color); $("#rgbEditorTitle").textContent = `${key[0].toUpperCase()}${key.slice(1)} color`; $("#themeColorInput").value = color; for (const [name, value] of [["red", rgb.r], ["green", rgb.g], ["blue", rgb.b]]) { $(`#${name}Range`).value = value; $(`#${name}Output`).value = value; } }
function updateThemeFromRgb() { const color = rgbToHex($("#redRange").value, $("#greenRange").value, $("#blueRange").value); state.settingsDraft.theme[state.themeEditingKey] = color; renderThemeSwatches(); setThemeEditor(state.themeEditingKey); applyTheme(state.settingsDraft.theme); }

async function refreshAudioDevices() {
  const select = $("#audioOutputSelect"); const current = state.settingsDraft.audioOutput || "default"; select.innerHTML = '<option value="default">System Default</option>';
  try { const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audiooutput"); devices.forEach((device, index) => { const option = document.createElement("option"); option.value = device.deviceId; option.textContent = device.label || `Windows audio output ${index + 1}`; select.append(option); }); select.value = [...select.options].some((option) => option.value === current) ? current : "default"; } catch (error) { showToast(`Windows audio devices could not be listed: ${error.message}`, true); }
}

async function openSettings() {
  state.settingsDraft = structuredClone(state.settings); $("#publishFolderInput").value = state.settingsDraft.publishFolder || ""; $("#duplicateBehaviorSelect").value = state.settingsDraft.duplicateBehavior; $("#confirmOverwriteCheckbox").checked = state.settingsDraft.confirmPublishOverwrite; $("#autoScanCheckbox").checked = state.settingsDraft.autoScan; $("#rememberVolumeCheckbox").checked = state.settingsDraft.rememberVolume; $("#defaultVolumeRange").value = state.settingsDraft.defaultVolume; $("#defaultVolumeOutput").value = `${Math.round(state.settingsDraft.defaultVolume * 100)}%`;
  $("#visualizerTypeSelect").value = state.settingsDraft.visualizer.type; $("#visualizerSensitivityRange").value = state.settingsDraft.visualizer.sensitivity; $("#visualizerSensitivityOutput").value = `${Number(state.settingsDraft.visualizer.sensitivity).toFixed(1)}×`; $("#visualizerSmoothingRange").value = state.settingsDraft.visualizer.smoothing; $("#visualizerSmoothingOutput").value = `${Math.round(state.settingsDraft.visualizer.smoothing * 100)}%`; $("#visualizerArtworkCheckbox").checked = state.settingsDraft.visualizer.showArtwork;
  $$('[data-unorganized-field]').forEach((checkbox) => { checkbox.checked = state.settingsDraft.unorganizedFields.includes(checkbox.dataset.unorganizedField); }); renderThemeSwatches(); setThemeEditor("primary"); await refreshAudioDevices(); openModal("settingsModal");
}

async function saveSettings() {
  state.settingsDraft.audioOutput = $("#audioOutputSelect").value; state.settingsDraft.defaultVolume = Number($("#defaultVolumeRange").value); state.settingsDraft.rememberVolume = $("#rememberVolumeCheckbox").checked; state.settingsDraft.duplicateBehavior = $("#duplicateBehaviorSelect").value; state.settingsDraft.confirmPublishOverwrite = $("#confirmOverwriteCheckbox").checked; state.settingsDraft.autoScan = $("#autoScanCheckbox").checked;
  state.settingsDraft.visualizer = { type: $("#visualizerTypeSelect").value, sensitivity: Number($("#visualizerSensitivityRange").value), smoothing: Number($("#visualizerSmoothingRange").value), showArtwork: $("#visualizerArtworkCheckbox").checked }; state.settingsDraft.unorganizedFields = $$('[data-unorganized-field]:checked').map((checkbox) => checkbox.dataset.unorganizedField);
  $("#settingsStatus").textContent = "Saving…"; try { state.settings = mergeSettings(await window.seraLibrary.saveSettings(state.settingsDraft)); applyTheme(state.settings.theme); audio.volume = state.settings.defaultVolume; $("#volumeBar").value = String(audio.volume); await applyAudioOutput(state.settings.audioOutput, true); $("#settingsStatus").textContent = "Saved"; render(); drawVisualizer(); setTimeout(() => closeModal("settingsModal"), 300); } catch (error) { $("#settingsStatus").textContent = ""; showToast(friendlyError(error, "Settings could not be saved."), true); }
}

async function saveVisualizerChoice(type) {
  if (type !== "off") state.lastVisualizerType = type;
  state.settings.visualizer.type = type; state.settingsDraft = structuredClone(state.settings);
  try { state.settings = mergeSettings(await window.seraLibrary.saveSettings(state.settings)); } catch (error) { showToast(friendlyError(error, "Visualizer setting could not be saved."), true); }
  $("#visualizerCanvas").classList.toggle("hidden", type === "off" || state.mediaSource === "youtube");
  $("#visualizerToggleButton").textContent = `Visuals: ${type === "off" ? "Off" : "On"}`;
  if (type !== "off") drawVisualizer(); else cancelAnimationFrame(visualFrame);
}

async function testAudioOutput() {
  try { const context = new AudioContext(); const destination = context.createMediaStreamDestination(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 523.25; gain.gain.value = .12; oscillator.connect(gain).connect(destination); const test = new Audio(); test.srcObject = destination.stream; if (typeof test.setSinkId === "function") await test.setSinkId($("#audioOutputSelect").value === "default" ? "" : $("#audioOutputSelect").value); await test.play(); oscillator.start(); oscillator.stop(context.currentTime + .45); setTimeout(() => { test.pause(); context.close(); }, 650); showToast("Test tone sent to the selected output."); } catch (error) { showToast(`Output test failed: ${error.message}`, true); }
}

function renderMarkdown(markdown) {
  let listOpen = false; const result = [];
  for (const raw of String(markdown || "").split(/\r?\n/)) { const line = escapeHtml(raw); if (/^### /.test(raw)) { if (listOpen) { result.push("</ul>"); listOpen = false; } result.push(`<h3>${line.slice(4)}</h3>`); } else if (/^## /.test(raw)) { if (listOpen) { result.push("</ul>"); listOpen = false; } result.push(`<h2>${line.slice(3)}</h2>`); } else if (/^# /.test(raw)) { if (listOpen) { result.push("</ul>"); listOpen = false; } result.push(`<h1>${line.slice(2)}</h1>`); } else if (/^- /.test(raw)) { if (!listOpen) { result.push("<ul>"); listOpen = true; } result.push(`<li>${line.slice(2)}</li>`); } else if (raw.trim()) { if (listOpen) { result.push("</ul>"); listOpen = false; } result.push(`<p>${line}</p>`); } }
  if (listOpen) result.push("</ul>"); return result.join("");
}

async function loadUpdatesPage() {
  try { if (!state.appInfo) state.appInfo = await window.seraLibrary.getAppInfo(); $("#installedVersion").textContent = state.appInfo.version; $("#sidebarVersion").textContent = `Version ${state.appInfo.version}`; $("#patchNotes").innerHTML = renderMarkdown(state.appInfo.changelog); } catch (error) { showToast(friendlyError(error, "Patch notes could not be loaded."), true); }
}

async function checkUpdates() {
  const button = $("#checkUpdatesButton"); button.disabled = true; button.textContent = "Checking…";
  try { const result = await window.seraLibrary.checkUpdates(); if (result.available) { state.latestReleaseUrl = result.releaseUrl; $("#updateStatusText").textContent = `${result.releaseName || `Version ${result.latestVersion}`} is available.`; $("#openReleaseButton").classList.remove("hidden"); $("#updateBadge").classList.remove("hidden"); if (result.releaseNotes) $("#patchNotes").innerHTML = `<h2>Latest release</h2>${renderMarkdown(result.releaseNotes)}<hr />${$("#patchNotes").innerHTML}`; } else { $("#updateStatusText").textContent = result.message || "You are up to date."; $("#openReleaseButton").classList.add("hidden"); showToast("No newer release was found."); } } catch (error) { $("#updateStatusText").textContent = friendlyError(error, "Update check failed."); showToast($("#updateStatusText").textContent, true); } finally { button.disabled = false; button.textContent = "Check for updates"; }
}

document.addEventListener("click", async (event) => {
  const closeButton = event.target.closest("[data-close-modal]"); if (closeButton) return closeModal(closeButton.dataset.closeModal);
  const collapseButton = event.target.closest("[data-collapse]"); if (collapseButton) { const section = collapseButton.dataset.collapse; state.settings.collapsedSections[section] = !state.settings.collapsedSections[section]; setCollapsedState(); window.seraLibrary.saveSettings(state.settings).catch(() => {}); return; }
  const viewButton = event.target.closest("[data-view]"); if (viewButton) return setView(viewButton.dataset.view);
  const filterButton = event.target.closest("[data-filter]"); if (filterButton) { state.activeFilter = { type: filterButton.dataset.filter, value: filterButton.dataset.value || "" }; $("#pageTitle").textContent = state.activeFilter.type === "all" ? "Library" : filterButton.querySelector("span")?.textContent || "Songs"; setView("library"); render(); return; }
  const selectBox = event.target.closest("[data-select-id]"); if (selectBox) { event.stopPropagation(); if (selectBox.checked) state.selectedIds.add(selectBox.dataset.selectId); else state.selectedIds.delete(selectBox.dataset.selectId); renderSongList(); return; }
  const queueAdd = event.target.closest("[data-queue-id]"); if (queueAdd) { event.stopPropagation(); const song = state.songs.find((item) => item.id === queueAdd.dataset.queueId); if (song) addToQueue(song); return; }
  const playButton = event.target.closest("[data-play-id]"); if (playButton) { event.stopPropagation(); const song = state.songs.find((item) => item.id === playButton.dataset.playId); if (song) await playSong(song); return; }
  const row = event.target.closest("[data-song-id]"); if (row) { const song = state.songs.find((item) => item.id === row.dataset.songId); if (song) openEditor(song); return; }
  const mediaButton = event.target.closest("[data-media-source]"); if (mediaButton) return selectMediaSource(mediaButton.dataset.mediaSource);
  const lyricLine = event.target.closest("[data-start-ms]"); if (lyricLine && state.playingSong) { const seconds = Number(lyricLine.dataset.startMs) / 1000; if (state.mediaSource === "video") video.currentTime = seconds; else if (state.mediaSource === "audio") audio.currentTime = seconds; else if (youtubePlayer?.seekTo) youtubePlayer.seekTo(seconds, true); return; }
  const queuePlay = event.target.closest("[data-queue-play]"); if (queuePlay) { await playQueueIndex(Number(queuePlay.dataset.queuePlay)); return; }
  const queueRemove = event.target.closest("[data-queue-remove]"); if (queueRemove) { const index = Number(queueRemove.dataset.queueRemove); state.queue.splice(index, 1); if (index < state.queueIndex) state.queueIndex--; else if (index === state.queueIndex) state.queueIndex = Math.min(index, state.queue.length - 1); renderQueue(); return; }
  const playlistLoad = event.target.closest("[data-playlist-load]"); if (playlistLoad) { const playlist = state.playlists.find((item) => item.id === playlistLoad.dataset.playlistLoad); if (playlist) { state.queue = playlist.songIds.map((id) => state.songs.find((song) => song.id === id || song.filePath === id)).filter(Boolean); state.queueIndex = -1; renderQueue(); showToast(`${playlist.name} loaded into the queue.`); } return; }
  const playlistDelete = event.target.closest("[data-playlist-delete]"); if (playlistDelete) { state.playlists = state.playlists.filter((item) => item.id !== playlistDelete.dataset.playlistDelete); await savePlaylists(); return; }
  const remove = event.target.closest("[data-remove-source]"); if (remove) { const source = state.sources.find((item) => item.id === remove.dataset.removeSource); if (source && confirm(`Remove “${source.name}” from this catalog? Your music files will not be deleted.`)) { applyPayload(await window.seraLibrary.removeSource(source.id)); showToast("Folder removed. Files were not changed."); } }
});

document.addEventListener("keydown", (event) => { if (event.key === "Escape") { if (document.body.classList.contains("media-fullscreen")) { document.body.classList.remove("media-fullscreen"); window.seraLibrary.exitFullscreen(); return; } const modal = $$(".modal-overlay:not(.hidden)").pop(); if (modal) closeModal(modal.id); else if (state.massEditorVisible) closeMassEditor(); else if (state.selectedSong) closeEditor(); } });

$("#addFolderButton").addEventListener("click", addFolder); $("#emptyAddFolderButton").addEventListener("click", addFolder); $("#rescanButton").addEventListener("click", refreshLibrary); $("#closeEditorButton").addEventListener("click", closeEditor); $("#saveButton").addEventListener("click", saveSelectedSong);
$("#revealButton").addEventListener("click", () => state.selectedSong && window.seraLibrary.revealFile(state.selectedSong.filePath)); $("#revealPublishedButton").addEventListener("click", () => state.selectedSong?.publishedPath && window.seraLibrary.revealFile(state.selectedSong.publishedPath));
$("#searchInput").addEventListener("input", (event) => { state.search = event.target.value; renderSongList(); }); $("#selectAllCheckbox").addEventListener("change", (event) => { getFilteredSongs().forEach((song) => event.target.checked ? state.selectedIds.add(song.id) : state.selectedIds.delete(song.id)); renderSongList(); });
$("#selectVisibleButton").addEventListener("click", () => { getFilteredSongs().forEach((song) => state.selectedIds.add(song.id)); renderSongList(); }); $("#clearSelectionButton").addEventListener("click", () => { state.selectedIds.clear(); renderSongList(); }); $("#bulkEditButton").addEventListener("click", openMassEditor); $("#applyMassEditButton").addEventListener("click", applyBulkChanges); $("#closeMassEditorButton").addEventListener("click", closeMassEditor); $("#cancelMassEditButton").addEventListener("click", closeMassEditor); $$('[data-mass-apply]').forEach((checkbox) => checkbox.addEventListener("change", () => { $(`#mass${checkbox.dataset.massApply[0].toUpperCase()}${checkbox.dataset.massApply.slice(1)}`).disabled = !checkbox.checked; })); $("#bulkPublishButton").addEventListener("click", () => publishSongs(selectedSongs())); $("#publishSongButton").addEventListener("click", () => { const song = collectEditorSong(); if (song) publishSongs([song]); });

async function chooseArtwork() { try { const result = await window.seraLibrary.selectArtwork(); if (result) { setEditorArtwork(result.artwork); showToast(`${result.fileName} selected. Save to keep it.`); } } catch (error) { showToast(friendlyError(error), true); } }
$("#chooseArtworkButton").addEventListener("click", chooseArtwork); $("#editorCover").addEventListener("click", chooseArtwork);
$("#chooseVideoButton").addEventListener("click", async () => { try { const result = await window.seraLibrary.selectVideo(); if (result) { $("#fieldLocalVideoPath").value = result.filePath; state.draftVideoUrl = result.fileUrl; showToast(`${result.fileName} attached. Save to keep it.`); } } catch (error) { showToast(friendlyError(error), true); } }); $("#clearVideoButton").addEventListener("click", () => { $("#fieldLocalVideoPath").value = ""; state.draftVideoUrl = ""; });
$("#importLyricsButton").addEventListener("click", async () => { try { const result = await window.seraLibrary.selectLyricsFile(); if (!result) return; const lines = parseTimedLyrics(result.text, result.extension); if (!lines.length) return showToast("No readable lyric timestamps were found in that file.", true); state.draftSyncedLyrics = lines; updateSyncedLyricsStatus(); showToast(`${lines.length} timed lyric lines imported. Save to keep them.`); } catch (error) { showToast(friendlyError(error), true); } }); $("#clearLyricsTimingButton").addEventListener("click", () => { state.draftSyncedLyrics = []; updateSyncedLyricsStatus(); });
$("#openSunoButton").addEventListener("click", async () => { try { await window.seraLibrary.openExternal($("#fieldSunoUrl").value.trim()); } catch (error) { showToast(friendlyError(error), true); } }); $("#syncSunoButton").addEventListener("click", readSunoPage); $("#applySunoButton").addEventListener("click", applySunoFields);

$("#settingsButton").addEventListener("click", openSettings); $("#saveSettingsButton").addEventListener("click", saveSettings); $("#refreshDevicesButton").addEventListener("click", refreshAudioDevices); $("#testOutputButton").addEventListener("click", testAudioOutput); $("#defaultVolumeRange").addEventListener("input", (event) => { $("#defaultVolumeOutput").value = `${Math.round(Number(event.target.value) * 100)}%`; }); $("#visualizerSensitivityRange").addEventListener("input", (event) => { $("#visualizerSensitivityOutput").value = `${Number(event.target.value).toFixed(1)}×`; }); $("#visualizerSmoothingRange").addEventListener("input", (event) => { $("#visualizerSmoothingOutput").value = `${Math.round(Number(event.target.value) * 100)}%`; });
$("#expandAllSectionsButton").addEventListener("click", () => { state.settingsDraft.collapsedSections = { personas: false, albums: false, folders: false }; state.settings.collapsedSections = structuredClone(state.settingsDraft.collapsedSections); setCollapsedState(); }); $("#collapseAllSectionsButton").addEventListener("click", () => { state.settingsDraft.collapsedSections = { personas: true, albums: true, folders: true }; state.settings.collapsedSections = structuredClone(state.settingsDraft.collapsedSections); setCollapsedState(); });
$("#choosePublishFolderButton").addEventListener("click", async () => { const settings = await window.seraLibrary.selectPublishFolder(); if (settings) { state.settingsDraft.publishFolder = settings.publishFolder; $("#publishFolderInput").value = settings.publishFolder; } }); $$('[data-theme-key]').forEach((button) => button.addEventListener("click", () => setThemeEditor(button.dataset.themeKey))); for (const name of ["red", "green", "blue"]) $(`#${name}Range`).addEventListener("input", updateThemeFromRgb); $("#themeColorInput").addEventListener("input", (event) => { state.settingsDraft.theme[state.themeEditingKey] = event.target.value; renderThemeSwatches(); setThemeEditor(state.themeEditingKey); applyTheme(state.settingsDraft.theme); }); $("#resetThemeButton").addEventListener("click", () => { state.settingsDraft.theme = structuredClone(DEFAULT_SETTINGS.theme); renderThemeSwatches(); setThemeEditor("primary"); applyTheme(state.settingsDraft.theme); });

async function backupCatalog() { try { if (await window.seraLibrary.backup()) showToast("Catalog backup saved."); } catch (error) { showToast(friendlyError(error, "Backup failed."), true); } }
async function restoreCatalog() { try { const payload = await window.seraLibrary.restore(); if (payload) { applyPayload(payload); showToast("Catalog restored."); } } catch (error) { showToast(friendlyError(error, "Restore failed."), true); } }
$("#backupButton").addEventListener("click", backupCatalog); $("#settingsBackupButton").addEventListener("click", backupCatalog); $("#restoreButton").addEventListener("click", restoreCatalog); $("#settingsRestoreButton").addEventListener("click", restoreCatalog);

$("#playPauseButton").addEventListener("click", togglePlayback); for (const media of [audio, video]) { media.addEventListener("play", () => { updateFooter(); renderNowPlaying(); }); media.addEventListener("pause", () => { updateFooter(); renderNowPlaying(); }); media.addEventListener("loadedmetadata", updateFooter); media.addEventListener("timeupdate", updateFooter); media.addEventListener("ended", handleMediaEnded); }
$("#seekBar").addEventListener("input", () => { const duration = currentPlaybackDuration(); if (duration) seekPlayback(Number($("#seekBar").value) / 100 * duration); }); $("#volumeBar").addEventListener("input", () => { setPlaybackVolume($("#volumeBar").value); if (state.settings.rememberVolume) state.settings.defaultVolume = Number($("#volumeBar").value); }); $("#openNowPlayingButton").addEventListener("click", () => setView("now-playing"));
$("#previousButton").addEventListener("click", () => playPrevious()); $("#nextButton").addEventListener("click", () => playNext()); $("#shuffleButton").addEventListener("click", () => { state.shuffle = !state.shuffle; $("#shuffleButton").classList.toggle("active", state.shuffle); showToast(`Shuffle ${state.shuffle ? "on" : "off"}.`); }); $("#repeatButton").addEventListener("click", () => { state.repeatMode = state.repeatMode === "off" ? "all" : state.repeatMode === "all" ? "one" : "off"; $("#repeatButton").textContent = state.repeatMode === "one" ? "↻1" : "↻"; $("#repeatButton").classList.toggle("active", state.repeatMode !== "off"); $("#repeatButton").title = `Repeat ${state.repeatMode}`; });
$("#queueButton").addEventListener("click", () => { document.body.classList.add("queue-open"); $("#queuePanel").setAttribute("aria-hidden", "false"); renderQueue(); }); $("#closeQueueButton").addEventListener("click", () => { document.body.classList.remove("queue-open"); $("#queuePanel").setAttribute("aria-hidden", "true"); }); $("#clearQueueButton").addEventListener("click", () => { state.queue = state.playingSong ? [state.playingSong] : []; state.queueIndex = state.queue.length ? 0 : -1; renderQueue(); }); $("#savePlaylistButton").addEventListener("click", async () => { const name = $("#playlistNameInput").value.trim(); if (!name || !state.queue.length) return showToast("Enter a playlist name and add songs to the queue first.", true); const existing = state.playlists.find((item) => item.name.toLowerCase() === name.toLowerCase()); const playlist = { id: existing?.id || crypto.randomUUID(), name, songIds: state.queue.map((song) => song.id), updatedAt: new Date().toISOString() }; state.playlists = existing ? state.playlists.map((item) => item.id === existing.id ? playlist : item) : [...state.playlists, playlist]; await savePlaylists(); $("#playlistNameInput").value = ""; showToast(`${name} saved.`); });
$("#nowPlayButton").addEventListener("click", togglePlayback); $("#editPlayingButton").addEventListener("click", () => state.playingSong && openEditor(state.playingSong)); $("#nowRevealButton").addEventListener("click", () => state.playingSong && window.seraLibrary.revealFile(state.playingSong.filePath)); $("#nowOpenSunoButton").addEventListener("click", async () => { if (state.playingSong?.sunoUrl) try { await window.seraLibrary.openExternal(state.playingSong.sunoUrl); } catch (error) { showToast(friendlyError(error), true); } });
$("#nowFavoriteButton").addEventListener("click", async () => { if (!state.playingSong) return; const song = { ...state.playingSong, favorite: !state.playingSong.favorite }; try { await saveSong(song, song.favorite ? "Added to Favorites." : "Removed from Favorites."); } catch (error) { showToast(friendlyError(error), true); } });
$("#quickVisualizerSelect").addEventListener("change", (event) => saveVisualizerChoice(event.target.value)); $("#visualizerToggleButton").addEventListener("click", () => saveVisualizerChoice(state.settings.visualizer.type === "off" ? state.lastVisualizerType : "off")); $("#stageFullscreenButton").addEventListener("click", async () => { try { const fullscreen = await window.seraLibrary.toggleFullscreen(); document.body.classList.toggle("media-fullscreen", fullscreen); $("#stageFullscreenButton").textContent = fullscreen ? "⛶ Exit fullscreen" : "⛶ Fullscreen"; } catch (error) { showToast(friendlyError(error, "Fullscreen could not be opened."), true); } });
$("#openYoutubeExternalButton").addEventListener("click", async () => { if (state.playingSong?.youtubeUrl) try { await window.seraLibrary.openTrustedExternal(state.playingSong.youtubeUrl); } catch (error) { showToast(friendlyError(error), true); } });
$("#lyricsAutoScroll").addEventListener("click", () => { state.lyricsAutoScroll = !state.lyricsAutoScroll; $("#lyricsAutoScroll").textContent = `Auto-scroll: ${state.lyricsAutoScroll ? "On" : "Off"}`; }); $("#lyricsMinus").addEventListener("click", () => { state.lyricsFontSize = Math.max(14, state.lyricsFontSize - 2); $("#lyricsDisplay").style.fontSize = `${state.lyricsFontSize}px`; }); $("#lyricsPlus").addEventListener("click", () => { state.lyricsFontSize = Math.min(42, state.lyricsFontSize + 2); $("#lyricsDisplay").style.fontSize = `${state.lyricsFontSize}px`; });

$("#updatesButton").addEventListener("click", () => setView("updates")); $("#checkUpdatesButton").addEventListener("click", checkUpdates); $("#openReleaseButton").addEventListener("click", () => state.latestReleaseUrl && window.seraLibrary.openTrustedExternal(state.latestReleaseUrl)); $("#openRepositoryButton").addEventListener("click", async () => { if (!state.appInfo) await loadUpdatesPage(); window.seraLibrary.openTrustedExternal(state.appInfo.repositoryUrl); });
if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener("devicechange", () => { if (!$("#settingsModal").classList.contains("hidden")) refreshAudioDevices(); });

setInterval(updateFooter, 100);
loadUpdatesPage(); refreshLibrary();
