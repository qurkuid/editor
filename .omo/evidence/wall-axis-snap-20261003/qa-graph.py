import json,pathlib,sys,urllib.request
folder=pathlib.Path(__file__).parent
scene_id = sys.argv[2] if len(sys.argv)>2 else 'qa-wall-axis-snap-20261003'
with urllib.request.urlopen('http://localhost:3002/api/scenes/'+scene_id) as r:
    data=json.load(r)
label=sys.argv[1]
(folder/(label+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2))
walls={k:{'start':v['start'],'end':v['end']} for k,v in data['graph']['nodes'].items() if v['type']=='wall'}
base=json.load(open(folder/('reference-fixture-request.json' if 'reference' in scene_id else 'fixture-request.json')))['graph']
changed=[k for k in set(base['nodes'])|set(data['graph']['nodes']) if base['nodes'].get(k)!=data['graph']['nodes'].get(k)]
print(json.dumps({'label':label,'walls':walls,'exactBaseline':base==data['graph'],'changed':changed},ensure_ascii=False))
