import argparse
import concurrent.futures
import datetime
import fcntl
import hashlib
import json
import logging
import math
import os
import pathlib
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


API_BASE = "https://api2.macodi.co.kr:8000"
CLIENT_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "INTM-Macodi-Material-Clone/1.0",
    "X-Client-Platform": "plugin",
}
ASSET_FIELDS = {
    "image": "original",
    "seamlessImage": "seamless",
    "detailImg": "detail",
    "pbrImage": "pbr",
    "zipUrl": "pbr_zip",
}


WALLPAPER_CATEGORY_ID = 108
WALLPAPER_CATEGORY_NAME = "벽지"
WALLPAPER_BRANDS = frozenset(("LX Z:IN(LX지인)", "서울벽지"))


def wallpaper_category_id(categories):
    matches = [
        category for category in categories
        if category.get("name") == WALLPAPER_CATEGORY_NAME
    ]
    if len(matches) != 1:
        raise RuntimeError(
            "expected one canonical wallpaper category named 벽지, found {}".format(len(matches))
        )
    category_id = matches[0].get("id")
    if category_id != WALLPAPER_CATEGORY_ID:
        raise RuntimeError(
            "wallpaper category id mismatch: expected {}, got {}".format(
                WALLPAPER_CATEGORY_ID, category_id
            )
        )
    return category_id


def normalize_wallpaper_products(products, categories):
    category_id = wallpaper_category_id(categories)
    repaired = 0
    for product in products:
        if product.get("categoryId") is not None:
            continue
        product_id = product.get("id")
        try:
            negative_id = int(product_id) < 0
        except (TypeError, ValueError):
            negative_id = False
        if (
            negative_id
            and product.get("category") == WALLPAPER_CATEGORY_NAME
            and product.get("brand") in WALLPAPER_BRANDS
        ):
            product["categoryId"] = category_id
            repaired += 1
    logging.info("normalized wallpaper products=%s category_id=%s", repaired, category_id)
    return products


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def canonical_hash(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
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


def atomic_bytes(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".part")
    with temporary.open("wb") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def atomic_json(path, value):
    atomic_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def load_json(path, fallback):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return fallback


class ApiClient:
    def __init__(self, timeout=60, retries=4):
        self.timeout = timeout
        self.retries = retries

    def post(self, endpoint, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(API_BASE + endpoint, data=body, headers=CLIENT_HEADERS, method="POST")
        return self._json_request(request)

    def download(self, url):
        parts = urllib.parse.urlsplit(url)
        encoded_url = urllib.parse.urlunsplit((
            parts.scheme,
            parts.netloc,
            urllib.parse.quote(parts.path, safe="/%:@"),
            urllib.parse.quote(parts.query, safe="%/:?&=+@,;$"),
            urllib.parse.quote(parts.fragment, safe="%/:?&=+@,;$"),
        ))
        request = urllib.request.Request(encoded_url, headers={"Accept": "*/*", "User-Agent": CLIENT_HEADERS["User-Agent"]})
        response, content = self._request(request)
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        return content, content_type

    def _json_request(self, request):
        _response, content = self._request(request)
        return json.loads(content.decode("utf-8"))

    def _request(self, request):
        failure = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return response, response.read()
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as error:
                failure = error
                if attempt + 1 >= self.retries:
                    break
                time.sleep(min(8, 0.75 * (2 ** attempt)))
        raise RuntimeError("request failed for {}: {}".format(request.full_url, failure))


def extension_for(url, content_type):
    suffix = pathlib.PurePosixPath(urllib.parse.urlparse(url).path).suffix.lower()
    allowed = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".zip"}
    if suffix in allowed:
        return suffix
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/tiff": ".tiff",
        "image/bmp": ".bmp",
        "application/zip": ".zip",
    }
    return mapping.get(content_type, ".bin")


