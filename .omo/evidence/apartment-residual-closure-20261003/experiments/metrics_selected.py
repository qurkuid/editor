from __future__ import annotations
import json, math
from pathlib import Path
import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
PLAN_IDS = ['3FO3YJE3RM5X','3FO40C71IWG4','3FO3YR6LHA15']
ORDINALS = {3:'3FO3YJE3RM5X',7:'3FO40C71IWG4',9:'3FO3YR6LHA15'}
PROBES = json.loads((Path('/Users/changseok/editor/.omo/evidence/apartment-topology-refinement-20261003/source-probes.json')).read_text())
ROOM = [p for p in PROBES['roomSeeds'] if int(p['ordinal']) in ORDINALS]
OUTSIDE = [p for p in PROBES['outsideFloorProbes'] if int(p['ordinal']) in ORDINALS]

def source_to_actual(point, source_size, actual_size):
    return (float(point[0])*actual_size[0]/float(source_size[0]), float(point[1])*actual_size[1]/float(source_size[1]))

def source_px_to_level(point, doc, actual_size):
    width,height=actual_size; doc_w,doc_h=doc['imageSize']; mm=float(doc['mmPerPx'])
    sx=float(point[0])*doc_w/width; sy=float(point[1])*doc_h/height
    return ((sx-doc_w/2)*mm/1000,(sy-doc_h/2)*mm/1000)

def inside(point,poly):
    x,y=point; result=False
    for i,c in enumerate(poly):
        p=poly[i-1]
        if (p[1]>y)!=(c[1]>y):
            crossing=(c[0]-p[0])*(y-p[1])/((c[1]-p[1]) or 1e-12)+p[0]
            if x<crossing: result=not result
    return result

