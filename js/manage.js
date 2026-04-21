// 管理後台：手機優化版
(function() {
  const DB = window.SMES_DB;
  const $ = id => document.getElementById(id);

  let cache = { rooms: [], photos: [], inventory: [], stats: [] };
  let importState = { workbook: null, sheetName: null, rows: [], headers: [], mapping: {} };

  function toast(msg, type = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }
  function yearBadge(y) {
    if (!y) return '';
    const age = 115 - y;
    if (age >= 8) return `<span class="badge badge-old">${y}年</span>`;
    if (age >= 5) return `<span class="badge badge-mid">${y}年</span>`;
    return `<span class="badge badge-new">${y}年</span>`;
  }
  const CAT_NAMES = { class: '班級', subject: '專科', admin: '行政', care: '課照', kindergarten: '幼兒園', other: '其他' };

  // ============ Tabs ============
  $('tabBar').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      $('tabBar').querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      $('tab-' + btn.dataset.tab).style.display = 'block';
    });
  });

  // ============ 載入 ============
  async function loadAll() {
    try {
      const [rooms, photos, inventory, stats] = await Promise.all([
        DB.listClassrooms(),
        DB.listAllPhotos(500),
        DB.listInventory(5000),
        DB.getClassroomStats()
      ]);
      cache = { rooms, photos, inventory, stats };

      $('statRooms').textContent = rooms.length;
      $('statInv').textContent = inventory.length;
      $('statPhotos').textContent = photos.length;
      $('statMatched').textContent = photos.filter(p => p.matched_inventory_id).length;

      fillSelect('photoRoomFilter', rooms);
      fillSelect('invRoomFilter', rooms);
      fillYearSelect('invYearFilter', inventory);

      renderPhotos();
      renderRooms();
      renderInventory();

      // 儀表板（首個 tab，預設顯示）
      if (window.SMES_DASHBOARD) {
        await window.SMES_DASHBOARD.render(inventory, rooms);
      }
    } catch (e) {
      toast('載入失敗: ' + e.message, 'error');
      console.error(e);
    }
  }

  function fillSelect(id, rooms) {
    const sel = $(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="">所有教室</option>' +
      rooms.map(r => `<option value="${r.code}">${r.code} ${r.name}</option>`).join('');
    sel.value = cur;
  }
  function fillYearSelect(id, inv) {
    const years = [...new Set(inv.map(x => x.acquired_year).filter(y => y))].sort((a,b) => b-a);
    $(id).innerHTML = '<option value="">所有年份</option>' +
      years.map(y => `<option value="${y}">${y} 年</option>`).join('');
  }

  // ============ Tab: 拍照紀錄 ============
  function renderPhotos() {
    const kw = $('photoSearch').value.trim().toLowerCase();
    const room = $('photoRoomFilter').value;
    let list = cache.photos;
    if (room) list = list.filter(p => p.classroom_code === room);
    if (kw) list = list.filter(p =>
      (p.classroom_code || '').toLowerCase().includes(kw) ||
      (p.detected_model || '').toLowerCase().includes(kw) ||
      (p.detected_brand || '').toLowerCase().includes(kw) ||
      (p.detected_property_number || '').toLowerCase().includes(kw)
    );

    if (list.length === 0) {
      $('photoList').innerHTML = '<div class="empty"><div class="icon">📭</div>無資料</div>';
      return;
    }

    const roomMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));
    const invMap = Object.fromEntries(cache.inventory.map(i => [i.id, i]));

    $('photoList').innerHTML = list.map(p => {
      const match = p.matched_inventory_id ? invMap[p.matched_inventory_id] : null;
      return `<div class="list-item">
        <div class="row">
          ${p.photo_url ? `<img src="${p.photo_url}" loading="lazy">` : '<div style="width:48px;height:48px;background:var(--bg);border-radius:8px;"></div>'}
          <div class="info" style="flex:1;min-width:0;">
            <div class="title">${p.detected_brand || ''} ${p.detected_model || '(未填型號)'}</div>
            <div class="sub">
              <b>${p.classroom_code}</b> ${roomMap[p.classroom_code] || ''}
              ${p.detected_property_number ? `· 🏷${p.detected_property_number}` : ''}
            </div>
            <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
              ${p.photo_type ? `<span class="tag">${p.photo_type}</span>` : ''}
              ${yearBadge(p.detected_year)}
              ${match ? `<span class="tag" style="background:var(--success-soft);color:var(--success);">✓ ${match.property_number}</span>` : ''}
            </div>
          </div>
          <button class="del" style="color:var(--danger);" onclick="delRow(${p.id},'${p.photo_path||''}')">🗑</button>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:6px;">
          ${new Date(p.created_at).toLocaleString('zh-TW', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
        </div>
      </div>`;
    }).join('');
  }

  window.delRow = async (id, path) => {
    if (!confirm('確認刪除？')) return;
    try {
      await DB.deletePhoto(id);
      if (path) DB.deletePhotoFile(path);
      cache.photos = cache.photos.filter(p => p.id !== id);
      $('statPhotos').textContent = cache.photos.length;
      renderPhotos();
      toast('已刪除', 'success');
    } catch (e) { toast('刪除失敗', 'error'); }
  };

  window.exportPhotosExcel = () => {
    if (!cache.photos.length) { toast('無資料', 'error'); return; }
    const roomMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));
    const data = cache.photos.map(p => ({
      '教室代碼': p.classroom_code, '教室名稱': roomMap[p.classroom_code] || '',
      '類型': p.photo_type || '', '廠牌': p.detected_brand || '', '型號': p.detected_model || '',
      '財產編號': p.detected_property_number || '', '民國年': p.detected_year || '',
      '序號': p.detected_serial || '', '信心度': p.confidence || '',
      '已比對財產ID': p.matched_inventory_id || '', '備註': p.notes || '',
      '時間': new Date(p.created_at).toLocaleString('zh-TW'),
      '照片URL': p.photo_url || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '盤點紀錄');
    XLSX.writeFile(wb, `石門盤點_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  $('photoSearch').addEventListener('input', renderPhotos);
  $('photoRoomFilter').addEventListener('change', renderPhotos);

  // ============ Tab: 教室 ============
  function renderRooms() {
    const statsMap = Object.fromEntries(cache.stats.map(x => [x.code, x]));
    $('roomsList').innerHTML = cache.rooms.map(r => {
      const st = statsMap[r.code] || {};
      const pc = st.photo_count || 0;
      const ic = st.inventory_count || 0;
      const oldest = st.oldest_detected_year || st.oldest_inventory_year;
      return `<div class="list-item" onclick="goRoom('${r.code}')" style="cursor:pointer;">
        <div class="row">
          <div style="width:40px;height:40px;background:var(--primary-light);color:var(--primary);border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;">
            ${r.floor === 0 ? '幼' : r.floor + 'F'}
          </div>
          <div class="info" style="flex:1;min-width:0;">
            <div class="title">${r.name} <span style="color:var(--text-muted);font-weight:500;font-size:12px;">#${r.code}</span></div>
            <div class="sub" style="display:flex;gap:6px;flex-wrap:wrap;">
              <span class="tag">${CAT_NAMES[r.category] || r.category}</span>
              <span style="color:${pc>0?'var(--success)':'var(--text-muted)'};font-weight:600;">📷 ${pc}</span>
              <span style="color:var(--text-soft);">📦 ${ic}</span>
              ${oldest ? yearBadge(oldest) : ''}
            </div>
          </div>
          <div style="color:var(--text-muted);">›</div>
        </div>
      </div>`;
    }).join('');
  }
  window.goRoom = code => {
    localStorage.setItem('smes_current_room', code);
    location.href = 'index.html';
  };

  // ============ Tab: 財產清冊 ============
  function renderInventory() {
    const kw = $('invSearch').value.trim().toLowerCase();
    const room = $('invRoomFilter').value;
    const year = $('invYearFilter').value;

    let list = cache.inventory;
    if (room) list = list.filter(i => i.classroom_code === room);
    if (year) list = list.filter(i => i.acquired_year === parseInt(year));
    if (kw) list = list.filter(i =>
      (i.property_number||'').toLowerCase().includes(kw) ||
      (i.item_name||'').toLowerCase().includes(kw) ||
      (i.model||'').toLowerCase().includes(kw) ||
      (i.brand||'').toLowerCase().includes(kw)
    );

    if (list.length === 0) {
      $('invList').innerHTML = `<div class="empty"><div class="icon">📦</div>${cache.inventory.length === 0 ? '尚未匯入，請到「📥 匯入」上傳' : '無符合條件資料'}</div>`;
      return;
    }

    const matchedIds = new Set(cache.photos.filter(p => p.matched_inventory_id).map(p => p.matched_inventory_id));

    $('invList').innerHTML = list.slice(0, 300).map(i => `
      <div class="list-item inv-row" data-id="${i.id}">
        <div class="row">
          <div class="info" style="flex:1;min-width:0;">
            <div class="title" style="font-family:monospace;">${i.property_number || '-'}</div>
            <div class="sub">${i.brand || ''} ${i.model || ''}</div>
            <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
              ${yearBadge(i.acquired_year)}
              ${i.classroom_code ? `<span class="tag">${i.classroom_code}</span>` : ''}
              ${i.location_text && i.location_text !== i.classroom_code ? `<span class="tag" style="background:var(--bg);color:var(--text-soft);">${i.location_text}</span>` : ''}
              ${matchedIds.has(i.id) ? '<span class="tag" style="background:var(--success-soft);color:var(--success);">✓ 已拍</span>' : ''}
            </div>
          </div>
          <button class="inv-history-btn" onclick="showInvHistory(${i.id}, '${(i.property_number || '').replace(/'/g, '')}');event.stopPropagation();">🕒 歷史</button>
        </div>
      </div>
    `).join('') + (list.length > 300 ? `<div style="text-align:center;padding:10px;color:var(--text-muted);font-size:12px;">僅顯示前 300 筆 (共 ${list.length})</div>` : '');
  }

  // 顯示單筆財產的異動歷史
  window.showInvHistory = async (id, pn) => {
    const modal = $('invHistoryModal');
    const backdrop = $('invHistoryBackdrop');
    const body = $('invHistoryBody');
    const title = $('invHistoryTitle');
    if (!modal || !body) return;
    title.innerHTML = `🕒 ${pn || '#' + id} 異動歷史`;
    body.innerHTML = '<div class="empty"><div class="loading-lg"></div></div>';
    modal.classList.add('show');
    if (backdrop) backdrop.classList.add('show');
    try {
      const rows = await DB.listAuditByInventory(id, 100);
      if (!rows.length) {
        body.innerHTML = '<div class="empty">📭 尚無異動紀錄<br><small style="color:var(--text-muted);">（v7.3.2 之前的更新沒有記錄）</small></div>';
        return;
      }
      const sourceIcon = { photo_recognition: '📷', manual: '✏️', excel_import: '📥', api: '🔌' };
      const fieldLabel = {
        brand: '廠牌', model: '型號', acquired_year: '購置民國年',
        serial_number: '序號 S/N', classroom_code: '教室',
        location_text: '位置', item_name: '品名',
        _created: '🆕 新增', _deleted: '🗑 刪除'
      };
      body.innerHTML = '<div class="audit-timeline">' + rows.map(r => `
        <div class="audit-item">
          <div class="audit-time">${new Date(r.changed_at).toLocaleString('zh-TW', { hour12: false })}</div>
          <div class="audit-main">
            <div class="audit-head">
              <span class="audit-source">${sourceIcon[r.source] || '📝'} ${r.source}</span>
              <span class="audit-field">${fieldLabel[r.field_changed] || r.field_changed}</span>
            </div>
            ${r.field_changed === '_created' ? `
              <div class="audit-change"><span class="audit-new-big">新增：${r.new_value || ''}</span></div>
            ` : `
              <div class="audit-change">
                <span class="audit-old">${r.old_value || '(空)'}</span>
                <span class="audit-arrow">→</span>
                <span class="audit-new">${r.new_value || '(空)'}</span>
              </div>
            `}
            <div class="audit-meta">
              ${r.changed_by_email ? `👤 ${r.changed_by_email}` : ''}
              ${r.notes ? `<span class="audit-notes">· ${r.notes}</span>` : ''}
            </div>
          </div>
        </div>
      `).join('') + '</div>';
    } catch (e) {
      body.innerHTML = `<div class="empty">❌ 載入失敗：${e.message}</div>`;
    }
  };
  window.closeInvHistory = () => {
    $('invHistoryModal')?.classList.remove('show');
    $('invHistoryBackdrop')?.classList.remove('show');
  };

  $('invSearch').addEventListener('input', renderInventory);
  $('invRoomFilter').addEventListener('change', renderInventory);
  $('invYearFilter').addEventListener('change', renderInventory);

  // ============ Tab: Excel 匯入 ============
  const FIELD_DEFS = [
    { key:'property_number', label:'財產編號', hints:['財產編號','編號','財編','財產序號','property','code'] },
    { key:'item_name', label:'品名', hints:['品名','名稱','物品','item','name'] },
    { key:'brand', label:'廠牌', hints:['廠牌','品牌','brand'] },
    { key:'model', label:'型號', hints:['型號','model','機型','標準化機型'] },
    { key:'specification', label:'規格', hints:['規格','spec','配備','特徵及說明'] },
    { key:'acquired_year', label:'取得年(民國)', hints:['取得年','年份','年度','購置','取得日期','購置日期','民國年','購置民國年'] },
    { key:'unit_price', label:'單價', hints:['單價','金額','價格','price','原值','原始單價'] },
    { key:'classroom_code', label:'教室代碼', hints:['教室代碼','室號','room','房號','室代碼'] },
    { key:'location_text', label:'放置位置', hints:['放置地點','放置位置','位置','使用地點','保管人','存放地點','保管單位','使用單位'] },
    { key:'status', label:'狀態', hints:['狀態','使用狀態'] }
  ];

  const normalize = s => String(s || '').toLowerCase().replace(/\s/g, '');

  function autoMapFields(headers) {
    const map = {};
    for (const f of FIELD_DEFS) {
      for (const h of headers) {
        const nh = normalize(h);
        if (f.hints.some(hint => nh.includes(normalize(hint)))) {
          map[f.key] = h;
          break;
        }
      }
    }
    return map;
  }

  $('excelFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      importState.workbook = XLSX.read(buf, { type: 'array', cellDates: true });
      renderSheetPicker();
      importState.sheetName = importState.workbook.SheetNames[0];
      loadSheet();
      $('excelPreview').style.display = 'block';
      toast('Excel 已載入', 'success');
    } catch (err) { toast('讀取失敗: ' + err.message, 'error'); }
  });

  function renderSheetPicker() {
    const names = importState.workbook.SheetNames;
    if (names.length === 1) { $('sheetPicker').innerHTML = ''; return; }
    $('sheetPicker').innerHTML = '<div class="field" style="margin-bottom:10px;"><label>工作表</label><select id="sheetSelect">' +
      names.map(n => `<option value="${n}">${n}</option>`).join('') + '</select></div>';
    $('sheetSelect').addEventListener('change', e => {
      importState.sheetName = e.target.value;
      loadSheet();
    });
  }

  function loadSheet() {
    const ws = importState.workbook.Sheets[importState.sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    let bestIdx = 0, bestLen = 0;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const n = rows[i].filter(x => String(x||'').trim()).length;
      if (n > bestLen) { bestLen = n; bestIdx = i; }
    }
    const headers = rows[bestIdx].map((h, i) => String(h || '').trim() || `欄${i+1}`);
    const dataRows = rows.slice(bestIdx + 1).filter(r => r.some(c => String(c||'').trim()));

    importState.headers = headers;
    importState.rows = dataRows.map(r => {
      const o = {};
      headers.forEach((h, i) => o[h] = r[i]);
      return o;
    });
    importState.mapping = autoMapFields(headers);

    renderFieldMap();
    renderPreviewTable();
    $('previewStats').innerHTML = `📊 <b>${importState.rows.length}</b> 筆資料 · <b>${headers.length}</b> 欄`;
  }

  function renderFieldMap() {
    $('fieldMap').innerHTML = FIELD_DEFS.map(f => `
      <div class="field">
        <label>${f.label}${importState.mapping[f.key] ? ' ✓' : ''}</label>
        <select onchange="window.__updateMap('${f.key}', this.value)">
          <option value="">— 不匯入 —</option>
          ${importState.headers.map(h => `<option value="${h}" ${importState.mapping[f.key]===h?'selected':''}>${h}</option>`).join('')}
        </select>
      </div>
    `).join('');
  }
  window.__updateMap = (key, col) => {
    if (col) importState.mapping[key] = col; else delete importState.mapping[key];
    renderPreviewTable();
  };

  function parseYear(val) {
    if (val == null || val === '') return null;
    if (val instanceof Date) return val.getFullYear() - 1911;
    const s = String(val).trim();
    const m = s.match(/(\d{2,4})/);
    if (!m) return null;
    let n = parseInt(m[1]);
    if (n >= 1900) n = n - 1911;
    if (n >= 60 && n <= 130) return n;
    return null;
  }

  function buildRows() {
    const map = importState.mapping;
    return importState.rows.map(r => {
      const item = { raw_data: r };
      for (const f of FIELD_DEFS) {
        const col = map[f.key];
        if (!col) continue;
        let v = r[col];
        if (v == null || v === '') continue;
        if (f.key === 'acquired_year') v = parseYear(v);
        else if (f.key === 'unit_price') {
          const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
          v = isNaN(n) ? null : n;
        } else v = String(v).trim();
        if (v !== null && v !== undefined && v !== '') item[f.key] = v;
      }
      if (!item.classroom_code && item.location_text) {
        const m = item.location_text.match(/C\d{3}|K-\w+/i);
        if (m) item.classroom_code = m[0].toUpperCase();
      }
      return item;
    });
  }

  function renderPreviewTable() {
    const built = buildRows().slice(0, 10);
    if (built.length === 0) { $('previewTable').innerHTML = ''; return; }
    const cols = ['property_number','item_name','brand','model','acquired_year','classroom_code','location_text'];
    const labels = Object.fromEntries(FIELD_DEFS.map(f => [f.key, f.label]));
    $('previewTable').innerHTML =
      '<thead><tr>' + cols.map(c => `<th>${labels[c]||c}</th>`).join('') + '</tr></thead>' +
      '<tbody>' + built.map(b => `<tr>${cols.map(c => `<td>${b[c] ?? '-'}</td>`).join('')}</tr>`).join('') + '</tbody>';
  }

  async function doImport(clearFirst) {
    if (!importState.rows.length) { toast('尚未載入', 'error'); return; }
    try {
      if (clearFirst) { await DB.clearInventory(); toast('已清空', ''); }
      const items = buildRows();
      const validCodes = new Set(cache.rooms.map(r => r.code));
      let invalid = 0;
      items.forEach(it => {
        if (it.classroom_code && !validCodes.has(it.classroom_code)) {
          invalid++;
          it.location_text = (it.location_text || '') + ` [原代碼: ${it.classroom_code}]`;
          delete it.classroom_code;
        }
      });
      let done = 0;
      for (let i = 0; i < items.length; i += 200) {
        const slice = items.slice(i, i + 200);
        await DB.insertInventoryBatch(slice);
        done += slice.length;
        toast(`已匯入 ${done}/${items.length}...`, '');
      }
      toast(`✅ 完成 ${done} 筆${invalid ? ' (' + invalid + ' 筆教室代碼無效)' : ''}`, 'success');
      $('excelFile').value = '';
      $('excelPreview').style.display = 'none';
      importState = { workbook:null, sheetName:null, rows:[], headers:[], mapping:{} };
      loadAll();
    } catch (e) { toast('匯入失敗: ' + e.message, 'error'); console.error(e); }
  }

  window.confirmImport = () => doImport(false);
  window.clearAndImport = () => { if (confirm('會先清空所有 inventory_items 資料再匯入，確認？')) doImport(true); };
  window.cancelImport = () => {
    $('excelFile').value = '';
    $('excelPreview').style.display = 'none';
    importState = { workbook:null, sheetName:null, rows:[], headers:[], mapping:{} };
  };

  // ============ QR 標籤批次列印 ============
  const qrSelected = new Set();

  function renderQRList() {
    const kw = ($('qrFilter')?.value || '').trim().toLowerCase();
    const room = $('qrRoomFilter')?.value || '';
    const year = $('qrYearFilter')?.value || '';

    // 初次渲染 filter
    if ($('qrRoomFilter') && !$('qrRoomFilter').dataset.filled) {
      fillSelect('qrRoomFilter', cache.rooms);
      fillYearSelect('qrYearFilter', cache.inventory);
      $('qrRoomFilter').dataset.filled = '1';
    }

    let list = cache.inventory;
    if (room) list = list.filter(i => i.classroom_code === room);
    if (year) list = list.filter(i => i.acquired_year === parseInt(year));
    if (kw) list = list.filter(i =>
      (i.property_number || '').toLowerCase().includes(kw) ||
      (i.model || '').toLowerCase().includes(kw) ||
      (i.brand || '').toLowerCase().includes(kw)
    );

    $('qrVisibleCount').textContent = list.length;
    $('qrSelectedCount').textContent = qrSelected.size;
    $('qrGenBtn').disabled = qrSelected.size === 0;

    if (list.length === 0) {
      $('qrList').innerHTML = '<div class="empty">無符合資料</div>';
      return;
    }

    $('qrList').innerHTML = list.slice(0, 300).map(i => {
      const checked = qrSelected.has(i.id) ? 'checked' : '';
      return `<label class="qr-item">
        <input type="checkbox" ${checked} onchange="qrToggle(${i.id})">
        <div>
          <div class="qr-pn">${i.property_number || '-'}</div>
          <div class="qr-sub">${i.brand || ''} ${i.model || ''}</div>
          <div class="qr-meta">${i.classroom_code || '-'} ${i.acquired_year ? '· '+i.acquired_year+'年' : ''}</div>
        </div>
      </label>`;
    }).join('') + (list.length > 300 ? `<div style="text-align:center;padding:10px;color:var(--text-muted);">僅顯示前 300 筆 (共 ${list.length})</div>` : '');
  }

  window.qrToggle = (id) => {
    if (qrSelected.has(id)) qrSelected.delete(id);
    else qrSelected.add(id);
    $('qrSelectedCount').textContent = qrSelected.size;
    $('qrGenBtn').disabled = qrSelected.size === 0;
  };

  window.qrSelectAll = () => {
    const kw = ($('qrFilter')?.value || '').trim().toLowerCase();
    const room = $('qrRoomFilter')?.value || '';
    const year = $('qrYearFilter')?.value || '';
    cache.inventory.forEach(i => {
      if (room && i.classroom_code !== room) return;
      if (year && i.acquired_year !== parseInt(year)) return;
      if (kw && !(i.property_number||'').toLowerCase().includes(kw) && !(i.model||'').toLowerCase().includes(kw)) return;
      qrSelected.add(i.id);
    });
    renderQRList();
  };

  window.qrUnselectAll = () => {
    qrSelected.clear();
    renderQRList();
  };

  window.generateQRPDF = async () => {
    const items = cache.inventory.filter(i => qrSelected.has(i.id));
    if (!items.length) { toast('請先勾選財產', 'error'); return; }
    const layout = $('qrLayout').value;
    const btn = $('qrGenBtn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '產生中…';
    try {
      const fileName = await window.SMES_QR.generate(items, layout);
      toast(`✅ 已產生 ${fileName}`, 'success');
    } catch (e) {
      toast('產生失敗: ' + e.message, 'error');
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  };

  // 綁定 filter
  ['qrFilter', 'qrRoomFilter', 'qrYearFilter'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', renderQRList);
  });

  // Tab 切換時初始化 QR list
  $('tabBar').querySelectorAll('button[data-tab="qr"]').forEach(b => {
    b.addEventListener('click', () => renderQRList());
  });

  // ============ 網路設備 Tab ============
  let netDevices = null;
  const netSort = { key: 'host_address', dir: 'asc' };  // 預設按 IP 升冪

  // IP 轉成可比較的數值（e.g. 10.36.182.102 → 10036182102）
  function ipToNum(ip) {
    if (!ip) return 0;
    const parts = String(ip).split('.').map(n => parseInt(n) || 0);
    return parts[0] * 1e9 + parts[1] * 1e6 + parts[2] * 1e3 + parts[3];
  }

  function sortDevices(list, key, dir) {
    const mult = dir === 'desc' ? -1 : 1;
    const vendor = d => (window.SMES_NETTOOLS?.vendorOf(d.mac_address) || '');
    const sorted = [...list].sort((a, b) => {
      let av, bv;
      if (key === '_vendor') { av = vendor(a); bv = vendor(b); }
      else { av = a[key]; bv = b[key]; }
      if (key === 'host_address') return (ipToNum(av) - ipToNum(bv)) * mult;
      if (key === 'mac_address') {
        av = (av || '').replace(/[-:]/g, '').toLowerCase();
        bv = (bv || '').replace(/[-:]/g, '').toLowerCase();
      }
      av = (av || '').toString();
      bv = (bv || '').toString();
      return av.localeCompare(bv, 'zh-Hant', { numeric: true }) * mult;
    });
    return sorted;
  }

  window.sortNet = (key) => {
    if (netSort.key === key) {
      netSort.dir = netSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      netSort.key = key;
      netSort.dir = 'asc';
    }
    applyNetworkFilter();
  };

  async function loadNetwork() {
    if (netDevices) return netDevices;
    try {
      const list = await DB.listNetworkDevices?.() ||
        fetch(`${window.SMES_CONFIG.SUPABASE_URL}/rest/v1/network_devices?select=*&order=network_segment,classroom_code`, {
          headers: {
            apikey: window.SMES_CONFIG.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${window.SMES_AUTH?.getAccessToken?.() || window.SMES_CONFIG.SUPABASE_ANON_KEY}`
          }
        }).then(r => r.json());
      netDevices = await Promise.resolve(list);
      return netDevices;
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async function renderNetwork() {
    const list = await loadNetwork();
    if (!list.length) {
      $('netList').innerHTML = '<div class="empty">無網路設備資料</div>';
      return;
    }

    // KPI
    const by44 = list.filter(d => d.network_segment?.startsWith('10.44')).length;
    const by36 = list.filter(d => d.network_segment?.startsWith('10.36')).length;
    const by66 = list.filter(d => d.network_segment?.startsWith('10.66')).length;
    $('networkKPI').innerHTML = `
      <div class="kpi-card"><div class="label">10.44 電腦教室</div><div class="val">${by44}</div><div class="sub">台</div></div>
      <div class="kpi-card accent"><div class="label">10.36 教學行政</div><div class="val">${by36}</div><div class="sub">台</div></div>
      <div class="kpi-card success"><div class="label">10.66 無線/移動</div><div class="val">${by66}</div><div class="sub">台</div></div>
    `;

    // IP 衝突警示
    if (window.SMES_NETTOOLS) {
      const conflicts = window.SMES_NETTOOLS.findIPConflicts(list);
      const count = Object.keys(conflicts).length;
      const el = $('ipConflictWarning');
      if (el) {
        if (count > 0) {
          el.style.display = 'block';
          const rows = Object.entries(conflicts).map(([ip, devs]) =>
            `<div class="conflict-row"><b>${ip}</b> 被 ${devs.length} 台佔用：${devs.map(d => d.name).join('、')}</div>`
          ).join('');
          el.innerHTML = `
            <div class="conflict-banner">
              <b>⚠️ 偵測到 ${count} 組 IP 衝突</b>
              <div style="margin-top:6px;font-size:12px;">${rows}</div>
            </div>
          `;
        } else {
          el.style.display = 'none';
        }
      }
    }

    applyNetworkFilter();
  }

  function applyNetworkFilter() {
    if (!netDevices) return;
    const kw = ($('netSearch')?.value || '').trim().toLowerCase();
    const seg = $('netSegment')?.value || '';
    const role = $('netRole')?.value || '';

    let list = netDevices;
    if (seg) list = list.filter(d => d.network_segment === seg);
    if (role) list = list.filter(d => d.device_role === role);
    if (kw) list = list.filter(d => {
      const vendor = window.SMES_NETTOOLS?.vendorOf(d.mac_address) || '';
      return (d.name || '').toLowerCase().includes(kw) ||
        (d.host_address || '').toLowerCase().includes(kw) ||
        (d.mac_address || '').toLowerCase().includes(kw) ||
        (d.classroom_code || '').toLowerCase().includes(kw) ||
        vendor.toLowerCase().includes(kw);
    });

    const roleLabel = {
      computer_lab_student: '電腦教室學生',
      computer_lab_teacher: '電腦教室教師',
      classroom_teacher: '班級教師',
      classroom_public: '班級公用',
      admin_office: '行政',
      mobile_touch: '移動觸屏',
      unknown: '未分類'
    };

    if (list.length === 0) {
      $('netList').innerHTML = '<div class="empty">無符合條件</div>';
      return;
    }

    // 排序
    list = sortDevices(list, netSort.key, netSort.dir);

    const cols = [
      { key: 'name', label: '名稱' },
      { key: 'host_address', label: 'IP 位址' },
      { key: 'mac_address', label: 'MAC 位址' },
      { key: '_vendor', label: '廠商' },
      { key: 'network_segment', label: '網段' },
      { key: 'device_role', label: '角色' },
      { key: 'classroom_code', label: '教室' }
    ];

    const arrow = k => {
      if (netSort.key !== k) return '<span class="sort-arrow">↕</span>';
      return netSort.dir === 'asc' ? '<span class="sort-arrow active">▲</span>' : '<span class="sort-arrow active">▼</span>';
    };

    // 取出所有 IP 衝突（全局，不只篩選後）
    const allList = netDevices;
    const conflicts = window.SMES_NETTOOLS ? window.SMES_NETTOOLS.findIPConflicts(allList) : {};

    $('netList').innerHTML = `<div class="table-wrap">
      <table class="data-table sortable">
        <thead><tr>
          ${cols.map(c => `<th class="sortable-th" onclick="sortNet('${c.key}')">${c.label}${arrow(c.key)}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${list.slice(0, 500).map(d => {
            const vendor = window.SMES_NETTOOLS ? (window.SMES_NETTOOLS.vendorOf(d.mac_address) || '') : '';
            const isConflict = d.host_address && conflicts[d.host_address];
            return `
            <tr class="${isConflict ? 'row-conflict' : ''}">
              <td><b>${d.name}</b></td>
              <td style="font-family:monospace">${d.host_address || '-'}${isConflict ? ' <span class="badge badge-old" title="IP 衝突">⚠</span>' : ''}</td>
              <td style="font-family:monospace;font-size:11px;">${d.mac_address || '-'}</td>
              <td>${vendor ? `<span class="vendor-tag">${vendor}</span>` : '<span style="color:var(--text-muted);">-</span>'}</td>
              <td>${d.network_segment || '-'}</td>
              <td>${roleLabel[d.device_role] || d.device_role}</td>
              <td>${d.classroom_code || '-'}</td>
            </tr>
          `;}).join('')}
        </tbody>
      </table>
    </div>` + (list.length > 500 ? `<p style="text-align:center;color:var(--text-muted);">僅顯示前 500 筆 (共 ${list.length})</p>` : '');
  }

  ['netSearch', 'netSegment', 'netRole'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', applyNetworkFilter);
    if (el) el.addEventListener('change', applyNetworkFilter);
  });

  // Tab 切換時載入 network
  $('tabBar').querySelectorAll('button[data-tab="network"]').forEach(b => {
    b.addEventListener('click', () => renderNetwork());
  });

  // Excel 匯出目前篩選結果
  window.exportNetworkExcel = async () => {
    const all = await loadNetwork();
    const kw = ($('netSearch')?.value || '').trim().toLowerCase();
    const seg = $('netSegment')?.value || '';
    const role = $('netRole')?.value || '';

    let list = all;
    if (seg) list = list.filter(d => d.network_segment === seg);
    if (role) list = list.filter(d => d.device_role === role);
    if (kw) list = list.filter(d => {
      const vendor = window.SMES_NETTOOLS?.vendorOf(d.mac_address) || '';
      return (d.name || '').toLowerCase().includes(kw) ||
        (d.host_address || '').toLowerCase().includes(kw) ||
        (d.mac_address || '').toLowerCase().includes(kw) ||
        (d.classroom_code || '').toLowerCase().includes(kw) ||
        vendor.toLowerCase().includes(kw);
    });

    if (!list.length) { toast('無可匯出資料', 'error'); return; }
    const fname = window.SMES_NETTOOLS.exportToExcel(list);
    toast(`✅ 已匯出 ${list.length} 筆到 ${fname}`, 'success');
  };

  // ============ Veyon 匯出 ============
  window.doVeyonExport = async () => {
    const list = await loadNetwork();
    const scope = $('veyonScope').value;

    let filtered = list;
    let scopeName = 'all';
    let scopeValue = null;

    if (scope.startsWith('seg:')) {
      scopeValue = scope.slice(4);
      filtered = window.SMES_VEYON.filterDevices(list, { segment: scopeValue });
      scopeName = 'segment';
    } else if (scope.startsWith('grp:')) {
      scopeValue = scope.slice(4);
      filtered = window.SMES_VEYON.filterDevices(list, { group: scopeValue });
      scopeName = 'group';
    }

    if (filtered.length === 0) {
      toast('沒有符合條件的設備', 'error');
      return;
    }

    const json = window.SMES_VEYON.build(filtered);
    const ts = new Date().toISOString().slice(0, 10);
    const fname = scopeValue ? `veyon_${scopeValue.replace(/[^\w]/g, '_')}_${ts}.json` : `veyon_all_${ts}.json`;
    window.SMES_VEYON.download(json, fname);

    // 紀錄到 Supabase
    await window.SMES_VEYON.logExport(scopeName, scopeValue, filtered, null);

    toast(`✅ 已匯出 ${filtered.length} 台設備到 ${fname}`, 'success');
  };

  window.doVeyonDiff = (fileInput) => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const oldJson = JSON.parse(e.target.result);
        const list = await loadNetwork();
        const result = window.SMES_VEYON.diff(oldJson, list);
        renderDiffResult(result);
      } catch (err) {
        toast('讀取舊 JSON 失敗: ' + err.message, 'error');
      }
      fileInput.value = '';
    };
    reader.readAsText(file);
  };

  function renderDiffResult(r) {
    const el = $('veyonDiffResult');
    el.innerHTML = `
      <div class="diff-summary">
        <b>📊 比對結果</b>：舊檔 ${r.oldCount} 台 → 新檔 ${r.newCount} 台
        <span style="color:var(--success);">+ 新增 ${r.added.length}</span>
        <span style="color:var(--danger);">− 移除 ${r.removed.length}</span>
        <span style="color:var(--accent);">⚡ 變更 ${r.changed.length}</span>
      </div>
      ${r.added.length ? `
        <details open><summary class="diff-summary-head added">➕ 新增 ${r.added.length} 台（Veyon 中沒有但系統有）</summary>
          <div class="diff-list">
            ${r.added.map(a => `<div class="diff-row added"><b>${a.new.name}</b> · ${a.new.host_address || '-'} · ${a.new.mac_address || ''} · ${a.new.group_name}</div>`).join('')}
          </div>
        </details>` : ''}
      ${r.removed.length ? `
        <details open><summary class="diff-summary-head removed">➖ 移除 ${r.removed.length} 台（Veyon 中有但系統沒有，可能已汰換）</summary>
          <div class="diff-list">
            ${r.removed.map(a => `<div class="diff-row removed"><b>${a.old.name}</b> · ${a.old.host || '-'} · ${a.old.mac || ''}</div>`).join('')}
          </div>
        </details>` : ''}
      ${r.changed.length ? `
        <details open><summary class="diff-summary-head changed">⚡ 變更 ${r.changed.length} 台（IP/MAC/群組被修改）</summary>
          <div class="diff-list">
            ${r.changed.map(c => `<div class="diff-row changed">
              <b>${c.name}</b> (${c.host})
              <ul>${c.diffs.map(d => `<li>${d.field}：<span style="color:var(--danger);">${d.old || '(空)'}</span> → <span style="color:var(--success);">${d.new || '(空)'}</span></li>`).join('')}</ul>
            </div>`).join('')}
          </div>
        </details>` : ''}
      ${r.added.length === 0 && r.removed.length === 0 && r.changed.length === 0 ?
        '<div style="padding:14px;background:var(--success-soft);color:var(--success);border-radius:8px;">✅ 資料完全一致！Veyon 設定與系統資料庫無差異。</div>' : ''}
    `;
  }

  // ============ 月報表 PDF ============
  window.generateMonthlyPDF = async () => {
    const btn = $('btnMonthlyReport');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-inline"></span> 產生中（約 15 秒）…';
    try {
      const fname = await window.SMES_MONTHLY_REPORT.generate(
        cache.inventory, cache.rooms, cache.stats, cache.photos
      );
      toast(`✅ 已產生 ${fname}`, 'success');
    } catch (e) {
      toast('產生失敗: ' + e.message, 'error');
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  };

  // ============ Tab: 觸屏顯示器 ============
  let tsCache = null;

  async function loadTouchscreens() {
    if (tsCache) return tsCache;
    try {
      tsCache = await DB.listTouchscreens();
      return tsCache;
    } catch (e) {
      console.error('[touchscreens]', e);
      return [];
    }
  }

  // 幫一個教室找「主要班級主機」（優先班級教師機）
  function pickMainPcForRoom(classroomCode) {
    if (!classroomCode) return null;
    const invs = cache.inventory.filter(i =>
      i.classroom_code === classroomCode &&
      i.item_name && (i.item_name.includes('電腦') || i.item_name.includes('主機'))
    );
    if (!invs.length) return null;
    // 優先最新購置年份（代表目前主力）
    invs.sort((a, b) => (b.acquired_year || 0) - (a.acquired_year || 0));
    return invs[0];
  }

  async function renderTouchscreen() {
    const list = await loadTouchscreens();
    if (!list.length) {
      $('tsList').innerHTML = '<div class="empty">📦 尚無觸屏資料</div>';
      return;
    }

    // KPI 統計
    const total = list.length;
    const byUrg = {
      urgent: list.filter(t => t.urgency?.includes('★★★')).length,
      thisYr: list.filter(t => t.urgency?.includes('★★☆')).length,
      nextYr: list.filter(t => t.urgency?.includes('★☆☆')).length,
      ok:     list.filter(t => t.urgency?.includes('✓')).length,
    };
    $('touchscreenKPI').innerHTML = `
      <div class="kpi-card"><div class="label">總觸屏</div><div class="val">${total}</div><div class="sub">台</div></div>
      <div class="kpi-card danger"><div class="label">立即汰換</div><div class="val">${byUrg.urgent}</div><div class="sub">★★★</div></div>
      <div class="kpi-card accent"><div class="label">今年到期</div><div class="val">${byUrg.thisYr}</div><div class="sub">★★☆</div></div>
      <div class="kpi-card success"><div class="label">正常使用</div><div class="val">${byUrg.ok}</div><div class="sub">✓</div></div>
    `;

    // 接線相容性總覽
    let compatStat = { best: 0, ok: 0, warn: 0, danger: 0, noPc: 0 };
    list.forEach(ts => {
      const pc = pickMainPcForRoom(ts.classroom_code);
      if (!pc) { compatStat.noPc++; return; }
      const ports = window.SMES_TSPORTS.portsOf(pc.brand, pc.model, pc.acquired_year);
      const adv = window.SMES_TSPORTS.connectionAdvice(ports, ts);
      compatStat[adv.level]++;
    });
    $('tsCompatSummary').innerHTML = `
      <div class="ts-compat-summary">
        <div class="ts-compat-chip best">✅ 最佳連線 <b>${compatStat.best}</b> 台</div>
        <div class="ts-compat-chip ok">🔶 需轉接 <b>${compatStat.ok}</b> 台</div>
        <div class="ts-compat-chip warn">⚠️ 僅 VGA <b>${compatStat.warn}</b> 台</div>
        <div class="ts-compat-chip danger">❌ 不相容 <b>${compatStat.danger}</b> 台</div>
        <div class="ts-compat-chip muted">— 無對應主機 <b>${compatStat.noPc}</b> 台</div>
      </div>
    `;

    applyTsFilter();
  }

  function applyTsFilter() {
    if (!tsCache) return;
    const kw = ($('tsSearch')?.value || '').trim().toLowerCase();
    const urgFilter = $('tsUrgency')?.value || '';
    const brandFilter = $('tsBrand')?.value || '';

    let list = tsCache;
    if (urgFilter) list = list.filter(t => t.urgency?.includes(urgFilter));
    if (brandFilter) list = list.filter(t => t.brand === brandFilter);
    if (kw) list = list.filter(t =>
      (t.property_number || '').toLowerCase().includes(kw) ||
      (t.classroom_code || '').toLowerCase().includes(kw) ||
      (t.location_text || '').toLowerCase().includes(kw) ||
      (t.brand || '').toLowerCase().includes(kw) ||
      (t.model_code || '').toLowerCase().includes(kw) ||
      (t.model_description || '').toLowerCase().includes(kw)
    );

    const roomNameMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));

    $('tsList').innerHTML = list.map(ts => {
      const pc = pickMainPcForRoom(ts.classroom_code);
      let pcInfo = '';
      let adviceHTML = '';
      if (pc) {
        const ports = window.SMES_TSPORTS.portsOf(pc.brand, pc.model, pc.acquired_year);
        const adv = window.SMES_TSPORTS.connectionAdvice(ports, ts);
        pcInfo = `
          <div class="ts-pc">
            <span class="ts-pc-label">班級主機：</span>
            <b>${pc.model || '(未知型號)'}</b>
            <span class="ts-pc-year">${pc.acquired_year ? pc.acquired_year + ' 年' : ''}</span>
            <div class="ts-port-row">${window.SMES_TSPORTS.portsBadgeHTML(ports)}</div>
            ${ports.note ? `<div class="ts-port-note">${ports.note}</div>` : ''}
          </div>`;
        adviceHTML = `
          <div class="ts-advice ts-advice-${adv.level}">
            <div class="ts-advice-title">${adv.text}</div>
            <div class="ts-advice-detail">${adv.detail}</div>
          </div>`;
      } else if (ts.classroom_code) {
        pcInfo = `<div class="ts-pc ts-pc-none">⚠️ 找不到 ${ts.classroom_code} 的班級主機資料</div>`;
      } else {
        pcInfo = `<div class="ts-pc ts-pc-none">ℹ️ 未對應到教室（存放地點：${ts.location_text || '-'}）</div>`;
      }

      const urgClass = ts.urgency?.includes('★★★') ? 'danger'
                    : ts.urgency?.includes('★★☆') ? 'accent'
                    : ts.urgency?.includes('★☆☆') ? 'accent'
                    : 'success';

      return `
        <div class="ts-card">
          <div class="ts-card-head">
            <div class="ts-card-title">
              <b>${ts.classroom_code || '(未對應)'}</b>
              <span class="ts-room-name">${roomNameMap[ts.classroom_code] || ts.location_text || ''}</span>
            </div>
            <span class="badge badge-${urgClass}">${ts.urgency || ''}</span>
          </div>
          <div class="ts-card-body">
            <div class="ts-meta">
              <span class="ts-pn">${ts.property_number || '(登帳中)'}</span>
              <span class="ts-size">${ts.size_inch ? ts.size_inch + '吋' : ''}</span>
              <span class="ts-brand">${ts.brand || ''}${ts.model_code ? ' · ' + ts.model_code : ''}</span>
              <span class="ts-year">${ts.acquired_year}年 → ${ts.retire_year}年 (${ts.age_years ?? '登帳中'} 年)</span>
            </div>
            <div class="ts-ports">
              <span class="ts-ports-label">觸屏輸入：</span>
              ${ts.supports_hdmi ? '<span class="port-pill" style="background:#0a84ff;color:#fff;">HDMI</span>' : ''}
              ${ts.supports_dp ? '<span class="port-pill" style="background:#af52de;color:#fff;">DP</span>' : ''}
              ${ts.supports_vga ? '<span class="port-pill" style="background:#ff9500;color:#fff;">VGA</span>' : ''}
              ${ts.dms_compatible === '相容' ? '<span class="port-pill" style="background:#34c759;color:#fff;">DMS ✓</span>' : ''}
              ${ts.dms_compatible === '不相容' ? '<span class="port-pill" style="background:#ff3b30;color:#fff;">DMS ✗</span>' : ''}
            </div>
            ${pcInfo}
            ${adviceHTML}
          </div>
        </div>
      `;
    }).join('') + (list.length === 0 ? '<div class="empty">無符合條件</div>' : '');
  }

  ['tsSearch', 'tsUrgency', 'tsBrand'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', applyTsFilter);
      el.addEventListener('change', applyTsFilter);
    }
  });

  // Tab 切換時載入觸屏
  $('tabBar').querySelectorAll('button[data-tab="touchscreen"]').forEach(b => {
    b.addEventListener('click', () => renderTouchscreen());
  });

  // Excel 匯出
  window.exportTouchscreensExcel = async () => {
    const list = await loadTouchscreens();
    if (!list.length) { toast('無資料', 'error'); return; }
    const roomNameMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));
    const rows = list.map(ts => {
      const pc = pickMainPcForRoom(ts.classroom_code);
      const ports = pc ? window.SMES_TSPORTS.portsOf(pc.brand, pc.model, pc.acquired_year) : null;
      const adv = pc && ports ? window.SMES_TSPORTS.connectionAdvice(ports, ts) : null;
      return {
        '財產序號': ts.property_number || '(登帳中)',
        '教室代碼': ts.classroom_code || '',
        '教室名稱': roomNameMap[ts.classroom_code] || ts.location_text || '',
        '廠牌': ts.brand || '',
        'JECTOR型號': ts.model_code || '',
        '尺寸': ts.size_inch ? ts.size_inch + '吋' : '',
        '購置年': ts.acquired_year ? ts.acquired_year + '年' : '',
        '到期年': ts.retire_year ? ts.retire_year + '年' : '',
        '機齡': ts.age_years ?? '登帳中',
        '汰換急迫性': ts.urgency || '',
        '現值': ts.current_value || '',
        'DMS 相容': ts.dms_compatible || '',
        '觸屏輸入': [
          ts.supports_hdmi ? 'HDMI' : null,
          ts.supports_dp ? 'DP' : null,
          ts.supports_vga ? 'VGA' : null
        ].filter(Boolean).join('/'),
        '班級主機': pc ? (pc.model || '') : '(無對應主機)',
        '主機購置年': pc?.acquired_year || '',
        '主機輸出': ports ? [
          ports.hdmi ? 'HDMI' : null,
          ports.dp ? 'DP' : null,
          ports.vga ? 'VGA' : null,
          ports.dvi ? 'DVI' : null
        ].filter(Boolean).join('/') : '',
        '接線建議': adv ? adv.cable : '',
        '相容等級': adv ? ({ best: '✅最佳', ok: '🔶需轉接', warn: '⚠️僅VGA', danger: '❌不相容' })[adv.level] : '',
        '說明': adv ? adv.detail : '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 12 }, { wch: 14 },
      { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 22 },
      { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 28 }, { wch: 10 },
      { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 50 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '觸屏+接線建議');
    XLSX.writeFile(wb, `石門觸屏_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // ============ Tab: 無線 AP ============
  let apCache = null;

  async function loadWifiAps() {
    if (apCache) return apCache;
    try {
      apCache = await DB.listWifiAps();
      return apCache;
    } catch (e) {
      console.error('[wifi-aps]', e);
      return [];
    }
  }

  async function renderWifiAps() {
    const list = await loadWifiAps();
    if (!list.length) {
      $('apList').innerHTML = '<div class="empty">📭 尚無 AP 資料</div>';
      return;
    }

    // KPI
    const total = list.length;
    const inUse = list.filter(a => a.status === '使用中').length;
    const expired = list.filter(a => a.status === '保固到期').length;
    const unregistered = list.filter(a => !a.property_number && a.status === '使用中').length;
    const pending = list.filter(a => !a.classroom_code).length;

    $('wifiapKPI').innerHTML = `
      <div class="kpi-card"><div class="label">總 AP 數</div><div class="val">${total}</div><div class="sub">台</div></div>
      <div class="kpi-card success"><div class="label">使用中</div><div class="val">${inUse}</div><div class="sub">台</div></div>
      <div class="kpi-card danger"><div class="label">保固到期</div><div class="val">${expired}</div><div class="sub">台</div></div>
      <div class="kpi-card accent"><div class="label">待確認位置</div><div class="val">${pending}</div><div class="sub">台</div></div>
    `;

    // 警示
    const alerts = [];
    if (unregistered > 0) alerts.push(`⚠️ 有 <b>${unregistered}</b> 台新 AP 未登錄財產（R750 五擴案）— 請完成建帳`);
    if (pending > 0) alerts.push(`📍 有 <b>${pending}</b> 台 R610 位置待巡查確認`);
    if (expired > 0) alerts.push(`🔴 有 <b>${expired}</b> 台 AP 保固已到期（R610 × 29 + 舊 AP × 17）`);
    $('apAlerts').innerHTML = alerts.length
      ? `<div class="ap-alert-banner">${alerts.map(a => `<div class="ap-alert-item">${a}</div>`).join('')}</div>`
      : '';

    applyApFilter();
  }

  function applyApFilter() {
    if (!apCache) return;
    const kw = ($('apSearch')?.value || '').trim().toLowerCase();
    const statusFilter = $('apStatus')?.value || '';
    const brandFilter = $('apBrand')?.value || '';
    const floorFilter = $('apFloor')?.value || '';

    let list = apCache;
    if (statusFilter) list = list.filter(a => a.status === statusFilter);
    if (brandFilter) list = list.filter(a => a.brand_model === brandFilter);
    if (floorFilter) list = list.filter(a => a.floor === floorFilter);
    if (kw) list = list.filter(a =>
      (a.ap_code || '').toLowerCase().includes(kw) ||
      (a.property_number || '').toLowerCase().includes(kw) ||
      (a.classroom_code || '').toLowerCase().includes(kw) ||
      (a.location_name || '').toLowerCase().includes(kw) ||
      (a.mac_address || '').toLowerCase().includes(kw) ||
      (a.barcode || '').toLowerCase().includes(kw) ||
      (a.brand_model || '').toLowerCase().includes(kw)
    );

    const roomNameMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));

    if (list.length === 0) {
      $('apList').innerHTML = '<div class="empty">無符合條件</div>';
      return;
    }

    $('apList').innerHTML = list.map(a => {
      const statusClass = a.status === '保固到期' ? 'danger' : a.status === '使用中' ? 'success' : 'accent';
      const isUnregistered = !a.property_number && a.status === '使用中';
      const needsLocation = !a.classroom_code;

      const warrantyEnd = a.warranty_end ? new Date(a.warranty_end) : null;
      const now = new Date();
      const monthsLeft = warrantyEnd ? Math.round((warrantyEnd - now) / (1000 * 60 * 60 * 24 * 30)) : null;

      return `
        <div class="ap-card ${isUnregistered ? 'ap-unregistered' : ''} ${needsLocation ? 'ap-no-location' : ''}">
          <div class="ap-card-head">
            <div class="ap-card-title">
              <span class="ap-code">${a.ap_code}</span>
              ${a.full_property_number
                ? `<span class="ap-pn" title="完整財產號">#${a.full_property_number}</span>`
                : a.property_number
                  ? `<span class="ap-pn">#${a.property_number}</span>`
                  : '<span class="ap-no-pn">⚠️ 未登錄財產</span>'}
            </div>
            <span class="badge badge-${statusClass}">${a.status || '-'}</span>
          </div>
          <div class="ap-card-body">
            <div class="ap-meta">
              <span class="ap-brand">${a.brand_model || '-'}</span>
              <span class="ap-year">${a.acquired_year ? a.acquired_year + ' 年' : ''}</span>
            </div>
            <div class="ap-location">
              <span class="ap-loc-icon">📍</span>
              <b>${a.classroom_code || '(待確認)'}</b>
              <span class="ap-loc-name">${a.location_name || ''}</span>
              ${a.floor ? `<span class="ap-floor">${a.floor}</span>` : ''}
            </div>
            ${a.mac_address ? `<div class="ap-network">
              <span class="ap-net-label">MAC</span>
              <code>${a.mac_address}</code>
            </div>` : ''}
            ${a.barcode ? `<div class="ap-network">
              <span class="ap-net-label">條碼</span>
              <code>${a.barcode}</code>
            </div>` : ''}
            <div class="ap-network">
              <span class="ap-net-label">PoE</span>
              <span class="ap-poe">${a.poe_switch || '-'} ${a.poe_port ? '· Port ' + a.poe_port : ''}</span>
            </div>
            ${warrantyEnd ? `<div class="ap-warranty ${monthsLeft < 0 ? 'ap-exp' : monthsLeft < 6 ? 'ap-warn' : ''}">
              保固到 ${warrantyEnd.getFullYear() - 1911}/${String(warrantyEnd.getMonth()+1).padStart(2,'0')}/${String(warrantyEnd.getDate()).padStart(2,'0')}
              ${monthsLeft < 0 ? `(已過 ${-monthsLeft} 個月)` : `(剩 ${monthsLeft} 個月)`}
            </div>` : ''}
            <div class="ap-source">${a.source_plan || ''}</div>
            ${a.notes ? `<div class="ap-notes">📝 ${a.notes}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  ['apSearch', 'apStatus', 'apBrand', 'apFloor'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', applyApFilter);
      el.addEventListener('change', applyApFilter);
    }
  });

  $('tabBar').querySelectorAll('button[data-tab="wifiap"]').forEach(b => {
    b.addEventListener('click', () => renderWifiAps());
  });

  // Excel 匯出
  window.exportWifiApsExcel = async () => {
    const list = await loadWifiAps();
    if (!list.length) { toast('無資料', 'error'); return; }
    const roomNameMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));
    const rows = list.map(a => ({
      'AP 編號': a.ap_code,
      '財產序號(6位)': a.property_number || '(未登錄)',
      '完整財產號': a.full_property_number || '',
      '樓層': a.floor || '',
      '教室代碼': a.classroom_code || '',
      '教室名稱': roomNameMap[a.classroom_code] || a.location_name || '',
      '空間類型': a.space_type || '',
      '廠牌型號': a.brand_model || '',
      '建置年(民國)': a.acquired_year || '',
      'MAC/IP': a.mac_address || '',
      'PoE 交換器': a.poe_switch || '',
      'Port': a.poe_port || '',
      '保固起始': a.warranty_start || '',
      '保固到期': a.warranty_end || '',
      '狀態': a.status || '',
      '計畫來源': a.source_plan || '',
      '條碼': a.barcode || '',
      '備註': a.notes || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 10 }, { wch: 12 }, { wch: 6 }, { wch: 10 }, { wch: 20 },
      { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 18 },
      { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 22 },
      { wch: 16 }, { wch: 32 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '無線AP清冊');
    XLSX.writeFile(wb, `石門無線AP_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast('✅ 已匯出 ' + rows.length + ' 筆', 'success');
  };

  // ============ Tab: 盤點異動總覽報告 ============
  let reportCache = null;

  window.setReportRange = (preset) => {
    const now = new Date();
    let from, to;
    if (preset === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (preset === 'week') {
      const day = now.getDay() || 7;
      from = new Date(now); from.setDate(now.getDate() - day + 1); from.setHours(0,0,0,0);
      to = new Date(now); to.setHours(23,59,59,999);
    } else if (preset === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (preset === 'semester') {
      const m = now.getMonth();
      // 上學期 8-1 月 / 下學期 2-7 月
      if (m >= 7 || m <= 0) {
        from = new Date(m >= 7 ? now.getFullYear() : now.getFullYear() - 1, 7, 1);
        to = new Date(m >= 7 ? now.getFullYear() + 1 : now.getFullYear(), 0, 31, 23, 59, 59);
      } else {
        from = new Date(now.getFullYear(), 1, 1);
        to = new Date(now.getFullYear(), 6, 31, 23, 59, 59);
      }
    }
    if (from && to) {
      $('reportFrom').value = from.toISOString().slice(0, 10);
      $('reportTo').value = to.toISOString().slice(0, 10);
      renderReport();
    }
  };

  async function renderReport() {
    const fromStr = $('reportFrom').value;
    const toStr = $('reportTo').value;
    if (!fromStr || !toStr) { $('reportSections').innerHTML = '<div class="empty">請先選擇日期範圍</div>'; return; }

    const fromISO = new Date(fromStr + 'T00:00:00').toISOString();
    const toISO = new Date(toStr + 'T23:59:59').toISOString();

    $('reportSections').innerHTML = '<div class="loading-lg"></div>';

    try {
      const audits = await DB.listAuditBetween(fromISO, toISO, 2000);
      reportCache = { audits, from: fromISO, to: toISO };

      // 分類統計
      const stats = {
        created: audits.filter(a => a.field_changed === '_created'),
        transferred: audits.filter(a => a.field_changed === 'classroom_code'),
        brandChange: audits.filter(a => a.field_changed === 'brand'),
        modelChange: audits.filter(a => a.field_changed === 'model'),
        yearChange: audits.filter(a => a.field_changed === 'acquired_year'),
        serialChange: audits.filter(a => a.field_changed === 'serial_number'),
      };
      const uniqueItems = new Set(audits.map(a => a.inventory_id).filter(Boolean));
      const totalChanges = audits.length;

      // KPI
      $('reportKPI').innerHTML = `
        <div class="kpi-card"><div class="label">影響設備</div><div class="val">${uniqueItems.size}</div><div class="sub">台</div></div>
        <div class="kpi-card success"><div class="label">新增</div><div class="val">${stats.created.length}</div><div class="sub">台</div></div>
        <div class="kpi-card accent"><div class="label">搬移教室</div><div class="val">${stats.transferred.length}</div><div class="sub">次</div></div>
        <div class="kpi-card danger"><div class="label">總異動</div><div class="val">${totalChanges}</div><div class="sub">筆</div></div>
      `;

      // 各類別明細
      const section = (title, rows, color, renderRow) => rows.length ? `
        <details class="report-section" ${rows.length <= 20 ? 'open' : ''}>
          <summary style="border-left-color:${color};">${title} · ${rows.length} 筆</summary>
          <div class="report-list">${rows.map(renderRow).join('')}</div>
        </details>` : '';

      const roomNameMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));
      const roomDisp = code => code ? `${code}${roomNameMap[code] ? ' ' + roomNameMap[code] : ''}` : '(未設定)';
      const time = t => new Date(t).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

      $('reportSections').innerHTML = `
        ${section('🆕 新增財產', stats.created, 'var(--success)', r => `
          <div class="report-row">
            <span class="r-time">${time(r.changed_at)}</span>
            <span class="r-pn">#${r.property_number || r.inventory_id}</span>
            <span class="r-detail">${r.new_value || ''}</span>
            <span class="r-user">${r.changed_by_email || '—'}</span>
          </div>`)}

        ${section('🚛 搬移教室', stats.transferred, 'var(--primary)', r => `
          <div class="report-row">
            <span class="r-time">${time(r.changed_at)}</span>
            <span class="r-pn">#${r.property_number || r.inventory_id}</span>
            <span class="r-detail">${roomDisp(r.old_value)} → <b>${roomDisp(r.new_value)}</b></span>
            <span class="r-user">${r.changed_by_email || '—'}</span>
          </div>`)}

        ${section('🏷 廠牌更新', stats.brandChange, 'var(--accent)', r => `
          <div class="report-row">
            <span class="r-time">${time(r.changed_at)}</span>
            <span class="r-pn">#${r.property_number || r.inventory_id}</span>
            <span class="r-detail"><s>${r.old_value || '(空)'}</s> → <b>${r.new_value || '(空)'}</b></span>
            <span class="r-user">${r.changed_by_email || '—'}</span>
          </div>`)}

        ${section('💻 型號更新', stats.modelChange, 'var(--accent)', r => `
          <div class="report-row">
            <span class="r-time">${time(r.changed_at)}</span>
            <span class="r-pn">#${r.property_number || r.inventory_id}</span>
            <span class="r-detail"><s>${r.old_value || '(空)'}</s> → <b>${r.new_value || '(空)'}</b></span>
            <span class="r-user">${r.changed_by_email || '—'}</span>
          </div>`)}

        ${section('📅 購置年度更新', stats.yearChange, 'var(--warning)', r => `
          <div class="report-row">
            <span class="r-time">${time(r.changed_at)}</span>
            <span class="r-pn">#${r.property_number || r.inventory_id}</span>
            <span class="r-detail">民國 ${r.old_value || '?'} → <b>${r.new_value || '?'}</b> 年</span>
            <span class="r-user">${r.changed_by_email || '—'}</span>
          </div>`)}

        ${section('🔖 序號更新', stats.serialChange, 'var(--purple)', r => `
          <div class="report-row">
            <span class="r-time">${time(r.changed_at)}</span>
            <span class="r-pn">#${r.property_number || r.inventory_id}</span>
            <span class="r-detail">${(r.old_value || '(空)').slice(0, 20)} → <b>${(r.new_value || '(空)').slice(0, 20)}</b></span>
            <span class="r-user">${r.changed_by_email || '—'}</span>
          </div>`)}

        ${audits.length === 0 ? '<div class="empty">📭 此期間無異動紀錄</div>' : ''}
      `;
    } catch (e) {
      $('reportSections').innerHTML = `<div class="empty">❌ 載入失敗：${e.message}</div>`;
      console.error(e);
    }
  }

  window.exportReportExcel = () => {
    if (!reportCache?.audits?.length) { toast('請先載入期間報告', 'error'); return; }
    const roomNameMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));
    const fieldLabel = {
      brand: '廠牌', model: '型號', acquired_year: '購置民國年',
      serial_number: '序號', classroom_code: '教室',
      location_text: '位置', item_name: '品名',
      _created: '🆕 新增', _deleted: '🗑 刪除'
    };
    const rows = reportCache.audits.map(a => ({
      '異動時間': new Date(a.changed_at).toLocaleString('zh-TW', { hour12: false }),
      '財產編號': a.property_number || `id:${a.inventory_id}`,
      '異動類型': fieldLabel[a.field_changed] || a.field_changed,
      '舊值': a.old_value || '',
      '新值': a.new_value || '',
      '目前廠牌': a.current_brand || '',
      '目前型號': a.current_model || '',
      '目前教室': a.current_classroom ? `${a.current_classroom}${roomNameMap[a.current_classroom] ? ' ' + roomNameMap[a.current_classroom] : ''}` : '',
      '操作者': a.changed_by_email || '',
      '來源': a.source,
      '備註': a.notes || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 18 },
      { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 28 }, { wch: 16 }, { wch: 36 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '異動明細');
    const fname = `石門盤點異動_${$('reportFrom').value}_${$('reportTo').value}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast(`✅ 已匯出 ${rows.length} 筆`, 'success');
  };

  window.exportReportPDF = async () => {
    if (!reportCache?.audits?.length) { toast('請先載入期間報告', 'error'); return; }
    const btn = event.target;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-inline"></span> 產生中…';
    try {
      // 沿用 monthly-report.js 的 jsPDF 能力
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      await generateAuditReportPDF(reportCache);
      toast('✅ PDF 已下載', 'success');
    } catch (e) {
      toast('PDF 產生失敗: ' + e.message, 'error');
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  };

  async function generateAuditReportPDF(data) {
    const DPI = 300;
    const MM = DPI / 25.4;

    // 用 Canvas 畫，避免中文亂碼
    const canvas = document.createElement('canvas');
    canvas.width = 210 * MM;
    canvas.height = 297 * MM;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    const FONT = '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
    const mm = n => Math.round(n * MM);

    // 標題
    ctx.fillStyle = '#0a84ff';
    ctx.font = `bold ${mm(7)}px ${FONT}`;
    ctx.fillText('📋 石門國小 財產盤點異動報告', mm(15), mm(20));

    ctx.fillStyle = '#666';
    ctx.font = `${mm(4)}px ${FONT}`;
    const fromD = new Date(data.from).toLocaleDateString('zh-TW');
    const toD = new Date(data.to).toLocaleDateString('zh-TW');
    ctx.fillText(`期間：${fromD} — ${toD}`, mm(15), mm(28));
    ctx.fillText(`產出時間：${new Date().toLocaleString('zh-TW')}`, mm(15), mm(33));

    // 摘要
    const stats = {
      created: data.audits.filter(a => a.field_changed === '_created').length,
      transferred: data.audits.filter(a => a.field_changed === 'classroom_code').length,
      brandChange: data.audits.filter(a => a.field_changed === 'brand').length,
      modelChange: data.audits.filter(a => a.field_changed === 'model').length,
    };
    const uniqueItems = new Set(data.audits.map(a => a.inventory_id).filter(Boolean)).size;

    ctx.fillStyle = '#000';
    ctx.font = `bold ${mm(5)}px ${FONT}`;
    ctx.fillText('📊 摘要統計', mm(15), mm(45));

    const kpis = [
      { label: '影響設備', val: uniqueItems, unit: '台', color: '#0a84ff' },
      { label: '新增財產', val: stats.created, unit: '台', color: '#34c759' },
      { label: '搬移教室', val: stats.transferred, unit: '次', color: '#ff9500' },
      { label: '型號更新', val: stats.brandChange + stats.modelChange, unit: '筆', color: '#ff3b30' },
    ];
    const kpiY = mm(55);
    const kpiW = mm(42);
    kpis.forEach((k, i) => {
      const x = mm(15) + i * (kpiW + mm(3));
      ctx.fillStyle = '#f2f2f7';
      ctx.fillRect(x, kpiY, kpiW, mm(22));
      ctx.fillStyle = k.color;
      ctx.fillRect(x, kpiY, kpiW, mm(2));
      ctx.fillStyle = '#666';
      ctx.font = `${mm(3.2)}px ${FONT}`;
      ctx.fillText(k.label, x + mm(4), kpiY + mm(9));
      ctx.fillStyle = k.color;
      ctx.font = `bold ${mm(9)}px ${FONT}`;
      ctx.fillText(String(k.val), x + mm(4), kpiY + mm(18));
      ctx.fillStyle = '#999';
      ctx.font = `${mm(3)}px ${FONT}`;
      ctx.fillText(k.unit, x + mm(4) + ctx.measureText(String(k.val)).width + mm(2), kpiY + mm(18));
    });

    // 明細列表（最多 30 筆）
    ctx.fillStyle = '#000';
    ctx.font = `bold ${mm(5)}px ${FONT}`;
    ctx.fillText('📝 異動明細（最多顯示 30 筆，完整資料請匯出 Excel）', mm(15), mm(92));

    const fieldLabel = {
      brand: '廠牌', model: '型號', acquired_year: '購置年',
      serial_number: '序號', classroom_code: '教室',
      _created: '🆕 新增', _deleted: '🗑 刪除'
    };

    let y = mm(100);
    data.audits.slice(0, 30).forEach((a, idx) => {
      if (y > mm(285)) return;
      const time = new Date(a.changed_at).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
      const label = fieldLabel[a.field_changed] || a.field_changed;

      ctx.fillStyle = idx % 2 === 0 ? '#fff' : '#f9f9fb';
      ctx.fillRect(mm(15), y - mm(3.5), mm(180), mm(6.5));

      ctx.fillStyle = '#999';
      ctx.font = `${mm(2.8)}px ${FONT}`;
      ctx.fillText(time, mm(17), y);

      ctx.fillStyle = '#000';
      ctx.font = `bold ${mm(3)}px ${FONT}`;
      ctx.fillText(`#${a.property_number || a.inventory_id}`, mm(35), y);

      ctx.fillStyle = '#0a84ff';
      ctx.fillText(label, mm(65), y);

      ctx.fillStyle = '#444';
      ctx.font = `${mm(2.8)}px ${FONT}`;
      const detail = a.field_changed === '_created'
        ? (a.new_value || '').slice(0, 40)
        : `${(a.old_value || '空').slice(0, 18)} → ${(a.new_value || '空').slice(0, 18)}`;
      ctx.fillText(detail, mm(85), y);

      ctx.fillStyle = '#999';
      ctx.font = `${mm(2.5)}px ${FONT}`;
      ctx.fillText((a.changed_by_email || '').slice(0, 18), mm(155), y);

      y += mm(6.5);
    });

    if (data.audits.length > 30) {
      ctx.fillStyle = '#999';
      ctx.font = `italic ${mm(3)}px ${FONT}`;
      ctx.fillText(`... 另外 ${data.audits.length - 30} 筆請參考 Excel 明細`, mm(17), y + mm(3));
    }

    // 頁尾
    ctx.fillStyle = '#999';
    ctx.font = `${mm(2.8)}px ${FONT}`;
    ctx.fillText('石門國民小學 · 資訊組 · 財產盤點系統', mm(15), mm(290));

    // 轉 PDF
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
    const fname = `石門盤點報告_${$('reportFrom').value}_${$('reportTo').value}.pdf`;
    pdf.save(fname);
  }

  // Tab 切換時載入
  $('tabBar').querySelectorAll('button[data-tab="report"]').forEach(b => {
    b.addEventListener('click', () => {
      if (!$('reportFrom').value) setReportRange('month');
      else renderReport();
    });
  });
  ['reportFrom', 'reportTo'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', renderReport);
  });

  // ============ Start ============
  loadAll();
})();
