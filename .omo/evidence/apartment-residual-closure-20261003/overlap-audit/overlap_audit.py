#!/usr/bin/env python3
"""Read-only exact overlap audit for frozen candidate slabs."""
from __future__ import annotations
import hashlib
from itertools import combinations
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE.parents[1] / "apartment-topology-refinement-20261003"
CANDIDATE = EVIDENCE / "candidate-imported-topology-final-0b926754"
EVALUATION = EVIDENCE / "candidate-evaluation-topology-final-0b926754"
METRICS = EVIDENCE / "paired-topology-final-0b926754-metrics.json"
RENDER = EVIDENCE / "render_paired_v15.py"
FREEZE = EVIDENCE / "source-freeze-final-0b926754.json"
EPS = 1e-8
AREA_EPS = 1e-9

def read(p): return json.loads(Path(p).read_text())
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def cr(a,b,c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def sarea(p): return .5*sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p)))
def area(p): return abs(sarea(p))
def dist(a,b): return math.hypot(a[0]-b[0],a[1]-b[1])
def clean(p):
    out=[]
    for x in p:
        x=(float(x[0]),float(x[1]))
        if not out or dist(x,out[-1])>EPS: out.append(x)
    if len(out)>1 and dist(out[0],out[-1])<=EPS: out.pop()
    changed=True
    while changed and len(out)>=3:
        changed=False
        for i in range(len(out)):
            a,b,c=out[i-1],out[i],out[(i+1)%len(out)]
            if abs(cr(a,b,c))<=EPS and min(a[0],c[0])-EPS<=b[0]<=max(a[0],c[0])+EPS and min(a[1],c[1])-EPS<=b[1]<=max(a[1],c[1])+EPS:
                out.pop(i); changed=True; break
    return out
def in_tri(p,t): return min(cr(t[i],t[(i+1)%3],p) for i in range(3))>=-EPS
def tris(p):
    p=clean(p)
    if len(p)<3 or area(p)<=AREA_EPS: return []
    if sarea(p)<0: p.reverse()
    ids=list(range(len(p))); out=[]; guard=0
    while len(ids)>3:
        guard+=1
        if guard>len(p)*len(p)*2: raise ValueError('ear clipping did not converge')
        found=False
        for pos,cur in enumerate(ids):
            prev,nxt=ids[pos-1],ids[(pos+1)%len(ids)]
            t=[p[prev],p[cur],p[nxt]]
            if cr(*t)<=EPS or any(in_tri(p[k],t) for k in ids if k not in (prev,cur,nxt)): continue
            out.append(t); ids.pop(pos); found=True; break
        if found: continue
        removed=False
        for pos,cur in enumerate(ids):
            if abs(cr(p[ids[pos-1]],p[cur],p[ids[(pos+1)%len(ids)]]))<=1e-7:
                ids.pop(pos); removed=True; break
        if not removed: raise ValueError('non-simple polygon')
    out.append([p[i] for i in ids]); return out
def lineint(a,b,c,d):
    den=(a[0]-b[0])*(c[1]-d[1])-(a[1]-b[1])*(c[0]-d[0])
    if abs(den)<=EPS: return b
    na=a[0]*b[1]-a[1]*b[0]; nb=c[0]*d[1]-c[1]*d[0]
    return ((na*(c[0]-d[0])-(a[0]-b[0])*nb)/den,(na*(c[1]-d[1])-(a[1]-b[1])*nb)/den)
def clip(sub,cl):
    out=list(sub)
    for i,a in enumerate(cl):
        b=cl[(i+1)%len(cl)]
        if not out: break
        nxt=[]; prev=out[-1]; pin=cr(a,b,prev)>=-EPS
        for cur in out:
            cin=cr(a,b,cur)>=-EPS
            if cin!=pin: nxt.append(lineint(prev,cur,a,b))
            if cin: nxt.append(cur)
            prev,pin=cur,cin
        out=clean(nxt)
    return out
