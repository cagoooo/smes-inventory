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
      <div class="list-item">
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
        </div>
      </div>
    `).join('') + (list.length > 300 ? `<div style="text-align:center;padding:10px;color:var(--text-muted);font-size:12px;">僅顯示前 300 筆 (共 ${list.length})</div>` : '');
  }

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

  // ============ Start ============
  loadAll();
})();
