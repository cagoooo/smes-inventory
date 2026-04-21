// 登入模組 — 透過 Supabase JS SDK + Google OAuth + 限定網域
(function() {
  const C = window.SMES_CONFIG;
  const ALLOWED_DOMAIN = 'mail2.smes.tyc.edu.tw';

  let sb = null;
  let currentUser = null;
  let onReadyCallbacks = [];
  let sessionReady = false;

  function initClient() {
    if (!window.supabase) {
      console.error('Supabase SDK not loaded');
      return;
    }
    sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit'  // GitHub Pages 靜態網站用 implicit flow
      }
    });
    window.__SB = sb; // debug 用
  }

  // 從 Supabase app_secrets 表讀 Gemini API Key 到 localStorage（供前端直連 Gemini）
  async function loadAppSecrets() {
    try {
      const C = window.SMES_CONFIG;
      const userToken = (await sb.auth.getSession())?.data?.session?.access_token;
      if (!userToken) return;
      const res = await fetch(`${C.SUPABASE_URL}/rest/v1/app_secrets?key=eq.gemini_api_key&select=value`, {
        headers: {
          apikey: C.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${userToken}`
        }
      });
      if (!res.ok) {
        console.warn('[app_secrets] fetch failed:', res.status);
        return;
      }
      const rows = await res.json();
      if (rows?.[0]?.value) {
        localStorage.setItem('smes_gemini_api_key', rows[0].value);
        console.log('[app_secrets] Gemini key loaded');
      }
    } catch (e) {
      console.warn('[app_secrets] error:', e);
    }
  }

  async function initSession() {
    const { data: { session } } = await sb.auth.getSession();
    currentUser = session?.user || null;

    // 網域檢查
    if (currentUser) {
      const email = currentUser.email || '';
      if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
        // 不符合網域 → 強制登出
        alert(`此系統僅限 @${ALLOWED_DOMAIN} 帳號使用。\n\n您目前使用：${email}\n\n將為您登出。`);
        await sb.auth.signOut();
        currentUser = null;
      }
    }

    // 登入成功 → 載入 Gemini API Key 到 localStorage
    if (currentUser) loadAppSecrets();

    sessionReady = true;
    updateAuthUI();
    onReadyCallbacks.forEach(cb => { try { cb(currentUser); } catch (e) {} });
    onReadyCallbacks = [];

    // 監聽 Auth 狀態變更（不再自動 reload — onReady 已處理首次載入流程）
    sb.auth.onAuthStateChange(async (event, session) => {
      const newUser = session?.user || null;
      if (newUser && !newUser.email?.endsWith('@' + ALLOWED_DOMAIN)) {
        alert(`此系統僅限 @${ALLOWED_DOMAIN} 帳號使用，將為您登出。`);
        await sb.auth.signOut();
        return;
      }
      currentUser = newUser;
      updateAuthUI();
      // 每次登入/token 更新 → 重新載入 Gemini key
      if (newUser && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        loadAppSecrets();
      }
    });
  }

  async function signIn() {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          hd: ALLOWED_DOMAIN,  // Google Workspace hosted domain hint
          prompt: 'select_account'
        }
      }
    });
    if (error) {
      alert('登入失敗：' + error.message);
      console.error(error);
    }
  }

  async function signOut() {
    if (confirm('確定要登出嗎？')) {
      await sb.auth.signOut();
      location.reload();
    }
  }

  function updateAuthUI() {
    const loginScreen = document.getElementById('loginScreen');
    const appShell = document.getElementById('appShell');
    const userChip = document.getElementById('userChip');

    if (!loginScreen || !appShell) return;

    if (currentUser) {
      loginScreen.style.display = 'none';
      appShell.style.display = '';

      if (userChip) {
        const name = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email;
        const avatar = currentUser.user_metadata?.avatar_url;
        userChip.innerHTML = `
          ${avatar ? `<img src="${avatar}" alt="" style="width:28px;height:28px;border-radius:50%;">` : '<span style="font-size:22px;">👤</span>'}
          <div class="user-info">
            <div class="user-name">${name.length > 12 ? name.slice(0,12)+'…' : name}</div>
            <div class="user-mail">${currentUser.email.replace('@'+ALLOWED_DOMAIN, '')}</div>
          </div>
          <button class="user-logout" onclick="SMES_AUTH.signOut()" title="登出">⏻</button>
        `;
        userChip.style.display = 'flex';
      }
    } else {
      loginScreen.style.display = 'flex';
      appShell.style.display = 'none';
      if (userChip) userChip.style.display = 'none';
    }
  }

  function getAccessToken() {
    // 同步版本 — 從 localStorage 撈出 access token
    // ⚠️ 若 token 已過期，會回傳過期的 token
    const keys = Object.keys(localStorage);
    const authKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!authKey) return null;
    try {
      const data = JSON.parse(localStorage.getItem(authKey));
      return data?.access_token || null;
    } catch { return null; }
  }

  // 🔄 取得保證有效的 access_token — 若即將過期會自動 refresh
  // 重要 API 呼叫（如 Edge Function）應該用這個版本
  async function getFreshAccessToken() {
    if (!sb) return getAccessToken();
    try {
      const { data: { session }, error } = await sb.auth.getSession();
      if (error) {
        console.warn('[auth] getSession error:', error);
        return getAccessToken();
      }
      if (!session) return null;
      // 檢查是否即將過期（<5 分鐘）→ 主動 refresh
      const expiresAt = session.expires_at || 0;  // unix timestamp (秒)
      const now = Math.floor(Date.now() / 1000);
      const remaining = expiresAt - now;
      if (remaining < 300) {
        // 少於 5 分鐘 → refresh
        try {
          const { data: { session: newSession }, error: refreshErr } = await sb.auth.refreshSession();
          if (!refreshErr && newSession) {
            return newSession.access_token;
          }
        } catch (e) {
          console.warn('[auth] refresh failed:', e);
        }
      }
      return session.access_token;
    } catch (e) {
      console.warn('[auth] getFreshAccessToken error:', e);
      return getAccessToken();
    }
  }

  function onReady(cb) {
    if (sessionReady) cb(currentUser);
    else onReadyCallbacks.push(cb);
  }

  function getUser() { return currentUser; }

  // 🔄 會話完全過期時，清空登入狀態 + 彈出重新登入畫面
  async function handleSessionExpired(reason = '登入會話已過期') {
    try { await sb?.auth.signOut(); } catch {}
    // 清除所有 sb-* localStorage
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-'))
      .forEach(k => localStorage.removeItem(k));
    currentUser = null;

    // 顯示登入畫面 + 提示
    const loginScreen = document.getElementById('loginScreen');
    const appShell = document.getElementById('appShell');
    if (loginScreen && appShell) {
      appShell.style.display = 'none';
      loginScreen.style.display = 'flex';

      // 加個過期提示
      const card = loginScreen.querySelector('.login-card');
      if (card && !card.querySelector('.session-expired-banner')) {
        const banner = document.createElement('div');
        banner.className = 'session-expired-banner';
        banner.style.cssText = `
          background: var(--danger-soft); color: var(--danger);
          padding: 10px 14px; border-radius: 10px;
          font-size: 13px; line-height: 1.45; margin-bottom: 14px;
          border-left: 4px solid var(--danger);
          text-align: left;
        `;
        banner.innerHTML = `⏰ <b>${reason}</b><br>請按下方「用 Google 登入」重新登入即可繼續使用`;
        card.insertBefore(banner, card.firstChild);
      }
    }
  }

  window.SMES_AUTH = {
    initClient,
    initSession,
    signIn,
    signOut,
    getUser,
    getAccessToken,
    getFreshAccessToken,
    handleSessionExpired,
    onReady,
    ALLOWED_DOMAIN
  };
})();
