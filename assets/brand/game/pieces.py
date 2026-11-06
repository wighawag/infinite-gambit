#!/usr/bin/env python3
"""The proposed piece set, and a mock board scene built from it.

Turned Staunton shapes after the Devcon wooden set: a domed foot, a bead ring,
a concave stem and a collar shared by the whole set, so only the top changes.
The king's finial is the Ethereum prism (as on the logo) and the knight is a
unicorn with a carved mane.

Writes pieces/*.svg (one per piece, flat ink, for reuse), pieces.svg (a sprite
of <symbol>s), scene.svg (the mock) and markers.svg (the army-marker study).
Shapes are split into PARTS so a renderer can colour one of them (the collar
band) per army: see game/README.md.
"""
import os

# ---- geometry (256 x 256 box, pieces stand on y = 248) ------------------------
FOOT = 'M48 248 C 46 232 60 222 84 220 L 172 220 C 196 222 210 232 208 248 Z'
BEAD = 'M70 220 C 66 210 74 204 86 204 L 170 204 C 182 204 190 210 186 220 Z'
STEM = 'M92 204 C 104 190 108 172 110 156 L 146 156 C 148 172 152 190 164 204 Z'
COLLAR = 'M82 158 C 78 146 88 138 100 138 L 156 138 C 168 138 178 146 174 158 Z'
# the felt pad under the foot, as on real pieces: the second place the army colour shows
FELT = 'M46 248 C 46 241 50 237 58 236 L 198 236 C 206 237 210 241 210 248 Z'

PRISM = ['M128 4 L156 50 L128 66 L100 50 Z', 'M100 57 L128 73 L156 57 L128 96 Z']
# the king's finial: the prism, lifted clear of the crown points
FINIAL = 'translate(128 0) scale(0.86) translate(-128 0)'
TOPS = {
    'king': [
        'M106 138 L150 138 L160 112 L96 112 Z',              # neck, flaring to the crown
        'M82 84 L104 100 L128 78 L152 100 L174 84 L166 112 L90 112 Z',  # crown
    ],
    'queen': [
        'M106 142 L150 142 L162 108 L94 108 Z',
        'M80 72 L102 96 L128 64 L154 96 L176 72 L166 108 L90 108 Z',
        'M128 46 a12 12 0 1 0 0.1 0 Z', 'M80 56 a9 9 0 1 0 0.1 0 Z', 'M176 56 a9 9 0 1 0 0.1 0 Z',
    ],
    'rook': [
        'M98 142 L158 142 L162 98 L94 98 Z',
        'M84 98 L172 98 L172 62 L152 62 L152 76 L138 76 L138 62 L118 62 L118 76 L104 76 L104 62 L84 62 Z',
    ],
    'bishop': [
        'M110 142 L146 142 L150 126 L106 126 Z',
        # mitre with its diagonal slit cut out
        'M128 46 C 162 70 170 104 150 126 L106 126 C 86 104 94 70 128 46 Z '
        'M140 66 L132 62 L114 98 L122 102 Z',
        'M128 26 a11 11 0 1 0 0.1 0 Z',
    ],
    'knight': [
        # unicorn: neck, head, ear, horn, with an eye and two carved mane lines cut out
        'M172 142 C 178 110 172 78 152 56 L 158 30 L 142 48 L 134 44 L 96 4 L 116 54 '
        'C 98 64 80 84 66 106 C 60 118 64 130 76 134 C 88 138 98 130 106 122 '
        'L 114 118 C 104 128 96 136 88 142 Z '
        'M124 74 a7 7 0 1 0 0.1 0 Z '
        'M152 70 C 162 92 164 116 160 136 L 154 136 C 157 116 155 94 146 74 Z '
        'M138 86 C 148 104 150 124 146 140 L 140 140 C 143 124 141 106 132 90 Z',
    ],
    'pawn': [
        'M110 142 L146 142 L140 124 L116 124 Z',
        'M128 68 a30 30 0 1 0 0.1 0 Z',
    ],
}
STACK = [FOOT, BEAD, STEM, COLLAR]


def parts(kind):
    """(role, d) pairs, back to front. Roles: wood, prism, band."""
    out = [('wood', FOOT), ('band', FELT), ('wood', BEAD), ('wood', STEM), ('band', COLLAR)]
    out += [('wood', d) for d in TOPS[kind]]
    if kind == 'king':
        out += [('prism', d) for d in PRISM]
    return out


