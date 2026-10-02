#!/usr/bin/env python3
"""Builds Reji Dot: the register's own dot-matrix font for prices and numbers.

Every character sits on a 5 x 7 dot grid (two more rows below for descenders) and
is 6 dots wide, so amounts line up in columns. It covers ASCII, ¥ and ×; Japanese
text falls through to the device's own fonts. MIT licensed, like the rest of Reji.

    python3 tools/make-dot-font.py      ->  assets/fonts/reji-dot.woff
"""
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

PX = 110        # one dot, in font units (1000 per em)
ADV = 6 * PX    # advance width: 5 dots + 1 dot of spacing
LSB = PX // 2   # half a dot on each side
OVERLAP = 1     # rows overlap by one unit so no hairline seams show between them

# '#' = dot. Rows run top to bottom; rows 8 and 9 (if present) hang below the baseline.
SRC = r"""
0 .###. #...# #...# #...# #...# #...# .###.
1 ..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.
2 .###. #...# ....# ...#. ..#.. .#... #####
3 .###. #...# ....# ..##. ....# #...# .###.
4 ...#. ..##. .#.#. #..#. ##### ...#. ...#.
5 ##### #.... ####. ....# ....# #...# .###.
6 ..##. .#... #.... ####. #...# #...# .###.
7 ##### ....# ...#. ..#.. .#... .#... .#...
8 .###. #...# #...# .###. #...# #...# .###.
9 .###. #...# #...# .#### ....# ...#. .##..
A .###. #...# #...# ##### #...# #...# #...#
B ####. #...# #...# ####. #...# #...# ####.
C .###. #...# #.... #.... #.... #...# .###.
D ####. #...# #...# #...# #...# #...# ####.
E ##### #.... #.... ####. #.... #.... #####
F ##### #.... #.... ####. #.... #.... #....
G .###. #...# #.... #.### #...# #...# .####
H #...# #...# #...# ##### #...# #...# #...#
I .###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.
J ..### ...#. ...#. ...#. ...#. #..#. .##..
K #...# #..#. #.#.. ##... #.#.. #..#. #...#
L #.... #.... #.... #.... #.... #.... #####
M #...# ##.## #.#.# #.#.# #...# #...# #...#
N #...# #...# ##..# #.#.# #..## #...# #...#
O .###. #...# #...# #...# #...# #...# .###.
P ####. #...# #...# ####. #.... #.... #....
Q .###. #...# #...# #...# #.#.# #..#. .##.#
R ####. #...# #...# ####. #.#.. #..#. #...#
S .#### #.... #.... .###. ....# ....# ####.
T ##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..
U #...# #...# #...# #...# #...# #...# .###.
V #...# #...# #...# #...# #...# .#.#. ..#..
W #...# #...# #...# #.#.# #.#.# #.#.# .#.#.
X #...# #...# .#.#. ..#.. .#.#. #...# #...#
Y #...# #...# .#.#. ..#.. ..#.. ..#.. ..#..
Z ##### ....# ...#. ..#.. .#... #.... #####
a ..... ..... .###. ....# .#### #...# .####
b #.... #.... ####. #...# #...# #...# ####.
c ..... ..... .###. #.... #.... #...# .###.
d ....# ....# .#### #...# #...# #...# .####
e ..... ..... .###. #...# ##### #.... .###.
f ..##. .#..# .#... ###.. .#... .#... .#...
g ..... ..... .#### #...# #...# #...# .#### ....# .###.
h #.... #.... #.##. ##..# #...# #...# #...#
i ..#.. ..... .##.. ..#.. ..#.. ..#.. .###.
j ...#. ..... ..##. ...#. ...#. ...#. ...#. #..#. .##..
k #.... #.... #..#. #.#.. ##... #.#.. #..#.
l .##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.
m ..... ..... ##.#. #.#.# #.#.# #.#.# #.#.#
n ..... ..... #.##. ##..# #...# #...# #...#
o ..... ..... .###. #...# #...# #...# .###.
p ..... ..... ####. #...# #...# #...# ####. #.... #....
q ..... ..... .#### #...# #...# #...# .#### ....# ....#
r ..... ..... #.##. ##..# #.... #.... #....
s ..... ..... .#### #.... .###. ....# ####.
t .#... .#... ###.. .#... .#... .#..# ..##.
u ..... ..... #...# #...# #...# #..## .##.#
v ..... ..... #...# #...# #...# .#.#. ..#..
w ..... ..... #...# #...# #.#.# #.#.# .#.#.
x ..... ..... #...# .#.#. ..#.. .#.#. #...#
y ..... ..... #...# #...# #...# #...# .#### ....# .###.
z ..... ..... ##### ...#. ..#.. .#... #####
¥ #...# .#.#. ##### ..#.. ##### ..#.. ..#..
× ..... #...# .#.#. ..#.. .#.#. #...# .....
, ..... ..... ..... ..... ..... .##.. .##.. ..#.. .#...
. ..... ..... ..... ..... ..... .##.. .##..
: ..... .##.. .##.. ..... .##.. .##.. .....
; ..... .##.. .##.. ..... .##.. .##.. ..#.. .#...
- ..... ..... ..... .###. ..... ..... .....
+ ..... ..#.. ..#.. ##### ..#.. ..#.. .....
= ..... ..... ##### ..... ##### ..... .....
% ##... ##..# ...#. ..#.. .#... #..## ...##
/ ..... ....# ...#. ..#.. .#... #.... .....
( ...#. ..#.. .#... .#... .#... ..#.. ...#.
) .#... ..#.. ...#. ...#. ...#. ..#.. .#...
[ .###. .#... .#... .#... .#... .#... .###.
] .###. ...#. ...#. ...#. ...#. ...#. .###.
# .#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.
* ..... ..#.. #.#.# .###. #.#.# ..#.. .....
! ..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..
? .###. #...# ....# ...#. ..#.. ..... ..#..
' ..#.. ..#.. .#... ..... ..... ..... .....
" .#.#. .#.#. .#.#. ..... ..... ..... .....
_ ..... ..... ..... ..... ..... ..... ..... #####
& .##.. #..#. #.#.. .#... #.#.# #..#. .##.#
$ ..#.. .#### #.#.. .###. ..#.# ####. ..#..
@ .###. #...# ....# .##.# #.#.# #.#.# .###.
< ...#. ..#.. .#... #.... .#... ..#.. ...#.
> .#... ..#.. ...#. ....# ...#. ..#.. .#...
| ..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..
"""
ALIASES = {'\uffe5': '¥', '\uff0c': ',', '\uff0e': '.'}  # full-width yen and punctuation reuse the same dots


