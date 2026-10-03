# macOS signing and credential-preserving update proof

Status: ARM64 native signing, rebuild Keychain continuity and controlled Git
fixture lifecycle have live evidence below. The release workflow now gates
native Mac signing before manifests and archives, but an approved CI signer
has not been provisioned. No new five-target signed pilot release is published.

## Signing integration to complete

Use an organization-owned Developer ID Application identity, a stable executable
identifier, and the same designated requirement across ARM64, Intel and subsequent
versions. Candidate identifier: `com.upland.burnrate.copilot`, Team ID `Y5SX6J5N9L`.
The final signer/service remains an owner-reviewed release input. Record the expected Team ID,
certificate fingerprint, identifier and designated requirement as public release
evidence. The private key remains in the approved signing service or Keychain.
The local signing proof completed with the existing identity without a new UI
prompt. Do not export its private key or broaden its access controls.

Apple describes the designated requirement as the identity that lets macOS
recognize successive versions of a program, and Keychain uses that identity to
track the creating application. ARM64 fixture tests below now demonstrate that continuity; Intel host continuity
still needs its own proof. See Apple's
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

## Local native signing proof, 2026-10-03

On macOS 26.5.1 (25F80), ARM64, the existing Developer ID Application certificate
`915C7DEDCB336E243355C54FE8E0960EBFD42043` signed the disposable fixtures with
identifier `com.upland.burnrate.copilot` and Team ID `Y5SX6J5N9L`. No key was
exported and no access controls were changed. Strict verification passed with
the Apple Developer ID requirement, identifier and team. The observed signing
operation completed without a new authorization prompt.

A signed v0.6.0 build from `4e718c0b41391628774cb1ddd1a7651ef71c367b`
(shared `321ee246b42e5b2ccd45e97b99b49a4784e3f9fb`) created an isolated
Keychain entry. A separately rebuilt, signed v0.6.0 build from
`5fe19a3a3e99404d5c790fb015fed2437df1c5cf` (shared `32f3abe2...`) read it
without UI and launched Copilot with shell Langfuse keys removed. Actual
interactive host version was **1.0.88**, because `--no-auto-update` selects the
bootstrap's bundled host, even though ordinary `copilot --version` reports the
newer downloaded version. Session `eacadb35-c17e-44b6-b3d6-2c7f0ab95f86`
produced:

- `93a500209d32b58a191d5339cd27b577`: `feature/ABC-234-signed-vault`, Jira
  `ABC-234`, repository `upld-internal/burnrate-copilot`.
- `08c66c76cd8aba94fad13b38c2af5bd1`: after an event-time branch change to
  `feature/ABC-345-vault-after-update`, Jira `ABC-345`, same repository.

Both API verifier calls passed with environment keys unset, native host parent,
exactly one attribution span, `harness=copilot_cli`, and no camelCase aliases.
This demonstrates rebuild continuity on ARM64; Intel interactive continuity is
still required.

`scripts/macos-sign-binary.py` signs only with an already provisioned public
certificate identity and verifies `packaging/macos-signing.json`. The workflow
runs it before manifests and archives on signed-tag Mac jobs. Dry runs remain
unsigned. GitHub currently has no provisioned native signing identity: an
approved runner/service and public `MACOS_SIGNING_IDENTITY` repository variable
are required before a real five-target signed candidate can be published. The
existing local private key must not be exported as a workaround.

A controlled loopback smart-Git marketplace fixture exercises host updates
independently of that signing-infrastructure gate. It uses native-signed ARM64
packages, not the signed five-target `marketplace-pilot` release. Record its
observations separately and do not promote them to production update proof.
