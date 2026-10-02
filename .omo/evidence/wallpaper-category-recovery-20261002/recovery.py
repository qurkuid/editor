#!/usr/bin/env python3
import argparse
import copy
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import stat
import sys
import tempfile


ROOT_DEFAULT = "/Volumes/DATABASE/macodi-material-clone"
INDEX_DEFAULT = "/Volumes/DATABASE/apt-data/rawpainter-index.json"
ORIGINAL_UPDATER_SHA = "aa3c5b558722984eee10f39bc089c6bff165d1a6dbcfe3ee70184bea364debf3"
TESTED_PATCHED_UPDATER_SHA = "cac4f87635e6801ac6c6916c5c836c92588c995e113b139f8a5c9cb46cfc79da"

WALLPAPER_CATEGORY_ID = 108
WALLPAPER_CATEGORY_NAME = "벽지"
LX_BRAND = "LX Z:IN(LX지인)"
SEOUL_BRAND = "서울벽지"
TARGET_BRANDS = frozenset((LX_BRAND, SEOUL_BRAND))
TARGET_IDS = (
    -139, -432, -436, -431, -444, -150, -443, -127, -131, -132,
    -146, -124, -149, -439, -446, -426, -437, -129, -428, -438,
    -147, -135, -447, -126, -151, -441, -138, -448, -142, -434,
    -424, -452, -143, -136, -140, -435, -449, -427, -152, -123,
    -128, -144, -134, -429, -145, -130, -148, -133, -450, -141,
    -442, -125, -451, -445, -137, -425, -453, -440, -433, -430,
)
TARGET_ID_SET = frozenset(TARGET_IDS)
if len(TARGET_IDS) != 60 or len(TARGET_ID_SET) != 60:
    raise RuntimeError("target manifest must contain 60 unique IDs")


class RecoveryError(RuntimeError):
    pass


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def canonical_hash(value):
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RecoveryError("duplicate JSON key: {}".format(key))
        result[key] = value
    return result


def read_json(path):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle, object_pairs_hook=reject_duplicate_keys)
    except (OSError, ValueError) as error:
        raise RecoveryError("cannot parse {}: {}".format(path, error)) from error


def read_ndjson(path):
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise RecoveryError("cannot read {}: {}".format(path, error)) from error
    records = []
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            records.append(
                json.loads(line, object_pairs_hook=reject_duplicate_keys)
            )
        except ValueError as error:
            raise RecoveryError(
                "invalid NDJSON {} line {}: {}".format(path, line_number, error)
            ) from error
    return records


def fsync_directory(path):
    descriptor = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_bytes(path, content, mode=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix="." + path.name + ".", dir=str(path.parent)
    )
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        if mode is not None:
            os.chmod(temporary, mode)
        os.replace(temporary, path)
        fsync_directory(path.parent)
    except Exception:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise


