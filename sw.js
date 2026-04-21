// Service Worker — 石門國小盤點系統 v6
// 策略：
//   - 靜態資源 (HTML/CSS/JS/icon/CDN)：cache-first
//   - Supabase REST/Storage API：network-first，失敗則讀 cache
//   - 照片 URL (Supabase Storage CDN)：stale-while-revalidate
const CACHE_VERSION = 'smes-v7.4.4-2026-04-18z';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DATA_CACHE = `data-${CACHE_VERSION}`;
const PHOTO_CACHE = `photo-${CACHE_VERSION}`;

// 啟動時預先快取的核心資源
const PRECACHE = [
  './',
  './index.html',
  './manage.html',
  './config.js',
  './manifest.json',
  './icon.svg',
  './css/style.css',
  './js/auth.js',
  './js/supabase-client.js',
  './js/gemini.js',
  './js/app.js',
  './js/manage.js',
  './js/dashboard.js',
  './js/floorplan.js',
  './js/offline.js',
  './js/camera.js',
  './js/error-monitor.js',
  './js/version-check.js',
  './js/qr-labels.js',
  './js/monthly-report.js',
  './js/veyon-export.js',
  './js/network-tools.js',
  './js/touchscreen-ports.js',
  './version.json',
  // CDN scripts
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

// ============ Install ============
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      // 個別 add 避免單一資源失敗整批失敗
      Promise.allSettled(PRECACHE.map(url => cache.add(url).catch(err => console.warn('[SW] skip', url, err))))
    )
  );
});

// ============ Activate — 清除舊版 cache ============
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !k.endsWith(CACHE_VERSION)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ============ Fetch ============
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 只處理 GET
  if (req.method !== 'GET') return;

  // Cache API 只支援 http(s)，跳過 chrome-extension: / data: / blob: 等特殊協定
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 跳過瀏覽器擴充的 request
  if (url.hostname === 'chrome-extension' || url.protocol.startsWith('chrome')) return;

  // === Supabase REST API ===
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/')) {
    e.respondWith(networkFirstWithFallback(req, DATA_CACHE));
    return;
  }

  // === Supabase Storage (照片) — stale-while-revalidate ===
  if (url.hostname.endsWith('.supabase.co') && url.pathname.includes('/storage/v1/object/')) {
    e.respondWith(staleWhileRevalidate(req, PHOTO_CACHE));
    return;
  }

  // === Edge Function (Gemini proxy) — 永遠不 cache（需即時 API）===
  if (url.pathname.startsWith('/functions/v1/')) {
    return; // 讓瀏覽器直接走網路
  }

  // === 靜態資源 (自站 + CDN) — cache-first ===
  if (
    PRECACHE.some(p => req.url.includes(p.replace('./', ''))) ||
    url.origin === self.location.origin ||
    url.hostname.includes('jsdelivr.net')
  ) {
    e.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
});

// ============ Strategies ============
// 只 cache http(s) 且 status 為 200 的完整 response（避免 partial/opaque 大小錯誤）
function isCacheable(req, res) {
  if (!res || !res.ok) return false;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return true;
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (isCacheable(req, res)) {
      try { await cache.put(req, res.clone()); } catch (e) { /* ignore cache errors */ }
    }
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

async function networkFirstWithFallback(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (isCacheable(req, res)) {
      try { await cache.put(req, res.clone()); } catch (e) { /* ignore */ }
    }
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) {
      // 加標頭標示是 cache 資料
      const clone = cached.clone();
      const newHeaders = new Headers(clone.headers);
      newHeaders.set('x-from-sw-cache', 'true');
      return new Response(await clone.blob(), { status: clone.status, headers: newHeaders });
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (isCacheable(req, res)) {
      try { cache.put(req, res.clone()); } catch (e) { /* ignore */ }
    }
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// ============ Background Sync — 離線佇列重試 ============
self.addEventListener('sync', (e) => {
  if (e.tag === 'smes-retry-uploads') {
    e.waitUntil(notifyClientsRetry());
  }
});

async function notifyClientsRetry() {
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'retry-uploads' }));
}

// Message from page (e.g. register 新增一個 pending photo 後觸發 sync)
self.addEventListener('message', (e) => {
  if (e.data?.type === 'request-sync') {
    self.registration.sync.register('smes-retry-uploads').catch(() => {});
  }
});
