import json, math, subprocess, sys
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parent
scene, name = sys.argv[1:]
file = root / (name + '.json')
subprocess.run(['curl', '--fail', '--silent', '--show-error', 'http://localhost:3002/api/scenes/' + scene, '-o', str(file)], check=True)
d = json.loads(file.read_text())
nodes = d['graph']['nodes']
walls = [n for n in nodes.values() if n['type'] == 'wall']
errors = []
for n in nodes.values():
 if n['type'] not in ('door', 'window'): continue
 w = nodes.get(n.get('wallId'))
 if not w or w['type'] != 'wall': errors.append([n['id'], 'missing-host']); continue
 length = math.dist(w['start'], w['end'])
 if n['position'][0] - n['width']/2 < -.01 or n['position'][0] + n['width']/2 > length + .01:
  errors.append([n['id'], 'outside-host'])
print(name, 'version', d['version'], dict(Counter(n['type'] for n in nodes.values())), 'host-errors', errors)
if len(walls) < 8:
 for w in walls: print(w['id'], w.get('name'), 'start', w['start'], 'end', w['end'], 'length', round(math.dist(w['start'],w['end']),3), 'thickness',w['thickness'])
