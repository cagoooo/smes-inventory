# 📍 石門盤點系統 · 產品 Roadmap

> 最後更新：2026-04-18
> 目前版本：**v7.2.6 — 手機拍照主頁 UI 修正 + 更新橫幅全寬化**
> 部署網址：https://cagoooo.github.io/smes-inventory/
> **登入系統已完成實測，任何非 `@mail2.smes.tyc.edu.tw` 帳號會被自動登出**

## 🏆 系統能力里程碑

| 版本 | 日期 | 核心能力 | 累積工時 |
|:---:|:---:|:---|:---:|
| v1.0 | 04-18 | MVP：拍照 + Gemini 辨識 + Excel 匯入匯出 | 6h |
| v2.0 | 04-18 | Edge Function 代理，API Key 藏後端 | 1h |
| v3.0 | 04-18 | 手機優先 iOS 風 UI + PWA manifest | 3h |
| v4.0 | 04-18 | 桌機雙欄 RWD + 拖放 + 快捷鍵 | 2h |
| v5.0 | 04-18 | Google OAuth + 平面圖 + QR + 進度條 + 連拍 | 5h |
| v6.0 | 04-18 | Chart.js 儀表板 + 熱度地圖 + 預算試算 | 2h |
| v7.0 | 04-18 | Service Worker 離線 + Live 相機 + 九宮格 | 3h |
| v7.1 | 04-18 | Rate Limit + QR 批次 + 壽命預測 + 錯誤監控 + 自動備份 + IP 欄位 | 3h |
| v7.2 | 04-18 | Veyon 網路整合 (150 台 IP/MAC) + 月報表 PDF 一鍵產生 | 2h |
| v7.2.1 | 04-18 | 修復 Auth 無限 reload bug + Veyon JSON 匯出 + 差異比對工具 | 1h |
| v7.2.2 | 04-18 | 修復 QR PDF 產生失敗 (qrious) + PWA 版本查詢字串 | 0.5h |
| v7.2.3 | 04-18 | MAC 廠商 OUI 辨識 + IP 衝突偵測 + 篩選結果 Excel 匯出 + pwa-cache-bust skill | 1h |
| v7.2.4 | 04-18 | QR 標籤 PDF 改用 Canvas 渲染（修復中文亂碼 + 跑板 + 自動換行截斷） | 0.5h |
| v7.2.5 | 04-18 | 平面圖北側走廊手機橫向捲動 + 管理後台全分頁深度 RWD 優化 | 1h |
| v7.2.6 | 04-18 | 修復手機拍照主頁：隱藏桌機專用元件 + 更新橫幅不再擋內容 | 0.5h |
| **現況** | | **31.5 小時內打造完整學校資訊管理系統** | **~31.5h** |

---

## 📊 進度表（已完成）

### 🔧 v7.2.6 — 手機拍照主頁 UI 修正 (2026-04-18)

> 問題：iPhone 開 index.html 看到一堆**本應只給桌機看的元件**：
> 1. 「拍攝/選擇照片 Space」桌機按鈕
> 2. `<input type="file">` native 控制元件（「選擇檔案 尚未選取檔案」）
> 3. 紫色「Live 相機」大按鈕
> 4. 「拖曳照片到此區域」區塊
>
> 再加上「新版已推出」橫幅因為用 pill 形狀 + 置中絕對定位，長文字擠成 6 行擋住統計卡。

- ✅ **`.desktop-capture-bar` / `.drop-zone` 預設 `display: none`**
  - 原本這兩個樣式寫在 `@media (min-width: 900px)` 內，只「新增」而沒「預設隱藏」
  - 改為預設隱藏 → 900px 以上再顯示
- ✅ **`.btn-capture-inline > input[type="file"]` 全域 `display: none !important`**
  - 防止 native file input 跑出來
- ✅ **更新橫幅手機全寬化**
  - 原本 pill 形 + `left: 50%; translateX(-50%)` 導致長文字撐爆
  - 手機改為 `left: 8px; right: 8px` 全寬橫幅
  - 內文 2 行自動截斷 `-webkit-line-clamp: 2`
- ✅ **Hero 教室卡換教室按鈕**
  - padding-right: 88px 預留按鈕空間不重疊教室名稱
  - 手機 name 從 28px → 24px

### 📱 v7.2.5 — 手機端全面 RWD 優化 (2026-04-18)