def atomic_json(path, value):
    atomic_bytes(
        path,
        (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        mode=stat.S_IMODE(path.stat().st_mode) if path.exists() else None,
    )


def parse_id(value, label):
    if isinstance(value, bool):
        raise RecoveryError("{} has boolean id".format(label))
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise RecoveryError("{} has invalid id {!r}".format(label, value)) from error
    if isinstance(value, str) and str(parsed) != value:
        raise RecoveryError("{} has non-canonical id {!r}".format(label, value))
    return parsed


def map_by_id(items, label):
    if not isinstance(items, list):
        raise RecoveryError("{} must be a list".format(label))
    mapped = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise RecoveryError("{}[{}] must be an object".format(label, index))
        product_id = parse_id(item.get("id"), "{}[{}]".format(label, index))
        if product_id in mapped:
            raise RecoveryError("{} duplicates id {}".format(label, product_id))
        mapped[product_id] = item
    return mapped


def without_list_category(value):
    result = copy.deepcopy(value)
    if isinstance(result, dict) and isinstance(result.get("list"), dict):
        result["list"].pop("categoryId", None)
    return result


def without_category_id(value):
    result = copy.deepcopy(value)
    if isinstance(result, dict):
        result.pop("categoryId", None)
    return result


def category_value_is_allowed(value):
    return value is None or (type(value) is int and value == WALLPAPER_CATEGORY_ID)


def brand_group(brand):
    if brand == LX_BRAND:
        return "lx"
    if brand == SEOUL_BRAND:
        return "seoul"
    return None


def paths_for(root, index_path):
    catalog = root / "catalog"
    products = catalog / "products"
    state = root / "state"
    return {
        "categories": catalog / "categories.json",
        "products_list": catalog / "products-list.json",
        "ndjson": catalog / "products.ndjson",
        "products_dir": products,
        "sqlite": catalog / "materials.sqlite3",
        "state": state / "state.json",
        "lock": state / "sync.lock",
        "index": index_path,
    }


def sqlite_snapshot(path):
    if not path.is_file():
        raise RecoveryError("missing SQLite file {}".format(path))
    try:
        connection = sqlite3.connect(str(path))
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(materials)")
        }
        required = {"id", "category_id", "list_json", "detail_json", "assets_json"}
        if not required.issubset(columns):
            raise RecoveryError("materials table is missing required columns")
        category_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(categories)")
        }
        if not {"id", "name"}.issubset(category_columns):
            raise RecoveryError("categories table is missing id/name")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if not integrity or integrity[0] != "ok":
            raise RecoveryError("SQLite integrity_check failed: {}".format(integrity))
        rows = {}
        for product_id in TARGET_IDS:
            row = connection.execute(
                "SELECT id, category_id, list_json, detail_json, assets_json "
                "FROM materials WHERE id = ?",
                (product_id,),
            ).fetchone()
            if row is None:
                raise RecoveryError("SQLite is missing target id {}".format(product_id))
            rows[product_id] = {
                "id": row[0],
                "category_id": row[1],
                "list_json": row[2],
                "detail_json": row[3],
                "assets_json": row[4],
            }
        return rows
    except sqlite3.Error as error:
        raise RecoveryError("cannot inspect SQLite {}: {}".format(path, error)) from error
    finally:
        try:
            connection.close()
        except UnboundLocalError:
            pass


def load_snapshot(root, index_path):
    paths = paths_for(root, index_path)
    required = (
        paths["categories"],
        paths["products_list"],
        paths["ndjson"],
        paths["sqlite"],
        paths["state"],
        paths["index"],
    )
    for path in required:
        if not path.is_file():
            raise RecoveryError("missing required file {}".format(path))
    categories_wrapper = read_json(paths["categories"])
    products_wrapper = read_json(paths["products_list"])
    state = read_json(paths["state"])
    index = read_json(paths["index"])
    if not isinstance(categories_wrapper, dict) or not isinstance(
        categories_wrapper.get("categories"), list
    ):
        raise RecoveryError("categories.json must contain a categories list")
    if not isinstance(products_wrapper, dict) or not isinstance(
        products_wrapper.get("products"), list
    ):
        raise RecoveryError("products-list.json must contain a products list")
    if not isinstance(state, dict) or not isinstance(state.get("products"), dict):
        raise RecoveryError("state.json must contain a products object")
    if not isinstance(index, dict) or not isinstance(index.get("products"), list):
        raise RecoveryError("rawpainter index must contain a products list")
    products = products_wrapper["products"]
    ndjson_records = read_ndjson(paths["ndjson"])
    product_map = map_by_id(products, "products-list.products")
    ndjson_map = map_by_id(ndjson_records, "products.ndjson")
    index_map = map_by_id(index["products"], "rawpainter-index.products")
    records = {}
    for product_id in TARGET_IDS:
        record_path = paths["products_dir"] / (str(product_id) + ".json")
        if not record_path.is_file():
            raise RecoveryError("missing target record {}".format(record_path))
        record = read_json(record_path)
        if not isinstance(record, dict):
            raise RecoveryError("target record {} must be an object".format(product_id))
        records[product_id] = record
    return {
        "paths": paths,
        "categories_wrapper": categories_wrapper,
        "products_wrapper": products_wrapper,
        "products": products,
        "ndjson_records": ndjson_records,
        "product_map": product_map,
        "ndjson_map": ndjson_map,
        "index": index,
        "index_map": index_map,
        "records": records,
        "state": state,
        "sqlite_rows": sqlite_snapshot(paths["sqlite"]),
    }


