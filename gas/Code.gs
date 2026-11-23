/**
 * 石門國小 電腦財產報廢點收 — GAS 後端
 * 前端：https://cagoooo.github.io/smes-inventory/scrap.html
 *
 * 安全：每個請求都要帶 Supabase 登入 token，後端向 Supabase 查使用者，
 *       只接受 @mail2.smes.tyc.edu.tw 學校帳號（與盤點系統同一套登入）。
 *       下面兩個值是盤點系統前端本來就公開的專案網址與 publishable key，不是密碼。
 */
var SUPABASE_URL = 'https://xcnmmaayrtiklntvhdhc.supabase.co';
var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_nDPdupsm5wZI20iddtf12w_iV82XILn';
var ALLOWED_DOMAIN = 'mail2.smes.tyc.edu.tw';

var SHEET_LIST = '報廢清單';
var SHEET_LOG = '辨識紀錄';
var PHOTO_FOLDER_NAME = '石門國小 電腦報廢點收照片';

var LIST_HEADERS = [
  '編號', '加入時間', '報廢批次', '財產編號', '財產名稱', '廠牌', '型號', '規格（含螢幕）',
  '取得日期', '機齡(年)', '原始單價', '存放地點', '保管人', '保管單位',
  '點到部件', '比對方式', '比對分數', 'AI 辨識摘要', '照片', '登錄者', '狀態', '備註'
];
var LOG_HEADERS = [
  '時間', '登錄者', '拍攝部件', 'AI 類型', 'AI 廠牌', 'AI 型號', 'AI 財產編號', 'AI 序號',
  'AI 民國年', 'AI 信心', '最佳比對財產編號', '最佳比對型號', '最佳比對分數', '候選數', '同型號台數'
];

// ================= 入口 =================
function doGet() {
  return json_({ ok: true, app: 'smes-scrap', time: now_() });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var email = verifyUser_(body.token);
    setup_();
    switch (body.action) {
      case 'whoami': return json_({ ok: true, email: email, sheetUrl: ss_().getUrl() });
      case 'list': return json_(listItems_(body.batch));
      case 'add': return json_(addItem_(body, email));
      case 'remove': return json_(setStatus_(body.id, '已移除', email));
      case 'restore': return json_(setStatus_(body.id, '待報廢', email));
      case 'update': return json_(updateItem_(body));
      case 'log': return json_(appendLog_(body, email));
      case 'purgeTestBatch': return json_(purgeTestBatch_(body.batch));
      default: return json_({ ok: false, error: '未知的動作：' + body.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ================= 驗證登入 =================
function verifyUser_(token) {
  if (!token) throw new Error('尚未登入，請重新整理頁面後登入學校帳號');
  var cache = CacheService.getScriptCache();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
  var key = 'u_' + Utilities.base64EncodeWebSafe(digest).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return hit;
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('登入已過期，請重新整理頁面');
  var email = String(JSON.parse(res.getContentText()).email || '').toLowerCase();
  if (email.slice(-(ALLOWED_DOMAIN.length + 1)) !== '@' + ALLOWED_DOMAIN) {
    throw new Error('此系統僅限 @' + ALLOWED_DOMAIN + ' 學校帳號');
  }
  cache.put(key, email, 600);
  return email;
}

// ================= 試算表初始化（冪等） =================
function ss_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function setup() { setup_(); return '完成：' + ss_().getUrl(); }

function setup_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SETUP_V') === '1') return;
  var ss = ss_();
  ss.setSpreadsheetTimeZone('Asia/Taipei');
  ensureSheet_(ss, SHEET_LIST, LIST_HEADERS, '#c2410c',
    [70, 120, 150, 90, 110, 70, 170, 260, 90, 70, 80, 100, 70, 80, 90, 90, 70, 220, 160, 170, 80, 160]);
  ensureSheet_(ss, SHEET_LOG, LOG_HEADERS, '#475569',
    [120, 170, 70, 70, 80, 160, 110, 120, 70, 60, 110, 170, 80, 60, 80]);
  var first = ss.getSheets()[0];
  if (first.getName() !== SHEET_LIST && first.getName() !== SHEET_LOG && first.getLastRow() === 0) {
    ss.deleteSheet(first);
  }
  ss.setActiveSheet(ss.getSheetByName(SHEET_LIST));
  ss.moveActiveSheet(1);
  props.setProperty('SETUP_V', '1');
}

function ensureSheet_(ss, name, headers, color, widths) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setFontColor('#ffffff').setBackground(color)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 30);
    widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.getRange('A:Z').setNumberFormat('@');
  }
  return sh;
}

function photoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 被刪掉就重建 */ }
  }
  var folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  try {
    var parent = DriveApp.getFileById(ss_().getId()).getParents();
    if (parent.hasNext()) folder.moveTo(parent.next());
  } catch (e) { /* 留在根目錄也可以 */ }
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

// ================= 報廢清單 =================
function readList_() {
  var sh = ss_().getSheetByName(SHEET_LIST);
  var last = sh.getLastRow();
  if (last < 2) return { sh: sh, rows: [] };
  var values = sh.getRange(2, 1, last - 1, LIST_HEADERS.length).getDisplayValues();
  var rows = values.map(function (v, i) {
    var o = { _row: i + 2 };
    LIST_HEADERS.forEach(function (h, j) { o[h] = v[j]; });
    return o;
  });
  return { sh: sh, rows: rows };
}

function toClient_(o) {
  return {
    id: o['編號'], addedAt: o['加入時間'], batch: o['報廢批次'], propertyNumber: o['財產編號'],
    itemName: o['財產名稱'], brand: o['廠牌'], model: o['型號'], spec: o['規格（含螢幕）'],
    acquiredDate: o['取得日期'], age: o['機齡(年)'], price: o['原始單價'], location: o['存放地點'],
    keeper: o['保管人'], unit: o['保管單位'], parts: o['點到部件'], method: o['比對方式'],
    score: o['比對分數'], aiSummary: o['AI 辨識摘要'], photos: o['照片'], by: o['登錄者'],
    status: o['狀態'], note: o['備註']
  };
}

function listItems_(batch) {
  var data = readList_();
  var batches = {};
  var items = [];
  data.rows.forEach(function (o) {
    if (o['狀態'] === '已移除') return;
    var b = o['報廢批次'] || '(未分批)';
    batches[b] = (batches[b] || 0) + 1;
    if (!batch || o['報廢批次'] === batch) items.push(toClient_(o));
  });
  return { ok: true, items: items, batches: batches, sheetUrl: ss_().getUrl() };
}

function mergeParts_(a, b) {
  var set = {};
  String(a || '').split('、').concat(String(b || '').split('、')).forEach(function (p) {
    p = p.trim(); if (p) set[p] = true;
  });
  var order = ['主機', '螢幕', '財產標籤', '其他'];
  return Object.keys(set).sort(function (x, y) {
    var ix = order.indexOf(x), iy = order.indexOf(y);
    return (ix < 0 ? 9 : ix) - (iy < 0 ? 9 : iy);
  }).join('、');
}

function savePhoto_(b64, name) {
  if (!b64) return '';
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name + '.jpg');
  return photoFolder_().createFile(blob).getUrl();
}

function addItem_(body, email) {
  var it = body.item || {};
  var pn = String(it.propertyNumber || '').trim();
  if (!pn) throw new Error('缺少財產編號');
  var batch = String(body.batch || '').trim() || '未命名批次';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = readList_();
    var sh = data.sh;
    var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');
    var photoUrl = savePhoto_(body.photo, batch + '_' + pn + '_' + (body.part || '') + '_' + stamp);
    var existing = data.rows.filter(function (o) {
      return o['財產編號'] === pn && o['報廢批次'] === batch && o['狀態'] !== '已移除';
    })[0];

    if (existing) {
      var c = function (h) { return LIST_HEADERS.indexOf(h) + 1; };
      sh.getRange(existing._row, c('點到部件')).setValue(mergeParts_(existing['點到部件'], body.part));
      if (photoUrl) {
        sh.getRange(existing._row, c('照片')).setValue([existing['照片'], photoUrl].filter(String).join('\n'));
      }
      if (body.note) {
        sh.getRange(existing._row, c('備註')).setValue([existing['備註'], body.note].filter(String).join('；'));
      }
      var fresh = readList_().rows.filter(function (o) { return o._row === existing._row; })[0];
      return { ok: true, merged: true, item: toClient_(fresh) };
    }

    var row = [
      Utilities.getUuid().slice(0, 8), now_(), batch, pn, it.itemName || '', it.brand || '', it.model || '',
      it.spec || '', it.acquiredDate || '', it.age === 0 || it.age ? String(it.age) : '',
      it.price === 0 || it.price ? String(it.price) : '', it.location || '', it.keeper || '', it.unit || '',
      mergeParts_('', body.part), body.method || '', body.score === 0 || body.score ? String(body.score) : '',
      body.aiSummary || '', photoUrl, email, '待報廢', body.note || ''
    ];
    writeRow_(sh, row);
    var obj = {};
    LIST_HEADERS.forEach(function (h, j) { obj[h] = row[j]; });
    return { ok: true, merged: false, item: toClient_(obj) };
  } finally {
    lock.releaseLock();
  }
}

