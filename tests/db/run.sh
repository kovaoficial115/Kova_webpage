#!/bin/sh
# Ejecuta las pruebas de base de datos: imprime cada expectativa cumplida y termina con error si alguna falla.
set -e
cd "$(dirname "$0")/../.."
tests/db/reset.sh
psql -h /tmp -p 5433 -U postgres -d kova -v ON_ERROR_STOP=1 -q -t -o /dev/null -f tests/db/10_pruebas.sql 2>&1 \
  | grep -v "^CONTEXT\|^PL/pgSQL\|^SQL statement\|NOTICE:  [a-z_]* .* does not exist, skipping" | sed 's/^psql:[^ ]*: NOTICE:  //'
