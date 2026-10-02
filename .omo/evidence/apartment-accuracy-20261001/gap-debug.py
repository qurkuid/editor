import sys,pickle,numpy as np
sys.path.insert(0,'.omx/recovery-20260929/data');import vectorize as v
k=sys.argv[1];a=pickle.load(open(f'.omo/evidence/apartment-accuracy-20261001/{k}/analysis.pickle','rb'));m=a['masks'];raw=v.extract_segments(a['skel'],m['dist_wall']);rel=v.assign_thickness(raw,m['dist_wall'],m['wall'],allow_short=True)
for pa,pb,w,src in v.collinear_gaps(rel,m['wall']):
 mid=(pa+pb)/4
 if k=='hwmyeong' and not (190<mid[1]<250 and 330<mid[0]<590):continue
 if k=='haeundae' and not (330<mid[1]<425 and 400<mid[0]<555):continue
 p=v.gap_cross_profile(m['v'],pa,pb,w);hyp=v.door_hypothesis(m['stroke'],pa,pb,float(np.linalg.norm(pb-pa)),a['scale'],m['v']);st=v.strip_mask(m['wall'].shape,pa,pb,w+6);den=max(st.sum(),1)
 print(pa/2,pb/2,w/2,src,'prof',min(p),max(p),'tf',round(float((st&m['thin']).sum()/den),2),'wf',round(float((st&m['wall']).sum()/den),2),'frame',v.continuous_frame_evidence(m['v'],pa,pb,w),'sep',v.gap_separates(m,pa,pb,w,src),'hyp',None if not hyp else (round(hyp[0],2),round(v.inner_clutter(m['stroke'],*hyp[1:]),2)))
