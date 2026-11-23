// 電腦財產報廢點收 — 拍照 → AI 辨識 → 比對財產清冊 → 寫入 GAS 報廢試算表
(function () {
  const C = window.SMES_CONFIG;
  const $ = (id) => document.getElementById(id);
  const ROC_NOW = new Date().getFullYear() - 1911;
  const SCHOOL_YEAR = new Date().getMonth() >= 7 ? ROC_NOW : ROC_NOW - 1;
  const LS_BATCH = 'smes_scrap_batch';
  const LS_LOC = 'smes_scrap_location';
  const SHOW_FIRST = 5;

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
  async function gas(action, payload = {}) {
    if (!C.SCRAP_GAS_URL) throw new Error('尚未設定報廢試算表網址');
    const token = await SMES_AUTH.getFreshAccessToken();
    let res, text;
    try {
      // 不設 Content-Type → text/plain，避免 CORS 預檢
      res = await fetch(C.SCRAP_GAS_URL, { method: 'POST', body: JSON.stringify({ action, token, ...payload }) });
      text = await res.text();
    } catch (e) {
      throw new Error('連不到報廢試算表（網路中斷，或後端尚未完成第一次授權）');
    }
    let data;
    try { data = JSON.parse(text); } catch (e) {
      throw new Error('報廢試算表後端尚未啟用，請擁有者在 Apps Script 編輯器執行一次 setup 並按允許');
    }
    if (!data.ok) throw new Error(data.error || '報廢試算表回應錯誤');
    return data;
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
    if (last.length >= 4 && last.length <= 6 && window._generatePNVariants) {
      if (window._generatePNVariants(last.padStart(6, '0')).includes(target)) return 'fuzzy';
    }
    // AI 把數字看成字母（0→O、1→I、8→B、5→S、2→Z），換回數字後再比一次
    const tail = (raw.toUpperCase().match(/[0-9A-Z]+/g) || []).pop() || '';
    const fixed = tail.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2');
    if (fixed !== tail && /^\d{3,6}$/.test(fixed) && fixed.padStart(6, '0') === target) return 'fuzzy';
    return null;
  }

  function scoreRecord(rec, ai, loc) {
    const reasons = [];
    const pn = pnMatch(ai.property_number, rec);
    const aiSN = norm(ai.serial_number);
    if (pn === 'exact') return { score: 100, method: '財產編號', reasons: ['財產編號完全相同'] };
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

  function sameModelPeers(cands) {
    const top = cands[0];
    if (!top || top.score >= 100 || top.method !== '型號比對') return [];
    const peers = cands.filter((c) => c.score === top.score && c.rec._group === top.rec._group);
    return peers.length > 1 ? peers : [];
  }

  // ================= 報廢清單 =================
  function currentBatch() { return $('batchInput').value.trim(); }
  function listPNSet() { return new Set(state.items.map((i) => i.propertyNumber)); }
  function listItemByPN(pn) { return state.items.find((i) => i.propertyNumber === pn); }

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

  function renderList() {
    const items = [...state.items].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    $('listCount').textContent = items.length;
    $('topCount').textContent = items.length;
    const total = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
    const host = items.filter((i) => /主機|筆電|財產標籤/.test(i.parts)).length;
    const mon = items.filter((i) => /螢幕/.test(i.parts)).length;
    $('listSum').innerHTML = items.length
      ? `原始單價合計 <b>${money(total)}</b> · 已點到主機 ${host} · 螢幕 ${mon}`
      : '';
    if (!items.length) {
      $('listItems').innerHTML = '<div class="list-empty">尚未加入任何設備<br><small>拍照後按「加入報廢清單」就會出現在這裡</small></div>';
      return;
    }
    $('listItems').innerHTML = items.map((i) => `
      <div class="li-row">
        <div class="li-main">
          <div class="li-pn">${esc(i.propertyNumber)}<span class="li-age">${i.acquiredDate ? esc(i.acquiredDate) : ''}${i.age ? ` · ${esc(i.age)} 年` : ''}</span></div>
          <div class="li-model">${esc(i.model || i.itemName)}</div>
          <div class="li-meta">📍${esc(i.location || '-')}${i.parts ? ` · ${String(i.parts).split('、').map((p) => `<span class="li-part">${esc(p)}</span>`).join('')}` : ''}
            ${/推定|手動/.test(i.method) ? `<span class="li-method warn">${esc(i.method)}</span>` : ''}</div>
        </div>
        <button type="button" class="li-del" data-del="${esc(i.id)}" aria-label="移除 ${esc(i.propertyNumber)}">✕</button>
      </div>`).join('');
  }

  async function removeItem(id) {
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    if (!confirm(`要把 ${it.propertyNumber}（${it.model}）移出報廢清單嗎？\n試算表會保留紀錄並標成「已移除」。`)) return;
    try {
      await gas('remove', { id });
      state.items = state.items.filter((i) => i.id !== id);
      renderList(); rerenderCandidates();
      toast(`已移除 ${it.propertyNumber}`, { label: '復原', fn: () => restoreItem(it) });
    } catch (e) { toast('移除失敗：' + e.message); }
  }

  async function restoreItem(it) {
    try {
      await gas('restore', { id: it.id });
      state.items.push(it);
      renderList(); rerenderCandidates();
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
    const t = s?.ai?.photo_type;
    if (state.part !== '財產標籤' && ['主機', '螢幕', '筆電'].includes(t)) return t;
    return state.part;
  }

  async function addToList(rec, method, score, btn) {
    const batch = currentBatch();
    if (!batch) { toast('請先在上方輸入「報廢批次」名稱'); $('batchInput').focus(); return; }
    if (btn) { btn.disabled = true; btn.textContent = '寫入中…'; }
    const s = state.shot;
    const ai = s?.ai;
    try {
      const photo = s && !s.photoSent ? await s.thumbP.catch(() => '') : '';
      const data = await gas('add', {
        batch,
        item: mapRec(rec),
        part: shotPart(),
        method,
        score,
        aiSummary: ai ? [ai.photo_type, ai.brand, ai.model, ai.property_number && `編號 ${ai.property_number}`, ai.serial_number && `S/N ${ai.serial_number}`].filter(Boolean).join(' ') : '',
        photo,
      });
      if (s && photo) s.photoSent = true;
      const idx = state.items.findIndex((i) => i.id === data.item.id);
      if (idx >= 0) state.items[idx] = data.item; else state.items.push(data.item);
      renderList(); rerenderCandidates();
      if (navigator.vibrate) navigator.vibrate(40);
      toast(data.merged
        ? `${rec.property_number} 已在清單，補記「${shotPart()}」`
        : `✅ 已加入 ${rec.property_number}（清單共 ${state.items.length} 台）`);
      setTimeout(() => $('captureCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 700);
    } catch (e) {
      toast('寫入失敗：' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = '＋ 加入報廢清單'; }
    }
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
    const shot = { id: Date.now(), file, ai: null, photoSent: false, thumbP: makeThumb(file) };
    shot.thumbP.catch(() => {});
    state.shot = shot;
    state.showAll = false;
    $('resultCard').style.display = '';
    $('shotPreview').src = URL.createObjectURL(file);
    $('shotStatus').innerHTML = '<span class="spin"></span> AI 辨識中…';
    $('aiChips').innerHTML = '';
    $('groupNotice').innerHTML = '';
    $('candList').innerHTML = '';
    $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

    const hint = state.part === '財產標籤' ? 'label' : 'device';
    try {
      const { parsed } = await SMES_GEMINI.recognize(file, hint);
      if (state.shot !== shot) return;
      shot.ai = parsed || {};
      renderAiChips(shot.ai);
      const cands = findCandidates(shot.ai);
      state.lastCandidates = cands;
      renderShotCandidates();
      const peers = sameModelPeers(cands);
      gas('log', {
        part: shotPart(), ai: shot.ai,
        best: cands[0] ? { propertyNumber: cands[0].rec.property_number, model: cands[0].rec.model, score: cands[0].score } : {},
        candidateCount: cands.length, sameModelCount: peers.length,
      }).catch((e) => console.warn('[scrap] log 失敗', e));
    } catch (e) {
      if (state.shot !== shot) return;
      $('shotStatus').innerHTML = `<span class="err">⚠️ ${esc(e.message)}</span>`;
      $('candList').innerHTML = `<div class="cand-empty">可以重拍一次，或在下方「直接搜尋財產清冊」手動找。
        <button type="button" class="btn btn-ghost" data-retry="1">🔁 用這張再辨識一次</button></div>`;
    }
  }

  function renderAiChips(ai) {
    const chips = [
      ai.photo_type && ['類型', ai.photo_type],
      ai.brand && ['廠牌', ai.brand],
      ai.model && ['型號', ai.model],
      ai.property_number && ['財產編號', ai.property_number],
      ai.serial_number && ['序號', ai.serial_number],
      ai.roc_year && ['年份', `民國 ${ai.roc_year}`],
    ].filter(Boolean);
    $('aiChips').innerHTML = chips.length
      ? chips.map(([k, v]) => `<span class="ai-chip"><small>${esc(k)}</small>${esc(v)}</span>`).join('')
      : '<span class="ai-chip muted">照片裡沒有讀到文字</span>';
  }

  function renderShotCandidates() {
    const cands = state.lastCandidates;
    const shot = state.shot;
    if (!shot || !shot.ai) return;
    const inList = listPNSet();
    const top = cands[0];
    if (!top) {
      $('shotStatus').innerHTML = '🤔 清冊裡找不到相近的設備';
      $('groupNotice').innerHTML = '';
      const onlyBrand = shot.ai.brand && !shot.ai.model && !shot.ai.property_number;
      $('candList').innerHTML = `<div class="cand-empty">${onlyBrand ? `只讀到廠牌「${esc(shot.ai.brand)}」，同廠牌的電腦太多台。<br>` : ''}試試改拍<b>財產標籤</b>或<b>機身銘牌（型號貼紙）</b>，或用下方搜尋手動找。</div>`;
      return;
    }
    $('shotStatus').innerHTML = top.score >= 100
      ? '🎯 找到了！財產編號完全相符'
      : `🔍 找到 ${cands.length} 筆可能的財產，最接近的在最上面`;

    const peers = sameModelPeers(cands);
    if (peers.length) {
      const remain = peers.filter((p) => !inList.has(p.rec.property_number));
      const locs = [...new Set(peers.map((p) => p.rec._loc).filter(Boolean))].slice(0, 4).join('、');
      $('groupNotice').innerHTML = `<div class="group-notice">
        <div class="gn-title">🧮 清冊裡同型號、同年份共有 <b>${peers.length}</b> 台${locs ? `（${esc(locs)}）` : ''}</div>
        <div class="gn-body">外觀一模一樣，光看機身分不出是哪一台。<br>
        ✅ <b>最準確</b>：把「這張要拍的是」切到「財產標籤」再拍一次。<br>
        ⚡ <b>這批全部都要報廢</b>：直接加入下一台還沒加入的（試算表會註記「型號推定」）。</div>
        ${remain.length
          ? `<button type="button" class="btn btn-warn" data-next="${esc(remain[0].rec.id)}">＋ 加入下一台：${esc(remain[0].rec.property_number)}（還剩 ${remain.length} 台）</button>`
          : '<div class="gn-done">✓ 同型號的這批已經全部加入清單</div>'}
      </div>`;
    } else {
      $('groupNotice').innerHTML = '';
    }
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
        <div class="cand-pn">${esc(r.property_number)} ${already ? '<span class="tag-in">已在清單</span>' : ''}</div>
        <div class="cand-model">${esc(r.model || r.item_name)}</div>
        ${r.specification && r.specification !== r.model ? `<div class="cand-spec">${esc(r.specification)}</div>` : ''}
        <div class="cand-meta">
          <span>📍 ${esc(r._loc || '-')}</span>
          ${r.acquired_year ? `<span class="age ${ageCls}">📅 民國 ${r.acquired_year} 年（${age} 年）</span>` : ''}
          ${r.unit_price ? `<span>💰 ${money(r.unit_price)}</span>` : ''}
        </div>
        ${c.reasons && c.reasons.length ? `<div class="cand-reasons">${c.reasons.map((x) => `<span>✓ ${esc(x)}</span>`).join('')}</div>` : ''}
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
    return [...state.items].sort((a, b) => String(a.propertyNumber).localeCompare(String(b.propertyNumber)));
  }

  function printList() {
    const items = sortedForPrint();
    if (!items.length) { toast('清單是空的，先加入要報廢的設備'); return; }
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
      <div class="pa-sign"><div>填表人（資訊組）</div><div>單位主管</div><div>總務主任</div><div>校長</div></div>`;
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
        const peers = sameModelPeers(state.lastCandidates);
        if (rec) addToList(rec, `型號推定（同型號 ${peers.length} 台）`, state.lastCandidates[0]?.score ?? '', next);
        return;
      }
      if (e.target.closest('[data-more]')) { state.showAll = true; renderShotCandidates(); return; }
      if (e.target.closest('[data-retry]')) { if (state.shot) handleFile(state.shot.file); return; }
      const del = e.target.closest('[data-del]');
      if (del) { removeItem(del.dataset.del); return; }
    });
    ['btnSheet', 'footerSheetLink'].forEach((id) => $(id).addEventListener('click', (e) => {
      if (!state.sheetUrl) { e.preventDefault(); toast('報廢試算表尚未連線'); }
    }));
    $('btnPrint').addEventListener('click', printList);
    $('btnExport').addEventListener('click', exportExcel);
    $('btnRefresh').addEventListener('click', () => { loadList(); toast('已重新整理'); });
  }

  function init() {
    $('batchInput').value = localStorage.getItem(LS_BATCH) || `${SCHOOL_YEAR}學年度 電腦設備報廢`;
    bind();
    setStatus();
    loadInventory().then(() => renderSearch());
    loadList();
  }

  // 給測試用（不影響正式功能）
  window.SMES_SCRAP = { scoreRecord, findCandidates, modelTokens, pnMatch, prepareRecord, state };
  init();
})();
