#!/usr/bin/env bash
# deploy/canary/neon-tables.sh — THE PRE-DEPLOY LIVE-STORAGE CANARY (W-28).
#
# THE LESSON THIS SHIPS (the 2026-10-06 W-27 incident, LEAD-W27-INCIDENT-1):
# W-27 added a 7th Neon table (tradrl_jobs) and deployed WITHOUT it — the
# durable boot world failed at the first request ("relation 'tradrl_jobs'
# does not exist"), every route answered the typed 503, and production had
# to be rolled back. The register's lesson: "every schema-changing wave
# must ship with an operator runbook step + a pre-deploy live-storage probe
# (a canary GET against the durable backing before the alias flips)."
# This script IS that probe, wired into the runbook
# (deploy/README.md §neon — run it BEFORE deploying any schema-changing
# wave).
#
# WHAT IT DOES (read-only, idempotent, zero-dependency — bash + curl only):
#   1. reads the DDL records' table names from THE CHECKOUT'S OWN
#      deploy/adapters/neon/schema.ts (NEON_DDL_RECORDS — the single source
#      of truth; a schema-changing wave that adds a table is probed
#      automatically, no list to keep in sync);
#   2. runs ONE SQL-over-HTTP SELECT against the live database (the exact
#      wire protocol of deploy/adapters/neon/client.ts, the protocol behind
#      @neondatabase/serverless's HTTP fetch mode):
#
#        POST https://<host>/sql
#        Content-Type: application/json
#        Accept: application/json
#        Neon-Connection-String: postgresql://<user>:<password>@<host>/<database>?sslmode=require
#        Neon-Array-Mode: true
#        Neon-Raw-Text-Output: true
#        {"query": "SELECT tablename FROM pg_tables WHERE schemaname = 'public'", "params": []}
#
#   3. verifies EVERY expected table exists in the live schema (public);
#   4. exits 0 listing the present tables, or exits non-zero naming the
#      MISSING ones and pointing at the runbook step that fixes it.
#
# ENVIRONMENT (the production connection values — secrets are NEVER
# echoed, never logged, never written anywhere; the script prints only
# key NAMES in its errors):
#   NEON_API_HOST    the POOLED endpoint host (ep-...-pooler.<region>.aws.neon.tech)
#   NEON_API_USER    the database role (e.g. neondb_owner)
#   NEON_DATABASE    the database name (e.g. neondb)
#   NEON_API_KEY     the database password (the role's secret)
#
# EXIT CODES:
#   0  every DDL-record table exists in the live database (deploy may proceed)
#   1  one or more tables are MISSING (apply the DDL records first — the
#      runbook's §neon operator paste block — then deploy)
#   2  the probe itself failed (transport / HTTP / malformed answer — the
#      database could not be verified; do NOT deploy)
#   3  configuration error (missing env key, missing schema.ts, missing curl)
#
# The password is percent-encoded WITHIN the connection string exactly like
# the product client's neonConnectionString (component-level encoding, the
# postgresql://…@…/…? structure literal — the live proxy parses the header
# value as a URL and rejects the whole-string-encoded form; W-26A).
#
# Spec anchors: D-033 (Neon is the durable-store provider), R46 (failures
# are typed exit codes + messages, never a hang or a silent pass), the
# zero-dep law (bash + curl only — no node, no jq, no npm package).

set -u
# NEVER `set -x` here — the environment carries the database password.
# LC_ALL=C: the percent-encoding loop below must iterate BYTES (the
# connection-string header is a byte-exact wire format).
export LC_ALL=C

readonly PROG_NAME="deploy/canary/neon-tables.sh"
readonly RUNBOOK_STEP="deploy/README.md, the section 'The Neon schema (apply once — the runbook's §neon paste block)'"

# ---------------------------------------------------------------------------
# 1. The tooling guard (fail fast, typed)
# ---------------------------------------------------------------------------
if ! command -v curl >/dev/null 2>&1; then
  echo "${PROG_NAME}: FATAL: curl is not on PATH — the canary is bash + curl only (the zero-dep law)." >&2
  exit 3
