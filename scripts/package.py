#!/usr/bin/env python3
"""Build or verify the exact, reproducible Chrome Web Store upload archive."""

import argparse
import io
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile, ZipInfo, ZIP_STORED


ROOT = Path(__file__).resolve().parents[1]
LOCALES = ("en", "ko", "zh_CN", "zh_TW")
PACKAGE_FILES = (
    "LICENSE",
    "background.js",
    "content.js",
    "icon16.png",
    "icon32.png",
    "icon128.png",
    "icon48.png",
    "manifest.json",
    "recognizer.js",
    *(f"_locales/{locale}/messages.json" for locale in LOCALES),
)
ARCHIVE = ROOT / "store" / "mouse.zip"


def build_archive(root=ROOT):
    """Return archive bytes after checking its declared resources and locales."""
    contents = {name: (root / name).read_bytes() for name in PACKAGE_FILES}
    manifest = json.loads(contents["manifest.json"])
    resources = set(manifest.get("icons", {}).values())
    worker = manifest.get("background", {}).get("service_worker")
    if worker:
        resources.add(worker)
    for entry in manifest.get("content_scripts", []):
        resources.update(entry.get("js", []))
        resources.update(entry.get("css", []))
    missing = resources - contents.keys()
    if missing:
        raise ValueError(f"Manifest resources absent from package allowlist: {sorted(missing)}")
    if manifest.get("default_locale") not in LOCALES:
        raise ValueError("default_locale must have a packaged message catalog")
    messages = {
        locale: json.loads(contents[f"_locales/{locale}/messages.json"])
        for locale in LOCALES
    }
    default_keys = messages[manifest["default_locale"]].keys()
    for locale, catalog in messages.items():
        if catalog.keys() != default_keys:
            raise ValueError(f"Message keys differ in locale {locale}")
        for key, entry in catalog.items():
            if not isinstance(entry.get("message"), str) or not entry["message"]:
                raise ValueError(f"Missing message text for {locale}/{key}")
    for key in re.findall(r"__MSG_([A-Za-z0-9_]+)__", contents["manifest.json"].decode("utf-8")):
        if key not in default_keys:
            raise ValueError(f"Manifest message is absent from catalogs: {key}")

    output = io.BytesIO()
    with ZipFile(output, "w") as archive:
        for name in sorted(contents):
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            # The small package uses no compression so bytes are stable across
            # Python/zlib versions and operating systems.
            info.compress_type = ZIP_STORED
            archive.writestr(info, contents[name])
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if store/mouse.zip is stale")
    args = parser.parse_args()
    try:
        expected = build_archive()
    except (OSError, ValueError, TypeError) as error:
        print(f"Cannot package extension: {error}", file=sys.stderr)
        return 1
    if args.check:
        if not ARCHIVE.is_file() or ARCHIVE.read_bytes() != expected:
            print("store/mouse.zip is stale. Run python3 scripts/package.py", file=sys.stderr)
            return 1
        print("store/mouse.zip matches the current source and package metadata.")
    else:
        ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
        ARCHIVE.write_bytes(expected)
        print(f"Built store/mouse.zip ({len(expected)} bytes).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
