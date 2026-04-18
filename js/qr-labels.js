// QR Code 批次生成 PDF — 一鍵印財產標籤
// 用 QRious + jsPDF (CDN)
// 版本 v7.2.2b — 若主控台看到這行代表載入的是新版
console.log('[qr-labels] v7.2.2b loaded (QRious)');
(function() {
  const LABELS = {
    // 常見標籤紙配置 (mm)
    '50x30-A4': { pageW: 210, pageH: 297, cols: 4, rows: 9, labelW: 50, labelH: 30, marginX: 5, marginY: 13.5, gapX: 0, gapY: 0, name: '50×30mm × 36 格 / 頁 (A4)' },
    '70x42-A4': { pageW: 210, pageH: 297, cols: 3, rows: 7, labelW: 70, labelH: 42.3, marginX: 0, marginY: 0, gapX: 0, gapY: 0, name: '70×42mm × 21 格 / 頁 (A4)' },
    '80x50-A4': { pageW: 210, pageH: 297, cols: 2, rows: 5, labelW: 80, labelH: 50, marginX: 25, marginY: 20, gapX: 0, gapY: 6, name: '80×50mm × 10 格 / 頁 (A4)' }
  };

  let selectedItems = [];
  let pdfReady = false;

  async function ensureLibs() {
    if (pdfReady) return;
    // 動態載入 jsPDF + QRious (更穩定的瀏覽器 QR 庫)
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    // QRious fallback 多個 CDN，避免某個 CDN 失效
    if (!window.QRious) {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js');
      } catch {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js');
      }
    }
    if (!window.QRious) {
      throw new Error('QR Code 套件載入失敗，請檢查網路連線');
    }
    pdfReady = true;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Load failed: ' + url));
      document.head.appendChild(s);
    });
  }

  async function qrDataURL(text, size = 200) {
    const qr = new window.QRious({
      value: text,
      size,
      level: 'M',  // 錯誤糾正等級：L/M/Q/H
      background: '#fff',
      foreground: '#000',
      padding: 0
    });
    return qr.toDataURL('image/png');
  }

  async function generate(items, layoutKey = '50x30-A4') {
    await ensureLibs();
    const layout = LABELS[layoutKey];
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

    const perPage = layout.cols * layout.rows;
    let index = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const posOnPage = i % perPage;
      if (i > 0 && posOnPage === 0) pdf.addPage();

      const col = posOnPage % layout.cols;
      const row = Math.floor(posOnPage / layout.cols);
      const x = layout.marginX + col * (layout.labelW + layout.gapX);
      const y = layout.marginY + row * (layout.labelH + layout.gapY);

      // === 繪製單一標籤 ===
      // 方框
      pdf.setDrawColor(220);
      pdf.setLineWidth(0.2);
      pdf.rect(x, y, layout.labelW, layout.labelH);

      // QR Code（內容為財產編號 + URL，讓掃完可直接開網頁）
      const qrContent = `${window.SMES_CONFIG?.QR_BASE_URL || 'https://cagoooo.github.io/smes-inventory'}?pn=${it.property_number}`;
      const qrImg = await qrDataURL(qrContent, 160);
      const qrSize = Math.min(layout.labelH - 4, 24);
      pdf.addImage(qrImg, 'PNG', x + 2, y + 2, qrSize, qrSize);

      // 文字區（右側或下方）
      const textX = x + qrSize + 4;
      const textW = layout.labelW - qrSize - 6;
      pdf.setTextColor(0);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text(it.property_number || '-', textX, y + 6);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      const brand = (it.brand || '') + ' ' + (it.model || '');
      pdf.text(splitText(brand, 22), textX, y + 11);

      pdf.setFontSize(6);
      pdf.setTextColor(100);
      const locLine = `${it.classroom_code || ''} ${it.acquired_year ? '· '+it.acquired_year+'年' : ''}`;
      pdf.text(locLine, textX, y + layout.labelH - 3);

      index++;
    }

    // 封面頁在最後加（避免影響索引）
    const fileName = `石門財產QR標籤_${new Date().toISOString().slice(0,10)}_${items.length}張.pdf`;
    pdf.save(fileName);
    return fileName;
  }

  function splitText(text, maxChars) {
    if (!text) return '';
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 1) + '…';
  }

  window.SMES_QR = { generate, LABELS };
})();
