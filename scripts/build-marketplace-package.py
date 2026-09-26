#!/usr/bin/env python3
"""Build the Copilot CLI marketplace package from one verified signed release.

Every release asset is checked before it is used: the signed SHA256SUMS, each
archive's checksum, Cosign signature, and SLSA provenance, and the release
manifest inside each archive. The output directory is the complete content of
a marketplace branch: `.github/plugin/marketplace.json` plus the plugin with
the verified binaries for every target.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile


REPOSITORY = "upld-internal/burnrate-copilot"
PRODUCT = "burnrate-copilot"
TARGETS = (
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "aarch64-unknown-linux-gnu",
    "x86_64-unknown-linux-gnu",
    "x86_64-pc-windows-msvc",
)
ISSUER = "https://token.actions.githubusercontent.com"
MANIFEST_LIMIT = 64 * 1024


def binary_name(target: str) -> str:
    return f"{PRODUCT}.exe" if target.endswith("-windows-msvc") else PRODUCT


def run(*arguments: str) -> None:
    subprocess.run(arguments, check=True, stdout=subprocess.DEVNULL)


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(65536), b""):
            result.update(block)
    return result.hexdigest()


def download(version: str, asset: str, directory: Path) -> Path:
    run(
        "gh", "release", "download", f"v{version}",
        "--repo", REPOSITORY, "--pattern", asset, "--dir", str(directory),
    )
    path = directory / asset
    if not path.is_file():
        raise ValueError(f"missing release asset: {asset}")
    return path


def verify_blob(path: Path, bundle: Path, identity: str) -> None:
    run(
        "cosign", "verify-blob", "--bundle", str(bundle),
        "--certificate-identity", identity,
        "--certificate-oidc-issuer", ISSUER, str(path),
    )


def archive_contents(archive: Path, target: str) -> tuple[dict, bytes]:
    binary = binary_name(target)
    with tarfile.open(archive, "r:gz") as package:
        members = package.getmembers()
        if {member.name for member in members} != {
            binary, "release-manifest.json", "LICENSE"
        } or not all(member.isfile() for member in members):
            raise ValueError(f"unexpected archive contents: {archive.name}")
        manifest_file = package.extractfile("release-manifest.json")
        binary_file = package.extractfile(binary)
        if manifest_file is None or binary_file is None:
            raise ValueError("missing manifest or binary")
        manifest_bytes = manifest_file.read(MANIFEST_LIMIT + 1)
        if len(manifest_bytes) > MANIFEST_LIMIT:
            raise ValueError("oversized release manifest")
        return json.loads(manifest_bytes), binary_file.read()


def set_version(path: Path, version: str, *, plugin_entry: bool = False) -> None:
    document = json.loads(path.read_text())
    if plugin_entry:
        document["metadata"]["version"] = version
        for plugin in document["plugins"]:
            if plugin["name"] == PRODUCT:
                plugin["version"] = version
    else:
        document["version"] = version
    path.write_text(json.dumps(document, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="signed release version without v")
    parser.add_argument("output", type=Path, help="new package root directory")
    arguments = parser.parse_args()
    version = arguments.version
    if not re.fullmatch(r"[0-9]{1,10}\.[0-9]{1,10}\.[0-9]{1,10}", version):
        parser.error("version must be X.Y.Z")
    output = arguments.output.resolve()
    if output.exists():
        parser.error("output already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    repository_root = Path(__file__).resolve().parent.parent
    revision = subprocess.check_output(
        ("git", "rev-parse", "HEAD"), cwd=repository_root, text=True
    ).strip()
    if subprocess.check_output(
        ("git", "status", "--porcelain", "--untracked-files=no"),
        cwd=repository_root, text=True,
    ).strip():
        parser.error("source checkout must be clean")

    identity = (
        f"https://github.com/{REPOSITORY}/.github/workflows/release.yml"
        f"@refs/tags/v{version}"
    )
    with tempfile.TemporaryDirectory(prefix="burnrate-marketplace-", dir=output.parent) as work:
        work_root = Path(work)
        assets = work_root / "assets"
        assets.mkdir()
        sums = download(version, "SHA256SUMS", assets)
        sums_bundle = download(version, "SHA256SUMS.sigstore.json", assets)
        verify_blob(sums, sums_bundle, identity)
        checksums = {}
        for line in sums.read_text().splitlines():
            checksum, separator, name = line.partition("  ")
            if separator and re.fullmatch(r"[0-9a-fA-F]{64}", checksum):
                if name in checksums:
                    raise ValueError("duplicate release checksum")
                checksums[name] = checksum.lower()

        package_root = work_root / "package"
        plugin_root = package_root / "plugin" / PRODUCT
        # Only files tracked at the tagged revision; never local build output.
        tracked = subprocess.check_output(
            ("git", "ls-files", "-z", "--", f"plugin/{PRODUCT}"),
            cwd=repository_root, text=True,
        ).split("\0")
        for relative in filter(None, tracked):
            destination = package_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(repository_root / relative, destination)
        catalog = package_root / ".github" / "plugin" / "marketplace.json"
        catalog.parent.mkdir(parents=True)
        shutil.copy2(repository_root / "packaging" / "marketplace.json", catalog)
        set_version(catalog, version, plugin_entry=True)
        set_version(plugin_root / "plugin.json", version)
        shutil.copy2(repository_root / "LICENSE", package_root / "LICENSE")
        (plugin_root / "hooks" / "run.sh").chmod(0o755)

        shared_revision = None
        evidence = []
        for target in TARGETS:
            name = f"{PRODUCT}-v{version}-{target}.tar.gz"
            archive = download(version, name, assets)
            signature = download(version, f"{name}.sigstore.json", assets)
            provenance = download(version, f"{name}.intoto.jsonl", assets)
            if digest(archive) != checksums.get(name):
                raise ValueError(f"checksum mismatch: {name}")
            verify_blob(archive, signature, identity)
            manifest, binary = archive_contents(archive, target)
            if (
                manifest.get("product") != PRODUCT
                or manifest.get("version") != version
                or manifest.get("target") != target
                or manifest.get("archive_name") != name
                or manifest.get("binary_name") != binary_name(target)
                or manifest.get("source_revision") != revision
                or hashlib.sha256(binary).hexdigest() != manifest.get("binary_sha256")
            ):
                raise ValueError(f"release manifest mismatch: {name}")
            if shared_revision is None:
                shared_revision = manifest.get("shared_revision")
            elif shared_revision != manifest.get("shared_revision"):
                raise ValueError("inconsistent shared revision")
            run(
                "gh", "attestation", "verify", str(archive),
                "--repo", REPOSITORY, "--bundle", str(provenance),
                "--cert-identity", identity, "--cert-oidc-issuer", ISSUER,
                "--predicate-type", "https://slsa.dev/provenance/v1",
                "--source-ref", f"refs/tags/v{version}",
                "--source-digest", revision, "--deny-self-hosted-runners",
            )
            binary_path = plugin_root / "bin" / target / binary_name(target)
            binary_path.parent.mkdir(parents=True)
            binary_path.write_bytes(binary)
            binary_path.chmod(0o755)
            evidence.append({"target": target, "archive": name, "sha256": digest(archive)})

        (package_root / "release-evidence.json").write_text(
            json.dumps({
                "version": version,
                "source_revision": revision,
                "shared_revision": shared_revision,
                "artifacts": evidence,
            }, indent=2) + "\n"
        )
        os.replace(package_root, output)


if __name__ == "__main__":
    main()
