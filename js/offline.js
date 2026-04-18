// 離線模式：IndexedDB 佇列 + 快取 + 自動重試
(function() {
  const DB_NAME = 'smes-offline';
  const DB_VERSION = 1;
  const STORE_PENDING = 'pending_photos';
  const STORE_CACHE = 'cache';

  let db = null;
  let isOnline = navigator.onLine;
  let retryInProgress = false;

  // ============ 開啟 IndexedDB ============
  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_PENDING)) {
          const s = d.createObjectStore(STORE_PENDING, { keyPath: 'id', autoIncrement: true });
          s.createIndex('created_at', 'created_at');
        }
        if (!d.objectStoreNames.contains(STORE_CACHE)) {
          d.createObjectStore(STORE_CACHE, { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(storeName, mode = 'readonly') {
    const d = await openDB();
    return d.transaction(storeName, mode).objectStore(storeName);
  }

  function wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ============ 離線佇列：加入待上傳照片 ============
  async function enqueuePhoto({ file, classroom_code, record }) {
    const store = await tx(STORE_PENDING, 'readwrite');
    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const id = await wrap(store.add({
      blob,
      blob_type: file.type,
      blob_name: file.name || 'photo.jpg',
      classroom_code,
      record,          // 要插入 photo_records 的資料
      attempts: 0,
      created_at: Date.now()
    }));
    updateBadge();
    // 請 SW 啟動背景同步（如果支援）
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('sync' in reg) await reg.sync.register('smes-retry-uploads');
    } catch {}
    return id;
  }

  async function listPending() {
    const store = await tx(STORE_PENDING);
    return wrap(store.getAll());
  }

  async function removePending(id) {
    const store = await tx(STORE_PENDING, 'readwrite');
    await wrap(store.delete(id));
    updateBadge();
  }

  async function incrementAttempt(id) {
    const store = await tx(STORE_PENDING, 'readwrite');
    const row = await wrap(store.get(id));
    if (row) {
      row.attempts = (row.attempts || 0) + 1;
      row.last_attempt = Date.now();
      await wrap(store.put(row));
    }
  }

  // ============ 快取資料 (鍵值存取) ============
  async function cacheSet(key, value) {
    const store = await tx(STORE_CACHE, 'readwrite');
    await wrap(store.put({ key, value, updated_at: Date.now() }));
  }

  async function cacheGet(key) {
    const store = await tx(STORE_CACHE);
    const row = await wrap(store.get(key));
    return row?.value;
  }

  // ============ 重試上傳佇列 ============
  async function retryUploads() {
    if (retryInProgress) return;
    if (!navigator.onLine) return;
    retryInProgress = true;

    try {
      const pending = await listPending();
      if (!pending.length) return;

      window.SMES_OFFLINE.toast?.(`📡 找到 ${pending.length} 筆待上傳照片，重試中…`);

      let success = 0, failed = 0;
      for (const row of pending) {
        try {
          // 1. 上傳 blob 到 Supabase Storage
          const file = new File([row.blob], row.blob_name, { type: row.blob_type });
          const photoUrl = await window.SMES_DB.uploadPhoto(file, row.record.photo_path);

          // 2. 插入 photo_records
          await window.SMES_DB.insertPhoto({
            ...row.record,
            photo_url: photoUrl
          });

          await removePending(row.id);
          success++;
        } catch (e) {
          console.error('[retryUpload] failed id=' + row.id, e);
          await incrementAttempt(row.id);
          failed++;
        }
      }

      if (success > 0) {
        window.SMES_OFFLINE.toast?.(`✅ 成功上傳 ${success} 筆${failed > 0 ? `，${failed} 筆失敗` : ''}`, 'success');
      } else if (failed > 0) {
        window.SMES_OFFLINE.toast?.(`⚠️ ${failed} 筆重試失敗，稍後會再試`, 'error');
      }
    } finally {
      retryInProgress = false;
    }
  }

  // ============ 網路狀態監聽 + Badge ============
  function updateBadge() {
    listPending().then(pending => {
      const count = pending.length;
      const el = document.getElementById('offlineBadge');
      if (el) {
        if (count > 0 || !isOnline) {
          el.style.display = 'flex';
          el.innerHTML = !isOnline
            ? `📴 離線模式${count > 0 ? ' · '+count+' 筆待傳' : ''}`
            : `📤 ${count} 筆待上傳`;
          el.className = 'offline-badge ' + (!isOnline ? 'offline' : 'pending');
        } else {
          el.style.display = 'none';
        }
      }
      // 更新 PWA Badge API (iOS 16.4+/Chrome 有支援)
      try {
        if ('setAppBadge' in navigator) {
          if (count > 0) navigator.setAppBadge(count);
          else navigator.clearAppBadge();
        }
      } catch {}
    });
  }

  function onStatusChange() {
    isOnline = navigator.onLine;
    updateBadge();
    if (isOnline) {
      setTimeout(() => retryUploads(), 1500); // 網路恢復 1.5 秒後重試（避免剛連上 DNS 還沒 ready）
    }
  }

  // ============ 啟動 ============
  function init() {
    window.addEventListener('online', onStatusChange);
    window.addEventListener('offline', onStatusChange);

    // 收到 SW 的背景同步通知
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'retry-uploads') retryUploads();
      });
    }

    updateBadge();

    // 頁面可見時也重試一次（切回 App 時）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        setTimeout(() => retryUploads(), 800);
      }
    });

    // 首次啟動時如果有網就重試
    if (navigator.onLine) {
      setTimeout(() => retryUploads(), 2000);
    }
  }

  window.SMES_OFFLINE = {
    init,
    enqueuePhoto,
    listPending,
    removePending,
    retryUploads,
    cacheSet,
    cacheGet,
    updateBadge,
    isOnline: () => isOnline,
    // toast 由 app.js 注入
    toast: null
  };
})();
