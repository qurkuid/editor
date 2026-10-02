import sys,time,shutil
from pathlib import Path
sys.path.insert(0,'.omx/recovery-20260929/data');import vectorize as v
for name in ['build_masks','zhang_suen','extract_segments','assign_thickness','snap_junctions','run_ocr','source_room_barriers','classify_openings','recover_source_boundary_segments','detect_rooms','partition_labeled_spaces','retry_unlabeled_room_ocr']:
 old=getattr(v,name)
 def wrap(*args,_fn=old,_name=name,**kw):
  t=time.monotonic();print('start',_name,flush=True);r=_fn(*args,**kw);print('end',_name,round(time.monotonic()-t,2),flush=True);return r
 setattr(v,name,wrap)
p='/tmp/apt-vector-3FO40NYO9IFT.jpg';shutil.copyfile('.omo/evidence/apartment-accuracy-20261001/forest/source.jpg',p);a=v.analyze(p);print(a['metrics'],flush=True)
import json
Path('.omo/evidence/apartment-accuracy-20261001/forest/api.json').write_text(json.dumps(dict(code='OK',data=v.build_doc(p,a['img'].shape,a['segs'],a['openings'],a['rooms'],a['scale']))))
