// 後台「🤖 AI 模型」：切換拍照辨識用的 Gemini 模型，並可先用一張照片試拍比較
// 設定存在資料庫 app_secrets.gemini_model（透過 set_gemini_model，只有允許名單帳號能改），
// 各裝置登入時由 auth.js 帶進 localStorage，gemini.js 讀它決定用哪個模型。
(function () {
  const $ = (id) => document.getElementById(id);
  const G = () => window.SMES_GEMINI;
  const C = window.SMES_CONFIG;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let models = [];
  let loaded = false;
  let busy = false;

  // 給人看的說明（只描述名稱透露的事，不寫沒查證的價格或分數）
  function describe(name) {
    const tags = [];
    if (/-pro/.test(name)) tags.push('Pro：通常較準、較慢、較貴');
    else if (/flash-lite/.test(name)) tags.push('Flash-Lite：通常最快、最省');
    else if (/flash/.test(name)) tags.push('Flash：速度與準確度平衡');
    if (/preview/.test(name)) tags.push('預覽版，可能隨時下架');
    if (/latest/.test(name)) tags.push('會自動跟著 Google 換到最新版');
    return tags.join('・');
  }

  function verKey(name) {
    const m = name.match(/gemini-(\d+)(?:\.(\d+))?/);
    return m ? Number(m[1]) * 100 + Number(m[2] || 0) : 0;
  }

  function setStatus(html, kind) {
    const el = $('msStatus');
    if (!el) return;
    el.className = 'ms-status' + (kind ? ' ' + kind : '');
    el.innerHTML = html || '';
  }

  function renderCurrent() {
    const cur = G().getModel();
    const def = G().defaultModel();
    $('msCurrent').innerHTML = `<div class="ms-current-label">目前使用</div>
      <div class="ms-current-name">${esc(cur)}</div>
      <div class="ms-current-note">${cur === def ? '這是系統預設的模型' : `後台選定（預設是 ${esc(def)}）`}</div>`;
  }

  function renderSelect() {
    const cur = G().getModel();
    const def = G().defaultModel();
    const names = models.map((m) => m.name);
    [cur, def].forEach((n) => { if (!names.includes(n)) names.push(n); });
    names.sort((a, b) => verKey(b) - verKey(a) || a.localeCompare(b));
    const prev = $('msSelect').value;
    $('msSelect').innerHTML = names.map((n) => {
      const marks = [n === cur ? '目前使用' : '', n === def ? '預設' : ''].filter(Boolean).join('、');
      return `<option value="${esc(n)}">${esc(n)}${marks ? `（${marks}）` : ''}</option>`;
    }).join('');
    $('msSelect').value = names.includes(prev) ? prev : cur;
    renderPicked();
  }

  function renderPicked() {
    const n = $('msSelect').value;
    $('msPicked').textContent = describe(n) || '';
    const same = n === G().getModel();
    $('msSave').disabled = same || busy;
    $('msSave').textContent = same ? '✓ 目前就是這個模型' : `💾 儲存，改用 ${n}`;
    $('msReset').disabled = busy || G().getModel() === G().defaultModel();
  }

  async function loadModels(manual) {
    setStatus('<span class="spin"></span> 讀取可用的模型清單…');
    try {
      models = await G().listModels();
      setStatus(manual ? `✅ 已更新，這把金鑰目前可以用 ${models.length} 個看圖模型` : '');
    } catch (e) {
      models = [];
      setStatus(`⚠️ ${esc(e.message)}。先列出目前的與預設的模型，稍後可按「重新讀取清單」。`, 'warn');
    }
    renderCurrent();
    renderSelect();
  }

  async function saveModel(name) {
    if (busy) return;
    busy = true; renderPicked();
    setStatus('<span class="spin"></span> 儲存中…');
    try {
      const token = await window.SMES_AUTH.getFreshAccessToken();
      if (!token) throw new Error('登入已過期，請重新整理頁面');
      const res = await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/set_gemini_model`, {
        method: 'POST',
        headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_model: name })
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        let msg = t;
        try { msg = JSON.parse(t).message || t; } catch (e) { /* 不是 JSON 就原樣顯示 */ }
        throw new Error(msg.slice(0, 160) || `儲存失敗（${res.status}）`);
      }
      localStorage.setItem(G().MODEL_STORAGE, name);
      setStatus(`✅ 已改用 <b>${esc(name)}</b>。這台裝置馬上生效；手機或其他電腦<b>重新整理網頁</b>後生效。`, 'ok');
    } catch (e) {
      setStatus(`⚠️ 儲存失敗：${esc(e.message)}`, 'err');
    } finally {
      busy = false;
      renderCurrent();
      renderSelect();
    }
  }

  // ---------- 試拍比較 ----------
  const FIELDS = [
    ['photo_type', '類型'], ['brand', '廠牌'], ['model', '型號'],
    ['property_number', '財產編號'], ['roc_year', '年份（民國）'], ['serial_number', '序號'],
  ];

  async function runOne(file, hint, name) {
    const t0 = performance.now();
    try {
      const r = await G().recognizeWith(file, hint, name, 60000);
      // 只算模型回應的時間（不含手機壓縮照片的時間），兩個模型比起來才公平
      const sec = r.meta && r.meta.elapsedMs ? r.meta.elapsedMs / 1000 : (performance.now() - t0) / 1000;
      return { name, ok: true, sec, parsed: r.parsed || {}, meta: r.meta || {} };
    } catch (e) {
      return { name, ok: false, sec: (performance.now() - t0) / 1000, error: e.message || String(e) };
    }
  }

  function renderCompare(results) {
    const head = results.map((r) => `<th>${esc(r.name)}${r.name === G().getModel() ? '<small>目前使用</small>' : ''}</th>`).join('');
    const timeRow = results.map((r) => `<td>${r.ok ? `<b>${r.sec.toFixed(1)}</b> 秒` : `<span class="ms-bad">失敗（${r.sec.toFixed(1)} 秒）</span>`}</td>`).join('');
    const okOnes = results.filter((r) => r.ok);
    const rows = FIELDS.map(([k, label]) => {
      const vals = okOnes.map((r) => String(r.parsed[k] == null ? '' : r.parsed[k]));
      const differ = okOnes.length > 1 && new Set(vals).size > 1;
      const tds = results.map((r) => {
        if (!r.ok) return '<td class="ms-muted">—</td>';
        const v = r.parsed[k];
        return `<td class="${differ ? 'ms-diff' : ''}">${v == null || v === '' ? '<span class="ms-muted">沒讀到</span>' : esc(v)}</td>`;
      }).join('');
      return `<tr><th>${esc(label)}</th>${tds}</tr>`;
    }).join('');
    const notes = results.map((r) => {
      if (!r.ok) return `<li><b>${esc(r.name)}</b>：${esc(r.error)}</li>`;
      const bits = [];
      if (r.parsed.example_echo) bits.push('標籤太小或太糊，AI 沒讀到（已擋下它照抄範例的編號）');
      if (r.meta.thinkingMode === 'default') bits.push('這個模型不能關閉「思考」，所以會比較慢');
      return bits.length ? `<li><b>${esc(r.name)}</b>：${esc(bits.join('；'))}</li>` : '';
    }).join('');
    $('msResult').innerHTML = `<div class="ms-table-wrap"><table class="ms-table">
        <thead><tr><th></th>${head}</tr></thead>
        <tbody><tr><th>花費時間</th>${timeRow}</tr>${rows}</tbody>
      </table></div>
      ${notes ? `<ul class="ms-notes">${notes}</ul>` : ''}
      <p class="ms-hint">黃底代表兩個模型讀到的內容不一樣，請對照實際標籤看哪一個才對。試拍不會改設定，也不會寫入盤點資料。</p>`;
  }

  async function runTest() {
    const file = $('msFile').files && $('msFile').files[0];
    if (!file) { $('msResult').innerHTML = '<p class="ms-hint">請先選一張照片。</p>'; return; }
    const picked = $('msSelect').value;
    const names = [...new Set([G().getModel(), picked])];
    const hint = $('msHint').value;
    $('msTest').disabled = true;
    $('msResult').innerHTML = `<p class="ms-hint"><span class="spin"></span> 辨識中（${names.length === 1 ? '只選了目前的模型，所以只跑一次' : '兩個模型同時跑'}，最多等 60 秒）…</p>`;
    try {
      const results = await Promise.all(names.map((n) => runOne(file, hint, n)));
      renderCompare(results);
      $('msResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } finally {
      $('msTest').disabled = false;
    }
  }

  function bind() {
    if (!$('tab-aimodel') || !G()) return;
    $('msSelect').addEventListener('change', renderPicked);
    $('msSave').addEventListener('click', () => saveModel($('msSelect').value));
    $('msReset').addEventListener('click', () => {
      if (confirm(`要改回預設模型 ${G().defaultModel()} 嗎？`)) saveModel(G().defaultModel());
    });
    $('msReload').addEventListener('click', () => loadModels(true));
    $('msTest').addEventListener('click', runTest);
    $('msFile').addEventListener('change', () => {
      const f = $('msFile').files && $('msFile').files[0];
      const img = $('msPreview');
      if (f) { img.src = URL.createObjectURL(f); img.hidden = false; } else { img.hidden = true; }
      $('msResult').innerHTML = '';
    });
    document.querySelectorAll('#tabBar button[data-tab="aimodel"]').forEach((b) => {
      b.addEventListener('click', () => {
        renderCurrent();
        if (!loaded) { loaded = true; loadModels(false); } else { renderSelect(); }
      });
    });
    renderCurrent();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
