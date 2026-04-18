// 管理後台：統計 / 照片紀錄 / 教室狀態 / 財產 / Excel 匯入
(function() {
  const DB = window.SMES_DB;

  let cache = {
    rooms: [],
    photos: [],
    inventory: [],
    stats: []
  };

  let importState = {
    workbook: null,
    sheetName: null,
    rows: [],
    headers: [],
    mapping: {} // fieldName -> columnHeader
  };

  function $(id) { return document.getElementById(id); }
  function toast(msg, type = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 3000);
  }

  function yearBadge(y) {
    if (!y) return '';
    const cur = 115;
    const age = cur - y;
    if (age >= 8) return `<span class="badge badge-old">${y}年</span>`;
    if (age >= 5) return `<span class="badge badge-mid">${y}年</span>`;
    return `<span class="badge badge-new">${y}年</span>`;
  }

  // ============ 分頁切換 ============
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.borderBottomColor = 'transparent';
        b.style.color = 'var(--text-soft)';
      });
      btn.classList.add('active');
      btn.style.borderBottomColor = 'var(--primary)';
      btn.style.color = 'var(--primary-dark)';
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      $('tab-' + btn.dataset.tab).style.display = 'block';
    });
  });

  // ============ 資料載入 ============
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

      fillRoomSelect('photoRoomFilter', rooms);
      fillRoomSelect('invRoomFilter', rooms);
      fillYearSelect('invYearFilter', inventory);

      renderPhotos();
      renderRoomsTable();
      renderInventory();
    } catch (e) {
      toast('載入失敗: ' + e.message, 'error');
      console.error(e);
    }
  }

  function fillRoomSelect(id, rooms) {
    const sel = $(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="">所有教室</option>' +
      rooms.map(r => `<option value="${r.code}">${r.code} ${r.name}</option>`).join('');
    sel.value = cur;
  }
  function fillYearSelect(id, inv) {
    const years = [...new Set(inv.map(x => x.acquired_year).filter(y => y))].sort((a,b) => b-a);
    const sel = $(id);
    sel.innerHTML = '<option value="">所有年份</option>' +
      years.map(y => `<option value="${y}">${y} 年</option>`).join('');
  }

  // ============ Tab 1: 照片紀錄 ============
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

    const tbody = $('photoTable').querySelector('tbody');
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">無資料</td></tr>';
      return;
    }

    const roomMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));
    const invMap = Object.fromEntries(cache.inventory.map(i => [i.id, i]));

    tbody.innerHTML = list.map(p => {
      const match = p.matched_inventory_id ? invMap[p.matched_inventory_id] : null;
      return `<tr>
        <td>${p.photo_url ? `<img src="${p.photo_url}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;" loading="lazy">` : ''}</td>
        <td>${p.classroom_code}<br><small style="color:var(--text-soft)">${roomMap[p.classroom_code] || ''}</small></td>
        <td>${p.photo_type || '-'}</td>
        <td>${p.detected_brand || ''}<br><small>${p.detected_model || ''}</small></td>
        <td style="font-family:monospace">${p.detected_property_number || '-'}</td>
        <td>${yearBadge(p.detected_year) || '-'}</td>
        <td>${match ? `<span style="color:var(--success)">✓ ${match.property_number || ''}</span>` : '<span style="color:var(--danger)">✗</span>'}</td>
        <td style="white-space:nowrap;font-size:11px;color:var(--text-soft);">${new Date(p.created_at).toLocaleString('zh-TW',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
        <td><button class="btn btn-ghost" style="padding:4px 8px;font-size:12px;" onclick="deletePhotoRow(${p.id}, '${p.photo_path||''}')">🗑</button></td>
      </tr>`;
    }).join('');
  }

  window.deletePhotoRow = async (id, path) => {
    if (!confirm('確認刪除此筆紀錄？')) return;
    try {
      await DB.deletePhoto(id);
      if (path) DB.deletePhotoFile(path);
      cache.photos = cache.photos.filter(p => p.id !== id);
      $('statPhotos').textContent = cache.photos.length;
      renderPhotos();
      toast('已刪除', 'success');
    } catch (e) {
      toast('刪除失敗', 'error');
    }
  };

  window.exportPhotosExcel = () => {
    if (!cache.photos.length) { toast('無資料可匯出', 'error'); return; }
    const roomMap = Object.fromEntries(cache.rooms.map(r => [r.code, r.name]));
    const data = cache.photos.map(p => ({
      '教室代碼': p.classroom_code,
      '教室名稱': roomMap[p.classroom_code] || '',
      '照片類型': p.photo_type || '',
      '廠牌': p.detected_brand || '',
      '型號': p.detected_model || '',
      '財產編號': p.detected_property_number || '',
      '取得年(民國)': p.detected_year || '',
      '序號': p.detected_serial || '',
      '信心度': p.confidence || '',
      '已比對財產 ID': p.matched_inventory_id || '',
      '備註': p.notes || '',
      '拍照時間': new Date(p.created_at).toLocaleString('zh-TW'),
      '照片網址': p.photo_url || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '拍照盤點紀錄');
    XLSX.writeFile(wb, `石門盤點紀錄_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  $('photoSearch').addEventListener('input', renderPhotos);
  $('photoRoomFilter').addEventListener('change', renderPhotos);

  // ============ Tab 2: 教室狀態 ============
  function renderRoomsTable() {
    const catLabel = { class:'班級', subject:'專科', admin:'行政', care:'課照', kindergarten:'幼兒園', other:'其他' };
    const tbody = $('roomsTable').querySelector('tbody');
    const s = cache.stats.length ? cache.stats : cache.rooms;
    if (s.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="empty">無資料</td></tr>'; return; }
    const statsMap = Object.fromEntries(cache.stats.map(x => [x.code, x]));

    tbody.innerHTML = cache.rooms.map(r => {
      const st = statsMap[r.code] || {};
      const photoCount = st.photo_count || 0;
      const invCount = st.inventory_count || 0;
      const oldest = st.oldest_detected_year || st.oldest_inventory_year;
      return `<tr>
        <td>${r.floor === 0 ? '幼' : r.floor + 'F'}</td>
        <td style="font-family:monospace;font-weight:600;">${r.code}</td>
        <td>${r.name}</td>
        <td><span class="badge" style="background:var(--primary-light);color:var(--primary-dark)">${catLabel[r.category] || r.category}</span></td>
        <td style="color:${photoCount>0?'var(--success)':'var(--text-muted)'};font-weight:600;">${photoCount}</td>
        <td>${invCount}</td>
        <td>${oldest ? yearBadge(oldest) : '-'}</td>
        <td><a href="index.html" onclick="localStorage.setItem('smes_current_room','${r.code}')" class="btn btn-ghost" style="padding:4px 10px;font-size:12px;text-decoration:none;">📷 去拍</a></td>
      </tr>`;
    }).join('');
  }

  // ============ Tab 3: 財產 ============
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

    const tbody = $('invTable').querySelector('tbody');
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">${cache.inventory.length===0 ? '尚未匯入，請到「匯入 Excel」上傳' : '無符合條件資料'}</td></tr>`;
      return;
    }

    // 每筆財產是否已被拍照紀錄對應
    const matchedIds = new Set(cache.photos.filter(p => p.matched_inventory_id).map(p => p.matched_inventory_id));

    tbody.innerHTML = list.slice(0, 500).map(i => `
      <tr>
        <td style="font-family:monospace;">${i.property_number || '-'}</td>
        <td>${i.item_name || '-'}</td>
        <td>${i.brand || ''} ${i.model || ''}</td>
        <td>${yearBadge(i.acquired_year) || '-'}</td>
        <td>${i.classroom_code || ''} ${i.location_text ? '('+i.location_text+')' : ''}</td>
        <td>${i.status || '在用'}</td>
        <td>${matchedIds.has(i.id) ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--text-muted)">-</span>'}</td>
      </tr>
    `).join('') + (list.length > 500 ? `<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">（僅顯示前 500 筆，共 ${list.length} 筆）</td></tr>` : '');
  }

  $('invSearch').addEventListener('input', renderInventory);
  $('invRoomFilter').addEventListener('change', renderInventory);
  $('invYearFilter').addEventListener('change', renderInventory);

  // ============ Tab 4: 匯入 Excel ============
  const FIELD_DEFS = [
    { key:'property_number', label:'財產編號', hints:['財產編號','編號','財編','財產','property','code','資產編號'] },
    { key:'item_name', label:'品名', hints:['品名','名稱','物品','item','name','產品'] },
    { key:'brand', label:'廠牌', hints:['廠牌','品牌','brand','廠商','製造'] },
    { key:'model', label:'型號', hints:['型號','model','規格型號'] },
    { key:'specification', label:'規格', hints:['規格','spec','配備'] },
    { key:'acquired_year', label:'取得年份 (民國)', hints:['取得年','年份','年度','year','取得','購置年','取得日期','購置日期','使用日期'] },
    { key:'unit_price', label:'單價', hints:['單價','金額','價格','price','price','原值'] },
    { key:'classroom_code', label:'教室代碼', hints:['教室代碼','室號','room','教室','房號','室代碼'] },
    { key:'location_text', label:'放置位置', hints:['放置地點','放置位置','位置','使用地點','使用處所','location','使用單位','保管人'] },
    { key:'status', label:'狀態', hints:['狀態','status','使用狀態'] }
  ];

  function normalize(s) { return String(s || '').toLowerCase().replace(/\s/g, ''); }

  function autoMapFields(headers) {
    const map = {};
    for (const field of FIELD_DEFS) {
      for (const hdr of headers) {
        const h = normalize(hdr);
        if (field.hints.some(hint => h.includes(normalize(hint)))) {
          map[field.key] = hdr;
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
    } catch (err) {
      toast('讀取失敗: ' + err.message, 'error');
    }
  });

  function renderSheetPicker() {
    const names = importState.workbook.SheetNames;
    if (names.length === 1) { $('sheetPicker').innerHTML = ''; return; }
    $('sheetPicker').innerHTML = '<div class="field"><label>選擇工作表</label><select id="sheetSelect">' +
      names.map(n => `<option value="${n}">${n}</option>`).join('') + '</select></div>';
    $('sheetSelect').addEventListener('change', (e) => {
      importState.sheetName = e.target.value;
      loadSheet();
    });
  }

  function loadSheet() {
    const ws = importState.workbook.Sheets[importState.sheetName];
    // 嘗試找到真正的 header row（標題列常不在第一列）
    let rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    // 找出欄位最多的那一列當表頭
    let bestIdx = 0, bestLen = 0;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const nonEmpty = rows[i].filter(x => String(x||'').trim()).length;
      if (nonEmpty > bestLen) { bestLen = nonEmpty; bestIdx = i; }
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
    $('previewStats').innerHTML = `📊 偵測到 <b>${importState.rows.length}</b> 筆資料，<b>${headers.length}</b> 欄。` +
      (importState.workbook.SheetNames.length > 1 ? ` 工作表：${importState.sheetName}` : '');
  }

  function renderFieldMap() {
    $('fieldMap').innerHTML = FIELD_DEFS.map(f => `
      <div class="field" data-field="${f.key}">
        <label>${f.label}${importState.mapping[f.key] ? ' <span style="color:var(--success)">✓ 已自動對應</span>' : ''}</label>
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
    // 民國年份可能是 "114"、"114.08.01"、"1140801"、"2025"、"2025/08/01"、日期物件
    if (val instanceof Date) {
      return val.getFullYear() - 1911;
    }
    const s = String(val).trim();
    const m = s.match(/(\d{2,4})/);
    if (!m) return null;
    let n = parseInt(m[1]);
    if (n >= 1900) n = n - 1911; // 西元轉民國
    if (n >= 60 && n <= 130) return n; // 合理的民國年
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
        if (f.key === 'acquired_year') {
          v = parseYear(v);
        } else if (f.key === 'unit_price') {
          const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
          v = isNaN(n) ? null : n;
        } else {
          v = String(v).trim();
        }
        if (v !== null && v !== undefined && v !== '') item[f.key] = v;
      }
      // 嘗試從位置文字推論 classroom_code
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
    const cols = ['property_number','item_name','brand','model','acquired_year','classroom_code','location_text','status'];
    const labelMap = Object.fromEntries(FIELD_DEFS.map(f => [f.key, f.label]));
    $('previewTable').innerHTML =
      '<thead><tr>' + cols.map(c => `<th>${labelMap[c]||c}</th>`).join('') + '</tr></thead>' +
      '<tbody>' + built.map(b => `<tr>${cols.map(c => `<td>${b[c] ?? '<span style="color:var(--text-muted)">-</span>'}</td>`).join('')}</tr>`).join('') + '</tbody>';
  }

  async function doImport(clearFirst) {
    if (!importState.rows.length) { toast('尚未載入資料', 'error'); return; }
    try {
      if (clearFirst) {
        await DB.clearInventory();
        toast('已清空舊資料', '');
      }
      const items = buildRows();
      // 驗證 classroom_code 是否存在
      const validCodes = new Set(cache.rooms.map(r => r.code));
      let invalidCodes = 0;
      items.forEach(it => {
        if (it.classroom_code && !validCodes.has(it.classroom_code)) {
          invalidCodes++;
          it.location_text = (it.location_text || '') + ` [原代碼: ${it.classroom_code}]`;
          delete it.classroom_code;
        }
      });

      // 分批 500 筆
      const batchSize = 200;
      let imported = 0;
      for (let i = 0; i < items.length; i += batchSize) {
        const slice = items.slice(i, i + batchSize);
        await DB.insertInventoryBatch(slice);
        imported += slice.length;
        toast(`已匯入 ${imported} / ${items.length} 筆...`, '');
      }
      toast(`✅ 完成匯入 ${imported} 筆${invalidCodes ? '（有 '+invalidCodes+' 筆教室代碼無效已放備註）' : ''}`, 'success');
      $('excelFile').value = '';
      $('excelPreview').style.display = 'none';
      importState = { workbook:null, sheetName:null, rows:[], headers:[], mapping:{} };
      loadAll();
    } catch (e) {
      toast('匯入失敗: ' + e.message, 'error');
      console.error(e);
    }
  }

  window.confirmImport = () => doImport(false);
  window.clearAndImport = () => {
    if (!confirm('⚠️ 會先刪除 inventory_items 表中所有資料，再匯入新資料。確認？')) return;
    doImport(true);
  };
  window.cancelImport = () => {
    $('excelFile').value = '';
    $('excelPreview').style.display = 'none';
    importState = { workbook:null, sheetName:null, rows:[], headers:[], mapping:{} };
  };

  // ============ 啟動 ============
  loadAll();
})();
