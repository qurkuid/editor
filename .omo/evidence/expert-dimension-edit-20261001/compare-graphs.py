import json,sys,math
from pathlib import Path
base=json.loads(Path(sys.argv[1]).read_text())['graph']
after=json.loads(Path(sys.argv[2]).read_text())['graph']
a,b=base['nodes'],after['nodes']
assert a.keys()==b.keys(), 'Node identities changed'
assert base['rootNodeIds']==after['rootNodeIds'], 'Roots changed'
if len(sys.argv)>3 and sys.argv[3]=='undo':
    assert base==after, 'Undo did not restore exact graph'
    print('PASS exact graph undo:',len(a),'nodes')
else:
    changed=[k for k in a if a[k]!=b[k]]
    counts={t:sum(a[k]['type']==t for k in changed) for t in ('wall','door','window','zone')}
    for k in a:
        allowed={'wall':{'start','end'},'door':{'position','width','roughOpeningWidth','masonryOpeningWidth','finishOpeningWidth'},'window':{'position','width','roughOpeningWidth','masonryOpeningWidth','finishOpeningWidth'},'zone':{'polygon','area','boundaryWallIds','enclosureStatus','detectedFrom','position'}}.get(a[k]['type'],set())
        for field in a[k].keys()|b[k].keys():
            if field not in allowed: assert a[k].get(field)==b[k].get(field),(k,field,'Unexpected metadata mutation')
        if a[k]['type']=='wall':
            assert math.dist(b[k]['start'],b[k]['end'])>.01, (k,'Collapsed wall')
    print('PASS identity and metadata preservation:',len(changed),'changed',counts)
