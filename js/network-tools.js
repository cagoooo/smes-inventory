// 網路工具：MAC 廠商辨識 + Excel 匯出 + IP 衝突偵測
console.log('[network-tools] v7.2.3 loaded');
(function() {
  // ============ OUI 精簡表（前 6 碼 → 廠商）============
  // 涵蓋校園常見設備廠商。資料來源：IEEE OUI registry
  const OUI_DB = {
    // Lenovo (ThinkCentre / IdeaPad / 電腦教室大宗)
    'CC-28-AA': 'Lenovo',
    '6C-4B-90': 'Lenovo',
    '00-21-CC': 'Lenovo',
    '24-7C-4C': 'Lenovo',
    'E0-94-67': 'Lenovo',
    // ASUSTek (教師機多數)
    '30-85-A9': 'ASUSTek',
    '4C-CC-6A': 'ASUSTek',
    '94-C6-91': 'ASUSTek',
    '18-31-BF': 'ASUSTek',
    '10-7C-61': 'ASUSTek',
    '50-46-5D': 'ASUSTek',
    '1C-87-2C': 'ASUSTek',
    'B0-6E-BF': 'ASUSTek',
    // Acer
    '14-DD-A9': 'Apple',
    '00-1E-52': 'Apple',
    'F4-0F-24': 'Apple',
    '34-C9-3D': 'Acer',
    '00-1D-92': 'Acer',
    '08-00-27': 'Oracle VirtualBox',
    // AzureWave (ASUS/Acer 無線網卡 OEM)
    'F4-4D-30': 'AzureWave',
    '00-24-D7': 'Intel (有線)',
    'F0-1F-AF': 'AzureWave',
    '40-B8-9A': 'AzureWave',
    'D4-BE-D9': 'AzureWave',
    // Intel (有線網卡)
    '04-D4-C4': 'Intel',
    '08-BF-B8': 'Intel',
    'A0-36-BC': 'Intel',
    '88-AE-DD': 'Intel',
    '04-92-26': 'Intel',
    'C0-3F-D5': 'Intel',
    // Realtek (整合網卡)
    '00-E0-4C': 'Realtek',
    '00-D8-61': 'Realtek',
    'BC-5F-F4': 'Realtek',
    // HP / Sercomm
    'F0-1F-AF': 'Dell',
    '40-16-7E': 'ASUSTek',
    '98-EE-CB': 'Acer',
    '00-15-61': 'HP',
    '2C-F0-5D': 'Realtek',
    'FC-19-28': 'iPTIME',
    // Chromebook / Google
    '00-1A-11': 'Google',
    // iOS / iPad
    'D4-61-37': 'Apple',
    // TP-Link
    'C4-6E-1F': 'TP-Link',
    'D8-47-32': 'TP-Link',
    // 常見的：AMPAK / LCFC / Nexwave / MediaTek...
    'CC-00-00': 'Cisco',
    '2C-8D-B1': 'Intel',
    '1C-69-7A': 'Acer / Elitegroup',
    '34-17-EB': 'Dell',
    'F4-4D-30': 'AzureWave',
    'E8-4E-06': 'EDUP',
    '00-80-8E': '古董設備（待確認）',
  };

  // 正規化 MAC：統一大寫 + hyphen + 只取前 3 組
  function normalizeMacPrefix(mac) {
    if (!mac) return null;
    const clean = mac.toUpperCase().replace(/[:.-]/g, '');
    if (clean.length < 6) return null;
    return clean.slice(0, 2) + '-' + clean.slice(2, 4) + '-' + clean.slice(4, 6);
  }

  function vendorOf(mac) {
    const prefix = normalizeMacPrefix(mac);
    if (!prefix) return null;
    return OUI_DB[prefix] || null;
  }

  // ============ IP 衝突偵測 ============
  function findIPConflicts(devices) {
    const byIP = {};
    devices.forEach(d => {
      if (!d.host_address) return;
      if (!byIP[d.host_address]) byIP[d.host_address] = [];
      byIP[d.host_address].push(d);
    });
    const conflicts = {};
    Object.entries(byIP).forEach(([ip, list]) => {
      if (list.length > 1) conflicts[ip] = list;
    });
    return conflicts;
  }

  function findMACConflicts(devices) {
    const byMAC = {};
    devices.forEach(d => {
      if (!d.mac_address) return;
      const k = d.mac_address.toUpperCase().replace(/[:.-]/g, '');
      if (!byMAC[k]) byMAC[k] = [];
      byMAC[k].push(d);
    });
    const conflicts = {};
    Object.entries(byMAC).forEach(([mac, list]) => {
      if (list.length > 1) conflicts[mac] = list;
    });
    return conflicts;
  }

  // ============ Excel 匯出 ============
  function exportToExcel(devices, filename) {
    if (!window.XLSX) {
      alert('Excel 套件尚未載入');
      return;
    }
    const rows = devices.map(d => ({
      '名稱': d.name || '',
      'IP 位址': d.host_address || '',
      'MAC 位址': d.mac_address || '',
      '廠商 (MAC OUI)': vendorOf(d.mac_address) || '未知',
      '網段': d.network_segment || '',
      '群組': d.group_name || '',
      '角色': ({
        computer_lab_student: '電腦教室學生',
        computer_lab_teacher: '電腦教室教師',
        classroom_teacher: '班級教師',
        classroom_public: '班級公用',
        admin_office: '行政',
        mobile_touch: '移動觸屏',
        unknown: '未分類'
      })[d.device_role] || d.device_role || '',
      '教室': d.classroom_code || '',
      '備註': d.notes || '',
      'Veyon UID': d.veyon_uid || ''
    }));

    const ws = window.XLSX.utils.json_to_sheet(rows);
    // 設定欄寬
    ws['!cols'] = [
      { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 14 },
      { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
      { wch: 20 }, { wch: 38 }
    ];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '網路設備');

    // 如果有衝突，額外加一頁
    const conflicts = findIPConflicts(devices);
    const conflictRows = [];
    Object.entries(conflicts).forEach(([ip, list]) => {
      list.forEach(d => {
        conflictRows.push({
          '衝突 IP': ip,
          '設備名稱': d.name,
          'MAC': d.mac_address,
          '網段': d.network_segment,
          '教室': d.classroom_code || ''
        });
      });
    });
    if (conflictRows.length) {
      const wsC = window.XLSX.utils.json_to_sheet(conflictRows);
      wsC['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 10 }];
      window.XLSX.utils.book_append_sheet(wb, wsC, '⚠️ IP 衝突');
    }

    const fname = filename || `石門網路設備_${new Date().toISOString().slice(0,10)}.xlsx`;
    window.XLSX.writeFile(wb, fname);
    return fname;
  }

  window.SMES_NETTOOLS = {
    vendorOf,
    normalizeMacPrefix,
    findIPConflicts,
    findMACConflicts,
    exportToExcel,
    OUI_DB
  };
})();
