const FORTALEZA_TIME_ZONE = "America/Fortaleza";
const FORTALEZA_UTC_OFFSET_HOURS = 3;

function parseFortalezaDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, year, month, day, hour, minute, second = "0"] = match;
    const timestamp = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) + FORTALEZA_UTC_OFFSET_HOURS,
      Number(minute),
      Number(second)
    );
    return new Date(timestamp);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isScheduledForFuture(value, now = Date.now()) {
  const parsed = parseFortalezaDate(value);
  return Boolean(parsed && now < parsed.getTime());
}

function isExpired(value, now = Date.now()) {
  const parsed = parseFortalezaDate(value);
  return Boolean(parsed && now > parsed.getTime());
}

function isWithinSchedule({ startsAt = "", validUntil = "" } = {}, now = Date.now()) {
  if (isScheduledForFuture(startsAt, now)) return false;
  if (isExpired(validUntil, now)) return false;
  return true;
}

function formatFortalezaDate(value) {
  const parsed = parseFortalezaDate(value);
  if (!parsed) return "";
  return parsed.toLocaleString("pt-BR", { timeZone: FORTALEZA_TIME_ZONE });
}

module.exports = {
  FORTALEZA_TIME_ZONE,
  formatFortalezaDate,
  isExpired,
  isScheduledForFuture,
  isWithinSchedule,
  parseFortalezaDate
};
