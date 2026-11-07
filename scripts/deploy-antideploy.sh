#!/usr/bin/env bash
#
# Deploy Euler's Forge to Antideploy, following https://antideploy.com/agent.md and the API at
# https://antideploy.com/api/v1.
#
# Why this exists as a script: the agent that wrote it runs in a container whose outbound allowlist
# does not include antideploy.com, and the platform's own instructions say that is the one condition
# that stops the job and must not be worked around. Everything else is ready, so this encodes the
# documented flow exactly — run it anywhere with ordinary network access (or here once the domain is
# allowed) and it does the whole thing.
#
# It is written to be safe to run more than once:
#   - an existing token in ~/.antideploy/config.json is reused, never printed;
#   - an existing .antideploy.json means the application already exists, so it is not created again;
#   - the deploy always carries the environment the app needs, so a redeploy cannot drop it.
#
# Usage:
#   scripts/deploy-antideploy.sh                      # deploy, creating the application if needed
#   scripts/deploy-antideploy.sh --subdomain my-name  # choose the address explicitly
#   scripts/deploy-antideploy.sh --dry-run            # build the archive and check limits, no network
#
# Exit codes: 0 deployed or dry-run ok, 1 error, 2 Antideploy unreachable, 3 deploy failed.

set -euo pipefail

readonly API="https://antideploy.com"
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CONFIG_DIR="${HOME}/.antideploy"
readonly CONFIG_FILE="${CONFIG_DIR}/config.json"
readonly APP_FILE="${PROJECT_ROOT}/.antideploy.json"

# The platform's own ceilings (GET /api/v1 -> limits).
readonly MAX_TOTAL_BYTES=29360128
readonly MAX_FILES=4000

SUBDOMAIN=""
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --subdomain)
      SUBDOMAIN="${2:-}"
      [ -n "$SUBDOMAIN" ] || { echo "--subdomain needs a value" >&2; exit 1; }
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      sed -n '3,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit "${2:-1}"; }

# --- 0. Reachability, exactly as the instructions require -----------------------------------------

if [ "$DRY_RUN" -eq 0 ]; then
  # Any answer at all is fine, including an error status; only a failed connection is fatal.
  if ! curl -sS -m 20 -o /dev/null "${API}/api/v1"; then
    cat >&2 <<'BLOCKED'
This environment cannot reach antideploy.com, so nothing below it will work: connecting, deploying
and reading logs all go to that one host. Add antideploy.com to the allowed domains in its network
settings and run this again, or run it on a machine with ordinary network access.

(Do not work around it. No mirror and no credential helps, because the block is on the way out of
the container and the code to deploy is inside it.)
BLOCKED
    exit 2
  fi
fi

# --- 1. The archive, checked against the platform's limits before anything is sent ----------------

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
ARCHIVE="${WORK}/project.tar.gz"

say "packing the project..."
tar czf "${ARCHIVE}" \
  --exclude=./.git \
  --exclude=./node_modules \
  --exclude=./.next \
  --exclude=./.data \
  --exclude=./test-results \
  --exclude=./playwright-report \
  --exclude=./coverage \
  -C "${PROJECT_ROOT}" .

BYTES="$(wc -c < "${ARCHIVE}" | tr -d ' ')"

# The listing is written once and then queried, rather than piped into `grep -q` for every check:
# under `set -o pipefail`, grep -q exits at the first match, tar dies of SIGPIPE, and the pipeline
# reports failure even though the entry was found.
tar tzf "${ARCHIVE}" > "${WORK}/files.txt"
FILES="$(grep -vc '/$' "${WORK}/files.txt" || true)"

say "archive: $(( BYTES / 1024 )) KiB, ${FILES} files"
[ "${BYTES}" -le "${MAX_TOTAL_BYTES}" ] ||
  die "archive is ${BYTES} bytes, over the platform's ${MAX_TOTAL_BYTES}-byte ceiling"
[ "${FILES}" -le "${MAX_FILES}" ] ||
  die "archive holds ${FILES} files, over the platform's ${MAX_FILES}-file ceiling"

