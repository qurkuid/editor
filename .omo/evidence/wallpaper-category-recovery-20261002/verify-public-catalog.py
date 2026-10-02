import collections, json, subprocess
url = 'https://intm.kr/api/studio/material-clone'
products, page = [], 0
while True:
    data = json.dumps({'endpoint': '/product', 'payload': {'page': page, 'categories': [108]}})
    body = json.loads(subprocess.check_output(['curl', '--fail', '-sS', '--max-time', '45', '-X', 'POST', url, '-H', 'Content-Type: application/json', '--data', data]))
    if 'data' in body:
        body = body['data']
    products.extend(body['products'])
    if body.get('next') is None:
        break
    page = body['next']
counts = collections.Counter(p.get('brand') for p in products)
result = {'url': url, 'wallpaperTotal': len(products), 'brands': dict(counts), 'restoredProducts': [{'id': p['id'], 'name': p['name'], 'brand': p['brand'], 'categoryId': p['categoryId']} for p in products if p.get('brand') in ('LX Z:IN(LX지인)', '서울벽지')]}
print(json.dumps(result, ensure_ascii=False, indent=2))
assert len(products) == 1010, result['wallpaperTotal']
assert counts['LX Z:IN(LX지인)'] == counts['서울벽지'] == 30
assert all(p['categoryId'] == 108 for p in products)