def as_asset_url(value):
    if isinstance(value, str) and value.startswith(("https://", "http://")):
        return value
    if isinstance(value, dict):
        for key in ("url", "image", "src", "downloadUrl"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.startswith(("https://", "http://")):
                return candidate
    return ""


class MaterialClone:
    def __init__(self, args):
        self.args = args
        self.root = pathlib.Path(args.root)
        self.catalog_dir = self.root / "catalog"
        self.products_dir = self.catalog_dir / "products"
        self.assets_dir = self.root / "assets"
        self.state_dir = self.root / "state"
        self.logs_dir = self.root / "logs"
        self.state_path = self.state_dir / "state.json"
        self.client = ApiClient(timeout=args.timeout, retries=args.retries)
        self.now = utc_now()
        self.stats_lock = threading.Lock()
        self.stats = {
            "listed": 0,
            "details_requested": 0,
            "details_reused": 0,
            "assets_downloaded": 0,
            "assets_reused": 0,
            "assets_failed": 0,
            "products_failed": 0,
            "archived": 0,
        }
        self._prepare_root()
        self.state = load_json(self.state_path, {"version": 1, "products": {}})
        if not isinstance(self.state.get("products"), dict):
            self.state["products"] = {}

    def bump(self, key, amount=1):
        with self.stats_lock:
            self.stats[key] += amount

    def _prepare_root(self):
        volume = pathlib.Path(self.args.required_volume)
        if not volume.is_dir():
            raise RuntimeError("required external volume is not mounted: {}".format(volume))
        for directory in (self.catalog_dir, self.products_dir, self.assets_dir, self.state_dir, self.logs_dir):
            directory.mkdir(parents=True, exist_ok=True)
        test_path = self.state_dir / ".write-test"
        atomic_bytes(test_path, b"ok")
        test_path.unlink()

    def run(self):
        with (self.state_dir / "sync.lock").open("a+") as lock_handle:
            try:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                logging.info("another sync is already running")
                return 0
            started = utc_now()
            categories = self.client.post("/category/filter", {})
            products = self.fetch_products()
            normalize_wallpaper_products(products, categories)
            if self.args.limit:
                products = products[: self.args.limit]
            self.stats["listed"] = len(products)
            logging.info("catalog listed categories=%s products=%s", len(categories), len(products))
            current_ids = {str(item.get("id")) for item in products if item.get("id") is not None}
            self.mark_archived(current_ids)
            results = self.sync_products(products)
            self.write_exports(categories, products, results)
            completed_at = utc_now()
            if self.stats["products_failed"] == 0:
                self.state["last_success_at"] = completed_at
            self.state["last_completed_at"] = completed_at
            self.state["last_started_at"] = started
            self.state["stats"] = self.stats
            atomic_json(self.state_path, self.state)
            summary = {
                "status": "ok" if self.stats["products_failed"] == 0 else "partial",
                "started_at": started,
                "completed_at": completed_at,
                "root": str(self.root),
                "stats": self.stats,
            }
            atomic_json(self.catalog_dir / "summary.json", summary)
            logging.info("sync complete %s", json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
            return 0 if self.stats["products_failed"] == 0 else 2

    def fetch_products(self):
        first = self.client.post("/product", {"page": 0})
        first_products = list(first.get("products") or [])
        total = int(first.get("total") or len(first_products))
        random_seed = first.get("randSeed")
        page_size = max(1, len(first_products))
        page_count = int(math.ceil(float(total) / float(page_size)))
        pages = {0: first_products}
        logging.info("listing pages=%s total=%s page_size=%s seed=%s", page_count, total, page_size, random_seed)

        def fetch_page(page):
            payload = {"page": page}
            if random_seed is not None:
                payload["randSeed"] = random_seed
            response = self.client.post("/product", payload)
            return page, list(response.get("products") or [])

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(self.args.workers, 8)) as executor:
            futures = [executor.submit(fetch_page, page) for page in range(1, page_count)]
            for future in concurrent.futures.as_completed(futures):
                page, items = future.result()
                pages[page] = items

        deduplicated = {}
        for page in range(page_count):
            for product in pages.get(page, []):
                product_id = product.get("id")
                if product_id is not None:
                    deduplicated[str(product_id)] = product
        if len(deduplicated) < total:
            logging.warning("listed product count differs from API total listed=%s api_total=%s", len(deduplicated), total)
        return list(deduplicated.values())

    def detail_due(self, product, previous):
        if self.args.force:
            return True
        detail_path = self.products_dir / (str(product["id"]) + ".json")
        if not detail_path.is_file():
            return True
        if previous.get("list_hash") != canonical_hash(product):
            return True
        checked_at = parse_time(previous.get("detail_checked_at"))
        if checked_at is None:
            return True
        age = datetime.datetime.now(datetime.timezone.utc) - checked_at
        return age >= datetime.timedelta(days=self.args.detail_max_age_days)

    def sync_products(self, products):
        results = {}

        def work(product):
            product_id = str(product["id"])
            previous = dict(self.state["products"].get(product_id) or {})
            due = self.detail_due(product, previous)
            record_path = self.products_dir / (product_id + ".json")
            existing = load_json(record_path, {})
            if due:
                numeric_id = int(product_id)
                if numeric_id < 0:
                    detail = self.client.post("/product/mytexture/detail", {"id": numeric_id})
                else:
                    detail = self.client.post("/productDetail", {"productId": numeric_id, "isPlugin": True})
                self.bump("details_requested")
            else:
                detail = existing.get("detail") or {}
                self.bump("details_reused")
            if not isinstance(detail, dict):
                detail = {}
            assets = self.sync_assets(product_id, detail, previous.get("assets") or {}, due)
            record = {
                "id": int(product_id),
                "active": True,
                "list": product,
                "detail": detail,
                "assets": assets,
                "first_cloned_at": previous.get("first_cloned_at") or self.now,
                "last_seen_at": self.now,
                "detail_checked_at": self.now if due else previous.get("detail_checked_at"),
            }
            atomic_json(record_path, record)
            state_entry = {
                "active": True,
                "list_hash": canonical_hash(product),
                "detail_hash": canonical_hash(detail),
                "first_cloned_at": record["first_cloned_at"],
                "last_seen_at": self.now,
                "detail_checked_at": record["detail_checked_at"],
                "assets": assets,
            }
            return product_id, record, state_entry

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.args.workers) as executor:
            future_map = {executor.submit(work, product): product for product in products}
            completed = 0
            for future in concurrent.futures.as_completed(future_map):
                product = future_map[future]
                product_id = str(product.get("id"))
                try:
                    result_id, record, state_entry = future.result()
                    results[result_id] = record
                    self.state["products"][result_id] = state_entry
                except Exception as error:
                    self.bump("products_failed")
                    logging.error("product failed id=%s error=%s", product_id, error)
                    existing = load_json(self.products_dir / (product_id + ".json"), {})
                    if existing:
                        results[product_id] = existing
                completed += 1
                if completed % 250 == 0 or completed == len(products):
                    logging.info("progress completed=%s total=%s failures=%s", completed, len(products), self.stats["products_failed"])
                    self.state["last_progress_at"] = utc_now()
                    self.state["stats"] = self.stats
                    atomic_json(self.state_path, self.state)
        return results

    def sync_assets(self, product_id, detail, previous_assets, refresh):
        urls = {}
        for field, kind in ASSET_FIELDS.items():
            url = as_asset_url(detail.get(field))
            if url:
                urls[kind] = url
        if "original" not in urls and refresh and int(product_id) >= 0:
            try:
                fallback = self.client.post("/plugin/download", {
                    "userId": 0,
                    "productId": int(product_id),
                    "fileType": "seamless",
                    "source": "grid",
                })
                original = as_asset_url(fallback.get("image"))
                seamless = as_asset_url(fallback.get("seamlessImage"))
                if original:
                    urls["original"] = original
                if seamless:
                    urls["seamless"] = seamless
            except Exception as error:
                logging.warning("asset fallback failed id=%s error=%s", product_id, error)

        assets = {}
        product_dir = self.assets_dir / product_id
        for kind, url in urls.items():
            previous = previous_assets.get(kind) or {}
            previous_path = pathlib.Path(previous.get("path")) if previous.get("path") else None
            if previous.get("url") == url and previous_path and previous_path.is_file() and previous_path.stat().st_size > 0:
                assets[kind] = previous
                self.bump("assets_reused")
                continue
            try:
                content, content_type = self.client.download(url)
                if not content:
                    raise RuntimeError("empty asset")
                suffix = extension_for(url, content_type)
                path = product_dir / (kind + suffix)
                atomic_bytes(path, content)
                if previous_path and previous_path != path and previous_path.is_file():
                    previous_path.unlink()
                assets[kind] = {
                    "url": url,
                    "path": str(path),
                    "bytes": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "content_type": content_type,
                    "downloaded_at": self.now,
                }
                self.bump("assets_downloaded")
            except Exception as error:
                self.bump("assets_failed")
                logging.error("asset failed id=%s kind=%s error=%s", product_id, kind, error)
                if previous_path and previous_path.is_file():
                    assets[kind] = previous
        return assets

    def mark_archived(self, current_ids):
        if self.args.limit:
            return
        for product_id, entry in self.state["products"].items():
            if product_id not in current_ids and entry.get("active", True):
                entry["active"] = False
                entry["archived_at"] = self.now
                self.bump("archived")

    def write_exports(self, categories, products, results):
        atomic_json(self.catalog_dir / "categories.json", {
            "cloned_at": self.now,
            "count": len(categories),
            "categories": categories,
        })
        records = []
        product_list = []
        for product in products:
            product_id = str(product.get("id"))
            record = results.get(product_id)
            if record:
                records.append(record)
                if record.get("list"):
                    item = dict(record["list"])
                    item["cloneAssetKinds"] = sorted((record.get("assets") or {}).keys())
                    product_list.append(item)
        atomic_json(self.catalog_dir / "products-list.json", {
            "cloned_at": self.now,
            "count": len(product_list),
            "products": product_list,
        })
        ndjson = "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in records)
        atomic_bytes(self.catalog_dir / "products.ndjson", ndjson.encode("utf-8"))
        archived = []
        for product_id, entry in self.state["products"].items():
            if not entry.get("active", True):
                record = load_json(self.products_dir / (product_id + ".json"), {})
                if record:
                    record["active"] = False
                    archived.append(record)
        archived_ndjson = "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in archived)
        atomic_bytes(self.catalog_dir / "archived.ndjson", archived_ndjson.encode("utf-8"))
        self.write_sqlite(categories, records, archived)

    def write_sqlite(self, categories, records, archived):
        final_path = self.catalog_dir / "materials.sqlite3"
        temporary = self.catalog_dir / "materials.sqlite3.part"
        if temporary.exists():
            temporary.unlink()
        connection = sqlite3.connect(str(temporary))
        try:
            connection.executescript(
                "CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, product_count INTEGER, raw_json TEXT NOT NULL);"
                "CREATE TABLE materials (id INTEGER PRIMARY KEY, active INTEGER NOT NULL, name TEXT, code TEXT, category TEXT, category_id INTEGER, sub_category TEXT, brand TEXT, origin TEXT, glossiness TEXT, size TEXT, design_price INTEGER, image_remote TEXT, image_local TEXT, first_cloned_at TEXT, last_seen_at TEXT, list_json TEXT NOT NULL, detail_json TEXT NOT NULL, assets_json TEXT NOT NULL);"
                "CREATE INDEX materials_category_idx ON materials(category);"
                "CREATE INDEX materials_brand_idx ON materials(brand);"
                "CREATE INDEX materials_active_idx ON materials(active);"
            )
            for category in categories:
                connection.execute(
                    "INSERT INTO categories(id,name,product_count,raw_json) VALUES(?,?,?,?)",
                    (category.get("id"), category.get("name"), category.get("productCount"), json.dumps(category, ensure_ascii=False)),
                )
            for record in list(records) + list(archived):
                product = record.get("list") or {}
                detail = record.get("detail") or {}
                assets = record.get("assets") or {}
                original = assets.get("original") or {}
                connection.execute(
                    "INSERT INTO materials(id,active,name,code,category,category_id,sub_category,brand,origin,glossiness,size,design_price,image_remote,image_local,first_cloned_at,last_seen_at,list_json,detail_json,assets_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        record.get("id"),
                        1 if record.get("active", True) else 0,
                        detail.get("name") or product.get("name"),
                        detail.get("code"),
                        detail.get("category") or product.get("category"),
                        detail.get("categoryId") or product.get("categoryId"),
                        detail.get("subCategory") or product.get("subCategory"),
                        detail.get("manufacturer") or detail.get("brand") or product.get("brand"),
                        detail.get("country") or detail.get("origin"),
                        detail.get("glossiness"),
                        detail.get("size"),
                        detail.get("price") or product.get("price"),
                        detail.get("image") or product.get("img"),
                        original.get("path"),
                        record.get("first_cloned_at"),
                        record.get("last_seen_at"),
                        json.dumps(product, ensure_ascii=False),
                        json.dumps(detail, ensure_ascii=False),
                        json.dumps(assets, ensure_ascii=False),
                    ),
                )
            connection.commit()
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            if not integrity or integrity[0] != "ok":
                raise RuntimeError("SQLite integrity check failed: {}".format(integrity))
        finally:
            connection.close()
        os.replace(temporary, final_path)


def configure_logging(root):
    logs_dir = pathlib.Path(root) / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_log = logs_dir / ("sync-" + timestamp + ".log")
    latest_log = logs_dir / "latest.log"
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    for path, mode in ((run_log, "a"), (latest_log, "w")):
        handler = logging.FileHandler(str(path), mode=mode, encoding="utf-8")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    logger.addHandler(stream)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/Volumes/DATABASE/macodi-material-clone")
    parser.add_argument("--required-volume", default="/Volumes/DATABASE")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--detail-max-age-days", type=float, default=7)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    configure_logging(args.root)
    try:
        return MaterialClone(args).run()
    except Exception as error:
        logging.exception("sync failed: %s", error)
        return 1


if __name__ == "__main__":
    sys.exit(main())