def validate_snapshot(snapshot, require_repaired=False):
    categories = snapshot["categories_wrapper"]["categories"]
    wallpaper_categories = [
        category
        for category in categories
        if isinstance(category, dict) and category.get("name") == WALLPAPER_CATEGORY_NAME
    ]
    if len(wallpaper_categories) != 1:
        raise RecoveryError(
            "expected one category named 벽지, found {}".format(len(wallpaper_categories))
        )
    if wallpaper_categories[0].get("id") != WALLPAPER_CATEGORY_ID:
        raise RecoveryError(
            "category 벽지 must have id {}".format(WALLPAPER_CATEGORY_ID)
        )
    if len(snapshot["product_map"]) != len(snapshot["products"]):
        raise RecoveryError("products-list contains duplicate IDs")
    if len(snapshot["ndjson_map"]) != len(snapshot["ndjson_records"]):
        raise RecoveryError("products.ndjson contains duplicate IDs")
    if len(snapshot["index_map"]) != len(snapshot["index"]["products"]):
        raise RecoveryError("rawpainter index contains duplicate IDs")
    groups = {"lx": [], "seoul": []}
    for product_id in TARGET_IDS:
        record = snapshot["records"][product_id]
        product = record.get("list")
        detail = record.get("detail")
        assets = record.get("assets")
        if parse_id(record.get("id"), "record {}".format(product_id)) != product_id:
            raise RecoveryError("record id mismatch for {}".format(product_id))
        if not isinstance(product, dict):
            raise RecoveryError("record.list missing for {}".format(product_id))
        if not isinstance(detail, dict) or not isinstance(assets, dict):
            raise RecoveryError("record detail/assets missing for {}".format(product_id))
        if parse_id(product.get("id"), "record.list {}".format(product_id)) != product_id:
            raise RecoveryError("record.list id mismatch for {}".format(product_id))
        if product.get("category") != WALLPAPER_CATEGORY_NAME:
            raise RecoveryError("target {} is not category 벽지".format(product_id))
        if not category_value_is_allowed(product.get("categoryId")):
            raise RecoveryError(
                "target {} has unexpected list categoryId {!r}".format(
                    product_id, product.get("categoryId")
                )
            )
        group = brand_group(product.get("brand"))
        if group is None:
            raise RecoveryError("target {} has unexpected brand {!r}".format(product_id, product.get("brand")))
        groups[group].append(product_id)
        detail_category = detail.get("categoryId")
        if (
            isinstance(detail_category, int)
            and not isinstance(detail_category, bool)
            and detail_category > 0
            and detail_category != WALLPAPER_CATEGORY_ID
        ):
            raise RecoveryError(
                "target {} has conflicting positive detail categoryId {}".format(
                    product_id, detail_category
                )
            )
        exported = snapshot["product_map"].get(product_id)
        ndjson = snapshot["ndjson_map"].get(product_id)
        index = snapshot["index_map"].get(product_id)
        if exported is None or ndjson is None or index is None:
            raise RecoveryError("target {} is missing from an export".format(product_id))
        if not category_value_is_allowed(exported.get("categoryId")):
            raise RecoveryError("exported target {} has unexpected categoryId".format(product_id))
        if not category_value_is_allowed(ndjson.get("list", {}).get("categoryId")):
            raise RecoveryError("NDJSON target {} has unexpected categoryId".format(product_id))
        if not category_value_is_allowed(index.get("categoryId")):
            raise RecoveryError("index target {} has unexpected categoryId".format(product_id))
        exported_without_metadata = without_category_id(exported)
        exported_without_metadata.pop("cloneAssetKinds", None)
        if exported_without_metadata != without_category_id(product):
            raise RecoveryError("products-list mismatch for {}".format(product_id))
        if exported.get("cloneAssetKinds") is not None:
            expected_asset_kinds = sorted(assets.keys())
            if exported["cloneAssetKinds"] != expected_asset_kinds:
                raise RecoveryError("cloneAssetKinds mismatch for {}".format(product_id))
        if without_list_category(ndjson) != without_list_category(record):
            raise RecoveryError("NDJSON mismatch for {}".format(product_id))
        index_without_metadata = without_category_id(index)
        index_without_metadata.pop("cloneAssetKinds", None)
        if index_without_metadata != without_category_id(product):
            raise RecoveryError("rawpainter index mismatch for {}".format(product_id))
        state_entry = snapshot["state"]["products"].get(str(product_id))
        if not isinstance(state_entry, dict):
            raise RecoveryError("state is missing target {}".format(product_id))
        old_hash = canonical_hash(product)
        repaired_product = copy.deepcopy(product)
        repaired_product["categoryId"] = WALLPAPER_CATEGORY_ID
        repaired_hash = canonical_hash(repaired_product)
        if state_entry.get("list_hash") not in (old_hash, repaired_hash):
            raise RecoveryError("state list_hash mismatch for {}".format(product_id))
        detail_hash = state_entry.get("detail_hash")
        if detail_hash is not None and detail_hash != canonical_hash(detail):
            raise RecoveryError("state detail_hash mismatch for {}".format(product_id))
        sqlite_row = snapshot["sqlite_rows"][product_id]
        if sqlite_row["category_id"] not in (None, WALLPAPER_CATEGORY_ID):
            raise RecoveryError(
                "SQLite category_id conflict for {}: {!r}".format(
                    product_id, sqlite_row["category_id"]
                )
            )
        try:
            db_list = json.loads(
                sqlite_row["list_json"], object_pairs_hook=reject_duplicate_keys
            )
            db_detail = json.loads(
                sqlite_row["detail_json"], object_pairs_hook=reject_duplicate_keys
            )
            db_assets = json.loads(
                sqlite_row["assets_json"], object_pairs_hook=reject_duplicate_keys
            )
        except (TypeError, ValueError) as error:
            raise RecoveryError("SQLite JSON is invalid for {}".format(product_id)) from error
        if without_category_id(db_list) != without_category_id(product):
            raise RecoveryError("SQLite list_json mismatch for {}".format(product_id))
        if not category_value_is_allowed(db_list.get("categoryId")):
            raise RecoveryError("SQLite list_json target {} has unexpected categoryId".format(product_id))
        if db_detail != detail or db_assets != assets:
            raise RecoveryError("SQLite protected JSON mismatch for {}".format(product_id))
        if require_repaired:
            if product.get("categoryId") != WALLPAPER_CATEGORY_ID:
                raise RecoveryError("target {} was not repaired".format(product_id))
            if exported.get("categoryId") != WALLPAPER_CATEGORY_ID:
                raise RecoveryError("exported target {} was not repaired".format(product_id))
            if ndjson.get("list", {}).get("categoryId") != WALLPAPER_CATEGORY_ID:
                raise RecoveryError("NDJSON target {} was not repaired".format(product_id))
            if index.get("categoryId") != WALLPAPER_CATEGORY_ID:
                raise RecoveryError("index target {} was not repaired".format(product_id))
            if state_entry.get("list_hash") != repaired_hash:
                raise RecoveryError("state target {} hash was not repaired".format(product_id))
            if sqlite_row["category_id"] != WALLPAPER_CATEGORY_ID:
                raise RecoveryError("SQLite target {} was not repaired".format(product_id))
            if db_list.get("categoryId") != WALLPAPER_CATEGORY_ID:
                raise RecoveryError("SQLite list_json target {} was not repaired".format(product_id))
    if len(groups["lx"]) != 30 or len(groups["seoul"]) != 30:
        raise RecoveryError(
            "target brand partition must be LX 30 and 서울벽지 30, got {} and {}".format(
                len(groups["lx"]), len(groups["seoul"])
            )
        )
    if set(snapshot["state"]["products"]) & {str(product_id) for product_id in TARGET_IDS} != {
        str(product_id) for product_id in TARGET_IDS
    }:
        raise RecoveryError("state target membership mismatch")
    if not isinstance(snapshot["index"].get("builtAt"), (int, float)):
        raise RecoveryError("rawpainter index builtAt is invalid")
    return {"brand_counts": {"LX Z:IN(LX지인)": 30, "서울벽지": 30}}


