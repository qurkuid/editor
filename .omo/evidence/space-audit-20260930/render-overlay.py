import json,cv2,numpy as np
from pathlib import Path
p=Path(__file__).parent
s=json.loads((p/'scene-live.json').read_text())['graph']['nodes']
f=json.loads((p/'interior-probes.json').read_text())['frame'];tx,ty=f['sceneTranslationM'];mm=f['mmPerPx']*f['analysisScale'];to_px=lambda q:((q[0]-tx)*1000/mm,(q[1]-ty)*1000/mm)
base=cv2.imread(str(p/'../missing-walls/source-plan.jpg'))
colors=[(90,90,230),(40,180,60),(230,130,30),(180,30,180),(20,180,200)]
zones=[n for n in s.values() if n['type']=='zone'];over=base.copy()
for i,n in enumerate(zones):
 poly=np.rint([to_px(q) for q in n['polygon']]).astype(np.int32);cv2.fillPoly(over,[poly],colors[i%5]);cv2.polylines(over,[poly],True,(10,20,230),2)
 cv2.imwrite(str(p/'zones-source-overlay.jpg'),cv2.addWeighted(over,.4,base,.6,0))
out=cv2.addWeighted(over,.28,base,.72,0)
for i,n in enumerate(zones):
 pts=np.asarray([to_px(q) for q in n['polygon']],np.float32);m=cv2.moments(pts);c=(int(m['m10']/m['m00']),int(m['m01']/m['m00']))
 cv2.circle(out,c,10,(255,255,255),-1);cv2.putText(out,str(i+1),c,cv2.FONT_HERSHEY_SIMPLEX,.45,(10,10,10),1,cv2.LINE_AA)
cv2.imwrite(str(p/'zones-numbered.jpg'),out)
wall=base.copy()
for n in s.values():
 if n['type']=='wall':
  a,b=[tuple(np.rint(to_px(n[k])).astype(int)) for k in ('start','end')];cv2.line(wall,a,b,(230,60,10),2)
cv2.imwrite(str(p/'walls-source-overlay.jpg'),wall)
(p/'zone-index.json').write_text(json.dumps([{'number':i+1,'name':n['name'],'id':n['id'],'sourceRoomId':n['metadata']['sourceRoomId'],'polygonSourcePx':[to_px(q) for q in n['polygon']]} for i,n in enumerate(zones)],ensure_ascii=False,indent=2))
