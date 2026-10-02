import json, pathlib, sqlite3, hashlib, sys
sys.path.insert(0, '/tmp/wallpaper-category-recovery-20261002-1746')
import recovery as r
root=pathlib.Path(r.ROOT_DEFAULT)
backup=root/'state/wallpaper-category-recovery/20261002T084614Z'
old=r.load_snapshot(backup, backup/'index/rawpainter-index.json')
new=r.load_snapshot(root, pathlib.Path(r.INDEX_DEFAULT))
r.assert_allowed_changes(old,new)
r.validate_snapshot(new,require_repaired=True)
for key in ('count','cloned_at'):
    assert old['products_wrapper'].get(key)==new['products_wrapper'].get(key)
old_db=sqlite3.connect(str(backup/'catalog/materials.sqlite3'))
new_db=sqlite3.connect(str(root/'catalog/materials.sqlite3'))
columns=[x[1] for x in old_db.execute('PRAGMA table_info(materials)')]
rows_old={row[0]:dict(zip(columns,row)) for row in old_db.execute('SELECT * FROM materials')}
rows_new={row[0]:dict(zip(columns,row)) for row in new_db.execute('SELECT * FROM materials')}
assert rows_old.keys()==rows_new.keys()
for pid,row in rows_old.items():
    current=rows_new[pid].copy()
    if pid in r.TARGET_ID_SET:
        current['category_id']=row['category_id']
        source_list=json.loads(row['list_json']); repaired_list=json.loads(current['list_json'])
        assert r.without_category_id(source_list)==r.without_category_id(repaired_list)
        current['list_json']=row['list_json']
    assert current==row,pid
assert list(old_db.execute('SELECT * FROM categories'))==list(new_db.execute('SELECT * FROM categories'))
assets=0
for record in new['records'].values():
    for asset in record['assets'].values():
        path=pathlib.Path(asset['path'])
        assert r.sha256_file(path)==asset['sha256'],path
        assets+=1
print(json.dumps({'targets':60,'allRowsPreserved':len(rows_old),'assetsVerified':assets,'indexBuiltAtPreserved':True,'sqliteIntegrity':new_db.execute('PRAGMA integrity_check').fetchone()[0],'unrelatedDataPreserved':True},indent=2))
