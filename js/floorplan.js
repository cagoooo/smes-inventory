// 教室平面圖 — 區塊式示意圖（非像素級還原 PDF，但保留東/西翼相對位置）
(function() {
  // 依據 PDF 114學年教室配置 定義每層樓的區塊
  // 每個 row 是一條水平走廊或一整排教室
  // 格式： { label, rooms: [{code, span(可選)}] }
  // span=2 表示該教室佔兩格（如圖書館 C301 佔 2 格）

  const FLOORS = {
    3: {
      name: '三樓',
      blocks: [
        {
          label: '北側走廊',
          rows: [
            [
              { code: 'C301', span: 2 }, { code: 'C302' }, { code: 'C303' },
              { code: 'C304' }, { code: 'C305' }, { code: 'C306', span: 2 }
            ]
          ]
        },
        {
          label: '東翼',
          vertical: true,
          rows: [
            [{ code: 'C307' }],
            [{ code: 'C308' }],
            [{ code: 'C309' }],
            [{ code: 'C310' }],
            [{ code: 'C312' }],
            [{ code: 'C313' }],
            [{ code: 'C314' }],
          ]
        }
      ]
    },

    2: {
      name: '二樓',
      blocks: [
        {
          label: '北側走廊（行政區）',
          rows: [
            [
              { code: 'C201' }, { code: 'C202' }, { code: 'C203' }, { code: 'C204' },
              { code: 'C205' }, { code: 'C206' }, { code: 'C207' }, { code: 'C208' },
              { code: 'C209' }, { code: 'C210', span: 2 }
            ]
          ]
        },
        {
          label: '中央區',
          vertical: true,
          rows: [
            [{ code: 'C211' }], [{ code: 'C212' }], [{ code: 'C213' }],
            [{ code: 'C214' }], [{ code: 'C216' }]
          ]
        },
        {
          label: '西翼（課照 / 美語 / 美勞）',
          vertical: true,
          rows: [
            [{ code: 'C234' }], [{ code: 'C233' }], [{ code: 'C232' }],
            [{ code: 'C231' }], [{ code: 'C230' }], [{ code: 'C229' }],
            [{ code: 'C228' }], [{ code: 'C227' }]
          ]
        },
        {
          label: '東翼（五年級）',
          vertical: true,
          rows: [
            [{ code: 'C217' }], [{ code: 'C218' }], [{ code: 'C219' }],
            [{ code: 'C220' }], [{ code: 'C221' }], [{ code: 'C222' }],
            [{ code: 'C223' }], [{ code: 'C224' }], [{ code: 'C225' }],
            [{ code: 'C226' }]
          ]
        }
      ]
    },

    1: {
      name: '一樓',
      blocks: [
        {
          label: '北側走廊',
          rows: [
            [
              { code: 'C101' }, { code: 'C102' }, { code: 'C103' }, { code: 'C104' },
              { code: 'C105' }, { code: 'C106' }, { code: 'C107' }, { code: 'C108' },
              { code: 'C109' }, { code: 'C110' }
            ]
          ]
        },
        {
          label: '中央區（學習 / 知動）',
          vertical: true,
          rows: [
            [{ code: 'C111' }], [{ code: 'C112' }], [{ code: 'C113' }],
            [{ code: 'C114' }], [{ code: 'C116' }], [{ code: 'C117' }],
            [{ code: 'C118' }], [{ code: 'C136' }]
          ]
        },
        {
          label: '西翼（四年 / 書法 / 保健）',
          vertical: true,
          rows: [
            [{ code: 'C134' }], [{ code: 'C133' }], [{ code: 'C132' }],
            [{ code: 'C131' }], [{ code: 'C130' }], [{ code: 'C129' }],
            [{ code: 'C128' }], [{ code: 'C127' }], [{ code: 'C135' }]
          ]
        },
        {
          label: '東翼（三年 / 五年1 / 自然三）',
          vertical: true,
          rows: [
            [{ code: 'C119' }], [{ code: 'C120' }], [{ code: 'C121' }],
            [{ code: 'C122' }], [{ code: 'C123' }], [{ code: 'C124' }],
            [{ code: 'C125' }]
          ]
        }
      ]
    },

    0: {
      name: '幼兒園',
      blocks: [
        {
          label: '幼兒園',
          rows: [
            [{ code: 'K-BUBBLE' }, { code: 'K-OFFICE' }, { code: 'K-RAINBOW' }]
          ]
        }
      ]
    }
  };

  function progressStatus(stat) {
    const inv = stat?.inventory_count || 0;
    const photo = stat?.photo_count || 0;
    if (inv === 0) return 'no-inv';
    if (photo === 0) return 'todo';
    if (photo < inv) return 'partial';
    return 'done';
  }

  // 本次盤點狀態：依本月是否有拍照紀錄區分
  // recent = 本月有拍 / stale = 以前拍過但本月沒拍 / never = 從沒拍過
  function roundProgressStatus(stat) {
    const inv = stat?.inventory_count || 0;
    if (inv === 0) return 'no-inv';
    const recent = stat?.recent_photo_count || 0;
    const everPhoto = stat?.photo_count || 0;
    if (recent > 0) {
      // 本月有拍 — 依拍的百分比分級
      if (recent >= inv) return 'round-done';
      return 'round-partial';
    }
    if (everPhoto > 0) return 'round-stale';  // 以前有拍但本月沒拍
    return 'round-never';  // 從沒拍過
  }

  function renderFloor(floor, rooms, statsMap, selectedCode, mode) {
    const data = FLOORS[floor];
    if (!data) return '';
    const roomMap = Object.fromEntries(rooms.map(r => [r.code, r]));

    const renderRoom = (cell) => {
      const r = roomMap[cell.code];
      if (!r) {
        return `<div class="fp-cell fp-empty" style="grid-column: span ${cell.span||1};">${cell.code}</div>`;
      }
      const st = statsMap[cell.code] || {};
      const inv = st.inventory_count || 0;
      const photo = st.photo_count || 0;
      const recent = st.recent_photo_count || 0;
      const isSelected = selectedCode === cell.code ? ' selected' : '';
      const spanStyle = cell.span ? ` style="grid-column: span ${cell.span};"` : '';

      // 依模式切換著色
      let statusClass, pctLine;
      if (mode === 'round') {
        // 本月盤點模式
        statusClass = `fp-${roundProgressStatus(st)}`;
        if (inv === 0) pctLine = '<div class="fp-pct fp-no-inv">-</div>';
        else pctLine = `<div class="fp-pct">本月 ${recent}/${inv}</div>`;
      } else {
        // 預設：歷史累積
        statusClass = `fp-${progressStatus(st)}`;
        const pct = inv > 0 ? Math.round(photo / inv * 100) : 0;
        pctLine = inv > 0 ? `<div class="fp-pct">${photo}/${inv}${inv>0 ? ` · ${pct}%`:''}</div>` : '<div class="fp-pct fp-no-inv">-</div>';
      }

      return `<div class="fp-cell ${statusClass}${isSelected}" data-code="${cell.code}"${spanStyle}>
        <div class="fp-code">${cell.code}</div>
        <div class="fp-name">${r.name.replace(/\([^)]*\)/g, '').split('/')[0]}</div>
        ${pctLine}
      </div>`;
    };

    const renderBlock = (block) => {
      const isVertical = block.vertical;
      const gridClass = isVertical ? 'fp-block-v' : 'fp-block-h';
      const wrapClass = isVertical ? '' : 'fp-block-has-h';
      const cells = block.rows.map(row =>
        row.map(cell => renderRoom(cell)).join('')
      ).join('');
      return `<div class="fp-block ${wrapClass}">
        <div class="fp-block-label">${block.label}</div>
        <div class="${gridClass}" style="--cols:${Math.max(...block.rows.map(r => r.reduce((s,c) => s + (c.span||1), 0)))};">
          ${cells}
        </div>
      </div>`;
    };

    return `<div class="fp-floor">
      <div class="fp-floor-title">🏢 ${data.name}</div>
      <div class="fp-floor-body">
        ${data.blocks.map(renderBlock).join('')}
      </div>
    </div>`;
  }

  function renderAll(rooms, stats, onClickCode, selectedCode, options = {}) {
    const statsMap = Object.fromEntries((stats || []).map(s => [s.code, s]));
    const container = document.createElement('div');
    container.className = 'fp-container';
    const mode = options.mode || 'all';  // 'all' (歷史累積) or 'round' (本月盤點)

    // 模式切換 toggle（若 options.showModeToggle 為 true）
    const toggleHTML = options.showModeToggle ? `
      <div class="fp-mode-toggle">
        <button class="fp-mode-btn ${mode === 'all' ? 'active' : ''}" data-mode="all">📊 歷史累積</button>
        <button class="fp-mode-btn ${mode === 'round' ? 'active' : ''}" data-mode="round">🎯 本月盤點進度</button>
      </div>
    ` : '';

    // 圖例依模式切換
    const legendHTML = mode === 'round' ? `
      <div class="fp-legend">
        <span class="fp-leg fp-round-never">🔴 從未拍過</span>
        <span class="fp-leg fp-round-stale">🟡 以前拍過但本月沒拍</span>
        <span class="fp-leg fp-round-partial">🟠 本月部分</span>
        <span class="fp-leg fp-round-done">🟢 本月完成</span>
        <span class="fp-leg fp-no-inv">⚪ 無財產</span>
      </div>
    ` : `
      <div class="fp-legend">
        <span class="fp-leg fp-todo">🔴 未拍</span>
        <span class="fp-leg fp-partial">🟡 部分</span>
        <span class="fp-leg fp-done">🟢 已完成</span>
        <span class="fp-leg fp-no-inv">⚪ 無財產</span>
      </div>
    `;

    container.innerHTML = toggleHTML + legendHTML +
      [3, 2, 1, 0].map(f => renderFloor(f, rooms, statsMap, selectedCode, mode)).join('');

    container.querySelectorAll('.fp-cell[data-code]').forEach(el => {
      el.addEventListener('click', () => {
        const code = el.dataset.code;
        if (onClickCode) onClickCode(code);
      });
    });

    // 模式切換按鈕
    container.querySelectorAll('.fp-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = btn.dataset.mode;
        if (options.onModeChange) options.onModeChange(newMode);
      });
    });

    return container;
  }

  window.SMES_FLOORPLAN = { renderAll };
})();
