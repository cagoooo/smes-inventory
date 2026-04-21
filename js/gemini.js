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
        const { data: { session } } = await window.__SB.auth.refreshSession();
        if (session?.access_token) {
          res = await doFetch(session.access_token);
        }
      } catch (e) {
        console.warn('[auth-refresh]', e);
      }
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      if (res.status === 401) {
        throw new Error('登入已過期且自動刷新失敗，請重新整理頁面並重新登入 Google 帳號');
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

  // ============ 備援：本機 Key 直接呼叫（若 Edge Function 尚未設定 Secret 可切回此模式） ============
  async function recognizeDirect(file) {
    const key = localStorage.getItem(KEY_STORAGE) || window.SMES_CONFIG.GEMINI_API_KEY;
    if (!key) throw new Error('Edge Function 無法使用且本機無 API Key');

    const compressed = await compressImage(file);
    const b64 = await fileToBase64(compressed);
    const model = window.SMES_CONFIG.GEMINI_MODEL;

    const PROMPT = `你是台灣國小財產盤點 AI。分析照片回傳 JSON：{"photo_type":"主機|筆電|螢幕|財產標籤|其他","brand":"","model":"","property_number":"","roc_year":整數,"ad_year":整數,"serial_number":"","notes":"","confidence":0-1}。民國年+1911=西元年。欄位不確定填 null。`;

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
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ` + (await res.text()).slice(0,200));
    const json = await res.json();
    const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(txt);
    if (parsed.roc_year && !parsed.ad_year) parsed.ad_year = parsed.roc_year + 1911;
    if (parsed.ad_year && !parsed.roc_year) parsed.roc_year = parsed.ad_year - 1911;
    return { parsed, raw: json, compressed };
  }

  async function recognize(file, hintType = 'auto') {
    try {
      return await recognizeViaProxy(file, hintType);
    } catch (e) {
      console.warn('[gemini-proxy] 失敗，嘗試本機 Key 備援:', e.message);
      if (localStorage.getItem(KEY_STORAGE) || window.SMES_CONFIG.GEMINI_API_KEY) {
        return await recognizeDirect(file);  // direct 模式仍用通用 prompt
      }
      throw e;
    }
  }

  function hasKey() {
    // 永遠 true — 因為後端代理已有 Key
    return true;
  }
  function setKey(k) { localStorage.setItem(KEY_STORAGE, k.trim()); }
  function getKey() { return localStorage.getItem(KEY_STORAGE) || ''; }

  window.SMES_GEMINI = { recognize, hasKey, setKey, getKey, compressImage };
})();