> 問題：
> 1. iPhone 開平面圖，三樓/二樓/一樓北側走廊（8-11 間教室一排）**跑出畫面**
> 2. 管理後台 7 個分頁幾乎沒為手機端做過 RWD，篩選列全擠在一起

- ✅ **平面圖水平走廊橫向捲動**
  - `.fp-block-h` 加 `overflow-x: auto` + `-webkit-overflow-scrolling: touch`
  - 右緣漸層提示還有內容（`::after` with gradient）
  - `scroll-snap-type: x proximity` 捲動時自動對齊教室格
  - 教室名稱超長自動 ellipsis 2 行截斷
- ✅ **管理後台 `.toolbar-row` 通用工具列**
  - 桌面水平排列 → 手機自動堆疊、每個元件撐滿全寬
  - `.toolbar-input` / `.toolbar-select` 統一樣式（符合 iOS Human Interface）
  - 套用位置：Veyon 匯出、網路篩選、QR 篩選、照片篩選、財產篩選
- ✅ **手機專屬 RWD 深度優化（≤ 640px）**
  - Tab bar 壓縮（7 個分頁保持可捲動，字體 12.5px）
  - Stat grid 強制 2 欄，val 字體從 26px → 22px
  - KPI grid 字體縮小、padding 緊湊
  - 網路 3 欄 KPI（10.44 / 10.36 / 10.66）強制 3 欄但內文縮小不擠
  - Data table 字體 13 → 12px、padding 10 → 8px
  - MAC 欄位 monospace 更小字體避免換行
  - QR list 強制 1 欄、狀態列按鈕全寬
  - Budget 試算 slider label 縮小
  - 匯入欄位對應 fieldMap 1→2 欄，超小機變 1 欄
- ✅ **iPhone SE 專屬（≤ 360px）**
  - 進一步縮小數字、tab 按鈕、fieldMap 單欄

### 🏷️ v7.2.4 — QR 標籤 PDF 修復 (2026-04-18)

> 問題：印出來的 PDF 中文變亂碼（「99年」變「99²g,」）、文字跑出標籤框。
> 根因：jsPDF 內建 helvetica 字型**不支援中文**；用絕對座標放文字沒考量實際寬度。

- ✅ **改用 Canvas 渲染整張標籤** → 再當 PNG 圖貼進 PDF
  - 中文完美渲染（PingFang TC / 微軟正黑 / Noto Sans TC 系統字型堆疊）
  - 300 DPI 印刷級解析度，QR Code 掃描清晰
  - 等 `document.fonts.ready` 再繪製，避免 fallback 字型
- ✅ **文字自動排版**
  - 財產編號：粗體、上方、超寬自動截斷 …
  - 廠牌+型號：CJK 一字一字換行、最多 N 行（依標籤高度動態計算）
  - 教室·年份：底部灰字、超寬截斷
- ✅ **版面修正**
  - QR Code 垂直置中、最多佔寬 45%（留足文字空間）
  - 文字區右邊界嚴格不超出標籤框

### 🌐 v7.2.3 — 網路管理工具強化 (2026-04-18)

> 目標：讓網管廠商可以直接把系統匯出的 Excel 拿來施工，不用再比對 Veyon + 電腦清單兩張表。

- ✅ **MAC 廠商自動辨識（OUI 查詢）**
  - 內建常見 OUI 表：Lenovo / ASUSTek / Apple / Acer / Intel / Realtek / AzureWave / HP / TP-Link / Cisco…
  - MAC 前 3 組（前 6 碼）即時查對應廠商
  - 網路列表新增「廠商」欄位（pill 標籤樣式）
  - 可依廠商排序 / 搜尋
- ✅ **IP 衝突偵測**
  - 同一 IP 被多台設備使用時自動列為衝突
  - 頂部紅色警示 banner 顯示所有衝突 IP（點擊捲動到該設備）
  - 衝突列表背景標紅 + IP 欄位加 ⚠ badge
- ✅ **篩選結果 Excel 匯出**
  - 「📊 匯出 Excel」按鈕，匯出目前網段/群組/角色/搜尋篩選後的結果
  - 欄位：名稱、IP、MAC、廠商、網段、群組、角色、教室、備註、Veyon UID
  - 若有 IP 衝突自動多加一頁「⚠️ IP 衝突」列表
