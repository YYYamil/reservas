#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Re-clona la base de desarrollo (reserva_albergue_dev) desde produccion
# (reserva_albergue). Se ejecuta EN EL SERVIDOR, nunca desde Windows.
#
# Uso:
#   sudo /home/ubuntu/reset-dev-db.sh
#   (o: sudo bash /var/www/reservas-albergues/scripts/reset-dev-db.sh)
#
# ADVERTENCIA: reemplaza todos los datos de la base dev. Cerra el servidor
# local y las conexiones del tunel antes de ejecutarlo.
# ---------------------------------------------------------------------------
set -euo pipefail

PROD_DB="${PROD_DB:-reserva_albergue}"
DEV_DB="${DEV_DB:-reserva_albergue_dev}"
DEV_OWNER="${DEV_OWNER:-usr_dev}"
DUMP="/tmp/${DEV_DB}_$(date +%Y%m%d%H%M%S).dump"
LOG="/tmp/${DEV_DB}_restore.log"

echo "== Dump de $PROD_DB =="
sudo -n -u postgres pg_dump -Fc "$PROD_DB" > "$DUMP"

if ! sudo -n -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DEV_DB'" | grep -q 1; then
  echo "== Creando $DEV_DB =="
  sudo -n -u postgres createdb -O "$DEV_OWNER" "$DEV_DB"
fi

echo "== Restaurando en $DEV_DB =="
set +e
sudo -n -u postgres pg_restore -d "$DEV_DB" --clean --if-exists \
  --no-owner --no-privileges "$DUMP" > "$LOG" 2>&1
RC=$?
set -e
grep -v "transaction_timeout" "$LOG" || true
rm -f "$LOG" "$DUMP"
if [ "$RC" -ne 0 ]; then
  echo "ERROR: pg_restore termino con codigo $RC" >&2
  exit "$RC"
fi

echo "== Ajustando dueno de los objetos a $DEV_OWNER =="
sudo -n -u postgres psql -d "$DEV_DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
DO \$\$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, '$DEV_OWNER');
  END LOOP;
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO %I', r.viewname, '$DEV_OWNER');
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.sequencename, '$DEV_OWNER');
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', r.sig, '$DEV_OWNER');
  END LOOP;
END
\$\$;
ALTER SCHEMA public OWNER TO $DEV_OWNER;
GRANT ALL ON SCHEMA public TO $DEV_OWNER;
SQL

echo "== Conteos =="
sudo -n -u postgres psql -d "$DEV_DB" -c "
select
  (select count(*) from albergues)             as albergues,
  (select count(*) from albergue_imagenes)     as imagenes,
  (select count(*) from usuarios)              as usuarios,
  (select count(*) from reservas_visitas)      as visitas,
  (select count(*) from reservas_alojamiento)  as alojamientos,
  (select count(*) from comprobantes)          as comprobantes;"

echo "== OK: $DEV_DB actualizada desde $PROD_DB =="