def repaired_snapshot(snapshot):
    after = copy.deepcopy(snapshot)
    for product_id in TARGET_IDS:
        after["records"][product_id]["list"]["categoryId"] = WALLPAPER_CATEGORY_ID
    for item in after["products"]:
        if parse_id(item.get("id"), "products-list") in TARGET_ID_SET:
            item["categoryId"] = WALLPAPER_CATEGORY_ID
    for record in after["ndjson_records"]:
        if parse_id(record.get("id"), "products.ndjson") in TARGET_ID_SET:
            record["list"]["categoryId"] = WALLPAPER_CATEGORY_ID
    for item in after["index"]["products"]:
        if parse_id(item.get("id"), "rawpainter-index") in TARGET_ID_SET:
            item["categoryId"] = WALLPAPER_CATEGORY_ID
    for product_id in TARGET_IDS:
        product = after["records"][product_id]["list"]
        after["state"]["products"][str(product_id)]["list_hash"] = canonical_hash(product)
        row = after["sqlite_rows"][product_id]
        db_list = json.loads(row["list_json"], object_pairs_hook=reject_duplicate_keys)
        db_list["categoryId"] = WALLPAPER_CATEGORY_ID
        row["list_json"] = json.dumps(
            db_list, ensure_ascii=False, separators=(",", ":")
        )
        row["category_id"] = WALLPAPER_CATEGORY_ID
    return after


