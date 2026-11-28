import json, re, base64, gzip, os
files = {
  'meono': '/home/hatch/workspace/user/files/meono.html',
  'masoi': '/home/hatch/workspace/user/files/masoi.html',
  'uno': '/home/hatch/workspace/user/files/uno.html',
  'gian-diep': '/home/hatch/workspace/user/files/ailagiandiep-c017c472.html',
  'coup': '/home/hatch/workspace/user/files/coup-9b5f23a4.html',
}
base = '/home/hatch/workspace/cheese-thief-game/loop/design-v54batch'
for name, src in files.items():
    outdir = os.path.join(base, name, 'assets')
    os.makedirs(outdir, exist_ok=True)
    s = open(src, encoding='utf-8').read()
    m = re.search(r'<script type="__bundler/manifest">(.*?)</script>', s, re.S)
    if not m:
        print(name, 'NO manifest — template format? template marker:', '__bundler/template' in s)
        continue
    man = json.loads(m.group(1))
    print(f'== {name}: {len(man)} entries')
    for uuid, e in man.items():
        raw = base64.b64decode(e['data'])
        html = gzip.decompress(raw).decode('utf-8') if e.get('compressed') else raw.decode('utf-8')
        open(os.path.join(outdir, uuid + '.html'), 'w', encoding='utf-8').write(html)
        title = re.search(r'<title>(.*?)</title>', html, re.S)
        print('  ', uuid[:8], '|', len(html), '|', (title.group(1).strip() if title else '?')[:70])
