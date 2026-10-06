from pathlib import Path
import json, hashlib, sys
repo=Path('/Users/changseok/editor')
root=repo/'.omo/evidence/apartment-residual-closure-20261003'
manifest=json.loads((root/'baseline-parent/baseline-manifest.json').read_text())
allowed={'packages/core/src/lib/room-boundary.ts','packages/core/src/lib/room-boundary.test.ts','packages/core/src/lib/space-detection.ts','packages/core/src/lib/space-detection.test.ts','packages/core/src/lib/space-detection-history.test.ts','packages/mcp/src/modeling-agent-manual.ts','packages/mcp/src/ontology-manual.test.ts','packages/mcp/src/resources/resources.test.ts'}
errors=[];changes=[];sources={}
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
for item in manifest['files']:
    p=repo/item['path']
    if not p.is_file(): errors.append('missing: '+item['path']); continue
    current=sha(p)
    if item['kind']=='source':
        sources[item['path']]=current
        snapshot=root/'baseline-parent/source-snapshots'/item['path']
        if not snapshot.is_file() or sha(snapshot)!=item['sha256']: errors.append('snapshot changed: '+item['path'])
        if current!=item['sha256']:
            changes.append(item['path'])
            if item['path'] not in allowed: errors.append('out-of-scope source: '+item['path'])
    elif current!=item['sha256']: errors.append('input/evidence changed: '+item['path'])
annotations=json.loads((root/'annotation-image-freeze.json').read_text())
for item in annotations['files']:
    p=repo/item['path']
    if not p.is_file() or sha(p)!=item['sha256']: errors.append('annotation/image changed: '+item['path'])
result={'verified':not errors,'filesChecked':len(manifest['files']),'sourceCount':len(sources),'annotationImageFilesChecked':len(annotations['files']),'changedSourceFiles':changes,'currentSourceHashes':sources,'errors':errors}
output=Path(sys.argv[1]) if len(sys.argv)>1 else root/'input-source-guard.json'
output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['verified','filesChecked','sourceCount','changedSourceFiles','errors']}))
raise SystemExit(bool(errors))
