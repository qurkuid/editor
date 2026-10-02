import sys,json,subprocess
from pathlib import Path
base=Path(__file__).resolve().parent
cases=json.loads((base/'cases.json').read_text())
for c in cases:
 f=base/c['key']
 if not (f/'api.json').exists():continue
 d=json.loads((f/'api.json').read_text())
 if d.get('code')!='OK':continue
 subprocess.run(['bun','run','.omo/evidence/openings-spaces/import-vector.ts',str(f/'api.json'),str(f/'import.json')],check=True,capture_output=True)
 nodes=json.loads((f/'import.json').read_text())['nodes'];v=d['data'];nodes['guide_test']={'id':'guide_test','type':'guide','scale':v['imageSize'][0]*v['mmPerPx']/10000,'position':[0,0,0]}
 (f/'offline-scene.json').write_text(json.dumps({'version':0,'graph':{'nodes':nodes}}))
module=(base/'verify-completeness.py').read_text().split('reports=[audit(c)')[0].replace("folder/'scene.json'","folder/'offline-scene.json'")
ns={'__file__':str(base/'verify-completeness.py')};exec(module,ns)
reports=[]
for c in cases:
 if not (base/c['key']/'offline-scene.json').exists():continue
 reports.append(ns['audit'](c))
(base/'offline-summary.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