# The whole project must be sent; a push holding only an entry point builds and then serves 404s.
for required in ./package.json ./package-lock.json ./next.config.ts ./src/app/layout.tsx; do
  grep -qx "${required}" "${WORK}/files.txt" || die "archive is missing ${required}"
done

if [ "$DRY_RUN" -eq 1 ]; then
  say "dry run: the archive is complete and inside both limits; nothing was sent."
  exit 0
fi

# --- 2. The account token ------------------------------------------------------------------------

TOKEN=""
if [ -s "${CONFIG_FILE}" ]; then
  TOKEN="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${CONFIG_FILE}")"
fi
if [ -z "${TOKEN}" ] && [ -n "${ANTIDEPLOY_TOKEN:-}" ]; then
  TOKEN="${ANTIDEPLOY_TOKEN}"
fi

if [ -z "${TOKEN}" ]; then
  say "connecting to Antideploy..."
  device="$(curl -sS -X POST "${API}/api/v1/device/code" \
    -H 'content-type: application/json' \
    -d '{"clientName":"Arena Agent"}')" || die "could not start the device flow"

  user_code="$(printf '%s' "${device}" | jq -r '.userCode')"
  verify_url="$(printf '%s' "${device}" | jq -r '.verificationUriComplete')"
  device_code="$(printf '%s' "${device}" | jq -r '.deviceCode')"
  interval="$(printf '%s' "${device}" | jq -r '.interval // 5')"

  say ""
  say "  Open ${verify_url}"
  say "  Confirm the code reads ${user_code}, then click Approve."
  say ""
  say "  If you have no Antideploy account, that same link creates one."
  say ""

  deadline=$(( $(date +%s) + 900 ))
  while :; do
    response="$(curl -sS -X POST "${API}/api/v1/device/token" \
      -H 'content-type: application/json' \
      -d "$(jq -nc --arg c "${device_code}" '{deviceCode:$c}')")" || true
    TOKEN="$(printf '%s' "${response}" | jq -r '.token // empty')"
    [ -n "${TOKEN}" ] && break

    case "$(printf '%s' "${response}" | jq -r '.error // .code // empty')" in
      authorization_pending) ;;
      access_denied) die "the request was refused, so nothing was deployed. Not retrying." ;;
      expired_token) die "the code expired; run this script again." ;;
      *) ;;
    esac

    [ "$(date +%s)" -lt "${deadline}" ] || die "the code expired while waiting; run this again."
    sleep "${interval}"
  done

  # Written with a redirect so the token never reaches the terminal.
  mkdir -p "${CONFIG_DIR}"
  chmod 700 "${CONFIG_DIR}"
  ( umask 077; printf '{"token":"%s"}\n' "${TOKEN}" > "${CONFIG_FILE}" )
  say "connected$(printf '%s' "${response}" | jq -r 'if .account.label then " as " + .account.label else "" end')."
fi

auth() { curl -sS -H "authorization: Bearer ${TOKEN}" "$@"; }

# A revoked token is not retried; it is reported so the operator can connect again.
status_code="$(auth -o /dev/null -w '%{http_code}' "${API}/api/v1/applications")"
case "${status_code}" in
  200) ;;
  401) die "the saved token was rejected (revoked, or issued elsewhere). Delete ${CONFIG_FILE} and run this again." ;;
  *) die "listing applications answered HTTP ${status_code}" ;;
esac

# --- 3. The application --------------------------------------------------------------------------

if [ -s "${APP_FILE}" ]; then
  APP_ID="$(jq -r '.applicationId' "${APP_FILE}")"
  say "using the existing application ${APP_ID}"
