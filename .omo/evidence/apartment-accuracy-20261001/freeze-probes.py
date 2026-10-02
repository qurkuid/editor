import json,shutil
from pathlib import Path
b=Path(__file__).parent
spec={
'daeyeon': [('bedroom',402,250),('bedroom',668,458),('bedroom',790,458),('bedroom',915,405),('bath',542,298),('bath',746,298),('dress',484,187),('dress',603,298),('entrance',657,298),('living',469,414),('kitchen',570,490),('balcony',282,198),('balcony',282,280),('balcony',334,557),('balcony',400,557),('balcony',485,566)],
'centum':[('bedroom',316,421),('bedroom',390,471),('bedroom',539,455),('bedroom',838,273),('bath',688,232),('bath',481,313),('entrance',545,301),('entrance',523,216),('living',722,402),('kitchen',655,458),('balcony',941,271),('balcony',953,481),('balcony',317,513),('balcony',425,514),('balcony',538,514),('balcony',655,544),('balcony',752,544)],
'forest':[('bedroom',558,270),('bedroom',113,521),('bedroom',283,521),('bath',435,173),('bath',412,333),('dress',575,128),('entrance',269,332),('living',481,478),('kitchen',388,530),('balcony',705,216),('balcony',705,435),('balcony',392,636)],
'sajik':[('bedroom',522,270),('bedroom',356,505),('bedroom',488,505),('bedroom',864,442),('bath',820,295),('bath',310,368),('dress',917,320),('entrance',395,291),('living',683,535),('kitchen',666,214),('balcony',786,190),('balcony',903,239),('balcony',848,574),('balcony',928,566)],
'beonyeong':[('bedroom',456,350),('bedroom',535,510),('bedroom',794,510),('bath',491,277),('bath',820,411),('storage',769,369),('entrance',721,369),('living',651,438),('kitchen',639,273),('balcony',457,191),('balcony',437,492),('balcony',615,594),('balcony',801,594)]}
names={'bedroom':['안방','방'],'bath':['욕실'],'dress':['드레스룸','드레스'],'entrance':['현관','전실'],'living':['거실'],'kitchen':['부엌','주방'],'balcony':['발코니'],'storage':['창고']}
walls={'daeyeon':[(305,180,305,320),(728,425,728,515),(849,371,849,474)],'centum':[(374,424,374,484),(470,430,470,493),(750,209,750,301)],'forest':[(480,193,480,338),(343,307,343,368),(211,478,211,578)],'sajik':[(591,209,591,342),(424,445,424,573),(774,397,774,510)],'beonyeong':[(543,350,543,431),(583,265,583,313),(738,491,738,550)]}
for k, probes in spec.items():
 import cv2
 h,w=cv2.imread(str(b/k/'source.jpg')).shape[:2]
 f=dict(sourceImageSize=[w,h],origin='원본 도면 육안 판독 후 생성 결과 확인 전에 동결한 기준점',expectedRooms=len(probes),roomProbes=[dict(id=f'{c}-{i}',label=c,source=[x,y],cls=c,acceptedNames=names[c]) for i,(c,x,y) in enumerate(probes)],wallProbes=[dict(id=f'wall-{i}',label='원본 실벽',a=[x,y],b=[z,t]) for i,(x,y,z,t) in enumerate(walls[k])],forbiddenWallProbes=[],closedHostPairs=[],tolerances=dict(wallBodyDistanceM=.06,overlapInteriorAreaM2=.005,endpointGapM=.02))
 (b/k/'fixture.json').write_text(json.dumps(f,ensure_ascii=False,indent=2))
for k in ('jangjeon','haeundae','hwmyeong'):
 for f in ('source.jpg','fixture.json'):
  shutil.copyfile(Path('.omo/evidence/apartment-completeness-20261001')/k/f,b/k/f)