def assert_allowed_changes(before, after):
    if before["categories_wrapper"] != after["categories_wrapper"]:
        raise RecoveryError("categories changed")
    if before["index"].get("builtAt") != after["index"].get("builtAt"):
        raise RecoveryError("index builtAt changed")
    for left, right in zip(before["products"], after["products"]):
        product_id = parse_id(left.get("id"), "products-list")
        if product_id in TARGET_ID_SET:
            if without_category_id(left) != without_category_id(right):
                raise RecoveryError("products-list changed beyond categoryId")
        elif left != right:
            raise RecoveryError("unrelated products-list entry changed")
    for left, right in zip(before["ndjson_records"], after["ndjson_records"]):
        product_id = parse_id(left.get("id"), "products.ndjson")
        if product_id in TARGET_ID_SET:
            if without_list_category(left) != without_list_category(right):
                raise RecoveryError("NDJSON changed beyond list.categoryId")
        elif left != right:
            raise RecoveryError("unrelated NDJSON entry changed")
    for product_id in TARGET_IDS:
        if without_list_category(before["records"][product_id]) != without_list_category(
            after["records"][product_id]
        ):
            raise RecoveryError("record {} changed beyond list.categoryId".format(product_id))
    for left, right in zip(before["index"]["products"], after["index"]["products"]):
        product_id = parse_id(left.get("id"), "rawpainter-index")
        if product_id in TARGET_ID_SET:
            if without_category_id(left) != without_category_id(right):
                raise RecoveryError("index changed beyond categoryId")
        elif left != right:
            raise RecoveryError("unrelated index entry changed")
    for product_id, left in before["state"]["products"].items():
        right = after["state"]["products"].get(product_id)
        if int(product_id) in TARGET_ID_SET:
            left_copy = copy.deepcopy(left)
            right_copy = copy.deepcopy(right)
            left_copy.pop("list_hash", None)
            right_copy.pop("list_hash", None)
            if left_copy != right_copy:
                raise RecoveryError("state {} changed beyond list_hash".format(product_id))
        elif left != right:
            raise RecoveryError("unrelated state entry {} changed".format(product_id))
    for product_id in TARGET_IDS:
        left = before["sqlite_rows"][product_id]
        right = after["sqlite_rows"][product_id]
        for key in ("id", "detail_json", "assets_json"):
            if left[key] != right[key]:
                raise RecoveryError("SQLite {} changed {}".format(product_id, key))
        left_list = json.loads(left["list_json"], object_pairs_hook=reject_duplicate_keys)
        right_list = json.loads(right["list_json"], object_pairs_hook=reject_duplicate_keys)
        if without_category_id(left_list) != without_category_id(right_list):
            raise RecoveryError("SQLite {} changed list_json beyond categoryId".format(product_id))


