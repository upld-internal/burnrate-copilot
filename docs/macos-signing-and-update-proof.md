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

## Controlled ARM64 install/update/migration lifecycle

Copilot interactive version **1.0.88**, macOS **26.5.1 (25F80)**, native ARM64.
The smart-Git server binds only `127.0.0.1:38437`; it exposes disposable package
objects and no credentials. It is a host lifecycle fixture, not a private
production distribution or Cosign/SLSA release. Actual Git-cloned installation
copies the package into the isolated host cache; a live directory marketplace
was deliberately excluded from update proof.

| Package | Source / shared | Native-signed executable SHA-256 |
| --- | --- | --- |
| A, v0.6.0 | `4e718c0b41391628774cb1ddd1a7651ef71c367b` / `321ee246b42e5b2ccd45e97b99b49a4784e3f9fb` | `3bd7eceaca78210893035d0fef96dede75c8e25103c4489e223eecd8dc8b655e` |
| B, v0.6.1 | `639ad77c240c9a268f5dcde13724645a4a8aa94e` / `32f3abe2dce3fc47e86e94261974986c6b04b2f1` | `629d24d8446fa1df92038857fa08bae44560060213e51c9ee366505133f18177` |

B prefixes every Unix hook command with `exec`; its installed hook SHA-256 is
`fb84fe25bd3989f4086475d1fd6204394dd023e0fba01e5c2916866adbde2670`.
Both executables use the same verified Developer ID requirement and can read
the entry created by A without a new prompt or inherited environment keys.

Catalog commits: A `c5b4d5585d270b1015094fec78dc51c48dc4e65e`; first B
`e5e202a07195d61d21b18546968b15f85cf959d8`; downgrade A
`70ed9f5f36ee44fb2500168546a8e8e8ebf8a02a`; manual B `f6e46940b4d815e790050e72e9f7deec3fad90b2`; deliberately missing-source candidate `ee7c5f425f141463708644900ad23fb8a310aff3`;
restored A `c1a54c1e3eb44b5c3e94c57cdc29a1981950e204`; repeated B after hook neutralization `e39a2eaba0dfcbcba73b52fa82ab7e19943e315d`.

- Actual automatic update logged `Auto-updated 1 plugin` at interactive restart.
  Installed executable and changed hook digests matched B. API trace
  `03c62b8892c0fbac1a9de778d14fa180` has one attribution span and correct
  `copilot_cli`, repository, ABC-345 branch/Jira metadata. Its hook parent is the
  native generation span, whose parent is `invoke_agent`. The original verifier
  incorrectly required the direct parent to be the root; the corrected ancestry
  verifier at `38bd06bea1bccebf6508216d45c2d58df0b6180c` passed real readback and rejects missing/cyclic parents.
- Manual update A to B succeeded. A missing-source v0.6.2 catalog was rejected;
  B's executable and hook bytes stayed exactly unchanged, enabled state survived,
  and trace `2adebca9cc13310a734a4d4e2bdbb442` passed readback from the
  preserved installation. This is rejected-update preservation, not evidence of
  a partially installed package being automatically restored.
- The host accepted explicit `plugin update` downgrade B to A, twice. Original
  Keychain access remained available. Post-correction A trace
  `c27be553b67f9c95ba8acceba09664f4` passed readback with the same metadata.
- Two same-name installed copies exposed a migration defect: bare-name disable
  selected Rust when it was first. Changing only the validated legacy registry
  flag fixed selection, but later update caused disabled legacy startup to
  recreate its statusline. Final migration also neutralizes its recognized hook
  file reversibly; no plugin listing is counted as dispatch proof.
- After that correction, seven historical legacy data files retained aggregate
  SHA-256 `b9a48004cc2e2d2dda8520416201a153950425416e4390655a0807c5e3d62ad6`
  through A's turn, automatic update and B's actual tool turn. No old statusline
  reappeared. Unrelated user settings and hook commands stayed intact. B trace
  `0e2da66deb9a2504e748af6453204c55` passed parent/count/metadata readback.
- After qualified Rust uninstall, migration rollback restored the original hook
  SHA-256 `3d13490dbf94b730657b501135b246cde0eb998c2759dfd148522627afa5d440`,
  removed its private backup, restored journaled settings and enabled legacy.
  Re-deactivation and qualified Rust reinstall passed. No original user home was
  migrated. Rollback while Rust is installed remains refused.

A separately staged candidate `e657f6c81e7e1adc241f123f12b234abf61e31c4`
(shared `600542e8970a0ff8135f6fc2783aa9042f92b92f`) ran a real tool turn
with vault-only configuration from `--plugin-dir`, session
`1369119c-ca88-4d0a-9bc6-c7d89ddb2f11`. Trace
`affa7514a943aebc18c59b02d8c3995f` passed readback on
`feature/ABC-456-batched-candidate` / `ABC-456`; local records include one start,
each tool event's attribution, and its two capability records. A second completed
turn `9defc6933430254b10ca9e22f84c5cd6` has one attribution. A Ctrl-C aborted
turn `85d96a82fb91ebfdf743e129e4008434` has zero attribution spans.