def inter(*polys):
    if not polys: return 0.0
    parts=tris(polys[0])
    if any(not tris(p) for p in polys[1:]): return 0.0
    for other in polys[1:]:
        nxt=[]; ots=tris(other)
        for x in parts:
            for y in ots:
                z=clip(x,y)
                if len(z)>=3 and area(z)>AREA_EPS: nxt.append(z)
        parts=nxt
        if not parts: break
    return sum(area(x) for x in parts)
def onseg(p,a,b):
    return abs(cr(a,b,p))<=EPS and min(a[0],b[0])-EPS<=p[0]<=max(a[0],b[0])+EPS and min(a[1],b[1])-EPS<=p[1]<=max(a[1],b[1])+EPS
def shared(a,b):
    total=0.0
    for i,x in enumerate(a):
        y=a[(i+1)%len(a)]; v=(y[0]-x[0],y[1]-x[1]); L=math.hypot(*v)
        if L<=EPS: continue
        for j,u in enumerate(b):
            w=b[(j+1)%len(b)]; z=(w[0]-u[0],w[1]-u[1]); M=math.hypot(*z)
            if M<=EPS or abs(v[0]*z[1]-v[1]*z[0])>EPS*L*M or abs(cr(x,y,u))>EPS*L: continue
            ux,uy=v[0]/L,v[1]/L
            q=((u[0]-x[0])*ux+(u[1]-x[1])*uy,(w[0]-x[0])*ux+(w[1]-x[1])*uy)
            total+=max(0.0,min(L,max(q))-max(0.0,min(q)))
    return total
def band(w):
    a=tuple(map(float,w.get('start',[]))); b=tuple(map(float,w.get('end',[]))); t=float(w.get('thickness') or 0)
    if len(a)!=2 or len(b)!=2 or t<=EPS: return None
    dx,dy=b[0]-a[0],b[1]-a[1]; L=math.hypot(dx,dy)
    if L<=EPS: return None
    nx,ny=-dy/L*t/2,dx/L*t/2
    return [(a[0]+nx,a[1]+ny),(b[0]+nx,b[1]+ny),(b[0]-nx,b[1]-ny),(a[0]-nx,a[1]-ny)]
def bb(p): return (min(x for x,y in p),min(y for x,y in p),max(x for x,y in p),max(y for x,y in p))
def bbint(a,b):
    A,B=bb(a),bb(b); return A[0]<=B[2]+EPS and B[0]<=A[2]+EPS and A[1]<=B[3]+EPS and B[1]<=A[3]+EPS
def pair_rows(polys):
    out=[]
    for i,a in enumerate(polys):
        for j,b in enumerate(polys[i+1:],i+1):
            x=inter(a,b); s=shared(a,b)
            if x>AREA_EPS or s>EPS: out.append({'firstIndex':i,'secondIndex':j,'intersectionAreaM2':x,'sharedBoundaryLengthM':s})
    return out

def point_line_distance(point,start,end):
    dx,dy=end[0]-start[0],end[1]-start[1]
    length_squared=dx*dx+dy*dy
    if length_squared<1e-9:return dist(point,start)
    return abs((point[0]-start[0])*dy-(point[1]-start[1])*dx)/math.sqrt(length_squared)

def simplify_poly(poly,tolerance):
    points=clean(poly)
    if len(points)<=3 or tolerance<=0:return points
    anchor_a,anchor_b,max_distance=0,len(points)//2,-1.0
    for i in range(len(points)):
        for j in range(i+1,len(points)):
            dx,dy=points[j][0]-points[i][0],points[j][1]-points[i][1]
            distance_squared=dx*dx+dy*dy
            if distance_squared>max_distance:
                max_distance=distance_squared
                anchor_a,anchor_b=i,j
    def simplify_line(line):
        if len(line)<=2:return line[:]
        max_distance,split_index=-1.0,-1
        for i in range(1,len(line)-1):
            distance=point_line_distance(line[i],line[0],line[-1])
            if distance>max_distance:max_distance,split_index=distance,i
        if max_distance<=tolerance or split_index<0:return [line[0],line[-1]]
        left=simplify_line(line[:split_index+1]); right=simplify_line(line[split_index:])
        return left[:-1]+right
    forward=points[anchor_a:anchor_b+1]
    wrapped=points[anchor_b:]+points[:anchor_a+1]
    simplified=simplify_line(forward)[:-1]+simplify_line(wrapped)[:-1]
    cleaned=clean(simplified)
    return cleaned if len(cleaned)>=3 else points

