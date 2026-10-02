import json, math, sys
from collections import Counter, defaultdict
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent

def area(poly):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))/2

def dist_seg(p,a,b):
    a,b,p = map(lambda x: np.array(x,dtype=float),(a,b,p))
    v=b-a
    t=np.clip(np.dot(p-a,v)/max(np.dot(v,v),1e-15),0,1)
    return float(np.linalg.norm(p-a-v*t))

def simple(poly):
    if len(poly)<3 or not all(math.isfinite(v) for p in poly for v in p): return False
    for i,(a,b) in enumerate(zip(poly,poly[1:]+poly[:1])):
        if math.dist(a,b)<1e-8:return False
        for j in range(i+1,len(poly)):
            if j==i+1 or (i==0 and j==len(poly)-1):continue
            c,d=poly[j],poly[(j+1)%len(poly)]
            def cross(u,v,w):return (v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0])
            if cross(a,b,c)*cross(a,b,d)<-1e-15 and cross(c,d,a)*cross(c,d,b)<-1e-15:return False
    return area(poly)>0.001

def audit(case):
    folder=ROOT/case['key']
    api=json.loads((folder/'api.json').read_text())['data']
    scene=json.loads((folder/'scene.json').read_text())
    fixture=json.loads((folder/'fixture.json').read_text())
    imported=json.loads((folder/'import.json').read_text())
    ns=list(scene['graph']['nodes'].values())
    byid={n['id']:n for n in ns}
    walls=[n for n in ns if n['type']=='wall']
    zones=[n for n in ns if n['type']=='zone']
    openings=[n for n in ns if n['type'] in ['door','window']]
    W,H=api['imageSize']; sw,sh=fixture['sourceImageSize']
    sx,sy=W/sw,H/sh
    m=api['mmPerPx']/1000
    center=np.array([W*m/2,H*m/2])
    def source_to_scene(p):return np.array([p[0]*sx*m,p[1]*sy*m])-center
    def scene_to_source(p):return ((np.array(p)+center)/[sx*m,sy*m]).tolist()
    def to_raster(p):return tuple(np.rint((np.array(p)+center)/m).astype(int))
    polys=[np.array(z['polygon'],np.float32) for z in zones]
    issues=[]
    guide=next(n for n in ns if n['type']=='guide')
    frame_ok=abs(guide['scale']-W*api['mmPerPx']/10000)<1e-7 and guide['position']==[0,0,0]
    if not frame_ok:issues.append({'kind':'frame','message':'원본 도면과 모델 좌표계 불일치'})
    matches=[];used=defaultdict(list)
    for p in fixture['roomProbes']:
        point=source_to_scene(p['source'])
        hits=[i for i,poly in enumerate(polys) if cv2.pointPolygonTest(poly,tuple(map(float,point)),False)>=0]
        rs=[{'id':zones[i]['id'],'sourceRoomId':zones[i]['metadata']['sourceRoomId'],'name':zones[i]['name'],'cls':zones[i]['metadata']['cls']} for i in hits]
        ok=len(rs)==1 and rs[0]['name'] in p['acceptedNames'] and rs[0]['cls']==p['cls']
        if len(hits)==1:used[zones[hits[0]]['id']].append(p['id'])
        match={**p,'scene':point.tolist(),'matches':rs,'pass':ok}
        matches.append(match)
        if not ok:issues.append({'kind':'room','probe':p['id'],'message':p['label']+' 기준점의 존 누락 또는 이름·용도 불일치','actual':rs})
    merged=[{'zoneId':z,'probes':ps} for z,ps in used.items() if len(ps)>1]
    unused=[{'zoneId':z['id'],'sourceRoomId':z['metadata']['sourceRoomId'],'name':z['name'],'cls':z['metadata']['cls'],'areaM2':area(z['polygon']),'polygonSource':[scene_to_source(v) for v in z['polygon']]} for z in zones if z['id'] not in used]
    if merged:issues.append({'kind':'merged-zones','message':'도면상 다른 공간 기준점이 같은 존을 재사용함','details':merged})
    if unused:issues.append({'kind':'extra-zones','message':'도면 기준 공간과 대응하지 않는 추가 존','details':[{'sourceRoomId':z['sourceRoomId'],'name':z['name'],'areaM2':z['areaM2']} for z in unused]})
    if len(zones)!=fixture['expectedRooms']:issues.append({'kind':'room-count','expected':fixture['expectedRooms'],'actual':len(zones)})
    invalid=[z['id'] for z in zones if not simple(z['polygon'])]
    zone_masks=[]
    for z in zones:
        mask=np.zeros((H,W),np.uint8)
        pts=np.array([to_raster(v) for v in z['polygon']],np.int32)
        cv2.fillPoly(mask,[pts],1)
        zone_masks.append(cv2.erode(mask,np.ones((3,3),np.uint8)))
    overlaps=[]
    for i in range(len(zones)):
        for j in range(i+1,len(zones)):
            shared=float(np.count_nonzero(zone_masks[i]&zone_masks[j]))*m*m
            if shared>fixture['tolerances']['overlapInteriorAreaM2']:overlaps.append({'zones':[zones[i]['id'],zones[j]['id']],'areaM2':shared})
    if invalid:issues.append({'kind':'invalid-polygon','zones':invalid})
    if overlaps:issues.append({'kind':'zone-overlap','details':overlaps})
    dangling=[]
    for w in walls:
        for end in ['start','end']:
            p=w[end]
            candidates=[(dist_seg(p,o['start'],o['end'])-o.get('thickness',.1)/2-w.get('thickness',.1)/2,o) for o in walls if o['id']!=w['id']]
            gap,near=min(candidates,key=lambda t:t[0])
            if gap>fixture['tolerances']['endpointGapM']:
                dangling.append({'wallId':w['id'],'end':end,'source':scene_to_source(p),'nearestWallId':near['id'],'bodyGapM':round(gap,4)})
    body_mask=np.zeros((H,W),np.uint8)
    for w in walls:cv2.line(body_mask,to_raster(w['start']),to_raster(w['end']),1,max(1,round(w.get('thickness',.1)/m)),cv2.LINE_8)
    _,components=cv2.connectedComponents(1-body_mask,connectivity=4)
    outside=int(components[0,0])
    physical=[]
    for p in fixture['roomProbes']:
        q=to_raster(source_to_scene(p['source']))
        component=int(components[q[1],q[0]])
        physical.append({'probe':p['id'],'component':component,'reachesExterior':component==outside,'onWallBody':component==0})
    outside_probes=[r['probe'] for r in physical if r['reachesExterior']]
    if outside_probes:issues.append({'kind':'exterior-leak','message':'실제 벽 두께를 그린 뒤에도 공간 기준점이 외부와 연결됨','probes':outside_probes})
    physical_by_probe={r['probe']:r for r in physical}
    missing_separations=[]
    for left,right in fixture.get('closedHostPairs',[]):
        a,b=physical_by_probe[left],physical_by_probe[right]
        if a['component']!=0 and a['component']==b['component']:
            missing_separations.append([left,right])
    if missing_separations:issues.append({'kind':'missing-separation','message':'도면상 벽 또는 문·창 호스트로 나뉘는 공간이 같은 물리 영역으로 연결됨','pairs':missing_separations})
    wall_probes=[]
    for p in fixture['wallProbes']:
        ds=[]
        for t in np.linspace(0,1,13):
            q=source_to_scene(np.array(p['a'])*(1-t)+np.array(p['b'])*t)
            ds.append(max(0,min(dist_seg(q,w['start'],w['end'])-w.get('thickness',.1)/2 for w in walls)))
        ok=max(ds)<=fixture['tolerances']['wallBodyDistanceM']
        result={**p,'maxBodyDistanceM':round(max(ds),4),'samplesM':[round(d,4) for d in ds],'pass':ok}
        wall_probes.append(result)
        if not ok:issues.append({'kind':'missing-wall','probe':p['id'],'message':p['label']+' 13점 검사에서 벽 또는 개구부 호스트 누락','maxBodyDistanceM':result['maxBodyDistanceM']})
    forbidden=[]
    for p in fixture['forbiddenWallProbes']:
        ds=[]
        for t in np.linspace(0,1,9):
            q=source_to_scene(np.array(p['a'])*(1-t)+np.array(p['b'])*t)
            ds.append(max(0,min(dist_seg(q,w['start'],w['end'])-w.get('thickness',.1)/2 for w in walls)))
        blocked=sum(d<=.03 for d in ds)
        result={**p,'blockedSamples':blocked,'totalSamples':len(ds),'pass':blocked==0}
        forbidden.append(result)
        if blocked:issues.append({'kind':'false-wall','probe':p['id'],'message':p['label']+'에 도면에 없는 벽·창 호스트가 생성됨','blockedSamples':blocked})
    host_errors=[]
    for o in openings:
        host=byid.get(o.get('wallId'))
        if not host or host['type']!='wall' or o['parentId']!=o['wallId'] or o['id'] not in host['children']:
            host_errors.append(o['id']);continue
        length=math.dist(host['start'],host['end'])
        if o['position'][0]-o['width']/2 < -.01 or o['position'][0]+o['width']/2 > length+.01:host_errors.append(o['id'])
    if host_errors:issues.append({'kind':'opening-host','ids':host_errors})
    diagnostics=imported['diagnostics']
    if diagnostics['unhostedOpeningIds']:issues.append({'kind':'unhosted-opening','ids':diagnostics['unhostedOpeningIds']})
    source_types=Counter(o['type'] for o in api['openings'])
    model_types=Counter('opening' if o.get('openingKind')=='opening' else o['type'] for o in openings)
    report={'status':'PASS' if not issues else 'FAIL','case':case,'sceneVersion':scene['version'],'docVersion':api['docVersion'],
    'frameVerified':frame_ok,'expectedRooms':fixture['expectedRooms'],'actualZones':len(zones),
    'roomProbesPassed':sum(p['pass'] for p in matches),'roomProbesTotal':len(matches),'roomMatches':matches,'mergedZones':merged,'unmatchedZones':unused,
    'zoneGeometry':{'invalidPolygons':invalid,'interiorOverlaps':overlaps},
    'counts':dict(Counter(n['type'] for n in ns)),'sourceOpeningTypes':dict(source_types),'modelOpeningTypes':dict(model_types),
    'wallProbes':wall_probes,'forbiddenWallProbes':forbidden,'danglingEndpoints':dangling,'physicalComponents':physical,'exteriorConnectedProbes':outside_probes,
    'missingSeparations':missing_separations,'hostErrors':host_errors,'importDiagnostics':diagnostics,'issues':issues,
    'method':{'wallThicknessRaster':'source analysis resolution, actual host wall thickness, 4-connectivity; door/window hosts treated as continuous structural wall','wallCoverage':'13 independently specified source span samples, measured body distance <= 0.06m','zoneOverlap':'1 pixel interior erosion then area > 0.005m2; geometric degeneracy and proper self-intersections checked separately','note':'Room seed points and expected use are independently marked from original floor plans. Open circulation is not a missing partition by itself. Dangling ends are candidates requiring source comparison.'}}
    (folder/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(case['name'],report['status'],'zones',len(zones),'/',fixture['expectedRooms'],'probes',report['roomProbesPassed'],'/',len(matches),'dangling',len(dangling),'outside',outside_probes)
    for i in issues:print(' ',json.dumps(i,ensure_ascii=False))
    return report

reports=[audit(c) for c in json.loads((ROOT/'cases.json').read_text())]
(ROOT/'summary.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
sys.exit(0 if all(r['status']=='PASS' for r in reports) else 1)
