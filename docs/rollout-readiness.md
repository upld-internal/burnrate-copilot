# macOS and Windows rollout readiness, 2026-10-02

**Production promotion is blocked.** Signed v0.5.0 is published only to
`marketplace-pilot`. v0.6.0 here is an unreleased candidate. No production catalog
or enterprise-managed policy was changed during this work.

## Identities and preserved work

Provider starting revision: `fc69240fa6db987787f02c35fee0b4a9a59c60c1`.
Shared starting revision: `812d428fc9414df3977a77786cb66f1c435bb6ff`.
Shared reconciliation: `ee8c4a6ea39b8273ea88a6fe28760dc80d784abb`, on
`copilot/reconcile-release-contract`; the provider manifest and lockfile pin that
full immutable revision. Shared ADRs 0014/0015 reconcile target qualification,
artifact naming, observed Copilot hooks, immutable consumer verification, and
explicit legacy deactivation. The original shared worktree was not edited.

The provider's pre-existing README cleanup paragraph, `.vscode/`, `docs/images/`,
`notes.md`, and `scripts/clean-post-milestone.sh` are preserved. The original
shared README, Copilot attribution document edits, and cleanup script are also
preserved. Candidate code is prepared separately for review; exact candidate
revision and new verification results are appended below when available.

Signed v0.5.0 source/shared/tag/marketplace identities remain in
[its release record](releases/v0.5.0.md). All five published archives were freshly
reverified locally through the tag's package builder: signed checksum file,
archive checksum, Cosign identity/issuer, SLSA source/tag provenance, and manifest.
A fresh Copilot CLI 1.0.89 installation in a path containing spaces and `ü`
installed/enabled v0.5.0; the ARM64 binary equals the verified package, SHA-256
`7f69d81b36dba1bc933ee9c00909b724ba044322587a364f7c1cad1ca15f1fdd`.
This fresh install check does not establish Windows dispatch.

## Work completed and gates

| Plan gate | Status and evidence |
| --- | --- |
| Shared contract reconciliation | Implemented at the immutable revision above; shared format, Clippy, workspace stable/MSRV tests, schema/conformance/privacy, consumer-pin acceptance/rejection passed on macOS ARM64. Scheduled Copilot row now uses the historical signed pair. New exact-candidate offline proof remains required. |
| Signed Windows live plugin | **Blocked:** no native Windows x64 machine/access supplied. Revised checklist uses signed marketplace installation, exact manifest verification, interactive/aborted turns, branch change, PS 5.1/7, latency and API readback. CI smoke is not live proof. |
| Secure setup | Implemented hidden prompts, project API validation, Keychain/Credential Manager, non-secret marker, environment compatibility, launcher, repair/rotation, explicit cleanup and trace verifier. macOS real project/vault-only trace proof and isolated native vault lifecycle passed. Windows setup remains blocked on the native host. Unsigned rebuild caused Keychain reauthorization; detached reads now fail bounded without UI. Stable signing/access across real update remains a release gate. |
| Legacy deactivation | Implemented source/version/manifest ownership checks, host disable, exact statusline/user-hook removal, scoped journal, repeat and restoration. Disposable macOS Copilot CLI 1.0.89 deactivation/repeat/rollback passed; unrelated settings and historical plugin data survived. Windows and managed live migration remain pending. |
| Install and managed installation | Fresh signed CLI install verified on macOS ARM64; historical v0.5.0 managed trace proof remains valid. Current candidate managed install and Windows install remain pending. Interactive startup is required by the observed macOS pilot; listings alone do not prove hooks. |
| Automatic/manual update and rollback | **Blocked:** a subsequent signed, five-target verified candidate is not yet published; native Windows unavailable. Hook definition changes in the candidate must be checked after update. `autoUpdate` and branch republishing/downgrade behavior are unproven. |
| Native performance and release workflow | Candidate adds enforcing provider and exact-shared benchmarks, native vault lifecycle, shared conformance/privacy, retained JSON, and stricter package parsing. Local shared benchmark passed on rerun; initial concurrent-load failure retained. Exact candidate native results on every target are still required. |
| Production publication and enterprise pilot | **Not authorized or performed:** Windows, secure update, signed subsequent candidate and rollout evidence must pass before requesting final approval. |

