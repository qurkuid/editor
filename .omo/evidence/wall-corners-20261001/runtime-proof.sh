set -euo pipefail
export PATH="/Users/baegchangseog/.bun/bin:/Users/baegchangseog/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
RELEASE=/Volumes/DATABASE/floorplan-releases/20261001-42ee6342
pm2 jlist | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const p=JSON.parse(s).find(p=>p.name==="apt-subdomain");console.log(JSON.stringify({name:p.name,pid:p.pid,status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd,restarts:p.pm2_env.restart_time}));});'
git -C "$RELEASE" rev-parse HEAD
cat "$RELEASE/apps/editor/.next/BUILD_ID"
/usr/local/bin/python3 - <<'PY'
from pathlib import Path
import hashlib,json
root=Path('/Volumes/DATABASE/floorplan-releases/20261001-42ee6342/apps/editor/.next')
files=[p for p in (root/'static/chunks').glob('*.js') if b'adoptContainedApartmentZones' in p.read_bytes()]
assert files,'Zone import bundle missing'
p=files[0];print('\n'+json.dumps({'publicAsset':'/_next/'+str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
PY
