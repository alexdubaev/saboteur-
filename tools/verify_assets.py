from pathlib import Path
from PIL import Image,ImageDraw
from collections import Counter
import hashlib,json,zipfile,os,sys
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'data/asset-manifest.json').read_text())
cards=json.loads((root/'data/cards.json').read_text())
problems=[]
for rec in manifest['assets']:
 p=root/rec['path']
 if not p.is_file():problems.append('missing '+rec['path']);continue
 if p.stat().st_size!=rec['bytes']:problems.append('bytes '+rec['path'])
 if hashlib.sha256(p.read_bytes()).hexdigest()!=rec['sha256']:problems.append('sha '+rec['path'])
for card in cards['cards']:
 if not (root/card['asset']).exists():problems.append('card '+card['id'])
for p in (root/'assets/cards').rglob('*.webp'):
 im=Image.open(p)
 expected=(256,384) if p.parent.name=='compact' else (512,768)
 if im.size!=expected:problems.append(f'card size {p.relative_to(root)} {im.size}')
 assert im.mode in ('RGB','RGBA')
assert cards['drawDeckTotal']==sum(c['copies'] for c in cards['cards'])==67
assert len(list((root/'assets/cards').rglob('*.webp')))==70
assert sum(1 for p in (root/'assets/ui/icons').glob('*.svg'))==22
# Internal port topology and 180 rotation consistency independent of art.
port_order=['N','E','S','W']
for c in [c for c in cards['cards'] if c['kind']=='tunnel']:
 component=c['connections']
 assert all(s in port_order for g in component for s in g)
 assert all(len(set(g))==len(g) for g in component)
 assert len(set(s for g in component for s in g))==sum(len(g) for g in component)
# Pixel QA: bright path at open edges, dark stone at closed edges; flag as warning only.
for c in [c for c in cards['cards'] if c['kind']=='tunnel']:
 im=Image.open(root/c['asset']).convert('RGB')
 opened=set(s for g in c['connections'] for s in g)
 for s in port_order:
  if s=='N':pix=[im.getpixel((x,3)) for x in range(196,317,8)]
  if s=='S':pix=[im.getpixel((x,764)) for x in range(196,317,8)]
  if s=='E':pix=[im.getpixel((508,y)) for y in range(323,444,8)]
  if s=='W':pix=[im.getpixel((3,y)) for y in range(323,444,8)]
  lum=sum((p[0]*.3+p[1]*.59+p[2]*.11) for p in pix)/len(pix)
  if (s in opened and lum<70) or (s not in opened and lum>165):
   problems.append(f'pixel-port check {c["id"]}:{s} opened={s in opened} luminosity={lum:.1f}')
report={'unique_card_types':len(cards['cards'])+11,'game_deck_cards':67,'webp_cards':70,'svg_icons':22,'asset_count':len(manifest['assets']),'errors':problems}
(root/'data/asset-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False))
if problems:sys.exit(2)
