from pathlib import Path
exec(Path(__file__).with_name('diagnose.py').read_text().split("print('before'")[0])
for s in seg:
 if 665<s.p1[0]/v.UP<683 and s.length/v.UP>70 and min(s.p1[1],s.p2[1])/v.UP>430:
  L=s.length;d=s.vec/L;steps=max(int(L/2),1); ps=np.array([s.p1+d*(L*k/steps) for k in range(steps+1)]);xy=np.rint(ps).astype(int);hit=m['wall'][xy[:,1],xy[:,0]];print('raw',s.p1/v.UP,s.p2/v.UP,'ratio',hit.mean(),'th',s.th/v.UP)
  runs=[];on=None
  for k,h in enumerate(hit):
   if h and on is None:on=k
   if not h and on is not None:runs.append((on,k-1));on=None
  if on is not None:runs.append((on,len(hit)-1))
  print('runs',[(tuple(ps[a]/v.UP),tuple(ps[b]/v.UP),b-a) for a,b in runs])
cv2.imwrite('/tmp/kitchen-divider.png',img[900:1190,1310:1390])