The user applied the reviewed credential-free local managed fixture policy on
2026-10-03. Its catalog/enablement behavior and migrated hook delivery were tested
in disposable homes; see the managed-install evidence below. It was not an
enterprise rollout or publication to either remote marketplace.

Final code/pin pair `bf55a8c0b536234aa89fba352eaf90b88c09cad2` /
`0c7c72c5ac52392e80bdad6729ac8624b18d2160` was separately rebuilt, staged
and Developer ID signed. Copilot 1.0.88 session
`c67aa68e-e41e-49ea-ad36-1739cabca8aa` ran an actual Git tool turn with no
inherited Langfuse keys. API trace `b33ccb56b2b941abed965828d003b2b0` passed
the final verifier for `copilot_cli`, repository
`upld-internal/burnrate-copilot`, `feature/ABC-456-batched-candidate` and
`ABC-456`, native parent ancestry and exactly one attribution span.

## Managed ARM64 fixture install and migration, 2026-10-03

Host: macOS **26.5.1 (25F80)** ARM64, interactive Copilot **1.0.88**, model
`gpt-5-mini`. The user temporarily installed the reviewed device policy at
`/Library/Application Support/GitHubCopilot/managed-settings.json` while ordinary
sessions stayed closed. It named only the loopback Git catalog above,
`autoUpdate: true`, and `burnrate-copilot@burnrate-macos-lifecycle: true`;
it contained no telemetry endpoint, keys or headers. Catalog revision was
`e39a2eaba0dfcbcba73b52fa82ab7e19943e315d`. No local marketplace registration,
explicit install, local enablement override, or `--plugin-dir` was used.

- In a new isolated clean home, `-p` session
  `745368c9-592d-4e55-8d0b-ac64de1afe1a` did **not** install the package.
  First interactive startup installed B, but loaded no Burnrate hooks. Its
  completed trace `ba98ec22e5fea1efc119db63881da267` was `invoke_agent`
  with **zero** attribution spans. This is a failed activation check and proves
  the installation listing is insufficient. Close that session and restart
  before accepting managed activation.
- On the clean-home restart, Copilot reported **one plugin, four hooks**.
  Session `eb535570-9590-4d2e-a542-4c3c556c392d` ran a Git tool turn.
  Trace `efad7ad2fd1a7ffad2a85bc5e6ce3741` passed API readback and the final
  vault-only verifier: exactly one attribution span, valid parent ancestry,
  `harness=copilot_cli`, repository `upld-internal/burnrate-copilot`, branch
  `feature/ABC-456-batched-candidate`, Jira `ABC-456`, no camelCase aliases.
- A second isolated home contained only the recognized legacy JS v0.1.0 plugin,
  seven copied historical data files, its owned user hook/statusline and unrelated
  settings. Migration binary `bf55a8c0b536234aa89fba352eaf90b88c09cad2`
  (shared `0c7c72c5ac52392e80bdad6729ac8624b18d2160`) deactivated it,
  neutralized its original hooks and preserved a private reversible backup.
  Device policy installed B on interactive startup. After restart Copilot
  reported **two plugins, five hooks**: B's four hooks plus the unrelated
  user `true` command; legacy's hook definition remained empty.
  Session `4bcdba29-2506-4a11-a84f-6cb01cab0255` completed a Git tool turn.
  Trace `1ad4119e7ee326465c4543a41022f438` passed the same API/verifier checks.
  All seven historical files retained their exact hashes, the old statusline
  stayed absent, and the unrelated setting and user hook survived.
- Both local stores recorded one session start, one tool completion, one session
  end and one summary for each accepted session. Native `custom_notification`
  traces had no attribution, as expected. Shell Langfuse credentials were removed;
  the launcher and detached senders used the existing Keychain entry without UI.
  No content capture opt-in was enabled.
- Both installed B executables and hook files matched the digests above. The
  clean-home installed binary passed strict Developer ID verification for
  `com.upland.burnrate.copilot`, Team `Y5SX6J5N9L`, and reported B's exact
  `639ad77...` / `32f3abe...` source/shared pair. This proof combines the
  final migration/verifier with the **earlier fixture B package**, not a signed
  five-target release of the final `bf55a8...` candidate.

All test sessions exited normally. The normal user's Copilot config and settings
matched their pre-test byte hashes. Conditional administrator policy removal is
pending; ordinary sessions must remain closed until absence is confirmed. This
fixture closes the ARM64 managed lifecycle experiment; the exact signed pilot
candidate, Intel lifecycle and Windows managed behavior still need acceptance.
