import os
from playwright.sync_api import sync_playwright
# OpenRoad, outlaw look: a black leather patch with bone-white stitching, arched blackletter lettering,
# and the road with the navigation arrow in the middle. An original design (no club's name, colours or emblem).
FONTS = '''<style>@font-face{font-family:P;src:url(PirataOne.ttf)}@font-face{font-family:O;src:url(Oswald.ttf)}</style>'''
DEFS = '''<radialGradient id="leather" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="#2b2b2b"/><stop offset=".6" stop-color="#151515"/><stop offset="1" stop-color="#070707"/></radialGradient>
<pattern id="grain" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#fff" opacity=".05"/><circle cx="6.5" cy="6" r="1.3" fill="#000" opacity=".35"/></pattern>
<linearGradient id="red" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d0262d"/><stop offset="1" stop-color="#7d0d12"/></linearGradient>
<path id="top" d="M222 512 A290 290 0 0 1 802 512"/><path id="bot" d="M178 512 A334 334 0 0 0 846 512"/>'''
ROAD_L = 'M330 820 C350 730 560 720 560 630 C560 560 470 540 492 470'
ROAD_R = 'M480 820 C490 745 640 735 640 640 C640 560 540 535 532 470'
def art():
    return f'''<rect width="1024" height="1024" fill="url(#leather)"/><rect width="1024" height="1024" fill="url(#grain)"/>
<circle cx="512" cy="512" r="420" fill="#0b0b0b" stroke="#ece4d2" stroke-width="12"/>
<circle cx="512" cy="512" r="392" fill="none" stroke="#ece4d2" stroke-width="6" stroke-dasharray="20 14" opacity=".8"/>
<text font-family="P" font-size="112" fill="#ece4d2" letter-spacing="4" text-anchor="middle"><textPath href="#top" startOffset="50%">Open Road</textPath></text>
<text font-family="O" font-weight="600" font-size="54" fill="#ece4d2" letter-spacing="20" text-anchor="middle" opacity=".9"><textPath href="#bot" startOffset="50%">RIDE FREE</textPath></text>
<g transform="translate(512 512) scale(1.05) translate(-485 -645)"><path d="{ROAD_L} L532 470 {ROAD_R[ROAD_R.index('C'):].replace('M','')}" fill="none"/>
<path d="M330 820 C350 730 560 720 560 630 C560 560 470 540 492 470 L532 470 C540 535 640 560 640 640 C640 735 490 745 480 820 Z" fill="#ece4d2"/>
<path d="M405 820 C420 738 600 728 600 635 C600 560 505 538 512 470" fill="none" stroke="#141414" stroke-width="12" stroke-dasharray="30 24"/>
<g transform="translate(600 655) rotate(-6) scale(.62)"><path d="M0 -150 L118 130 L0 72 L-118 130 Z" fill="url(#red)" stroke="#141414" stroke-width="26" stroke-linejoin="round"/></g></g>'''
def svg(mask, ext=False):
    clip = '<clipPath id="sq"><rect width="1024" height="1024" rx="232"/></clipPath>' if mask else ''
    stitch = '<rect x="38" y="38" width="948" height="948" rx="200" fill="none" stroke="#ece4d2" stroke-width="7" stroke-dasharray="26 18" opacity=".55"/>' if mask else ''
    vb = '-256 -256 1536 1536' if ext else '0 0 1024 1024'
    size = 1536 if ext else 1024
    bg = '<rect x="-256" y="-256" width="1536" height="1536" fill="url(#leather)"/><rect x="-256" y="-256" width="1536" height="1536" fill="url(#grain)"/>' if ext else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{size}" height="{size}">{FONTS}<defs>{DEFS}{clip}</defs>{bg}<g clip-path="{"url(#sq)" if mask else "none"}">{art()}{stitch}</g></svg>'
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1536, 'height': 1536})
    for name, s, w in [('ol-round.png', svg(True), 1024), ('ol-full.png', svg(False), 1024), ('ol-adaptive.png', svg(False, True), 1536)]:
        open(name + '.svg', 'w').write(s); pg.set_viewport_size({'width': w, 'height': w}); pg.goto('file://' + os.path.abspath(name + '.svg')); pg.wait_for_timeout(400); pg.screenshot(path=name, omit_background=True)
    b.close()
print('ok')
