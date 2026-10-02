import sys,importlib.util,json,shutil,pickle
from pathlib import Path
import cv2,numpy as np
b=Path(__file__).parent;src=Path('.omx/recovery-20260929/data/vectorize.py')
spec=importlib.util.spec_from_file_location('vectorize',src);v=importlib.util.module_from_spec(spec);sys.modules[spec.name]=v;spec.loader.exec_module(v)
for c in json.loads((b/'cases.json').read_text()):
 if c['key'] not in sys.argv[1:]:continue
 k=c['key'];tmp=Path('/tmp')/f"apt-vector-{c['planId']}.jpg";shutil.copyfile(b/k/'source.jpg',tmp)
 a=v.analyze(str(tmp));pickle.dump(a,open(b/k/'analysis.pickle','wb'))
 print(k,json.dumps(a['metrics']),a['room_diagnostics'],flush=True)
 raw=v.extract_segments(a['skel'],a['masks']['dist_wall']);rel=v.assign_thickness([v.Seg(s.p1.copy(),s.p2.copy()) for s in raw],a['masks']['dist_wall'],a['masks']['wall'],allow_short=True)
 allg=v.collinear_gaps(rel,a['masks']['wall']);allg+=v.boundary_gaps(a['masks'],rel,allg)
 opens=v.classify_openings(allg,a['masks'],rel,a['scale'])
 print('RELAXED',[(o.kind,o.src,(o.a/2).round(1).tolist(),(o.b/2).round(1).tolist()) for o in opens],flush=True)
