import concurrent.futures
import hashlib
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / 'manifest.json').read_text())
plans = manifest['plans']

def fetch(item):
    folder = ROOT / item['key']
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / 'source.jpg'
    started = time.time()
    result = {'key': item['key'], 'url': item['planPic'], 'target': str(target), 'startedAt': started}
    try:
        req = urllib.request.Request(item['planPic'], headers={'User-Agent': 'PascalBaseline/20261003'})
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read()
            result.update({'httpStatus': response.status, 'contentType': response.headers.get('Content-Type'), 'bytes': len(body)})
        if not body or body[:2] != b'\xff\xd8':
            raise ValueError('source response is not JPEG')
        target.write_bytes(body)
        result.update({'status': 'ok', 'sha256': hashlib.sha256(body).hexdigest()})
    except Exception as error:
        result.update({'status': 'error', 'error': repr(error)})
    result['elapsedMs'] = round((time.time() - started) * 1000, 1)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(fetch, plans))
results.sort(key=lambda x: x['key'])
(ROOT / 'source-fetch.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
summary = {'total': len(results), 'ok': sum(r['status'] == 'ok' for r in results), 'errors': [r for r in results if r['status'] != 'ok']}
(ROOT / 'source-fetch-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summary, ensure_ascii=False))
if summary['errors']:
    raise SystemExit(1)
