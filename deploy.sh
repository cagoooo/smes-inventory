#!/usr/bin/env bash
# ============================================================================
# smes-inventory · 部署前檢查腳本
# ============================================================================
# 用途:
#   1. 驗證當下用的 Gemini 模型還活著(Google 棄用速度快)
#   2. 實測 generateContent API 有 200 OK
#   3. 檢查版本號在 version.json / sw.js / index.html / manage.html 一致
#   4. 確認 git 有變更才 push
#
# 用法:
#   export GEMINI_API_KEY="AIzaSy..."     # 從 Supabase app_secrets 取得
#   ./deploy.sh                            # 完整檢查 + push
#   ./deploy.sh --dry-run                  # 只檢查不 push
#   ./deploy.sh --skip-test                # 跳過實測 generateContent(省 quota)
#
# 取得 GEMINI_API_KEY 的方法:
#   SQL: SELECT value FROM app_secrets WHERE key = 'gemini_api_key';
# ============================================================================

set -e

# 顏色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# 旗標
DRY_RUN=0
SKIP_TEST=0
for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=1 ;;
        --skip-test) SKIP_TEST=1 ;;
        -h|--help)
            sed -n '2,19p' "$0" | sed 's/^# //'
            exit 0
            ;;
    esac
done

echo -e "${BLUE}${BOLD}🚀 smes-inventory · 部署前檢查${NC}"
echo ""

# ============================================================================
# 1. API Key 檢查
# ============================================================================
if [ -z "$GEMINI_API_KEY" ]; then
    echo -e "${RED}❌ GEMINI_API_KEY 環境變數未設定${NC}"
    echo ""
    echo "請先設定:"
    echo '  export GEMINI_API_KEY="AIzaSy..."'
    echo ""
    echo "或從 Supabase app_secrets 取得(需透過 MCP 或 Supabase SQL Editor):"
    echo '  SELECT value FROM app_secrets WHERE key = '"'"'gemini_api_key'"'"';'
    exit 1
fi

if [[ ! "$GEMINI_API_KEY" =~ ^AIzaSy[A-Za-z0-9_-]+$ ]]; then
    echo -e "${YELLOW}⚠${NC} GEMINI_API_KEY 格式看起來不對(應以 AIzaSy 開頭 + 英數底線)"
    echo "  但還是繼續試..."
fi

echo -e "${GREEN}✓${NC} GEMINI_API_KEY 已設定"

# ============================================================================
# 2. 從 config.js 抽出當下使用的模型(data-driven,改 config 不用改本檔)
# ============================================================================
CURRENT_MODEL=$(grep -oE "GEMINI_MODEL:\s*'[^']+'" config.js | sed "s/GEMINI_MODEL:\s*'//;s/'//" || echo "")
if [ -z "$CURRENT_MODEL" ]; then
    echo -e "${YELLOW}⚠${NC} 無法從 config.js 抽出 GEMINI_MODEL,預設檢查 gemini-2.5-flash"
    CURRENT_MODEL="gemini-2.5-flash"
fi
echo -e "${GREEN}✓${NC} 當下設定的模型: ${BOLD}$CURRENT_MODEL${NC}"

# ============================================================================
# 3. ListModels API — 模型還活著嗎?
# ============================================================================
echo ""
echo "📡 呼叫 ListModels API 確認模型清單..."
MODELS_RAW=$(curl -sS -w "\n%{http_code}" \
    "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY")
