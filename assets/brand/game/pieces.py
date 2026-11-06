#!/usr/bin/env python3
"""The proposed piece set, and a mock board scene built from it.

Every piece shares the logo's lower stack (base, stem, collar), so the set reads
as one family with the mark; only the top changes. Writes pieces.svg (a sprite
sheet of <symbol>s), one SVG per piece, and scene.svg (the mock).
"""
STACK = ('<rect x="92" y="158" width="72" height="14" rx="4"/>'
         '<path d="M106 178 L150 178 Q152 204 170 222 L86 222 Q104 204 106 178 Z"/>'
         '<rect x="62" y="228" width="132" height="20" rx="6"/>')
PRISM = ('<g class="prism"><path d="M128 4 L155 48 L128 63 L101 48 Z"/>'
         '<path d="M101 55 L128 70 L155 55 L128 92 Z"/></g>')
TOPS = {
    'king': PRISM + '<path d="M74 98 L100 122 L128 94 L156 122 L182 98 L170 152 L86 152 Z"/>',
    'queen': ('<circle cx="128" cy="58" r="12"/><circle cx="84" cy="80" r="10"/><circle cx="172" cy="80" r="10"/>'
              '<path d="M80 92 L102 118 L128 74 L154 118 L176 92 L166 152 L90 152 Z"/>'),
    'rook': '<path d="M80 70 L104 70 L104 88 L118 88 L118 70 L138 70 L138 88 L152 88 L152 70 L176 70 L176 104 L162 116 L162 152 L94 152 L94 116 L80 104 Z"/>',
    'bishop': ('<circle cx="128" cy="44" r="12"/>'
               '<path d="M128 60 C 162 84 168 118 150 152 L106 152 C 88 118 94 84 128 60 Z M131 80 L124 80 L118 118 L125 118 Z" fill-rule="evenodd"/>'),
    'knight': ('<path fill-rule="evenodd" d="M168 152 C 174 116 168 80 150 58 L 154 34 L 140 50 '
               'L 132 46 L 98 6 L 116 56 C 100 66 84 84 70 104 C 64 114 66 126 76 130 '
               'C 86 134 96 128 104 120 L 112 116 C 104 128 96 140 90 152 Z '
               'M126 74 a6 6 0 1 0 0.1 0 Z '
               'M150 72 C 158 92 160 116 156 140 L 152 140 C 155 116 153 94 146 76 Z '
               'M138 86 C 146 104 148 124 144 146 L 140 146 C 143 124 141 106 134 90 Z"/>'),
    'pawn': '<circle cx="128" cy="112" r="30"/><path d="M104 136 L152 136 L160 152 L96 152 Z"/>',
}
def piece(kind):
    return TOPS[kind] + STACK

