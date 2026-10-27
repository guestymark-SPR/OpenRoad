import os
from playwright.sync_api import sync_playwright
# OpenRoad: a twisty road climbing into the hills at sunset, with the navigation arrow riding it.
DEFS = '''<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f9a55"/><stop offset=".55" stop-color="#0a6e3d"/><stop offset="1" stop-color="#033a22"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".33" r=".42"><stop offset="0" stop-color="#ffe680" stop-opacity=".9"/><stop offset=".45" stop-color="#ffd84a" stop-opacity=".35"/><stop offset="1" stop-color="#ffd84a" stop-opacity="0"/></radialGradient>
<linearGradient id="tar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4247"/><stop offset="1" stop-color="#1b2125"/></linearGradient>
<linearGradient id="arrow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe14d"/><stop offset="1" stop-color="#f5b800"/></linearGradient>'''
L = 'M40 1024 C190 840 600 830 600 670 C600 560 440 532 480 392'      # left edge of the road
R = 'M620 1024 C630 890 840 870 840 680 C840 548 562 518 544 392'      # right edge
C = 'M330 1024 C410 860 720 850 720 675 C720 554 500 525 512 392'      # centre line
ART = f'''<rect width="1024" height="1024" fill="url(#sky)"/>
<rect width="1024" height="1024" fill="url(#glow)"/>
<path d="M0 470 C140 400 260 430 380 395 C470 368 560 330 660 352 C780 378 880 340 1024 300 L1024 1024 L0 1024Z" fill="#075a33"/>
<path d="M0 560 C200 500 330 560 520 470 C700 390 850 450 1024 420 L1024 1024 L0 1024Z" fill="#04452a"/>
<path d="{L} L536 392 {R[R.index('C'):]} Z" fill="none"/>
<path d="M40 1024 C190 840 600 830 600 670 C600 560 440 532 480 392 L544 392 C562 518 840 548 840 680 C840 870 630 890 620 1024 Z" fill="url(#tar)"/>
<path d="{L}" fill="none" stroke="#f4f6f4" stroke-width="20" stroke-linecap="round"/>
<path d="{R}" fill="none" stroke="#f4f6f4" stroke-width="20" stroke-linecap="round"/>
<path d="{C}" fill="none" stroke="#ffd200" stroke-width="20" stroke-dasharray="56 46" stroke-linecap="round"/>
<g transform="translate(698 742) rotate(-8) scale(.84)">
  <path d="M0 -150 L118 130 L0 72 L-118 130 Z" fill="#000" opacity=".28" transform="translate(10 16)"/>
  <path d="M0 -150 L118 130 L0 72 L-118 130 Z" fill="url(#arrow)" stroke="#ffffff" stroke-width="22" stroke-linejoin="round"/>
  <path d="M0 -150 L0 72 L-118 130 Z" fill="#000" opacity=".10"/>
</g>'''
def svg(mask, scale=1.0):
    clip = '<clipPath id="sq"><rect width="1024" height="1024" rx="232"/></clipPath>' if mask else ''
    inner = ART if scale == 1 else f'<g transform="translate(512 512) scale({scale}) translate(-512 -512)">{ART}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>{DEFS}{clip}</defs><g clip-path="{"url(#sq)" if mask else "none"}">{inner}</g></svg>'
# monochrome (Android 13 themed icons): the road and arrow as one shape
MONO = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><g transform="translate(512 512) scale(.62) translate(-512 -560)">
<path d="M40 1024 C190 840 600 830 600 670 C600 560 440 532 480 392 L544 392 C562 518 840 548 840 680 C840 870 630 890 620 1024 Z" fill="#000"/>
<g transform="translate(698 742) rotate(-8) scale(.84)"><path d="M0 -150 L118 130 L0 72 L-118 130 Z" fill="#000" stroke="#fff" stroke-width="40" stroke-linejoin="round" paint-order="stroke"/></g></g></svg>'''
outs = {'icon-round.png': svg(True), 'icon-full.png': svg(False), 'mono.png': MONO}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1024, 'height': 1024})
    for name, s in outs.items():
        open(name + '.svg', 'w').write(s); pg.goto('file://' + os.path.abspath(name + '.svg')); pg.screenshot(path=name, omit_background=True)
    b.close()
print('ok')
# Android adaptive icon: the phone shows the middle two-thirds (cut to its own shape), so the picture is the middle
# of a bigger canvas, with the sky, hills and road carried on to the edges.
EXT = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-256 -256 1536 1536" width="1536" height="1536"><defs>{DEFS}</defs>
<rect x="-256" y="-256" width="1536" height="1536" fill="#0f9a55"/>
<rect x="-256" y="-256" width="1536" height="1536" fill="url(#sky)" transform="translate(0 0)"/>
<rect x="-256" y="700" width="1536" height="580" fill="#033a22"/>
<path d="M-256 470 L0 470 L0 1280 L-256 1280Z" fill="#075a33"/><path d="M1024 300 L1280 300 L1280 1280 L1024 1280Z" fill="#075a33"/>
<path d="M-256 560 L0 560 L0 1280 L-256 1280Z" fill="#04452a"/><path d="M1024 420 L1280 420 L1280 1280 L1024 1280Z" fill="#04452a"/>
<path d="M-120 1280 L40 1024 L620 1024 L600 1280Z" fill="#1b2125"/>
{ART}</svg>'''
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1536, 'height': 1536})
    open('adaptive.svg', 'w').write(EXT); pg.goto('file://' + os.path.abspath('adaptive.svg')); pg.screenshot(path='adaptive-art.png')
    b.close()
