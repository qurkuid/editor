import sys,pickle,numpy as np,cv2
sys.path.insert(0,'.omx/recovery-20260929/data');import vectorize as v
for key in sys.argv[1:]:
 a=pickle.load(open(f'.omo/evidence/apartment-accuracy-20261001/{key}/analysis.pickle','rb'));m=a['masks'];val=m['v'];ridge=cv2.morphologyEx(val,cv2.MORPH_TOPHAT,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(13,13)));mask=((ridge>=12)&(val>=235)&(m['chroma']<20)&(m['sil']>0)).astype(np.uint8)
 segs=v.extract_segments(mask,m['dist_wall'],threshold=20,min_line_length=40,max_line_gap=8,theta=np.pi/360,merge=False);out=[]
 for sg in segs:
  d=sg.vec/sg.length
  # A framed strip ends at an independently detected structural wall on both sides.
  points=[]
  for endpoint,sign in [(sg.p1,-1),(sg.p2,1)]:
   found=None
   for t in np.arange(-4,30,1):
    q=endpoint+sign*d*t;x,y=np.rint(q).astype(int)
    if 0<=y<val.shape[0] and 0<=x<val.shape[1] and m['wall'][y,x]:found=q;break
   if found is None:break
   points.append(found)
  if len(points)<2:continue
  pa,pb=points;wd=8*2
  if np.linalg.norm(pb-pa)*a['scale']/1000<.35:continue
  if not v.continuous_frame_evidence(val,pa,pb,wd):continue
  if any(v.gap_covers_same_span(pa,pb,o.a,o.b) for o in out):continue
  ops=v.classify_openings([(pa,pb,wd,'pair')],m,a['segs'],a['scale'])
  if ops:out.extend(ops)
 print(key,[(o.kind,(o.a/2).round(1).tolist(),(o.b/2).round(1).tolist()) for o in out])
 cv2.imwrite(f'.omo/evidence/apartment-accuracy-20261001/{key}/bright-ridge.png',mask*255)
