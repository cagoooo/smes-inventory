// 版本檢查與 SW 更新提示
(function() {
  let localVersion = null;

  // 啟動 30 秒後開始每 5 分鐘檢查一次
  async function checkVersion() {
    try {
      const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!localVersion) {
        localVersion = data.version;
        showVersionTag(data);
        return;
      }
      if (data.version !== localVersion) {
        showUpdateBanner(data);
      }
    } catch (e) {
      // 網路斷了就跳過
    }
  }

  function showVersionTag(data) {
    const tag = document.createElement('div');
    tag.className = 'version-tag';
    tag.innerHTML = `<a href="https://github.com/cagoooo/smes-inventory/blob/main/ROADMAP.md" target="_blank" title="${data.notes || ''}" >v${data.version.replace(/^v/, '')}</a>`;
    document.body.appendChild(tag);
  }

  function showUpdateBanner(data) {
    if (document.getElementById('updateBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.className = 'update-banner';
    banner.innerHTML = `
      <span>🆕 新版已推出 <b>${data.version}</b>${data.notes ? ` · ${data.notes}` : ''}</span>
      <button onclick="SMES_VERSION.applyUpdate()">更新</button>
      <button onclick="document.getElementById('updateBanner').remove()" aria-label="稍後">✕</button>
    `;
    document.body.appendChild(banner);
  }

  async function applyUpdate() {
    // 強制重新註冊 SW，清舊 cache
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        await r.update();
      }
    }
    // 清瀏覽器快取（只清我們控制的）
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // 硬重整
    location.reload();
  }

  // SW 有新版本時也跳 banner
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[SW] controller changed, new version active');
    });
    navigator.serviceWorker.ready.then(reg => {
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (newSW) {
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              // 有舊的 SW 在跑 + 新的 SW 裝好了 → 顯示更新提示
              fetch('./version.json?t=' + Date.now()).then(r => r.json()).then(showUpdateBanner).catch(() => {
                showUpdateBanner({ version: '(最新)', notes: '點擊更新以使用新版' });
              });
            }
          });
        }
      });
    });
  }

  // 啟動檢查
  setTimeout(checkVersion, 2000);
  setInterval(checkVersion, 5 * 60 * 1000); // 5 分鐘

  window.SMES_VERSION = { checkVersion, applyUpdate };
})();
