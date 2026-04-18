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
    // 從 localStorage 撈出 access token（Supabase SDK 存在 'sb-<ref>-auth-token'）
    const keys = Object.keys(localStorage);
    const authKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!authKey) return null;
    try {
      const data = JSON.parse(localStorage.getItem(authKey));
      return data?.access_token || null;
    } catch { return null; }
  }

  function onReady(cb) {
    if (sessionReady) cb(currentUser);
    else onReadyCallbacks.push(cb);
  }

  function getUser() { return currentUser; }

  window.SMES_AUTH = {
    initClient,
    initSession,
    signIn,
    signOut,
    getUser,
    getAccessToken,
    onReady,
    ALLOWED_DOMAIN
  };
})();
