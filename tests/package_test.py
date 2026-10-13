"""Check the actual upload artifact, including every source file and locale."""

import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import unittest
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("extension_package", ROOT / "scripts" / "package.py")
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)
EXPECTED_FILES = {
    "LICENSE", "manifest.json", "background.js", "recognizer.js", "content.js",
    "icon16.png", "icon32.png", "icon48.png", "icon128.png",
    "_locales/en/messages.json", "_locales/ko/messages.json",
    "_locales/zh_CN/messages.json", "_locales/zh_TW/messages.json",
}


class PackageTests(unittest.TestCase):
    def test_store_artwork_has_upload_dimensions_without_alpha(self):
        for name, size in (("screenshot.png", (1280, 800)), ("promo-small.png", (440, 280))):
            with self.subTest(name=name):
                data = (ROOT / "store" / name).read_bytes()
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(struct.unpack(">II", data[16:24]), size)
                self.assertEqual(data[25], 2, "Store artwork should be RGB without alpha")

    def test_icons_have_declared_sizes_and_transparency(self):
        manifest = json.loads((ROOT / "manifest.json").read_text())
        self.assertEqual(set(manifest["icons"]), {"16", "32", "48", "128"})
        for size, name in manifest["icons"].items():
            with self.subTest(name=name):
                data = (ROOT / name).read_bytes()
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(data[12:16], b"IHDR")
                self.assertEqual(struct.unpack(">II", data[16:24]), (int(size), int(size)))
                self.assertEqual(data[25], 6, "RGBA preserves the transparent exterior")

    def test_committed_archive_is_current_and_reproducible(self):
        expected = PACKAGE.build_archive()
        self.assertEqual(expected, PACKAGE.build_archive())
        self.assertEqual((ROOT / "store" / "mouse.zip").read_bytes(), expected,
                         "Run python3 scripts/package.py after changing packaged files")

    def test_exact_files_and_source_hashes(self):
        with ZipFile(ROOT / "store" / "mouse.zip") as archive:
            self.assertEqual(set(archive.namelist()), EXPECTED_FILES)
            self.assertEqual(len(archive.namelist()), len(EXPECTED_FILES), "No duplicate entries")
            self.assertIsNone(archive.testzip())
            for name in EXPECTED_FILES:
                with self.subTest(name=name):
                    digest = lambda data: hashlib.sha256(data).digest()
                    self.assertEqual(digest(archive.read(name)), digest((ROOT / name).read_bytes()))
                    self.assertEqual(archive.getinfo(name).date_time, (1980, 1, 1, 0, 0, 0))

    def test_manifest_and_locales_are_usable(self):
        with ZipFile(ROOT / "store" / "mouse.zip") as archive:
            manifest = json.loads(archive.read("manifest.json"))
            source_manifest = json.loads((ROOT / "manifest.json").read_text())
            self.assertEqual(manifest, source_manifest)
            self.assertEqual(manifest["version"], source_manifest["version"])
            self.assertEqual(manifest["manifest_version"], 3)
            self.assertEqual(manifest["permissions"], [])
            scripts = manifest["content_scripts"][0]
            self.assertEqual(scripts["js"], ["recognizer.js", "content.js"])
            self.assertTrue(scripts["all_frames"])
            self.assertTrue(scripts["match_about_blank"])
            for resource in (manifest["background"]["service_worker"], *scripts["js"],
                             *manifest["icons"].values()):
                self.assertIn(resource, archive.namelist())
            default = json.loads(archive.read(f"_locales/{manifest['default_locale']}/messages.json"))
            for locale in ("en", "ko", "zh_CN", "zh_TW"):
                messages = json.loads(archive.read(f"_locales/{locale}/messages.json"))
                self.assertEqual(messages.keys(), default.keys())
                self.assertLessEqual(len(messages["extDescription"]["message"]), 132)
                for entry in messages.values():
                    self.assertIsInstance(entry["message"], str)
                    self.assertTrue(entry["message"])

    def test_missing_declared_resource_is_rejected(self):
        # The allowlist is intentional: a new runtime resource must be added
        # explicitly instead of silently omitted from the store upload.
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name in EXPECTED_FILES:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT / name).read_bytes())
            manifest = json.loads((root / "manifest.json").read_text())
            manifest["content_scripts"][0]["js"].append("unpackaged.js")
            (root / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "unpackaged.js"):
                PACKAGE.build_archive(root)


if __name__ == "__main__":
    unittest.main()