def wall_union_area(a,b,contributors):
    """Exact union of overlap∩wall bands by inclusion-exclusion for small sets."""
    bands=[band(w) for w in contributors]
    bands=[q for q in bands if q is not None]
    if not bands:return 0.0
    total=0.0
    for size in range(1,len(bands)+1):
        sign=1 if size%2 else -1
        for subset in combinations(bands,size):total+=sign*inter(a,b,*subset)
    return max(0.0,min(inter(a,b),total))
def match_space(slab,spaces):
    sa=area(slab); cand=[]
    for i,s in enumerate(spaces):
        p=[tuple(x) for x in s.get('polygon',[])];
        if len(p)<3: continue
        ov=inter(slab,p); sp=area(p); cov=ov/sa if sa else 0
        cand.append((cov,abs(sp-sa),i,s,ov,sp))
    if not cand: return {'spaceIndex':None,'spaceId':None,'coverage':0,'overlapAreaM2':0}
    cands=[x for x in cand if x[0]>=1-1e-7] or cand
    cov,_,i,s,ov,sp=min(cands,key=lambda x:(x[1],-x[0]))
    return {'spaceIndex':i,'spaceId':s.get('id'),'coverage':cov,'overlapAreaM2':ov,'spaceAreaM2':sp}
def match_zone(poly,zones):
    pa=area(poly); c=[]
    for i,z in enumerate(zones):
        p=[tuple(x) for x in z.get('polygon',[])];
        if len(p)<3: continue
        ov=inter(poly,p); c.append((ov/pa if pa else 0,i,z,ov))
    if not c:return {'zoneIndex':None,'zoneId':None,'name':None,'coverage':0}
    cov,i,z,ov=max(c,key=lambda x:x[0])
    return {'zoneIndex':i,'zoneId':z.get('id'),'name':z.get('name'),'autoFromWalls':z.get('autoFromWalls'),'enclosureStatus':z.get('enclosureStatus'),'metadata':z.get('metadata'),'coverage':cov,'overlapAreaM2':ov}
def metadata(n):
    m=n.get('metadata'); return {k:m[k] for k in ('source','sourceRoomId','generatedFrom','cls','areaM2','boundaryNeedsReview') if isinstance(m,dict) and k in m}
