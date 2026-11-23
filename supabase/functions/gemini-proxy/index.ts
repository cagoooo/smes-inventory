import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// 石門國小盤點系統 — Gemini 視覺辨識代理（備援路徑）
// 2026-11-23 權限加固：必須是「允許名單」上的登入帳號才能使用，
// 未登入或名單外的請求在呼叫 Gemini 之前就會被擋下（避免被盜刷）。
// gemini-proxy 與 gemini-public 兩個函式部署同一份程式。

const ALLOWED_ORIGINS = [
  "https://cagoooo.github.io",
  "http://localhost:8000",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:8000",
];

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";

// ============ Rate Limit ============
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP = 20;
const RATE_LIMIT_PER_ORIGIN = 60;
const rateBucket = new Map<string, number[]>();

function checkRate(key: string, max: number): { ok: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const arr = (rateBucket.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= max) {
    return { ok: false, remaining: 0, resetIn: RATE_LIMIT_WINDOW_MS - (now - arr[0]) };
  }
  arr.push(now);
  rateBucket.set(key, arr);
  if (rateBucket.size > 1000) {
    for (const [k, v] of rateBucket) {
      if (!v.some((t) => now - t < RATE_LIMIT_WINDOW_MS)) rateBucket.delete(k);
    }
  }
  return { ok: true, remaining: max - arr.length, resetIn: 0 };
}

// ============ 允許名單驗證 ============
// 用呼叫者自己的登入憑證去問資料庫 is_allowed_user()，名單只維護在資料庫一處
async function isAllowedUser(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!SUPABASE_URL || !apikey || !/^bearer\s+\S+/i.test(auth)) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_allowed_user`, {
      method: "POST",
      headers: { apikey, authorization: auth, "content-type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch {
    return false;
  }
}

const BASE_JSON = `輸出純 JSON，不要包 markdown 不要加說明文字：
{
  "photo_type": "主機|筆電|螢幕|財產標籤|印表機|網通設備|其他",
  "brand": "廠牌（如 ASUS、HP、Acer、Apple、Lenovo、Dell、Microsoft、BenQ、EPSON 等），無則 null",
  "model": "具體型號",
  "property_number": "財產編號（如 3020112-0001 或 000551）",
  "roc_year": 民國年整數,
  "ad_year": 西元年整數,
  "serial_number": "序號 S/N",
  "is_old_device": true/false,
  "notes": "其他有用資訊",
  "confidence": 0~1
}`;

const COMMON_NOTES = `注意：
- 民國年 = 西元年 - 1911
- 財產標籤數字常見混淆：1↔7、0↔O、B↔8、5↔S、2↔Z
- 台灣國小財產編號格式：3020112-0001 或 000551
- 「取得日期」才是年份，非「列印日期」
- Windows Product Key 不是設備 S/N
- 無法判斷填 null`;

const LABEL_FOCUS = `【拍攝目標：財產標籤】
專注：property_number / roc_year / item_name → notes`;

const DEVICE_FOCUS = `【拍攝目標：設備本體】
專注：brand / model / serial_number`;

const AUTO_PROMPT = `你是台灣國小財產盤點 AI：
- 若見紅白貼紙 → photo_type = 財產標籤
- 若見品牌機身 → photo_type = 主機/筆電/螢幕`;

function buildPrompt(hintType: string): string {
  let focus = AUTO_PROMPT;
  if (hintType === "label") focus = LABEL_FOCUS;
  else if (hintType === "device") focus = DEVICE_FOCUS;
  return `你是台灣國小財產盤點 AI 視覺辨識助手。\n\n${focus}\n\n${BASE_JSON}\n\n${COMMON_NOTES}`;
}

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data: unknown, init: ResponseInit = {}, origin = "") {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...corsHeaders(origin),
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(origin) });
  }
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: `Origin not allowed: ${origin || "<empty>"}` }, { status: 403 }, origin);
  }
  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 }, origin);
  }

  const ipCheck = checkRate(`ip:${ip}`, RATE_LIMIT_PER_IP);
  if (!ipCheck.ok) {
    return json(
      { error: `請稍後再試 (每分鐘最多 ${RATE_LIMIT_PER_IP} 次)`, retry_after_ms: ipCheck.resetIn },
      { status: 429, headers: { "Retry-After": Math.ceil(ipCheck.resetIn / 1000).toString() } },
      origin,
    );
  }
  const originCheck = checkRate(`origin:${origin}`, RATE_LIMIT_PER_ORIGIN);
  if (!originCheck.ok) {
    return json({ error: `全校產量過高，請稍後再試`, retry_after_ms: originCheck.resetIn }, { status: 429 }, origin);
  }

  // 🔐 只認允許名單上的登入帳號（Origin 標頭可以偽造，不能當成驗證）
  if (!(await isAllowedUser(req))) {
    return json({ error: "未登入或此帳號不在允許名單" }, { status: 401 }, origin);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json({ error: "GEMINI_API_KEY not configured" }, { status: 500 }, origin);
  }

  let body: { image_base64?: string; mime_type?: string; hint_type?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 }, origin);
  }

  const image = body.image_base64;
  const mime = body.mime_type || "image/jpeg";
  const hintType = body.hint_type || "auto";

  if (!image) {
    return json({ error: "Missing field: image_base64" }, { status: 400 }, origin);
  }
  if (image.length > 8 * 1024 * 1024) {
    return json({ error: "Image too large (>8MB base64)" }, { status: 413 }, origin);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const geminiBody = {
    contents: [{
      role: "user",
      parts: [
        { text: buildPrompt(hintType) },
        { inline_data: { mime_type: mime, data: image } },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
    const data = await res.json();

    if (!res.ok) {
      return json({ error: `Gemini API ${res.status}`, detail: data }, { status: 502 }, origin);
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
    }

    return json(
      { parsed, text_raw: text, model: GEMINI_MODEL, hint_used: hintType, rate_remaining: ipCheck.remaining },
      { headers: { "X-RateLimit-Remaining": ipCheck.remaining.toString() } },
      origin,
    );
  } catch (e) {
    return json({ error: `Fetch failed: ${String(e)}` }, { status: 500 }, origin);
  }
});
