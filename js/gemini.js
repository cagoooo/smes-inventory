// Gemini Vision API 封裝 — 透過 Supabase Edge Function 代理，API Key 保留在後端
(function() {
  const KEY_STORAGE = 'smes_gemini_api_key'; // 保留作為離線/備援用

  // ============ 辨識模型 ============
  // 預設寫在 config.js；後台「🤖 AI 模型」可以改，改完存在資料庫（app_secrets.gemini_model），
  // 登入時由 auth.js 帶進 localStorage，所有裝置都會跟著換。
  const MODEL_STORAGE = 'smes_gemini_model';
  const MODEL_NAME_RE = /^gemini-[a-z0-9.\-]{2,60}$/;
  function defaultModel() { return window.SMES_CONFIG.GEMINI_MODEL || 'gemini-3.1-flash-lite'; }
  function getModel() {
    let m = '';
    try { m = (localStorage.getItem(MODEL_STORAGE) || '').trim(); } catch (e) { /* ignore */ }
    return MODEL_NAME_RE.test(m) ? m : defaultModel();
  }

  // ============ 防「照抄範例」 ============
  // 標籤太小或太糊時，AI 偶爾會把提示詞裡的範例值當成答案填回來
  // （2026-05-06 實際發生過：真正是 314010103-000734，AI 回了範例 3020112-0001）。
  // 確定是範例的值清掉，並標記 example_echo，讓畫面提醒「靠近重拍」。
  function stripExampleEcho(p) {
    if (!p || typeof p !== 'object') return p;
    const same = (v, ex) => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase() === ex;
    let pnEcho = false;
    let echo = false;
    if (same(p.serial_number, 'ABC123456')) { p.serial_number = null; echo = true; }
    if (same(p.property_number, '3020112-0001')) { p.property_number = null; pnEcho = true; }
    // 000551 有可能是真的財產，只有其他範例值也一起出現時才當成照抄
    const modelEcho = same(p.model, 'EXPERTCENTERD500SC');
    if (same(p.property_number, '000551') && (echo || modelEcho || same(p.notes, '外觀良好'))) {
      p.property_number = null; pnEcho = true;
      if (modelEcho) p.model = null;
    }
    if (pnEcho) { p.roc_year = null; p.ad_year = null; }  // 編號是抄的，年份也不可信
    if (echo || pnEcho) p.example_echo = true;
    return p;
  }

  // ============ 等待上限 ============
  // 一次辨識（直連＋備援加起來）最多等 30 秒，網路卡住時不會一直轉圈。
  const RECOGNIZE_TIMEOUT_MS = 30000;

  function timeoutError() {
    const e = new Error(`⏳ 等了 ${Math.round(RECOGNIZE_TIMEOUT_MS / 1000)} 秒 AI 還沒回應，多半是網路不穩，請再試一次`);
    e.timeout = true;
    return e;
  }

  // 帶期限的 fetch：到期就中斷連線（連同還沒讀完的回應內容一起中斷）
  function fetchUntil(url, init, deadline) {
    if (!deadline) return fetch(url, init);
    const left = deadline - Date.now();
    if (left <= 0) return Promise.reject(timeoutError());
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), left);
    return fetch(url, { ...init, signal: ctrl.signal });
  }

  function isTimeout(err) {
    return !!err && (err.timeout === true || err.name === 'AbortError');
  }

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
  async function recognizeViaProxy(file, hintType = 'auto', deadline = 0) {
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

    const doFetch = (token) => fetchUntil(url, {
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
    }, deadline);

    let res = await doFetch(userToken);

    // 🔁 若 401，主動 refresh session 再試一次（但不強制登出）
    if (res.status === 401 && window.__SB) {
      console.warn('[gemini-proxy] 401 received, trying to refresh session...');
      try {
        const { data: { session }, error: refreshErr } = await window.__SB.auth.refreshSession();
        if (!refreshErr && session?.access_token) {
          res = await doFetch(session.access_token);
        }
      } catch (e) {
        console.warn('[auth-refresh] exception:', e);
      }
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      if (res.status === 401) {
        // ⚠️ 不自動登出！proxy 401 可能只是 Edge Function 的 verify_jwt 設定問題，不代表 session 失效。
        // 丟錯誤即可，讓上層 recognize() 知道 proxy 不可用
        throw new Error(`代理伺服器驗證失敗（可能是 Edge Function 設定問題）`);
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

    const meta = {
      source: 'gemini-proxy',
      model: data.model || 'gemini-2.5-flash',
      finishReason: data.finish_reason || 'unknown',
      elapsedMs: null,  // proxy 沒回傳,略過
      thoughtsTokens: null
    };
    console.log('[gemini] ✅ proxy 成功', meta);
    return { parsed, raw: data, compressed, meta };
  }

  // ============ 直連 Gemini API（主要方式）============
  // Key 存在 localStorage，由 auth.js 登入成功後從 app_secrets 表讀取
  async function recognizeDirect(file, hintType = 'auto', deadline = 0, modelOverride = '') {
    const key = localStorage.getItem(KEY_STORAGE) || window.SMES_CONFIG.GEMINI_API_KEY;
    if (!key) throw new Error('Gemini API Key 尚未載入，請重新整理頁面');

    const compressed = await compressImage(file);
    const b64 = await fileToBase64(compressed);
    let model = modelOverride || getModel();

    // 📝 Prompt：用「具體範例」而非「型別描述」避免 Gemini 把「整數」當字面值寫入
    const BASE_JSON = `必須輸出的 JSON 範例格式（屬性名稱要用雙引號，不要加任何註解）：

{
  "photo_type": "主機",
  "brand": "ASUS",
  "model": "ExpertCenter D500SC",
  "property_number": "000551",
  "roc_year": 113,
  "ad_year": 2024,
  "serial_number": "ABC123456",
  "is_old_device": false,
  "notes": "外觀良好",
  "confidence": 0.92
}

欄位說明：
- photo_type 必為以下之一：主機 / 筆電 / 螢幕 / 財產標籤 / 印表機 / 網通設備 / 其他
- 文字欄位（brand/model/property_number/serial_number/notes）未辨識時填 null，不要填空字串
- roc_year/ad_year 為整數（如 113 或 2024），未辨識填 null；民國+1911=西元
- is_old_device 為布林 true 或 false
- confidence 為 0.0~1.0 小數

辨識要點：財產編號格式 3020112-0001 / 000551 / 6011417-000036 / AP101 / R610-01
常見混淆：1↔7、0↔O、B↔8、5↔S、2↔Z
「取得日期」才是年份（不是「列印日期」）。Windows Product Key 不是 S/N。`;

    let focus;
    if (hintType === 'label') {
      focus = `【拍攝目標：財產標籤貼紙】請特別專注在 property_number 與 roc_year（從「取得日期」讀出）。`;
    } else if (hintType === 'device') {
      focus = `【拍攝目標：設備本體】請特別專注在 brand（logo）、model（銘牌型號）、serial_number。`;
    } else {
      focus = `台灣國小財產盤點：紅白貼紙→財產標籤；品牌機身→主機/筆電/螢幕。`;
    }
    const PROMPT = `你是台灣國小財產盤點 AI 視覺辨識助手。\n\n${focus}\n\n${BASE_JSON}`;

    // 送出一次請求。thinkingOff=true 會帶「關閉思考」的參數（2.5 系列需要，否則 JSON 會被截斷）；
    // 有些新模型不接受這個參數，會回 400，這時改成不帶參數、把輸出上限加大再送一次。
    const callOnce = (m, thinkingOff) => fetchUntil(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { text: PROMPT },
            { inline_data: { mime_type: 'image/jpeg', data: b64 } }
          ]}],
          generationConfig: Object.assign({
            responseMimeType: 'application/json',
            temperature: 0.1,
            maxOutputTokens: thinkingOff ? 2048 : 8192
          }, thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {})
        })
      }, deadline);

    let thinkingMode = 'off';
    const callModel = async (m) => {
      thinkingMode = 'off';
      let res = await callOnce(m, true);
      if (res.status === 400) {
        const t400 = await res.text().catch(() => '');
        if (/thinking/i.test(t400)) {
          console.warn(`[gemini] ${m} 不接受關閉思考的參數，改用預設思考設定重送`);
          thinkingMode = 'default';
          res = await callOnce(m, false);
        } else {
          const e400 = new Error(`Gemini API 400: ` + t400.slice(0, 200));
          e400.modelUnavailable = true;
          throw e400;
        }
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        if (res.status === 429) throw new Error('Gemini 配額不足或請求過多，請稍後再試');
        const err = new Error(`Gemini API ${res.status}: ` + t.slice(0, 200));
        if (res.status === 404 || res.status === 400) err.modelUnavailable = true;
        throw err;
      }
      return res.json();
    };

    const t0 = performance.now();
    let json;
    let fallbackFrom = null;
    try {
      json = await callModel(model);
    } catch (e) {
      // 後台選的模型失效（被下架、名稱打錯）→ 自動退回 config.js 的預設模型，不讓現場卡住
      if (e.modelUnavailable && !modelOverride && model !== defaultModel()) {
        console.warn(`[gemini] 模型 ${model} 無法使用，退回預設 ${defaultModel()}：`, e.message);
        fallbackFrom = model;
        model = defaultModel();
        json = await callModel(model);
      } else {
        throw e;
      }
    }
    const elapsedMs = Math.round(performance.now() - t0);

    // 📊 A2: 印 finishReason + usageMetadata,以後診斷 MAX_TOKENS / thinking mode 問題很方便
    const candidate = json?.candidates?.[0];
    const finishReason = candidate?.finishReason || 'unknown';
    const usage = json?.usageMetadata || {};
    const thoughtsTokens = usage.thoughtsTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const inputTokens = usage.promptTokenCount || 0;

    console.log(`[gemini] finishReason=${finishReason} elapsed=${elapsedMs}ms tokens(in/thought/out)=${inputTokens}/${thoughtsTokens}/${outputTokens}`);

    // 🚨 警示：finishReason === MAX_TOKENS 表示 budget 不夠 → 提示使用者或開發者
    if (finishReason === 'MAX_TOKENS') {
      console.warn(`[gemini] ⚠️ MAX_TOKENS 觸發！JSON 可能被截斷。thinking 吃了 ${thoughtsTokens} tokens。建議：增加 maxOutputTokens 或確認 thinkingBudget=0`);
    }
    if (finishReason === 'SAFETY') {
      console.warn(`[gemini] ⚠️ 被 SAFETY filter 擋下，safetyRatings:`, candidate?.safetyRatings);
    }

    const txt = candidate?.content?.parts?.[0]?.text;
    if (!txt) throw new Error(`Gemini 回傳空內容 (finishReason=${finishReason})`);
    const parsed = cleanAndParseJSON(txt);
    if (parsed.roc_year && !parsed.ad_year) parsed.ad_year = parsed.roc_year + 1911;
    if (parsed.ad_year && !parsed.roc_year) parsed.roc_year = parsed.ad_year - 1911;

    const meta = {
      source: 'gemini-direct',
      model,
      fallbackFrom,
      thinkingMode,
      finishReason,
      elapsedMs,
      thoughtsTokens,
      outputTokens,
      inputTokens
    };
    return { parsed, raw: json, compressed, meta };
  }

  // ============ JSON 清理工具（Gemini 偶爾回傳有 markdown / 註解 / 單引號）============
  function cleanAndParseJSON(text) {
    if (!text) throw new Error('Gemini 回傳空內容');
    let t = String(text).trim();

    // 1. 去除 markdown code fence：```json ... ``` 或 ``` ... ```
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    // 2. 取第一個 { 到最後一個 } 之間（去掉前後無關文字）
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first >= 0 && last > first) t = t.slice(first, last + 1);

    // 3. 第一次直接 parse
    try { return JSON.parse(t); } catch (e1) {
      // 4. 修復常見錯誤：註解 / 尾隨逗號 / 單引號
      let fixed = t
        .replace(/\/\/[^\n]*/g, '')                    // 行註解
        .replace(/\/\*[\s\S]*?\*\//g, '')              // 區塊註解
        .replace(/,\s*([}\]])/g, '$1')                 // 尾隨逗號
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');  // 未加引號的屬性名

      // 5. 單引號 → 雙引號（只在沒有更好解析時才用；可能破壞已含單引號的字串）
      try { return JSON.parse(fixed); } catch (e2) {
        try {
          const quoted = fixed.replace(/'/g, '"');
          return JSON.parse(quoted);
        } catch (e3) {
          console.error('[gemini-json] 原始回傳:', text);
          console.error('[gemini-json] 修復後:', fixed);
          throw new Error('Gemini 回傳的 JSON 格式異常，請重拍試試（建議用 Live 相機對好再拍）');
        }
      }
    }
  }

  // 臨時從 app_secrets 再抓一次 key（以防 auth.js loadAppSecrets 還沒跑完）
  async function fetchKeyFromDBOnDemand() {
    if (!window.__SB) return null;
    try {
      const { data: { session } } = await window.__SB.auth.getSession();
      if (!session?.access_token) return null;
      const C = window.SMES_CONFIG;
      const res = await fetchUntil(`${C.SUPABASE_URL}/rest/v1/app_secrets?key=eq.gemini_api_key&select=value`, {
        headers: {
          apikey: C.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`
        }
      }, Date.now() + 8000);
      if (!res.ok) return null;
      const rows = await res.json();
      if (rows?.[0]?.value) {
        localStorage.setItem(KEY_STORAGE, rows[0].value);
        return rows[0].value;
      }
    } catch {}
    return null;
  }

  // 判斷錯誤是否為 Gemini API 問題（503/429/quota）— 此時 fallback 到 proxy 沒意義（同一個 Gemini）
  function isGeminiServerError(err) {
    const msg = String(err?.message || '');
    return /Gemini API (5\d\d|429)|UNAVAILABLE|high demand|quota|rate.?limit|忙線|配額/i.test(msg);
  }

  // ============ 主入口：優先直連，proxy 僅在「非 Gemini 服務錯誤」時 fallback ============
  async function recognize(file, hintType = 'auto') {
    const deadline = Date.now() + RECOGNIZE_TIMEOUT_MS;
    try {
      const r = await recognizeWithin(file, hintType, deadline);
      stripExampleEcho(r && r.parsed);
      return r;
    } catch (e) {
      // 中斷連線的錯誤訊息是英文（AbortError），統一換成看得懂的說明
      throw isTimeout(e) ? timeoutError() : e;
    }
  }

  async function recognizeWithin(file, hintType, deadline) {
    let hasKey = localStorage.getItem(KEY_STORAGE) || window.SMES_CONFIG.GEMINI_API_KEY;

    // 若 localStorage 沒 key，嘗試從 DB 拿（登入者才能讀）
    if (!hasKey) {
      hasKey = await fetchKeyFromDBOnDemand();
    }

    // 若有 key → 優先直連（避開 Edge Function verify_jwt 陷阱）
    if (hasKey) {
      try {
        return await recognizeDirect(file, hintType, deadline);
      } catch (e) {
        // ⏳ 已經等到上限 → 不再換備援通道重等一輪
        if (isTimeout(e)) throw e;
        // 🚦 503/429/quota 是 Gemini 本身的問題，proxy 也是打同一個 Gemini → fallback 沒用
        if (isGeminiServerError(e)) {
          console.warn('[gemini-direct] Gemini 服務錯誤，不 fallback:', e.message);
          // 對使用者顯示友善訊息
          if (/503|UNAVAILABLE|high demand/i.test(e.message)) {
            throw new Error('🔥 Gemini AI 暫時忙線（伺服器繁忙），請等 30 秒後再試一次');
          }
          if (/429|quota|rate/i.test(e.message)) {
            throw new Error('⏱ Gemini API 呼叫太頻繁，請等 1 分鐘後再試');
          }
          throw e;
        }
        // 其他錯誤（如 JSON 解析失敗、網路問題）→ 試 proxy
        console.warn('[gemini-direct] 失敗，嘗試 proxy fallback:', e.message);
        try {
          return await recognizeViaProxy(file, hintType, deadline);
        } catch (e2) {
          if (isTimeout(e2)) throw e2;
          throw e;  // 回傳最初的 direct 錯誤（較有用）
        }
      }
    }
    // 沒 key（未登入或 RLS 阻擋）→ 用 proxy
    return await recognizeViaProxy(file, hintType, deadline);
  }

  // 後台試拍用：指定模型辨識一次（只走直連，不退回預設、不走備援，才能看到該模型真正的表現）
  async function recognizeWith(file, hintType, model, timeoutMs = 60000) {
    try {
      const r = await recognizeDirect(file, hintType || 'auto', Date.now() + timeoutMs, model);
      stripExampleEcho(r.parsed);
      return r;
    } catch (e) {
      if (isTimeout(e)) { const te = new Error(`等了 ${Math.round(timeoutMs / 1000)} 秒沒有回應`); te.timeout = true; throw te; }
      throw e;
    }
  }

  // 後台用：列出這把金鑰可以用來看圖的 Gemini 模型
  async function listModels() {
    const key = localStorage.getItem(KEY_STORAGE) || window.SMES_CONFIG.GEMINI_API_KEY || await fetchKeyFromDBOnDemand();
    if (!key) throw new Error('Gemini API Key 尚未載入，請重新整理頁面');
    const res = await fetchUntil(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, {}, Date.now() + 15000);
    if (!res.ok) throw new Error(`讀取模型清單失敗（${res.status}）`);
    const j = await res.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ name: String(m.name || '').replace('models/', ''), displayName: m.displayName || '' }))
      .filter((m) => MODEL_NAME_RE.test(m.name) && /flash|pro/.test(m.name)
        && !/tts|audio|image|embedding|live|computer|robotics|customtools/.test(m.name));
  }

  function hasKey() {
    // 永遠 true — 因為後端代理已有 Key
    return true;
  }
  function setKey(k) { localStorage.setItem(KEY_STORAGE, k.trim()); }
  function getKey() { return localStorage.getItem(KEY_STORAGE) || ''; }

  window.SMES_GEMINI = { recognize, recognizeWith, listModels, getModel, defaultModel, MODEL_STORAGE, hasKey, setKey, getKey, compressImage, RECOGNIZE_TIMEOUT_MS };
})();
