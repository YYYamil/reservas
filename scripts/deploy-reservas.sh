#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy de produccion - Reservas Albergues (Oracle Cloud)
#
# Uso en el servidor:
#   /home/ubuntu/deploy-reservas.sh
#
# Reglas:
#   - El codigo SIEMPRE viene de Git (rama main). No se edita a mano en el
#     servidor: si hay cambios locales versionados, este script los descarta.
#   - Los archivos NO versionados se conservan entre deploys:
#       api/config.local.php, comprobantes/, Img/albergues/
#   - Las migraciones se aplican una sola vez, registradas en schema_migrations.
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/reservas-albergues}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
DB="${DB:-reserva_albergue}"

cd "$APP_DIR"

echo "== Git: $REMOTE/$BRANCH =="
git fetch --prune "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "-- AVISO: habia cambios locales en archivos versionados; se descartan:"
  git status --short --untracked-files=no
fi

git checkout -f -B "$BRANCH" "$REMOTE/$BRANCH" >/dev/null
git reset --hard "$REMOTE/$BRANCH" >/dev/null
git branch --set-upstream-to="$REMOTE/$BRANCH" "$BRANCH" >/dev/null 2>&1 || true

echo "== Migraciones =="
sudo -n -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

shopt -s nullglob
for f in api/migrations/*.sql; do
  base=$(basename "$f")
  applied=$(sudo -n -u postgres psql -d "$DB" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$base'")
  if [ "$applied" = "1" ]; then
    echo " -> $base (ya aplicada)"
    continue
  fi
  echo " -> $base (aplicando)"
  php api/tests/aplicar_migracion.php "$f"
  sudo -n -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 \
    -c "INSERT INTO schema_migrations(filename) VALUES ('$base') ON CONFLICT DO NOTHING" >/dev/null
done

echo "== Permisos =="
sudo -n chown -R ubuntu:www-data "$APP_DIR"
sudo -n find "$APP_DIR" -type d -exec chmod 755 {} \;
sudo -n find "$APP_DIR" -type f -exec chmod 644 {} \;
sudo -n mkdir -p "$APP_DIR/comprobantes/visita" "$APP_DIR/comprobantes/alojamiento" "$APP_DIR/Img/albergues"
sudo -n chown -R www-data:www-data "$APP_DIR/comprobantes" "$APP_DIR/Img/albergues"
sudo -n chmod -R 775 "$APP_DIR/comprobantes" "$APP_DIR/Img/albergues"
sudo -n chown ubuntu:www-data "$APP_DIR/api/config.local.php"
sudo -n chmod 640 "$APP_DIR/api/config.local.php"
sudo -n chmod 755 "$APP_DIR"/scripts/*.sh 2>/dev/null || true

echo "== Recargar servicios =="
sudo -n nginx -t
sudo -n systemctl reload nginx
sudo -n systemctl reload php8.1-fpm

echo "== OK =="
git log --oneline -1
