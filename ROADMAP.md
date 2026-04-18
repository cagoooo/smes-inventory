# 📍 石門盤點系統 · 產品 Roadmap

> 最後更新：2026-04-18
> 目前版本：**v5.0 — 登入 + 平面圖 + QR + 進度條 + 連拍（完整部署上線）**
> 部署網址：https://cagoooo.github.io/smes-inventory/
> **登入系統已完成實測，任何非 `@mail2.smes.tyc.edu.tw` 帳號會被自動登出**

---

## 📊 進度表（已完成）

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

## 🔭 v6-v7.0 中期規劃（1-2 個月）

### 📈 進階分析與視覺化
- **全校財產儀表板**：圓餅圖（廠牌佔比）、柱狀圖（年度購置）、折線圖（汰換趨勢）
  - 推薦套件：Chart.js 或 Apache ECharts（輕量）
- **熱度地圖**：校園平面圖顏色深淺表示設備密度
- **預算試算工具**：拖拉滑桿調整汰換年數門檻、即時計算總預算
- **設備壽命統計**：同廠牌/型號的平均使用年限

### 🤝 多人協作 & 權限
- **角色分層**：
  - 資訊組（admin）：全校讀寫、匯入、匯出
  - 導師（editor）：只能操作自己班教室
  - 主任（viewer）：僅讀取 + 匯出報表
- **任務指派**：資訊組派單「請○○老師拍本班電腦」，自動 email 提醒
- **活動紀錄 Audit Log**：誰在什麼時候拍了 / 刪了哪筆
- **群組盤點戰情室**：即時進度看板，盤點日當天大家一起刷

### 📦 多財產類別擴充
- **類別表**（新 table `asset_categories`）：電腦主機、螢幕、筆電、投影機、印表機、AP、交換器、iPad、音響、樂器、消防設備...
- **每類別獨立 Gemini prompt**：標籤長相不同辨識重點不同
- **欄位可配置**：JSON Schema 定義每類別要填什麼
- **統一標籤掃描器**：先用 QR / OCR，再 fallback 到 AI

### 🔁 Google Sheets 雙向同步
- Apps Script webhook
- 財管系統匯出 Excel 或 Google Sheets 時自動觸發匯入
- 定期（每天凌晨）自動比對找差異

### 📴 離線模式（PWA Service Worker）
- 訊號不好時照片先存 IndexedDB
- 回辦公室自動重試上傳
- 離線也能選教室、瀏覽歷史紀錄
- Cache-first 策略加快載入

### 📸 相機功能增強
- **Live 相機預覽**（getUserMedia）：不跳出系統相機，直接在網頁拍
- **網格對齊輔助線**
- **標籤自動裁切**（OpenCV.js / Tesseract.js 邊緣偵測）
- **反光/曝光警告**（拍太糊/太暗提示重拍）

---

## 🌌 v8+ 長期願景（3-6 個月）

### 🤖 AI 代理人
- **主動式盤點助手**：定期提醒「○○教室已 6 個月沒更新」
- **異常偵測**：突然少一台 → 可能遺失警示
- **AI 說明生成**：自動產生年度汰換計劃書（給主管看的 PDF）
- **多模態輸入**：語音備註（Whisper API）、拍完描述一段話 AI 自動寫備註

### 📐 平面圖互動
- **室內定位**（iBeacon / WiFi）：走到哪自動切教室
- **AR 標記**：iPhone 鏡頭對準教室門口浮出設備資訊
- **3D 校園模型**（Three.js）：遊戲式盤點體驗

### 🔗 整合生態
- **LINE Bot**：
  - 回報故障
  - 查詢財產狀態
  - 盤點進度通知
- **Google Workspace 整合**：
  - Calendar：自動排盤點行程
  - Gmail：汰換建議自動寄主任
  - Drive：每週自動備份 Excel
- **校務系統 API**：與桃園市教育局財管系統雙向同步
- **Brother/DYMO 標籤印表機**：產生新財產標籤直接列印

### 💰 政府補助 & 採購建議
- **汰換優先度 AI 模型**：
  - 考量因素：年齡、使用頻率、故障次數、教學重要性
- **採購比價**：抓公開採購網 / 資訊月報價
- **預算申請書 AI 起草**：輸入「想汰換 50 台電腦教室」自動產出申請文

### 🏫 跨校推廣
- **多校版本**：可複製到其他國小、國中
- **SaaS 化**：統一後台服務桃園市所有學校
- **開源社群**：GitHub 公開讓其他資訊組老師 contribute

### 🔐 進階安全
- **端到端加密敏感欄位**（保管人姓名）
- **零信任架構**：每張照片都帶數位簽章防竄改
- **合規稽核報告**：GDPR / 個資法自動化檢查

---

## 🛠️ 技術債與基礎建設

### 需重構或優化
- [x] ~~目前 RLS 是 anon 全開，**需改成登入後才可寫**~~ ✅ v5.0 完成 (2026-04-18)
- [ ] inventory_items 的 raw_data jsonb 可壓縮（目前約 200KB/筆 × 247 = 50MB）
- [ ] Edge Function 加 **rate limit**（目前沒限流，Gemini 可能被打爆）
- [ ] 加 **錯誤回報**：前端 error 自動送到 Supabase logs
- [ ] 加 **CI**：PR 自動跑 lint / 型別檢查（雖然沒用 TS，可加 HTML 驗證）
- [ ] 加 **自動備份**：每日 Supabase 資料 dump 到 NAS
- [ ] manage.html Excel 匯入可加 **撤銷** (undo 上次匯入)
- [ ] 照片 Storage 加 **縮圖生成**（目前讀原圖 1600px 還是略慢）

### 觀測性（Observability）
- [ ] Supabase `get_logs` 接成 dashboard 看 Edge Function 呼叫狀況
- [ ] Gemini Token 用量追蹤（避免超免費額度）
- [ ] 使用者行為事件：哪個按鈕被按最多、哪個教室拍最頻繁

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

---

## 📞 聯絡 / 問題回報
- 程式錯誤：直接 GitHub Issue
- 學校業務需求討論：ipad@mail2.smes.tyc.edu.tw

---

_本 roadmap 會隨開發進度持續更新。做完一項就把該行移到「已完成」並標注版本號。_
