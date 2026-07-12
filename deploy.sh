#!/bin/bash
# ============================================================
#  deploy.sh — Arabic Shorts Generator
#  يرفع التعديلات إلى GitHub ويطبقها فوراً على الحاوية
#  الاستخدام:
#    ./deploy.sh                  → push كل شيء + apply
#    ./deploy.sh "رسالة الكوميت"  → push برسالة مخصصة + apply
#    ./deploy.sh --only-apply     → تطبيق فقط بدون push
#    ./deploy.sh --only-push      → push فقط بدون تطبيق
# ============================================================

set -e

PROJECT_DIR="/opt/arabic-shorts-generator"
CONTAINER="arabic-shorts-generator"
NGINX_HTML="/usr/share/nginx/html"
APP_DIR="/app"

# ألوان
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${CYAN}[deploy]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

COMMIT_MSG="${1:-"chore: auto-deploy $(date '+%Y-%m-%d %H:%M')"}"
ONLY_APPLY=false
ONLY_PUSH=false

[[ "$1" == "--only-apply" ]] && ONLY_APPLY=true && COMMIT_MSG=""
[[ "$1" == "--only-push"  ]] && ONLY_PUSH=true

cd "$PROJECT_DIR"

# ─────────────────────────────────────────────
# 1. PUSH TO GITHUB
# ─────────────────────────────────────────────
if [[ "$ONLY_APPLY" == "false" ]]; then
  log "فحص التغييرات..."

  # إضافة الملفات المعدّلة فقط (بدون .bak)
  git add frontend/index.html \
          backend/server.js \
          backend/services/ \
          docker-compose.yml \
          Dockerfile \
          README.md 2>/dev/null || true

  # تحقق إذا في شيء للـ commit
  if git diff --cached --quiet; then
    warn "لا توجد تغييرات جديدة للرفع على GitHub"
  else
    log "جاري الـ commit..."
    git commit -m "$COMMIT_MSG"
    log "جاري الـ push إلى GitHub..."
    if git push origin main 2>&1; then
      ok "تم الرفع على GitHub بنجاح ✅"
      echo -e "   ${BOLD}https://github.com/hadi-hani/arabic-shorts-generator${NC}"
    else
      warn "فشل الـ push — تحقق من GitHub token"
      warn "لمتابعة التطبيق المحلي فقط شغّل: ./deploy.sh --only-apply"
    fi
  fi
fi

[[ "$ONLY_PUSH" == "true" ]] && exit 0

# ─────────────────────────────────────────────
# 2. APPLY TO CONTAINER (live, no rebuild)
# ─────────────────────────────────────────────
log "تطبيق التعديلات على الحاوية فوراً..."

# تحقق أن الحاوية شغّالة
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  error "الحاوية '$CONTAINER' غير شغّالة! شغّلها أولاً."
fi

ERRORS=0

# frontend/index.html → nginx
if [[ -f "$PROJECT_DIR/frontend/index.html" ]]; then
  docker cp "$PROJECT_DIR/frontend/index.html" "$CONTAINER:$NGINX_HTML/index.html" && \
    ok "frontend/index.html → $NGINX_HTML/index.html" || { warn "فشل نسخ index.html"; ((ERRORS++)); }
fi

# backend/server.js → /app/server.js
if [[ -f "$PROJECT_DIR/backend/server.js" ]]; then
  docker cp "$PROJECT_DIR/backend/server.js" "$CONTAINER:$APP_DIR/server.js" && \
    ok "backend/server.js → $APP_DIR/server.js" || { warn "فشل نسخ server.js"; ((ERRORS++)); }
fi

# backend/services/ → /app/services/
if [[ -d "$PROJECT_DIR/backend/services" ]]; then
  for svc in "$PROJECT_DIR/backend/services"/*.js; do
    fname=$(basename "$svc")
    [[ "$fname" == *.bak* ]] && continue
    docker cp "$svc" "$CONTAINER:$APP_DIR/services/$fname" && \
      ok "services/$fname → $APP_DIR/services/$fname" || { warn "فشل نسخ $fname"; ((ERRORS++)); }
  done
fi

# إعادة تشغيل Node.js داخل الحاوية (بدون إعادة بناء الحاوية)
log "إعادة تشغيل Node.js داخل الحاوية..."
docker exec "$CONTAINER" sh -c "
  if command -v supervisorctl &>/dev/null; then
    supervisorctl restart node 2>/dev/null && echo 'supervisord: node restarted'
  elif command -v pm2 &>/dev/null; then
    pm2 restart all 2>/dev/null && echo 'pm2: restarted'
  else
    # kill node ليُعيد supervisord تشغيله تلقائياً
    pkill -f 'node server.js' 2>/dev/null && echo 'node process killed → will auto-restart' || echo 'node not found or already restarted'
  fi
" && ok "Node.js أُعيد تشغيله" || warn "تعذّر إعادة تشغيل Node.js — الواجهة الأمامية محدّثة فقط"

# ─────────────────────────────────────────────
# 3. SUMMARY
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════${NC}"
if [[ $ERRORS -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  ✅ النشر اكتمل بنجاح${NC}"
else
  echo -e "${YELLOW}${BOLD}  ⚠️  النشر اكتمل مع $ERRORS تحذير(ات)${NC}"
fi
echo -e "  🌐 http://173.249.51.11:8282/"
echo -e "  📦 https://github.com/hadi-hani/arabic-shorts-generator"
echo -e "${BOLD}════════════════════════════════════════${NC}"
