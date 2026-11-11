export function normalize(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const normalizeRuleName = (value) => normalize(value).toLowerCase();