def parse():
    glyphs = {}
    for line in SRC.strip().splitlines():
        ch, *rows = line.split()
        assert all(len(r) == 5 for r in rows) and len(rows) in (7, 8, 9), line
        glyphs[ch] = rows
    return glyphs


def draw(rows):
    pen = TTGlyphPen(None)
    for r, row in enumerate(rows):
        top, bottom = (7 - r) * PX, (6 - r) * PX
        c = 0
        while c < 5:
            if row[c] != '#':
                c += 1
                continue
            start = c
            while c < 5 and row[c] == '#':
                c += 1
            x0, x1 = LSB + start * PX, LSB + c * PX
            y0, y1 = bottom - OVERLAP, top + OVERLAP
            pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()  # clockwise
    return pen.glyph()


def build(out):
    glyphs = parse()
    name = lambda ch: 'space' if ch == ' ' else f'uni{ord(ch):04X}'
    order = ['.notdef', 'space'] + [name(ch) for ch in glyphs]
    shapes = {'.notdef': TTGlyphPen(None).glyph(), 'space': TTGlyphPen(None).glyph()}
    metrics = {'.notdef': (ADV, 0), 'space': (ADV, 0)}
    cmap = {0x20: 'space', 0xA0: 'space'}
    for ch, rows in glyphs.items():
        shapes[name(ch)] = draw(rows)
        cols = [c for row in rows for c in range(5) if row[c] == '#']
        metrics[name(ch)] = (ADV, LSB + min(cols) * PX)
        cmap[ord(ch)] = name(ch)
    for alias, ch in ALIASES.items():
        cmap[ord(alias)] = name(ch)
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(shapes)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=880, descent=-240)
    fb.setupNameTable({
        'familyName': 'Reji Dot', 'styleName': 'Regular', 'fullName': 'Reji Dot', 'psName': 'RejiDot-Regular',
        'uniqueFontIdentifier': 'Reji Dot Regular 1.000', 'version': 'Version 1.000',
        'copyright': '(c) 2026 Reji contributors', 'licenseDescription': 'MIT License, the same as Reji',
    })
    fb.setupOS2(sTypoAscender=880, sTypoDescender=-240, sTypoLineGap=0, usWinAscent=900, usWinDescent=260,
                sxHeight=5 * PX, sCapHeight=7 * PX, achVendID='REJI', fsType=0, usWeightClass=400)
    fb.setupPost(isFixedPitch=1)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fb.font.flavor = 'woff'
    fb.save(out)
    return fb.font, len(glyphs)


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', 'assets', 'fonts', 'reji-dot.woff')
    font, n = build(out)
    print(f'Reji Dot: {n} characters -> {os.path.relpath(out)} ({os.path.getsize(out)} bytes)')
