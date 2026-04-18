// QR Code 批次生成 PDF — 一鍵印財產標籤
// 用 QRious (QR 生成) + Canvas (中文字型) + jsPDF (PDF 組版)
// 版本 v7.2.4 — 改用 Canvas 渲染整張標籤，解決中文亂碼 + 跑板問題
console.log('[qr-labels] v7.2.4 loaded (Canvas+Chinese)');
(function() {
  // 常見標籤紙配置 (mm)
  // 為了讓文字區有足夠空間，縮小 QR 比例並留更寬的邊距
  const LABELS = {
    '50x30-A4': { pageW: 210, pageH: 297, cols: 4, rows: 9,  labelW: 50, labelH: 30,   marginX: 5,  marginY: 13.5, gapX: 0, gapY: 0, name: '50×30mm × 36 格 / 頁 (A4)' },
    '70x42-A4': { pageW: 210, pageH: 297, cols: 3, rows: 7,  labelW: 70, labelH: 42.3, marginX: 0,  marginY: 0,    gapX: 0, gapY: 0, name: '70×42mm × 21 格 / 頁 (A4)' },
    '80x50-A4': { pageW: 210, pageH: 297, cols: 2, rows: 5,  labelW: 80, labelH: 50,   marginX: 25, marginY: 20,   gapX: 0, gapY: 6, name: '80×50mm × 10 格 / 頁 (A4)' }
  };

  const DPI = 300;                   // 列印解析度 (300 DPI 印刷級)
  const MM_TO_PX = DPI / 25.4;       // 1 mm ≈ 11.81 px @ 300DPI

  // 中文字型 stack（優先 iOS/Mac PingFang → Windows 微軟正黑 → Noto 回退）
  const FONT_STACK_ZH = '"PingFang TC", "Heiti TC", "Microsoft JhengHei", "Noto Sans TC", "Noto Sans CJK TC", sans-serif';

  let pdfReady = false;

  async function ensureLibs() {
    if (pdfReady) return;
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    if (!window.QRious) {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js');
      } catch {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js');
      }
    }
    if (!window.QRious) throw new Error('QR Code 套件載入失敗，請檢查網路連線');
    // 等待系統字型就緒（避免 Canvas 用 fallback 字型繪製中文）
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch { /* ignore */ }
    }
    pdfReady = true;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = url; s.onload = resolve; s.onerror = () => reject(new Error('Load failed: ' + url));
      document.head.appendChild(s);
    });
  }

  // ========== 繪製單一標籤（Canvas）==========
  async function renderLabelCanvas(item, labelW_mm, labelH_mm) {
    const W = Math.round(labelW_mm * MM_TO_PX);
    const H = Math.round(labelH_mm * MM_TO_PX);

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 白底
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    // 框線（淡灰，列印時可見但不突兀）
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = Math.max(1, Math.round(0.15 * MM_TO_PX));
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);

    // ===== QR Code =====
    const padding_mm = 1.5;
    const qrMax_mm = Math.min(labelH_mm - padding_mm * 2, labelW_mm * 0.45);  // QR 最多佔寬度的 45%
    const qrSize_px = Math.round(qrMax_mm * MM_TO_PX);
    const padding_px = Math.round(padding_mm * MM_TO_PX);

    const qrContent = `${window.SMES_CONFIG?.QR_BASE_URL || 'https://cagoooo.github.io/smes-inventory'}?pn=${item.property_number || ''}`;
    const qr = new window.QRious({
      value: qrContent,
      size: qrSize_px,
      level: 'M',
      background: '#fff',
      foreground: '#000',
      padding: 0
    });
    const qrImg = new Image();
    qrImg.src = qr.toDataURL('image/png');
    await new Promise((resolve, reject) => {
      qrImg.onload = resolve;
      qrImg.onerror = reject;
    });
    // QR 垂直置中
    const qrY = Math.round((H - qrSize_px) / 2);
    ctx.drawImage(qrImg, padding_px, qrY, qrSize_px, qrSize_px);

    // ===== 文字區 =====
    const textX = padding_px + qrSize_px + Math.round(1.8 * MM_TO_PX);  // QR 右側 1.8mm 間距
    const textRight = W - padding_px;
    const textW = textRight - textX;

    // 字體大小（依標籤高度縮放）
    const fsPN   = Math.max(10, Math.round(labelH_mm * 0.16 * MM_TO_PX));  // 財產編號：16%
    const fsBrand = Math.max(8,  Math.round(labelH_mm * 0.11 * MM_TO_PX)); // 廠牌型號：11%
    const fsLoc   = Math.max(7,  Math.round(labelH_mm * 0.095 * MM_TO_PX));// 教室年份：9.5%

    // --- 財產編號（粗體 / 上方） ---
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${fsPN}px ${FONT_STACK_ZH}`;
    const pnY = Math.round(padding_mm * MM_TO_PX);
    const pnText = fitTextToWidth(ctx, item.property_number || '-', textW, fsPN, '700');
    ctx.fillText(pnText, textX, pnY);

    // --- 廠牌 + 型號（中等 / 可換行 2 行） ---
    ctx.fillStyle = '#333';
    ctx.font = `400 ${fsBrand}px ${FONT_STACK_ZH}`;
    const brandText = [item.brand, item.model].filter(Boolean).join(' ').trim();
    const lineH = Math.round(fsBrand * 1.25);
    const brandY = pnY + fsPN + Math.round(1.5 * MM_TO_PX);
    // 為位置列預留空間
    const brandMaxY = H - Math.round(padding_mm * MM_TO_PX) - fsLoc - Math.round(0.8 * MM_TO_PX);
    const maxLines = Math.max(1, Math.floor((brandMaxY - brandY) / lineH));
    wrapTextCJK(ctx, brandText, textX, brandY, textW, lineH, maxLines);

    // --- 教室 · 年份（小字 / 底部 / 灰色） ---
    ctx.fillStyle = '#777';
    ctx.textBaseline = 'bottom';
    ctx.font = `500 ${fsLoc}px ${FONT_STACK_ZH}`;
    const locParts = [];
    if (item.classroom_code) locParts.push(item.classroom_code);
    if (item.acquired_year) locParts.push(item.acquired_year + ' 年');
    const locText = fitTextToWidth(ctx, locParts.join('　·　'), textW, fsLoc, '500');
    ctx.fillText(locText, textX, H - Math.round(padding_mm * MM_TO_PX));

    return canvas.toDataURL('image/png');
  }

  // ========== 文字換行（CJK 一字一字切）==========
  function wrapTextCJK(ctx, text, x, y, maxW, lineH, maxLines) {
    if (!text) return;
    const chars = [...text];  // 用 spread 切 Unicode 碼點（支援 emoji / CJK 擴展區）
    const lines = [];
    let cur = '';
    for (let i = 0; i < chars.length; i++) {
      const test = cur + chars[i];
      if (ctx.measureText(test).width > maxW) {
        if (cur) {
          lines.push(cur);
          cur = chars[i];
        } else {
          // 單一字超寬 → 強制放
          lines.push(chars[i]);
          cur = '';
        }
        if (lines.length >= maxLines) {
          // 最後一行加 … 並把剩下截斷
          const remaining = chars.slice(i).join('');
          if (remaining.length > 1) {
            let last = lines[maxLines - 1];
            while (last.length > 0 && ctx.measureText(last + '…').width > maxW) {
              last = last.slice(0, -1);
            }
            lines[maxLines - 1] = last + '…';
          }
          break;
        }
      } else {
        cur = test;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);

    lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineH));
  }

  // 單行文字：若超寬則用 … 截斷
  function fitTextToWidth(ctx, text, maxW, fontSize, weight) {
    if (!text) return '';
    const originalFont = ctx.font;
    // font 已設好，量測即可
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 0 && ctx.measureText(t + '…').width > maxW) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  // ========== 產生 PDF ==========
  async function generate(items, layoutKey = '50x30-A4') {
    await ensureLibs();
    const layout = LABELS[layoutKey];
    if (!layout) throw new Error('未知的標籤配置：' + layoutKey);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });

    const perPage = layout.cols * layout.rows;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const posOnPage = i % perPage;
      if (i > 0 && posOnPage === 0) pdf.addPage();

      const col = posOnPage % layout.cols;
      const row = Math.floor(posOnPage / layout.cols);
      const x = layout.marginX + col * (layout.labelW + layout.gapX);
      const y = layout.marginY + row * (layout.labelH + layout.gapY);

      // 渲染整張標籤為 PNG，再貼到 PDF
      const pngData = await renderLabelCanvas(it, layout.labelW, layout.labelH);
      pdf.addImage(pngData, 'PNG', x, y, layout.labelW, layout.labelH, undefined, 'FAST');
    }

    const fileName = `石門財產QR標籤_${new Date().toISOString().slice(0,10)}_${items.length}張.pdf`;
    pdf.save(fileName);
    return fileName;
  }

  window.SMES_QR = { generate, LABELS };
})();