def updater_identity(path):
    if not path.is_file():
        raise RecoveryError("missing updater {}".format(path))
    content = path.read_text(encoding="utf-8")
    required = ("class MaterialClone", "def fetch_products", "def sync_products", "def write_exports")
    if any(marker not in content for marker in required):
        raise RecoveryError("updater role check failed for {}".format(path))
    digest = sha256_file(path)
    adjacent = pathlib.Path(__file__).with_name("sync-patched.py")
    accepted = {ORIGINAL_UPDATER_SHA}
    if TESTED_PATCHED_UPDATER_SHA:
        accepted.add(TESTED_PATCHED_UPDATER_SHA)
    if adjacent.is_file():
        accepted.add(sha256_file(adjacent))
    if digest not in accepted:
        raise RecoveryError(
            "unexpected updater SHA {} for {} (expected original or tested patched)".format(
                digest, path
            )
        )
    return digest


def copy_sqlite_backup(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_connection = sqlite3.connect(str(source))
    destination_connection = sqlite3.connect(str(destination))
    try:
        source_connection.backup(destination_connection)
        destination_connection.commit()
        integrity = destination_connection.execute("PRAGMA integrity_check").fetchone()
        if not integrity or integrity[0] != "ok":
            raise RecoveryError("SQLite backup integrity_check failed")
    finally:
        destination_connection.close()
        source_connection.close()


def backup_snapshot(snapshot, updater_paths):
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = snapshot["paths"]["state"] .parent / "wallpaper-category-recovery" / stamp
    suffix = 0
    while backup_root.exists():
        suffix += 1
        backup_root = backup_root.with_name(stamp + "-" + str(suffix))
    backup_root.mkdir(parents=True)
    entries = []

    sources = [
        ("catalog/categories.json", snapshot["paths"]["categories"]),
        ("catalog/products-list.json", snapshot["paths"]["products_list"]),
        ("catalog/products.ndjson", snapshot["paths"]["ndjson"]),
        ("catalog/materials.sqlite3", snapshot["paths"]["sqlite"]),
        ("state/state.json", snapshot["paths"]["state"]),
        ("index/rawpainter-index.json", snapshot["paths"]["index"]),
    ]
    sources.extend(
        (
            "catalog/products/{}.json".format(product_id),
            snapshot["paths"]["products_dir"] / (str(product_id) + ".json"),
        )
        for product_id in TARGET_IDS
    )
    sources.extend(
        ("updaters/{}.py".format(index), path)
        for index, path in enumerate(updater_paths)
    )
    for relative, source in sources:
        if not source.is_file():
            raise RecoveryError("backup source is missing {}".format(source))
        destination = backup_root / relative
        if relative.endswith("materials.sqlite3"):
            copy_sqlite_backup(source, destination)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        entries.append(
            {
                "source": str(source),
                "backup": relative,
                "sha256": sha256_file(destination),
                "bytes": destination.stat().st_size,
            }
        )
    manifest = {
        "created_at": utc_now(),
        "root": str(snapshot["paths"]["categories"].parents[1]),
        "index": str(snapshot["paths"]["index"]),
        "target_ids": list(TARGET_IDS),
        "files": entries,
    }
    atomic_json(backup_root / "target-ids.json", {
        "target_ids": list(TARGET_IDS),
        "brands": {"LX Z:IN(LX지인)": 30, "서울벽지": 30},
    })
    atomic_json(backup_root / "backup-manifest.json", manifest)
    return backup_root, manifest


def restore_backup(backup_root, manifest):
    for entry in manifest["files"]:
        source = pathlib.Path(entry["source"])
        backup = backup_root / entry["backup"]
        if not backup.is_file():
            raise RecoveryError("rollback backup missing {}".format(backup))
        if sha256_file(backup) != entry["sha256"]:
            raise RecoveryError("rollback backup hash changed {}".format(backup))
        source.parent.mkdir(parents=True, exist_ok=True)
        atomic_bytes(source, backup.read_bytes(), mode=stat.S_IMODE(backup.stat().st_mode))
        if sha256_file(source) != entry["sha256"]:
            raise RecoveryError("rollback source hash mismatch {}".format(source))


def write_if_changed(path, before, after, serializer):
    if before == after:
        return False
    atomic_bytes(
        path,
        serializer(after),
        mode=stat.S_IMODE(path.stat().st_mode) if path.exists() else None,
    )
    return True


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def ndjson_bytes(records):
    return "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        for record in records
    ).encode("utf-8")