if __name__ == '__main__':
    import os
    os.makedirs('pieces', exist_ok=True)
    for k in TOPS:
        open(f'pieces/{k}.svg', 'w').write(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" style="color: #1b1410">'
            f'<style>.prism{{fill:#f5b83d}}</style><g fill="currentColor">{piece(k)}</g></svg>\n')
    syms = ''.join(f'<symbol id="{k}" viewBox="0 0 256 256">{piece(k)}</symbol>' for k in TOPS)
    open('pieces.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg">{syms}</svg>\n')

    # ---- mock scene: 12 x 7 squares around the origin -------------------------
    S = 80; COLS, ROWS = 12, 7; W, H = COLS * S, ROWS * S
    LIGHT, DARK = '#e2cba0', '#7a4a2c'  # maple and rosewood, sampled from the Devcon board
    # origin corner (where four squares meet) at column 6, row 4 boundary
    OX, OY = 6 * S, 4 * S
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
           '<defs>', syms.replace('<symbol', '<symbol').replace('class="prism"', 'class="prism"'),
           '<radialGradient id="vig" cx="50%" cy="55%" r="75%"><stop offset="0.55" stop-color="#16110d" stop-opacity="0"/>'
           '<stop offset="1" stop-color="#16110d" stop-opacity="0.85"/></radialGradient>',
           '<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.6" numOctaves="2" seed="7"/>'
           '<feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.22  0 0 0 0 0.1  0 0 0 0.22 0"/></filter>',
           '<filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.45"/></filter>',
           '</defs>']
    for r in range(ROWS):
        for c in range(COLS):
            out.append(f'<rect x="{c*S}" y="{r*S}" width="{S}" height="{S}" fill="{LIGHT if (r+c)%2==0 else DARK}"/>')
    out.append(f'<rect width="{W}" height="{H}" filter="url(#grain)"/>')
    # The Devcon inlay: the Ethereum logo lying on its side across the four
    # centre squares, in INVERTED marquetry: maple where it crosses rosewood,
    # rosewood where it crosses maple. Drawn twice, each copy clipped to one
    # colour of square around the origin corner.
    LOGO = ('<path d="M128 4 L155 48 L128 63 L101 48 Z"/><path d="M128 4 L128 63 L101 48 Z" opacity="0.82"/>'
            '<path d="M101 55 L128 70 L155 55 L128 92 Z"/><path d="M101 55 L128 70 L128 92 Z" opacity="0.82"/>')
    place = f'translate({OX} {OY}) rotate(90) scale(1.7) translate(-128 -48)'
    tl, tr = (OX - S, OY - S), (OX, OY - S)
    bl, br = (OX - S, OY), (OX, OY)
    def sq(p): return f'<rect x="{p[0]}" y="{p[1]}" width="{S}" height="{S}"/>'
    # which of the four are light: (r+c) even, with c = x/S, r = y/S
    def light(p): return ((p[0] // S) + (p[1] // S)) % 2 == 0
    four = [tl, tr, bl, br]
    out.append('<clipPath id="onLight">' + ''.join(sq(p) for p in four if light(p)) + '</clipPath>')
    out.append('<clipPath id="onDark">' + ''.join(sq(p) for p in four if not light(p)) + '</clipPath>')
    out.append(f'<g clip-path="url(#onLight)"><g transform="{place}" fill="{DARK}">{LOGO}</g></g>')
    out.append(f'<g clip-path="url(#onDark)"><g transform="{place}" fill="{LIGHT}">{LOGO}</g></g>')
    YOU, THEM = '#ffd166', '#8fb8ff'  # army colours, shown on the base rim
    BOXWOOD, SHEESHAM = '#ecd8a4', '#5a2f1c'
    def put(kind, c, r, col, mine=False):
        x, y = c * S, r * S
        k = (S - 12) / 256
        ring = (f'<ellipse cx="{x+S/2}" cy="{y+S-10}" rx="{S*0.38}" ry="{S*0.12}" fill="{col}" opacity="0.95" stroke="#2a1d14" stroke-width="2"/>')
        prism_fill = '#f4f7ff'  # crystal on every army, so it never melts into a gold body
        body = piece(kind).replace('<g class="prism">', f'<g fill="{prism_fill}">')
        wood = BOXWOOD if mine else SHEESHAM
        edge = '#3a2414' if mine else '#1a0e08'
        return (ring + f'<g filter="url(#shadow)" transform="translate({x+6} {y+2}) scale({k})" fill="{wood}" '
                f'stroke="{edge}" stroke-width="10" stroke-linejoin="round" paint-order="stroke">{body}</g>')
    # your army (gold) bottom left, theirs (blue) top right; a few attacked squares
    for c, r in [(6, 2), (7, 3)]:
        out.append(f'<rect x="{c*S+4}" y="{r*S+4}" width="{S-8}" height="{S-8}" rx="8" fill="none" stroke="#c0392b" stroke-width="4" stroke-dasharray="10 8" opacity="0.8"/>')
    out.append(f'<path d="M{3*S+S/2} {5*S+S/2} L{6*S+S/2-8} {2*S+S/2+8}" stroke="#2a1d14" stroke-width="5" stroke-dasharray="3 10" stroke-linecap="round" fill="none"/>')
    pieces_you = [('king', 2, 5), ('queen', 3, 5), ('knight', 1, 4), ('bishop', 3, 4), ('rook', 0, 5), ('pawn', 1, 3), ('pawn', 2, 3), ('pawn', 3, 3), ('pawn', 4, 4)]
    pieces_them = [('king', 9, 1), ('queen', 8, 1), ('knight', 10, 2), ('rook', 11, 1), ('bishop', 8, 2), ('pawn', 7, 2), ('pawn', 9, 3), ('pawn', 10, 3), ('pawn', 7, 1)]
    for k, c, r in pieces_you: out.append(put(k, c, r, YOU, True))
    for k, c, r in pieces_them: out.append(put(k, c, r, THEM))
    out.append(f'<rect width="{W}" height="{H}" fill="url(#vig)"/>')
    out.append('</svg>')
    open('scene.svg', 'w').write('\n'.join(out) + '\n')
