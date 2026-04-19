// 觸屏 / PC 顯示輸出對照表
// 用於自動判定班級主機能否直接連接觸屏（HDMI / DP / VGA）
console.log('[touchscreen-ports] v7.2.8 loaded');
(function() {

  // ============ PC 型號 → 輸出埠對照表 ============
  // 每個 model 包含：hdmi, dp, vga, dvi (布林)
  // 資料來源：廠商官網規格書 + 實機確認 + 年代推估
  const PC_PORTS = {
    // === Acer Veriton 系列 ===
    'Acer M460':            { hdmi: false, dp: false, vga: true,  dvi: false, note: '2008 年骨董機，只剩 VGA' },
    'Acer M4610':           { hdmi: false, dp: false, vga: true,  dvi: true,  note: '極舊款' },
    'Acer Veriton M265':    { hdmi: false, dp: false, vga: true,  dvi: false, note: '2009 骨董' },
    'Acer Veriton M275':    { hdmi: false, dp: false, vga: true,  dvi: false, note: '2010 骨董' },
    'Acer Veriton M4460G':  { hdmi: true,  dp: true,  vga: true,  dvi: true  },
    'Acer Veriton M4630G':  { hdmi: false, dp: false, vga: true,  dvi: true,  note: '僅 VGA+DVI，無 HDMI/DP' },
    'Acer Veriton M4650G':  { hdmi: true,  dp: true,  vga: true,  dvi: true  },
    'Acer Veriton M4665G':  { hdmi: true,  dp: true,  vga: true,  dvi: true  },
    'Acer Veriton M4670G':  { hdmi: true,  dp: true,  vga: true,  dvi: false },
    'Acer Veriton M2640G':  { hdmi: true,  dp: false, vga: true,  dvi: false, note: '僅 HDMI+VGA，無 DP' },
    'Acer Veriton X4630G':  { hdmi: true,  dp: false, vga: true,  dvi: true  },
    'Acer Veriton S2680G':  { hdmi: true,  dp: true,  vga: true,  dvi: false },
    'Acer Veriton S2715G':  { hdmi: true,  dp: true,  vga: true,  dvi: false },
    'Acer Veriton K6690G':  { hdmi: true,  dp: true,  vga: true,  dvi: false },

    // === Lenovo ThinkCentre 系列 ===
    'Lenovo ThinkCentre M800':  { hdmi: false, dp: true,  vga: true,  dvi: false, note: '雙 DisplayPort + VGA，無 HDMI' },
    'Lenovo ThinkCentre M920t': { hdmi: true,  dp: true,  vga: false, dvi: false, note: 'HDMI + 雙 DP' },

    // === ASUS 系列 ===
    'ASUS MD710':           { hdmi: false, dp: false, vga: true,  dvi: true,  note: '2012 舊款，VGA+DVI' },
    'ASUS M640MB':          { hdmi: true,  dp: true,  vga: true,  dvi: false },
    'ASUS M700TA':          { hdmi: true,  dp: true,  vga: true,  dvi: false },
    'ASUS M700TE':          { hdmi: true,  dp: true,  vga: true,  dvi: false },
    'ASUS M700ME':          { hdmi: true,  dp: true,  vga: true,  dvi: false },
    'ASUS M900TA':          { hdmi: true,  dp: true,  vga: false, dvi: false },
    'ASUS M900MDR':         { hdmi: true,  dp: true,  vga: false, dvi: false, note: '新款，HDMI + 雙 DP' },
    'ASUS ESC500 G4':       { hdmi: false, dp: true,  vga: true,  dvi: true,  note: '工作站舊款，無 HDMI' },
    'ASUS E500 G9':         { hdmi: true,  dp: true,  vga: false, dvi: false, note: '新款工作站' },

    // === 自組 & 特殊 ===
    '自組桌機 Core i3-7100': { hdmi: true,  dp: false, vga: true,  dvi: true,  note: '主機板內顯：HDMI+DVI+VGA' },
    'Acer 桌機(含21.5吋螢幕)': { hdmi: true, dp: false, vga: true, dvi: false, note: 'AIO 一體機' },
    'Apple Mac mini':       { hdmi: true,  dp: true,  vga: false, dvi: false, note: 'HDMI + Thunderbolt (DP 相容)' },
    'OPS PC (互動牆專用)':   { hdmi: true,  dp: true,  vga: false, dvi: false, note: '內嵌互動觸屏 OPS 插槽' },

    // === ASUS 上網本 ===
    'ASUS EPC (上網本)':     { hdmi: false, dp: false, vga: true,  dvi: false, note: '骨董上網本，只有 VGA' },
  };

  // ============ 年代推估（fallback）============
  // 當型號不在清單：用購置民國年推估輸出埠
  function guessByYear(rocYear) {
    if (!rocYear) return { hdmi: false, dp: false, vga: true, dvi: false, note: '年份不詳，保守估計 VGA' };
    if (rocYear <= 100) return { hdmi: false, dp: false, vga: true,  dvi: false, note: '超舊機（101 年以前），僅 VGA' };
    if (rocYear <= 105) return { hdmi: false, dp: false, vga: true,  dvi: true,  note: '舊款（101-105），推估 VGA+DVI' };
    if (rocYear <= 110) return { hdmi: true,  dp: false, vga: true,  dvi: false, note: '推估 HDMI+VGA' };
    return                     { hdmi: true,  dp: true,  vga: true,  dvi: false, note: '推估 HDMI+DP+VGA' };
  }

  // 筆電判斷（通常都有 HDMI，少數新款有 USB-C DP）
  function guessLaptop(rocYear, modelName = '') {
    const isModern = rocYear && rocYear >= 110;
    return {
      hdmi: true,
      dp: isModern,  // 新款筆電通常有 USB-C（DP Alt mode）
      vga: false,
      dvi: false,
      note: isModern ? '筆電：HDMI + USB-C (DP Alt)' : '筆電：僅 HDMI'
    };
  }

  // ============ 主要查詢 API ============
  function portsOf(brand, model, rocYear) {
    if (!model) return guessByYear(rocYear);

    // 完全比對
    if (PC_PORTS[model]) return { ...PC_PORTS[model] };

    // 模糊比對（trim/空白差異）
    const key = model.trim();
    for (const k in PC_PORTS) {
      if (k.trim().toLowerCase() === key.toLowerCase()) return { ...PC_PORTS[k] };
    }

    // 筆電特徵
    if (/筆電|laptop|TravelMate|VivoBook|Aspire|ThinkPad|MacBook|PU\d|P\d{3}/i.test(model)) {
      return guessLaptop(rocYear, model);
    }

    return guessByYear(rocYear);
  }

  // ============ 連線建議（觸屏 ↔ PC）============
  // 觸屏：大部分支援 HDMI + DP (部分含 VGA)
  // PC：依 portsOf() 結果
  // 輸出：建議接線 + 相容性評級
  function connectionAdvice(pcPorts, ts) {
    const tsHDMI = ts.supports_hdmi !== false;
    const tsDP = ts.supports_dp !== false;
    const tsVGA = ts.supports_vga === true;

    // 最佳解：兩端都有 HDMI
    if (pcPorts.hdmi && tsHDMI) {
      return {
        level: 'best',
        cable: 'HDMI',
        text: '✅ 直接用 HDMI 線（最佳）',
        detail: 'PC 與觸屏都有 HDMI，一條 HDMI 線即可，含音訊。',
      };
    }
    // 次佳：兩端都有 DP
    if (pcPorts.dp && tsDP) {
      return {
        level: 'best',
        cable: 'DisplayPort',
        text: '✅ 直接用 DisplayPort (DP) 線',
        detail: 'PC 與觸屏都有 DP，一條 DP 線即可，含音訊。',
      };
    }
    // 可行：交叉 DP↔HDMI（同數位訊號，可用 DP→HDMI 主動轉接線）
    if (pcPorts.dp && tsHDMI) {
      return {
        level: 'ok',
        cable: 'DP→HDMI 主動轉接',
        text: '🔶 需 DP 轉 HDMI 主動線 / 轉接器',
        detail: 'PC 只有 DP、觸屏用 HDMI 輸入 → 買主動式 DP→HDMI 線材（被動線部分機型不支援），預算約 200-400 元。',
      };
    }
    if (pcPorts.hdmi && tsDP) {
      return {
        level: 'ok',
        cable: 'HDMI→DP 主動轉接',
        text: '🔶 需 HDMI 轉 DP 主動轉接器',
        detail: 'PC 只有 HDMI、觸屏只接受 DP → 必須用主動式轉換器（非被動線），預算約 600-1000 元。',
      };
    }
    // VGA fallback：老主機 → 觸屏
    if (pcPorts.vga && tsVGA) {
      return {
        level: 'warn',
        cable: 'VGA',
        text: '⚠️ 僅能用 VGA（類比訊號，畫質較差）',
        detail: '舊主機 + 觸屏支援 VGA → 可勉強接，但解析度/畫質有限，且 VGA 不含音訊（另接 3.5mm）。建議列入汰換。',
      };
    }
    if (pcPorts.vga && !tsVGA) {
      return {
        level: 'danger',
        cable: 'VGA→HDMI 主動轉換器',
        text: '❌ 需 VGA→HDMI 主動轉換器（不建議長期使用）',
        detail: '主機只有 VGA 輸出，觸屏又不支援 VGA → 必須用主動式 VGA→HDMI 訊號轉換器（類比轉數位），畫質有損且穩定性差，強烈建議汰換主機。',
      };
    }
    // DVI only
    if (pcPorts.dvi && tsHDMI) {
      return {
        level: 'ok',
        cable: 'DVI→HDMI 被動轉接',
        text: '🔶 需 DVI→HDMI 被動轉接',
        detail: 'PC 只有 DVI、觸屏用 HDMI → 被動線即可（DVI-D 與 HDMI 訊號相同），但無音訊，需另接。',
      };
    }
    return {
      level: 'danger',
      cable: '無法連接',
      text: '❌ 無可用共通介面',
      detail: 'PC 與觸屏介面不相容，建議汰換主機或更新觸屏。',
    };
  }

  // ============ 產生 HTML 片段（供 manage.js 用） ============
  function portsBadgeHTML(pcPorts) {
    const badge = (label, on, color) =>
      `<span class="port-pill" style="background:${on?color:'#e5e5ea'};color:${on?'#fff':'#8e8e93'};">${label}</span>`;
    return (
      badge('HDMI', pcPorts.hdmi, '#0a84ff') +
      badge('DP',   pcPorts.dp,   '#af52de') +
      badge('VGA',  pcPorts.vga,  '#ff9500') +
      (pcPorts.dvi ? badge('DVI', true, '#6e6e73') : '')
    );
  }

  window.SMES_TSPORTS = {
    portsOf,
    connectionAdvice,
    portsBadgeHTML,
    PC_PORTS,
  };
})();
