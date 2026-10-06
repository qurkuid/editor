#!/bin/bash
set -euo pipefail
export PATH="/Users/baegchangseog/.bun/bin:/Users/baegchangseog/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
SOURCE_COMMIT=$1
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
SHORT_COMMIT=${SOURCE_COMMIT:0:8}
RELEASE_DIR=/Volumes/DATABASE/floorplan-releases/20261002-$SHORT_COMMIT
BACKUP_DIR=/Volumes/DATABASE/floorplan-deploy-backups/20261002-$SHORT_COMMIT
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
git -C /Volumes/DATABASE/floorplan fetch git@github.com:qurkuid/editor.git deploy/floorplan
test "$(git -C /Volumes/DATABASE/floorplan rev-parse FETCH_HEAD)" = "$SOURCE_COMMIT"
git -C /Volumes/DATABASE/floorplan worktree add --detach "$RELEASE_DIR" "$SOURCE_COMMIT"
pm2 jlist > "$BACKUP_DIR/pm2-before.json"
chmod 600 "$BACKUP_DIR/pm2-before.json"
cp /Volumes/DATABASE/apt-subdomain/.env.local "$RELEASE_DIR/.env.local"
chmod 600 "$RELEASE_DIR/.env.local"
/usr/local/bin/python3 - "$BACKUP_DIR" <<'PY'
import sqlite3,sys,os
from pathlib import Path
source=Path.home()/'.pascal/data/pascal.db'
assert source.exists(),source
with sqlite3.connect(f'file:{source}?mode=ro',uri=True) as db, sqlite3.connect(Path(sys.argv[1])/'pascal-before.db') as dest:
    db.backup(dest)
print('SQLite online backup complete')
PY
cd "$RELEASE_DIR"
bun install --frozen-lockfile > "$BACKUP_DIR/install.log" 2>&1
bun run --cwd packages/nodes build > "$BACKUP_DIR/nodes-build.log" 2>&1
bun run --cwd packages/mcp build > "$BACKUP_DIR/mcp-build.log" 2>&1
bun run --cwd apps/editor check-types > "$BACKUP_DIR/types.log" 2>&1
bun run --cwd apps/editor build > "$BACKUP_DIR/build.log" 2>&1
test -s "$RELEASE_DIR/apps/editor/.next/BUILD_ID"
printf 'Prepared commit: %s\nRelease: %s\nBuild ID: ' "$SOURCE_COMMIT" "$RELEASE_DIR"
cat "$RELEASE_DIR/apps/editor/.next/BUILD_ID"
