import hashlib, json, pathlib, subprocess

root = pathlib.Path('/Users/changseok/editor')
qa = pathlib.Path('/Users/changseok/.codex/worktrees/manual-l-connection-qa/editor')
owned = [
    'packages/core/src/index.ts',
    'packages/core/src/lib/room-boundary.ts',
    'packages/core/src/lib/room-boundary-l.test.ts',
    'packages/editor/src/components/editor-2d/room-boundary-connect.tsx',
    'packages/editor/src/components/editor-2d/room-boundary-interaction.ts',
    'packages/editor/src/components/editor-2d/room-boundary-interaction.test.ts',
]
for path in owned:
    (qa/path).write_bytes((root/path).read_bytes())
manual = 'packages/mcp/src/modeling-agent-manual.ts'
baseline = subprocess.check_output(['git', 'show', 'HEAD:'+manual], cwd=qa).decode()
paragraphs = [line for line in (root/manual).read_text().splitlines() if 'Manual wall boundary connection has two explicit routes' in line]
assert len(paragraphs) == 1
marker = "  '## Direct Editor Interactions',"
assert baseline.count(marker) == 1
(qa/manual).write_text(baseline.replace(marker, paragraphs[0]+"\n  '',\n"+marker))
assertions = [
    'Manual wall boundary connection has two explicit routes',
    'horizontal→vertical or vertical→horizontal bends',
    'Preview creates no scene nodes',
]
for path, variable, anchor in [
    ('packages/mcp/src/ontology-manual.test.ts', 'MODELING_AGENT_MANUAL', "    expect(MODELING_AGENT_MANUAL).toContain('Endpoint dragging in both 2D and 3D validates')"),
    ('packages/mcp/src/resources/resources.test.ts', 'text', "      expect(text).toContain('Endpoint dragging in both 2D and 3D validates')"),
    ('apps/editor/lib/ai-provider.test.ts', 'prompt', "    expect(prompt).toContain('uncertain internal fixtures remain `opening`')"),
]:
    baseline = subprocess.check_output(['git', 'show', 'HEAD:'+path], cwd=qa).decode()
    assert baseline.count(anchor) == 1, path
    indent = anchor[:len(anchor)-len(anchor.lstrip())]
    added = '\n'.join(f"{indent}expect({variable}).toContain({json.dumps(text, ensure_ascii=False)})" for text in assertions)
    (qa/path).write_text(baseline.replace(anchor, anchor+'\n'+added))
paths = owned + [manual, 'packages/mcp/src/ontology-manual.test.ts', 'packages/mcp/src/resources/resources.test.ts', 'apps/editor/lib/ai-provider.test.ts']
manifest = {path: hashlib.sha256((qa/path).read_bytes()).hexdigest() for path in paths}
(root/'.omo/evidence/manual-l-connection-20261003/scoped-manifest.json').write_text(json.dumps(manifest, indent=2))
print(json.dumps({'projectedFiles': len(paths), 'base': subprocess.check_output(['git','rev-parse','HEAD'],cwd=qa).decode().strip()}))
