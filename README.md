# 石門國小 電腦財產盤點系統

🌐 **線上使用：[教室資訊設備盤點系統](https://cagoooo.github.io/smes-inventory/)**

> 📌 **目前版本：v7.5.7**（依據 `version.json`）

行動化電腦主機盤點：入班拍照 → Gemini AI 自動辨識廠牌/型號/財產編號/取得年份 → 自動比對既有財產清冊，產出電腦汰舊換新決策依據。

## 功能
- 📱 **手機優先** iPhone 相機直接拍照上傳（Safari/Chrome 都支援 `capture="environment"`）
- 🤖 **Gemini Vision AI** 一鍵辨識廠牌、型號、財產編號、民國年
- 🏫 **83 間教室**（1-3 樓 + 幼兒園）快速選取，依樓層/類別/搜尋三種篩選
- 📦 **247 筆財產清冊** 已匯入，可依財產編號或型號與拍照結果交叉比對
- 📊 **統計後台** 每間教室拍照進度、老舊機器色塊提示（≥8 年紅、≥5 年橘、＜5 年綠）
- 📥 **Excel 匯入** 通用欄位對應器，未來擴充其他財產類別也能用
- ⬇️ **Excel 匯出** 所有拍照紀錄一鍵下載

## 技術棧
- 前端：單檔 HTML + vanilla JS，無框架，GitHub Pages 即可部署
- 資料庫 + Storage：Supabase（PostgREST + Object Storage；資料列權限 RLS 只認允許名單）
- AI：Google Gemini 2.5 Flash（視覺辨識）
- Excel 處理：[SheetJS](https://sheetjs.com/) (CDN 載入)

## 專案結構
```
index.html         首頁：教室選擇 + 拍照 + 辨識 + 儲存
manage.html        管理後台：總覽/拍照紀錄/教室狀態/財產清冊/Excel 匯入
scrap.html         電腦財產報廢點收：拍照／掃條碼 → 對應財產 → 報廢清單
config.js          Supabase URL + anon key + Gemini 模型設定
css/style.css      共用樣式（手機優先、iOS 安全區）
css/scrap.css      報廢點收頁樣式（含列印版面）
js/
  supabase-client.js  Supabase REST + Storage 封裝
  gemini.js           Gemini Vision API + 圖片壓縮
  app.js              首頁主邏輯
  manage.js           管理頁主邏輯
  scrap.js            報廢點收主邏輯（比對引擎、離線暫存、清冊狀態同步）
  auth.js             Google 登入 + 允許名單檢查
gas/Code.gs           報廢試算表後端（Google Apps Script，clasp 管理）
supabase/functions/   Edge Function 原始碼（gemini-proxy）
data/classrooms.json  教室基礎資料 (JSON 版，備援)
scripts/
  import_excel.py     Excel→SQL 轉換腳本
  inventory_seed.sql  匯入用 SQL
```

## 使用流程
1. 打開 `index.html` → 選樓層、搜尋或點教室卡片
2. 大大的「📷 拍攝」按鈕 → iPhone 直接開相機
3. 拍完 → 點「🤖 AI 辨識」（金鑰登入後自動載入，不用自己貼）
4. 檢查綠色欄位（AI 自動填），修正後點「✅ 儲存」
5. 系統會從財產清冊找最接近的紀錄，可一鍵比對
6. 切到「📊 管理」看總覽、匯出 Excel

## 🗑️ 電腦財產報廢點收（v7.5.0 新增，`scrap.html`）
資訊組專用，處理整批待報廢的主機與螢幕：
1. 設定「報廢批次」名稱，可選設備原本的存放地點（提高準確度）
2. 選「主機／螢幕／財產標籤」後拍照 → Gemini 辨識 → 從財產清冊列出最接近的幾筆（附相似度與理由）
   - 財產標籤編號相符＝100%；螢幕會用規格欄裡的螢幕型號對回所屬主機那一筆
   - 同型號同年份有多台時會提醒改拍標籤，或「加入下一台尚未加入的」（註記型號推定）
   - 標籤有二維條碼可用「📱 掃條碼」連續掃描；編號 100% 相符且只對到一筆會自動加入（可關閉、可復原）
   - 網路不穩時先存在手機（IndexedDB），連線後自動補送
3. 按「加入報廢清單」即時寫入 Google 試算表「石門國小 電腦財產報廢點收」（`報廢清單`、`辨識紀錄` 兩分頁，照片存雲端硬碟）
4. 清單上方顯示各教室點收進度（同地點同型號點到幾台、還差哪幾台）
5. 加入清單會同步把財產清冊標成「待報廢」並寫異動紀錄；移出清單自動還原
6. 「列印報廢清冊」輸出 A4 橫式清冊（含合計與核章欄，可選附未點到名單），也可匯出 Excel 交總務處

後端：`gas/Code.gs`（clasp 管理，學校帳號擁有），每次請求都會向 Supabase 驗證登入 token，必須是允許名單上的學校帳號。

## Gemini API Key
金鑰存在 Supabase 的 `app_secrets` 資料表，只有允許名單上的帳號登入後讀得到，前端會自動載入到該裝置（`localStorage`）直連 Gemini。
原始碼與 repo 裡不放金鑰；備援的 Edge Function `gemini-proxy`（`supabase/functions/gemini-proxy/`）同樣要允許名單上的登入帳號才能呼叫。

## AI 辨識模型切換（v7.5.7 起）

- 預設模型寫在 `config.js` 的 `GEMINI_MODEL`（目前 `gemini-2.5-flash`）。
- 管理後台「🤖 AI 模型」分頁可以改用其他 Gemini 模型，並先用一張照片讓新舊模型各辨識一次再決定。
- 選定的模型存在 Supabase `app_secrets.gemini_model`，由資料庫函式 `set_gemini_model()` 寫入（只有允許名單上的帳號能呼叫，只接受 `gemini-` 開頭的名稱）；各裝置登入時由 `js/auth.js` 帶進瀏覽器，重新整理網頁後生效。
- 選的模型失效時（被下架、名稱錯誤），拍照辨識會自動退回 `config.js` 的預設模型。
- 備援通道（Edge Function `gemini-proxy`）與每日健康檢查仍使用預設模型，不受後台設定影響。

## 資料安全（2026-11-23 權限加固，v7.5.5 起）
- **登入**：Supabase Auth + Google 登入，限 `@mail2.smes.tyc.edu.tw` 學校帳號。
- **允許名單**：學生帳號與教職員同網域，所以另外用資料表 `public.allowed_users` 當名單；資料庫函式 `public.is_allowed_user()` 會檢查登入者的信箱在名單內、且是用 Google 登入。
- **真正的把關在後端**：盤點系統各資料表與照片儲存空間的權限規則（RLS）、四個統計檢視表（`security_invoker`）、Edge Function、GAS 報廢後端，全部只認這一份名單。前端的檢查只負責顯示「尚未開通」的說明。
- **未登入**：讀不到任何盤點資料，也無法呼叫 AI 辨識。
- **開通／移除帳號**：在 Supabase 新增或刪除 `allowed_users` 的一列（email 要小寫）：
  ```sql
  insert into public.allowed_users (email, note) values (lower('帳號@mail2.smes.tyc.edu.tw'), '備註');
  ```
- **注意**：這個 Supabase 專案與其他工具共用，調整權限時只動盤點系統自己的資料表。
- 盤點照片（`inventory-photos`）是公開網址，知道網址即可檢視；上傳與刪除需允許名單帳號。

---

<!-- BEGIN:PROJECT_GUIDE -->
## 專案導覽

石門國小電腦財產盤點系統 - iPhone 拍照 + Gemini AI 辨識 + Supabase

- 專案定位：校務／行政流程數位化專案
- Repository：`cagoooo/smes-inventory`
- 可見性：公開
- 主要技術：JavaScript
- 線上入口：<https://cagoooo.github.io/smes-inventory/>

### 可以怎麼應用

- 把紙本、試算表或人工通知流程轉成可追蹤的線上作業
- 依不同學校的欄位、角色與簽核方式進行客製化
- 作為校務系統、資料同步或自動通知整合的參考實作

這些是依目前專案定位整理的延伸方向，不代表所有情境都已內建完成；實作前請先確認現有功能與資料格式。

### 技術與專案結構

- `README.md`
- `index.html`
- `scripts`

檔案結構會隨版本演進；若本節與程式碼不一致，以目前預設分支的原始碼為準。

### 本機執行

這是可直接由瀏覽器載入的靜態網站。可用任一靜態檔案伺服器預覽，例如：
```bash
python -m http.server 8000
```
接著開啟 `http://localhost:8000`。請避免直接以 `file://` 測試需要模組、請求或 Service Worker 的功能。

### 給 AI Agent 的接手指南

1. 先閱讀本 README、`AGENTS.md`（若有）、套件腳本與部署設定。
2. 先畫出角色、資料流、權限與外部服務，再修改表單或資料結構。
3. 不得提交學生個資、憑證、API 金鑰或正式環境匯出資料。
4. 涉及 schema、驗證、權限或通知時，同步檢查前後端與部署設定。
5. 不要捏造尚未存在的功能；README 與實作有落差時，應同時更新文件。
6. 提交前只納入本次任務檔案，並記錄實際執行過的驗證。

### 安全與資料注意事項

- 不要提交 `.env`、服務帳號、API 金鑰、token、學生個資或正式環境匯出資料。
- 使用 Firebase、Supabase、Google API 或其他雲端服務時，請建立自己的測試專案並套用最小權限。
- 若要公開衍生作品，請先確認程式碼、圖片、音訊、字型與教材內容的授權。

### 貢獻與客製化

歡迎依教學現場、活動或工作流程需求進行 fork／客製化。建議在變更說明中交代使用情境、主要修改、測試方式，以及是否影響資料格式或部署設定。
<!-- END:PROJECT_GUIDE -->

<!-- akai-edu-tools:backlink -->

---

## 🔗 阿凱老師教育工具集

這個專案是[阿凱老師教育工具集](https://cagoooo.github.io/Akai/)的 **#82 教室資訊設備盤點系統**，由桃園市龍潭區石門國民小學阿凱老師開發。

- 工具介紹頁：[https://cagoooo.github.io/Akai/tool/82/](https://cagoooo.github.io/Akai/tool/82/)
- 線上使用：[https://cagoooo.github.io/smes-inventory/](https://cagoooo.github.io/smes-inventory/)
- 教學情境文章：[https://cagoooo.github.io/Akai/blog/inventory-82-classroom-equipment/](https://cagoooo.github.io/Akai/blog/inventory-82-classroom-equipment/)
- 全部工具（上百個教育工具與原始碼）：[https://cagoooo.github.io/Akai/](https://cagoooo.github.io/Akai/)

想改造成自己的版本？到上面的教學情境文章，按左下角「複製 AI 開發提示詞」，貼給 ChatGPT、Claude、Gemini 等 AI 助手，就能參考這份原始碼開始規劃。
