#!/usr/bin/env bash
# verify-cnb-merge.sh — gate for the npc/upstream-sync-v070 merge.
#
# The fork adopted upstream freellmapi v0.7.0 as its baseline and re-integrated
# its custom business logic (scene routing, model classification, catalog-sync
# category backfill) in the upstream implementation style. This script is the
# merge gate: it must exit 0 for the merge to be considered sound.
#
# Checks (in order, fail-fast):
#   1. Sensitive-info scan — no plaintext API keys / tokens in committed source.
#   2. Server typecheck (`tsc`) — the A-class integration must compile.
#   3. Migration registry — every migration file on disk is registered and in
#      order (the runner walks DEFAULT_MIGRATIONS, so a forgotten registry entry
#      is a silent no-op).
#   4. Server test suite — the re-derived business logic must keep every test
#      green (scene routing, model category, catalog sync, migrations).
#
# Usage:  ./verify-cnb-merge.sh   (exit 0 = pass, non-zero = fail)

set -uo pipefail
cd "$(dirname "$0")"

FAIL=0

echo "== [1/4] sensitive-info scan =="
# A light scan over committed source for obvious plaintext keys. This is a
# guardrail, not a substitute for the CI secret scanner.
SCAN_HITS=$(grep -rInE --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  '(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})' \
  server/src client/src cli/src shared/src 2>/dev/null || true)
if [ -n "$SCAN_HITS" ]; then
  echo "!! sensitive-looking tokens found in source:"
  echo "$SCAN_HITS"
  FAIL=1
else
  echo "ok — no sensitive tokens in source."
fi

echo "== [2/4] server typecheck (tsc) =="
if ! npm run build:server >/tmp/verify-cnb-tsc.log 2>&1; then
  echo "!! server typecheck failed — see /tmp/verify-cnb-tsc.log"
  tail -30 /tmp/verify-cnb-tsc.log
  FAIL=1
else
  echo "ok — server typecheck clean."
fi

echo "== [3/4] migration registry integrity =="
if ! npx vitest run --pool=forks --fileParallelism=false \
    src/__tests__/db/migrate/registry-drift.test.ts \
    >/tmp/verify-cnb-registry.log 2>&1; then
  echo "!! migration registry test failed — see /tmp/verify-cnb-registry.log"
  tail -30 /tmp/verify-cnb-registry.log
  FAIL=1
else
  echo "ok — migration registry consistent."
fi

echo "== [4/4] server test suite (focused A-class + migrations) =="
# Run the tests that cover the re-integrated custom logic plus the migration
# round trip, rather than the whole suite (which runs under CI). This keeps the
# gate fast while still guarding the actual merge surface.
if ! npx vitest run --pool=forks --fileParallelism=false \
    src/__tests__/db/migrate/roundtrip.test.ts \
    src/__tests__/services/model-category.test.ts \
    src/__tests__/services/scene-routing.test.ts \
    src/__tests__/services/catalog-sync.test.ts \
    >/tmp/verify-cnb-tests.log 2>&1; then
  echo "!! A-class / migration tests failed — see /tmp/verify-cnb-tests.log"
  tail -40 /tmp/verify-cnb-tests.log
  FAIL=1
else
  echo "ok — A-class and migration tests green."
fi

if [ "$FAIL" -eq 0 ]; then
  echo "== verify-cnb-merge.sh PASS =="
  exit 0
else
  echo "== verify-cnb-merge.sh FAIL =="
  exit 1
fi
