#!/bin/bash
# ============================================================
#  deploy.sh - Arabic Shorts Generator
#  يرفع التعديلات إلى GitHub ويطبقها فوراً على الحاوية
#  الاستخدام:
#    ./deploy.sh                   -> push كل شيء + apply
#    ./deploy.sh "رسالة الكوميت"  -> push برسالة مخصصة + apply
#    ./deploy.sh --only-apply      -> تطبيق فقط بدون push
#    ./deploy.sh --only-push       -> push فقط بدون تطبيق
# ============================================================
set -e

PROJECT_DIR="/opt/arabic-shorts-generator"
CONTAINER="arabic-shorts-generator"
NGINX_HTML="/usr/share/nginx/html"
APP_DIR="/app"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[deploy]${NC} $1"; }
ok()   { echo -e "${GREEN}[v]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[x]${NC} $1"; exit 1; }

COMMIT_MSG="${1:-"chore: auto-deploy $(date '+%Y-%m-%d %H:%M')"}" 
ONLY_APPLY=false
ONLY_PUSH=false
[[ "$1" == "--only-apply" ]] && ONLY_APPLY=true
[[ "$1" == "--only-push"  ]] && ONLY_PUSH=true

cd "$PROJECT_DIR"

# ----------------------------------------------------------
# 1. PUSH TO GITHUB
# ----------------------------------------------------------
if [[ "$ONLY_APPLY" == "false" ]]; then
  log "فحص التغييرات..."
  git add frontend/index.html \
          backend/server.js \
          backend/services/ \
          docker-compose.yml \
          Dockerfile \
          README.md \
          deploy.sh 2>/dev/null || true

  if git diff --cached --quiet; then
    warn "لا توجد تغييرات جديدة للرفع على GitHub"
  else
    log "جاري الـ commit..."
    git commit -m "$COMMIT_MSG"
    log "جاري الـ push إلى GitHub..."
    if git push origin main 2>&1; then
      ok "تم الرفع على GitHub بنجاح"
      echo -e "   ${BOLD}https://github.com/hadi-hani/arabic-shorts-generator${NC}"
    else
      warn "فشل الـ push - تحقق من GitHub token"
    fi
  fi
fi

[[ "$ONLY_PUSH" == "true" ]] && exit 0

# ----------------------------------------------------------
# 2. APPLY TO CONTAINER (live, no rebuild)
# ----------------------------------------------------------
log "تطبيق التعديلات على الحاوية فوراً..."

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  err "الحاوية '$CONTAINER' غير شغالة!"
fi

ERRORS=0

# frontend
if [[ -f "$PROJECT_DIR/frontend/index.html" ]]; then
  docker cp "$PROJECT_DIR/frontend/index.html" "$CONTAINER:$NGINX_HTML/index.html" \
    && ok "frontend/index.html -> $NGINX_HTML/index.html" \
    || { warn "فشل نسخ index.html"; ((ERRORS++)); }
fi

# backend server.js
if [[ -f "$PROJECT_DIR/backend/server.js" ]]; then
  docker cp "$PROJECT_DIR/backend/server.js" "$CONTAINER:$APP_DIR/server.js" \
    && ok "backend/server.js -> $APP_DIR/server.js" \
    || { warn "فشل نسخ server.js"; ((ERRORS++)); }
fi

# backend services/
if [[ -d "$PROJECT_DIR/backend/services" ]]; then
  for svc in "$PROJECT_DIR/backend/services"/*.js; do
    fname=$(basename "$svc")
    [[ "$fname" == *.bak* ]] && continue
    docker cp "$svc" "$CONTAINER:$APP_DIR/services/$fname" \
      && ok "services/$fname -> $APP_DIR/services/$fname" \
      || { warn "فشل نسخ $fname"; ((ERRORS++)); }
  done
fi

# restart node via supervisord (kill -> auto-restart)
log "إعادة تشغيل Node.js داخل الحاوية..."
NODE_PID=$(docker exec "$CONTAINER" ps aux 2>/dev/null | grep 'node /app' | grep -v grep | awk '{print $1}' | head -1)
if [[ -n "$NODE_PID" ]]; then
  docker exec "$CONTAINER" kill "$NODE_PID" 2>/dev/null || true
  sleep 2
  NEW_PID=$(docker exec "$CONTAINER" ps aux 2>/dev/null | grep 'node /app' | grep -v grep | awk '{print $1}' | head -1)
  if [[ -n "$NEW_PID" ]]; then
    ok "Node.js اعيد تشغيله (PID جديد: $NEW_PID)"
  else
    warn "Node.js لم يعد بعد - supervisord سيعيده خلال ثوان"
  fi
else
  warn "لم يعثر على عملية Node.js"
fi

# ----------------------------------------------------------
# 3. SUMMARY
# ----------------------------------------------------------
echo ""
echo -e "${BOLD}========================================${NC}"
if [[ $ERRORS -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  OK النشر اكتمل بنجاح${NC}"
else
  echo -e "${YELLOW}${BOLD}  WARN النشر اكتمل مع $ERRORS تحذير(ات)${NC}"
fi
echo -e "  http://173.249.51.11:8282/"
echo -e "  https://github.com/hadi-hani/arabic-shorts-generator"
echo -e "${BOLD}========================================${NC}"
