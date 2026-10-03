#!/usr/bin/env python3
"""Sign or verify a Mac executable with the stable Burnrate Keychain identity.

The signing identity must already be provisioned in an approved Keychain.
This helper neither imports credentials nor changes their access controls.
"""

import argparse
import json
from pathlib import Path
import platform
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--identity", help="public certificate fingerprint; omit to verify")
    args = parser.parse_args()
    if platform.system() != "Darwin":
        parser.error("native macOS codesign verification is required")
    policy = json.loads((Path(__file__).resolve().parent.parent / "packaging/macos-signing.json").read_text())
    identifier, team = policy["identifier"], policy["team_id"]
    if not re.fullmatch(r"[A-Za-z0-9.]+", identifier) or not re.fullmatch(r"[A-Z0-9]{10}", team):
        parser.error("invalid public signing policy")
    if args.identity:
        if not re.fullmatch(r"[0-9A-Fa-f]{40}", args.identity):
            parser.error("identity must be a public SHA-1 certificate fingerprint")
        subprocess.run(["/usr/bin/codesign", "--force", "--sign", args.identity,
                        "--identifier", identifier, "--timestamp", "--options", "runtime",
                        str(args.binary)], check=True)
    requirement = (f'identifier "{identifier}" and anchor apple generic '
                   'and certificate 1[field.1.2.840.113635.100.6.2.6] exists '
                   'and certificate leaf[field.1.2.840.113635.100.6.1.13] exists '
                   f'and certificate leaf[subject.OU] = "{team}"')
    subprocess.run(["/usr/bin/codesign", "--verify", "--strict", "--verbose=2",
                    "--test-requirement", "=" + requirement, str(args.binary)], check=True)
    display = subprocess.run(["/usr/bin/codesign", "--display", "--verbose=4", str(args.binary)],
                             capture_output=True, text=True, check=True).stderr
    values = dict(line.split("=", 1) for line in display.splitlines() if "=" in line)
    if values.get("Identifier") != identifier or values.get("TeamIdentifier") != team:
        parser.error("native signature identity mismatch")
    print(json.dumps({"identifier": identifier, "team_id": team, "native_signature_verified": True}))


if __name__ == "__main__":
    main()
