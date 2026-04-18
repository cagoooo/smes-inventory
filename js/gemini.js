// Gemini Vision API 封裝 — 針對台灣國小財產盤點優化
(function() {
  const KEY_STORAGE = 'smes_gemini_api_key';

  function getKey() {
    return window.SMES_CONFIG.GEMINI_API_KEY || localStorage.getItem(KEY_STORAGE) || '';
  }
  function setKey(k) {
    localStorage.setItem(KEY_STORAGE, k.trim());
  }
  function hasKey() { return !!getKey(); }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const b64 = String(r.result).split(',')[1];
        resolve(b64);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // 照片壓縮為 JPEG，最大邊 1600px 加速上傳與減少 Gemini Token 用量
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

  const PROMPT = `你是一位專精於台灣國小財產盤點的 AI 視覺辨識助手。

請仔細分析這張照片，可能是以下任一種：
- 電腦主機（桌機機殼、一體機、筆電、伺服器、NAS）
- 螢幕（液晶螢幕、投影機、電視、互動式觸控板）
- 財產標籤貼紙（通常為紅色或白色，印有「財產編號」「品名」「取得日期」等欄位）
- 其他資訊設備（印表機、交換器、AP、音響等）

**輸出格式：JSON**（僅輸出 JSON，不要多餘文字或 markdown 包裝）

{
  "photo_type": "主機" | "筆電" | "螢幕" | "財產標籤" | "印表機" | "網通設備" | "其他",
  "brand": "廠牌（如 ASUS、HP、Acer、Apple、Lenovo、Dell、Microsoft、BenQ、EPSON 等），若無則 null",
  "model": "具體型號（越精確越好，例如 ASUS ExpertCenter D500SC、HP ProDesk 400 G6），若僅能辨識部份也請盡量填入",
  "property_number": "財產編號（貼紙上通常以 3020xxx-xxxx 或 10xxxx-xxx 格式出現；若非標籤照片無法辨識請填 null）",
  "roc_year": 民國年整數（從財產標籤「取得日期」或機身製造年份推論，如 112、113、114；無法判斷則 null）,
  "ad_year": 西元年整數（如 2023、2024、2025；民國年+1911=西元年）,
  "serial_number": "序號 S/N（若可見）",
  "is_old_device": true/false（依外觀判斷是否為超過 8 年的舊機器，目前為 2026 年即民國 115 年）,
  "notes": "其他有用資訊如規格、容量、作業系統、特殊狀況等",
  "confidence": 0~1 的整體辨識信心度
}

**注意事項：**
- 財產標籤上的數字請仔細辨識，1/7、0/O、B/8 常易混淆
- 台灣國小財產編號常見格式：3020112-0001（七位分類碼 + 流水號）
- 民國年 = 西元年 - 1911（例：2025 年 = 民國 114 年）
- 若欄位無法確定請填 null，不要猜測
- 若同時看到多個財產，請回傳視覺最主要的那個`;

  async function recognize(file) {
    const key = getKey();
    if (!key) throw new Error('尚未設定 Gemini API Key');

    const compressed = await compressImage(file);
    const b64 = await fileToBase64(compressed);
    const model = window.SMES_CONFIG.GEMINI_MODEL;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: 'image/jpeg', data: b64 } }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 1024
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini API 錯誤 ${res.status}: ${err.slice(0, 300)}`);
    }

    const json = await res.json();
    const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error('Gemini 回傳內容為空');

    try {
      const parsed = JSON.parse(txt);
      // 民國/西元互補
      if (parsed.roc_year && !parsed.ad_year) parsed.ad_year = parsed.roc_year + 1911;
      if (parsed.ad_year && !parsed.roc_year) parsed.roc_year = parsed.ad_year - 1911;
      return { parsed, raw: json, compressed };
    } catch (e) {
      throw new Error('Gemini 回傳 JSON 解析失敗: ' + txt.slice(0, 200));
    }
  }

  window.SMES_GEMINI = { recognize, hasKey, setKey, getKey, compressImage };
})();
