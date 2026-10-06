import argparse, hashlib, json, pathlib, urllib.request
parser=argparse.ArgumentParser()
parser.add_argument('action',choices=['snapshot','compare'])
parser.add_argument('paths',nargs='+')
parser.add_argument('--scene',default='qa-manual-boundary-20261003')
a=parser.parse_args()
if a.action=='snapshot':
    with urllib.request.urlopen('http://127.0.0.1:3014/api/scenes/'+a.scene) as response: data=json.load(response)
    pathlib.Path(a.paths[0]).write_text(json.dumps(data,ensure_ascii=False,indent=2))
    walls={k:{'start':v['start'],'end':v['end']} for k,v in data['graph']['nodes'].items() if v['type']=='wall'}
    selected={k:v for k,v in walls.items() if k in ['wall_ggf99ydyqrsc817f','wall_m5sb1yvia8zx4239','wall_qa_manual_source','wall_qa_manual_target','wall_qa_manual_ambiguous']}
    print(json.dumps({'scene':data['id'],'graphHash':data.get('graphHash'),'walls':selected},ensure_ascii=False))
else:
    left=json.load(open(a.paths[0]))['graph'];right=json.load(open(a.paths[1]))['graph']
    changed=[k for k in sorted(set(left['nodes'])|set(right['nodes'])) if left['nodes'].get(k)!=right['nodes'].get(k)]
    exact=left==right
    print(json.dumps({'exact':exact,'changedNodeIds':changed,'otherFields': [k for k in set(left)|set(right) if k!='nodes' and left.get(k)!=right.get(k)]},ensure_ascii=False))
    raise SystemExit(0 if exact else 1)