function findRow_(id) {
  if (!id) throw new Error('缺少編號');
  var data = readList_();
  var o = data.rows.filter(function (r) { return r['編號'] === id; })[0];
  if (!o) throw new Error('找不到這筆資料（可能已在試算表被刪除）');
  return { sh: data.sh, o: o };
}

function setStatus_(id, status, email) {
  var f = findRow_(id);
  f.sh.getRange(f.o._row, LIST_HEADERS.indexOf('狀態') + 1).setValue(status);
  if (status === '已移除') {
    var noteCol = LIST_HEADERS.indexOf('備註') + 1;
    f.sh.getRange(f.o._row, noteCol).setValue(
      [f.o['備註'], '由 ' + email + ' 於 ' + now_() + ' 移除'].filter(String).join('；'));
  }
  return { ok: true };
}

function updateItem_(body) {
  var f = findRow_(body.id);
  if (typeof body.parts === 'string') {
    f.sh.getRange(f.o._row, LIST_HEADERS.indexOf('點到部件') + 1).setValue(mergeParts_('', body.parts));
  }
  if (typeof body.note === 'string') {
    f.sh.getRange(f.o._row, LIST_HEADERS.indexOf('備註') + 1).setValue(body.note);
  }
  return { ok: true };
}

// ================= 辨識紀錄 =================
function appendLog_(body, email) {
  var a = body.ai || {};
  var m = body.best || {};
  writeRow_(ss_().getSheetByName(SHEET_LOG), [
    now_(), email, body.part || '', a.photo_type || '', a.brand || '', a.model || '',
    a.property_number || '', a.serial_number || '', a.roc_year ? String(a.roc_year) : '',
    a.confidence === 0 || a.confidence ? String(a.confidence) : '',
    m.propertyNumber || '', m.model || '', m.score === 0 || m.score ? String(m.score) : '',
    String(body.candidateCount || 0), String(body.sameModelCount || 0)
  ]);
  return { ok: true };
}

// ================= 工具 =================
// 先把整列設成純文字再寫入，避免「000812」被試算表轉成數字 812、「105/10/20」被轉成日期
function writeRow_(sh, row) {
  var r = sh.getLastRow() + 1;
  var rng = sh.getRange(r, 1, 1, row.length);
  rng.setNumberFormat('@');
  rng.setValues([row.map(function (v) { return v === null || v === undefined ? '' : String(v); })]);
  return r;
}

// 只允許清除「【測試】」開頭的批次（系統驗證用），連同照片一起移到垃圾桶
function purgeTestBatch_(batch) {
  if (String(batch || '').indexOf('【測試】') !== 0) throw new Error('只能清除【測試】開頭的批次');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = readList_();
    var rows = data.rows.filter(function (o) { return o['報廢批次'] === batch; });
    var trashed = 0;
    rows.forEach(function (o) {
      String(o['照片'] || '').split(/\s+/).forEach(function (u) {
        var m = u.match(/\/d\/([-\w]{20,})/);
        if (m) { try { DriveApp.getFileById(m[1]).setTrashed(true); trashed++; } catch (e) {} }
      });
    });
    rows.sort(function (a, b) { return b._row - a._row; }).forEach(function (o) { data.sh.deleteRow(o._row); });
    return { ok: true, deleted: rows.length, photosTrashed: trashed };
  } finally {
    lock.releaseLock();
  }
}
function now_() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'); }

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
