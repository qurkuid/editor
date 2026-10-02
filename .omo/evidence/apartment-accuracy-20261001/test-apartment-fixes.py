import sys,cv2,numpy as np
sys.path.insert(0,'.omx/recovery-20260929/data');import vectorize as v
value=np.repeat(np.arange(100,251,5,dtype=np.uint8)[:,None],120,axis=1)
assert not v.window_frame_evidence(value,np.array([10.,15.]),np.array([100.,15.]),14)
value[:]=153;value[13:18]=255
assert v.window_frame_evidence(value,np.array([10.,15.]),np.array([100.,15.]),14)
items=v.room_label_items([dict(text='욕실 드레스룸 1현관',x=0.,y=0.,w=200.,h=20.)])
assert [it['text'] for it in sorted(items,key=lambda it:it['x'])]==['욕실','드레스룸','현관']
rooms=[dict(poly=np.array([[0.,0.],[200.,0.],[200.,100.],[0.,100.]]),cls='room',label=None,area_px=20000.,centroid=(100.,50.))]
parts=v.partition_labeled_spaces(rooms,[dict(text='거실',x=25.,y=40.,w=30.,h=20.),dict(text='주방',x=145.,y=40.,w=30.,h=20.)],(110,210,3))
assert len(parts)==2 and [r['label'] for r in parts]==['거실','주방']
assert all(cv2.pointPolygonTest(r['poly'].astype(np.float32),(float(40+120*i),50.),False)>=0 for i,r in enumerate(parts))
print('PASS framed-ridge/gray-edge negatives, compound OCR, separate semantic zones')