def orient(a,b,c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def onseg(a,b,p,eps=1e-9): return min(a[0],b[0])-eps<=p[0]<=max(a[0],b[0])+eps and min(a[1],b[1])-eps<=p[1]<=max(a[1],b[1])+eps
def intersect(a,b,c,d,eps=1e-9):
    o1,o2,o3,o4=orient(a,b,c),orient(a,b,d),orient(c,d,a),orient(c,d,b)
    if ((o1>eps and o2<-eps) or (o1<-eps and o2>eps)) and ((o3>eps and o4<-eps) or (o3<-eps and o4>eps)): return True
    return (abs(o1)<=eps and onseg(a,b,c)) or (abs(o2)<=eps and onseg(a,b,d)) or (abs(o3)<=eps and onseg(c,d,a)) or (abs(o4)<=eps and onseg(c,d,b))
def self_cross(poly):
    pts=[(float(p[0]),float(p[1])) for p in poly]; n=len(pts); count=0
    for i in range(n):
        a,b=pts[i],pts[(i+1)%n]
        for j in range(i+1,n):
            if j in (i,(i+1)%n) or i==(j+1)%n: continue
            if intersect(a,b,pts[j],pts[(j+1)%n]): count+=1
    return count

def metrics(variant,pid):
    doc=json.loads((HERE/'inputs/raw-v15'/f'{pid}.json').read_text())
    scene=json.loads((HERE/'outputs'/variant/'imported'/f'{pid}.json').read_text())
    eval=json.loads((HERE/'outputs'/variant/'evaluation'/f'{pid}.json').read_text())
    polys=[x.get('polygon') for x in (scene.get('slabPlan') or {}).get('create',[]) if len(x.get('polygon') or [])>=3]
    width,height=doc['imageSize']
    masks=[]; pixel_area=(float(doc['mmPerPx'])**2)/1_000_000.0
    self_count=0; self_polys=0
    for poly in polys:
        points=[]
        for x,y in poly:
            px=round(x*1000/doc['mmPerPx']+width/2); py=round(y*1000/doc['mmPerPx']+height/2)
            points.append([px,py])
        mask=np.zeros((height,width),dtype=np.uint8); cv2.fillPoly(mask,[np.array(points,dtype=np.int32)],255); masks.append(mask)
        c=self_cross(poly); self_count+=c; self_polys += bool(c)
    overlap_pairs=0; overlap_pixels=0
    for i in range(len(masks)):
        for j in range(i+1,len(masks)):
            pixels=int(cv2.countNonZero(cv2.bitwise_and(masks[i],masks[j])))
            if pixels: overlap_pairs+=1; overlap_pixels+=pixels
    room=[p for p in ROOM if int(p['ordinal'])==next(k for k,v in ORDINALS.items() if v==pid)]
    outside=[p for p in OUTSIDE if int(p['ordinal'])==next(k for k,v in ORDINALS.items() if v==pid)]
    def is_in(p):
        actual=source_to_actual(p['xy'],p.get('sourceSize') or [width,height],(width,height))
        level=source_px_to_level(actual,doc,(width,height))
        return any(inside(level,poly) for poly in polys)
    room_inside=sum(is_in(p) for p in room); outside_false=sum(is_in(p) for p in outside)
    return {
      'planId':pid,'status':eval.get('status'),'spaces':eval.get('importer',{}).get('boundary',{}).get('spaces'),
      'uniqueSpaceIds':eval.get('importer',{}).get('boundary',{}).get('uniqueSpaceIds'),
      'slabPolygons':len(polys),'persistedSlabs':len(scene.get('slabs') or []),
      'roomSeeds':{'inside':room_inside,'total':len(room)},
      'outsideFloorProbes':{'falsePositive':outside_false,'total':len(outside)},
      'selfIntersectionPolygons':int(self_polys),'selfIntersectionCount':self_count,
      'overlapPairs':overlap_pairs,'overlapPixels':overlap_pixels,'overlapAreaM2':overlap_pixels*pixel_area,
      'walls':len(scene.get('walls') or []),'openings':len(scene.get('openings') or []),'zones':len(scene.get('zones') or []),
      'diagnostics':eval.get('importer',{}).get('diagnostics'),
    }

def aggregate(rows):
    return {
      'cases':len(rows),'imported':sum(r['status']=='IMPORTED' for r in rows),
      'spaces':sum(r['spaces'] or 0 for r in rows),'slabPolygons':sum(r['slabPolygons'] for r in rows),
      'roomSeeds':{'inside':sum(r['roomSeeds']['inside'] for r in rows),'total':sum(r['roomSeeds']['total'] for r in rows)},
      'outsideFloorProbes':{'falsePositive':sum(r['outsideFloorProbes']['falsePositive'] for r in rows),'total':sum(r['outsideFloorProbes']['total'] for r in rows)},
      'geometry':{'selfIntersectionPolygons':sum(r['selfIntersectionPolygons'] for r in rows),'selfIntersectionCount':sum(r['selfIntersectionCount'] for r in rows),'overlapPairs':sum(r['overlapPairs'] for r in rows),'overlapAreaM2':sum(r['overlapAreaM2'] for r in rows)},
    }

all_rows={v:[metrics(v,pid) for pid in PLAN_IDS] for v in ['current','A','B']}
old=json.loads((Path('/Users/changseok/editor/.omo/evidence/apartment-topology-refinement-20261003/candidate-topology-final-0b926754-metrics.json')).read_text())
out={'schemaVersion':'apartment-residual-closure-selected-metrics-v1','resolvedModel':'gpt-5.6-luna','reasoningEffort':'max','rawDocVersion':15,'planIds':PLAN_IDS,'variants':{v:{'rows':rows,'aggregate':aggregate(rows)} for v,rows in all_rows.items()},'frozen44Reference':{'importedCases':old['importedCases'],'rejectedCases':old['rejectedCases'],'roomSeeds':old['roomSeeds'],'outsideFloorProbes':old['outsideFloorProbes'],'slabGeometry':old['slabGeometry']}}
(HERE/'outputs/selected-metrics.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({v:{'aggregate':aggregate(rows)} for v,rows in all_rows.items()},ensure_ascii=False,indent=2))
