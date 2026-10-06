import json,time,subprocess,concurrent.futures
from pathlib import Path
b=Path('.omo/evidence/editor-completion-20261002');cases=json.loads(Path('.omo/evidence/apartment-accuracy-20261001/cases.json').read_text())
def check(c):
 t=time.monotonic();url=f"https://apt.intm.kr/api/apartments/{c['apartmentId']}/plans/{c['planId']}/vector?refresh=1"
 try:
  r=subprocess.run(['curl','--max-time','100','-fsS','-D',str(b/(c['key']+'-headers.txt')),url],capture_output=True,text=True,check=True)
  d=json.loads(r.stdout); cache='no-store' if 'cache-control: no-store' in (b/(c['key']+'-headers.txt')).read_text().lower() else ''; status=200
  (b/(c['key']+'-public-vector.json')).write_text(json.dumps(d,ensure_ascii=False))
  v=d.get('data',{});out=dict(key=c['key'],status=status,code=d.get('code'),docVersion=v.get('docVersion'),walls=len(v.get('walls',[])),openings=len(v.get('openings',[])),rooms=len(v.get('rooms',[])),cacheControl=cache,seconds=round(time.monotonic()-t,1))
  assert out['docVersion']==13 and out['walls']>0 and out['rooms']>0 and cache=='no-store',out
  return out
 except Exception as e:return dict(key=c['key'],error=str(e))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 out=[]
 for x in pool.map(check,cases):out.append(x);print(json.dumps(x,ensure_ascii=False),flush=True)
(b/'public-vector-results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
assert not any('error' in x for x in out),out
