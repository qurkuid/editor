import json,sys,urllib.request,urllib.error,subprocess,os
from pathlib import Path
ROOT=Path('/Volumes/DATABASE/floorplan-deploy-backups/20261003-ec500540')
fixture=json.loads((ROOT/'qa-fixture-request.json').read_text())
scene_id=fixture['id']; url='http://127.0.0.1:3024/api/scenes/'+scene_id
headers={'Content-Type':'application/json'}
env=dict(os.environ);env['PATH']='/Users/baegchangseog/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/usr/bin:/bin:'+env.get('PATH','')
processes=json.loads(subprocess.check_output(['pm2','jlist'],env=env))
process=next(p for p in processes if p['name']=='apt-subdomain')
token=process['pm2_env'].get('PASCAL_SCENE_API_TOKEN') or process['pm2_env'].get('env',{}).get('PASCAL_SCENE_API_TOKEN')
if not token:
    for line in Path('/Volumes/DATABASE/apt-subdomain/.env.local').read_text().splitlines():
        if line.startswith('PASCAL_SCENE_API_TOKEN='):token=line.split('=',1)[1].strip().strip('\"').strip("'")
if token:headers['Authorization']='Bearer '+token
def call(path,method='GET',body=None,extra=None):
    req=urllib.request.Request(path,data=None if body is None else json.dumps(body).encode(),method=method,headers={**headers,**(extra or {})})
    with urllib.request.urlopen(req,timeout=20) as response:
        data=response.read();return response.status,json.loads(data) if data else None
mode=sys.argv[1]
if mode=='create':
    try:call(url);raise RuntimeError('Refusing to replace existing scene')
    except urllib.error.HTTPError as error:
        if error.code!=404:raise
    status,meta=call('http://127.0.0.1:3024/api/scenes','POST',fixture)
    status,data=call(url);(ROOT/'qa-baseline.json').write_text(json.dumps(data,indent=2))
    print(json.dumps({'id':scene_id,'created':True,'version':data['version']}))
elif mode=='capture':
    status,data=call(url);baseline=json.loads((ROOT/'qa-baseline.json').read_text())
    (ROOT/(sys.argv[2]+'.json')).write_text(json.dumps(data,indent=2))
    nodes=data['graph']['nodes'];before=baseline['graph']['nodes']
    print(json.dumps({'label':sys.argv[2],'version':data['version'],'exactBaseline':data['graph']==baseline['graph'],'changed':[key for key in nodes if nodes[key]!=before.get(key)],'walls':{key:{'start':node['start'],'end':node['end']} for key,node in nodes.items() if node['type']=='wall'}}))
elif mode=='delete':
    status,data=call(url);status,_=call(url,'DELETE',extra={'If-Match':'\"'+str(data['version'])+'\"'})
    try:call(url);raise RuntimeError('Fixture remains')
    except urllib.error.HTTPError as error:
        if error.code!=404:raise
    print(json.dumps({'id':scene_id,'deleteStatus':status,'verifiedAbsent':True}))
else:raise RuntimeError('Unknown mode')