def classify(i,j,slabs,polys,walls,spaces_match):
    a,b=polys[i],polys[j]; aa,ab=area(a),area(b); ov=inter(a,b); sb=shared(a,b)
    ca=ov>AREA_EPS and ov/ab>=1-1e-7; cb=ov>AREA_EPS and ov/aa>=1-1e-7; dup=ca and cb and abs(aa-ab)<=max(AREA_EPS,aa*1e-7)
    contributors=[]
    for w in walls:
        q=band(w)
        if q is not None and bbint(a,q) and bbint(b,q):
            x=inter(a,b,q)
            if x>AREA_EPS: contributors.append({'wallId':w.get('id'),'thickness':w.get('thickness'),'intersectionAreaM2':x})
    contributor_walls=[w for w in walls if any(x['wallId']==w.get('id') for x in contributors)]
    band_sum=sum(x['intersectionAreaM2'] for x in contributors); band_max=max((x['intersectionAreaM2'] for x in contributors),default=0)
    band_union=wall_union_area(a,b,contributor_walls)
    band_union_coverage=band_union/ov if ov>AREA_EPS else 0
    if dup: typ='duplicate_face'
    elif ca or cb: typ='containment'
    elif ov<=AREA_EPS: typ='boundary_touch_only' if sb>EPS else 'disjoint'
    elif band_union_coverage>=1-1e-6: typ='wall_thickness_only'
    elif band_union_coverage>AREA_EPS: typ='actual_face_overlap'
    else: typ='actual_face_overlap'
    return {'firstIndex':i,'secondIndex':j,'firstId':slabs[i].get('id'),'secondId':slabs[j].get('id'),'firstName':slabs[i].get('name'),'secondName':slabs[j].get('name'),'firstAreaM2':aa,'secondAreaM2':ab,'intersectionAreaM2':ov,'intersectionFractionOfFirst':ov/aa if aa else 0,'intersectionFractionOfSecond':ov/ab if ab else 0,'sharedBoundaryLengthM':sb,'classification':typ,'wallBandIntersectionAreaUpperBoundM2':band_sum,'maxSingleWallBandIntersectionAreaM2':band_max,'wallBandUnionIntersectionAreaM2':band_union,'wallBandUnionCoverage':band_union_coverage,'wallBandCoverageUpperBound':min(1,band_sum/ov) if ov>AREA_EPS else 0,'maxSingleWallBandCoverage':band_max/ov if ov>AREA_EPS else 0,'wallBandContributors':sorted(contributors,key=lambda x:x['intersectionAreaM2'],reverse=True)[:8],'firstSpace':spaces_match[i],'secondSpace':spaces_match[j]}
