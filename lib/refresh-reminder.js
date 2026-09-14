export const MANUAL_REFRESH_REMINDER_MS = 24 * 60 * 60 * 1000;

export function validReminderSince(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function manualRefreshReminderDue({ autoRefresh, reminderSince, now = Date.now() } = {}) {
  if (autoRefresh) return false;
  const normalized = validReminderSince(reminderSince);
  if (!normalized || !Number.isFinite(Number(now))) return false;
  return Number(now) - Date.parse(normalized) >= MANUAL_REFRESH_REMINDER_MS;
}
