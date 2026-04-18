# 石門國小 電腦財產盤點系統

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
- 資料庫 + Storage：Supabase (PostgREST + Object Storage，可公開讀寫)
- AI：Google Gemini 2.5 Flash（視覺辨識）
- Excel 處理：[SheetJS](https://sheetjs.com/) (CDN 載入)

## 專案結構
```
index.html         首頁：教室選擇 + 拍照 + 辨識 + 儲存
manage.html        管理後台：總覽/拍照紀錄/教室狀態/財產清冊/Excel 匯入
config.js          Supabase URL + anon key + Gemini 模型設定
css/style.css      共用樣式（手機優先、iOS 安全區）
js/
  supabase-client.js  Supabase REST + Storage 封裝
  gemini.js           Gemini Vision API + 圖片壓縮
  app.js              首頁主邏輯
  manage.js           管理頁主邏輯
data/classrooms.json  教室基礎資料 (JSON 版，備援)
scripts/
  import_excel.py     Excel→SQL 轉換腳本
  inventory_seed.sql  匯入用 SQL
```

## 使用流程
1. 打開 `index.html` → 選樓層、搜尋或點教室卡片
2. 大大的「📷 拍攝」按鈕 → iPhone 直接開相機
3. 拍完 → 點「🤖 AI 辨識」（首次使用會請你貼 Gemini API Key）
4. 檢查綠色欄位（AI 自動填），修正後點「✅ 儲存」
5. 系統會從財產清冊找最接近的紀錄，可一鍵比對
6. 切到「📊 管理」看總覽、匯出 Excel

## Gemini API Key
自行於 [Google AI Studio](https://aistudio.google.com/app/apikey) 申請免費 Key，在 index.html 第一次按辨識時會彈出輸入框，Key 只存在本裝置的 localStorage，不會上傳伺服器。

## 資料安全
目前採「內部使用」模式（無登入）：任何人有網址都能讀寫。建議：
- 網址不要公開分享
- 如需登入，改 manage.html 走 Supabase Auth + Google OAuth（@mail2.smes.tyc.edu.tw 網域限制）