def audit(row):
    pid=row['planId']
    d=read(CANDIDATE/f'{pid}.json')
    ev=read(EVALUATION/f'{pid}.json')
    slabs=d.get('slabs',[])
    spaces=d.get('spaces',[])
    zones=d.get('zones',[])
    walls=d.get('walls',[])
    polys=[[tuple(x) for x in s.get('polygon',[])] for s in slabs]
    raw=[[tuple(x) for x in s.get('polygon',[])] for s in spaces]
    low_tolerance=[simplify_poly(p,1e-6) for p in raw]
    sm=[match_space(p,spaces) for p in polys]
    zm=[match_zone(p,zones) for p in polys]
    pairs=[]
    for i in range(len(polys)):
        for j in range(i+1,len(polys)):
            x=classify(i,j,slabs,polys,walls,sm)
            if x['intersectionAreaM2']>AREA_EPS or x['sharedBoundaryLengthM']>EPS:pairs.append(x)
    pos=[x for x in pairs if x['intersectionAreaM2']>AREA_EPS]
    rawpairs=pair_rows(raw)
    rawpos=[x for x in rawpairs if x['intersectionAreaM2']>AREA_EPS]
    low_pairs=pair_rows(low_tolerance)
    low_pos=[x for x in low_pairs if x['intersectionAreaM2']>AREA_EPS]
    positive_pair_keys=[[x['firstIndex'],x['secondIndex']] for x in pos]
    raw_positive_pair_keys=[[x['firstIndex'],x['secondIndex']] for x in rawpos]
    low_positive_pair_keys=[[x['firstIndex'],x['secondIndex']] for x in low_pos]
    def sumclass(k):return sum(x['intersectionAreaM2'] for x in pos if x['classification']==k)
    cls=sorted({x['classification'] for x in pos})
    b=ev.get('importer',{}).get('boundary',{})
    raster_pairs=row.get('floor',{}).get('overlapPairs')
    raster_area=row.get('floor',{}).get('overlapAreaM2')
    exact_area=sum(x['intersectionAreaM2'] for x in pos)
    raw_area=sum(x['intersectionAreaM2'] for x in rawpos)
    if rawpos and pos:
        planned_interpretation='Raw detected spaces already contain positive overlap; planned/persisted slabs preserve that overlap, so this case is not attributable solely to the 0.08m simplification.'
    elif rawpos:
        planned_interpretation='Raw detected spaces overlap, while planned/persisted slabs do not; planning removed the raw overlap.'
    elif pos:
        planned_interpretation='Raw detected spaces are disjoint, but planned/persisted slabs overlap; independent per-space 0.08m simplification/planning introduced the overlap.'
    else:
        planned_interpretation='Neither raw detected spaces nor planned/persisted slabs have positive pairwise overlap.'
    return {
        'ordinal':int(row['ordinal']),
        'planId':pid,
        'name':ev.get('name'),
        'inputCounts':{
            'walls':len(walls),'spaces':len(spaces),'zones':len(zones),'slabs':len(slabs),
            'sourceRooms':ev.get('sourceDocument',{}).get('rooms'),
            'sourceNamedRooms':ev.get('sourceDocument',{}).get('namedRooms'),
            'boundaryIssues':len(b.get('issues',[])) if isinstance(b.get('issues'),list) else b.get('issues'),
            'danglingEndpoints':len(b.get('danglingEndpoints',[])) if isinstance(b.get('danglingEndpoints'),list) else b.get('danglingEndpoints'),
        },
        'rasterMetric':{'overlapPairs':raster_pairs,'overlapAreaM2':raster_area,'unionAreaM2':row.get('floor',{}).get('unionAreaM2')},
        'exactGeometry':{
            'positiveOverlapPairs':len(pos),'positivePairKeys':positive_pair_keys,'allTouchingPairs':len(pairs),'pairwiseOverlapAreaM2':exact_area,
            'rasterVsExact':{
                'rasterPairCountMinusExactPositive':raster_pairs-len(pos) if isinstance(raster_pairs,(int,float)) else None,
                'rasterAreaExcessM2':raster_area-exact_area if isinstance(raster_area,(int,float)) else None,
                'rasterToExactAreaRatio':raster_area/exact_area if isinstance(raster_area,(int,float)) and exact_area>AREA_EPS else None,
                'interpretation':'Raster fill masks count shared-boundary pixels and quantization as overlap; exact source-level polygon intersections are used for classification.',
            },
            'classificationPairCounts':{k:sum(1 for x in pos if x['classification']==k) for k in cls},
            'classificationPairAreaM2':{k:sumclass(k) for k in cls},
            'wallThicknessOnly':{'pairs':sum(1 for x in pos if x['classification']=='wall_thickness_only'),'pairwiseAreaM2':sumclass('wall_thickness_only')},
            'wallBandExplainedButIncomplete':{'pairs':sum(1 for x in pos if x['classification']=='actual_face_overlap' and AREA_EPS<x['wallBandUnionCoverage']<1-1e-6),'pairwiseAreaM2':sum(x['intersectionAreaM2'] for x in pos if x['classification']=='actual_face_overlap' and AREA_EPS<x['wallBandUnionCoverage']<1-1e-6)},
            'containment':{'pairs':sum(1 for x in pos if x['classification']=='containment'),'pairwiseAreaM2':sumclass('containment')},
            'actualFaceOverlap':{'pairs':sum(1 for x in pos if x['classification']=='actual_face_overlap'),'pairwiseAreaM2':sumclass('actual_face_overlap')},
            'duplicateFace':{'pairs':sum(1 for x in pos if x['classification']=='duplicate_face'),'pairwiseAreaM2':sumclass('duplicate_face')},
            'boundaryTouchOnly':{'pairs':sum(1 for x in pairs if x['classification']=='boundary_touch_only'),'sharedBoundaryLengthM':sum(x['sharedBoundaryLengthM'] for x in pairs if x['classification']=='boundary_touch_only')},
            'rawDetectedSpaces':{'positiveOverlapPairs':len(rawpos),'positivePairKeys':raw_positive_pair_keys,'allTouchingPairs':len(rawpairs),'pairwiseOverlapAreaM2':raw_area,'pairs':sorted(rawpos,key=lambda x:x['intersectionAreaM2'],reverse=True)[:12]},
            'lowToleranceSimplificationExperiment':{
                'toleranceM':1e-6,
                'positiveOverlapPairs':len(low_pos),
                'positivePairKeys':low_positive_pair_keys,
                'pairwiseOverlapAreaM2':sum(x['intersectionAreaM2'] for x in low_pos),
                'pairs':sorted(low_pos,key=lambda x:x['intersectionAreaM2'],reverse=True)[:12],
                'interpretation':'Replanning the detected space polygons with 1e-6m simplification removes the p42/p48 introduced positives while preserving p38 nested containment; this is an artifact-only comparison, not a product mutation.',
            },
            'plannedVsRaw':{
                'plannedPolygonsEqualPersistedPolygons':bool((d.get('persistedSurfaces',{}).get('slabs') or {}).get('exactGeometryMatch')),
                'simplificationToleranceM':0.08,
                'plannedPositivePairCountIntroducedAfterRawSpaces':len(pos)-len(rawpos),
                'plannedPairwiseAreaIntroducedAfterRawSpacesM2':exact_area-raw_area,
                'interpretation':planned_interpretation,
            },
            'topPairs':sorted(pos,key=lambda x:x['intersectionAreaM2'],reverse=True)[:12],
        },
        'slabAttribution':[{'index':i,'id':s.get('id'),'name':s.get('name'),'areaM2':area(polys[i]),'space':sm[i],'zone':zm[i],'metadata':metadata(s)} for i,s in enumerate(slabs)],
        'readiness':{'candidateStatus':ev.get('status'),'idempotent':ev.get('importer',{}).get('stability',{}).get('buildVectorNodesIdempotent'),'selfIntersectionCountFromFrozenMetric':row.get('floor',{}).get('selfIntersectionCount')},
    }
