// 月報表 PDF 產生器 — 用 html2canvas + jsPDF，直接截 dashboard 畫面
(function() {
  let libsReady = false;

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = url; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensureLibs() {
    if (libsReady) return;
    await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    libsReady = true;
  }

  async function generate(inventory, rooms, stats, photoRecords) {
    await ensureLibs();
    const { jsPDF } = window.jspdf;

    const now = new Date();
    const yearMonth = `民國${now.getFullYear() - 1911}年${now.getMonth() + 1}月`;

    // 建隱藏的報表 HTML（A4 寬度 = 794px at 96dpi）
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position: fixed; top: -9999px; left: 0; width: 794px; background: #fff;
      font-family: -apple-system, "Noto Sans TC", sans-serif; color: #000;
      padding: 0; z-index: -1;
    `;
    wrap.innerHTML = buildReportHTML(inventory, rooms, stats, photoRecords, yearMonth);
    document.body.appendChild(wrap);

    // 等字型 + 圖片載入（100ms 通常夠）
    await new Promise(r => setTimeout(r, 300));

    // 一頁一頁截圖 → 加入 PDF
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pages = wrap.querySelectorAll('.report-page');

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage();
      const canvas = await window.html2canvas(pages[i], {
        scale: 2, useCORS: true, backgroundColor: '#fff', logging: false
      });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      // A4 = 210 × 297 mm
      pdf.addImage(img, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }

    const fname = `石門盤點月報_${now.toISOString().slice(0, 10)}.pdf`;
    pdf.save(fname);

    document.body.removeChild(wrap);
    return fname;
  }

  function buildReportHTML(inventory, rooms, stats, photos, yearMonth) {
    const CUR_ROC = 115;
    const total = inventory.length;
    const ages = inventory.filter(i => i.acquired_year).map(i => CUR_ROC - i.acquired_year);
    const avgAge = ages.length ? (ages.reduce((s,a)=>s+a,0) / ages.length).toFixed(1) : '-';
    const toReplace = ages.filter(a => a >= 8).length;
    const newDevice = ages.filter(a => a < 3).length;

    const statsMap = Object.fromEntries((stats || []).map(s => [s.code, s]));
    const roomsWithInv = rooms.filter(r => (statsMap[r.code]?.inventory_count || 0) > 0);
    const roomsWithPhoto = roomsWithInv.filter(r => (statsMap[r.code]?.photo_count || 0) > 0);
    const progressPct = roomsWithInv.length ? Math.round(roomsWithPhoto.length / roomsWithInv.length * 100) : 0;

    // 廠牌統計
    const byBrand = {};
    inventory.forEach(i => {
      const b = i.brand || '未標註';
      byBrand[b] = (byBrand[b] || 0) + 1;
    });
    const brandSort = Object.entries(byBrand).sort((a,b) => b[1]-a[1]).slice(0, 8);

    // 急需汰換 TOP 20
    const urgent = inventory
      .filter(i => i.acquired_year && (CUR_ROC - i.acquired_year) >= 10)
      .sort((a, b) => a.acquired_year - b.acquired_year)
      .slice(0, 20);

    const budgetPerUnit = 25000;
    const totalBudget = toReplace * budgetPerUnit;

    // 年度購置
    const byYear = {};
    inventory.forEach(i => {
      if (i.acquired_year) byYear[i.acquired_year] = (byYear[i.acquired_year] || 0) + 1;
    });
    const yearSort = Object.keys(byYear).sort().map(y => ({ year: parseInt(y), count: byYear[y] }));
    const maxYearCount = Math.max(...yearSort.map(y => y.count), 1);

    const sty = `
      <style>
        .report-page { width: 794px; min-height: 1123px; padding: 40px; box-sizing: border-box; page-break-after: always; background: #fff; }
        .report-page h1 { font-size: 28px; margin: 0 0 4px; color: #0b63c5; letter-spacing: -0.5px; }
        .report-page h2 { font-size: 20px; margin: 24px 0 12px; color: #0b63c5; border-bottom: 2px solid #0b63c5; padding-bottom: 6px; }
        .report-page h3 { font-size: 15px; margin: 14px 0 8px; color: #333; }
        .report-page p { font-size: 13px; line-height: 1.6; color: #333; }
        .report-page table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
        .report-page th { background: #f0f4fa; color: #0b63c5; padding: 8px; text-align: left; border: 1px solid #d0dae8; font-weight: 700; }
        .report-page td { padding: 6px 8px; border: 1px solid #e0e0e0; }
        .kpi-box { display: flex; gap: 12px; margin: 12px 0 20px; }
        .kpi-item { flex: 1; background: #f8fafc; border-left: 5px solid #0b63c5; padding: 14px; border-radius: 4px; }
        .kpi-item.acc { border-left-color: #ff9500; }
        .kpi-item.dan { border-left-color: #ff3b30; }
        .kpi-item.suc { border-left-color: #34c759; }
        .kpi-label { font-size: 11px; color: #6b7280; font-weight: 700; letter-spacing: 0.5px; }
        .kpi-val { font-size: 28px; font-weight: 800; color: #0b63c5; margin-top: 2px; }
        .kpi-item.acc .kpi-val { color: #ff9500; }
        .kpi-item.dan .kpi-val { color: #ff3b30; }
        .kpi-item.suc .kpi-val { color: #34c759; }
        .kpi-unit { font-size: 11px; color: #9ca3af; }
        .progress-bar { width: 100%; height: 24px; background: #e0e7ef; border-radius: 12px; overflow: hidden; margin: 8px 0 16px; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #34c759, #0b63c5); text-align: right; padding: 0 12px; color: #fff; font-weight: 700; line-height: 24px; font-size: 12px; }
        .bar-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; }
        .bar-row .lbl { width: 120px; }
        .bar-row .bar-outer { flex: 1; height: 18px; background: #f0f4fa; border-radius: 4px; overflow: hidden; }
        .bar-row .bar-inner { height: 100%; background: #0b63c5; padding: 0 6px; color: #fff; line-height: 18px; font-size: 11px; text-align: right; }
        .report-footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between; }
        .cover { text-align: center; padding-top: 200px; }
        .cover-school { font-size: 20px; color: #6b7280; }
        .cover-title { font-size: 42px; color: #0b63c5; margin: 20px 0; font-weight: 800; letter-spacing: -1px; }
        .cover-period { font-size: 26px; color: #333; }
        .cover-meta { margin-top: 60px; font-size: 12px; color: #9ca3af; line-height: 1.8; }
        .budget-big { font-size: 48px; font-weight: 800; color: #ff3b30; text-align: center; margin: 20px 0; }
        .note { background: #fff8e1; border-left: 4px solid #ff9500; padding: 10px 14px; font-size: 12px; color: #7d4000; border-radius: 4px; margin: 12px 0; }
        .badge-old { background: #ffe2e0; color: #ff3b30; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; }
        .badge-mid { background: #fff2dd; color: #ff9500; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; }
      </style>
    `;

    // ========== Page 1: 封面 ==========
    const page1 = `
      <div class="report-page">
        ${sty}
        <div class="cover">
          <div style="font-size: 80px;">🏫</div>
          <div class="cover-school">桃園市石門國民小學</div>
          <div class="cover-title">電腦財產盤點月報</div>
          <div class="cover-period">${yearMonth}</div>
          <div class="cover-meta">
            製表日期：${new Date().toLocaleDateString('zh-TW')}<br>
            資料來源：石門盤點系統 v7.1<br>
            總財產 ${total} 台 · 盤點進度 ${progressPct}%<br><br>
            <b>資訊組</b>
          </div>
        </div>
        <div class="report-footer">
          <span>Page 1 / 4</span>
          <span>https://cagoooo.github.io/smes-inventory/</span>
        </div>
      </div>
    `;

    // ========== Page 2: 總覽 + 進度 ==========
    const page2 = `
      <div class="report-page">
        <h1>📊 總覽與盤點進度</h1>
        <p>本月資訊科技財產現況、盤點進度與重點警示</p>

        <div class="kpi-box">
          <div class="kpi-item"><div class="kpi-label">總財產</div><div class="kpi-val">${total}</div><div class="kpi-unit">台</div></div>
          <div class="kpi-item acc"><div class="kpi-label">平均機齡</div><div class="kpi-val">${avgAge}</div><div class="kpi-unit">年</div></div>
          <div class="kpi-item dan"><div class="kpi-label">建議汰換</div><div class="kpi-val">${toReplace}</div><div class="kpi-unit">台 (≥8 年)</div></div>
          <div class="kpi-item suc"><div class="kpi-label">新穎設備</div><div class="kpi-val">${newDevice}</div><div class="kpi-unit">台 (&lt;3 年)</div></div>
        </div>

        <h2>📈 盤點進度</h2>
        <p>已完成拍照的教室 <b>${roomsWithPhoto.length}</b> / ${roomsWithInv.length} 間，總進度 <b>${progressPct}%</b></p>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progressPct}%">${progressPct}%</div>
        </div>

        <h2>🏢 各網段設備分佈</h2>
        <p>本系統已納入 Veyon 管理的網路設備共 150 台，分布於：</p>
        <table>
          <tr><th>網段</th><th>用途</th><th>設備數</th></tr>
          <tr><td>10.44.180.x</td><td>電腦教室（一 + 二）學生機 + 教師機</td><td>61 台</td></tr>
          <tr><td>10.36.180-183.x</td><td>教學/行政 教師機 + 公用機</td><td>85 台</td></tr>
          <tr><td>10.66.180-182.x</td><td>無線/移動觸控設備</td><td>4 台</td></tr>
        </table>

        <div class="note">
          💡 <b>建議事項：</b>平均機齡 ${avgAge} 年，其中 <b>${toReplace} 台已超過 8 年使用年限</b>，按照財政部政府公務機關電腦軟硬體設備年限，建議優先規劃汰換。
        </div>

        <div class="report-footer">
          <span>Page 2 / 4 · 總覽與進度</span>
          <span>桃園市石門國民小學</span>
        </div>
      </div>
    `;

    // ========== Page 3: 年度分佈 + 廠牌 ==========
    const page3 = `
      <div class="report-page">
        <h1>📅 設備年度分佈與廠牌分析</h1>

        <h2>各年度購置數量</h2>
        <p>依民國年份統計，紅色表示機齡 ≥ 8 年建議汰換</p>
        ${yearSort.map(y => {
          const age = CUR_ROC - y.year;
          const color = age >= 8 ? '#ff3b30' : age >= 5 ? '#ff9500' : '#34c759';
          const w = Math.round(y.count / maxYearCount * 100);
          return `<div class="bar-row">
            <span class="lbl"><b>${y.year}年</b> (${age}年前)</span>
            <div class="bar-outer"><div class="bar-inner" style="width:${w}%;background:${color};">${y.count} 台</div></div>
          </div>`;
        }).join('')}

        <h2>主要廠牌佔比 (TOP 8)</h2>
        <table>
          <tr><th>廠牌</th><th>台數</th><th>佔比</th><th>分佈情況</th></tr>
          ${brandSort.map(([b, c]) => `
            <tr>
              <td><b>${b}</b></td>
              <td>${c}</td>
              <td>${(c/total*100).toFixed(1)}%</td>
              <td><div style="width:100%;height:12px;background:#e0e7ef;border-radius:2px;"><div style="height:100%;width:${c/total*100}%;background:#0b63c5;border-radius:2px;"></div></div></td>
            </tr>
          `).join('')}
        </table>

        <div class="report-footer">
          <span>Page 3 / 4 · 年度與廠牌</span>
          <span>桃園市石門國民小學</span>
        </div>
      </div>
    `;

    // ========== Page 4: 汰換建議 + 預算 ==========
    const page4 = `
      <div class="report-page">
        <h1>💰 汰換建議與預算試算</h1>

        <h2>預算試算</h2>
        <table style="text-align:center;font-size:16px;">
          <tr>
            <th style="text-align:center;">需汰換台數</th>
            <th style="text-align:center;">每台預估單價</th>
            <th style="text-align:center;">總預算</th>
          </tr>
          <tr>
            <td style="font-size:24px;font-weight:700;">${toReplace} 台</td>
            <td style="font-size:18px;">NT$ ${budgetPerUnit.toLocaleString()}</td>
            <td style="font-size:24px;font-weight:700;color:#ff3b30;">NT$ ${totalBudget.toLocaleString()}</td>
          </tr>
        </table>

        <h2>🚨 最急需汰換 TOP 20（機齡 ≥ 10 年）</h2>
        <table>
          <tr><th>#</th><th>財產編號</th><th>機型</th><th>位置</th><th>取得年</th><th>機齡</th></tr>
          ${urgent.map((i, idx) => `
            <tr>
              <td>${idx+1}</td>
              <td style="font-family:monospace">${i.property_number || '-'}</td>
              <td>${i.brand || ''} ${i.model || ''}</td>
              <td>${i.classroom_code || i.location_text || '-'}</td>
              <td>${i.acquired_year ? i.acquired_year + '年' : '-'}</td>
              <td><span class="badge-old">${CUR_ROC - i.acquired_year} 年</span></td>
            </tr>
          `).join('')}
        </table>

        <div class="note">
          📋 <b>下月建議任務：</b><br>
          1. 完成剩餘 ${roomsWithInv.length - roomsWithPhoto.length} 間教室的實地拍照盤點<br>
          2. 確認 TOP 20 急需汰換設備的實際狀況（功能正常/故障/可用年限）<br>
          3. 依據預算額度（預估 NT$ ${totalBudget.toLocaleString()}）規劃下學期採購分批清單<br>
          4. 更新 Veyon 軟體設定以涵蓋新購設備
        </div>

        <div class="report-footer">
          <span>Page 4 / 4 · 汰換預算</span>
          <span>桃園市石門國民小學 · 資訊組</span>
        </div>
      </div>
    `;

    return page1 + page2 + page3 + page4;
  }

  window.SMES_MONTHLY_REPORT = { generate };
})();
