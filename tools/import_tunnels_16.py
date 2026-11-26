"""Install the verified 16-tunnel bundle in a clean project checkout. Python 3.9+."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

ARCHIVE_SHA256 = '972a0b21b71e7d9fd832f11f817949a85d8555841254c77aa3c8042ced588bd4'


def digest(blob):
    return hashlib.sha256(blob).hexdigest()


def encode(obj):
    return (json.dumps(obj, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def prepare(archive, repo):
    if digest(archive.read_bytes()) != ARCHIVE_SHA256:
        raise ValueError('Archive SHA-256 does not match the approved 16-tunnel bundle')
    cards_path = 'data/cards.json'
    manifest_path = 'data/asset-manifest.json'
    cards = json.loads((repo / cards_path).read_text(encoding='utf-8'))
    assets = json.loads((repo / manifest_path).read_text(encoding='utf-8'))
    files = {}
    with ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError('ZIP integrity error')
        tm = json.loads(z.read('tunnel-manifest.json'))
        qa = json.loads(z.read('qa-results.json'))
        if qa['errors'] or any(v['visualConnectivityIssues'] for v in qa['results'].values()):
            raise ValueError('Tunnel QA failed')
        rows = tm['assets']
        if len(rows) != 16 or len({a['id'] for a in rows}) != 16 or sum(a['copies'] for a in rows) != 40:
            raise ValueError('Unexpected deck composition')
        new_cards, new_assets = [], []
        for a in rows:
            name = a['id']
            source = z.read(a['source'])
            if digest(source) != a['sourceSha256']:
                raise ValueError(name + ' source hash mismatch')
            a['source'] = f'art-source/tunnels/{name}.png'
            files[a['source']] = source
            variants = {v['purpose']: v for v in a['variants']}
            if set(variants) != {'standard', 'compact'}:
                raise ValueError(name + ' variants mismatch')
            for purpose, directory, size in [('standard', 'tunnels', (512, 768)), ('compact', 'compact', (256, 384))]:
                v = variants[purpose]
                path = f'assets/cards/{directory}/{name}.webp'
                if v['path'] != path or (v['width'], v['height']) != size:
                    raise ValueError(name + ' path or dimensions mismatch')
                b = z.read(path)
                if digest(b) != v['sha256'] or len(b) != v['bytes']:
                    raise ValueError(name + ' WebP hash or size mismatch')
                files[path] = b
                new_assets.append({k: v[k] for k in ('path','bytes','sha256','width','height')})
            new_cards.append(dict(id=name, kind='tunnel', copies=a['copies'], connections=a['components'],
                                  allowedRotations=a['allowedRotations'], asset=variants['standard']['path']))
        actions = [c for c in cards['cards'] if c['kind'] != 'tunnel']
        if sum(c['copies'] for c in actions) != 27:
            raise ValueError('Existing action deck differs; review manually, do not overwrite')
        cards['cards'] = new_cards + actions
        cards['drawDeckTotal'] = sum(c['copies'] for c in cards['cards'])
        cards['notes'] = '16 tunnel geometries, 40 tunnel cards; action deck unchanged. Playtest before launch.'
        # Keep every non-tunnel asset and replace the old tunnel records.
        old_other = [a for a in assets['assets'] if not (
            a['path'].startswith('assets/cards/tunnels/') or
            a['path'].startswith('assets/cards/compact/tunnel-'))]
        assets['assets'] = sorted(old_other + new_assets, key=lambda a: a['path'])
        assets['cardFileCount'] = sum(a['path'].startswith('assets/cards/') and a['path'].endswith('.webp') for a in assets['assets'])
        assets['cardArtworkCount'] = sum(a['path'].startswith('assets/cards/') and not a['path'].startswith('assets/cards/compact/') and a['path'].endswith('.webp') for a in assets['assets'])
        assets['release'] = 'asset-production-candidate-tunnels-16'
        assets['approvedForCommercialLaunch'] = False
        files[cards_path] = encode(cards)
        files[manifest_path] = encode(assets)
        files['data/tunnel-manifest.json'] = encode(tm)
        files['data/tunnel-qa-results.json'] = encode(qa)
        files['docs/previews/tunnels-16.jpg'] = z.read('preview.jpg')
        files['docs/TUNNEL_QA_16.md'] = z.read('README.md') + b'\n\nRepository layout after import: `art-source/tunnels/`, `data/tunnel-manifest.json`, `docs/previews/tunnels-16.jpg`. The original archive layout and historical GitHub status in the source report are not current status.\n'
        verify = z.read('verify.py').decode('utf-8').replace("p=Path(__file__).parent;m=json.loads((p/'tunnel-manifest.json').read_text())", "p=Path(__file__).resolve().parents[1];m=json.loads((p/'data/tunnel-manifest.json').read_text())").replace("(p/'qa-results.json')", "(p/'data/tunnel-qa-results.json')")
        files['tools/verify_tunnels_16.py'] = verify.encode('utf-8')
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--check', action='store_true', help='Validate without writing')
    args = parser.parse_args()
    repo = args.repo.resolve()
    if not (repo / '.git').exists():
        raise SystemExit('Run inside the project Git checkout, or specify --repo')
    files = prepare(args.archive, repo)
    if not args.check:
        for path, data in files.items():
            p = repo / path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        for path, data in files.items():
            if digest((repo/path).read_bytes()) != digest(data):
                raise RuntimeError('Written file hash mismatch: ' + path)
    print(f'{"Validated" if args.check else "Installed and verified"}: {len(files)} files (16 PNG, 32 WebP, 7 metadata/QA files).')


if __name__ == '__main__':
    main()
