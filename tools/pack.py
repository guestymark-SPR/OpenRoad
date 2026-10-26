#!/usr/bin/env python3
"""Turn a Planetiler MBTiles file into OpenRoad map pack(s).

GitHub release files must be under 2 GiB, so a big country is cut into north-south bands of
roughly equal size. Each band keeps every zoom level for its area (the low zooms repeat in each
band, which is small). Writes <id>.mbtiles or <id>-1.mbtiles, <id>-2.mbtiles ... plus a .json
description of each pack for the in-app list.

usage: pack.py SOURCE.mbtiles ID "Display name" OUTDIR [max_bytes]
"""
import json, math, os, sqlite3, sys, datetime

src, pid, name, out = sys.argv[1:5]
limit = int(sys.argv[5]) if len(sys.argv) > 5 else 1_800_000_000
os.makedirs(out, exist_ok=True)
today = datetime.date.today().isoformat()
size = os.path.getsize(src)

def y2lat(y, z):
    n = math.pi - 2 * math.pi * y / (1 << z)
    return math.degrees(math.atan(math.sinh(n)))

def describe(path, fid, fname, bounds):
    with open(os.path.join(out, fid + '.json'), 'w') as f:
        json.dump({"id": fid, "name": fname, "size": os.path.getsize(path), "date": today, "bounds": bounds}, f)

def set_meta(db, fname, bounds=None):
    db.execute("DELETE FROM metadata WHERE name IN ('openroad_name'" + (",'bounds'" if bounds else "") + ")")
    db.execute("INSERT INTO metadata(name,value) VALUES('openroad_name',?)", (fname,))
    if bounds: db.execute("INSERT INTO metadata(name,value) VALUES('bounds',?)", (",".join("%.5f" % b for b in bounds),))
    db.commit()

s = sqlite3.connect(src)
meta = dict(s.execute("SELECT name, value FROM metadata").fetchall())
b = [float(v) for v in meta.get("bounds", "-180,-85,180,85").split(",")]
maxz = int(meta.get("maxzoom", 14))
compact = s.execute("SELECT count(*) FROM sqlite_master WHERE name='tiles_shallow'").fetchone()[0] > 0

if size <= limit:
    s.close()
    dst = os.path.join(out, pid + ".mbtiles")
    os.replace(src, dst)
    db = sqlite3.connect(dst); set_meta(db, name); db.close()
    describe(dst, pid, name, b)
    print("one pack", dst, size); sys.exit(0)

parts = math.ceil(size / (limit * 0.85))
# size of each tile row at the top zoom, to cut bands of equal size
if compact:
    rows = s.execute("SELECT ts.tile_row, sum(length(td.tile_data)) FROM tiles_shallow ts JOIN tiles_data td ON ts.tile_data_id=td.tile_data_id WHERE ts.zoom_level=? GROUP BY ts.tile_row", (maxz,)).fetchall()
else:
    rows = s.execute("SELECT tile_row, sum(length(tile_data)) FROM tiles WHERE zoom_level=? GROUP BY tile_row", (maxz,)).fetchall()
n = 1 << maxz
rows = sorted(((n - 1 - r, sz) for r, sz in rows))  # XYZ rows, north first
total = sum(sz for _, sz in rows)
cuts, acc, target = [], 0, total / parts
for y, sz in rows:
    acc += sz
    if acc >= target * (len(cuts) + 1) and len(cuts) < parts - 1: cuts.append(y + 1)
edges = [rows[0][0]] + cuts + [rows[-1][0] + 1]
print("splitting", pid, "into", parts, "bands at rows", edges)

for k in range(parts):
    y0, y1 = edges[k], edges[k + 1]  # XYZ rows [y0, y1) at maxz
    north, south = y2lat(y0, maxz), y2lat(y1, maxz)
    bounds = [b[0], max(b[1], south), b[2], min(b[3], north)]
    fid = "%s-%d" % (pid, k + 1)
    where = "north" if k == 0 else "south" if k == parts - 1 else "middle"
    fname = "%s (part %d of %d, %s)" % (name, k + 1, parts, where)
    dst = os.path.join(out, fid + ".mbtiles")
    if os.path.exists(dst): os.remove(dst)
    d = sqlite3.connect(dst)
    d.execute("CREATE TABLE metadata (name text, value text)")
    d.execute("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)")
    d.executemany("INSERT INTO metadata VALUES (?,?)", [(a, v) for a, v in meta.items() if a != "bounds"])
    for z in range(0, maxz + 1):
        sh = maxz - z
        ya, yb = y0 >> sh, (y1 - 1) >> sh  # XYZ rows at this zoom
        ta, tb = (1 << z) - 1 - yb, (1 << z) - 1 - ya  # TMS rows
        cur = s.execute("SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles WHERE zoom_level=? AND tile_row BETWEEN ? AND ?", (z, ta, tb))
        while True:
            batch = cur.fetchmany(5000)
            if not batch: break
            d.executemany("INSERT INTO tiles VALUES (?,?,?,?)", batch)
        d.commit()
    d.execute("CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)")
    set_meta(d, fname, bounds)
    d.execute("VACUUM"); d.close()
    describe(dst, fid, fname, bounds)
    print(fid, os.path.getsize(dst))
s.close()
os.remove(src)