def write_sqlite_if_changed(path, before_rows, after_rows):
    changes = [
        product_id
        for product_id in TARGET_IDS
        if before_rows[product_id] != after_rows[product_id]
    ]
    if not changes:
        return False
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".materials.sqlite3.", dir=str(path.parent)
    )
    os.close(descriptor)
    temporary = pathlib.Path(temporary_name)
    try:
        shutil.copy2(path, temporary)
        connection = sqlite3.connect(str(temporary))
        try:
            connection.execute("BEGIN IMMEDIATE")
            for product_id in changes:
                row = after_rows[product_id]
                connection.execute(
                    "UPDATE materials SET category_id = ?, list_json = ? WHERE id = ?",
                    (row["category_id"], row["list_json"], product_id),
                )
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            if not integrity or integrity[0] != "ok":
                raise RecoveryError("staged SQLite integrity_check failed")
            connection.commit()
        finally:
            connection.close()
        os.replace(temporary, path)
        fsync_directory(path.parent)
    except Exception:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise
    return True


def install_updaters(updater_paths, patched_path):
    payload = patched_path.read_bytes()
    patched_hash = hashlib.sha256(payload).hexdigest()
    if TESTED_PATCHED_UPDATER_SHA and patched_hash != TESTED_PATCHED_UPDATER_SHA:
        raise RecoveryError("patched updater hash does not match tested patch")
    changed = []
    for path in updater_paths:
        current_hash = sha256_file(path)
        if current_hash == patched_hash:
            continue
        mode = stat.S_IMODE(path.stat().st_mode)
        atomic_bytes(path, payload, mode=mode)
        if sha256_file(path) != patched_hash:
            raise RecoveryError("updater replacement verification failed for {}".format(path))
        changed.append(str(path))
    return patched_hash, changed