fi

# ---------------------------------------------------------------------------
# 2. The expected tables, extracted from the checkout's own DDL records
#    (NEON_DDL_RECORDS — deploy/adapters/neon/schema.ts). Resolved relative
#    to THIS script so the operator may run it from any directory of the
#    deploying wave's checkout.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
SCHEMA_FILE="${SCRIPT_DIR}/../adapters/neon/schema.ts"

if [ ! -f "${SCHEMA_FILE}" ]; then
  echo "${PROG_NAME}: FATAL: the DDL records file is missing at ${SCHEMA_FILE}." >&2
  echo "  Run the canary from a checkout of the wave being deployed (the table" >&2
  echo "  list it probes is the wave's OWN deploy/adapters/neon/schema.ts)." >&2
  exit 3
fi

# Every CREATE TABLE IF NOT EXISTS name in the DDL records, in declaration
# order, deduped. Extra tables in the live database are NOT an error (only
# missing ones are).
EXPECTED_TABLES="$(grep -oE 'CREATE TABLE IF NOT EXISTS [A-Za-z0-9_]+' "${SCHEMA_FILE}" | sed 's/^CREATE TABLE IF NOT EXISTS //' | awk '!seen[$0]++')"
if [ -z "${EXPECTED_TABLES}" ]; then
  echo "${PROG_NAME}: FATAL: no CREATE TABLE IF NOT EXISTS statements found in ${SCHEMA_FILE} — the extraction is broken (a canary bug, never a silent pass)." >&2
  exit 3
fi

# ---------------------------------------------------------------------------
# 3. The configuration guard (names only — a value is never printed)
# ---------------------------------------------------------------------------
MISSING_KEYS=""
for KEY in NEON_API_HOST NEON_API_USER NEON_DATABASE NEON_API_KEY; do
  if [ -z "${!KEY:-}" ]; then
    MISSING_KEYS="${MISSING_KEYS} ${KEY}"
  fi
done
if [ -n "${MISSING_KEYS}" ]; then
  echo "${PROG_NAME}: FATAL: required environment keys are not set:${MISSING_KEYS}" >&2
  echo "  Export the four connection values (the pooled host, the role, the" >&2
  echo "  database name and the role's password) — the canary never prints them." >&2
  exit 3
fi

# ---------------------------------------------------------------------------
# 4. The connection string (component-level percent-encoding, W-26A law)
# ---------------------------------------------------------------------------
urlencode() {
  # Percent-encode every byte outside RFC 3986's unreserved set — the bash
  # byte-for-byte equivalent of the product client's encodeURIComponent
  # within the connection string (identical decoded form on the wire).
  local raw="$1" out="" byte index
  for (( index = 0; index < ${#raw}; index++ )); do
    byte="${raw:index:1}"
    case "${byte}" in
      [A-Za-z0-9._~-]) out+="${byte}" ;;
      *) out+="$(printf '%%%02X' "'${byte}")" ;;
    esac
  done
  printf '%s' "${out}"
}

CONNECTION_STRING="postgresql://${NEON_API_USER}:$(urlencode "${NEON_API_KEY}")@${NEON_API_HOST}/${NEON_DATABASE}?sslmode=require"

# ---------------------------------------------------------------------------
# 5. The probe: ONE read-only SELECT over the SQL-over-HTTP protocol
# ---------------------------------------------------------------------------
QUERY="SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
REQUEST_BODY='{"query":"'"${QUERY}"'","params":[]}'

HTTP_CODE_AND_BODY="$(curl -sS \
  --connect-timeout 10 \
  --max-time 30 \
  -X POST "https://${NEON_API_HOST}/sql" \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -H "neon-connection-string: ${CONNECTION_STRING}" \
  -H 'neon-array-mode: true' \
  -H 'neon-raw-text-output: true' \
  --data "${REQUEST_BODY}" \
  -w '\n%{http_code}' 2>&1)"
