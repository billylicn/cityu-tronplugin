export function announcementContent(announcement) {
  if (!announcement || typeof announcement !== "object") return null;
  const title = text(announcement.title);
  const content = text(announcement.content);
  if (!title.trim() || !content.trim()) return null;
  return {
    title,
    content,
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

function text(value) {
  return typeof value === "string" ? value : "";
}
