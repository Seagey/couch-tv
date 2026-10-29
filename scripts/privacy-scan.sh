#!/bin/bash
# Privacy scan. Run it before every commit and before you publish a fork.
#
#   scripts/privacy-scan.sh [denylist-file] [--no-history]
#
# Checks, in order:
#   1. gitleaks on the working tree and on the git history (secrets, keys, tokens)
#   2. built-in generic checks anyone can use: private network addresses, email addresses,
#      phone numbers, MAC addresses (colon and dash forms), home-folder paths, calendar links,
#      home network host names (.local, .lan, .home.arpa, .ts.net), on the working tree and,
#      unless --no-history, on every change in the git history (git log -p)
#   3. files that should never be in the repo (keys, configs, APKs, logs)
#   4. your own denylist (optional): one word or phrase per line, case-insensitive. Keep that
#      file OUTSIDE the repo, because it holds exactly the words you do not want to publish.
#      Whole-word matches first, then a second pass for the same words inside longer words
#      (a name inside a host name or a file name, for example)
#   5. image metadata (GPS, author, camera) in every image in the repo, if exiftool is installed
#
# It prints where each finding is and which rule matched, never the matched text, so the output
# is safe to paste. Exit code 0 means zero findings. Anything else means do not publish.

set -u
cd "$(dirname "$0")/.." || exit 2

DENYLIST=""
HISTORY=1
for a in "$@"; do
  case "$a" in
    --no-history) HISTORY=0 ;;
    *) DENYLIST="$a" ;;
  esac
done
HAS_GIT=0
[ "$HISTORY" = 1 ] && git rev-parse HEAD > /dev/null 2>&1 && HAS_GIT=1

FOUND=0
note() { echo "  $*"; FOUND=$((FOUND + 1)); }
# --exclude=.git: in a git worktree, .git is a one-line file naming the main repo (never committed)
EXCL=(--exclude-dir=.git --exclude=.git --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=dist --exclude-dir=build --exclude-dir=__pycache__ --exclude-dir=.gradle)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/privacy-scan.XXXXXX") || exit 2
trap 'rm -f "$TMP"/history.txt; rmdir "$TMP" 2> /dev/null' EXIT

echo "== 1. gitleaks"
if command -v gitleaks > /dev/null 2>&1; then
  if ! gitleaks dir . --no-banner --redact -l error > /dev/null 2>&1; then
    note "gitleaks found something in the working tree (run: gitleaks dir . --redact)"
  fi
  if [ "$HAS_GIT" = 1 ]; then
    if ! gitleaks git . --no-banner --redact -l error > /dev/null 2>&1; then
      note "gitleaks found something in the git history (run: gitleaks git . --redact)"
    fi
  fi
else
  note "gitleaks is not installed (brew install gitleaks, or see github.com/gitleaks/gitleaks)"
fi

# rule name | extended regex. Matches are reported as file:line plus the rule name only.
RULES=(
  "private-ip-192.168|(^|[^0-9.])192\.168\.[0-9]{1,3}\.[0-9]{1,3}"
  "private-ip-10.x|(^|[^0-9.])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}"
  "private-ip-172.16-31|(^|[^0-9.])172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}"
  "cgnat-or-vpn-ip-100.64-127|(^|[^0-9.])100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}"
  "link-local-ip|(^|[^0-9.])169\.254\.[0-9]{1,3}\.[0-9]{1,3}"
  "email|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}"
  "phone-au|(\+61[ -]?|(^|[^0-9])0)[2-478]([ -]?[0-9]){8}([^0-9]|$)"
  "phone-intl|\+[1-9][0-9]{0,2}[ -]?\(?[0-9]{2,4}\)?[ -]?[0-9]{3,4}[ -]?[0-9]{3,4}"
  "mac-address|(^|[^0-9A-Fa-f:])([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}([^0-9A-Fa-f:]|$)"
  "mac-address-dash|(^|[^0-9A-Fa-f-])([0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2}([^0-9A-Fa-f-]|$)"
  "home-folder-path|(/Users/[A-Za-z0-9._-]+/|/home/[A-Za-z0-9._-]+/|C:\\\\Users\\\\[A-Za-z0-9._-]+)"
  "calendar-link|(webcal://|calendar\.google\.com/calendar/ical|icloud\.com/published)"
  "local-hostname|[A-Za-z0-9-]+\.local([^A-Za-z0-9]|$)"
  "home-network-hostname|[A-Za-z0-9-]+\.(lan|home\.arpa|ts\.net)([^A-Za-z0-9.-]|$)"
)
# Text that is allowed to match (placeholders and public noreply addresses). Per line, extended regex.
ALLOW='users\.noreply\.github\.com|@example\.(com|org)|your-computer\.local|homeassistant\.local|my-computer\.local|example\.local|<your-computer>\.local|x@y\.z|@types/|@vitejs/|@rolldown/|@oxc-project/|@emnapi/|@napi-rs/|@tybys/|@babel/|@esbuild/|@rollup/|@img/|\.local\.(plist|service)|_tcp\.local\.'

echo "== 2. generic checks (private addresses, emails, phones, paths)"
for rule in "${RULES[@]}"; do
  name="${rule%%|*}"; re="${rule#*|}"
  # package-lock.json is machine written: only check it for the rules that cannot match a hash.
  hits=$(grep -rInE "${EXCL[@]}" --exclude=privacy-scan.sh "$re" . 2> /dev/null | grep -vE "$ALLOW" | grep -vE '^\./remote/package-lock\.json:[0-9]+:.*(integrity|resolved)' | cut -d: -f1,2)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do note "$name  $h"; done <<< "$hits"
  fi
