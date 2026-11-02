#!/usr/bin/env python3
"""Build OpenRoad's search-with-no-signal index for one country.

Reads places and points of interest exported from OpenStreetMap (osmium export, GeoJSON sequence) and,
for Great Britain, Ordnance Survey Code-Point Open postcodes. Writes plain text the app downloads beside
the country's map pack, in pieces small enough to pass through the app in one go:
  search-<id>-1.txt, search-<id>-2.txt ...   one entry per line, tab separated
  search-<id>.meta                            JSON: name, date, files, counts (for search.json)

Lines:
  <kind> name lng lat in        kind is one letter (see kind()); "in" is the nearest town, if any;
                                a city's English name comes first where it has one: Brussels|Bruxelles - Brussel
  P "AB10 1" lng lat units      a postcode sector: its middle in 1/10000 degree, then each unit as
                                letters:dlng:dlat, each step from the one before (the first from the middle)

usage: places.py ID "Display name" places.geojsonseq OUTDIR [codepoint_csv_dir]
"""
import csv, glob, json, math, os, sys, datetime

pid, name, src, out = sys.argv[1:5]
cpdir = sys.argv[5] if len(sys.argv) > 5 else None
os.makedirs(out, exist_ok=True)
PIECE = 2_500_000

PLACE = {'city': 'c', 'town': 't', 'village': 'v', 'hamlet': 'h', 'suburb': 's', 'quarter': 's', 'neighbourhood': 's'}
AMENITY = {'fuel': 'f', 'cafe': 'k', 'pub': 'p'}
TOURISM = {'hotel': 'o', 'guest_house': 'o', 'motel': 'o', 'hostel': 'o', 'camp_site': 'm', 'attraction': 'a',
           'museum': 'a', 'viewpoint': 'w'}
RANK = 'ctvshafkpomwb'  # file order: big places first

def kind(p):
    if p.get('place') in PLACE: return PLACE[p['place']]
    if p.get('amenity') in AMENITY: return AMENITY[p['amenity']]
    if p.get('tourism') in TOURISM: return TOURISM[p['tourism']]
    if p.get('historic') == 'castle': return 'a'
    if p.get('shop') == 'motorcycle': return 'b'
    return None

def middle(g):
    t, c = g.get('type'), g.get('coordinates')
    if t == 'Point': return c
    if t == 'MultiPolygon': c, t = c[0], 'Polygon'
    if t == 'Polygon' and c and c[0]:
        ring = c[0]
        return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]
    return None

def clean(s): return ' '.join(str(s).replace('\t', ' ').split())

items, seen = [], set()
with open(src, encoding='utf-8') as f:
    for line in f:
        line = line.lstrip('\x1e').strip()
        if not line: continue
        try: ft = json.loads(line)
        except ValueError: continue
        p = ft.get('properties') or {}
        k = kind(p)
        if not k: continue
        nm = clean(p.get('name') or (p.get('brand') if k == 'f' else '') or '')
        if not nm: continue
        en = clean(p.get('name:en') or '') if k in 'ct' else ''
        if en and en != nm: nm = en + '|' + nm  # Brussels|Bruxelles - Brussel: shown as the first, found by either
        c = middle(ft.get('geometry') or {})
        if not c: continue
        dup = (k, nm.lower(), round(c[0], 2), round(c[1], 2))  # the same place as a point and an outline
        if dup in seen: continue
        seen.add(dup)
        items.append([k, nm, c[0], c[1], ''])

# the nearest town for villages and smaller places, and the nearest village or town for everything else
def grid(kinds):
    g = {}
    for it in items:
        if it[0] in kinds: g.setdefault((int(it[2] * 5), int(it[3] * 5)), []).append(it)
    return g
def km(a, b):
    dx = (a[2] - b[2]) * 111.32 * math.cos(math.radians(a[3])); dy = (a[3] - b[3]) * 110.57
    return math.hypot(dx, dy)
def nearest(it, g, limit):
    gx, gy, best, bd = int(it[2] * 5), int(it[3] * 5), None, limit
    for x in range(gx - 1, gx + 2):
        for y in range(gy - 1, gy + 2):
            for o in g.get((x, y), ()):
                if o is it: continue
                d = km(it, o)
                if d < bd: best, bd = o, d
    return best
towns, settled = grid('ct'), grid('ctv')
for it in items:
    if it[0] in 'ct': continue
    o = nearest(it, towns if it[0] in 'vhs' else settled, 20 if it[0] in 'vhs' else 10)
    if o and o[1] != it[1]: it[4] = o[1].split('|')[0]

items.sort(key=lambda it: (RANK.index(it[0]), it[1].lower()))
lines = ['%s\t%s\t%.5f\t%.5f\t%s' % tuple(it) for it in items]

# postcodes, in sectors
npc = 0
if cpdir:
    from pyproj import Transformer
    tr = Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)
    rows = []
    for fn in sorted(glob.glob(os.path.join(cpdir, '*.csv'))):
        with open(fn, newline='', encoding='utf-8-sig') as f:
            for r in csv.reader(f):
                if len(r) < 4 or not r[2].isdigit(): continue
                pc, e, n = r[0].replace(' ', '').upper(), int(r[2]), int(r[3])
                if e and n and 5 <= len(pc) <= 7: rows.append((pc, e, n))
    lng, lat = tr.transform([r[1] for r in rows], [r[2] for r in rows])
    sectors = {}
    for (pc, _, _), x, y in zip(rows, lng, lat):
        sectors.setdefault(pc[:-3] + ' ' + pc[-3], []).append((pc[-2:], round(x * 1e4), round(y * 1e4)))
    for sec in sorted(sectors):
        u = sorted(sectors[sec])
        x0, y0 = round(sum(a[1] for a in u) / len(u)), round(sum(a[2] for a in u) / len(u))
        px, py, parts = x0, y0, []
        for letters, x, y in u:
            parts.append('%s:%d:%d' % (letters, x - px, y - py)); px, py = x, y
        lines.append('P\t%s\t%d\t%d\t%s' % (sec, x0, y0, ' '.join(parts)))
        npc += len(u)

files, buf, size = [], [], 0
def flush():
    global buf, size
    if not buf: return
    fn = 'search-%s-%d.txt' % (pid, len(files) + 1)
    with open(os.path.join(out, fn), 'w', encoding='utf-8', newline='\n') as f: f.write('\n'.join(buf) + '\n')
    files.append({'name': fn, 'bytes': os.path.getsize(os.path.join(out, fn))}); buf, size = [], 0
for ln in lines:
    b = len(ln.encode('utf-8')) + 1
    if size + b > PIECE: flush()
    buf.append(ln); size += b
flush()
with open(os.path.join(out, 'search-%s.meta' % pid), 'w') as f:
    json.dump({'id': pid, 'name': name, 'date': datetime.date.today().isoformat(), 'files': files,
               'places': len(items), 'postcodes': npc}, f)
print('%s: %d places, %d postcodes, %d files, %d bytes' % (pid, len(items), npc, len(files), sum(f['bytes'] for f in files)))