WOODS = {
    # (light side, dark side, outline), sampled from the Devcon set
    'boxwood': ('#f6e7bf', '#caa767', '#5c4220'),
    'sheesham': ('#9a5634', '#3f1f10', '#1a0c06'),
}


def defs():
    g = []
    for name, (a, b, _) in WOODS.items():
        g.append(f'<linearGradient id="{name}" x1="0" x2="1" y1="0" y2="0">'
                 f'<stop offset="0" stop-color="{a}"/><stop offset="0.45" stop-color="{a}"/>'
                 f'<stop offset="1" stop-color="{b}"/></linearGradient>')
    g.append('<linearGradient id="prismcut" x1="0" x2="1"><stop offset="0.5" stop-color="#ffffff"/>'
             '<stop offset="0.5" stop-color="#cfd8ee"/></linearGradient>')
    g.append('<filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">'
             '<feDropShadow dx="3" dy="4" stdDeviation="3" flood-color="#000" flood-opacity="0.45"/></filter>')
    return ''.join(g)


def draw(kind, wood, band=None, glow=None):
    """One piece as SVG markup in the 256 box. band: colour of the collar band."""
    _, _, edge = WOODS[wood]
    out = []
    for role, d in parts(kind):
        if role == 'prism':
            out.append(f'<path d="{d}" transform="{FINIAL}" fill="url(#prismcut)" stroke="{edge}" stroke-width="7" '
                       f'stroke-linejoin="round" paint-order="stroke"/>')
            continue
        elif role == 'band' and band:
            fill = band
        else:
            fill = f'url(#{wood})'
        out.append(f'<path d="{d}" fill="{fill}" fill-rule="evenodd" stroke="{edge}" stroke-width="7" '
                   f'stroke-linejoin="round" paint-order="stroke"/>')
    return ''.join(out)


def flat(kind):
    return ''.join(f'<path d="{d}" fill-rule="evenodd" transform="{FINIAL}" class="prism"/>' if r == 'prism'
                   else f'<path d="{d}" fill-rule="evenodd"/>' for r, d in parts(kind))


S = 80
LIGHT, DARK = '#e2cba0', '#7a4a2c'  # maple and rosewood, sampled from the Devcon board
YOU, THEM, THIRD = '#ffd166', '#6ea8ff', '#ef6f8f'


