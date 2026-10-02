import sys,json,time,shutil
from pathlib import Path
sys.path.insert(0,'.omx/recovery-20260929/data');import vectorize as v
base=Path(__file__).resolve().parent
for c in json.loads((base/'cases.json').read_text()):
 if sys.argv[1:] and c['key'] not in sys.argv[1:]:continue
 p='/tmp/apt-vector-'+c['planId']+'.jpg';shutil.copyfile(base/c['key']/'source.jpg',p);t=time.monotonic();a=v.analyze(p);doc=v.build_doc(p,a['img'].shape,a['segs'],a['openings'],a['rooms'],a['scale']);doc['metrics']=a['metrics'];doc['roomDiagnostics']=a.get('room_diagnostics',[])
 (base/c['key']/'api.json').write_text(json.dumps(dict(code='OK',data=doc),ensure_ascii=False));print(c['key'],round(time.monotonic()-t,1),a['metrics'],flush=True)