def fixture():
    wall={'id':'synthetic-wall','start':[0,-1],'end':[0,1],'thickness':.2}
    cases={'wall_thickness_only':([[-2,-1],[.1,-1],[.1,1],[-2,1]],[[-.1,-1],[2,-1],[2,1],[-.1,1]],[wall],'wall_thickness_only'),'actual_face_overlap':([[-2,-1],[.5,-1],[.5,1],[-2,1]],[[-.5,-1],[2,-1],[2,1],[-.5,1]],[wall],'actual_face_overlap'),'containment':([[-2,-2],[2,-2],[2,2],[-2,2]],[[-1,-1],[1,-1],[1,1],[-1,1]],[],'containment'),'boundary_touch_only':([[-2,-1],[0,-1],[0,1],[-2,1]],[[0,-1],[2,-1],[2,1],[0,1]],[],'boundary_touch_only')}
    out={}
    for n,(a,b,w,e) in cases.items():
        x=classify(0,1,[{'id':n+'-a','name':'A'},{'id':n+'-b','name':'B'}],[[tuple(p) for p in a],[tuple(p) for p in b]],w,[{'spaceIndex':None},{'spaceIndex':None}]); out[n]={'expected':e,'result':x,'passesExpectedClassification':x['classification']==e}
    return out
def summarize_case(case):
    exact=case['exactGeometry']
    raw=exact['rawDetectedSpaces']
    low=exact['lowToleranceSimplificationExperiment']
    planned_keys={tuple(key) for key in exact['positivePairKeys']}
    raw_keys={tuple(key) for key in raw['positivePairKeys']}
    low_keys={tuple(key) for key in low['positivePairKeys']}
    return {
        'ordinal':case['ordinal'],
        'planId':case['planId'],
        'name':case['name'],
        'raster':case['rasterMetric'],
        'rawDetectedSpaces':{
            'positiveOverlapPairs':raw['positiveOverlapPairs'],
            'pairwiseOverlapAreaM2':raw['pairwiseOverlapAreaM2'],
        },
        'plannedPersistedSlabs':{
            'positiveOverlapPairs':exact['positiveOverlapPairs'],
            'pairwiseOverlapAreaM2':exact['pairwiseOverlapAreaM2'],
            'classificationPairCounts':exact['classificationPairCounts'],
            'classificationPairAreaM2':exact['classificationPairAreaM2'],
        },
        'lowToleranceSimplification1e-6':{
            'positiveOverlapPairs':low['positiveOverlapPairs'],
            'pairwiseOverlapAreaM2':low['pairwiseOverlapAreaM2'],
            'newPositivePairsBeyondRaw':[list(key) for key in sorted(low_keys-raw_keys)],
        },
        'plannedPositivePairsIntroducedAfterRaw':[list(key) for key in sorted(planned_keys-raw_keys)],
    }

