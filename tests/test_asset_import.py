import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('asset_import', ROOT / 'tools/import_asset_batch_01.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
ARCHIVE = Path(os.environ.get('ASSET_ARCHIVE', '/mnt/data/gold-traitors-batch-01.zip'))

class ImportTest(unittest.TestCase):
    def test_corrupt_archive_rejected(self):
        with self.assertRaises(ValueError):
            mod.prepare(b'not the authorised archive')

    @unittest.skipUnless(ARCHIVE.exists(), 'fixture archive not supplied')
    def test_import_all_and_preserve_project_readme(self):
        files, entries = mod.prepare(ARCHIVE.read_bytes())
        self.assertEqual(len(entries), 13)
        self.assertEqual(sum(n.endswith('.webp') for n in files), 26)
        self.assertEqual(sum(len(b) for n,b in files.items() if n.endswith('.webp')), 664966)
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root/'README.md').write_text('Keep project documentation', encoding='utf-8')
            mod.install(root, files, entries)
            self.assertEqual((root/'README.md').read_text(), 'Keep project documentation')
            m = json.loads((root/'data/asset-manifest.json').read_text())
            self.assertEqual(len(m['assets']), 13)
            self.assertEqual(m['packStatus'], 'partial-draft')
            for a in m['assets']:
                self.assertEqual(a['status'], 'draft')
                self.assertFalse(a['embeddedText'])
                self.assertEqual(len(a['variants']), 2)
                for v in a['variants']:
                    self.assertTrue((root/v['path']).is_file())
            mod.install(root, files, entries)
            m2 = json.loads((root/'data/asset-manifest.json').read_text())
            self.assertEqual(m, m2)
            self.assertEqual(len(list(root.glob('assets/cards/**/*.webp'))), 26)

if __name__ == '__main__':
    unittest.main()
