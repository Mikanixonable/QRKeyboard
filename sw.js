/* sw.js — QRKeyboard 用サービスワーカー
 * オフラインでも起動・生成・(読み込み済みライブラリでの)デコードができるよう、
 * アプリ本体一式と外部ライブラリ (ZXing・Webフォント) をキャッシュする。
 * キャッシュ優先 + バックグラウンド更新 (stale-while-revalidate) 方式。
 * 依存ファイルを追加/変更したら CACHE_VERSION を上げてキャッシュを世代交代させる。 */
const CACHE_VERSION = "v6";
const CACHE_NAME = "qrkeyboard-" + CACHE_VERSION;

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./app-util.js",
  "./qrcode.js",
  "./datamatrix.js",
  "./aztec.js",
  "./barcode1d.js",
  "./pdf417.js",
  "./decode-finder.js",
  "./decode-1d.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 同一オリジンのファイルは stale-while-revalidate (即キャッシュ返却+裏で更新)。
   別オリジン (ZXing CDN・Google Fonts) はキャッシュ優先で、初回オンライン時に
   取得できていれば以降オフラインでも動く。 */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
