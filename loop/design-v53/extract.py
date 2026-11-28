import re, json, base64, gzip, os
from collections import Counter
src = '/home/hatch/workspace/user/files/chuotphomai-408340f3.html'
out = '/home/hatch/workspace/cheese-thief-game/loop/design-v53'
s = open(src, encoding='utf-8', errors='ignore').read()
m = re.search(r'<script type="__bundler/manifest">(.*?)</script>', s, re.S)
d = json.loads(m.group(1))
print('entries:', len(d))
c = Counter()
for k, v in d.items():
    c[v['mime']] += 1
    raw = base64.b64decode(v['data'])
    data = gzip.decompress(raw) if v.get('compressed') else raw
    ext = {'text/html': '.html', 'image/svg+xml': '.svg', 'image/png': '.png',
           'image/jpeg': '.jpg', 'image/webp': '.webp', 'font/woff2': '.woff2',
           'text/css': '.css', 'application/javascript': '.js'}.get(v['mime'], '.bin')
    fn = os.path.join(out, 'assets', k + ext)
    os.makedirs(os.path.dirname(fn), exist_ok=True)
    open(fn, 'wb').write(data)
print(c)
# list html files with sizes
for k, v in d.items():
    if v['mime'] == 'text/html':
        fn = os.path.join(out, 'assets', k + '.html')
        print(k, os.path.getsize(fn))
