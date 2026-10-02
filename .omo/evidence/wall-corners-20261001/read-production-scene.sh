/usr/local/bin/python3 - <<'PY'
import sqlite3,json,gzip,base64
from pathlib import Path
p=Path.home()/'.pascal/data/pascal.db'
with sqlite3.connect(f'file:{p}?mode=ro',uri=True) as db:
 row=db.execute('SELECT id,name,version,graph_json FROM scenes WHERE id=?',('8552ea8b9254',)).fetchone()
 assert row,'QA scene not found'
 raw=row[3]
 if raw.startswith('gzip:'):raw=gzip.decompress(base64.b64decode(raw[5:])).decode()
 print(json.dumps({'id':row[0],'name':row[1],'version':row[2],'graph':json.loads(raw)},ensure_ascii=False))
PY
