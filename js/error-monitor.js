// 前端錯誤監控 — 收集 JS 錯誤 / Promise 未捕捉 / fetch 失敗
(function() {
  const FLUSH_INTERVAL = 15_000;  // 15 秒 flush 一次
  const MAX_QUEUE = 50;           // 最多排隊 50 筆避免爆
  const queue = [];
  let appVersion = 'unknown';
  let isFlushing = false;

  // 讀取版本
  fetch('./version.json').then(r => r.json()).then(d => { appVersion = d.version; }).catch(() => {});

  function enqueue(level, message, extra = {}) {
    if (queue.length >= MAX_QUEUE) return;
    const user = window.SMES_AUTH?.getUser?.();
    queue.push({
      user_id: user?.id || null,
      user_email: user?.email || null,
      level,
      message: String(message).slice(0, 500),
      stack: extra.stack ? String(extra.stack).slice(0, 2000) : null,
      url: location.href.slice(0, 300),
      user_agent: navigator.userAgent.slice(0, 200),
      app_version: appVersion,
      context: extra.context || null
    });
  }

  async function flush() {
    if (isFlushing || queue.length === 0) return;
    if (!navigator.onLine) return;
    const user = window.SMES_AUTH?.getUser?.();
    if (!user) return; // 未登入不送（避免匿名洗 log）

    isFlushing = true;
    const batch = queue.splice(0, queue.length);
    try {
      const C = window.SMES_CONFIG;
      const token = window.SMES_AUTH?.getAccessToken?.();
      if (!C || !token) { queue.unshift(...batch); return; }

      await fetch(`${C.SUPABASE_URL}/rest/v1/error_logs`, {
        method: 'POST',
        headers: {
          apikey: C.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(batch)
      });
    } catch (e) {
      // flush 失敗了不能再 log，否則遞迴爆。只 console
      console.warn('[err-monitor] flush failed', e);
      // 放回去但最多保留一半避免滾雪球
      queue.unshift(...batch.slice(0, Math.floor(MAX_QUEUE / 2)));
    } finally {
      isFlushing = false;
    }
  }

  // ============ 掛載 ============
  window.addEventListener('error', (e) => {
    enqueue('error', e.message || 'window error', {
      stack: e.error?.stack,
      context: { filename: e.filename, line: e.lineno, col: e.colno }
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    enqueue('error', reason?.message || String(reason), {
      stack: reason?.stack,
      context: { type: 'unhandledrejection' }
    });
  });

  // 定期 flush
  setInterval(flush, FLUSH_INTERVAL);
  // 頁面離開時盡力送
  window.addEventListener('beforeunload', () => {
    if (queue.length > 0) {
      try {
        const C = window.SMES_CONFIG;
        const token = window.SMES_AUTH?.getAccessToken?.();
        if (C && token) {
          navigator.sendBeacon?.(
            `${C.SUPABASE_URL}/rest/v1/error_logs?apikey=${C.SUPABASE_ANON_KEY}`,
            new Blob([JSON.stringify(queue)], { type: 'application/json' })
          );
        }
      } catch {}
    }
  });

  window.SMES_ERR = {
    log: (level, msg, extra) => enqueue(level, msg, extra),
    flush
  };
})();