def aggregate_cases(cases):
    summaries=[summarize_case(case) for case in cases]
    def sum_field(path):
        total=0.0
        for case in summaries:
            value=case
            for part in path:value=value[part]
            total+=value
        return total
    def sum_pairs(path):
        return sum(sum(case[part]['positiveOverlapPairs'] for case in summaries) for part in path)
    planned_counts={}
    planned_areas={}
    for case in summaries:
        for key,value in case['plannedPersistedSlabs']['classificationPairCounts'].items():planned_counts[key]=planned_counts.get(key,0)+value
        for key,value in case['plannedPersistedSlabs']['classificationPairAreaM2'].items():planned_areas[key]=planned_areas.get(key,0)+value
    new_low_pairs=sum(len(case['lowToleranceSimplification1e-6']['newPositivePairsBeyondRaw']) for case in summaries)
    introduced_planned_pairs=sum(len(case['plannedPositivePairsIntroducedAfterRaw']) for case in summaries)
    return {
        'importedCaseCount':len(summaries),
        'plannedPersistedSlabs':{
            'positiveOverlapCaseCount':sum(1 for case in summaries if case['plannedPersistedSlabs']['positiveOverlapPairs']>0),
            'positiveOverlapPairs':sum(case['plannedPersistedSlabs']['positiveOverlapPairs'] for case in summaries),
            'pairwiseOverlapAreaM2':sum(case['plannedPersistedSlabs']['pairwiseOverlapAreaM2'] for case in summaries),
            'classificationPairCounts':dict(sorted(planned_counts.items())),
            'classificationPairAreaM2':dict(sorted(planned_areas.items())),
            'positiveOverlapIncludesContainment':planned_counts.get('containment',0)>0,
        },
        'rawDetectedSpaces':{
            'positiveOverlapCaseCount':sum(1 for case in summaries if case['rawDetectedSpaces']['positiveOverlapPairs']>0),
            'positiveOverlapPairs':sum(case['rawDetectedSpaces']['positiveOverlapPairs'] for case in summaries),
            'pairwiseOverlapAreaM2':sum(case['rawDetectedSpaces']['pairwiseOverlapAreaM2'] for case in summaries),
        },
        'lowToleranceSimplification1e-6':{
            'positiveOverlapCaseCount':sum(1 for case in summaries if case['lowToleranceSimplification1e-6']['positiveOverlapPairs']>0),
            'positiveOverlapPairs':sum(case['lowToleranceSimplification1e-6']['positiveOverlapPairs'] for case in summaries),
            'pairwiseOverlapAreaM2':sum(case['lowToleranceSimplification1e-6']['pairwiseOverlapAreaM2'] for case in summaries),
            'newPositivePairCountBeyondRaw':new_low_pairs,
            'introducesNewPositivePairsBeyondRaw':new_low_pairs>0,
            'noNewPositivePairsBeyondRaw':new_low_pairs==0,
        },
        'plannedPositivePairCountIntroducedAfterRaw':introduced_planned_pairs,
        'cases':summaries,
    }

