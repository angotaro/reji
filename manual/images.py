"""Makes the manual's images (manual/img/*.jpg) from the end-to-end test screenshots (tests/shots/).
Run `node tests/e2e.mjs` first, then `python3 manual/images.py`, then `node manual/build.mjs`."""
import os, re
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, '..', 'tests', 'shots')
OUT = os.path.join(HERE, 'img')

# name in the manual → (screenshot, height to keep from the top). Phone screenshots are long pages.
CROPS = {
    '12-phone-register': ('12-phone-register', 1687), '13-phone-sheet': ('13-phone-sheet', 1687),
    '14-pay-ready': ('14-pay-ready', 1829), '15-pay-connected': ('15-pay-connected', 1852), '16-pay-done': ('16-pay-done', 2492),
    '19-pay-nowallet': ('19-pay-nowallet', 1150), '18-receipt-itemized': ('18-receipt-itemized', 1300),
    '14-pay-brand': ('14-pay-ready', 1050), '18-receipt-brand': ('18-receipt-itemized', 1300),
    '20-sign-page': ('20-sign-page', 1687), '20-store-page': ('20-store-page', 1560), '22-pop': ('22-pop', 1173),
    '21-receipt-addressee': ('21-receipt-addressee', 1500), '33-offline-banner': ('33-offline-banner', 300), '23-store-tip': ('23-store-tip', 1250), '24-tip-done': ('24-tip-done', 1480),
}

def main():
    os.makedirs(OUT, exist_ok=True)
    names = sorted(set(re.findall(r'src="img/([^"]+)\.jpg"', open(os.path.join(HERE, 'runbook.html'), encoding='utf-8').read())))
    for name in names:
        src, keep = CROPS.get(name, (name, None))
        im = Image.open(os.path.join(SHOTS, f'{src}.png')).convert('RGB')
        if keep: im = im.crop((0, 0, im.size[0], min(keep, im.size[1])))
        w, h = im.size
        target = 960 if w > h else 440  # landscape (tablet) / portrait (phone)
        if w > target: im = im.resize((target, round(h * target / w)), Image.LANCZOS)
        im.save(os.path.join(OUT, f'{name}.jpg'), quality=82, optimize=True, progressive=True)
    print(f'{len(names)} images written to manual/img/')

if __name__ == '__main__':
    main()
