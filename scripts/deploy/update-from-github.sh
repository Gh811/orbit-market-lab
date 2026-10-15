#!/usr/bin/env bash
# Root orchestrates immutable releases. Git, tests and snapshot code run unprivileged.
set -euo pipefail
exec 9>/run/lock/orbit-update.lock
flock -n 9 || exit 0
WORK=/opt/orbit/github
REPO=https://github.com/Gh811/orbit-market-lab.git
BUILD_USER=orbit-build
export PATH=/opt/orbit/runtime/bin:/opt/orbit/runtime/node/bin:/usr/local/bin:/usr/bin:/bin
run_build(){ runuser -u "$BUILD_USER" -- env PATH="$PATH" PYTHONDONTWRITEBYTECODE=1 "$@"; }
if ! test -d "$WORK/.git";then run_build git clone --branch main --single-branch "$REPO" "$WORK";fi
run_build git -C "$WORK" fetch --prune origin main
COMMIT=$(run_build git -C "$WORK" rev-parse origin/main)
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]
if test "$(cat /opt/orbit/last-deployed-commit 2>/dev/null || true)" = "$COMMIT";then echo "Already deployed $COMMIT";exit 0;fi
run_build git -C "$WORK" reset --hard "$COMMIT"
run_build bash -c 'cd /opt/orbit/github && bash scripts/check-mobile.sh && python3 -m unittest discover -s tests -p "test_*.py"'
run_build bash -c 'cd /opt/orbit/github && python3 scripts/build-release.py > .release-path'
SOURCE=$(cat "$WORK/.release-path")
[[ "$SOURCE" =~ ^/opt/orbit/github/\.releases/orbit-[0-9]{8}-[0-9a-f]{12}$ ]]
NAME=$(basename "$SOURCE");TARGET="/opt/orbit/releases/$NAME"
if ! test -d "$TARGET";then cp -a "$SOURCE" "$TARGET";chown -R root:root "$TARGET";chmod -R u=rwX,go=rX "$TARGET";fi
# Refuse mismatched artifacts before exposing them to the app.
python3 - "$TARGET" <<'PY'
import json,hashlib,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve();m=json.loads((root/'release.json').read_text())
for name,expected in m['files'].items():
 p=(root/name).resolve()
 assert p.is_relative_to(root) and p.is_file() and not p.is_symlink(),name
 assert hashlib.sha256(p.read_bytes()).hexdigest()==expected,name
print('Verified release',m['releaseId'])
PY
PREVIOUS=$(readlink -f /opt/orbit/current)
ln -s "$TARGET" /opt/orbit/.current.next
mv -Tf /opt/orbit/.current.next /opt/orbit/current
systemctl restart orbit || true
EXPECTED="$NAME"
ready=false
for attempt in {1..20};do
 if curl -fsS --max-time 3 http://127.0.0.1:8001/api/status | python3 -c 'import sys,json;assert json.load(sys.stdin)["release"]["releaseId"]==sys.argv[1]' "$EXPECTED";then ready=true;break;fi
 sleep 1
done
if ! "$ready";then
 ln -s "$PREVIOUS" /opt/orbit/.current.rollback
 mv -Tf /opt/orbit/.current.rollback /opt/orbit/current
 systemctl restart orbit
 echo "New release failed health check; restored $PREVIOUS" >&2
 exit 1
fi
printf '%s\n' "$COMMIT" > /opt/orbit/last-deployed-commit
echo "Deployed $COMMIT as $NAME"
