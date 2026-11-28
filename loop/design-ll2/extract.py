import json, re, base64, gzip, os
src = '/home/hatch/workspace/user/files/loveletter.html'
outdir = '/home/hatch/workspace/cheese-thief-game/loop/design-ll2/assets'
os.makedirs(outdir, exist_ok=True)
s = open(src, encoding='utf-8').read()
m = re.search(r'<script type="__bundler/manifest">(.*?)</script>', s, re.S)
man = json.loads(m.group(1))
for uuid, e in man.items():
    raw = base64.b64decode(e['data'])
    html = gzip.decompress(raw).decode('utf-8') if e.get('compressed') else raw.decode('utf-8')
    open(os.path.join(outdir, uuid + '.html'), 'w', encoding='utf-8').write(html)
    title = re.search(r'<title>(.*?)</title>', html, re.S)
    h1 = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.S)
    print(uuid, '|', len(html), '|', (title.group(1).strip() if title else '?')[:60])
print('total:', len(man))
