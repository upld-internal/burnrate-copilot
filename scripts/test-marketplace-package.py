#!/usr/bin/env python3
"""Security checks on archive parsing; no network or signed-release mutation."""
import importlib.util
import io
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('package', Path(__file__).with_name('build-marketplace-package.py'))
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

class ArchiveTests(unittest.TestCase):
    def make(self, path, names):
        with tarfile.open(path, 'w:gz') as archive:
            for name in names:
                value = b'{}' if name == 'release-manifest.json' else b'fixture'
                entry = tarfile.TarInfo(name)
                entry.size = len(value)
                archive.addfile(entry, io.BytesIO(value))
    def test_exact_members_and_duplicate_or_traversal_rejection(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'archive.tar.gz'
            names = ['burnrate-copilot.exe','release-manifest.json','LICENSE']
            self.make(path,names)
            manifest,binary = package.archive_contents(path,'x86_64-pc-windows-msvc')
            self.assertEqual(manifest,{})
            self.assertEqual(binary,b'fixture')
            for altered in [names+[names[0]],names+['../outside'],['burnrate-copilot','release-manifest.json','LICENSE']]:
                self.make(path,altered)
                with self.assertRaises(ValueError): package.archive_contents(path,'x86_64-pc-windows-msvc')

if __name__ == '__main__': unittest.main()
