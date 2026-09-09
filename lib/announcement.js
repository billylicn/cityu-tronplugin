export function announcementContent(announcement) {
  if (!announcement || typeof announcement !== "object") return null;

  const title = text(announcement.title);
  const paragraphs = textList(announcement.paragraphs);
  const items = textList(announcement.items);
  if (!title.trim() || (!paragraphs.length && !items.length)) return null;

  return {
    label: text(announcement.label),
    title,
    publishedAt: text(announcement.publishedAt),
    paragraphs,
    items,
    actionLabel: text(announcement.actionLabel),
    actionUrl: text(announcement.actionUrl)
  };
}

export async function announcementFingerprint(announcement) {
  const normalized = announcementContent(announcement);
  if (!normalized) return "";
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("当前环境不支持通知内容校验");
  const payload = JSON.stringify(normalized);
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function textList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((item) => item.trim());
}

function text(value) {
  return typeof value === "string" ? value : "";
}
