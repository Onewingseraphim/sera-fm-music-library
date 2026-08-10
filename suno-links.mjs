const SUNO_HOSTS = new Set(["suno.com", "www.suno.com"]);
const SUNO_PATH = /^\/(song|s)\/([a-zA-Z0-9_-]+)\/?$/;

export function parseSunoLink(value, baseUrl) {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(String(value || "").trim());
    const match = SUNO_PATH.exec(url.pathname);
    if (url.protocol !== "https:" || !SUNO_HOSTS.has(url.hostname.toLowerCase()) || !match) return null;
    url.hash = "";
    return {
      url,
      kind: match[1] === "s" ? "share" : "song",
      token: match[2],
    };
  } catch {
    return null;
  }
}

export function sunoSongIdFromLink(value, baseUrl) {
  const parsed = parseSunoLink(value, baseUrl);
  return parsed?.kind === "song" ? parsed.token : "";
}
