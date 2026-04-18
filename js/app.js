// 主程式：手機優化版
(function() {
  const STORAGE_CUR_ROOM = 'smes_current_room';
  const STORAGE_RECENT = 'smes_recent_rooms';
  const STORAGE_DEVICE = 'smes_device_label';

  let state = {
    rooms: [],
    currentRoom: null,
    currentFloor: null,
    currentCat: '',
    currentFile: null,
    lastDetection: null,
  };

  // ============ Utilities ============
  const $ = id => document.getElementById(id);
  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
  }
  function toast(msg, type = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2800);
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
    if (age >= 8) return `<span class="badge badge-old">${rocYear}年·汰</span>`;
    if (age >= 5) return `<span class="badge badge-mid">${rocYear}年</span>`;
    return `<span class="badge badge-new">${rocYear}年</span>`;
  }

  const FLOOR_NAMES = { 0: '幼兒園', 1: '一樓', 2: '二樓', 3: '三樓' };
  const CAT_NAMES = {
    class: '班級', subject: '專科', admin: '行政',
    care: '課照', kindergarten: '幼兒園', other: '其他'
  };

  // ============ 最近使用教室 ============
  function pushRecent(code) {
    let list = JSON.parse(localStorage.getItem(STORAGE_RECENT) || '[]');
    list = [code, ...list.filter(c => c !== code)].slice(0, 6);
    localStorage.setItem(STORAGE_RECENT, JSON.stringify(list));
  }
  function getRecent() {
    return JSON.parse(localStorage.getItem(STORAGE_RECENT) || '[]');
  }
  function renderRecent() {
    const codes = getRecent();
    if (!codes.length || !state.rooms.length) {
      $('recentChips').innerHTML = '<span style="color:var(--text-muted);font-size:13px;">尚無最近紀錄</span>';
      return;
    }
    $('recentChips').innerHTML = codes
      .map(code => state.rooms.find(r => r.code === code))
      .filter(Boolean)
      .map(r => `
        <button class="recent-chip" onclick="quickSelectRoom('${r.code}')">
          <span class="c">${r.code}</span>
          <span>${r.name}</span>
        </button>
      `).join('');
  }
  window.quickSelectRoom = code => {
    const r = state.rooms.find(x => x.code === code);
    if (r) selectRoom(r);
  };

  // ============ 載入教室 ============
  async function loadRooms() {
    state.rooms = await window.SMES_DB.listClassrooms();
    renderFloors();
    renderCatChips();
    renderRoomGrid();
    renderRecent();

    const savedCode = localStorage.getItem(STORAGE_CUR_ROOM);
    if (savedCode) {
      const r = state.rooms.find(x => x.code === savedCode);
      if (r) selectRoom(r, true);
    }
  }

  function renderFloors() {
    const floors = [...new Set(state.rooms.map(r => r.floor))].sort();
    $('floorTabs').innerHTML =
      '<button class="active" data-floor="">全部</button>' +
      floors.map(f => `<button data-floor="${f}">${FLOOR_NAMES[f] || f + 'F'}</button>`).join('');
    $('floorTabs').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        $('floorTabs').querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.currentFloor = b.dataset.floor === '' ? null : parseInt(b.dataset.floor);
        renderRoomGrid();
        vibrate(10);
      });
    });
  }

  function renderCatChips() {
    const cats = ['', 'class', 'subject', 'admin', 'care', 'kindergarten'];
    $('catChips').innerHTML = cats.map(c => `
      <button class="${state.currentCat === c ? 'active' : ''}" data-cat="${c}">
        ${c === '' ? '全部類別' : CAT_NAMES[c]}
      </button>
    `).join('');
    $('catChips').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        state.currentCat = b.dataset.cat;
        renderCatChips();
        renderRoomGrid();
        vibrate(10);
      });
    });
  }

  function renderRoomGrid() {
    const kw = $('roomSearch').value.trim().toLowerCase();
    const filtered = state.rooms.filter(r => {
      if (state.currentFloor !== null && r.floor !== state.currentFloor) return false;
      if (state.currentCat && r.category !== state.currentCat) return false;
      if (kw && !r.code.toLowerCase().includes(kw) && !r.name.toLowerCase().includes(kw)) return false;
      return true;
    });

    if (filtered.length === 0) {
      $('roomGrid').innerHTML = '<div class="empty"><div class="icon">🔍</div>無符合條件的教室</div>';
      return;
    }

    $('roomGrid').innerHTML = filtered.map(r => `
      <button class="room-btn cat-${r.category} ${state.currentRoom?.code === r.code ? 'active' : ''}"
              data-code="${r.code}">
        <div class="code">${r.code}</div>
        <div class="name">${r.name}</div>
      </button>
    `).join('');

    $('roomGrid').querySelectorAll('.room-btn').forEach(b => {
      b.addEventListener('click', () => {
        const r = state.rooms.find(x => x.code === b.dataset.code);
        selectRoom(r);
        vibrate([10, 20]);
      });
    });
  }

  // ============ 選擇教室 ============
  async function selectRoom(r, silent = false) {
    state.currentRoom = r;
    localStorage.setItem(STORAGE_CUR_ROOM, r.code);
    pushRecent(r.code);

    $('welcomeState').style.display = 'none';
    $('currentRoomPanel').style.display = 'block';
    $('bottomCta').style.display = 'block';
    $('curRoomName').textContent = r.name;
    $('pillCode').textContent = '#' + r.code;
    $('pillFloor').textContent = FLOOR_NAMES[r.floor] || r.floor + 'F';
    $('previewPanel').style.display = 'none';
    state.currentFile = null;

    closeRoomSheet();
    await loadRoomRecords();
    if (!silent) {
      toast(`📍 已切換到 ${r.name}`, 'success');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function loadRoomRecords() {
    const code = state.currentRoom.code;
    try {
      const [photos, inventory] = await Promise.all([
        window.SMES_DB.listPhotosByRoom(code, 50),
        window.SMES_DB.listInventoryByRoom(code)
      ]);

      $('pillInv').textContent = `📦 ${inventory.length}`;
      $('pillPhoto').textContent = `📷 ${photos.length}`;
      $('roomRecordCount').textContent = `(${photos.length})`;

      if (photos.length === 0) {
        $('roomRecords').innerHTML = `
          <div class="empty">
            <div class="icon">📷</div>
            尚無紀錄<br>
            <small>點下方按鈕開始拍攝</small>
          </div>`;
        return;
      }

      $('roomRecords').innerHTML = photos.map(p => `
        <div class="record-item">
          ${p.photo_url ? `<img src="${p.photo_url}" loading="lazy" onerror="this.style.display='none'">` : '<div style="width:54px;height:54px;background:var(--bg);border-radius:8px;"></div>'}
          <div class="info">
            <div class="model">${p.detected_brand || ''} ${p.detected_model || '(未填型號)'}</div>
            <div class="meta">
              ${p.detected_property_number ? `<span class="tag">🏷 ${p.detected_property_number}</span>` : ''}
              ${p.photo_type ? `<span class="tag">${p.photo_type}</span>` : ''}
              ${yearBadge(p.detected_year)}
              ${p.matched_inventory_id ? '<span class="tag" style="background:var(--success-soft);color:var(--success);">✓ 已比對</span>' : ''}
            </div>
          </div>
          <button class="del" onclick="deletePhoto(${p.id}, '${p.photo_path || ''}')">🗑</button>
        </div>
      `).join('');
    } catch (e) {
      console.error(e);
      $('roomRecords').innerHTML = `<div class="empty">載入失敗: ${e.message}</div>`;
    }
  }

  window.deletePhoto = async (id, path) => {
    if (!confirm('確認刪除？')) return;
    try {
      await window.SMES_DB.deletePhoto(id);
      if (path) window.SMES_DB.deletePhotoFile(path);
      toast('已刪除', 'success');
      vibrate(15);
      loadRoomRecords();
    } catch (e) {
      toast('刪除失敗', 'error');
    }
  };

  // ============ Bottom Sheet ============
  window.openRoomSheet = () => {
    $('roomSheet').classList.add('show');
    $('sheetBackdrop').classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('roomSearch').focus({ preventScroll: true }), 300);
  };
  window.closeRoomSheet = () => {
    $('roomSheet').classList.remove('show');
    $('sheetBackdrop').classList.remove('show');
    document.body.style.overflow = '';
  };

  // ============ 拍照 ============
  $('photoInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    state.currentFile = f;
    state.lastDetection = null;

    $('previewImg').src = URL.createObjectURL(f);
    $('previewPanel').style.display = 'block';
    $('detectArea').style.display = 'none';
    $('recognizeLoading').style.display = 'flex';
    $('matchArea').innerHTML = '';
    vibrate([15, 10, 15]);

    // 自動啟動辨識
    try {
      const { parsed, raw, compressed } = await window.SMES_GEMINI.recognize(f);
      state.currentFile = compressed;
      state.lastDetection = { parsed, raw };
      fillDetectFields(parsed);
      await showMatchSuggestions(parsed);
      $('recognizeLoading').style.display = 'none';
      $('detectArea').style.display = 'block';
      toast('✨ 辨識完成，請檢查後儲存', 'success');
      vibrate(40);
      $('detectArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      $('recognizeLoading').style.display = 'none';
      $('detectArea').style.display = 'block';
      toast('辨識失敗，請手動填寫: ' + err.message, 'error');
      console.error(err);
    }
  });

  window.cancelPreview = () => {
    if (!confirm('放棄這張照片？')) return;
    $('previewPanel').style.display = 'none';
    $('photoInput').value = '';
    state.currentFile = null;
  };

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
    const area = $('matchArea');
    area.innerHTML = '';
    let candidates = [];
    if (p.property_number) {
      try {
        const rs = await window.SMES_DB.searchInventory(p.property_number);
        candidates = rs.slice(0, 3);
      } catch (e) {}
    }
    if (candidates.length === 0 && p.model) {
      try {
        const rs = await window.SMES_DB.searchInventory(p.model);
        candidates = rs.slice(0, 3);
      } catch (e) {}
    }

    if (candidates.length === 0) {
      area.innerHTML = `<div class="match-banner none">
        🔍 <span class="count">找不到對應的既有財產 — 可能是新購或尚未匯入</span>
      </div>`;
      return;
    }

    area.innerHTML = `<div class="match-banner good">
      🎯 <span class="count">${candidates.length} 筆可能對應，點選要比對的</span>
    </div>` + candidates.map(c => `
      <div class="match-suggest" data-id="${c.id}">
        <div class="check">✓</div>
        <div class="info">
          <div class="title">${c.property_number || '(無編號)'} · ${c.model || c.item_name || ''}</div>
          <div class="desc">${c.brand || ''} ${c.acquired_year ? '· 取得 '+c.acquired_year+'年' : ''} ${c.location_text ? '· '+c.location_text : ''}</div>
        </div>
      </div>
    `).join('');

    area.querySelectorAll('.match-suggest').forEach(el => {
      el.addEventListener('click', () => {
        area.querySelectorAll('.match-suggest').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        vibrate(15);
      });
    });
  }

  // ============ 儲存 ============
  $('btnSave').addEventListener('click', async () => {
    if (!state.currentFile || !state.currentRoom) return;

    const btn = $('btnSave');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-inline"></span> 上傳中…';

    try {
      const room = state.currentRoom;
      const getVal = id => $(id).querySelector('input,select,textarea').value.trim() || null;

      const ts = new Date();
      const ymd = ts.toISOString().slice(0,10);
      const fileName = `${ymd}/${room.code}_${Date.now()}_${Math.random().toString(36).slice(2,7)}.jpg`;
      const photoUrl = await window.SMES_DB.uploadPhoto(state.currentFile, fileName);

      const selected = document.querySelector('#matchArea .match-suggest.selected');
      const matched_id = selected ? parseInt(selected.dataset.id) : null;

      const rocYearStr = getVal('f_roc_year');
      const rocYear = rocYearStr ? parseInt(rocYearStr) : null;

      await window.SMES_DB.insertPhoto({
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
        matched_inventory_id: matched_id,
        match_method: matched_id ? 'manual' : null,
        notes: getVal('f_notes'),
        device_label: getDeviceLabel()
      });

      toast('✅ 已儲存，可繼續拍下一張', 'success');
      vibrate([30, 50, 30]);

      state.currentFile = null;
      state.lastDetection = null;
      $('previewPanel').style.display = 'none';
      $('photoInput').value = '';
      await loadRoomRecords();
    } catch (e) {
      toast('儲存失敗: ' + e.message, 'error');
      console.error(e);
      vibrate([100, 50, 100]);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });

  // ============ API Key fallback ============
  window.saveApiKey = () => {
    const k = $('apiKeyInput').value.trim();
    if (!k) { toast('請輸入 Key', 'error'); return; }
    window.SMES_GEMINI.setKey(k);
    $('apiKeyModal').classList.remove('show');
    toast('已儲存，請再試', 'success');
  };

  // ============ 搜尋與篩選 ============
  $('roomSearch').addEventListener('input', renderRoomGrid);

  // Swipe down to close sheet（簡單偵測）
  let sheetTouch = null;
  $('roomSheet').addEventListener('touchstart', e => {
    if (e.target.closest('.sheet-header') || e.target.closest('.sheet-handle')) {
      sheetTouch = { y: e.touches[0].clientY };
    }
  });
  $('roomSheet').addEventListener('touchmove', e => {
    if (!sheetTouch) return;
    const dy = e.touches[0].clientY - sheetTouch.y;
    if (dy > 80) { closeRoomSheet(); sheetTouch = null; }
  });
  $('roomSheet').addEventListener('touchend', () => { sheetTouch = null; });

  // ============ 啟動 ============
  loadRooms().catch(e => {
    toast('載入教室失敗: ' + e.message, 'error');
    console.error(e);
  });
})();