- ✅ **pwa-cache-bust skill**（`~/.claude/skills/pwa-cache-bust/SKILL.md`）
  - 讓 Claude 下次遇到「改了 JS 但使用者看舊版」的問題時自動套用版本查詢字串修法
  - 內建 10 項常見陷阱對照表（無限 reload、opaque response、iOS Safari 7 天清 SW…）

### ✅ v1.0 — 核心 MVP (2026-04-18)
| 項目 | 狀態 |
|------|:---:|
| Supabase 專案建立 + schema (classrooms / inventory_items / photo_records / storage bucket) | ✅ |
| 83 間教室資料從 PDF 整理並匯入 | ✅ |
| 247 筆電腦主機財產從 Excel 匯入（246 筆自動對應教室代碼） | ✅ |
| 首頁拍照上傳介面（手機可拍、可選檔） | ✅ |
| Gemini 2.5 Flash 視覺辨識（廠牌/型號/財產編號/民國年） | ✅ |
| 圖片自動壓縮 1600px JPEG | ✅ |
| 財產編號/型號雙重交叉比對建議 | ✅ |
| 管理後台：統計 / 拍照紀錄 / 教室狀態 / 財產清冊 | ✅ |
| Excel 匯入泛用欄位對應器 | ✅ |
| Excel 匯出功能 | ✅ |
| GitHub Pages 部署 | ✅ |
| 老舊機器色塊提示（≥8 年紅 / ≥5 年橘 / <5 年綠） | ✅ |

### 🔐 v2.0 — 安全性升級
- Supabase Edge Function `gemini-proxy` 部署
- Gemini API Key 移到後端 Supabase Vault
- CORS + Origin 白名單保護（只允許 cagoooo.github.io）
- 前端備援：若 proxy 失效可退回本機 Key 模式

### 📱 v3.0 — 手機優先 UI
- iOS 風設計系統（SF Color / safe-area / 毛玻璃 backdrop-filter）
- 底部固定大按鈕（拇指可及）
- Bottom Sheet 教室選擇器（下拉手勢可關）
- 最近使用教室 chips（記憶 6 筆）
- 自動辨識（拍完立刻送 Gemini，不用再按按鈕）
- 觸覺回饋 navigator.vibrate
- 深色模式自動跟隨系統
- PWA：manifest.json + icon.svg（可加到 iPhone 主畫面）
- 最小觸控區 48×48px（符合 Apple HIG）

### 🔐 v5.0 — 登入 + 平面圖 + QR + 進度條 + 連拍 (2026-04-18) ✅ 全部部署上線
- **Google OAuth 登入**（限 `@mail2.smes.tyc.edu.tw` 網域）✅ 實測通過
  - Supabase Auth + JS SDK
  - Google Workspace `hd` 參數（後端強制網域）— 已驗證：登入頁只顯示 `@mail2.smes.tyc.edu.tw` 帳號
  - 前端 domain 檢查（前端防線）
  - `created_by` 欄位記錄每筆拍照是誰拍的
  - profile 自動建立 trigger — 已驗證：`ipad@mail2.smes.tyc.edu.tw` 首登入後 `profiles.domain_ok=true`
  - RLS 升級：anon policies 已移除，只有 authenticated 角色可讀寫
  - Google Cloud 專案：`smes-e1dc3`、OAuth Client ID `626362737802-nv8ce12...`
  - Chrome MCP 全自動化完成 OAuth Client 建立 + Supabase Provider 啟用 + URL Configuration
- **教室平面圖可視化**（點教室直接選）
  - 3 樓 + 2 樓 + 1 樓 + 幼兒園
  - 依區塊（北走廊 / 東翼 / 西翼）排列
  - 顏色顯示進度：🔴 未拍 / 🟡 部分 / 🟢 完成 / ⚪ 無財產
  - 切換檢視：📋 清單 ↔ 🗺 平面圖
- **盤點進度條**
  - 全校進度（教室完成數 + 總台數）
  - 本教室進度（已拍 / 財產總數 + 百分比）
  - 漸層色：紅→橘→藍→綠
- **連續拍照模式**（iOS toggle 開關）
  - 儲存後自動開相機繼續拍
  - 適合一次盤點同教室多台電腦
- **QR Code 掃描**
  - html5-qrcode 套件
  - 掃描標籤直接帶入財產編號（省 Gemini Token）
  - 自動查詢財產清冊顯示對應紀錄

