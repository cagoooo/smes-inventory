// 主程式：首頁拍照上傳流程
(function() {
  const STORAGE_CUR_ROOM = 'smes_current_room';
  const STORAGE_DEVICE = 'smes_device_label';

  let state = {
    rooms: [],
    currentRoom: null,
    currentFloor: null,
    currentFile: null,
    lastDetection: null
  };

  // ============ Utilities ============
  function $(id) { return document.getElementById(id); }
  function toast(msg, type = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 3000);
  }
  function getDeviceLabel() {
    let l = localStorage.getItem(STORAGE_DEVICE);
    if (!l) {
      l = 'iPhone-' + Math.random().toString(36).slice(2, 7);
      localStorage.setItem(STORAGE_DEVICE, l);
    }
    return l;
  }

  function yearBadge(rocYear) {
    if (!rocYear) return '';
    const curRoc = 115;
    const age = curRoc - rocYear;
    if (age >= 8) return `<span class="badge badge-old">${rocYear}年 · 建議汰換</span>`;
    if (age >= 5) return `<span class="badge badge-mid">${rocYear}年 · 關注</span>`;
    return `<span class="badge badge-new">${rocYear}年</span>`;
  }

  // ============ 教室清單載入 ============
  async function loadRooms() {
    state.rooms = await window.SMES_DB.listClassrooms();
    renderFloors();
    renderRoomGrid();

    // 載入上次選擇的教室
    const savedCode = localStorage.getItem(STORAGE_CUR_ROOM);
    if (savedCode) {
      const r = state.rooms.find(x => x.code === savedCode);
      if (r) selectRoom(r);
    }
  }

  function renderFloors() {
    const floors = [...new Set(state.rooms.map(r => r.floor))].sort();
    const labels = { 0: '幼兒園', 1: '一樓', 2: '二樓', 3: '三樓' };
    $('floorTabs').innerHTML = '<button class="active" data-floor="">全部</button>' +
      floors.map(f => `<button data-floor="${f}">${labels[f] || f+'樓'}</button>`).join('');
    $('floorTabs').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        $('floorTabs').querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.currentFloor = b.dataset.floor === '' ? null : parseInt(b.dataset.floor);
        renderRoomGrid();
      });
    });
  }

  function renderRoomGrid() {
    const kw = $('roomSearch').value.trim().toLowerCase();
    const cat = $('catFilter').value;

    const filtered = state.rooms.filter(r => {
      if (state.currentFloor !== null && r.floor !== state.currentFloor) return false;
      if (cat && r.category !== cat) return false;
      if (kw && !r.code.toLowerCase().includes(kw) && !r.name.toLowerCase().includes(kw)) return false;
      return true;
    });

    if (filtered.length === 0) {
      $('roomGrid').innerHTML = '<div class="empty">無符合條件的教室</div>';
      return;
    }

    $('roomGrid').innerHTML = filtered.map(r => `
      <button class="room-btn cat-${r.category}" data-code="${r.code}">
        <div class="code">${r.code}</div>
        <div class="name">${r.name}</div>
      </button>
    `).join('');

    $('roomGrid').querySelectorAll('.room-btn').forEach(b => {
      b.addEventListener('click', () => {
        const r = state.rooms.find(x => x.code === b.dataset.code);
        selectRoom(r);
      });
    });
  }

  // ============ 選擇教室 ============
  async function selectRoom(r) {
    state.currentRoom = r;
    localStorage.setItem(STORAGE_CUR_ROOM, r.code);

    $('roomSelectCard').style.display = 'none';
    $('currentRoomPanel').style.display = 'block';
    $('curRoomName').textContent = r.name;
    $('curRoomCode').textContent = r.code + ' · ' + (r.floor === 0 ? '幼兒園' : r.floor + '樓');

    // 隱藏預覽
    $('previewArea').classList.remove('active');
    state.currentFile = null;

    await loadRoomRecords();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadRoomRecords() {
    const code = state.currentRoom.code;
    const [photos, inventory] = await Promise.all([
      window.SMES_DB.listPhotosByRoom(code, 50),
      window.SMES_DB.listInventoryByRoom(code)
    ]);

    $('curRoomStats').innerHTML =
      `📷 拍照紀錄 ${photos.length} · 📦 財產 ${inventory.length}`;
    $('roomRecordCount').textContent = `(${photos.length})`;

    if (photos.length === 0) {
      $('roomRecords').innerHTML = '<div class="empty">尚無紀錄，點上方「拍攝」新增</div>';
      return;
    }

    $('roomRecords').innerHTML = photos.map(p => `
      <div class="record-item" data-id="${p.id}">
        ${p.photo_url ? `<img src="${p.photo_url}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="info">
          <div class="model">${p.detected_brand || ''} ${p.detected_model || '(未填型號)'}</div>
          <div class="meta">
            ${p.detected_property_number ? `<span class="tag">🏷 ${p.detected_property_number}</span>` : ''}
            ${p.photo_type ? `<span class="tag">${p.photo_type}</span>` : ''}
            ${yearBadge(p.detected_year)}
            ${p.matched_inventory_id ? '<span class="tag" style="background:var(--success-soft);color:#146c3a;">✓ 已比對</span>' : ''}
          </div>
        </div>
        <button class="del" title="刪除" onclick="deletePhoto(${p.id}, '${p.photo_path || ''}')">🗑</button>
      </div>
    `).join('');
  }

  async function deletePhoto(id, path) {
    if (!confirm('確認刪除這筆紀錄？')) return;
    try {
      await window.SMES_DB.deletePhoto(id);
      if (path) window.SMES_DB.deletePhotoFile(path);
      toast('已刪除', 'success');
      loadRoomRecords();
    } catch (e) {
      toast('刪除失敗: ' + e.message, 'error');
    }
  }
  window.deletePhoto = deletePhoto;

  function changeRoom() {
    $('currentRoomPanel').style.display = 'none';
    $('roomSelectCard').style.display = 'block';
    $('previewArea').classList.remove('active');
    state.currentFile = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.changeRoom = changeRoom;

  // ============ 拍照 ============
  $('photoInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    state.currentFile = f;
    state.lastDetection = null;
    $('previewImg').src = URL.createObjectURL(f);
    $('previewArea').classList.add('active');
    $('detectArea').style.display = 'none';
    $('matchArea').innerHTML = '';
    setTimeout(() => $('previewArea').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  });

  document.addEventListener('click', (e) => {
    if (e.target.id === 'btnRetake') {
      $('photoInput').value = '';
      $('photoInput').click();
    }
  });

  // ============ Gemini 辨識 ============
  $('btnRecognize').addEventListener('click', async () => {
    if (!state.currentFile) return;

    if (!window.SMES_GEMINI.hasKey()) {
      $('apiKeyInput').value = '';
      $('apiKeyModal').classList.add('show');
      return;
    }

    const btn = $('btnRecognize');
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> AI 辨識中…';

    try {
      const { parsed, raw, compressed } = await window.SMES_GEMINI.recognize(state.currentFile);
      state.currentFile = compressed; // 存壓縮後
      state.lastDetection = { parsed, raw };
      fillDetectFields(parsed);
      await showMatchSuggestions(parsed);
      $('detectArea').style.display = 'block';
      toast('辨識完成 ✓', 'success');
    } catch (e) {
      toast('辨識失敗: ' + e.message, 'error');
      console.error(e);
      // 失敗也顯示表單讓使用者手動填
      $('detectArea').style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  });

  function fillDetectFields(p) {
    const set = (id, val) => {
      const ctl = $(id).querySelector('input,select,textarea');
      ctl.value = val ?? '';
      $(id).classList.toggle('auto-detected', val != null && val !== '');
    };
    set('f_photo_type', p.photo_type || '主機');
    set('f_brand', p.brand);
    set('f_model', p.model);
    set('f_property_number', p.property_number);
    set('f_roc_year', p.roc_year);
    set('f_serial_number', p.serial_number);
    set('f_notes', p.notes);
  }

  async function showMatchSuggestions(p) {
    const matchArea = $('matchArea');
    matchArea.innerHTML = '';
    if (!p) return;

    let candidates = [];
    // 優先財產編號精準比對
    if (p.property_number) {
      try {
        const byPn = await window.SMES_DB.searchInventory(p.property_number);
        candidates = byPn.slice(0, 3);
      } catch (e) {}
    }
    // 退而求其次用型號
    if (candidates.length === 0 && p.model) {
      try {
        const byModel = await window.SMES_DB.searchInventory(p.model);
        candidates = byModel.slice(0, 3);
      } catch (e) {}
    }

    if (candidates.length === 0) {
      matchArea.innerHTML = `<div class="match-result none">
        🔍 財產表中找不到對應項目 — 可能是新購或尚未匯入 Excel
      </div>`;
      return;
    }

    matchArea.innerHTML = `<div class="match-result good">
      🎯 找到 ${candidates.length} 筆可能對應的財產紀錄，點擊選取：
    </div>` + candidates.map(c => `
      <div class="match-suggest" data-id="${c.id}">
        <div class="title">${c.property_number || '(無編號)'} · ${c.item_name || ''}</div>
        <div class="desc">${c.brand || ''} ${c.model || ''} ${c.acquired_year ? '· 取得 '+c.acquired_year : ''} ${c.location_text ? '· '+c.location_text : ''}</div>
      </div>
    `).join('');

    matchArea.querySelectorAll('.match-suggest').forEach(el => {
      el.addEventListener('click', () => {
        matchArea.querySelectorAll('.match-suggest').forEach(x => x.style.background = '');
        el.style.background = 'var(--primary-light)';
        el.dataset.selected = '1';
        matchArea.querySelectorAll('.match-suggest').forEach(x => {
          if (x !== el) x.dataset.selected = '0';
        });
      });
    });
  }

  // ============ 儲存 ============
  $('btnSave').addEventListener('click', async () => {
    if (!state.currentFile || !state.currentRoom) return;

    const btn = $('btnSave');
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> 儲存中…';

    try {
      const room = state.currentRoom;
      const getVal = id => $(id).querySelector('input,select,textarea').value.trim() || null;

      // 1. 上傳照片
      const ts = new Date();
      const ymd = ts.toISOString().slice(0,10);
      const fileName = `${ymd}/${room.code}_${Date.now()}_${Math.random().toString(36).slice(2,7)}.jpg`;
      const photoUrl = await window.SMES_DB.uploadPhoto(state.currentFile, fileName);

      // 2. 選到的比對
      const selected = document.querySelector('#matchArea .match-suggest[data-selected="1"]');
      const matched_inventory_id = selected ? parseInt(selected.dataset.id) : null;

      // 3. 插入紀錄
      const rocYearStr = getVal('f_roc_year');
      const rocYear = rocYearStr ? parseInt(rocYearStr) : null;

      const record = {
        classroom_code: room.code,
        photo_path: fileName,
        photo_url: photoUrl,
        photo_type: getVal('f_photo_type'),
        detected_brand: getVal('f_brand'),
        detected_model: getVal('f_model'),
        detected_property_number: getVal('f_property_number'),
        detected_year: rocYear,
        detected_serial: getVal('f_serial_number'),
        gemini_raw: state.lastDetection ? state.lastDetection.parsed : null,
        confidence: state.lastDetection?.parsed?.confidence || null,
        matched_inventory_id,
        match_method: matched_inventory_id ? 'manual' : null,
        notes: getVal('f_notes'),
        device_label: getDeviceLabel()
      };

      await window.SMES_DB.insertPhoto(record);

      toast('儲存成功！', 'success');

      // 清空準備下一張
      state.currentFile = null;
      state.lastDetection = null;
      $('previewArea').classList.remove('active');
      $('photoInput').value = '';

      await loadRoomRecords();
    } catch (e) {
      toast('儲存失敗: ' + e.message, 'error');
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  });

  // ============ API Key 儲存 ============
  window.saveApiKey = function() {
    const k = $('apiKeyInput').value.trim();
    if (!k) { toast('請輸入 API Key', 'error'); return; }
    window.SMES_GEMINI.setKey(k);
    $('apiKeyModal').classList.remove('show');
    toast('API Key 已儲存', 'success');
    $('btnRecognize').click();
  };

  // ============ 搜尋/類別篩選 ============
  $('roomSearch').addEventListener('input', renderRoomGrid);
  $('catFilter').addEventListener('change', renderRoomGrid);

  // ============ 啟動 ============
  loadRooms().catch(e => {
    toast('載入教室資料失敗: ' + e.message, 'error');
    console.error(e);
  });
})();
