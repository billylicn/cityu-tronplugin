export function normalizeVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) return null;
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function displayVersion(value) {
  const normalized = normalizeVersion(value);
  return normalized ? `v${normalized.join(".")}` : "版本未知";
}