def main():
    m=read(METRICS)
    rows=sorted((x for x in m['candidate']['cases'] if x.get('status')=='IMPORTED'),key=lambda x:x.get('floor',{}).get('overlapAreaM2',0),reverse=True)
    audited=[audit(row) for row in rows]
    top=audited[:3]
    all_summary=aggregate_cases(audited)
    fr=read(FREEZE)
    frozen_hashes=fr.get('sourceHashes',{})
    repo=EVIDENCE.parents[2]
    current_hashes={path:sha(repo/path) for path in frozen_hashes}
    out={
        'schemaVersion':'apartment-residual-closure-overlap-audit-v2',
        'status':'READ_ONLY_AUDIT',
        'resolvedModel':'gpt-5.6-luna',
        'reasoningEffort':'max',
        'scope':'No product/runtime/build/UI mutation; overlap-audit evidence only.',
        'method':{
            'frozenRenderer':'render_paired_v15.py floor_metrics uses cv2 raster masks and pairwise bitwise_and pixels.',
            'auditGeometry':'Stored level polygons are ear-clipped into triangles; pair/triple intersections use convex clipping in source level metres.',
            'wallBand':'Wall centerline expanded by stored thickness/2 on both sides.',
            'wallBandUnion':'Union of overlap∩wall bands is calculated by inclusion-exclusion; upper-bound sums are never used to prove full coverage.',
            'classificationOrder':['duplicate_face','containment','boundary_touch_only','wall_thickness_only','actual_face_overlap'],
            'tolerance':{'coordinateEpsilonM':EPS,'areaEpsilonM2':AREA_EPS,'containmentRelative':1e-7},
            'pairwiseAreaCaveat':'Pairwise sums may exceed union for nested three-or-more polygons.',
        },
        'inputs':{
            'auditScript':'overlap_audit.py',
            'auditScriptSha256':sha(HERE/'overlap_audit.py'),
            'candidateMetrics':str(METRICS.relative_to(EVIDENCE)),
            'candidateMetricsSha256':sha(METRICS),
            'renderer':str(RENDER.relative_to(EVIDENCE)),
            'rendererSha256':sha(RENDER),
            'sourceFreeze':str(FREEZE.relative_to(EVIDENCE)),
            'frozenSourceHashes':frozen_hashes,
            'currentSourceHashes':current_hashes,
            'topCaseImportedFiles':{x['planId']:sha(CANDIDATE/f"{x['planId']}.json") for x in top},
            'topCaseEvaluationFiles':{x['planId']:sha(EVALUATION/f"{x['planId']}.json") for x in top},
            'allImportedCaseCount':len(audited),
        },
        'baselineContext':{
            'candidateImportedCases':m['candidate']['importedCases'],
            'candidateRejectedCases':m['candidate']['rejectedCases'],
            'frozenCandidateOverlapCases':m['candidate']['slabGeometry']['overlapCases'],
            'frozenCandidateOverlapPairs':m['candidate']['slabGeometry']['overlapPairs'],
            'frozenCandidateOverlapAreaM2':m['candidate']['slabGeometry']['overlapAreaM2'],
            'frozenBaselineOverlapPairs':m['baseline']['slabGeometry']['overlapPairs'],
            'frozenBaselineOverlapAreaM2':m['baseline']['slabGeometry']['overlapAreaM2'],
        },
        'allImportedCases':all_summary,
        'topCases':top,
        'syntheticFixtures':fixture(),
        'readiness':{
            'sourceHashMatchesFreeze':current_hashes==frozen_hashes,
            'productFilesChanged':False,
            'materialRootCause':'p42/p48 are zero-overlap raw Spaces whose independently simplified 0.08m planned polygons spill across adjacent wall bands; p38 is pre-existing raw nested aggregate/child containment.',
            'minimalFixCandidate':'Compare a shared boundary-preserving simplification or adjacency clipping policy against the 1e-6m artifact-only variant before changing product code.',
            'coverageRegressionRisk':'Lowering tolerance or dropping nested polygons can remove valid coverage and reduce selected-seed face counts; p38 must remain covered while p42/p48 are rechecked.',
            'recommendation':'No product fix applied; route the shared planner hypothesis through Sol review with selected and batch seed-count gates.',
        },
    }
    outp=HERE/'overlap-audit.json'
    outp.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'output':str(outp),'sha256':sha(outp),'importedCaseCount':len(audited),'topCases':[x['planId'] for x in top]}))

if __name__=='__main__': main()
