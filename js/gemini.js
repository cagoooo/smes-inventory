// Gemini Vision API 封裝 — 透過 Supabase Edge Function 代理，API Key 保留在後端
(function() {
  const KEY_STORAGE = 'smes_gemini_api_key'; // 保留作為離線/備援用

  // ============ 圖片處理 ============
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function compressImage(file, maxSide = 1600, quality = 0.85) {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * ratio);
    const h = Math.round(bitmap.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    return new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }

  // ============ 透過 Edge Function 呼叫 Gemini ============
  // hintType: 'auto' | 'label' | 'device'  → 影響 prompt 分支，優化辨識重點
  async function recognizeViaProxy(file, hintType = 'auto') {
    const C = window.SMES_CONFIG;
    const compressed = await compressImage(file);
    const b64 = await fileToBase64(compressed);

    const url = `${C.SUPABASE_URL}/functions/v1/gemini-proxy`;

    // 🔄 取得保證有效的 token（即將過期會自動 refresh）
    let userToken = null;
    if (window.SMES_AUTH?.getFreshAccessToken) {
      userToken = await window.SMES_AUTH.getFreshAccessToken();
    } else if (window.SMES_AUTH?.getAccessToken) {
      userToken = window.SMES_AUTH.getAccessToken();
    }

    const doFetch = (token) => fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: C.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token || C.SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        image_base64: b64,
        mime_type: 'image/jpeg',
        hint_type: hintType
      })
    });

    let res = await doFetch(userToken);

    // 🔁 若 401，主動 refresh session 再試一次
    if (res.status === 401 && window.__SB) {
      console.warn('[gemini-proxy] 401 received, trying to refresh session...');
      try {
        const { data: { session }, error: refreshErr } = await window.__SB.auth.refreshSession();
        if (!refreshErr && session?.access_token) {
          res = await doFetch(session.access_token);
        } else {
          console.warn('[auth-refresh] failed:', refreshErr);
        }
      } catch (e) {
        console.warn('[auth-refresh] exception:', e);
      }
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      if (res.status === 401) {
        // 🔑 Refresh 也失敗 → 強制登出 + 跳登入畫面
        if (window.SMES_AUTH?.handleSessionExpired) {
          await window.SMES_AUTH.handleSessionExpired('您已久未使用，登入會話過期（Google 登入須每 30 天重新登入一次）');
        }
        throw new Error('登入已過期，請重新登入 Google 帳號後再試');
      }
      if (res.status === 429) {
        throw new Error('辨識太頻繁，請稍候 1 分鐘再試');
      }
      throw new Error(`代理伺服器錯誤 ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    if (!data.parsed) {
      throw new Error('辨識結果為空或 JSON 格式異常: ' + (data.text_raw || '').slice(0, 200));
    }

    // 民國/西元互補
    const parsed = data.parsed;
    if (parsed.roc_year && !parsed.ad_year) parsed.ad_year = parsed.roc_year + 1911;
    if (parsed.ad_year && !parsed.roc_year) parsed.roc_year = parsed.ad_year - 1911;

    return { parsed, raw: data, compressed };
  }

  // ============ 直連 Gemini API（主要方式）============
  // Key 存在 localStorage，由 auth.js 登入成功後從 app_secrets 表讀取
  async function recognizeDirect(file, hintType = 'auto') {
    const key = localStorage.getItem(KEY_STORAGE) || window.SMES_CONFIG.GEMINI_API_KEY;
    if (!key) throw new Error('Gemini API Key 尚未載入，請重新整理頁面');

    const compressed = await compressImage(file);
    const b64 = await fileToBase64(compressed);
    const model = window.SMES_CONFIG.GEMINI_MODEL || 'gemini-2.5-flash';

    // 依 hintType 切換 prompt 重點
    const BASE_JSON = `輸出純 JSON：{"photo_type":"主機|筆電|螢幕|財產標籤|印表機|網通設備|其他","brand":"","model":"","property_number":"","roc_year":整數,"ad_year":整數,"serial_number":"","is_old_device":true/false,"notes":"","confidence":0-1}。民國年+1911=西元年。欄位不確定填 null。常見混淆：1↔7、0↔O、B↔8、5↔S、2↔Z。「取得日期」才是年份非「列印日期」。Windows Product Key 不是 S/N。`;

    let focus;
    if (hintType === 'label') {
      focus = `【拍攝目標：財產標籤貼紙】請特別專注在 property_number 與 roc_year（從「取得日期」讀出）。`;
    } else if (hintType === 'device') {
      focus = `【拍攝目標：設備本體】請特別專注在 brand（logo）、model（銘牌型號）、serial_number。`;
    } else {
      focus = `台灣國小財產盤點：紅白貼紙→財產標籤；品牌機身→主機/筆電/螢幕。`;
    }
    const PROMPT = `你是台灣國小財產盤點 AI 視覺辨識助手。\n\n${focus}\n\n${BASE_JSON}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: PROMPT },
          { inline_data: { mime_type: 'image/jpeg', data: b64 } }
        ]}],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1024 }
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      if (res.status === 429) throw new Error('Gemini 配額不足或請求過多，請稍後再試');
      throw new Error(`Gemini API ${res.status}: ` + t.slice(0, 200));
    }
    const json = await res.json();
    const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error('Gemini 回傳空內容');
    const parsed = JSON.parse(txt);
    if (parsed.roc_year && !parsed.ad_year) parsed.ad_year = parsed.roc_year + 1911;
    if (parsed.ad_year && !parsed.roc_year) parsed.roc_year = parsed.ad_year - 1911;
    return { parsed, raw: json, compressed };
  }

  // 臨時從 app_secrets 再抓一次 key（以防 auth.js loadAppSecrets 還沒跑完）
  async function fetchKeyFromDBOnDemand() {
    if (!window.__SB) return null;
    try {
      const { data: { session } } = await window.__SB.auth.getSession();
      if (!session?.access_token) return null;
      const C = window.SMES_CONFIG;
      const res = await fetch(`${C.SUPABASE_URL}/rest/v1/app_secrets?key=eq.gemini_api_key&select=value`, {
        headers: {
          apikey: C.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`
        }
      });
      if (!res.ok) return null;
      const rows = await res.json();
      if (rows?.[0]?.value) {
        localStorage.setItem(KEY_STORAGE, rows[0].value);
        return rows[0].value;
      }
    } catch {}
    return null;
  }

  // ============ 主入口：優先直連，proxy 作為最後 fallback ============
  async function recognize(file, hintType = 'auto') {
    let hasKey = localStorage.getItem(KEY_STORAGE) || window.SMES_CONFIG.GEMINI_API_KEY;

    // 若 localStorage 沒 key，嘗試從 DB 拿（登入者才能讀）
    if (!hasKey) {
      hasKey = await fetchKeyFromDBOnDemand();
    }

    // 若有 key → 優先直連（避開 Edge Function verify_jwt 陷阱）
    if (hasKey) {
      try {
        return await recognizeDirect(file, hintType);
      } catch (e) {
        console.warn('[gemini-direct] 失敗，嘗試 proxy fallback:', e.message);
        try {
          return await recognizeViaProxy(file, hintType);
        } catch (e2) {
          throw e;  // 回傳最初的 direct 錯誤（較有用）
        }
      }
    }
    // 沒 key（未登入或 RLS 阻擋）→ 用 proxy（會遇到 verify_jwt 但至少有錯誤訊息）
    return await recognizeViaProxy(file, hintType);
  }

  function hasKey() {
    // 永遠 true — 因為後端代理已有 Key
    return true;
  }
  function setKey(k) { localStorage.setItem(KEY_STORAGE, k.trim()); }
  function getKey() { return localStorage.getItem(KEY_STORAGE) || ''; }

  window.SMES_GEMINI = { recognize, hasKey, setKey, getKey, compressImage };
})();
