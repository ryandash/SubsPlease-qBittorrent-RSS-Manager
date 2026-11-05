(() => {
  const app = globalThis.SubsPleaseQbit;
  const cache = new Map();
  const pending = new Map();
  const emptyResult = Object.freeze({ href: "#", imageUrl: "" });

  app.resolveArtworkForTitle = async (title) => {
    const query = String(title || "").trim();
    const key = app.normalizeRuleName(query);
    if (!query) return emptyResult;
    if (cache.has(key)) return cache.get(key);
    if (pending.has(key)) return pending.get(key);

    const request = (async () => {
      try {
        const params = new URLSearchParams({
          f: "search",
          tz: "America/Toronto",
          s: query,
        });
        const response = await fetch(`https://subsplease.org/api/?${params}`);
        if (!response.ok) return emptyResult;

        const payload = await response.json();
        const result = Array.isArray(payload)
          ? payload[0]
          : Array.isArray(payload?.results)
            ? payload.results[0]
            : Object.values(payload || {})[0];
        if (!result) return emptyResult;

        return {
          href: result.page ? `/shows/${result.page}` : "#",
          imageUrl: result.image_url
            ? `https://subsplease.org${result.image_url}`
            : "",
        };
      } catch {
        return emptyResult;
      }
    })();

    pending.set(key, request);
    try {
      const result = await request;
      cache.set(key, result);
      return result;
    } finally {
      pending.delete(key);
    }
  };
})();