### 🖥️ v4.0 — 桌機 RWD
- 5 個響應式斷點（640 / 641-899 / 900-1279 / 1280 / 1600）
- 桌機 inline 大型拍照按鈕 + 拖放上傳區
- Bottom Sheet 桌機變成 center Modal
- Hero 教室卡橫向展開
- 紀錄列表自動多欄格狀（2-3 欄）
- Hover 效果 + data-tooltip 提示
- 鍵盤快捷鍵：⌘K / Space / ⌘Enter / Esc
- 整頁拖放照片（非僅拖放區）
- 列印樣式（@media print）
- 快捷鍵說明 Modal

---

## 🎯 v5.0 建議優先清單 ✅ 已全部完成（2026-04-18）

> ~~這些是馬上開始用就會感覺到差異的項目~~ **已實作**

### 🔴 P0 ✅ 已完成
| 任務 | 狀態 |
|------|:----:|
| Google OAuth 登入 | ✅ v5.0 |
| 教室平面圖可視化 | ✅ v5.0 |
| 盤點進度條 | ✅ v5.0 |
| 連續拍照模式 | ✅ v5.0 |
| QR Code 掃描 | ✅ v5.0 |

### 🟡 P1（建議做）
| 任務 | 價值 | 難度 | 估時 |
|------|:---:|:---:|:---:|
| **差異報表**（財產表有但未拍到 / 拍到但非在冊 → 自動列表） | ★★★★ | 中 | 3h |
| **AI 自動比對**（信心度≥0.9 自動選比對，不用手動點） | ★★★★ | 易 | 1h |
| **汰換規劃儀表板**（按年齡分級 + 預算試算） | ★★★ | 中 | 4h |
| **批次匯入照片**（從電腦一次選 20+ 張，後台批次辨識） | ★★★ | 中 | 3h |
| **快速重拍**（舊紀錄點「重拍」自動帶入原教室 + 原資料） | ★★★ | 易 | 1h |

---

## ✅ v7.0 — 離線模式 + Live 相機（2026-04-18 完成）

### 📴 離線模式 (PWA Service Worker)
- ✅ `sw.js` — cache-first 靜態資源（HTML/CSS/JS/CDN），network-first Supabase API
- ✅ IndexedDB 離線佇列（pending_photos store）
  - 訊號不好時拍照自動存 IndexedDB
  - 網路恢復 / 切回 App / Background Sync 自動重試上傳
  - 失敗次數記錄 (attempts)，連續失敗會保留不丟
- ✅ 離線狀態 Badge：頂部固定小膠囊顯示「📴 離線中」或「📤 N 筆待上傳」
- ✅ PWA Badge API（iOS 16.4+ 主畫面 icon 上顯示待傳數字）
- ✅ Cache-first 策略：第二次打開網站幾乎瞬開
- ✅ 照片 Stale-while-revalidate：歷史紀錄照片永續快取

### 📸 Live 相機增強
- ✅ getUserMedia 全螢幕相機（不跳出 iOS 系統相機）
- ✅ 九宮格對齊輔助線（可開關）
- ✅ 中央取景框（200-340px 依螢幕大小）
- ✅ 即時曝光偵測（600ms 頻率）：
  - 過暗 (亮度 <60) 提示「光線偏暗，建議開燈」
  - 過曝 (亮度 >210) 提示「過曝 · 遠離強光」
  - 反光點 >5% 提示「偵測到反光 · 調整角度」
  - 正常 ✓ 綠底顯示「光線合宜」
- ✅ 拍照閃光效果 + 震動回饋
- ✅ iOS 多層 getUserMedia fallback（ideal→exact→basic）
- ✅ 相機開啟失敗具體錯誤提示（NotAllowedError/NotFoundError/NotReadableError）

### 🍎 iOS Safari 相容性
- ✅ Service Worker skipWaiting 確保更新立即生效
- ✅ Background Sync 不支援時的 visibility+online 事件備援
- ✅ `<video playsinline>` 屬性避免全螢幕自動接管
- ✅ navigator.vibrate / setAppBadge 都 try/catch 保護
- ✅ HTTPS 強制檢查（localhost 例外）
- ✅ apple-touch-icon + apple-mobile-web-app-capable 加主畫面 OK

## ✅ v6.0 — 進階分析與視覺化（2026-04-18 完成）

