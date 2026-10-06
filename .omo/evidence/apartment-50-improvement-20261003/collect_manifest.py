import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = Path('.omx/recovery-20260929/data/apt-data/full-plans.ndjson')
CACHE = Path('.omx/recovery-20260929/data/apt-data/vector-cache')
EXCLUDED = {'3FO3YBET8M3M', '3FO3Y8VP946W', '3FO3YD1THDWY'}

rows = [json.loads(line) for line in DATA.open()]
cached_plan_ids = {p.stem for p in CACHE.glob('*.json')}
cached_apartment_ids = {
    row['id'] for row in rows if any(plan['planId'] in cached_plan_ids for plan in row.get('plans', []))
}

def area(plan):
    m = re.search(r'(\d+(?:\.\d+)?)', plan.get('type', ''))
    return float(m.group(1)) if m else None

def size_bin(value):
    if value is None: return 'unknown'
    if value < 60: return 'lt60'
    if value < 85: return '60-84'
    if value < 110: return '85-109'
    if value < 130: return '110-129'
    return '130plus'

def stable(value):
    return hashlib.sha256(value.encode()).hexdigest()

candidates = []
for index, row in enumerate(rows):
    if row['id'] in cached_apartment_ids:
        continue
    plans = [p for p in row.get('plans', []) if p.get('planId') and p.get('planPic') and p.get('planId') not in cached_plan_ids | EXCLUDED]
    if not plans:
        continue
    plan = sorted(plans, key=lambda p: stable(p['planId']))[0]
    ar = area(plan)
    candidates.append({
        'apartmentId': row['id'], 'planId': plan['planId'], 'planPic': plan['planPic'],
        'name': plan['name'], 'type': plan['type'], 'area': ar, 'sizeBin': size_bin(ar),
        'sourceIndex': index, 'indexBucket': min(4, index * 5 // len(rows)),
    })

groups = defaultdict(list)
for item in candidates:
    groups[(item['sizeBin'], item['indexBucket'])].append(item)

selected = []
used = set()
for size in ['lt60', '60-84', '85-109', '110-129', '130plus']:
    for bucket in range(5):
        options = sorted(groups[(size, bucket)], key=lambda x: stable(x['apartmentId'] + x['planId']))
        for item in options[:2]:
            selected.append(item)
            used.add(item['apartmentId'])

if len(selected) < 50:
    rest = [x for x in candidates if x['apartmentId'] not in used]
    rest.sort(key=lambda x: stable(x['apartmentId'] + x['planId']))
    selected.extend(rest[:50 - len(selected)])
selected = selected[:50]
assert len(selected) == 50, len(selected)
assert len({x['apartmentId'] for x in selected}) == 50
assert not ({x['planId'] for x in selected} & (cached_plan_ids | EXCLUDED))

for ordinal, item in enumerate(selected, 1):
    item['ordinal'] = ordinal
    item['key'] = f"p{ordinal:02d}_{item['planId']}"

manifest = {
    'collection': 'apartment-50-improvement-20261003',
    'source': str(DATA),
    'vectorizer': '.omx/recovery-20260929/data/vectorize.py',
    'vectorizerPython': '.omx/recovery-20260929/data/vectorizer-python',
    'selection': {
        'algorithm': 'two plans per size-bin × source-index quintile, stable SHA-256 tie-break, then stable fill',
        'additionalUniquePlans': 50,
        'distinctComplexes': 50,
        'excludedPlanIds': sorted(EXCLUDED),
        'excludedCachedPlanIds': sorted(cached_plan_ids),
    },
    'plans': selected,
}
(ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({
    'plans': len(selected), 'complexes': len({x['apartmentId'] for x in selected}),
    'sizeBins': {k: sum(x['sizeBin'] == k for x in selected) for k in ['lt60', '60-84', '85-109', '110-129', '130plus']},
    'indexBuckets': {str(k): sum(x['indexBucket'] == k for x in selected) for k in range(5)},
    'cachedPlansExcluded': len(cached_plan_ids),
}, ensure_ascii=False))
