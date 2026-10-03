# macOS signing and credential-preserving update proof

Status: preparation only. The release workflow signs archives with Cosign; it
does not yet apply a stable Developer ID signature to the macOS executable.
The unsigned development rebuild required Keychain reauthorization. No new
native-signed package or credential-preserving update has been proved.

## Signing integration to complete

Use an organization-owned Developer ID Application identity, a stable executable
identifier, and the same designated requirement across ARM64, Intel and subsequent
versions. Proposed identifier: `com.upland.burnrate.copilot`; confirm it with the
signing owner before making it a release input. Record the expected Team ID,
certificate fingerprint, identifier and designated requirement as public release
evidence. The private key remains in the approved signing service or Keychain.
The local identity currently requires owner authorization; do not export its key
or broaden its access controls to work around that prompt.

Apple describes the designated requirement as the identity that lets macOS
recognize successive versions of a program, and Keychain uses that identity to
track the creating application. This supports the proposed approach; the actual
vault behavior still needs a two-version host test. See Apple's
[code-signature guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/AboutCS/AboutCS.html)
and [code-signing technical note](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).

Integrate the approved signer into each native macOS release job after compiling
and checking `build-info`, before generating the binary manifest, archive,
checksums, provenance and Cosign signatures. Native signing changes the executable
bytes: a previously verified unsigned archive cannot simply be signed in place
and keep its old release evidence. Preserve Linux and Windows artifact behavior.

For each final macOS executable, preserve sanitized output from:

```sh
codesign --verify --strict --verbose=2 PATH_TO_BINARY
codesign --display --verbose=4 PATH_TO_BINARY
codesign --display --requirements - PATH_TO_BINARY
PATH_TO_BINARY build-info
shasum -a 256 PATH_TO_BINARY
```

Check the expected Team ID and identifier, stable designated requirement, exact
source/shared revisions and final digest. Repeat verification on the installed
binary after marketplace installation. Include the executable's native-signing
verification in package verification; archive Cosign alone does not demonstrate
the Keychain identity. Record normal launch behavior through the actual download
and Copilot installation path.

## Host acceptance sequence

Run this on both native ARM64 and Intel Macs. Use isolated Copilot/Burnrate homes
and a Langfuse test project, preserving the Burnrate home throughout the update.
Record macOS build, architecture, Copilot CLI version, both package/source/shared
revisions, workflow/catalog commits, native signature identity, executable and
hook digests, and metadata-only trace readback. Keep content capture opt-in as it
was before the test.

1. Install the first native-signed, vault-capable version through Copilot CLI.
   Run guided setup explicitly, allowing any initial OS authorization locally.
   Restart through the launcher with no `LANGFUSE_*` credentials inherited from
   the shell. Verify one completed interactive turn in Langfuse, including its
   native parent and exactly one attribution span. Verify missing credentials,
   repair and rotation through the explicit setup commands.
2. Publish the independently verified second version to `marketplace-pilot`,
   with a changed hook definition. Observe automatic update at an interactive
   restart and prove it using installed digests and actual hook deliveries.
   Repeat manual update separately. Neither the listing nor `autoUpdate: true`
   is sufficient. Confirm unrelated settings, statusline and opt-ins survive.
3. With the old credential entry and unchanged Burnrate home, restart the second
   version. Prove its detached sender can read the existing Keychain entry
   without authorization UI or an unbounded wait. Read back a completed turn,
   then a turn after a branch/Jira change. Check no duplicate attribution or
   legacy hook activity. Capture local records and sender failures without keys
   or conversation content.
4. Exercise a rejected update and confirm the previous verified executable and
   hooks remain active. Restore the first native-signed vault-capable version
   using the downgrade route actually accepted by that Copilot version. Repeat
   credential access and real trace readback, checking schema compatibility and
   settings preservation. Record failure recovery separately from a deliberate
   downgrade; neither is automatic rollback until observed.
5. Remove only the disposable installation and its scoped vault entry through
   explicit cleanup. Check unrelated installations and settings are intact.

Signed v0.5.0 is environment-only: it cannot directly read the new Keychain entry.
A rollback to v0.5.0 therefore needs a separately verified approved launcher or
transient environment path, or explicit reconfiguration. Do not promise seamless
vault-based rollback to it. Never put credentials in persistent plugin policy,
process arguments, logs or evidence.

## Other remaining macOS work

- Diagnose and resolve Intel hook p95 without reducing the 1,000-event /
  1,000-open-session corpus or the 100 ms p95 / 250 ms p99 limits. Use the
  [component diagnostic](macos-hook-performance.md); shared storage changes belong
  in `burnrate-spec`, followed by an immutable provider pin and exact consumer
  proof. ARM64 results do not establish Intel performance.
- Complete candidate clean install, legacy-plugin deactivation and managed
  activation with real hook observations. Interactive startup is required by
  the observed pilot; `copilot -p` alone did not install the managed package.
- Prepare a secret-free, reviewable managed-policy diff and rollback instructions.
  Applying enterprise-managed settings and production publication remain final
  approval steps after the evidence passes. Test ordinary isolated CLI installs
  independently while that rollout is pending.

See [rollout readiness](rollout-readiness.md) for current passes, failures and
trace IDs. A signing design or synthetic credential test does not close the
real update gate.