- ✅ **全校財產儀表板**（Chart.js 4.4）
  - 🥧 廠牌佔比 (doughnut)
  - ⚠️ 汰換急迫性分布 (doughnut with ★★★/★★☆/★☆☆/✓)
  - 📅 年度購置台數柱狀圖（依機齡自動上色：紅/橘/綠）
  - 📉 機齡分佈五級分類（0-2 / 3-4 / 5-7 / 8-11 / 12+ 年）
  - 🏫 教室設備 TOP 10 水平柱狀圖
  - 🏢 保管單位佔比 polar area
- ✅ **熱度地圖**：延伸 floorplan.js 的 5 級藍色深淺（空/稀/低/中/密）
- ✅ **預算試算工具**：雙 slider（汰換年數 3-18、單價 15k-45k），即時計算總預算 + 按廠牌分配
- ✅ **設備壽命統計表**：同機型的平均/最老/最新機齡 + 汰換建議色塊
- ✅ **KPI 條**：總台數 / 平均機齡 / 建議汰換 / 新穎設備

## 🎯 v8.0 建議優先清單（下個衝刺，約 10 小時）

> 做完 v1-v7 已達「單人專業盤點工具」的水準。v8 的關鍵是讓**整個學校都能一起用**。

### 🔴 P0 強烈建議
| 任務 | 價值 | 難度 | 估時 | 為什麼急 |
|------|:---:|:---:|:---:|---|
| **多財產類別擴充** | ★★★★★ | 中 | 3h | 現在只有電腦主機，無法盤螢幕/印表機/iPad。做完後系統總價值翻倍 |
| **角色分層（admin/editor/viewer）** | ★★★★★ | 中 | 2h | 導師只能看自己班、主任只能讀、資訊組全權。資安合規第一步 |
| **月報表一鍵 PDF** | ★★★★★ | 易 | 2h | 主任要的東西。按一鍵產出「本月盤點進度 + 汰換建議 + 預算」PDF |
| **盤點排程 + Email 提醒** | ★★★★ | 中 | 2h | 每學期自動排「本週要拍哪幾間」，發信給導師 |
| **批次操作**（多選修改/刪除/匯出） | ★★★ | 易 | 1h | 資訊組要大規模整理資料時必用 |

### 🟡 P1 有空就做
| 任務 | 價值 | 難度 | 估時 |
|------|:---:|:---:|:---:|
| 審計日誌 Audit Log（誰什麼時候動了什麼） | ★★★★ | 中 | 2h |
| 拍照品質分級（Gemini 信心度 <0.6 標「需重拍」） | ★★★ | 易 | 1h |
| 快速重拍（舊紀錄一鍵重拍覆蓋） | ★★★ | 易 | 1h |

---

## 🚀 v9.0 — 智慧化與生態整合（1 個月）

### 🤖 AI Agent 主動化
- **自然語言查詢**：「給我看三樓五年級的電腦」→ Gemini 轉 SQL 自動查
- **AI 備註 自動生成**：拍完照後 Gemini 看一眼給一句話摘要（例：「Acer M460 外殼泛黃、鍵盤少 2 顆鍵帽，建議汰換」）
- **異常偵測**：
  - 某教室之前有 4 台、這次只拍到 3 台 → 紅色警示「可能遺失」
  - 連續 3 次都被標「需重拍」的同一台 → 建議實地檢查
- **汰換優先度模型**：綜合機齡、故障記錄、教學重要性排序

### 🔁 Google Workspace 整合
- **Google Sheets 雙向同步**：財管系統匯出的 Sheet 自動拉進來
- **Google Calendar**：自動排盤點行程（「本週 C108-C125」）
- **Gmail 通知**：汰換建議週報自動寄主任
- **Google Drive 自動備份**：每週匯出完整 Excel 到 Drive

### 📸 相機進階
- **Live 語音備註**（iOS Whisper API / Web Speech API）：拍完口述一段話自動轉文字存
- **標籤自動裁切**（OpenCV.js 或純 Canvas 邊緣偵測）
- **EXIF 解析**：從照片取 GPS 座標 / 拍攝時間 / 裝置型號
- **HDR 合成**：反光嚴重時拍 2 張自動合成

### 💰 政府/採購流程
- **AI 預算申請書草稿**：輸入「汰換 50 台電腦教室」→ 自動產出申請表
- **政府採購網比價**：抓公開採購網近期類似採購當參考
- **報廢流程**：拍照申請 → 主管簽核 → 自動產出報廢清單

---

