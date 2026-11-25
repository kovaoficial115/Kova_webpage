#!/bin/sh
# Recrea la base local de pruebas: stub de Supabase + esquema actual + migraciones nuevas + datos reales del catálogo.
set -e
cd "$(dirname "$0")/../.."
P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists kova" -c "create database kova" >/dev/null
for f in tests/db/00_supabase_stub.sql "kova-web 2/supabase/schema.sql" tests/db/01_datos_actuales.sql "kova-web 2/supabase/migrations/"*.sql; do
  $P -d kova -f "$f" 2>&1 | grep -v NOTICE || true
done
