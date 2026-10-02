import json,math,sys
before=json.load(open(sys.argv[1]))['graph'];after=json.load(open(sys.argv[2]))['graph']
def anchors(nodes):
 result={}
 for n in nodes.values():
  if n['type'] not in ('door','window'):continue
  w=nodes[n['wallId']]; start=w['start'];end=w['end'];length=math.dist(start,end)
  assert n['parentId']==w['id'] and n['id'] in w['children']
  p=[start[i]+(end[i]-start[i])*n['position'][0]/length for i in range(2)]
  result[n['metadata']['sourceOpeningId']]=(p,n['width'])
 return result
a,b=anchors(before),anchors(after);assert set(a)==set(b)
error=max(math.dist(a[id][0],b[id][0]) for id in a)
assert error<1e-7,error
assert all(abs(a[id][1]-b[id][1])<1e-7 for id in a)
print(json.dumps({'openingCount':len(a),'maxAnchorErrorM':error,'hostsValid':True}))
