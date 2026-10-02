import json,uuid,subprocess
from pathlib import Path
b=Path(__file__).resolve().parent;cs=json.loads((b/'cases.json').read_text())
for c in cs:
 c['previousSceneId']=c.pop('sceneId',None)
 f=b/c['key'];template=json.loads(Path('.omo/evidence/apartment-completeness-20261001/jangjeon/create.json').read_text());old=list(template['graph']['nodes']);ids={x:x.split('_')[0]+'_'+uuid.uuid4().hex[:16] for x in old};raw=json.dumps(template,ensure_ascii=False)
 for a,z in ids.items():raw=raw.replace(a,z)
 d=json.loads(raw);d['name']='2D 정확도 수정 검수 · '+c['name']+' '+c['type'];d['projectId']='qa-accuracy-20261001';(f/'create.json').write_text(json.dumps(d,ensure_ascii=False))
 r=subprocess.run(['curl','-sS','-X','POST','http://localhost:3002/api/scenes','-H','Origin: http://localhost:3002','-H','Content-Type: application/json','--data-binary','@'+str(f/'create.json')],check=True,capture_output=True,text=True);(f/'created.json').write_text(r.stdout);c['sceneId']=json.loads(r.stdout)['id'];print(c['key'],c['sceneId'])
(b/'cases.json').write_text(json.dumps(cs,ensure_ascii=False,indent=2))
