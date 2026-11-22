// Bump this value for each release, including image-only changes.
const VERSION = "v1";
const SCOPE = self.registration.scope;
const PREFIX = "zeta-division-bangkok:" + encodeURIComponent(SCOPE) + ":";
const CACHE = PREFIX + VERSION;

const localURL = (path) => new URL(path, SCOPE).href;
const INDEX = localURL("index.html");

const SHELL = new Set([INDEX]);
const IMAGE_DIR = localURL("img/");
const freshRequest = (url) => new Request(url, { cache: "reload", redirect: "error" });

async function installGuide() {
  const cache = await caches.open(CACHE);
  await cache.addAll(Array.from(SHELL, freshRequest));

  // This standalone HTML lists the shipped photos as quoted img/ paths.
  const source = await (await cache.match(INDEX)).text();
  const paths = source.matchAll(/["'`](img\/[\w.-]+\.(?:jpe?g|png|webp|svg))["'`]/g);
  const photos = new Set(Array.from(paths, (match) => localURL(match[1])));
  await cache.addAll(Array.from(photos, freshRequest));
}

self.addEventListener("install", (event) => {
  // Let a successful update activate after tabs using the old worker close.
  event.waitUntil(installGuide());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function serve(request, key, image) {
  const cache = await caches.open(CACHE);
  if (image) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  let response;
  try {
    response = await fetch(request, { cache: "no-cache" });
  } catch (error) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw error;
  }

  if (response.status >= 500) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  if (response.status === 200 && response.type === "basic" && !response.redirected
      && !new URL(request.url).search && !/\b(?:private|no-store)\b/i.test(response.headers.get("Cache-Control") || "")) {
    // A failed cache write (e.g. storage quota) should still return the online response.
    try { await cache.put(key, response.clone()); } catch { /* best effort */ }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      request.headers.has("Range") || request.headers.has("Authorization") || request.cache === "no-store") return;

  url.search = "";
  url.hash = "";
  const key = url.href === SCOPE ? INDEX : url.href;
  const image = key.startsWith(IMAGE_DIR) && /\.(?:jpe?g|png|webp|svg)$/i.test(url.pathname);
  if (image || SHELL.has(key)) event.respondWith(serve(request, key, image));
});
