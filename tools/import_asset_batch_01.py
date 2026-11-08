"""Import the user-provided batch without executing archive contents.

Checks the pinned archive hash, all 26 file hashes and exact canvas sizes.
Does not claim artistic approval and does not replace project README/AGENTS.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import urllib.request
import zipfile
from PIL import Image

URL = 'https://media.base44.com/files/public/6af0cf8f1e7c1043015802ed/7da967f9f_gold-traitors-batch-01.zip'
ARCHIVE_SHA256 = '599f4228f7c1a26f2b71d455f86fce47b3149630f50b49a28ccb29a4069d78e5'
META = {
    'tunnel-straight-ns': ('Прямой проход', [['N','S']]),
    'tunnel-straight-ew': ('Поперечный проход', [['E','W']]),
    'tunnel-turn-ne': ('Поворот', [['N','E']]),
    'tunnel-turn-nw': ('Поворот', [['N','W']]),
    'tunnel-tee-nes': ('Развилка', [['N','E','S']]),
    'tunnel-tee-new': ('Развилка', [['N','E','W']]),
    'tunnel-cross': ('Перекрёсток', [['N','E','S','W']]),
    'tunnel-dead-end-n': ('Тупик', [['N']]),
    'tunnel-dead-end-e': ('Тупик', [['E']]),
    'tunnel-separated-n-s': ('Раздельные тупики', [['N'],['S']]),
    'tunnel-separated-e-w': ('Раздельные тупики', [['E'],['W']]),
    'action-break-pickaxe': ('Сломанная кирка', None),
    'action-repair-pickaxe': ('Ремонт кирки', None),
}

def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()

def prepare(raw: bytes) -> tuple[dict[str, bytes], list[dict]]:
    if sha256(raw) != ARCHIVE_SHA256:
        raise ValueError('Archive SHA-256 mismatch; nothing will be imported')
    files, entries = {}, []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        inventory = json.loads(archive.read('data/local-inventory.json'))
        if len(inventory) != 13 or {a['id'] for a in inventory} != set(META):
            raise ValueError('Unexpected asset inventory')
        for item in inventory:
            asset_id = item['id']
            label, components = META[asset_id]
            entry = {'id': asset_id, 'labelRu': label,
                     'kind': 'tunnel' if components else 'action',
                     'status': 'draft', 'embeddedText': False, 'batch': '01',
                     'source': 'art-source/batch-01-source-atlas.png', 'variants': []}
            if components:
                entry.update(components=components,
                             ports=[p for p in 'NESW' if any(p in c for c in components)],
                             allowedRotations=[0, 180])
            for key, purpose, dims in [('image', 'standard', (512,768)), ('compact', 'compact', (256,384))]:
                expected = item[key]
                name = expected['path']
                pp = PurePosixPath(name)
                if not name.startswith('assets/cards/') or pp.is_absolute() or '..' in pp.parts:
                    raise ValueError('Unsafe asset path')
                data = archive.read(name)
                if len(data) != expected['bytes'] or sha256(data) != expected['sha256']:
                    raise ValueError('Asset bytes or checksum mismatch: ' + name)
                with Image.open(io.BytesIO(data)) as image:
                    if image.format != 'WEBP' or image.size != dims:
                        raise ValueError('Unexpected dimensions/format: ' + name)
                    image.load()
                blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
                entry['variants'].append({'purpose': purpose, 'path': name, 'format': 'webp',
                    'width': dims[0], 'height': dims[1], 'bytes': len(data),
                    'sha256': sha256(data), 'gitBlobSha': blob})
                files[name] = data
            entries.append(entry)
        for name in ['art-source/batch-01-source-atlas.png', 'docs/previews/batch-01-contact-sheet.jpg']:
            files[name] = archive.read(name)
        files['data/batch-01-inventory.json'] = archive.read('data/local-inventory.json')
    return files, entries

def install(root: Path, files: dict[str,bytes], entries: list[dict]) -> None:
    root = root.resolve()
    manifest_path = root/'data/asset-manifest.json'
    manifest = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {
        'schemaVersion': 1, 'project': 'Золото и предатели', 'specVersion': '0.1',
        'cardExportTarget': {'width':512,'height':768,'aspectRatio':'2:3',
                             'embeddedText':False,'preferredFormat':'webp'}, 'assets': []}
    ids = {e['id'] for e in entries}
    manifest['assets'] = [e for e in manifest['assets'] if e['id'] not in ids] + entries
    manifest['packStatus'] = 'partial-draft'
    manifest['note'] = 'Партия 01: 13 рисунков, 26 проверенных WebP. Это черновой набор, а не полный ассет-пак. Остальные изображения ещё не поставлены.'
    for name, data in files.items():
        dest = root/name
        if not dest.resolve().is_relative_to(root):
            raise ValueError('Destination escapes repository')
        if dest.exists() and dest.read_bytes() != data:
            raise ValueError('Refusing to overwrite different existing asset: ' + name)
    for name, data in files.items():
        dest = root/name
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(data)
    manifest_path.parent.mkdir(parents=True,exist_ok=True)
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf-8')
    report = {'batch':'01', 'archiveSha256':ARCHIVE_SHA256,'assets':len(entries),
              'webpFiles':26,'webpBytes':sum(v['bytes'] for e in entries for v in e['variants']),
              'checks':78,'result':'pass','artisticStatus':'draft','fullPackComplete':False}
    (root/'data/batch-01-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
    text = '''# Партия 01 — файлы импортированы и проверены\n\n13 отдельных рисунков, 26 WebP: 512 × 768 и 256 × 384.\n11 геометрий туннелей и две карты действий (поломка/ремонт кирки).\nВсе игровые изображения без встроенных подписей.\n\nПроверены размеры, число байтов и SHA-256 каждого файла: 78 проверок.\nОсновные изображения: 494 574 байт; компактные: 170 392 байт; вместе: 664 966 байт.\nИсходник, превью и документы считаются отдельно и не загружаются в игру.\n\nФайлы находятся в assets/cards/, реестр — data/asset-manifest.json.\nПроверочный лист — docs/previews/batch-01-contact-sheet.jpg.\nПроисхождение: созданные в этой беседе изображения и подготовленный из них черновой пакет.\nСборный исходник art-source/batch-01-source-atlas.png имеет ячейки 512 × 768; это не исходник повышенного разрешения.\n\n## Ограничения\n\nСтатус графики — draft, не финальная художественная приёмка.\nТехническая проверка не доказывает качество рисунка, бесшовность всех комбинаций или баланс игры.\nДругие действия, старт/цели, роли, награды, рубашки, фоны, бренд и игра ещё не поставлены.\nНельзя считать это полным комплектом или увеличивать компактные файлы вместо основных.\n\nИмпортёр не изменяет README/AGENTS и не исполняет файлы архива.\nАрхив принимается только при совпадении заранее закреплённого SHA-256.\n'''
    (root/'docs').mkdir(exist_ok=True)
    for name in ['ASSET_UPLOAD_STATUS.md','ASSET_QA_REPORT.md']:
        (root/'docs'/name).write_text(text,'utf-8')

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path)
    parser.add_argument('--root',type=Path,default=Path.cwd())
    args = parser.parse_args()
    if args.archive:
        raw = args.archive.read_bytes()
    else:
        request = urllib.request.Request(URL,headers={'User-Agent':'GoldTraitorsAssetImport/1.0'})
        with urllib.request.urlopen(request,timeout=60) as response:
            raw = response.read(8_000_001)
        if len(raw) > 8_000_000:
            raise ValueError('Archive exceeds size limit')
    files, entries = prepare(raw)
    install(args.root,files,entries)
    print('PASS: 13 assets, 26 WebP, 78 file checks, 664966 runtime bytes')

if __name__ == '__main__':
    main()