done
if [ "$HAS_GIT" = 1 ]; then
  # Every added or removed line in every commit, tagged with its commit and file, so a value that
  # was committed once and deleted later is still caught.
  git log --all -p --no-color --no-ext-diff --format='@@commit %h' -- . ':!scripts/privacy-scan.sh' ':!remote/package-lock.json' 2> /dev/null |
    awk '/^@@commit /{c=$2; next} /^\+\+\+ b\//{f=substr($0,7); next} /^[+-]/ && !/^(\+\+\+|---) /{print c " " f ": " substr($0,2)}' > "$TMP/history.txt"
  for rule in "${RULES[@]}"; do
    name="${rule%%|*}"; re="${rule#*|}"
    hits=$(grep -aE "$re" "$TMP/history.txt" | grep -vE "$ALLOW" | cut -d: -f1 | sort -u)
    if [ -n "$hits" ]; then
      while IFS= read -r h; do note "$name  git history, commit $h"; done <<< "$hits"
    fi
  done
fi

echo "== 3. files that should never be in the repo"
bad=$(git ls-files 2> /dev/null; find . \( -name .git -o -name node_modules -o -name .venv \) -prune -o -type f -print 2> /dev/null | sed 's|^\./||')
bad=$(echo "$bad" | sort -u | grep -E '(\.apk$|\.aab$|\.pem$|\.jks$|\.keystore$|(^|/)adbkey|(^|/)pair-code|(^|/)token|\.bak|-backup-|(^|/)config\.json$|(^|/)\.env$|(^|/)bridge/data/|\.ics$|\.sqlite$|\.log$|\.orig$|\.rej$|(^|/)\.impeccable/)' | grep -vE '(^|/)(node_modules|\.venv|dist|build)/')
if [ -n "$bad" ]; then
  while IFS= read -r f; do note "forbidden-file  $f"; done <<< "$bad"
fi

echo "== 4. your denylist"
if [ -n "$DENYLIST" ]; then
  if [ -f "$DENYLIST" ]; then
    # -a reads binary files as text too, so strings inside images and archives are caught.
    # Pass 1, whole words.
    words=$(grep -rIaniwF "${EXCL[@]}" --exclude=privacy-scan.sh -f "$DENYLIST" . 2> /dev/null | cut -d: -f1,2 | sort -u)
    if [ -n "$words" ]; then
      while IFS= read -r h; do note "denylist  $h"; done <<< "$words"
    fi
    # Pass 2, the same words inside longer words, on lines pass 1 did not already report.
    parts=$(grep -rIaniF "${EXCL[@]}" --exclude=privacy-scan.sh -f "$DENYLIST" . 2> /dev/null | cut -d: -f1,2 | sort -u)
    if [ -n "$parts" ]; then
      while IFS= read -r h; do
        if [ -z "$words" ] || ! grep -qxF "$h" <<< "$words"; then note "denylist-inside-a-word  $h"; fi
      done <<< "$parts"
    fi
    # file and folder names
    names=$(find . \( -name .git -o -name node_modules -o -name .venv -o -name dist \) -prune -o -print 2> /dev/null | grep -iF -f "$DENYLIST")
    if [ -n "$names" ]; then
      while IFS= read -r f; do note "denylist-in-filename  $f"; done <<< "$names"
    fi
    # git history: commit messages, author names and emails, and every tracked file's content
    if [ "$HAS_GIT" = 1 ]; then
      if git log --all --format='%an %ae %cn %ce %s%n%b' | grep -qiF -f "$DENYLIST"; then
        note "denylist  git commit metadata (author, email or message)"
      fi
      for c in $(git rev-list --all); do
        if git grep -aiqF -f "$DENYLIST" "$c" -- . ':!scripts/privacy-scan.sh' 2> /dev/null; then
          note "denylist  git history, commit ${c:0:8}"
        fi
      done
      if [ -f "$TMP/history.txt" ] && grep -aqiF -f "$DENYLIST" "$TMP/history.txt"; then
        note "denylist  git history, a line added or removed in some commit (git log -p)"
      fi
    fi
  else
    note "denylist file not found: $DENYLIST"
  fi
else
  echo "  (no denylist given, skipped)"
fi

echo "== 5. image metadata"
if command -v exiftool > /dev/null 2>&1; then
  meta=$(exiftool -r -q -q -i .git -i node_modules -i .venv -i dist -i build \
    -ext jpg -ext jpeg -ext png -ext webp -ext heic -ext gif -ext tif -ext tiff \
    -if '$GPSLatitude or $Artist or $Make or $Model or $Copyright or $OwnerName or $CameraOwnerName or $SerialNumber or $Creator' \
    -p '$Directory/$FileName' . 2> /dev/null)
  if [ -n "$meta" ]; then
    while IFS= read -r f; do note "image-metadata  $f (run: exiftool -all= -overwrite_original \"$f\")"; done <<< "$meta"
  fi
else
  echo "  (exiftool not installed, skipped: brew install exiftool)"
fi

echo
echo "findings: $FOUND"
[ "$FOUND" -eq 0 ] && exit 0 || exit 1