def board(cols, rows, origin=None):
    out = []
    for r in range(rows):
        for c in range(cols):
            out.append(f'<rect x="{c*S}" y="{r*S}" width="{S}" height="{S}" fill="{LIGHT if (r+c)%2==0 else DARK}"/>')
    out.append(f'<rect width="{cols*S}" height="{rows*S}" filter="url(#grain)"/>')
    if origin:
        OX, OY = origin
        LOGO = ''.join(f'<path d="{d}"/>' for d in PRISM)
        place = f'translate({OX} {OY}) rotate(90) scale(1.7) translate(-128 -48)'
        four = [(OX - S, OY - S), (OX, OY - S), (OX - S, OY), (OX, OY)]
        light = lambda p: ((p[0] // S) + (p[1] // S)) % 2 == 0
        sq = lambda p: f'<rect x="{p[0]}" y="{p[1]}" width="{S}" height="{S}"/>'
        out.append('<clipPath id="onLight">' + ''.join(sq(p) for p in four if light(p)) + '</clipPath>')
        out.append('<clipPath id="onDark">' + ''.join(sq(p) for p in four if not light(p)) + '</clipPath>')
        out.append(f'<g clip-path="url(#onLight)"><g transform="{place}" fill="{DARK}">{LOGO}</g></g>')
        out.append(f'<g clip-path="url(#onDark)"><g transform="{place}" fill="{LIGHT}">{LOGO}</g></g>')
    return out


GRAIN = ('<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.6" numOctaves="2" seed="7"/>'
         '<feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.22  0 0 0 0 0.1  0 0 0 0.2 0"/></filter>')
VIG = ('<radialGradient id="vig" cx="50%" cy="55%" r="75%"><stop offset="0.55" stop-color="#16110d" stop-opacity="0"/>'
       '<stop offset="1" stop-color="#16110d" stop-opacity="0.8"/></radialGradient>')


def put(kind, c, r, army, mine, marker='band'):
    """A piece on square (c, r). marker: how the army shows (band, glow, both)."""
    x, y = c * S, r * S
    k = (S - 8) / 256
    pre = ''
    if marker in ('glow', 'both'):
        gid = f'g{army[1:]}'
        pre = (f'<radialGradient id="{gid}-{c}-{r}" cx="50%" cy="50%" r="50%">'
               f'<stop offset="0" stop-color="{army}" stop-opacity="0.95"/><stop offset="1" stop-color="{army}" stop-opacity="0"/></radialGradient>'
               f'<ellipse cx="{x+S/2}" cy="{y+S-12}" rx="{S*0.46}" ry="{S*0.2}" fill="url(#{gid}-{c}-{r})"/>')
    band = army if marker in ('band', 'both') else None
    wood = 'boxwood' if mine else 'sheesham'
    return pre + (f'<g filter="url(#shadow)" transform="translate({x+4} {y+2}) scale({k})">'
                  f'{draw(kind, wood, band)}</g>')


def scene(marker, cols=12, rows=7):
    W, H = cols * S, rows * S
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
           '<defs>', defs(), GRAIN, VIG, '</defs>']
    out += board(cols, rows, origin=(6 * S, 4 * S))
    for c, r in [(6, 2), (7, 3)]:
        out.append(f'<rect x="{c*S+5}" y="{r*S+5}" width="{S-10}" height="{S-10}" rx="8" fill="none" stroke="#c0392b" stroke-width="4" stroke-dasharray="10 8" opacity="0.85"/>')
    out.append(f'<path d="M{3*S+S/2} {5*S+S/2} L{6*S+S/2-8} {2*S+S/2+8}" stroke="#1a0c06" stroke-width="5" stroke-dasharray="3 10" stroke-linecap="round" fill="none"/>')
    you = [('rook', 0, 5), ('knight', 1, 4), ('king', 2, 5), ('queen', 3, 5), ('bishop', 3, 4),
           ('pawn', 1, 3), ('pawn', 2, 3), ('pawn', 3, 3), ('pawn', 4, 4)]
    them = [('pawn', 7, 1), ('queen', 8, 1), ('king', 9, 1), ('rook', 11, 1), ('pawn', 7, 2), ('bishop', 8, 2),
            ('knight', 10, 2), ('pawn', 9, 3), ('pawn', 10, 3)]
    third = [('pawn', 9, 5), ('knight', 10, 5), ('king', 11, 6), ('pawn', 10, 6)]
    for k, c, r in you: out.append(put(k, c, r, YOU, True, marker))
    for k, c, r in them: out.append(put(k, c, r, THEM, False, marker))
    for k, c, r in third: out.append(put(k, c, r, THIRD, False, marker))
    out.append(f'<rect width="{W}" height="{H}" fill="url(#vig)"/>')
    out.append('</svg>')
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    os.makedirs('pieces', exist_ok=True)
    for k in TOPS:
        open(f'pieces/{k}.svg', 'w').write(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" style="color: #1b1410">'
            f'<style>.prism{{fill:#f5b83d}}</style><g fill="currentColor">{flat(k)}</g></svg>\n')
    syms = ''.join(f'<symbol id="{k}" viewBox="0 0 256 256">{flat(k)}</symbol>' for k in TOPS)
    open('pieces.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg">{syms}</svg>\n')

    # the set, in both woods
    order = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']
    W = 256 * 6
    row = lambda wood, y: ''.join(f'<g transform="translate({i*256} {y})">{draw(k, wood, YOU if wood == "boxwood" else THEM)}</g>'
                                  for i, k in enumerate(order))
    open('set.svg', 'w').write(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="540" viewBox="0 0 {W} 540">'
        f'<defs>{defs()}</defs><rect width="{W}" height="540" fill="#f6efe4"/>'
        f'<g transform="translate(0 10)">{row("boxwood", 0)}</g><g transform="translate(0 280)">{row("sheesham", 0)}</g></svg>\n')

    open('scene.svg', 'w').write(scene('both'))
    for m in ('band', 'both'):
        open(f'/tmp/markers-{m}.svg', 'w').write(scene(m))
