#!/usr/bin/env python3
"""Today's official average fuel prices for OpenRoad, written to fuel.json.

UK: weekly average pump price of unleaded petrol (pence a litre), UK government (DESNZ) weekly road fuel prices.
Europe: Euro-super 95 average pump price with taxes for each country, EU Weekly Oil Bulletin.
"""
import csv, io, json, re, sys, datetime, urllib.request
import openpyxl

UA = {'User-Agent': 'OpenRoad fuel price updater (github.com/guestymark-SPR/OpenRoad)'}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return r.read()

out = {'updated': datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'}

# ---- UK ----
try:
    page = json.loads(get('https://www.gov.uk/api/content/government/statistics/weekly-road-fuel-prices'))
    att = [a for a in page['details']['attachments'] if a.get('content_type', '').startswith('text/csv') and '2018' in a.get('title', '')]
    url = att[0]['url']
    rows = list(csv.reader(io.StringIO(get(url).decode('utf-8-sig'))))
    head = next(i for i, r in enumerate(rows) if r and r[0].strip().lower() == 'date')
    col = next(i for i, h in enumerate(rows[head]) if 'ULSP' in h and 'Pump price' in h)
    data = [r for r in rows[head + 1:] if r and r[0].strip() and len(r) > col and r[col].strip()]
    last = data[-1]
    out['uk'] = {'unleaded_ppl': float(last[col]), 'week': last[0].strip(), 'source': 'UK government weekly road fuel prices', 'url': 'https://www.gov.uk/government/statistics/weekly-road-fuel-prices'}
    print('::notice::UK unleaded', last[0], last[col])
except Exception as e:
    print('::error::UK prices failed:', e)

# ---- Europe ----
CODES = {'austria': 'AT', 'belgium': 'BE', 'croatia': 'HR', 'czech': 'CZ', 'denmark': 'DK', 'finland': 'FI', 'france': 'FR', 'germany': 'DE', 'ireland': 'IE', 'italy': 'IT',
         'luxembourg': 'LU', 'netherlands': 'NL', 'poland': 'PL', 'portugal': 'PT', 'slovenia': 'SI', 'spain': 'ES', 'sweden': 'SE'}
try:
    html = get('https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en').decode('utf-8', 'replace')
    m = re.search(r'href="([^"]*/document/download/[^"]*with(?:%20|\s|_)?[Tt]axes[^"]*\.xlsx[^"]*)"', html)
    url = m.group(1).replace('&amp;', '&')
    if url.startswith('/'): url = 'https://energy.ec.europa.eu' + url
    wb = openpyxl.load_workbook(io.BytesIO(get(url)), data_only=True)
    prices, when = {}, ''
    for ws in wb.worksheets:
        col = None
        for row in ws.iter_rows(values_only=True):
            cells = ['' if v is None else v for v in row]
            text = ' '.join(str(v) for v in cells)
            if not when:
                d = re.search(r'(\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})', text)
                if d and 'prices' in text.lower(): when = d.group(1)
            if col is None:
                for i, v in enumerate(cells):
                    if isinstance(v, str) and 'super' in v.lower() and '95' in v: col = i
                continue
            name = str(cells[0]).strip().lower() if cells else ''
            code = next((c for k, c in CODES.items() if name.startswith(k)), None)
            if code and col < len(cells) and isinstance(cells[col], (int, float)):
                v = float(cells[col])
                prices[code] = round(v / 1000 if v > 50 else v, 3)  # the bulletin gives euros per 1,000 litres
        if prices: break
    m2 = re.search(r'(\d{4}-\d{2}-\d{2})', url.replace('%20', ' '))
    out['eu'] = {'prices': prices, 'date': m2.group(1) if m2 else when, 'fuel': 'Euro-super 95', 'source': 'EU Weekly Oil Bulletin', 'url': 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en'}
    print('::notice::EU', out['eu']['date'], prices)
except Exception as e:
    print('::error::EU prices failed:', e)

if 'uk' not in out and 'eu' not in out: sys.exit(1)
json.dump(out, open('fuel.json', 'w'), indent=1)
print(json.dumps(out))
