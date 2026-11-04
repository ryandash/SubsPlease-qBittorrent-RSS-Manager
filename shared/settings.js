export function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function hasConnectionSettings(settings) {
  return Boolean(settings?.url && settings.username && settings.password);
}

export function validateWebUiUrl(value) {
  const url = new URL(normalizeUrl(value));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The qBittorrent Web UI URL must use HTTP or HTTPS.");
  }
  return normalizeUrl(url.href);
}

export function hostPermissionPattern(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}