## New macOS development host evidence

Machine: macOS 26.5.1 (25F80), ARM64. Terminal environments expose two Copilot
binaries: `/opt/homebrew/bin/copilot` 1.0.89 and VS Code's bundled CLI 1.0.88.
The new interactive vault-only session used **1.0.88**, model `gpt-5-mini`, with
the staged development plugin and isolated `COPILOT_HOME` and
`BURNRATE_COPILOT_HOME`; do not attribute that session to 1.0.89 or a signed
candidate. Setup checked test project `team-aws-model-router-dev`, ID
`cmry0eesf0003pu07vjf4x70f`. The marker contained only version/base URL, mode 600.
The launch environment had no `LANGFUSE_*` keys; the launcher loaded the vault
and supplied one credential pair to host and sender. No content opt-in was added.

Session `43fe297a-bb6a-4e81-9a94-203d1c036373` completed three turns:

| Trace ID | Expected branch / Jira | API readback |
| --- | --- | --- |
| `0d1ddddf23717d5b60460497bd09a2cf` | `feature/ABC-123-rollout` / `ABC-123` | `Copilot Turn`, harness/repository/branch/Jira, native root, tool/generation observations, exactly one parented attribution span; passed |
| `78500e0d2839374648aebc559d985016` | `feature/ABC-123-rollout` / `ABC-123` | Same metadata and one parented attribution span/native root; passed. A later comparison against the changed branch correctly failed. |
| `675cede92a44e7031779c64b3e3145cc` | `feature/ABC-456-second` / `ABC-456` | Current-attribution CLI verifier passed after event-time branch change |

The fourth turn was interrupted with Esc; no `agentStop` was delivered. It has no
Burnrate span, rather than another turn's metadata. The session then exited
normally. All delivered Burnrate hooks reported success; three completed turns
produced three `agentStop` deliveries. Host-measured durations were 94 ms start,
96 ms tool, 280/280/272 ms stop, and 573 ms end. These include Copilot dispatch
and shell timing; they are not a 100-sample native percentile release result.
The outbox drained, and the session has one start, one tool, and one end record.

Native fake-credential Keychain create/rotate/read/missing/delete tests passed.
After rebuilding the unsigned development executable, existing-key reads raised
a macOS authorization prompt. Computer Use cannot operate SecurityAgent. Explicit
native Developer ID signing also required private-key authorization and timed
out without approval; no key was exported and no signed candidate resulted.
The bounded no-UI read fix reports `credential_unavailable` instead of hanging.
This finding must be resolved before claiming credential-preserving macOS update.

## Reviewable rollout sequence

1. Review/merge shared reconciliation and provider candidate; keep the immutable
   shared pin and test exact clean revisions offline. Resolve macOS vault access
   across binary updates with stable native signing or an approved private path.
2. Complete signed v0.5.0 native Windows proof. Qualify the candidate's secure setup,
   repair, missing keys, rotation and managed/project matching on both OSes.
3. Build the subsequent candidate with the protected five-target workflow. Verify
   signatures/checksums/provenance/packaging and all native performance results.
   Deliberately publish only the verified candidate to `marketplace-pilot`.
4. On clean macOS and native Windows homes, exercise install, legacy preparation,
   interactive managed activation, automatic and manual update with changed hooks,
   preserved settings/opt-ins, failed update, artifact/schema rollback, no duplicate
   telemetry and API readback. Keep exact old/new binary and hook digests.
5. Present exact package version/source/shared/tag/workflow/marketplace identities,
   trace IDs, native evidence and the pilot-role policy diff for **final approval**
   to publish `marketplace` and change enterprise-managed settings. Confirm the
   host supports the intended role scope; do not substitute an enterprise-wide
   policy if it does not. No final approval is requested while earlier gates fail.
6. After approval, publish the verified package, roll out only to the approved
   pilot role on both OSes, repeat clean install/update/rollback/API readback, and
   expand only after that evidence passes. Restore the previous verified artifact
   and owned settings on failure; policy removal alone is not artifact rollback.

The rollback review names the previous verified artifact, schema compatibility,
old configuration/hook digests, explicit update/downgrade commands proven on each
host, detection thresholds, owner, and the API readback confirming restoration.
Do not claim automatic rollback until its real host test has passed.