def run(root, index_path, updater_paths, patched_path, apply):
    if len(updater_paths) not in (0, 2):
        raise RecoveryError("pass exactly two --updater paths")
    if apply and len(updater_paths) != 2:
        raise RecoveryError("--apply requires both deployed --updater paths")
    if apply and patched_path is None:
        raise RecoveryError("--apply requires --patched-updater")
    for updater in updater_paths:
        updater_identity(updater)
    if patched_path is not None:
        if not patched_path.is_file():
            raise RecoveryError("missing patched updater {}".format(patched_path))
        if "normalize_wallpaper_products" not in patched_path.read_text(encoding="utf-8"):
            raise RecoveryError("patched updater has no wallpaper normalizer")
    snapshot = load_snapshot(root, index_path)
    validate_snapshot(snapshot)
    lock_path = snapshot["paths"]["lock"]
    if not lock_path.parent.is_dir():
        raise RecoveryError("missing sync state directory {}".format(lock_path.parent))
    try:
        lock_handle = lock_path.open("a+")
    except OSError as error:
        raise RecoveryError("cannot open sync lock {}: {}".format(lock_path, error)) from error
    try:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RecoveryError("sync lock is held; no files changed") from error
        snapshot = load_snapshot(root, index_path)
        validate_snapshot(snapshot)
        summary = {
            "status": "preflight",
            "checked_at": utc_now(),
            "root": str(root),
            "index": str(index_path),
            "target_ids": list(TARGET_IDS),
            "brand_counts": {"LX Z:IN(LX지인)": 30, "서울벽지": 30},
            "updater_hashes": [sha256_file(path) for path in updater_paths],
            "repaired": False,
        }
        if not apply:
            return summary
        after = repaired_snapshot(snapshot)
        assert_allowed_changes(snapshot, after)
        validate_snapshot(after, require_repaired=True)
        backup_root, backup_manifest = backup_snapshot(snapshot, updater_paths)
        try:
            changed = []
            changed += [
                str(path)
                for path, before, value in (
                    (
                        snapshot["paths"]["products_list"],
                        snapshot["products_wrapper"],
                        after["products_wrapper"],
                    ),
                    (
                        snapshot["paths"]["state"],
                        snapshot["state"],
                        after["state"],
                    ),
                    (
                        snapshot["paths"]["index"],
                        snapshot["index"],
                        after["index"],
                    ),
                )
                if write_if_changed(path, before, value, json_bytes)
            ]
            for product_id in TARGET_IDS:
                before = snapshot["records"][product_id]
                value = after["records"][product_id]
                if write_if_changed(
                    snapshot["paths"]["products_dir"] / (str(product_id) + ".json"),
                    before,
                    value,
                    json_bytes,
                ):
                    changed.append(str(snapshot["paths"]["products_dir"] / (str(product_id) + ".json")))
            if write_if_changed(
                snapshot["paths"]["ndjson"],
                snapshot["ndjson_records"],
                after["ndjson_records"],
                ndjson_bytes,
            ):
                changed.append(str(snapshot["paths"]["ndjson"]))
            if write_sqlite_if_changed(
                snapshot["paths"]["sqlite"],
                snapshot["sqlite_rows"],
                after["sqlite_rows"],
            ):
                changed.append(str(snapshot["paths"]["sqlite"]))
            patched_hash, updater_changes = install_updaters(updater_paths, patched_path)
            changed.extend(updater_changes)
            final_snapshot = load_snapshot(root, index_path)
            validate_snapshot(final_snapshot, require_repaired=True)
            summary.update(
                {
                    "status": "applied",
                    "repaired": True,
                    "backup_dir": str(backup_root),
                    "changed_files": changed,
                    "patched_updater_sha": patched_hash,
                    "updater_hashes": [sha256_file(path) for path in updater_paths],
                    "backup_files": len(backup_manifest["files"]),
                }
            )
            return summary
        except Exception:
            restore_backup(backup_root, backup_manifest)
            raise
    finally:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
        finally:
            lock_handle.close()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Guarded wallpaper category repair")
    parser.add_argument("--root", default=ROOT_DEFAULT)
    parser.add_argument("--index", default=INDEX_DEFAULT)
    parser.add_argument("--updater", action="append", default=[])
    parser.add_argument("--patched-updater")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    patched_path = pathlib.Path(args.patched_updater) if args.patched_updater else None
    try:
        summary = run(
            pathlib.Path(args.root),
            pathlib.Path(args.index),
            [pathlib.Path(path) for path in args.updater],
            patched_path,
            args.apply,
        )
    except RecoveryError as error:
        print(json.dumps({"status": "blocked", "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