CURL_EXIT=$?

if [ ${CURL_EXIT} -ne 0 ]; then
  echo "${PROG_NAME}: FATAL: the SQL-over-HTTP endpoint could not be reached (curl exit ${CURL_EXIT})." >&2
  echo "  The database could NOT be verified — do not deploy until the probe passes." >&2
  exit 2
fi

# The last line of the captured output is the HTTP status; the rest is the body.
HTTP_CODE="${HTTP_CODE_AND_BODY##*$'\n'}"
RESPONSE_BODY="${HTTP_CODE_AND_BODY%$'\n'*}"

if [ "${HTTP_CODE}" != "200" ]; then
  echo "${PROG_NAME}: FATAL: Neon answered HTTP ${HTTP_CODE} — the probe SELECT was refused." >&2
  # The server's own message, trimmed (it names the failure — e.g. an auth
  # problem or a degraded endpoint — and never carries the request headers).
  echo "  server message: $(printf '%s' "${RESPONSE_BODY}" | head -c 300)" >&2
  echo "  The database could NOT be verified — do not deploy until the probe passes." >&2
  exit 2
fi

# A 200 that is not an array-mode SELECT envelope means the proxy answered
# something the probe does not understand — a canary bug or a protocol
# drift, never a silent pass (R46).
case "${RESPONSE_BODY}" in
  *'"fields"'*) : ;; # the array-mode SELECT envelope shape
  *)
    echo "${PROG_NAME}: FATAL: the 200 body is not a SQL-over-HTTP SELECT envelope — the wire protocol may have drifted (see deploy/adapters/neon/client.ts)." >&2
    echo "  body: $(printf '%s' "${RESPONSE_BODY}" | head -c 300)" >&2
    exit 2
    ;;
esac

# ---------------------------------------------------------------------------
# 6. The verdict: every expected table present, or the missing named
# ---------------------------------------------------------------------------
MISSING_TABLES=""
PRESENT_COUNT=0
for TABLE in ${EXPECTED_TABLES}; do
  # Array-mode rows are JSON string arrays — the quoted name is an exact
  # marker (the closing quote keeps prefix tables from matching each other).
  case "${RESPONSE_BODY}" in
    *'"'"${TABLE}"'"'*)
      echo "  present: ${TABLE}"
      PRESENT_COUNT=$((PRESENT_COUNT + 1))
      ;;
    *)
      MISSING_TABLES="${MISSING_TABLES} ${TABLE}"
      ;;
  esac
done

TOTAL_COUNT="$(printf '%s\n' ${EXPECTED_TABLES} | wc -l | tr -d ' ')"

if [ -n "${MISSING_TABLES}" ]; then
  echo "${PROG_NAME}: MISSING TABLES in the live database (host ${NEON_API_HOST}, database ${NEON_DATABASE}):${MISSING_TABLES}" >&2
  echo "  The deploying wave's DDL records expect ${TOTAL_COUNT} tables; the live schema lacks the ones above." >&2
  echo "  FIX FIRST (the runbook step): apply the DDL records — ${RUNBOOK_STEP}" >&2
  echo "  — paste every NEON_DDL_RECORDS statement into the Neon SQL editor (or psql);" >&2
  echo "  the statements are CREATE TABLE/INDEX IF NOT EXISTS, so re-applying is" >&2
  echo "  idempotent. THEN re-run this canary (it must exit 0) and deploy." >&2
  echo "  (The 2026-10-06 W-27 incident: a schema-changing wave deployed without its" >&2
  echo "  new table took every route down — this probe is the lesson.)" >&2
  exit 1
fi

echo "${PROG_NAME}: OK — all ${TOTAL_COUNT} DDL-record tables are present in the live database (host ${NEON_API_HOST}, database ${NEON_DATABASE}, ${PRESENT_COUNT}/${TOTAL_COUNT} verified)."
echo "  The pre-deploy live-storage probe passed; the deploy may proceed (deploy/README.md §neon)."
exit 0
