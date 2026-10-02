import json,math
from pathlib import Path
p=Path(__file__).parent;s=json.loads((p/'scene-live.json').read_text())['graph']['nodes'];f=json.loads((p/'interior-probes.json').read_text())['frame'];tx,ty=f['sceneTranslationM'];mm=f['mmPerPx']*f['analysisScale'];pix=lambda q:((q[0]-tx)*1000/mm,(q[1]-ty)*1000/mm)
walls=[(n['id'],pix(n['start']),pix(n['end'])) for n in s.values() if n['type']=='wall']
def dist(q,a,b):
 u=[b[i]-a[i] for i in (0,1)];L=sum(v*v for v in u);t=max(0,min(1,sum((q[i]-a[i])*u[i] for i in (0,1))/L));return math.dist(q,[a[i]+t*u[i] for i in (0,1)])
checks=[('center-dress-left-partition',(548,325),(548,408)),('left-dress-short-diagonal',(445,323),(462,340)),('upper-right-dress-left-partition',(913,147),(913,174)),('upper-right-dress-right-partition',(960,147),(960,174))]
r=[]
for name,a,b in checks:
 samples=[]
 for t in (.25,.5,.75):
  q=[a[i]+t*(b[i]-a[i]) for i in (0,1)];d,w=min((dist(q,x,y),id) for id,x,y in walls);samples.append({'sourcePx':q,'nearestWallId':w,'distancePx':round(d,2),'distanceM':round(d*mm/1000,3)})
 r.append({'boundary':name,'samples':samples})
print(json.dumps(r,indent=2));(p/'boundary-measurements.json').write_text(json.dumps(r,indent=2))
