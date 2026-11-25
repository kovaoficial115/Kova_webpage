#!/bin/sh
# Prueba de punta a punta: base local nueva + simulador de Supabase + servidor estático + Chrome.
set -e
cd "$(dirname "$0")/../.."
tests/db/reset.sh
psql -h /tmp -p 5433 -U postgres -d kova -v ON_ERROR_STOP=1 -q -o /dev/null -f tests/e2e/preparar.sql
rm -rf /tmp/mock-storage
pkill -f mock-supabase.mjs 2>/dev/null || true
node tests/e2e/mock-supabase.mjs > /tmp/mock.log 2>&1 &
MOCK=$!
curl -s -o /dev/null localhost:8080 || (cd "kova-web 2" && npx http-server -p 8080 -s -c-1 > /tmp/http.log 2>&1 &)
sleep 2
status=0
node tests/e2e/tienda.mjs || status=$?
kill $MOCK 2>/dev/null || true
exit $status
