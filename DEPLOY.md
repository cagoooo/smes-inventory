# 部署流程與防雷檢查

本專案有兩層「擋下模型棄用 + 部署錯誤」的自動化機制,設定一次受用長久。

---

## 🛡️ 防雷機制一覽

| 層級 | 檔案 | 觸發 | 功能 |
|:---:|:---|:---|:---|
| **本地** | `deploy.sh` | 手動跑 `./deploy.sh` | 部署前檢查 ListModels + 版本號一致 + 實測 generateContent |
| **CI/CD** | `.github/workflows/gemini-smoke-test.yml` | Push + 每天 09:00 + 手動 | 自動驗證,失敗顯示紅色 X,email 通知 |

---

## ⚙️ 首次設定(一次性,約 5 分鐘)

### Step 1 — 取得 Gemini API Key

從 Supabase `app_secrets` 表取得(已登入到學校帳號時):

**方法 A(SQL)**: 打開 Supabase SQL Editor 跑
```sql
SELECT value FROM app_secrets WHERE key = 'gemini_api_key';
```
複製 `AIzaSy...` 開頭那串。

**方法 B(MCP)**: 透過 Claude 跑 `execute_sql` 也行。

### Step 2 — 設定本地環境變數(給 deploy.sh 用)

```bash
# Windows Git Bash
export GEMINI_API_KEY="AIzaSy..."

# 要永久生效,加到 ~/.bashrc 或 ~/.bash_profile
echo 'export GEMINI_API_KEY="AIzaSy..."' >> ~/.bashrc
source ~/.bashrc
```

### Step 3 — 設定 GitHub Secret(給 Actions 用)

1. 打開 https://github.com/cagoooo/smes-inventory/settings/secrets/actions
2. 點「New repository secret」
3. Name: `GEMINI_API_KEY`
4. Secret: 貼上 `AIzaSy...`
5. 按「Add secret」

### Step 4 — 驗證

```bash
# 本地測試
./deploy.sh --dry-run --skip-test

# 預期輸出:全部綠色 ✓,最後停在 dry-run 不會 push
```

手動觸發一次 GitHub Actions:
1. 打開 https://github.com/cagoooo/smes-inventory/actions/workflows/gemini-smoke-test.yml
2. 點「Run workflow」→ 選 main → Run
3. 等 30 秒左右應該綠燈 ✅

---

## 🚀 日常部署流程

### 標準流程
```bash
# 1. 改完 code 後 commit(版本號、sw.js、html 都 bump 好)
git add .
git commit -m "v7.4.XX ..."

# 2. 跑部署檢查 + push
./deploy.sh

# 腳本會:
#   ✓ 驗證 GEMINI_API_KEY
#   ✓ 讀 config.js 抽出當下模型
#   ✓ 打 ListModels 確認模型還在
#   ✓ 實測 generateContent(可 --skip-test 跳過省 quota)
#   ✓ 檢查版本號一致
#   ✓ 問你「確定 push? [y/N]」
#   ✓ push 到 GitHub
```

### 旗標選項
```bash
./deploy.sh                # 完整檢查 + 互動式 push
./deploy.sh --dry-run      # 只檢查不 push(debug 用)
./deploy.sh --skip-test    # 跳過 generateContent 實測(省 quota)
./deploy.sh --help         # 顯示說明
```

---

## 🔔 模型被棄用時會發生什麼

### 情境:Google 把 `gemini-2.5-flash` 下線了

**本地跑 deploy.sh**:
```
📡 呼叫 ListModels API 確認模型清單...
✓ ListModels API 回 200
❌ gemini-2.5-flash 已被 Google 棄用!

當下可用的生產級 Gemini 模型:
  "name": "models/gemini-3.0-flash"
  "name": "models/gemini-3.0-pro"
  "name": "models/gemini-flash-latest"
  ...

修正步驟:
  1. 編輯 config.js,改 GEMINI_MODEL
  2. 重跑本腳本
```

**Push 到 main 後 GitHub Actions**:
- Actions tab 顯示紅色 ❌
- 你 email 收到失敗通知(若 GitHub 通知有開)
- Workflow summary 列出當下可用模型

**修正**:改 `config.js` 的 `GEMINI_MODEL`,`./deploy.sh` 重跑。

---

## 📅 每日自動健康檢查

`gemini-smoke-test.yml` 每天台灣時間早上 9:00 自動跑。即使你沒推 code,也會主動發現模型棄用(Google 有時會悄悄下線舊模型)。

要看歷史紀錄: https://github.com/cagoooo/smes-inventory/actions/workflows/gemini-smoke-test.yml

---

## 🧰 故障排除

### deploy.sh 說「GEMINI_API_KEY 環境變數未設定」
→ 執行 `export GEMINI_API_KEY="AIzaSy..."` 後重跑

### GitHub Actions 一直紅燈說「ListModels HTTP 400」
→ GitHub Secret 值可能貼錯(多了空白或換行)。重新複製貼一次

### generateContent 回 429
→ Free tier quota 用完(15 RPM),等 1 分鐘重試。或加 `--skip-test`

### 版本號不一致警告
→ `version.json`、`sw.js`、`index.html`、`manage.html` 的版本要同時 bump。不一致使用者可能看到舊版(SW cache 不會更新)

---

## 🔗 相關

- `ROADMAP.md` — 完整版本歷程 + 未來優化建議
- skill: `gemini-api-integration` — 模型棄用防禦完整 SOP
- skill: `supabase-secrets-for-browser-apis` — app_secrets + RLS 取代 Edge Function 方案