## 🌌 v10+ 長期願景（3-6 個月）

### 📐 平面圖進化
- **室內定位 iBeacon/WiFi**：走到教室門口自動切換到該教室
- **AR 標記**（WebXR）：iPhone 鏡頭對準設備浮出資訊卡
- **3D 校園模型**（Three.js）：遊戲化體驗
- **熱度動畫**：每張照片上傳時在平面圖上「閃一下」，視覺化即時進度

### 🔗 完整生態整合
- **LINE Bot**：故障回報、查詢財產、盤點進度通知、@ 資訊組求助
- **校務系統 API**：與桃園市教育局財管系統雙向同步
- **Brother/DYMO 標籤印表機**：系統自動生成 QR Code 財產標籤，一鍵印出
- **Teams / Slack** webhook：汰換建議推播
- **Jamf / Apple School Manager**：iPad MDM 整合

### 🏫 多校推廣 / SaaS 化
- **多租戶架構**：一套系統服務全桃園市國小
- **各校自訂**：顏色主題、欄位、教室名稱可客製
- **跨校比較**：誰家汰換做得好、參考範本
- **開源化**：GitHub 公開，讓其他資訊組老師 contribute

### 🔐 進階安全 / 合規
- **端到端加密敏感欄位**（保管人姓名加密）
- **零信任架構**：每張照片帶數位簽章防竄改
- **個資法合規**：匿名化匯出、同意紀錄、資料保留期限政策
- **SSO 串接**：教育雲 / 縣市 SSO

---

## 💡 全新構想（還沒在 Roadmap 中，高創新值得思考）

> 這些是跳脫「電腦盤點工具」框架的想法，可能變成學校 IT 管理的核心系統。

### 🎨 使用體驗革新
| 點子 | 描述 | 價值 |
|------|------|:---:|
| **多人即時協作** | 像 Google Docs，老師們同時拍，看到彼此的進度與熱點（誰在哪間） | ★★★★ |
| **個人化儀表板** | 每個使用者拖拉自選要看的 widget（導師只要看自己班、主任要看汰換預算） | ★★★ |
| **語音盤點模式** | 說「這台 Acer 已經壞了」→ 自動開相機拍照 + 填備註 | ★★★★ |
| **遊戲化進度** | 盤點完一整個樓層解鎖徽章；全校達成率競賽 | ★★ |
| **暗黑模式手動切換** | 目前強制亮色，可加使用者偏好開關 | ★ |

### 🧠 資料智慧
| 點子 | 描述 | 價值 |
|------|------|:---:|
| **設備生命週期預測** | 同型號歷史壽命 → 預測這台還能撐幾年 | ★★★★★ |
| **故障模式分析** | 某型號故障率特別高 → 警示「此後別再採購」 | ★★★★ |
| **遷移追蹤與版本歷史** | 每次修改留版本，可看財產從哪搬到哪、什麼時候 | ★★★★ |
| **學期初差異偵測** | 比對上學期末照片，自動列出搬家的設備 | ★★★★ |
| **採購 AI 建議** | 「新購 10 台電腦要放哪間教室最佳」→ 依現況分析 | ★★★ |

### 🔧 流程自動化
| 點子 | 描述 | 價值 |
|------|------|:---:|
| **定期 Cron 任務** | 每月 1 日自動產生盤點報告、每學期初清理過期 QR | ★★★★ |
| **QR Code 批次生成** | 財產表匯入後自動產出 PDF 含全部 QR 標籤可列印貼上 | ★★★★★ |
| **報廢自動流程** | 拍照 → 主管線上簽核 → 自動移至「已報廢」表 → 通知總務 | ★★★★ |
| **採購建議單** | AI 根據汰換計畫 + 預算 → 產出可簽核的採購申請 | ★★★★ |
| **耗材追蹤** | 不只大設備，列印碳粉/電池也納入管理 | ★★ |

### 🛡 教育資訊組專用
| 點子 | 描述 | 價值 |
|------|------|:---:|
| **教育雲帳號整合** | 學生 iPad 借還記錄（配合教育雲 iPad 管理） | ★★★★ |
| **教師交接清單** | 老師離職時自動列出保管清單、交接給誰 | ★★★★ |
| **資訊設備申請表** | 老師上網申請新設備 → 自動轉採購單 | ★★★ |
| **IP / 網段管理** | 哪台電腦用哪 IP，整合到盤點系統 | ★★ |
| **軟體授權盤點** | 追蹤 Microsoft 365 / Adobe 等授權配給哪台 | ★★★★ |

