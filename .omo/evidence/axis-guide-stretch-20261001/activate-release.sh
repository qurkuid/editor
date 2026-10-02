#!/bin/bash
set -euo pipefail
export PATH="/Users/baegchangseog/.bun/bin:/Users/baegchangseog/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
SOURCE_COMMIT=$1
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
SHORT_COMMIT=${SOURCE_COMMIT:0:8}
DEPLOY_BACKUP=/Volumes/DATABASE/floorplan-deploy-backups/20261001-$SHORT_COMMIT
DEPLOY_RELEASE=/Volumes/DATABASE/floorplan-releases/20261001-$SHORT_COMMIT
export DEPLOY_BACKUP DEPLOY_RELEASE
node <<'JS'
const fs=require('fs'),path=require('path');
const b=process.env.DEPLOY_BACKUP,r=process.env.DEPLOY_RELEASE;
const p=JSON.parse(fs.readFileSync(path.join(b,'pm2-before.json'),'utf8')).find(p=>p.name==='apt-subdomain');
if(!p)throw Error('apt-subdomain missing');
const e=p.pm2_env;
const env={...e.env};
for(const k of ['PORT','NODE_ENV','INTM_BASE_URL','APT_DATA_DIR','VECTORIZER_DIR','VECTORIZER_PYTHON']) if(e[k]!==undefined)env[k]=e[k];
if(String(env.PORT)!=='3024')throw Error('Unexpected port');
for(const [name,cwd,script] of [['previous',e.pm_cwd,e.pm_exec_path],['new',path.join(r,'apps/editor'),path.join(r,'apps/editor/node_modules/next/dist/bin/next')]]){
 const config={apps:[{name:'apt-subdomain',cwd,script,args:e.args,interpreter:e.exec_interpreter,exec_mode:'fork',instances:1,env,autorestart:true,error_file:e.pm_err_log_path,out_file:e.pm_out_log_path}]};
 fs.writeFileSync(path.join(b,`ecosystem-${name}.config.cjs`),'module.exports='+JSON.stringify(config,null,2)+';\n',{mode:0o600});
}
JS
pm2 delete apt-subdomain
if ! pm2 start "$DEPLOY_BACKUP/ecosystem-new.config.cjs" --only apt-subdomain; then
  pm2 start "$DEPLOY_BACKUP/ecosystem-previous.config.cjs" --only apt-subdomain
  exit 1
fi
pm2 save
pm2 jlist | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const p=JSON.parse(s).find(p=>p.name==="apt-subdomain");console.log(JSON.stringify({name:p.name,pid:p.pid,status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd,script:p.pm2_env.pm_exec_path}));if(p.pm2_env.pm_cwd!==process.env.DEPLOY_RELEASE+"/apps/editor")process.exit(1);});'
curl --retry 8 --retry-delay 2 --retry-connrefused -fsS -o /dev/null -w 'Local HTTP: %{http_code}\n' http://127.0.0.1:3024/apt
