#!/usr/bin/env python3
import copy
import importlib.util
import json
import os
import pathlib
import shutil
import sqlite3
import stat
import sys
import tempfile
import types


HERE = pathlib.Path(__file__).parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sync = load_module("sync_patched", HERE / "sync-patched.py")
recovery = load_module("recovery", HERE / "recovery.py")


def normalizer_test():
    categories = [{"id": 108, "name": "벽지"}]
    products = [
        {"id": -1, "category": "벽지", "brand": "LX Z:IN(LX지인)"},
        {"id": -2, "category": "벽지", "brand": "서울벽지", "categoryId": None},
        {"id": -3, "category": "벽지", "brand": "other"},
        {"id": -4, "category": "타일", "brand": "LX Z:IN(LX지인)"},
        {"id": 5, "category": "벽지", "brand": "서울벽지"},
        {"id": -6, "category": "벽지", "brand": "서울벽지", "categoryId": 999},
    ]
    sync.normalize_wallpaper_products(products, categories)
    assert products[0]["categoryId"] == 108
    assert products[1]["categoryId"] == 108
    assert "categoryId" not in products[2]
    assert "categoryId" not in products[3]
    assert "categoryId" not in products[4]
    assert products[5]["categoryId"] == 999
    for invalid in (
        [],
        [{"id": 108, "name": "벽지"}, {"id": 109, "name": "벽지"}],
        [{"id": 109, "name": "벽지"}],
    ):
        try:
            sync.normalize_wallpaper_products([], invalid)
        except RuntimeError:
            pass
        else:
            raise AssertionError("invalid wallpaper category was accepted")
    return {"normalized": 2, "guards": 3}


def mocked_sync_export_test(root):
    products = [
        {"id": -1, "category": "벽지", "brand": "LX Z:IN(LX지인)", "name": "LX"},
        {"id": -2, "category": "벽지", "brand": "서울벽지", "name": "Seoul"},
    ]
    categories = [{"id": 108, "name": "벽지", "productCount": 2}]

    class StubClient:
        def __init__(self):
            self.detail_calls = 0

        def post(self, endpoint, payload):
            if endpoint == "/category/filter":
                return categories
            if endpoint == "/product":
                return {"products": copy.deepcopy(products), "total": len(products)}
            if endpoint == "/product/mytexture/detail":
                self.detail_calls += 1
                return {"name": "detail-" + str(payload["id"]), "category": "벽지"}
            raise AssertionError("unexpected endpoint {}".format(endpoint))

        def download(self, url):
            raise AssertionError("fixture should not download assets")

    volume = root / "volume"
    volume.mkdir(parents=True)
    args = types.SimpleNamespace(
        root=str(root / "clone"),
        required_volume=str(volume),
        workers=1,
        timeout=1,
        retries=1,
        detail_max_age_days=7,
        limit=0,
        force=False,
    )
    client = StubClient()
    clone = sync.MaterialClone(args)
    clone.client = client
    assert clone.run() == 0
    first_detail_calls = client.detail_calls
    assert first_detail_calls == 2
    for product_id in (-1, -2):
        record = json.loads(
            (root / "clone" / "catalog" / "products" / (str(product_id) + ".json")).read_text()
        )
        assert record["list"]["categoryId"] == 108
    state = json.loads((root / "clone" / "state" / "state.json").read_text())
    assert state["products"]["-1"]["list_hash"] == sync.canonical_hash(
        json.loads(
            (root / "clone" / "catalog" / "products" / "-1.json").read_text()
        )["list"]
    )
    connection = sqlite3.connect(str(root / "clone" / "catalog" / "materials.sqlite3"))
    try:
        assert connection.execute(
            "SELECT category_id FROM materials WHERE id = -1"
        ).fetchone()[0] == 108
    finally:
        connection.close()

    second = sync.MaterialClone(args)
    second.client = client
    assert second.run() == 0
    assert client.detail_calls == first_detail_calls
    return {"first_detail_calls": first_detail_calls, "second_detail_calls": 0}