---

## 🛠️ 技術債與基礎建設

### 需重構或優化
- [x] ~~目前 RLS 是 anon 全開，**需改成登入後才可寫**~~ ✅ v5.0 完成
- [ ] inventory_items 的 raw_data jsonb 可壓縮（目前約 200KB/筆 × 247 = 50MB）
- [ ] Edge Function 加 **rate limit**（目前沒限流，Gemini 可能被打爆）🔴 高優先
- [ ] 加 **錯誤回報**：前端 error 自動送到 Supabase logs
- [ ] 加 **CI**：PR 自動跑 lint / 型別檢查
- [ ] 加 **自動備份**：每日 Supabase 資料 dump 到 NAS（GitHub Actions 跑 cron）
- [ ] manage.html Excel 匯入可加 **撤銷** (undo 上次匯入)
- [ ] 照片 Storage 加 **縮圖生成**（用 Supabase Image Transformation，縮圖 200x200 給列表用）
- [ ] 加 **版本號顯示**：右下角 footer 顯示 `v7.0 (commit abc123)`
- [ ] Service Worker 更新提示：新版可用時跳提示「點此更新」
- [ ] **錯誤邊界**（Error boundary）：JS 崩潰時顯示友善訊息而非白屏

### 觀測性（Observability）
- [ ] Supabase `get_logs` 接成 dashboard 看 Edge Function 呼叫狀況
- [ ] Gemini Token 用量追蹤（避免超免費額度，快超時提醒）
- [ ] 使用者行為事件：哪個按鈕被按最多、哪個教室拍最頻繁
- [ ] Web Vitals 效能監控（LCP、FID、CLS）
- [ ] Sentry 或 LogRocket 整合抓線上錯誤

### 程式碼品質
- [ ] app.js 變大了（~500 行）可拆成更小模組
- [ ] CSS 變數命名可系統化（design tokens）
- [ ] 加入 TypeScript 或 JSDoc 類型註記（便於維護）
- [ ] 單元測試：Gemini prompt 解析、民國年轉換、RLS policy 測試

---

## 🎓 使用者培訓建議

建議未來做完 v5 時辦一場半小時的線上培訓：
1. **3 分鐘** — 展示手機拍照流程（iPhone 加到主畫面 → 選教室 → 拍 → 儲存）
2. **5 分鐘** — 管理後台查詢與匯出
3. **5 分鐘** — 月底盤點 SOP（每週固定拍幾間）
4. **問答**

搭配一頁 A4 Quick Reference Card 放資訊組辦公室。

---

## 💸 免費額度估算

目前設定下的月成本：
| 服務 | 免費額度 | 目前用量估計 | 風險 |
|------|----------|-------------|------|
| Supabase DB | 500 MB | < 50 MB | ✅ 綽綽有餘 |
| Supabase Storage | 1 GB | 依拍照數，1000 張約 300 MB | ⚠️ 3000 張就要注意 |
| Supabase Edge Function | 500k invocations/月 | < 1000 | ✅ 綽綽有餘 |
| Gemini 2.5 Flash | 15 RPM + 1.5M TPM 免費 | 依使用 | ✅ 單人用沒問題 |
| GitHub Pages | 100 GB 流量/月 | 極低 | ✅ 永不擔心 |

**滿 1000 張照片時**：考慮加 Supabase Pro ($25/月) 或照片搬到 Cloudflare R2（10 GB 免費）。

### 未來擴充時的成本門檻
| 門檻 | 月成本 | 何時到達 |
|------|:------:|----------|
| 全校 247 台電腦 + 每學期盤點 | 免費 | 永遠（預計用量 ~500MB/年）|
| 加到 4 類財產（電腦/螢幕/印表機/iPad）約 1000 筆 | 免費 | v8 推出後 |
| 加入相片連拍 3 張/台，累積 3 年 | $25/月 | 2028 年左右 |
| 做多校 SaaS 服務 10 所學校 | $100-300/月 | v11+ 階段 |

---

## 📞 聯絡 / 問題回報
- 程式錯誤：直接 GitHub Issue
- 學校業務需求討論：ipad@mail2.smes.tyc.edu.tw

---

_本 roadmap 會隨開發進度持續更新。做完一項就把該行移到「已完成」並標注版本號。_
