from pathlib import Path
exec(Path('.omo/evidence/apartment-accuracy-20261001/inspect-pipeline.py').read_text().split('for c in json.loads')[0])
for c in json.loads((b/'cases.json').read_text()):
 k=c['key']
 if k not in sys.argv[1:]:continue
 a=pickle.load(open(b/k/'analysis.pickle','rb'));m=a['masks'];raw=v.extract_segments(a['skel'],m['dist_wall']);segs=v.assign_thickness([v.Seg(s.p1.copy(),s.p2.copy()) for s in raw],m['dist_wall'],m['wall']);segs=v.classify_exterior(v.snap_junctions(segs),m['dist_to_out']);rel=v.assign_thickness([v.Seg(s.p1.copy(),s.p2.copy()) for s in raw],m['dist_wall'],m['wall'],allow_short=True)
 ocr=v.room_label_items(a['ocr']);entr=[np.array([it['x']+it['w']/2,it['y']+it['h']/2]) for it in ocr if '현관' in it['text']];g=v.collinear_gaps(segs,m['wall']);g+=v.boundary_gaps(m,segs,g);e=v.find_entrance_gap_candidate(m,segs,entr,a['scale']);g=([e] if e else [])+g
 ops=v.classify_openings(g,m,segs,a['scale'],entr)
 rg=v.collinear_gaps(rel,m['wall']);rg+=v.boundary_gaps(m,rel,rg)
 ro=v.classify_openings(rg,m,rel,a['scale'],entr)
 for o in ro:
  if v.continuous_frame_evidence(m['v'],o.a,o.b,o.width) and not any(v.gap_covers_same_span(o.a,o.b,q.a,q.b) for q in ops):ops.append(o)
 rooms=v.detect_rooms(a['img'],m,a['segs'],ops,a['scale'],ocr,room_segs=segs,room_barriers=v.source_room_barriers(rel,m,a['scale']))
 rooms=v.partition_labeled_spaces(rooms,ocr,a['img'].shape);v.label_rooms(rooms,ocr)
 doc=v.build_doc('source',a['img'].shape,a['segs'],ops,rooms,a['scale']);doc['metrics']=a['metrics']
 (b/k/'api.json').write_text(json.dumps(dict(code='OK',data=doc),ensure_ascii=False))
 print(k,len(rooms),[(r['label'],r['cls'],round(r['area_px']*a['scale']**2/1e6,2)) for r in rooms],flush=True)
