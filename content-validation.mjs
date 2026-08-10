export function looksLikeLyrics(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length < 3 || text.length > 200000) return false;
  if (/^[$€£¥]\s*\d+(?:[.,]\d{1,2})?$/.test(text) || /^\d+(?:[.,]\d+)?$/.test(text)) return false;
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  if (words.length < 3 && !text.includes("\n")) return false;
  if (/^(?:price|cost|credits?|likes?|plays?|views?)\s*[:=-]?\s*[$€£¥]?\d+/i.test(text)) return false;
  return /\n|\[[^\]]*(?:verse|chorus|bridge|intro|outro|hook|pre-chorus)[^\]]*\]/i.test(text)
    || words.length >= 8;
}
