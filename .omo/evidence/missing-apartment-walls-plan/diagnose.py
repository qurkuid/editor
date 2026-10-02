import sys
sys.path.insert(0,'/Users/changseok/editor/.omx/recovery-20260929/data')
import vectorize as v
import cv2,numpy as np
img=cv2.imread('/tmp/wall-missing-plan.jpg'); img=cv2.resize(img,None,fx=v.UP,fy=v.UP,interpolation=cv2.INTER_LINEAR)
m=v.build_masks(img); sk=v.zhang_suen(m['wall']); seg=v.extract_segments(sk,m['dist_wall'])
kept=v.assign_thickness(seg,m['dist_wall'],m['wall'])
print('before',len(seg),'after',len(kept))
for s in seg:
 if not any(s is k for k in kept): print('dropped',np.round(s.p1/v.UP,1),np.round(s.p2/v.UP,1),'th',round(s.th/v.UP,2),'len',round(s.length/v.UP,2))
cv2.imwrite('/tmp/wall-mask.png',cv2.resize(m['wall']*255,None,fx=0.25,fy=0.25))