else
  name="$(basename "${PROJECT_ROOT}")"
  payload="$(jq -nc --arg n "${name}" --arg s "${SUBDOMAIN}" \
    'if $s == "" then {name:$n} else {name:$n, subdomain:$s} end')"

  if [ -n "${SUBDOMAIN}" ]; then
    check="$(auth "${API}/api/v1/hostnames/check?label=${SUBDOMAIN}")"
    printf '%s' "${check}" | jq -e '.available == true' >/dev/null 2>&1 ||
      die "the address ${SUBDOMAIN}.antideploy.app is not available; pick another with --subdomain"
  fi

  created="$(auth -X POST "${API}/api/v1/applications" \
    -H 'content-type: application/json' -d "${payload}")" || true
  APP_ID="$(printf '%s' "${created}" | jq -r '.applicationId // empty')"

  if [ -z "${APP_ID}" ]; then
    # 409 name_taken carries the existing applicationId, which is not an error.
    APP_ID="$(printf '%s' "${created}" | jq -r '.applicationId // empty')"
    [ -n "${APP_ID}" ] || die "could not create the application: ${created}"
  fi

  printf '{"applicationId":"%s"}\n' "${APP_ID}" > "${APP_FILE}"
  say "created application ${APP_ID} (saved to .antideploy.json)"
fi

ADDRESS="$(auth "${API}/api/v1/applications/${APP_ID}" | jq -r '.subdomain // empty')"
[ -n "${ADDRESS}" ] || ADDRESS="${SUBDOMAIN:-$(basename "${PROJECT_ROOT}")}"
LIVE_URL="https://${ADDRESS}.antideploy.app"

# --- 4. Deploy, with the environment this app needs ----------------------------------------------

# FORGE_DISABLE_SERVER is the important one. The container is replaced on every deploy, so the
# account store's filesystem is not persistent; the flag makes the server refuse account storage
# with an honest sentence instead of accepting sign-ups that the next deploy would erase. The two
# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ENV_JSON="$(jq -nc \
  --arg url "${LIVE_URL}" \
  '{FORGE_DISABLE_SERVER:"1",NEXT_PUBLIC_FORGE_ENVIRONMENT:"production",NEXT_PUBLIC_FORGE_SITE_URL:$url}')"

say "deploying ${LIVE_URL} ..."
queued="$(curl -sS -X POST "${API}/api/v1/deploy?applicationId=${APP_ID}" \
  -H "authorization: Bearer ${TOKEN}" \
  -F "archive=@${ARCHIVE}" \
  -F "env=${ENV_JSON}")" || die "the deploy request failed"

TASK_ID="$(printf '%s' "${queued}" | jq -r '.taskId // empty')"
if [ -z "${TASK_ID}" ]; then
  if [ "$(printf '%s' "${queued}" | jq -r '.status // empty')" = "unchanged" ]; then
    say "nothing changed since the last push, so nothing was built."
    exit 0
  fi
  die "the deploy was refused: ${queued}"
fi
say "queued as ${TASK_ID}"

# --- 5. Watch it ---------------------------------------------------------------------------------

# A build takes a couple of minutes; twenty is generous, and a loop with no end is worse than a
# timeout because it looks like progress while nothing is happening.
deadline=$(( $(date +%s) + 1200 ))
while :; do
  [ "$(date +%s)" -lt "${deadline}" ] ||
    die "gave up waiting after 20 minutes; check /api/v1/deployments/${TASK_ID} for the current state" 3
  state="$(auth "${API}/api/v1/deployments/${TASK_ID}")"
  status="$(printf '%s' "${state}" | jq -r '.status // "unknown"')"
  step="$(printf '%s' "${state}" | jq -r '(.step // .progress.step // "") | tostring')"
  say "  ${status}${step:+ — ${step}}"

  case "${status}" in
    succeeded|live|ready) break ;;
    failed|error|cancelled)
      printf '%s\n' "${state}" | jq -r '.error // "no explanation given"' >&2
      printf '%s\n' "${state}" | jq -r '.deployment.buildLog // empty' | tail -40 >&2
      printf '%s\n' "${state}" | jq -r '.deployment.runtimeLog // empty' | tail -40 >&2
      exit 3
      ;;
    *) sleep 6 ;;
  esac
done

say ""
printf '%s\n' "${state}" | jq -r '.summary // empty'

issues="$(printf '%s' "${state}" | jq -r '.security.issues // [] | length')"
if [ "${issues}" != "0" ] && [ -n "${issues}" ]; then
  say ""
  say "security check found ${issues} issue(s) — read /api/v1/deployments/${TASK_ID} for each one's recommendation:"
  printf '%s\n' "${state}" | jq -r '.security.issues[]? | "  - \(.title // .check // "issue"): \(.recommendation // "")"'
fi
