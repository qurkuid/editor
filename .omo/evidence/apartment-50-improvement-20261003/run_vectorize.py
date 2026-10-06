import concurrent.futures
import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
manifest = json.loads((ROOT / 'manifest.json').read_text())
python = REPO / '.omx/recovery-20260929/data/vectorizer-python'
vectorizer = REPO / '.omx/recovery-20260929/data/vectorize.py'

def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def run(item):
    folder = ROOT / item['key']
    source = folder / 'source.jpg'
    input_file = folder / f"{item['planId']}.jpg"
    shutil.copyfile(source, input_file)
    output = folder / 'vector.json'
    stderr_file = folder / 'vectorize.stderr.log'
    started = time.time()
    result = {'key': item['key'], 'planId': item['planId'], 'startedAt': started, 'sourceSha256': sha256(source)}
    try:
        proc = subprocess.run(
            [str(python), str(vectorizer), '--stdout', str(input_file)],
            cwd=str(REPO), capture_output=True, text=True, timeout=180,
        )
        stderr_file.write_text(proc.stderr)
        if proc.returncode != 0:
            raise RuntimeError(f'vectorizer exit {proc.returncode}')
        lines = [line for line in proc.stdout.splitlines() if line.strip()]
        if not lines:
            raise RuntimeError('vectorizer returned empty stdout')
        doc = json.loads(lines[-1])
        output.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
        result.update({'status': 'ok', 'vectorSha256': sha256(output), 'metrics': doc.get('metrics'), 'docVersion': doc.get('docVersion'), 'stdoutLines': len(lines)})
    except Exception as error:
        result.update({'status': 'error', 'error': repr(error)})
    result['elapsedMs'] = round((time.time() - started) * 1000, 1)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(run, manifest['plans']))
results.sort(key=lambda x: x['key'])
summary = {
    'vectorizer': str(vectorizer), 'vectorizerSha256': sha256(vectorizer),
    'python': str(python), 'plans': len(results), 'ok': sum(r['status'] == 'ok' for r in results),
    'errors': [r for r in results if r['status'] != 'ok'], 'results': results,
}
(ROOT / 'vectorize-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
if summary['errors']:
    raise SystemExit(1)
print(json.dumps({'plans': len(results), 'ok': summary['ok'], 'vectorizerSha256': summary['vectorizerSha256']}))
