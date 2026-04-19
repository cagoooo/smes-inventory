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
    lastCaptureMode: null,  // 記住手機端上次選的拍照方式（camera/library/file/live）
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
  // 把 toast 注入給 offline.js 共用
  if (window.SMES_OFFLINE) window.SMES_OFFLINE.toast = toast;
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
    await loadGlobalProgress();

    const savedCode = localStorage.getItem(STORAGE_CUR_ROOM);
    if (savedCode) {
      const r = state.rooms.find(x => x.code === savedCode);
      if (r) selectRoom(r, true);
    }
  }

  // ============ 全校進度 ============
  async function loadGlobalProgress() {
    try {
      const stats = await window.SMES_DB.getClassroomStats();
      state.stats = stats;
      // 只算「有財產的教室」為總數
      const roomsWithInv = stats.filter(s => (s.inventory_count || 0) > 0);
      const roomsWithPhoto = roomsWithInv.filter(s => (s.photo_count || 0) > 0);
      const totalInv = stats.reduce((s, x) => s + (x.inventory_count || 0), 0);
      const totalPhoto = stats.reduce((s, x) => s + (x.photo_count || 0), 0);

      const pct = roomsWithInv.length > 0 ?
        Math.round(roomsWithPhoto.length / roomsWithInv.length * 100) : 0;

      const bar = $('globalProgressBar');
      const lbl = $('globalProgressLabel');
      if (bar && lbl) {
        bar.style.width = pct + '%';
        bar.className = 'progress-fill ' + (pct >= 100 ? 'done' : pct >= 50 ? 'half' : 'start');
        lbl.innerHTML = `<b>${roomsWithPhoto.length}</b> / ${roomsWithInv.length} 教室 · <b>${totalPhoto}</b> / ${totalInv} 台`;
      }
    } catch (e) {
      console.warn('loadGlobalProgress:', e);
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

      // 本教室進度條：photos / inventory
      const pct = inventory.length > 0 ? Math.min(100, Math.round(photos.length / inventory.length * 100)) : 0;
      const bar = $('roomProgressBar');
      const lbl = $('roomProgressLabel');
      if (bar && lbl) {
        if (inventory.length === 0) {
          bar.parentElement.style.display = 'none';
        } else {
          bar.parentElement.style.display = 'block';
          bar.style.width = pct + '%';
          bar.className = 'progress-fill ' + (pct >= 100 ? 'done' : pct >= 50 ? 'half' : 'start');
          lbl.textContent = `${photos.length} / ${inventory.length} (${pct}%)`;
        }
      }

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
  let currentView = 'list';

  function renderFloorplanView() {
    if (!window.SMES_FLOORPLAN) return;
    const el = window.SMES_FLOORPLAN.renderAll(
      state.rooms,
      state.stats || [],
      (code) => {
        const r = state.rooms.find(x => x.code === code);
        if (r) selectRoom(r);
      },
      state.currentRoom?.code
    );
    const wrap = $('floorplanView');
    wrap.innerHTML = '';
    wrap.appendChild(el);
  }

  // 切換檢視
  document.querySelectorAll('#viewToggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#viewToggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      if (currentView === 'floorplan') {
        $('listFilters').style.display = 'none';
        $('roomGrid').style.display = 'none';
        $('floorplanView').style.display = 'block';
        renderFloorplanView();
      } else {
        $('listFilters').style.display = 'block';
        $('roomGrid').style.display = 'grid';
        $('floorplanView').style.display = 'none';
      }
      vibrate(10);
    });
  });

  window.openRoomSheet = () => {
    $('roomSheet').classList.add('show');
    $('sheetBackdrop').classList.add('show');
    document.body.style.overflow = 'hidden';
    // 已選過教室的用戶預設打開平面圖（視覺化優先）
    if (state.currentRoom && currentView !== 'floorplan') {
      document.querySelector('#viewToggle button[data-view="floorplan"]').click();
    }
    if (currentView === 'list') {
      setTimeout(() => $('roomSearch').focus({ preventScroll: true }), 300);
    }
  };
  window.closeRoomSheet = () => {
    $('roomSheet').classList.remove('show');
    $('sheetBackdrop').classList.remove('show');
    document.body.style.overflow = '';
  };

  // ============ 拍照 / 上傳 ============
  async function handlePhotoFile(f) {
    if (!f || !state.currentRoom) {
      if (!state.currentRoom) toast('請先選擇教室', 'error');
      return;
    }
    // 檢查是否為圖片
    if (!f.type.startsWith('image/')) {
      toast('請選擇圖片檔', 'error');
      return;
    }
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

      // 如果剛剛透過 QR 掃過，強制覆蓋財產編號（QR 比 AI 準）
      if (state.qrPrefill) {
        parsed.property_number = state.qrPrefill.property_number;
      }

      fillDetectFields(parsed);
      await showMatchSuggestions(parsed);

      // QR 預填了 matched_inventory_id 的話直接選上該建議並觸發 diff
      if (state.qrPrefill?.matched_inventory_id) {
        const mid = state.qrPrefill.matched_inventory_id;
        const el = document.querySelector(`.match-suggest[data-id="${mid}"]`);
        if (el) {
          document.querySelectorAll('.match-suggest').forEach(x => x.classList.remove('selected'));
          el.classList.add('selected');
          const cand = lastCandidates.find(c => c.id === mid);
          if (cand) renderInventoryDiff(cand);
        }
      }
      state.qrPrefill = null;
      $('recognizeLoading').style.display = 'none';
      $('detectArea').style.display = 'block';
      toast('✨ 辨識完成，請檢查後儲存', 'success');
      vibrate(40);
      $('previewPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      $('recognizeLoading').style.display = 'none';
      $('detectArea').style.display = 'block';
      toast('辨識失敗，請手動填寫: ' + err.message, 'error');
      console.error(err);
    }
  }

  $('photoInput').addEventListener('change', e => handlePhotoFile(e.target.files[0]));
  // 桌面版拍照按鈕
  const deskInput = $('photoInputDesktop');
  if (deskInput) deskInput.addEventListener('change', e => handlePhotoFile(e.target.files[0]));
  // 手機端：相簿 / 其他檔案 兩個額外 input
  const libInput = $('photoInputLibrary');
  if (libInput) libInput.addEventListener('change', e => handlePhotoFile(e.target.files[0]));
  const anyInput = $('photoInputAny');
  if (anyInput) anyInput.addEventListener('change', e => handlePhotoFile(e.target.files[0]));

  // Live 相機呼叫 handlePhotoFile — 暴露給 window 供 camera.js / HTML onclick 使用
  window.handlePhotoFile = handlePhotoFile;

  // ============ 手機端：拍攝功能選單（Action Sheet）============
  window.openCaptureMenu = () => {
    if (!state.currentRoom) {
      toast('請先選擇教室', 'error');
      openRoomSheet();
      return;
    }
    const backdrop = $('captureBackdrop');
    const sheet = $('captureSheet');
    if (backdrop) backdrop.classList.add('show');
    if (sheet) sheet.classList.add('show');
    try { navigator.vibrate && navigator.vibrate(10); } catch {}
  };

  window.closeCaptureMenu = () => {
    const backdrop = $('captureBackdrop');
    const sheet = $('captureSheet');
    if (backdrop) backdrop.classList.remove('show');
    if (sheet) sheet.classList.remove('show');
  };

  window.triggerCapture = (mode) => {
    state.lastCaptureMode = mode;  // 記住上次選擇，供連續拍照模式沿用
    try { localStorage.setItem('smes_last_capture_mode', mode); } catch {}
    closeCaptureMenu();
    // 給一點延遲讓 sheet 動畫完成再觸發（iOS 否則會忽略觸發）
    setTimeout(() => {
      if (mode === 'camera') {
        // iOS 直接開相機
        $('photoInput').value = '';
        $('photoInput').click();
      } else if (mode === 'library') {
        // 只從相簿選（不觸發相機）
        $('photoInputLibrary').value = '';
        $('photoInputLibrary').click();
      } else if (mode === 'file') {
        // 任意檔案（iCloud / 檔案 App）
        $('photoInputAny').value = '';
        $('photoInputAny').click();
      } else if (mode === 'live') {
        // Live 相機（我們自己的 getUserMedia）
        if (window.SMES_CAMERA) {
          SMES_CAMERA.open(handlePhotoFile);
        } else {
          toast('Live 相機模組未載入', 'error');
        }
      }
    }, 180);
  };

  // 啟動時還原上次選擇
  try {
    const last = localStorage.getItem('smes_last_capture_mode');
    if (last) state.lastCaptureMode = last;
  } catch {}

  // ============ 桌機：拖放照片上傳 ============
  const dropZone = $('dropZone');
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(ev => {
      dropZone.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
    });
    ['dragleave', 'dragend'].forEach(ev => {
      dropZone.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.remove('drag-over');
      const f = e.dataTransfer?.files?.[0];
      if (f) handlePhotoFile(f);
    });
    // 也支援整頁拖曳（方便性）
    document.addEventListener('dragover', e => { e.preventDefault(); });
    document.addEventListener('drop', e => {
      e.preventDefault();
      if (e.target.closest('#dropZone')) return; // 已處理
      if (!state.currentRoom) return;
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('image/')) handlePhotoFile(f);
    });
  }

  // ============ 鍵盤快捷鍵 (桌機) ============
  document.addEventListener('keydown', (e) => {
    // 略過 input/textarea 內的按鍵
    const tag = e.target.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    // Cmd/Ctrl + K : 打開教室選擇
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openRoomSheet();
      return;
    }
    // Esc : 關閉 sheet / 取消預覽
    if (e.key === 'Escape') {
      if ($('roomSheet').classList.contains('show')) closeRoomSheet();
      else if ($('previewPanel').style.display !== 'none' && state.currentFile) cancelPreview();
      return;
    }
    if (inInput) return;

    // Space : 觸發拍照（在預覽關閉時）
    if (e.key === ' ' && state.currentRoom && $('previewPanel').style.display === 'none') {
      e.preventDefault();
      ($('photoInputDesktop') || $('photoInput')).click();
      return;
    }
    // Cmd/Ctrl + Enter : 儲存
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if ($('detectArea').style.display !== 'none') {
        e.preventDefault();
        $('btnSave').click();
      }
    }
  });

  window.cancelPreview = () => {
    if (!confirm('放棄這張照片？')) return;
    $('previewPanel').style.display = 'none';
    ['photoInput', 'photoInputDesktop', 'photoInputLibrary', 'photoInputAny']
      .forEach(id => { const el = $(id); if (el) el.value = ''; });
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

  // 儲存候選清單（供選中後重新查 diff 用）
  let lastCandidates = [];

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
    lastCandidates = candidates;

    if (candidates.length === 0) {
      // 沒有對應，若 AI 有辨識到財產號 → 提供「新增為新財產」按鈕
      const hasPN = !!p.property_number;
      area.innerHTML = `<div class="match-banner none">
        🔍 <span class="count">找不到對應的既有財產 — 可能是新購、汰換、或尚未匯入</span>
      </div>
      ${hasPN ? `
      <button type="button" class="btn btn-primary btn-block" onclick="createInventoryFromDetection()" style="margin-top:8px;">
        ➕ 新增為新財產（#${p.property_number}）
      </button>` : ''}
      `;
      return;
    }

    // 判斷候選是否在其他教室（搬家情境）
    const transferred = candidates.filter(c =>
      c.classroom_code && c.classroom_code !== state.currentRoom.code
    );
    const bannerText = transferred.length > 0
      ? `🚛 找到 ${candidates.length} 筆對應，其中 <b>${transferred.length} 筆在其他教室</b>（可能是閒置機轉移來的）`
      : `🎯 ${candidates.length} 筆可能對應，點選要比對的`;

    area.innerHTML = `<div class="match-banner ${transferred.length > 0 ? 'transfer' : 'good'}">
      <span class="count">${bannerText}</span>
    </div>` + candidates.map(c => {
      const isTransfer = c.classroom_code && c.classroom_code !== state.currentRoom.code;
      const roomInfo = state.rooms?.find?.(r => r.code === c.classroom_code);
      const fromWhere = c.classroom_code
        ? (roomInfo ? `${c.classroom_code} ${roomInfo.name}` : c.classroom_code)
        : '(未設定教室)';
      return `
      <div class="match-suggest ${isTransfer ? 'is-transfer' : ''}" data-id="${c.id}">
        <div class="check">✓</div>
        <div class="info">
          <div class="title">${c.property_number || '(無編號)'} · ${c.model || c.item_name || ''}</div>
          <div class="desc">${c.brand || ''} ${c.acquired_year ? '· 取得 '+c.acquired_year+'年' : ''} · <span class="from-room">${isTransfer ? '🚛 目前登記在 ' : '📍 '}${fromWhere}</span></div>
        </div>
      </div>`;
    }).join('') + `<div id="invDiffArea"></div>`;

    area.querySelectorAll('.match-suggest').forEach(el => {
      el.addEventListener('click', () => {
        area.querySelectorAll('.match-suggest').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        vibrate(15);
        // 觸發差異比對
        const id = parseInt(el.dataset.id);
        const cand = lastCandidates.find(c => c.id === id);
        if (cand) renderInventoryDiff(cand);
      });
    });

    // 若只有 1 筆建議 → 自動選中並立即顯示差異
    if (candidates.length === 1) {
      const el = area.querySelector('.match-suggest');
      if (el) {
        el.classList.add('selected');
        renderInventoryDiff(candidates[0]);
      }
    }
  }

  // ========== 比對 AI 辨識 ↔ 既有清冊，顯示差異 UI ==========
  const INV_UPDATE_FIELDS = [
    { key: 'brand', label: '廠牌', readFromForm: () => $('f_brand').querySelector('input').value.trim() },
    { key: 'model', label: '型號', readFromForm: () => $('f_model').querySelector('input').value.trim() },
    { key: 'acquired_year', label: '民國年', readFromForm: () => {
      const v = $('f_roc_year').querySelector('input').value.trim();
      return v ? parseInt(v) : null;
    }},
    { key: 'serial_number', label: '序號 S/N', readFromForm: () => $('f_serial_number').querySelector('input').value.trim() },
  ];

  function renderInventoryDiff(candidate) {
    const diffEl = $('invDiffArea');
    if (!diffEl || !candidate) return;

    const changes = [];
    INV_UPDATE_FIELDS.forEach(f => {
      const newVal = f.readFromForm();
      const oldVal = candidate[f.key];
      // 空字串視為 null
      const normOld = (oldVal === '' || oldVal == null) ? '' : String(oldVal);
      const normNew = (newVal === '' || newVal == null) ? '' : String(newVal);
      if (normOld !== normNew && normNew !== '') {
        changes.push({ field: f.key, label: f.label, oldVal: normOld || '(空)', newVal: normNew });
      }
    });

    // 檢查教室是否變更（搬家偵測）
    const isTransfer = candidate.classroom_code && candidate.classroom_code !== state.currentRoom.code;
    if (isTransfer || !candidate.classroom_code) {
      const fromRoom = state.rooms?.find?.(r => r.code === candidate.classroom_code);
      const oldDisplay = candidate.classroom_code
        ? (fromRoom ? `${candidate.classroom_code} ${fromRoom.name}` : candidate.classroom_code)
        : '(未設定教室)';
      changes.push({
        field: 'classroom_code',
        label: isTransfer ? '🚛 教室轉移' : '所在教室',
        oldVal: oldDisplay,
        newVal: state.currentRoom.code + ' ' + state.currentRoom.name,
        transfer: isTransfer  // 標記這是搬家
      });
    }

    if (changes.length === 0) {
      diffEl.innerHTML = `
        <div class="inv-diff-panel no-diff">
          <div class="inv-diff-title">✅ AI 辨識結果與清冊一致，無需更新</div>
          <div class="inv-diff-desc">這台主機資料正確無誤，拍照紀錄會直接入庫。</div>
        </div>`;
      return;
    }

    // 是否有搬家情境？給 panel 不同的視覺
    const hasTransfer = changes.some(c => c.transfer);
    const panelClass = hasTransfer ? 'inv-diff-panel is-transfer' : 'inv-diff-panel';
    const title = hasTransfer
      ? `🚛 偵測到設備搬家：共 ${changes.length} 個欄位要更新`
      : `📝 發現 ${changes.length} 個欄位與清冊不同（可能主機已汰換/更換）`;

    diffEl.innerHTML = `
      <div class="${panelClass}">
        <div class="inv-diff-head">
          <div class="inv-diff-title">${title}</div>
          <label class="inv-diff-all">
            <input type="checkbox" id="invDiffAll" checked> 全選
          </label>
        </div>
        ${hasTransfer ? `<div class="inv-diff-transfer-banner">
          這台設備原本登記在其他教室，勾選「教室轉移」後儲存，系統會把清冊上的教室改成 <b>${state.currentRoom.code} ${state.currentRoom.name}</b>。
        </div>` : ''}
        <div class="inv-diff-list">
          ${changes.map(c => `
            <label class="inv-diff-row ${c.transfer ? 'is-transfer-row' : ''}">
              <input type="checkbox" class="inv-diff-check" data-field="${c.field}" data-new="${(c.newVal || '').replace(/"/g, '&quot;')}" checked>
              <div class="inv-diff-content">
                <div class="inv-diff-label">${c.label}</div>
                <div class="inv-diff-values">
                  <span class="inv-diff-old">${c.oldVal}</span>
                  <span class="inv-diff-arrow">→</span>
                  <span class="inv-diff-new">${c.newVal}</span>
                </div>
              </div>
            </label>
          `).join('')}
        </div>
        <div class="inv-diff-hint">
          💡 勾選的欄位會在按「儲存」時一起寫進財產清冊，讓這筆紀錄成為 #${candidate.property_number || candidate.id} 的最新狀態。
        </div>
      </div>`;

    // 全選 toggle
    $('invDiffAll')?.addEventListener('change', (e) => {
      diffEl.querySelectorAll('.inv-diff-check').forEach(c => c.checked = e.target.checked);
    });
  }

  // 表單欄位變更時，重新計算差異（單一 document listener，以 debounce 節流）
  let _diffRerenderTimer = null;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest('#f_brand, #f_model, #f_roc_year, #f_serial_number')) return;
    clearTimeout(_diffRerenderTimer);
    _diffRerenderTimer = setTimeout(() => {
      const selected = document.querySelector('#matchArea .match-suggest.selected');
      if (!selected) return;
      const id = parseInt(selected.dataset.id);
      const cand = lastCandidates.find(c => c.id === id);
      if (cand) renderInventoryDiff(cand);
    }, 300);
  });

  // ========== 新增為新財產（AI 辨識到財產號但沒對應到清冊）==========
  window.createInventoryFromDetection = async () => {
    const p = state.lastDetection?.parsed;
    if (!p || !p.property_number) { toast('缺少財產編號', 'error'); return; }
    if (!state.currentRoom) { toast('未選教室', 'error'); return; }
    // 讀取表單最新值（使用者可能有手動修改）
    const formVal = id => $(id).querySelector('input,select,textarea').value.trim() || null;
    const brand = formVal('f_brand');
    const model = formVal('f_model');
    const rocYear = formVal('f_roc_year');
    const serial = formVal('f_serial_number');

    if (!confirm(`確認新增新財產 #${p.property_number}？\n\n廠牌：${brand || '(空)'}\n型號：${model || '(空)'}\n民國年：${rocYear || '(空)'}\n教室：${state.currentRoom.code} ${state.currentRoom.name}`)) return;

    try {
      const newItem = {
        property_number: p.property_number,
        item_name: (formVal('f_photo_type') || '').includes('筆電') ? '筆記型電腦' : '電腦主機',
        brand: brand,
        model: model,
        acquired_year: rocYear ? parseInt(rocYear) : null,
        classroom_code: state.currentRoom.code,
        location_text: state.currentRoom.code,
        serial_number: serial,
      };
      const row = await window.SMES_DB.insertInventoryItem(newItem);
      toast(`✅ 已新增 #${p.property_number} 到財產清冊`, 'success');
      // 重新搜尋以重新渲染 match 建議
      await showMatchSuggestions(p);
      // 自動選上新增的這筆
      setTimeout(() => {
        const el = document.querySelector(`.match-suggest[data-id="${row.id}"]`);
        if (el) { el.classList.add('selected'); renderInventoryDiff(row); }
      }, 100);
    } catch (e) {
      toast('新增失敗: ' + e.message, 'error');
      console.error(e);
    }
  };

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

      const selected = document.querySelector('#matchArea .match-suggest.selected');
      const matched_id = selected ? parseInt(selected.dataset.id) : null;
      const rocYearStr = getVal('f_roc_year');
      const rocYear = rocYearStr ? parseInt(rocYearStr) : null;
      const user = window.SMES_AUTH?.getUser?.();

      const record = {
        classroom_code: room.code,
        photo_path: fileName,
        photo_url: null,  // 會在上傳成功後填
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
        device_label: getDeviceLabel(),
        created_by: user?.id || null
      };

      // 工具：清空所有 file input 值（讓同一張照片可重選）
      const resetAllInputs = () => {
        ['photoInput', 'photoInputDesktop', 'photoInputLibrary', 'photoInputAny']
          .forEach(id => { const el = $(id); if (el) el.value = ''; });
      };

      // 離線時 → 進 IndexedDB 佇列
      if (!navigator.onLine) {
        await window.SMES_OFFLINE.enqueuePhoto({
          file: state.currentFile,
          classroom_code: room.code,
          record
        });
        toast('📴 離線中，已存入佇列，回線後自動上傳', 'success');
        vibrate([30, 50, 30]);
        state.currentFile = null;
        state.lastDetection = null;
        $('previewPanel').style.display = 'none';
        resetAllInputs();
        return;
      }

      // 線上：直接上傳
      const photoUrl = await window.SMES_DB.uploadPhoto(state.currentFile, fileName);
      record.photo_url = photoUrl;
      await window.SMES_DB.insertPhoto(record);

      // 🔄 同步更新財產清冊（若使用者勾選了差異欄位）
      let invUpdated = 0;
      if (matched_id) {
        const checks = document.querySelectorAll('#invDiffArea .inv-diff-check:checked');
        if (checks.length > 0) {
          const patch = {};
          checks.forEach(c => {
            const field = c.dataset.field;
            const newVal = c.dataset.new;
            if (field === 'acquired_year') {
              patch[field] = newVal ? parseInt(newVal) : null;
            } else if (field === 'classroom_code') {
              patch[field] = room.code;
              patch['location_text'] = room.code;
            } else {
              patch[field] = newVal || null;
            }
          });
          try {
            await window.SMES_DB.updateInventoryItem(matched_id, patch);
            invUpdated = checks.length;
          } catch (err) {
            console.error('[inv-update]', err);
            toast('⚠️ 財產清冊更新失敗: ' + err.message, 'error');
          }
        }
      }

      toast(
        invUpdated > 0
          ? `✅ 已儲存 + 同步更新財產清冊 ${invUpdated} 個欄位`
          : '✅ 已儲存，可繼續拍下一張',
        'success'
      );
      vibrate([30, 50, 30]);

      state.currentFile = null;
      state.lastDetection = null;
      $('previewPanel').style.display = 'none';
      resetAllInputs();
      await loadRoomRecords();
      await loadGlobalProgress();

      // 連續拍照模式：儲存成功後自動用上次選過的拍照方式繼續拍
      if ($('continuousMode')?.checked) {
        setTimeout(() => {
          if (window.matchMedia('(min-width: 900px)').matches && $('photoInputDesktop')) {
            $('photoInputDesktop').click();
          } else if (state.lastCaptureMode) {
            // 手機：重複上次的選擇（立即拍照 / 相簿 / 檔案 / Live）
            triggerCapture(state.lastCaptureMode);
          } else {
            // 首次沒記錄 → 跳選單
            openCaptureMenu();
          }
        }, 500);
      }
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

  // ============ QR Code 掃描 ============
  let qrScanner = null;

  window.openQRScanner = async () => {
    if (!state.currentRoom) { toast('請先選教室', 'error'); return; }
    $('qrSheet').classList.add('show');
    $('qrBackdrop').classList.add('show');
    $('qrResult').style.display = 'none';
    document.body.style.overflow = 'hidden';

    if (!window.Html5Qrcode) {
      toast('QR 套件未載入', 'error');
      return;
    }

    try {
      qrScanner = new window.Html5Qrcode('qrReader');
      const cameras = await window.Html5Qrcode.getCameras();
      if (!cameras.length) {
        toast('找不到相機', 'error');
        return;
      }
      // 優先後置鏡頭
      const camId = cameras.find(c => /back|rear|environment/i.test(c.label))?.id || cameras[0].id;

      await qrScanner.start(
        camId,
        { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
        (decoded) => { handleQRResult(decoded); },
        () => {} // 掃描錯誤回呼忽略
      );
    } catch (e) {
      toast('相機開啟失敗: ' + e.message, 'error');
      console.error(e);
    }
  };

  window.closeQRScanner = async () => {
    if (qrScanner) {
      try { await qrScanner.stop(); await qrScanner.clear(); } catch {}
      qrScanner = null;
    }
    $('qrSheet').classList.remove('show');
    $('qrBackdrop').classList.remove('show');
    document.body.style.overflow = '';
  };

  async function handleQRResult(decoded) {
    // 從 QR 內容萃取財產編號（可能是純數字、URL 帶參數、或 JSON）
    let pn = decoded.trim();
    // 如果是 URL 嘗試抓 query string 中的 property number
    const urlMatch = pn.match(/[?&](?:id|pn|no|property)=(\d{4,8})/i);
    if (urlMatch) pn = urlMatch[1];
    // 純數字格式的財產編號（6-8 位）
    const numMatch = pn.match(/^0?0?\d{4,6}$/);
    if (numMatch) pn = numMatch[0];
    // 去除非數字/英數字
    if (pn.length > 20) pn = pn.slice(0, 20);

    vibrate([40, 30, 40]);
    $('qrResultText').textContent = pn;
    $('qrResult').style.display = 'block';

    // 查詢既有財產
    try {
      const matches = await window.SMES_DB.searchInventory(pn);
      const match = matches.find(m => m.property_number === pn) || matches[0];
      if (match) {
        $('qrMatchInfo').innerHTML = `✅ 在財產清冊找到：<b>${match.brand||''} ${match.model||''}</b>` +
          (match.acquired_year ? ` · 取得 ${match.acquired_year} 年` : '') +
          (match.classroom_code ? ` · 位於 ${match.classroom_code}` : '') +
          `<br><button class="btn btn-success btn-block" style="margin-top:8px;" onclick="useQRMatch(${match.id}, '${pn}')">✓ 使用這筆 + 馬上拍照</button>`;
      } else {
        $('qrMatchInfo').innerHTML = `⚠️ 財產清冊找不到此編號。<br>
          <button class="btn btn-primary btn-block" style="margin-top:8px;" onclick="useQRNumber('${pn}')">📷 仍用此編號開始拍照</button>`;
      }
    } catch (e) {
      $('qrMatchInfo').innerHTML = `查詢失敗：${e.message}`;
    }

    // 停止掃描以免重複觸發
    if (qrScanner) {
      try { await qrScanner.pause(true); } catch {}
    }
  }

  window.useQRMatch = (invId, pn) => {
    state.qrPrefill = { property_number: pn, matched_inventory_id: invId };
    closeQRScanner();
    setTimeout(() => ($('photoInputDesktop') || $('photoInput')).click(), 300);
  };
  window.useQRNumber = (pn) => {
    state.qrPrefill = { property_number: pn, matched_inventory_id: null };
    closeQRScanner();
    setTimeout(() => ($('photoInputDesktop') || $('photoInput')).click(), 300);
  };

  // ============ 快捷鍵說明 ============
  const helpBtn = $('helpBtn');
  if (helpBtn) helpBtn.addEventListener('click', () => $('shortcutsModal').classList.add('show'));
  const shortcutsModal = $('shortcutsModal');
  if (shortcutsModal) shortcutsModal.addEventListener('click', e => {
    if (e.target === shortcutsModal) shortcutsModal.classList.remove('show');
  });

  // ============ 啟動 ============
  loadRooms().catch(e => {
    toast('載入教室失敗: ' + e.message, 'error');
    console.error(e);
  });
})();
