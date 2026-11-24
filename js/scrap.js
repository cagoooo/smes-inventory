// 電腦財產報廢點收 — 拍照 → AI 辨識 → 比對財產清冊 → 寫入 GAS 報廢試算表
(function () {
  const C = window.SMES_CONFIG;
  const $ = (id) => document.getElementById(id);
  const ROC_NOW = new Date().getFullYear() - 1911;
  const SCHOOL_YEAR = new Date().getMonth() >= 7 ? ROC_NOW : ROC_NOW - 1;
  const LS_BATCH = 'smes_scrap_batch';
  const LS_LOC = 'smes_scrap_location';
  const LS_AUTO = 'smes_scrap_auto_add';
  const SHOW_FIRST = 5;
  const ADD_TIMEOUT_MS = 25000;

  const state = {
    inventory: [],
    byId: new Map(),
    items: [],          // 目前批次的報廢清單（來自試算表）
    batches: {},
    sheetUrl: '',
    part: '主機',
    shot: null,         // 目前這張照片
    lastCandidates: [],
    showAll: false,
    pending: [],        // 網路不穩時先存在手機、等待補送的項目（IndexedDB）
    flushing: false,
  };

  // ================= 小工具 =================
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const money = (n) => (n === '' || n == null || isNaN(Number(n))) ? '' : 'NT$' + Number(n).toLocaleString('zh-TW');

  let toastTimer = null;
  function toast(msg, action) {
    const t = $('toast');
    t.innerHTML = esc(msg) + (action ? ` <button type="button" class="toast-action">${esc(action.label)}</button>` : '');
    t.classList.add('show');
    if (action) t.querySelector('.toast-action').onclick = () => { t.classList.remove('show'); action.fn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2600);
  }

  // ================= GAS 後端 =================
  function netError(msg) { const e = new Error(msg); e.network = true; return e; }

  async function gas(action, payload = {}, timeoutMs = 0) {
    if (!C.SCRAP_GAS_URL) throw new Error('尚未設定報廢試算表網址');
    if (navigator.onLine === false) throw netError('目前沒有網路');
    const token = await SMES_AUTH.getFreshAccessToken();
    let res, text;
    const ctrl = timeoutMs ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      // 不設 Content-Type → text/plain，避免 CORS 預檢
      res = await fetch(C.SCRAP_GAS_URL, { method: 'POST', body: JSON.stringify({ action, token, ...payload }), signal: ctrl?.signal });
      text = await res.text();
    } catch (e) {
      throw netError(e.name === 'AbortError' ? '網路太慢，等不到試算表回應' : '連不到報廢試算表（網路不穩或中斷）');
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data;
    try { data = JSON.parse(text); } catch (e) {
      throw new Error('報廢試算表後端尚未啟用，請擁有者在 Apps Script 編輯器執行一次 setup 並按允許');
    }
    if (!data.ok) throw new Error(data.error || '報廢試算表回應錯誤');
    return data;
  }

  // ================= 網路不穩時的手機暫存（IndexedDB）=================
  // 就算關掉網頁或手機沒電，存進來的項目也還在，下次打開會自動補送
  const QDB = { name: 'smes-scrap-queue', store: 'q' };
  function qOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(QDB.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(QDB.store, { keyPath: 'qid' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function qTx(mode, fn) {
    const db = await qOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QDB.store, mode);
      const out = fn(tx.objectStore(QDB.store));
      tx.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : undefined); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  const qAll = () => qTx('readonly', (s) => s.getAll());
  const qPut = (rec) => qTx('readwrite', (s) => s.put(rec));
  const qDel = (qid) => qTx('readwrite', (s) => s.delete(qid));

  async function reloadPending() {
    try {
      const rows = (await qAll()) || [];
      state.pending = rows.sort((a, b) => a.qid - b.qid);
    } catch (e) {
      console.warn('[scrap] 讀取暫存失敗', e);
      state.pending = [];
    }
  }

  function pendingAsItem(q) {
    const it = q.payload.item || {};
    return {
      ...it, id: 'q:' + q.qid, batch: q.payload.batch, parts: q.payload.part, method: q.payload.method,
      score: q.payload.score, addedAt: q.createdAt, pending: true, note: '',
    };
  }

  async function flushQueue(manual) {
    if (state.flushing || !state.pending.length) return;
    if (navigator.onLine === false) { if (manual) toast('目前沒有網路，連上後會自動補送'); return; }
    state.flushing = true;
    let sent = 0, stopMsg = '';
    try {
      for (const q of [...state.pending]) {
        try {
          const data = await gas('add', q.payload, ADD_TIMEOUT_MS);
          await qDel(q.qid);
          state.pending = state.pending.filter((p) => p.qid !== q.qid);
          if (q.payload.batch === currentBatch()) {
            const idx = state.items.findIndex((i) => i.id === data.item.id);
            if (idx >= 0) state.items[idx] = data.item; else state.items.push(data.item);
          }
          sent++;
        } catch (e) {
          stopMsg = e.message;
          if (e.network) break;           // 還是沒網路 → 下次再試
          q.error = e.message;            // 其他錯誤（例如登入過期）→ 留在手機、標示原因，繼續送下一筆
          await qPut(q).catch(() => {});
        }
      }
    } finally {
      state.flushing = false;
      renderList(); rerenderCandidates(); setStatus();
      if (sent) syncInventoryStatus();
    }
    if (sent) toast(`📤 已補送 ${sent} 筆到試算表${state.pending.length ? `，還有 ${state.pending.length} 筆等待中` : ''}`);
    else if (manual && stopMsg) toast('補送失敗：' + stopMsg);
  }

  // ================= 比對引擎 =================
  const BRANDS = {
    ASUS: ['ASUS', '華碩'], ACER: ['ACER', '宏碁', '宏基'], LENOVO: ['LENOVO', 'LENVO', '聯想', 'THINKCENTRE'],
    HP: ['HEWLETT', '惠普'], DELL: ['DELL', '戴爾'], VIEWSONIC: ['VIEWSONIC', '優派'], PHILIPS: ['PHILIPS', '飛利浦'],
    BENQ: ['BENQ', '明基'], AOC: ['AOC'], SAMSUNG: ['SAMSUNG', '三星'], MSI: ['MSI', '微星'], GIGABYTE: ['GIGABYTE', '技嘉'],
  };
  function brandsIn(text) {
    const up = String(text || '').toUpperCase();
    const out = new Set();
    for (const [k, names] of Object.entries(BRANDS)) if (names.some((n) => up.includes(n))) out.add(k);
    if (/(^|[^A-Z])HP([^A-Z]|$)/.test(up)) out.add('HP');
    return out;
  }

  function modelTokens(s) {
    const parts = String(s || '').toUpperCase().split(/[^0-9A-Z]+/).filter(Boolean);
    const out = new Set();
    const add = (t) => {
      if (t.length < 3 || !/\d/.test(t)) return;
      const digitsOnly = /^\d+$/.test(t);
      if (digitsOnly && (t.length < 4 || (+t >= 1990 && +t <= 2035))) return;
      out.add(t);
    };
    parts.forEach((p, i) => { add(p); if (parts[i + 1]) add(p + parts[i + 1]); });
    return [...out];
  }

  function prepareRecord(r) {
    const text = `${r.model || ''} ${r.specification || ''}`;
    r._text = norm(text);
    r._tokens = modelTokens(text);
    r._brands = brandsIn(`${r.brand || ''} ${text}`);
    r._pn = norm(r.property_number);
    r._sn = norm(r.serial_number);
    r._group = norm(r.model) + '|' + (r.acquired_year || '');
    r._loc = r.location_text || r.classroom_code || '';
    r._search = `${r.property_number} ${r.model} ${r.specification} ${r.location_text} ${r.classroom_code}`.toUpperCase();
  }

  function pnMatch(aiPN, rec) {
    const raw = String(aiPN || '');
    if (!raw || !rec._pn) return null;
    if (norm(raw) === rec._pn) return 'exact';
    const groups = raw.match(/\d+/g) || [];
    if (!/^\d+$/.test(rec._pn)) return null;
    const target = rec._pn.padStart(6, '0');
    // 標籤常寫成「3140101-03-000812」，最後一段才是財產序號
    const last = groups[groups.length - 1] || '';
    if (last.length >= 3 && last.length <= 6 && last.padStart(6, '0') === target) return 'exact';
    if (groups.some((g) => g.length >= 5 && g.length <= 6 && g.padStart(6, '0') === target)) return 'exact';
    // 條碼常把整串編號連在一起（例：314010103000734），最後 6 碼才是財產序號
    const compact = raw.replace(/[\s\-_.\/]/g, '');
    if (/^\d{12,18}$/.test(compact) && compact.endsWith(target)) return 'exact';
    if (last.length >= 4 && last.length <= 6 && window._generatePNVariants) {
      if (window._generatePNVariants(last.padStart(6, '0')).includes(target)) return 'fuzzy';
    }
    // AI 把數字看成字母（0→O、1→I、8→B、5→S、2→Z），換回數字後再比一次
    const tail = (raw.toUpperCase().match(/[0-9A-Z]+/g) || []).pop() || '';
    const fixed = tail.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2');
    if (fixed !== tail && /^\d{3,6}$/.test(fixed) && fixed.padStart(6, '0') === target) return 'fuzzy';
    return null;
  }

  // 編號完全相符時再多看一眼：標籤上一起讀到的廠牌／型號／年份，跟清冊這一筆兜不兜得起來。
  // AI 看不清楚時可能猜一個號碼，而清冊的號碼很密集，猜錯也常常剛好是另一台真的電腦；
  // 兜不起來就不自動加入，交給老師核對。（同一批採購的隔壁號碼型號年份都一樣，這裡擋不住。）
  function shareChunk(a, b, n) {
    // 一樣的那一段要含數字才算（不然光是「ACER」「ASUS」四個字母相同，會把不同型號當成一樣）
    for (let i = 0; i + n <= a.length; i++) {
      const chunk = a.slice(i, i + n);
      if (/\d/.test(chunk) && b.includes(chunk)) return true;
    }
    return false;
  }
  function pnConflicts(rec, ai) {
    const out = [];
    if (!ai) return out;
    // 拍的是螢幕時，廠牌型號是螢幕的，清冊那一筆記的是主機，不拿來比（只比年份）
    const monitorShot = state.part === '螢幕' || ai.photo_type === '螢幕';
    const aiBrands = monitorShot ? new Set() : brandsIn(ai.brand);
    if (aiBrands.size && rec._brands.size && ![...aiBrands].some((b) => rec._brands.has(b))) {
      out.push(`廠牌（照片讀到 ${ai.brand}，清冊是 ${rec.brand || [...rec._brands].join('／')}）`);
    }
    const aiModel = monitorShot ? '' : String(ai.model || '');
    const aiTokens = modelTokens(aiModel).filter((t) => t.length >= 4);
    if (aiTokens.length && rec._tokens.length) {
      // 容許 AI 把型號看錯一兩個字：只要有連續 4 個字一樣就算同一型號
      const hit = aiTokens.some((t) => shareChunk(t, rec._text, 4));
      if (!hit) out.push(`型號（照片讀到 ${aiModel}，清冊是 ${rec.model || rec.item_name || ''}）`);
    }
    const y = Number(ai.roc_year);
    if (y && rec.acquired_year && Math.abs(y - rec.acquired_year) >= 2) {
      out.push(`年份（照片讀到民國 ${y}，清冊是民國 ${rec.acquired_year}）`);
    }
    return out;
  }

  function scoreRecord(rec, ai, loc) {
    const reasons = [];
    const pn = pnMatch(ai.property_number, rec);
    const aiSN = norm(ai.serial_number);
    if (pn === 'exact') return { score: 100, method: '財產編號', reasons: ['財產編號完全相同'], conflicts: pnConflicts(rec, ai) };
    if (aiSN.length >= 5 && rec._sn && aiSN === rec._sn) return { score: 100, method: '序號', reasons: ['序號完全相同'] };

    let modelPts = 0, extra = 0;
    const aiModelText = `${ai.model || ''} ${ai.notes || ''}`;
    const aiTokens = modelTokens(aiModelText);
    const aiNorm = norm(aiModelText);
    let best = 0;
    aiTokens.forEach((t) => { if (rec._text.includes(t)) best = Math.max(best, t.length); });
    rec._tokens.forEach((t) => { if (aiNorm.includes(t)) best = Math.max(best, t.length); });
    if (best >= 5) modelPts = 55; else if (best === 4) modelPts = 48; else if (best === 3) modelPts = 35;
    if (modelPts) reasons.push('型號相符');

    const aiBrands = brandsIn(ai.brand);
    if (aiBrands.size && rec._brands.size) {
      if ([...aiBrands].some((b) => rec._brands.has(b))) { extra += 15; reasons.push('廠牌相符'); }
      else extra -= 20;
    }
    const y = Number(ai.roc_year);
    if (y && rec.acquired_year) {
      const d = Math.abs(y - rec.acquired_year);
      if (d === 0) { extra += 12; reasons.push('年份相同'); }
      else if (d === 1) { extra += 5; reasons.push('年份差一年'); }
    }
    if (loc && rec._loc === loc) { extra += 10; reasons.push('地點相符'); }

    if (pn === 'fuzzy') {
      return { score: Math.min(95, 82 + Math.max(0, Math.round((modelPts + extra) / 10))), method: '財產編號相近', reasons: ['財產編號只差一個易看錯的字', ...reasons] };
    }
    if (modelPts) return { score: Math.max(0, Math.min(89, modelPts + extra)), method: '型號比對', reasons };
    return { score: Math.max(0, Math.min(40, extra)), method: '廠牌年份', reasons };
  }

  function findCandidates(ai) {
    const loc = $('locationSelect').value;
    const inList = listPNSet();
    const list = state.inventory.map((rec) => ({ rec, ...scoreRecord(rec, ai, loc) }))
      .filter((c) => c.score >= 30)
      .sort((a, b) => b.score - a.score
        || (inList.has(a.rec.property_number) - inList.has(b.rec.property_number))
        || String(a.rec.property_number).localeCompare(String(b.rec.property_number)));
    return list.slice(0, 60);
  }

  // 整批採購的同款電腦長得一模一樣、通常也沒有各自的財產標籤，報廢時挑哪一台都可以。
  // 只要照片讀到廠牌或型號（再加上年份更準），就把清冊裡兜得起來的「那一批」列出來，
  // 讓老師按一下就加入其中一台還沒加入的，不用卡在「找不到相近的設備」。
  function batchGroups(ai, cands) {
    if (!ai || !state.inventory) return [];
    const top = cands && cands[0];
    if (top && (top.score >= 100 || top.method === '財產編號相近')) return [];
    const aiBrands = brandsIn(ai.brand);
    const aiTokens = modelTokens(String(ai.model || '')).filter((t) => t.length >= 4);
    if (!aiBrands.size && !aiTokens.length) return [];
    let pool = state.inventory;
    if (aiBrands.size) pool = pool.filter((r) => [...aiBrands].some((b) => r._brands.has(b)));
    if (aiTokens.length) {
      const byModel = pool.filter((r) => aiTokens.some((t) => shareChunk(t, r._text, 4)));
      if (byModel.length) pool = byModel;       // 型號對得到就只留那一批
      else if (!aiBrands.size) return [];        // 型號對不到、也沒讀到廠牌 → 不猜
    }
    const y = Number(ai.roc_year);
    if (y) {
      const exact = pool.filter((r) => r.acquired_year === y);
      pool = exact.length ? exact : pool.filter((r) => r.acquired_year && Math.abs(r.acquired_year - y) <= 1);
    }
    if (!pool.length) return [];
    const loc = $('locationSelect').value;
    const inList = listPNSet();
    const map = new Map();
    pool.forEach((r) => { if (!map.has(r._group)) map.set(r._group, []); map.get(r._group).push(r); });
    return [...map.entries()].map(([key, recs]) => {
      const remain = recs.filter((r) => !inList.has(r.property_number) && r.status !== SCRAP_STATUS)
        .sort((a, b) => ((b._loc === loc) - (a._loc === loc)) || String(a.property_number).localeCompare(String(b.property_number)));
      const here = loc ? recs.filter((r) => r._loc === loc).length : 0;
      return { key, recs, remain, here, sample: recs[0], locs: [...new Set(recs.map((r) => r._loc).filter(Boolean))] };
    }).sort((a, b) => (b.here > 0) - (a.here > 0) || b.recs.length - a.recs.length).slice(0, 4);
  }

  function batchMethod(g) {
    const r = g.sample;
    return `同批推定（${r.model || r.item_name || ''}${r.acquired_year ? ` 民國${r.acquired_year}` : ''}，同批 ${g.recs.length} 台）`;
  }

  function groupNoticeHTML(groups, ai) {
    if (!groups.length) return '';
    const loc = $('locationSelect').value;
    const read = [ai.brand, ai.model, ai.roc_year && `民國 ${ai.roc_year} 年`].filter(Boolean).join('、');
    const rows = groups.map((g) => {
      const r = g.sample;
      const done = g.recs.length - g.remain.length;
      return `<div class="gn-row">
        <div class="gn-row-title">${esc(r.model || r.item_name || '')}${r.acquired_year ? `・民國 ${r.acquired_year} 年` : ''}</div>
        <div class="gn-row-meta">清冊共 <b>${g.recs.length}</b> 台${g.locs.length ? `・📍 ${esc(g.locs.slice(0, 3).join('、'))}${g.locs.length > 3 ? ' 等' : ''}` : ''}${done ? `・已加入或已列報廢 ${done} 台` : ''}</div>
        ${g.remain.length
          ? `<div class="gn-btns">
              <button type="button" class="btn btn-warn" data-next="${esc(g.remain[0].id)}" data-gkey="${esc(g.key)}">＋ 加入一台（${esc(g.remain[0].property_number)}）</button>
              ${g.remain.length > 1 ? `<button type="button" class="btn btn-ghost gn-multi" data-multi="${esc(g.key)}">一次加入多台…</button>` : ''}
            </div>`
          : '<div class="gn-done">✓ 這批已經全部加入清單</div>'}
      </div>`;
    }).join('');
    return `<div class="group-notice">
      <div class="gn-title">🧮 照片讀到「${esc(read)}」，清冊裡${groups.length === 1 ? '是這一批' : `有 ${groups.length} 批符合`}</div>
      <div class="gn-body">整批買進來的同款電腦長得一模一樣，報廢時<b>挑哪一台都可以</b>。按「加入一台」系統會自動挑一台還沒加入的${loc ? '（先挑上方選的地點）' : ''}，試算表會註記「同批推定」。${groups.length > 1 ? '<br>請選跟眼前這台一樣的那一批。' : ''}</div>
      ${rows}
    </div>`;
  }

  // 一次從同一批加入好幾台（例如整間電腦教室一起汰換）
  async function addManyFromGroup(key) {
    const g = (state.lastGroups || []).find((x) => x.key === key);
    if (!g || !g.remain.length) return;
    if (!currentBatch()) { toast('請先在上方輸入「報廢批次」名稱'); $('batchInput').focus(); return; }
    const max = g.remain.length;
    const ans = prompt(`要從「${g.sample.model || g.sample.item_name || ''}」這批加入幾台？\n（還有 ${max} 台沒加入，會依財產編號順序挑）`, String(Math.min(max, 5)));
    if (ans == null) return;
    const n = Math.floor(Number(String(ans).trim()));
    if (!(n >= 1)) { toast('請輸入 1 以上的數字'); return; }
    const picks = g.remain.slice(0, Math.min(n, max));
    const method = batchMethod(g);
    let ok = 0, queued = 0;
    try {
      for (const [k, rec] of picks.entries()) {
        state.bulkShot = state.shot;
        state.bulkStatus = `<span class="spin"></span> 加入中 ${k + 1}/${picks.length}：${esc(rec.property_number)}`;
        $('shotStatus').innerHTML = state.bulkStatus;
        const r = await addToList(rec, method, '', null, { stay: true, quiet: true });
        if (!r.ok) break;
        ok++; if (r.queued) queued++;
      }
    } finally {
      // 結果留在狀態列，直到下一次拍照或按「加入一台」
      state.bulkStatus = `✅ 這批已加入 ${ok} 台${queued ? `（${queued} 台先存在手機，連上後自動補送）` : ''}`;
      state.bulkShot = state.shot;
      rerenderCandidates();
    }
    if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
    toast(`✅ 已從同一批加入 ${ok} 台（清單共 ${allItems().length} 台）`);
  }

  // ================= 報廢清單 =================
  function currentBatch() { return $('batchInput').value.trim(); }
  // 目前批次的清單 = 試算表裡的 + 還在手機等待補送的
  function allItems() {
    const batch = currentBatch();
    const pend = state.pending.filter((q) => q.payload.batch === batch).map(pendingAsItem);
    const merged = state.items.map((i) => ({ ...i }));
    pend.forEach((p) => {
      const ex = merged.find((i) => i.propertyNumber === p.propertyNumber);
      const union = (a, b) => [...new Set(`${a || ''}、${b || ''}`.split('、').filter(Boolean))].join('、');
      if (!ex) merged.push(p);
      else if (ex.pending) ex.parts = union(ex.parts, p.parts);
      else ex._pendingParts = union(ex._pendingParts, p.parts);
    });
    return merged;
  }
  function listPNSet() { return new Set(allItems().map((i) => i.propertyNumber)); }
  function listItemByPN(pn) { return allItems().find((i) => i.propertyNumber === pn); }

  async function loadList() {
    const batch = currentBatch();
    $('listBatch').textContent = batch || '（請先輸入報廢批次）';
    try {
      const data = await gas('list', { batch });
      state.items = data.items || [];
      state.batches = data.batches || {};
      state.sheetUrl = data.sheetUrl || '';
      renderBatchOptions();
      setSheetLinks();
      setStatus('ok');
      setTimeout(() => flushQueue(), 300);
      syncInventoryStatus();
    } catch (e) {
      state.items = [];
      setStatus('gasError', e.message);
    }
    renderList();
    rerenderCandidates();
  }

  function renderBatchOptions() {
    $('batchList').innerHTML = Object.entries(state.batches)
      .map(([b, n]) => `<option value="${esc(b)}">${esc(b)}（${n} 台）</option>`).join('');
  }

  function setSheetLinks() {
    ['btnSheet', 'footerSheetLink'].forEach((id) => {
      const a = $(id);
      if (state.sheetUrl) { a.href = state.sheetUrl; a.removeAttribute('aria-disabled'); }
      else { a.href = '#'; a.setAttribute('aria-disabled', 'true'); }
    });
  }

  function syncSummary(items) {
    if (!state.inventory.length) return '';
    const sent = items.filter((i) => !i.pending && recByPN(i.propertyNumber));
    if (!sent.length) return '';
    const marked = sent.filter((i) => recByPN(i.propertyNumber).status === SCRAP_STATUS).length;
    return `<br>📌 財產清冊已標「待報廢」<b>${marked}／${sent.length}</b>`;
  }

  function renderList() {
    const items = allItems().sort((a, b) => (b.pending === true) - (a.pending === true) || String(b.addedAt).localeCompare(String(a.addedAt)));
    const nPend = state.pending.length;
    $('pendingBar').innerHTML = nPend
      ? `<span>⏳ 有 <b>${nPend}</b> 筆先存在這支手機，連上網路會自動補送</span>
         <button type="button" class="btn btn-ghost" id="btnFlush">${state.flushing ? '補送中…' : '立即重送'}</button>`
      : '';
    $('pendingBar').hidden = !nPend;
    if (nPend) $('btnFlush').onclick = () => flushQueue(true);
    $('listCount').textContent = items.length;
    $('topCount').textContent = items.length;
    const total = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
    const host = items.filter((i) => /主機|筆電|財產標籤/.test(i.parts)).length;
    const mon = items.filter((i) => /螢幕/.test(i.parts)).length;
    $('listSum').innerHTML = items.length
      ? `原始單價合計 <b>${money(total)}</b> · 已點到主機 ${host} · 螢幕 ${mon}${syncSummary(items)}`
      : '';
    renderProgress(items);
    if (!items.length) {
      $('listItems').innerHTML = '<div class="list-empty">尚未加入任何設備<br><small>拍照後按「加入報廢清單」就會出現在這裡</small></div>';
      return;
    }
    $('listItems').innerHTML = items.map((i) => `
      <div class="li-row ${i.pending ? 'pending' : ''}">
        <div class="li-main">
          <div class="li-pn">${esc(i.propertyNumber)}${i.pending ? '<span class="li-wait">⏳ 待補送</span>' : ''}${i._pendingParts ? `<span class="li-wait">⏳ 補記${esc(i._pendingParts)}</span>` : ''}<span class="li-age">${i.acquiredDate ? esc(i.acquiredDate) : ''}${i.age ? ` · ${esc(i.age)} 年` : ''}</span></div>
          <div class="li-model">${esc(i.model || i.itemName)}</div>
          <div class="li-meta">📍${esc(i.location || '-')}${i.parts ? ` · ${String(i.parts).split('、').map((p) => `<span class="li-part">${esc(p)}</span>`).join('')}` : ''}
            ${/推定|手動/.test(i.method) ? `<span class="li-method warn">${esc(i.method)}</span>` : ''}</div>
        </div>
        <button type="button" class="li-del" data-del="${esc(i.id)}" aria-label="移除 ${esc(i.propertyNumber)}">✕</button>
      </div>`).join('');
  }

  // ================= 同步財產清冊狀態（待報廢）=================
  // 加入報廢清單 → 把盤點系統財產清冊的狀態改成「待報廢」，並寫一筆異動紀錄
  // 移出報廢清單 → 改回原本的狀態（從異動紀錄查回，查不到就還原成「使用中」）
  const SCRAP_STATUS = '待報廢';
  const syncing = new Set();
  let syncWarned = false;

  function recByPN(pn) { return state.inventory.find((r) => r.property_number === pn); }

  function auditRow(rec, oldV, newV, notes) {
    const user = SMES_AUTH.getUser?.();
    return {
      inventory_id: rec.id, property_number: rec.property_number,
      changed_by: user?.id || null, changed_by_email: user?.email || null,
      field_changed: 'status', old_value: oldV, new_value: newV, source: 'scrap_list', notes,
    };
  }

  async function setInvStatus(rec, newStatus, notes) {
    const old = rec.status || null;
    if (old === newStatus) return;
    await SMES_DB.updateInventoryItem(rec.id, { status: newStatus });
    rec.status = newStatus;
    SMES_DB.insertAuditLogs([auditRow(rec, old, newStatus, notes)]).catch((e) => console.warn('[scrap] 異動紀錄寫入失敗', e));
  }

  // 清單裡已送達試算表的項目，清冊狀態還不是「待報廢」的就補標（也負責補救先前失敗的）
  async function syncInventoryStatus() {
    if (!state.inventory.length || navigator.onLine === false) return;
    const todo = state.items.map((i) => ({ i, rec: recByPN(i.propertyNumber) }))
      .filter((x) => x.rec && x.rec.status !== SCRAP_STATUS && !syncing.has(x.rec.id));
    if (!todo.length) return;
    todo.forEach((x) => syncing.add(x.rec.id));
    let failed = 0;
    await Promise.all(todo.map(async ({ i, rec }) => {
      try { await setInvStatus(rec, SCRAP_STATUS, `加入報廢批次「${i.batch || currentBatch()}」`); }
      catch (e) { failed++; console.warn('[scrap] 標記待報廢失敗', rec.property_number, e); }
      finally { syncing.delete(rec.id); }
    }));
    if (failed && !syncWarned) { syncWarned = true; toast(`⚠️ 有 ${failed} 筆沒能在財產清冊標成待報廢，下次重新整理會再試`); }
    renderList(); rerenderCandidates();
  }

  // 移出清單後還原狀態；若同一台還在別的報廢批次裡就不還原
  async function revertInventoryStatus(pn, batch) {
    const rec = recByPN(pn);
    // 剛加入就按復原：等「標記待報廢」先跑完，才不會還原之後又被標回去
    for (let n = 0; rec && syncing.has(rec.id) && n < 80; n++) await new Promise((r) => setTimeout(r, 100));
    if (!rec || rec.status !== SCRAP_STATUS) return;
    try {
      const all = await gas('list', {});
      if ((all.items || []).some((i) => i.propertyNumber === pn)) return;
      let prev = '使用中';
      try {
        const logs = await SMES_DB.listAuditByInventory(rec.id, 50);
        const hit = (logs || []).find((l) => l.field_changed === 'status' && l.new_value === SCRAP_STATUS);
        if (hit && hit.old_value && hit.old_value !== SCRAP_STATUS) prev = hit.old_value;
      } catch (e) { /* 查不到就用預設 */ }
      await setInvStatus(rec, prev, `移出報廢批次「${batch}」`);
      renderList(); rerenderCandidates();
    } catch (e) {
      console.warn('[scrap] 還原狀態失敗', pn, e);
      toast(`⚠️ ${pn} 已移出清單，但財產清冊的狀態沒能還原，請到管理後台確認`);
    }
  }

  // 📊 各教室／型號點收進度：清單裡每個「地點＋型號」在清冊中共有幾台、點到幾台、還差哪幾台
  function progressGroups(items) {
    if (!state.inventory.length) return [];
    const picked = new Set(items.map((i) => i.propertyNumber));
    const keys = new Map();
    items.forEach((i) => {
      const rec = state.inventory.find((r) => r.property_number === i.propertyNumber);
      if (!rec) return;
      const k = rec._loc + '｜' + (rec.model || '');
      if (!keys.has(k)) keys.set(k, { loc: rec._loc || '未填地點', model: rec.model || rec.item_name || '', recs: [] });
    });
    keys.forEach((g, k) => {
      g.recs = state.inventory.filter((r) => (r._loc + '｜' + (r.model || '')) === k)
        .sort((a, b) => String(a.property_number).localeCompare(String(b.property_number)));
      g.done = g.recs.filter((r) => picked.has(r.property_number)).length;
      g.missing = g.recs.filter((r) => !picked.has(r.property_number));
    });
    return [...keys.values()].sort((a, b) => a.loc.localeCompare(b.loc, 'zh-Hant') || a.model.localeCompare(b.model));
  }

  function renderProgress(items) {
    const groups = progressGroups(items);
    const box = $('progressBox');
    if (!groups.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="pg-title">📊 各教室點收進度 <small>（清冊中同地點、同型號的台數）</small></div>` + groups.map((g) => {
      const pct = Math.round((g.done / g.recs.length) * 100);
      const full = g.done === g.recs.length;
      return `<details class="pg-row ${full ? 'full' : ''}">
        <summary>
          <span class="pg-name"><b>${esc(g.loc)}</b> ${esc(g.model)}</span>
          <span class="pg-num">${g.done}／${g.recs.length}${full ? ' ✓' : ''}</span>
          <span class="pg-bar"><i style="width:${pct}%"></i></span>
        </summary>
        <div class="pg-missing">${full ? '這組已全部點到 👍'
          : `還沒點到 ${g.missing.length} 台：${g.missing.map((r) => `<code>${esc(r.property_number)}</code>`).join(' ')}`}</div>
      </details>`;
    }).join('');
  }

  async function removeItem(id, skipConfirm) {
    if (String(id).startsWith('q:')) {
      const qid = Number(String(id).slice(2));
      const q = state.pending.find((p) => p.qid === qid);
      if (!q) return;
      if (!skipConfirm && !confirm(`${q.payload.item.propertyNumber} 還沒送到試算表，要直接取消嗎？`)) return;
      await qDel(qid).catch(() => {});
      state.pending = state.pending.filter((p) => p.qid !== qid);
      renderList(); rerenderCandidates(); setStatus();
      toast(`已取消 ${q.payload.item.propertyNumber}`);
      return;
    }
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    if (!skipConfirm && !confirm(`要把 ${it.propertyNumber}（${it.model}）移出報廢清單嗎？\n試算表會保留紀錄並標成「已移除」。`)) return;
    try {
      await gas('remove', { id });
      state.items = state.items.filter((i) => i.id !== id);
      renderList(); rerenderCandidates();
      revertInventoryStatus(it.propertyNumber, it.batch || currentBatch());
      toast(`已移除 ${it.propertyNumber}`, { label: '復原', fn: () => restoreItem(it) });
    } catch (e) { toast('移除失敗：' + e.message); }
  }

  async function restoreItem(it) {
    try {
      await gas('restore', { id: it.id });
      state.items.push(it);
      renderList(); rerenderCandidates();
      syncInventoryStatus();
      toast(`已復原 ${it.propertyNumber}`);
    } catch (e) { toast('復原失敗：' + e.message); }
  }

  function mapRec(r) {
    const raw = r.raw_data || {};
    let acquiredDate = raw['購置日期民國'] || '';
    if (!acquiredDate && r.acquired_date) {
      const d = new Date(r.acquired_date);
      acquiredDate = `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }
    if (!acquiredDate && r.acquired_year) acquiredDate = `${r.acquired_year} 年`;
    return {
      propertyNumber: r.property_number,
      itemName: r.item_name || '',
      brand: r.brand || '',
      model: r.model || '',
      spec: r.specification || '',
      acquiredDate,
      age: r.acquired_year ? ROC_NOW - r.acquired_year : '',
      price: r.unit_price ?? raw['原始單價'] ?? '',
      location: r._loc || '',
      keeper: raw['保管人'] || '',
      unit: raw['保管單位'] || '',
    };
  }

  function shotPart() {
    const s = state.shot;
    if (s?.source === 'qr') return '財產標籤';
    const t = s?.ai?.photo_type;
    if (state.part !== '財產標籤' && ['主機', '螢幕', '筆電'].includes(t)) return t;
    return state.part;
  }

  // 回傳 { ok, queued, merged, itemId }
  async function addToList(rec, method, score, btn, opts = {}) {
    const batch = currentBatch();
    if (!batch) { toast('請先在上方輸入「報廢批次」名稱'); $('batchInput').focus(); return { ok: false }; }
    if (btn) { btn.disabled = true; btn.textContent = '寫入中…'; }
    const s = state.shot;
    const ai = s?.ai;
    const photo = s && !s.photoSent && s.thumbP ? await s.thumbP.catch(() => '') : '';
    const payload = {
      batch,
      item: mapRec(rec),
      part: shotPart(),
      method,
      score,
      aiSummary: s?.source === 'qr'
        ? `條碼：${ai?.property_number || ''}`
        : ai ? [ai.photo_type, ai.brand, ai.model, ai.property_number && `編號 ${ai.property_number}`, ai.serial_number && `S/N ${ai.serial_number}`].filter(Boolean).join(' ') : '',
      photo,
    };
    const prefix = opts.auto ? '🎯 自動加入' : '✅ 已加入';
    const undo = (id) => ({ label: '復原', fn: () => removeItem(id, true) });
    try {
      const data = await gas('add', payload, ADD_TIMEOUT_MS);
      if (s && photo) s.photoSent = true;
      const idx = state.items.findIndex((i) => i.id === data.item.id);
      if (idx >= 0) state.items[idx] = data.item; else state.items.push(data.item);
      renderList(); rerenderCandidates();
      if (!opts.quiet) {
        if (navigator.vibrate) navigator.vibrate(opts.auto ? [40, 40, 40] : 40);
        if (data.merged) toast(`${rec.property_number} 已在清單，補記「${payload.part}」`);
        else toast(`${prefix} ${rec.property_number}（清單共 ${allItems().length} 台）`, undo(data.item.id));
      }
      if (!opts.stay) setTimeout(() => $('captureCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 700);
      flushQueue();
      syncInventoryStatus();
      return { ok: true, merged: data.merged, itemId: data.item.id };
    } catch (e) {
      if (!e.network) {
        toast('寫入失敗：' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = '＋ 加入報廢清單'; }
        return { ok: false };
      }
      // 📶 網路不穩：先存在手機，連上後自動補送
      const q = { qid: Date.now() + Math.random(), createdAt: new Date().toISOString(), payload };
      try {
        await qPut(q);
      } catch (err) {
        toast('網路不穩，而且手機暫存也失敗：' + err.message);
        if (btn) { btn.disabled = false; btn.textContent = '＋ 加入報廢清單'; }
        return { ok: false };
      }
      if (s && photo) s.photoSent = true;
      state.pending.push(q);
      renderList(); rerenderCandidates(); setStatus();
      if (!opts.quiet) {
        if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
        toast(`📶 網路不穩，${rec.property_number} 先存在手機，連上後自動補送`, undo('q:' + q.qid));
      }
      if (!opts.stay) setTimeout(() => $('captureCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 700);
      return { ok: true, queued: true };
    }
  }

  // 🎯 標籤／序號 100% 相符、只有一筆、還沒在清單 → 自動加入（可在畫面上關掉）
  function autoAddCandidate(cands) {
    if (!$('autoAddToggle').checked) return null;
    if (state.shot && state.shot.source === 'qr' && state.shot.weak) return null;
    const top = cands[0];
    if (!top || top.score < 100) return null;
    if (top.conflicts && top.conflicts.length) return null;
    if (cands.filter((c) => c.score >= 100).length !== 1) return null;
    if (listPNSet().has(top.rec.property_number)) return null;
    return top;
  }

  // ================= 拍照與辨識 =================
  async function makeThumb(file) {
    const small = await SMES_GEMINI.compressImage(file, 1000, 0.72);
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(small);
    });
  }

  async function handleFile(file) {
    if (!file) return;
    const shot = { id: Date.now(), source: 'photo', file, ai: null, photoSent: false, thumbP: makeThumb(file) };
    shot.thumbP.catch(() => {});
    state.shot = shot;
    state.showAll = false;
    $('resultCard').style.display = '';
    $('shotPreview').hidden = false;
    $('shotPreview').src = URL.createObjectURL(file);
    $('shotStatus').innerHTML = '<span class="spin"></span> AI 辨識中…';
    $('aiChips').innerHTML = '';
    $('groupNotice').innerHTML = '';
    $('candList').innerHTML = '';
    $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

    const hint = state.part === '財產標籤' ? 'label' : 'device';
    // 等超過 8 秒就顯示已等幾秒與上限，讓人知道還在等、最多等多久
    const limitSec = Math.round((SMES_GEMINI.RECOGNIZE_TIMEOUT_MS || 30000) / 1000);
    const startedAt = Date.now();
    const waitTimer = setInterval(() => {
      if (state.shot !== shot) return;
      const sec = Math.round((Date.now() - startedAt) / 1000);
      if (sec >= 8) $('shotStatus').innerHTML = `<span class="spin"></span> AI 辨識中…網路有點慢，已等 ${sec} 秒（最多等 ${limitSec} 秒）`;
    }, 1000);
    try {
      let parsed;
      try {
        let meta;
        ({ parsed, meta } = await SMES_GEMINI.recognize(file, hint));
        shot.meta = meta || null;
      } finally {
        clearInterval(waitTimer);
      }
      if (state.shot !== shot) return;
      shot.ai = parsed || {};
      await processShot(shot);
    } catch (e) {
      if (state.shot !== shot) return;
      const offline = navigator.onLine === false || e.timeout === true || /fetch|network|連線|網路/i.test(e.message);
      const why = e.timeout ? `等了 ${limitSec} 秒 AI 還沒回應，網路不穩` : (offline ? '網路不穩，AI 辨識送不出去' : e.message);
      $('shotStatus').innerHTML = `<span class="err">⚠️ ${esc(why)}</span>`;
      $('candList').innerHTML = `<div class="cand-empty">${offline
        ? '沒網路時可以改用 <b>📱 掃條碼</b> 或下方「直接搜尋財產清冊」，加入的項目會先存在手機。'
        : '可以重拍一次，或在下方「直接搜尋財產清冊」手動找。'}
        <button type="button" class="btn btn-ghost" data-retry="1">🔁 用這張再辨識一次</button></div>`;
    }
  }

  // 辨識（或掃碼）完成後：列出候選 → 寫辨識紀錄 → 100% 相符就自動加入
  async function processShot(shot) {
    renderAiChips(shot.ai);
    const cands = findCandidates(shot.ai);
    state.lastCandidates = cands;
    renderShotCandidates();
    const groups = batchGroups(shot.ai, cands);
    gas('log', {
      part: shotPart(), ai: { ...shot.ai, photo_type: shot.source === 'qr' ? '條碼' : shot.ai.photo_type },
      best: cands[0] ? { propertyNumber: cands[0].rec.property_number, model: cands[0].rec.model, score: cands[0].score } : {},
      candidateCount: cands.length, sameModelCount: groups.length ? groups[0].recs.length : 0,
    }).catch((e) => console.warn('[scrap] log 失敗', e));
    const auto = autoAddCandidate(cands);
    if (!auto) return { auto: false, cands };
    $('shotStatus').innerHTML = '<span class="spin"></span> 編號完全相符，自動加入中…';
    const r = await addToList(auto.rec, auto.method, 100, null, { auto: true, stay: shot.source === 'qr' });
    if (state.shot === shot) {
      $('shotStatus').innerHTML = r.ok
        ? `🎯 ${esc(auto.rec.property_number)} 已自動加入${r.queued ? '（先存在手機）' : ''}`
        : '🎯 找到了！財產編號完全相符';
    }
    return { auto: r.ok, cands, rec: auto.rec, queued: r.queued };
  }

  // ================= 掃條碼（一維、二維都可以） =================
  let qrScanner = null;
  let qrBusy = false;
  let qrLast = { text: '', at: 0 };

  // 掃描框：寬的長方形，長條形條碼（一維）和方形條碼（二維）都放得進去
  function qrBoxSize(w, h) {
    const bw = Math.max(120, Math.floor(w * 0.88));
    const bh = Math.max(100, Math.min(Math.floor(h * 0.7), Math.floor(bw * 0.55)));
    return { width: Math.min(bw, w), height: Math.min(bh, h) };
  }

  // 條碼內容像不像財產編號：只有數字和分隔符號，或是本系統自己印的 QR（網址帶 ?pn=）
  function qrLooksLikePN(text) {
    const t = String(text || '').trim();
    return /[?&]pn=[\w\-]+/i.test(t) || /^[\d\s\-_.\/]{3,24}$/.test(t);
  }

  function loadQrLib() {
    if (window.Html5Qrcode) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('條碼元件載入失敗（需要網路，或先在有網路時開一次）'));
      document.head.appendChild(s);
    });
  }

  function qrMsg(html, kind) {
    const el = $('qrMsg');
    el.innerHTML = html;
    el.className = 'qr-msg' + (kind ? ' ' + kind : '');
  }

  async function openQR() {
    if (!currentBatch()) { toast('請先在上方輸入「報廢批次」名稱'); $('batchInput').focus(); return; }
    $('qrModal').hidden = false;
    document.body.style.overflow = 'hidden';
    qrMsg('把財產標籤上的條碼放進框內（長條形、方形都可以），掃到會自動找財產');
    try {
      await loadQrLib();
      qrScanner = new window.Html5Qrcode('qrReader', { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      await qrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: qrBoxSize },
        onQrDecoded,
        () => {}
      );
    } catch (e) {
      qrMsg('⚠️ 相機開啟失敗：' + esc(e.message || e) + '<br>請確認已允許瀏覽器使用相機', 'err');
    }
  }

  async function closeQR() {
    if (qrScanner) {
      try { await qrScanner.stop(); } catch (e) { /* 已停止 */ }
      try { qrScanner.clear(); } catch (e) { /* ignore */ }
      qrScanner = null;
    }
    $('qrModal').hidden = true;
    document.body.style.overflow = '';
  }

  async function onQrDecoded(text) {
    const now = Date.now();
    if (qrBusy || (text === qrLast.text && now - qrLast.at < 4000)) return;
    qrBusy = true;
    qrLast = { text, at: now };
    try { qrScanner.pause(true); } catch (e) { /* ignore */ }
    if (navigator.vibrate) navigator.vibrate(30);
    qrMsg(`<span class="spin"></span> 掃到「${esc(String(text).slice(0, 40))}」，比對中…`);

    const shot = { id: now, source: 'qr', file: null, ai: { photo_type: '財產標籤', property_number: String(text).trim() }, photoSent: true, thumbP: null, weak: !qrLooksLikePN(text) };
    state.shot = shot;
    state.showAll = false;
    $('resultCard').style.display = '';
    $('shotPreview').hidden = true;
    $('groupNotice').innerHTML = '';
    const r = await processShot(shot);
    qrBusy = false;

    if (r.auto) {
      // 連續掃描：加入成功就留在掃描畫面，直接掃下一台
      qrMsg(`✅ <b>${esc(r.rec.property_number)}</b> ${esc(r.rec.model || '')} 已加入${r.queued ? '（先存在手機）' : ''}<br>清單共 ${allItems().length} 台，請掃下一台`, 'ok');
      setTimeout(() => { try { qrScanner && qrScanner.resume(); } catch (e) { /* ignore */ } }, 900);
      return;
    }
    const top = r.cands[0];
    if (top && top.score >= 100 && listPNSet().has(top.rec.property_number)) {
      qrMsg(`ℹ️ <b>${esc(top.rec.property_number)}</b> 已經在清單裡了，請掃下一台`, 'warn');
      setTimeout(() => { try { qrScanner && qrScanner.resume(); } catch (e) { /* ignore */ } }, 1200);
      return;
    }
    // 沒有 100% 相符（或關掉自動加入）→ 關掉掃描，讓老師看候選清單自己選
    await closeQR();
    if (top && shot.weak) {
      $('shotStatus').innerHTML = '<span class="err">⚠️ 這個條碼不像財產編號（可能掃到旁邊的序號貼紙），請核對後再按「加入」</span>';
    }
    if (!top) {
      $('shotStatus').innerHTML = '🤔 條碼內容在清冊裡找不到';
      $('candList').innerHTML = `<div class="cand-empty">條碼內容：<code>${esc(text)}</code><br>可以改拍照辨識，或用下方搜尋手動找。</div>`;
    }
    $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAiChips(ai) {
    if (state.shot?.source === 'qr') {
      $('aiChips').innerHTML = `<span class="ai-chip"><small>條碼內容</small>${esc(String(ai.property_number || '').slice(0, 60))}</span>`;
      return;
    }
    const chips = [
      ai.photo_type && ['類型', ai.photo_type],
      ai.brand && ['廠牌', ai.brand],
      ai.model && ['型號', ai.model],
      ai.property_number && ['財產編號', ai.property_number],
      ai.serial_number && ['序號', ai.serial_number],
      ai.roc_year && ['年份', `民國 ${ai.roc_year}`],
    ].filter(Boolean);
    const meta = state.shot && state.shot.meta;
    const modelChip = meta && meta.model
      ? `<span class="ai-chip muted"><small>AI 模型</small>${esc(meta.model)}</span>` : '';
    const fallbackNote = meta && meta.fallbackFrom
      ? `<div class="ai-hint">⚠️ 後台選的模型「${esc(meta.fallbackFrom)}」目前無法使用，這次先改用預設模型。請到後台「🤖 AI 模型」重新選一個。</div>` : '';
    const wantLabel = state.part === '財產標籤' || ai.photo_type === '財產標籤';
    const retakeHint = ai.example_echo || (!ai.property_number && wantLabel)
      ? '<div class="ai-hint">📏 沒讀到財產編號，標籤可能太小或太糊。請靠近到標籤佔畫面一半以上再拍一次，或改用「📱 掃條碼」。</div>' : '';
    $('aiChips').innerHTML = (chips.length
      ? chips.map(([k, v]) => `<span class="ai-chip"><small>${esc(k)}</small>${esc(v)}</span>`).join('')
      : '<span class="ai-chip muted">照片裡沒有讀到文字</span>') + modelChip + retakeHint + fallbackNote;
  }

  function renderShotCandidates() {
    const cands = state.lastCandidates;
    const shot = state.shot;
    if (!shot || !shot.ai) return;
    const inList = listPNSet();
    const top = cands[0];
    const groups = batchGroups(shot.ai, cands);
    state.lastGroups = groups;
    if (state.bulkShot !== shot) state.bulkStatus = '';
    $('groupNotice').innerHTML = groupNoticeHTML(groups, shot.ai);
    if (!top) {
      if (groups.length) {
        $('shotStatus').innerHTML = state.bulkStatus || '🧮 這是整批採購的同款電腦，挑一台加入就好';
        $('candList').innerHTML = '<div class="cand-empty">如果上面都不是眼前這台，再改拍<b>財產標籤</b>或<b>機身銘牌（型號貼紙）</b>，或用下方搜尋手動找。</div>';
        return;
      }
      $('shotStatus').innerHTML = '🤔 清冊裡找不到相近的設備';
      const onlyBrand = shot.ai.brand && !shot.ai.model && !shot.ai.property_number;
      $('candList').innerHTML = `<div class="cand-empty">${onlyBrand ? `只讀到廠牌「${esc(shot.ai.brand)}」，清冊裡沒有這個廠牌的電腦。<br>` : ''}試試改拍<b>財產標籤</b>或<b>機身銘牌（型號貼紙）</b>，或用下方搜尋手動找。</div>`;
      return;
    }
    const topConflict = top.score >= 100 && top.conflicts && top.conflicts.length;
    $('shotStatus').innerHTML = state.bulkStatus ? state.bulkStatus : topConflict
      ? '<span class="err">⚠️ 編號對到了，但其他資料跟清冊不一樣，請核對標籤後再按加入</span>'
      : top.score >= 100
      ? '🎯 找到了！財產編號完全相符'
      : groups.length
      ? '🧮 這是整批採購的同款電腦，挑一台加入就好（下方也列出個別的財產）'
      : `🔍 找到 ${cands.length} 筆可能的財產，最接近的在最上面`;
    const show = state.showAll ? cands : cands.slice(0, SHOW_FIRST);
    $('candList').innerHTML = show.map((c) => candHTML(c, inList)).join('')
      + (cands.length > show.length ? `<button type="button" class="btn btn-ghost btn-block" data-more="1">顯示其他 ${cands.length - show.length} 筆</button>` : '');
  }

  function rerenderCandidates() {
    if (state.shot?.ai) { state.lastCandidates = findCandidates(state.shot.ai); renderShotCandidates(); }
    renderSearch();
  }

  function candHTML(c, inList) {
    const r = c.rec;
    const already = inList.has(r.property_number);
    const lvl = c.score >= 90 ? 'high' : c.score >= 60 ? 'mid' : 'low';
    const scoreTxt = c.score === '' || c.score == null ? '' : `<div class="cand-score ${lvl}">${c.score}<small>%</small></div>`;
    const age = r.acquired_year ? ROC_NOW - r.acquired_year : null;
    const ageCls = age >= 8 ? 'old' : age >= 5 ? 'mid' : '';
    const listItem = already ? listItemByPN(r.property_number) : null;
    return `<div class="cand ${already ? 'in-list' : ''}">
      ${scoreTxt}
      <div class="cand-body">
        <div class="cand-pn">${esc(r.property_number)} ${already ? '<span class="tag-in">已在清單</span>' : (r.status === SCRAP_STATUS ? '<span class="tag-in other">其他批次已列待報廢</span>' : '')}</div>
        <div class="cand-model">${esc(r.model || r.item_name)}</div>
        ${r.specification && r.specification !== r.model ? `<div class="cand-spec">${esc(r.specification)}</div>` : ''}
        <div class="cand-meta">
          <span>📍 ${esc(r._loc || '-')}</span>
          ${r.acquired_year ? `<span class="age ${ageCls}">📅 民國 ${r.acquired_year} 年（${age} 年）</span>` : ''}
          ${r.unit_price ? `<span>💰 ${money(r.unit_price)}</span>` : ''}
        </div>
        ${c.reasons && c.reasons.length ? `<div class="cand-reasons">${c.reasons.map((x) => `<span>✓ ${esc(x)}</span>`).join('')}</div>` : ''}
        ${c.conflicts && c.conflicts.length ? `<div class="cand-warn">⚠️ 編號相符，但這幾項跟照片讀到的不一樣：${c.conflicts.map((x) => esc(x)).join('、')}。<br>可能是 AI 把編號看錯了，請對照標籤上的編號再決定，所以沒有自動加入。</div>` : ''}
      </div>
      <div class="cand-act">
        ${already
          ? `<button type="button" class="btn btn-ghost" data-add="${esc(r.id)}" data-method="${esc(c.method)}" data-score="${esc(c.score)}">補記部件</button>
             <small class="cand-parts">${esc(listItem?.parts || '')}</small>`
          : `<button type="button" class="btn btn-primary" data-add="${esc(r.id)}" data-method="${esc(c.method)}" data-score="${esc(c.score)}">＋ 加入報廢清單</button>`}
      </div>
    </div>`;
  }

  // ================= 手動搜尋 =================
  function renderSearch() {
    const q = $('manualSearch').value.trim().toUpperCase();
    if (q.length < 2) { $('searchList').innerHTML = ''; return; }
    const words = q.split(/\s+/).filter(Boolean);
    const hits = state.inventory.filter((r) => words.every((w) => r._search.includes(w) || norm(r._search).includes(norm(w))))
      .sort((a, b) => String(a.property_number).localeCompare(String(b.property_number)))
      .slice(0, 30);
    const inList = listPNSet();
    $('searchList').innerHTML = hits.length
      ? `<div class="search-count">找到 ${hits.length}${hits.length === 30 ? '+' : ''} 筆</div>`
        + hits.map((rec) => candHTML({ rec, score: '', method: state.shot ? '手動搜尋（有拍照）' : '手動搜尋', reasons: [] }, inList)).join('')
      : '<div class="cand-empty">沒有符合的財產</div>';
  }

  // ================= 列印與匯出 =================
  function rocToday() {
    const d = new Date();
    return `中華民國 ${d.getFullYear() - 1911} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  function sortedForPrint() {
    return allItems().sort((a, b) => String(a.propertyNumber).localeCompare(String(b.propertyNumber)));
  }

  // 列印附錄：同地點、同型號但這次沒點到的財產（供核對用，不是報廢項目）
  function missingAppendix(items) {
    const groups = progressGroups(items).filter((g) => g.missing.length);
    if (!groups.length) return '<div class="pa-appendix"><h2>附錄：未點到名單</h2><p>同地點、同型號的設備已全部點到。</p></div>';
    return `<div class="pa-appendix"><h2>附錄：同地點同型號尚未點到的財產（供核對，非報廢項目）</h2>
      <table><thead><tr><th>存放地點</th><th>型號</th><th>點到／清冊台數</th><th>尚未點到的財產編號</th></tr></thead>
      <tbody>${groups.map((g) => `<tr><td>${esc(g.loc)}</td><td>${esc(g.model)}</td><td class="num">${g.done}／${g.recs.length}</td>
        <td>${g.missing.map((r) => esc(r.property_number)).join('、')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function printList() {
    const items = sortedForPrint();
    if (!items.length) { toast('清單是空的，先加入要報廢的設備'); return; }
    const nPend = items.filter((i) => i.pending).length;
    if (nPend && !confirm(`還有 ${nPend} 筆存在手機、尚未送到試算表。
要先一起印出來嗎？（建議連上網路補送完再印）`)) return;
    const total = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
    $('printArea').innerHTML = `
      <h1>桃園市龍潭區石門國民小學　電腦設備報廢清冊</h1>
      <div class="pa-meta"><span>報廢批次：${esc(currentBatch())}</span><span>填表日期：${rocToday()}</span></div>
      <table>
        <thead><tr><th>序</th><th>財產編號</th><th>財產名稱</th><th>廠牌型號／規格</th><th>取得日期</th><th>已使用</th><th>原始單價</th><th>存放地點</th><th>保管人</th><th>點到部件</th><th>備註</th></tr></thead>
        <tbody>${items.map((i, n) => `<tr>
          <td>${n + 1}</td><td class="pn">${esc(i.propertyNumber)}</td><td>${esc(i.itemName)}</td>
          <td>${esc(i.model)}${i.spec && i.spec !== i.model ? `<div class="spec">${esc(i.spec)}</div>` : ''}</td>
          <td>${esc(i.acquiredDate)}</td><td>${i.age ? esc(i.age) + ' 年' : ''}</td><td class="num">${esc(money(i.price))}</td>
          <td>${esc(i.location)}</td><td>${esc(i.keeper)}</td><td>${esc(i.parts)}</td>
          <td>${esc([/推定|手動/.test(i.method) ? i.method : '', i.note].filter(Boolean).join('；'))}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="6">合計 ${items.length} 筆</td><td class="num">${money(total)}</td><td colspan="4"></td></tr></tfoot>
      </table>
      <div class="pa-sign"><div>填表人（資訊組）</div><div>單位主管</div><div>總務主任</div><div>校長</div></div>
      ${$('printMissing').checked ? missingAppendix(items) : ''}`;
    window.print();
  }

  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Excel 元件載入失敗'));
      document.head.appendChild(s);
    });
  }

  async function exportExcel() {
    const items = sortedForPrint();
    if (!items.length) { toast('清單是空的'); return; }
    try {
      const XLSX = await loadXLSX();
      const rows = items.map((i, n) => ({
        '序': n + 1, '財產編號': i.propertyNumber, '財產名稱': i.itemName, '廠牌': i.brand, '型號': i.model,
        '規格（含螢幕）': i.spec, '取得日期': i.acquiredDate, '已使用(年)': i.age, '原始單價': Number(i.price) || i.price,
        '存放地點': i.location, '保管人': i.keeper, '保管單位': i.unit, '點到部件': i.parts, '比對方式': i.method,
        '登錄者': i.by, '加入時間': i.addedAt, '備註': i.note,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '報廢清冊');
      const d = new Date();
      XLSX.writeFile(wb, `電腦報廢清冊_${currentBatch() || '未命名'}_${d.getFullYear() - 1911}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.xlsx`);
    } catch (e) { toast(e.message); }
  }

  // ================= 狀態列 =================
  let invOk = false, gasState = 'loading', gasMsg = '';
  function setStatus(kind, msg) {
    if (kind === 'inv') invOk = true;
    if (kind === 'ok') { gasState = 'ok'; gasMsg = ''; }
    if (kind === 'gasError') { gasState = 'error'; gasMsg = msg; }
    const inv = invOk ? `✅ 財產清冊 ${state.inventory.length} 筆已載入` : '⏳ 財產清冊載入中…';
    const g = gasState === 'ok' ? '✅ 報廢試算表已連線'
      : gasState === 'error' ? `⚠️ ${esc(gasMsg)} <button type="button" class="link-btn" id="btnRetryGas">重試</button>`
      : '⏳ 連線報廢試算表…';
    $('setupStatus').innerHTML = `<span>${inv}</span><span class="${gasState === 'error' ? 'err' : ''}">${g}</span>`;
    const rb = $('btnRetryGas');
    if (rb) rb.onclick = loadList;
  }

  // ================= 初始化 =================
  async function loadInventory() {
    try {
      const rows = await SMES_DB.listInventory(3000);
      rows.forEach(prepareRecord);
      state.inventory = rows;
      state.byId = new Map(rows.map((r) => [String(r.id), r]));
      const counts = {};
      rows.forEach((r) => { if (r._loc) counts[r._loc] = (counts[r._loc] || 0) + 1; });
      const saved = localStorage.getItem(LS_LOC) || '';
      $('locationSelect').innerHTML = '<option value="">不限地點</option>' + Object.entries(counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))
        .map(([l, n]) => `<option value="${esc(l)}" ${l === saved ? 'selected' : ''}>${esc(l)}（${n} 台）</option>`).join('');
      setStatus('inv');
    } catch (e) {
      $('setupStatus').innerHTML = `<span class="err">⚠️ 財產清冊載入失敗：${esc(e.message)}</span>`;
      if (/401|JWT|expired/i.test(e.message)) SMES_AUTH.handleSessionExpired('登入已過期');
    }
  }

  function bind() {
    $('partSeg').addEventListener('click', (e) => {
      const b = e.target.closest('.part-btn');
      if (!b) return;
      state.part = b.dataset.part;
      document.querySelectorAll('.part-btn').forEach((x) => x.classList.toggle('active', x === b));
    });
    ['shotCamera', 'shotLibrary'].forEach((id) => $(id).addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      handleFile(f);
    }));
    $('btnLive').addEventListener('click', () => SMES_CAMERA.open(handleFile));
    $('btnCloseShot').addEventListener('click', () => { state.shot = null; $('resultCard').style.display = 'none'; renderSearch(); });

    let saveTimer;
    $('batchInput').addEventListener('change', () => {
      localStorage.setItem(LS_BATCH, currentBatch());
      clearTimeout(saveTimer);
      saveTimer = setTimeout(loadList, 100);
    });
    $('locationSelect').addEventListener('change', () => {
      localStorage.setItem(LS_LOC, $('locationSelect').value);
      if (state.shot?.ai) { state.lastCandidates = findCandidates(state.shot.ai); renderShotCandidates(); }
    });
    let searchTimer;
    $('manualSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderSearch, 180); });

    document.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) {
        const rec = state.byId.get(add.dataset.add);
        if (rec) addToList(rec, add.dataset.method, add.dataset.score === '' ? '' : Number(add.dataset.score), add);
        return;
      }
      const next = e.target.closest('[data-next]');
      if (next) {
        const rec = state.byId.get(next.dataset.next);
        const g = (state.lastGroups || []).find((x) => x.key === next.dataset.gkey);
        state.bulkStatus = '';
        if (rec) addToList(rec, g ? batchMethod(g) : '同批推定', '', next);
        return;
      }
      const multi = e.target.closest('[data-multi]');
      if (multi) { addManyFromGroup(multi.dataset.multi); return; }
      if (e.target.closest('[data-more]')) { state.showAll = true; renderShotCandidates(); return; }
      if (e.target.closest('[data-retry]')) { if (state.shot?.file) handleFile(state.shot.file); return; }
      const del = e.target.closest('[data-del]');
      if (del) { removeItem(del.dataset.del); return; }
    });
    ['btnSheet', 'footerSheetLink'].forEach((id) => $(id).addEventListener('click', (e) => {
      if (!state.sheetUrl) { e.preventDefault(); toast('報廢試算表尚未連線'); }
    }));
    $('btnPrint').addEventListener('click', printList);
    $('btnExport').addEventListener('click', exportExcel);
    $('btnRefresh').addEventListener('click', () => { loadList(); toast('已重新整理'); });

    // 自動加入開關（預設開啟，記在這支手機）
    $('autoAddToggle').checked = localStorage.getItem(LS_AUTO) !== '0';
    $('autoAddToggle').addEventListener('change', (e) => {
      localStorage.setItem(LS_AUTO, e.target.checked ? '1' : '0');
      toast(e.target.checked ? '已開啟：編號 100% 相符就自動加入' : '已關閉自動加入，每台都要自己按「加入」');
    });

    // 掃條碼
    $('btnQR').addEventListener('click', openQR);
    $('btnQrClose').addEventListener('click', closeQR);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('qrModal').hidden) closeQR(); });

    // 網路恢復就補送；另外每 20 秒檢查一次
    window.addEventListener('online', () => { toast('📶 網路恢復，開始補送…'); flushQueue(); });
    window.addEventListener('offline', () => toast('📵 網路中斷了，加入的項目會先存在手機'));
    setInterval(() => { if (state.pending.length) flushQueue(); }, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.pending.length) flushQueue(); });
  }

  function init() {
    $('batchInput').value = localStorage.getItem(LS_BATCH) || `${SCHOOL_YEAR}學年度 電腦設備報廢`;
    bind();
    setStatus();
    loadInventory().then(() => { renderSearch(); renderList(); syncInventoryStatus(); });
    reloadPending().then(() => { renderList(); loadList(); });
  }

  // 給測試用（不影響正式功能）
  window.SMES_SCRAP = { batchGroups, pnConflicts, syncInventoryStatus, revertInventoryStatus, removeItem, progressGroups, scoreRecord, findCandidates, modelTokens, pnMatch, prepareRecord, state, flushQueue, onQrDecoded, allItems };
  init();
})();