HTTP_CODE=$(echo "$MODELS_RAW" | tail -1)
MODELS_BODY=$(echo "$MODELS_RAW" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
    echo -e "${RED}❌ ListModels API 失敗 (HTTP $HTTP_CODE)${NC}"
    echo "$MODELS_BODY" | head -10
    exit 1
fi
echo -e "${GREEN}✓${NC} ListModels API 回 200"

# 確認當前使用的模型在清單裡
if echo "$MODELS_BODY" | grep -q "\"models/$CURRENT_MODEL\""; then
    echo -e "${GREEN}✓${NC} $CURRENT_MODEL 可用"
else
    echo -e "${RED}❌ $CURRENT_MODEL 已被 Google 棄用!${NC}"
    echo ""
    echo "當下可用的生產級 Gemini 模型:"
    echo "$MODELS_BODY" | grep -oE '"name": "models/gemini-[0-9]+\.?[0-9]*-(flash|pro)[a-z0-9.-]*"' | sort -u | sed 's/^/  /'
    echo ""
    echo "修正步驟:"
    echo "  1. 編輯 config.js,改 GEMINI_MODEL"
    echo "  2. 重跑本腳本"
    exit 1
fi

# ============================================================================
# 4. 實測 generateContent(可 --skip-test 跳過)
# ============================================================================
if [ $SKIP_TEST -eq 0 ]; then
    echo ""
    echo "🧪 實測 generateContent..."
    TEST_RES=$(curl -sS -w "\n%{http_code}" \
        -X POST "https://generativelanguage.googleapis.com/v1beta/models/$CURRENT_MODEL:generateContent?key=$GEMINI_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
            "contents":[{"parts":[{"text":"Reply with exactly: OK"}]}],
            "generationConfig":{
                "maxOutputTokens":64,
                "thinkingConfig":{"thinkingBudget":0}
            }
        }')
    TEST_CODE=$(echo "$TEST_RES" | tail -1)
    TEST_BODY=$(echo "$TEST_RES" | sed '$d')

    if [ "$TEST_CODE" != "200" ]; then
        echo -e "${RED}❌ generateContent 實測失敗 (HTTP $TEST_CODE)${NC}"
        echo "$TEST_BODY" | head -20
        exit 1
    fi

    # 解析 finishReason(API 回傳的 JSON 有縮排,冒號後有空白,regex 要容許)
    FINISH_REASON=$(echo "$TEST_BODY" | grep -oE '"finishReason"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
    if [ "$FINISH_REASON" = "STOP" ]; then
        echo -e "${GREEN}✓${NC} generateContent 成功,finishReason=STOP"
    elif [ "$FINISH_REASON" = "MAX_TOKENS" ]; then
        echo -e "${YELLOW}⚠${NC} finishReason=MAX_TOKENS(測試的短 prompt 不應觸發,代表 thinking mode 可能還在吃 tokens)"
    elif [ -z "$FINISH_REASON" ]; then
        echo -e "${YELLOW}⚠${NC} 無法解析 finishReason,API 回應格式可能改了:"
        echo "$TEST_BODY" | head -20
    else
        echo -e "${YELLOW}⚠${NC} finishReason=$FINISH_REASON"
    fi
else
    echo -e "${BLUE}→${NC} --skip-test: 跳過 generateContent 實測"
fi

# ============================================================================
# 5. 版本一致性檢查
# ============================================================================
echo ""
echo "🔢 檢查版本號一致性..."
VER_JSON=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' version.json | grep -oE '"v[0-9.]+"' | tr -d '"')
VER_SW=$(grep -oE "smes-v[0-9.]+" sw.js | head -1 | sed 's/smes-//')
VER_INDEX=$(grep -oE "\?v=[0-9.]+" index.html | head -1 | sed 's/?v=/v/')
VER_MANAGE=$(grep -oE "\?v=[0-9.]+" manage.html | head -1 | sed 's/?v=/v/')

echo "  version.json: $VER_JSON"
echo "  sw.js:        $VER_SW"
echo "  index.html:   $VER_INDEX"
echo "  manage.html:  $VER_MANAGE"

if [ "$VER_JSON" = "$VER_SW" ] && [ "$VER_JSON" = "$VER_INDEX" ] && [ "$VER_JSON" = "$VER_MANAGE" ]; then
    echo -e "${GREEN}✓${NC} 所有版本號一致: ${BOLD}$VER_JSON${NC}"
else
    echo -e "${YELLOW}⚠${NC} 版本號不一致,可能導致使用者看到舊版(SW cache 不會更新)"
    echo "  建議統一後再部署"
fi

# ============================================================================
# 6. Git 狀態檢查
# ============================================================================
echo ""
CHANGED=$(git status --porcelain | wc -l | tr -d ' ')
UNPUSHED=$(git log @{u}.. --oneline 2>/dev/null | wc -l | tr -d ' ')

if [ "$CHANGED" != "0" ]; then
    echo -e "${BLUE}ℹ${NC} 有 $CHANGED 個檔案變更未 commit:"
    git status --short
fi

if [ "$UNPUSHED" != "0" ]; then
    echo -e "${BLUE}ℹ${NC} $UNPUSHED 個 unpushed commit 等待 push"
fi

# dry-run 允許看狀態但不強制要 commit(方便除錯)
if [ $DRY_RUN -eq 0 ]; then
    if [ "$CHANGED" != "0" ]; then
        echo ""
        echo -e "${YELLOW}⚠${NC} 本腳本不會自動 commit,請先 git commit 再執行(或用 --dry-run 純檢查)"
        exit 1
    fi
    if [ "$UNPUSHED" = "0" ] && [ "$CHANGED" = "0" ]; then
        echo -e "${YELLOW}⚠${NC} git 沒有變更也沒有 unpushed commit,不需部署"
        exit 0
    fi
fi

# ============================================================================
# 7. 確認後 push
# ============================================================================
if [ $DRY_RUN -eq 1 ]; then
    echo ""
    echo -e "${BLUE}→ --dry-run 模式,不執行 git push${NC}"
    exit 0
fi

echo ""
read -p "✅ 全部檢查通過。確定要 git push 部署? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "取消部署"
    exit 0
fi

echo ""
echo "📤 git push..."
git push

echo ""
echo -e "${GREEN}${BOLD}🎉 部署完成!${NC}"
echo "   線上網址: https://cagoooo.github.io/smes-inventory/"
echo "   等 1-2 分鐘 GitHub Pages rebuild 後,硬重整瀏覽器即可看到新版"
echo ""
echo "提示: GitHub Actions 會自動跑 gemini-smoke-test workflow 驗證"
echo "      若失敗會顯示紅色 X,https://github.com/cagoooo/smes-inventory/actions"