def write_fixture(root, index_path):
    catalog = root / "catalog"
    products_dir = catalog / "products"
    state_dir = root / "state"
    products_dir.mkdir(parents=True)
    state_dir.mkdir()
    target_products = []
    target_records = []
    state_products = {}
    for position, product_id in enumerate(recovery.TARGET_IDS):
        brand = recovery.LX_BRAND if position < 30 else recovery.SEOUL_BRAND
        product = {
            "id": product_id,
            "category": "벽지",
            "brand": brand,
            "name": "fixture-" + str(product_id),
            "subCategory": "합지",
            "price": 1000 + position,
        }
        detail = {"name": product["name"], "code": "F{}".format(abs(product_id))}
        assets = {"original": {"url": "https://example.test/{}.jpg".format(product_id)}}
        record = {
            "id": product_id,
            "active": True,
            "list": product,
            "detail": detail,
            "assets": assets,
            "first_cloned_at": "2026-10-01T00:00:00+00:00",
            "last_seen_at": "2026-10-01T00:00:00+00:00",
            "detail_checked_at": "2026-10-01T00:00:00+00:00",
        }
        target_products.append(dict(product, cloneAssetKinds=["original"]))
        target_records.append(record)
        state_products[str(product_id)] = {
            "active": True,
            "list_hash": recovery.canonical_hash(product),
            "detail_hash": recovery.canonical_hash(detail),
            "first_cloned_at": record["first_cloned_at"],
            "last_seen_at": record["last_seen_at"],
            "detail_checked_at": record["detail_checked_at"],
            "assets": assets,
        }
        (products_dir / (str(product_id) + ".json")).write_text(
            json.dumps(record, ensure_ascii=False, indent=2) + "\n"
        )
    unrelated = {
        "id": -999,
        "category": "타일",
        "brand": "other",
        "name": "unrelated",
        "categoryId": 7,
    }
    unrelated_detail = {"name": "unrelated-detail"}
    unrelated_assets = {}
    unrelated_record = {
        "id": -999,
        "active": True,
        "list": unrelated,
        "detail": unrelated_detail,
        "assets": unrelated_assets,
        "first_cloned_at": "2026-10-01T00:00:00+00:00",
        "last_seen_at": "2026-10-01T00:00:00+00:00",
        "detail_checked_at": "2026-10-01T00:00:00+00:00",
    }
    target_products.append(dict(unrelated, cloneAssetKinds=[]))
    target_records.append(unrelated_record)
    state_products["-999"] = {
        "active": True,
        "list_hash": recovery.canonical_hash(unrelated),
        "detail_hash": recovery.canonical_hash(unrelated_detail),
        "first_cloned_at": unrelated_record["first_cloned_at"],
        "last_seen_at": unrelated_record["last_seen_at"],
        "detail_checked_at": unrelated_record["detail_checked_at"],
        "assets": {},
    }
    categories = {"cloned_at": "2026-10-01T00:00:00+00:00", "count": 1, "categories": [
        {"id": 108, "name": "벽지", "productCount": 60},
    ]}
    (catalog / "categories.json").write_text(
        json.dumps(categories, ensure_ascii=False, indent=2) + "\n"
    )
    products_wrapper = {
        "cloned_at": "2026-10-01T00:00:00+00:00",
        "count": len(target_products),
        "products": target_products,
    }
    (catalog / "products-list.json").write_text(
        json.dumps(products_wrapper, ensure_ascii=False, indent=2) + "\n"
    )
    (catalog / "products.ndjson").write_text(
        "".join(
            json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
            for record in target_records
        )
    )
    state = {
        "version": 1,
        "products": state_products,
        "last_completed_at": "2026-10-01T00:00:00+00:00",
    }
    (state_dir / "state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    )
    index_path.parent.mkdir(parents=True)
    index_path.write_text(
        json.dumps(
            {
                "builtAt": 123,
                "products": [record["list"] for record in target_records],
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n"
    )
    database = sqlite3.connect(str(catalog / "materials.sqlite3"))
    try:
        database.executescript(
            "CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, product_count INTEGER, raw_json TEXT NOT NULL);"
            "CREATE TABLE materials (id INTEGER PRIMARY KEY, active INTEGER NOT NULL, name TEXT, code TEXT, category TEXT, category_id INTEGER, sub_category TEXT, brand TEXT, origin TEXT, glossiness TEXT, size TEXT, design_price INTEGER, image_remote TEXT, image_local TEXT, first_cloned_at TEXT, last_seen_at TEXT, list_json TEXT NOT NULL, detail_json TEXT NOT NULL, assets_json TEXT NOT NULL);"
        )
        database.execute(
            "INSERT INTO categories VALUES(108,'벽지',60,?)",
            (json.dumps(categories["categories"][0], ensure_ascii=False),),
        )
        for record in target_records:
            product = record["list"]
            detail = record["detail"]
            assets = record["assets"]
            database.execute(
                "INSERT INTO materials VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    record["id"], 1, detail["name"], detail.get("code"),
                    product["category"], None, product.get("subCategory"),
                    product["brand"], None, None, None, None, None, None,
                    record["first_cloned_at"], record["last_seen_at"],
                    json.dumps(product, ensure_ascii=False),
                    json.dumps(detail, ensure_ascii=False),
                    json.dumps(assets, ensure_ascii=False),
                ),
            )
        database.commit()
        assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        database.close()


def recovery_test(tmp):
    root = tmp / "clone"
    index_path = tmp / "apt-data" / "rawpainter-index.json"
    write_fixture(root, index_path)
    updater_home = tmp / "updater-home.py"
    updater_mirror = tmp / "updater-mirror.py"
    patched = HERE / "sync-patched.py"
    shutil.copy2(patched, updater_home)
    shutil.copy2(patched, updater_mirror)
    os.chmod(updater_home, 0o750)
    os.chmod(updater_mirror, 0o750)
    checked = recovery.run(
        root, index_path, [updater_home, updater_mirror], patched, False
    )
    assert checked["status"] == "preflight"
    before = recovery.load_snapshot(root, index_path)
    protected = {
        product_id: (
            copy.deepcopy(before["records"][product_id]["detail"]),
            copy.deepcopy(before["records"][product_id]["assets"]),
        )
        for product_id in recovery.TARGET_IDS
    }
    lock = (root / "state" / "sync.lock").open("a+")
    import fcntl
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        try:
            recovery.run(
                root, index_path, [updater_home, updater_mirror], patched, False
            )
        except recovery.RecoveryError:
            pass
        else:
            raise AssertionError("held sync lock was accepted")
    finally:
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        lock.close()
    applied = recovery.run(
        root, index_path, [updater_home, updater_mirror], patched, True
    )
    assert applied["status"] == "applied"
    assert pathlib.Path(applied["backup_dir"]).is_dir()
    repaired = recovery.load_snapshot(root, index_path)
    recovery.validate_snapshot(repaired, require_repaired=True)
    for product_id, (detail, assets) in protected.items():
        assert repaired["records"][product_id]["detail"] == detail
        assert repaired["records"][product_id]["assets"] == assets
    second = recovery.run(
        root, index_path, [updater_home, updater_mirror], patched, True
    )
    assert second["changed_files"] == []
    index_bytes = index_path.read_bytes()
    broken = recovery.read_json(index_path)
    broken["products"][0]["categoryId"] = 999
    index_path.write_text(json.dumps(broken, ensure_ascii=False, indent=2) + "\n")
    try:
        try:
            recovery.run(
                root, index_path, [updater_home, updater_mirror], patched, False
            )
        except recovery.RecoveryError:
            pass
        else:
            raise AssertionError("changed index guard was accepted")
    finally:
        index_path.write_bytes(index_bytes)
    return {
        "preflight": checked["status"],
        "changed_files": len(applied["changed_files"]),
        "idempotent": second["changed_files"] == [],
        "lock_guard": True,
        "manifest_count": len(recovery.TARGET_IDS),
    }


def main():
    normalizer = normalizer_test()
    with tempfile.TemporaryDirectory(prefix="wallpaper-recovery-test-") as name:
        tmp = pathlib.Path(name)
        sync_result = mocked_sync_export_test(tmp / "sync")
        recovery_result = recovery_test(tmp / "recovery")
    print(json.dumps({
        "normalizer": normalizer,
        "sync_export": sync_result,
        "recovery": recovery_result,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
