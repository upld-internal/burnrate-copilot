# macOS and Windows rollout readiness, 2026-10-02

**Production promotion is blocked.** Signed v0.5.0 is published only to
`marketplace-pilot`. v0.6.0 here is an unreleased candidate. No production catalog
or enterprise-managed policy was changed during this work.

## Identities and preserved work

Provider starting revision: `fc69240fa6db987787f02c35fee0b4a9a59c60c1`.
Shared starting revision: `812d428fc9414df3977a77786cb66f1c435bb6ff`.
Shared reconciliation, Git sampling and native fixtures: `321ee246b42e5b2ccd45e97b99b49a4784e3f9fb`, on
`copilot/reconcile-release-contract`; the provider manifest and lockfile pin that
full immutable revision. Shared ADRs 0014/0015 reconcile target qualification,
artifact naming, observed Copilot hooks, immutable consumer verification, and
explicit legacy deactivation. The original shared worktree was not edited.

The provider's pre-existing README cleanup paragraph, `.vscode/`, `docs/images/`,
`notes.md`, and `scripts/clean-post-milestone.sh` are preserved. The original
shared README, Copilot attribution document edits, and cleanup script are also
preserved. Candidate code revision: `4e718c0b41391628774cb1ddd1a7651ef71c367b`,
on `copilot/macos-windows-rollout`; documentation additions follow that tested
code revision. Review [provider draft PR](https://github.com/upld-internal/burnrate-copilot/pull/5)
and [shared draft PR](https://github.com/upld-internal/burnrate-spec/pull/1).

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
| Shared contract reconciliation | Implemented at the immutable revision above; shared format, Clippy, workspace stable/MSRV tests, schema/conformance/privacy, consumer-pin acceptance/rejection passed on macOS ARM64. Scheduled Copilot row now uses the historical signed pair. Clean offline consumer proof passed for the exact candidate/shared pair above. |
| Signed Windows live plugin | **Blocked:** no native Windows x64 machine/access supplied. Revised checklist uses signed marketplace installation, exact manifest verification, interactive/aborted turns, branch change, PS 5.1/7, latency and API readback. CI smoke is not live proof. |
| Secure setup | Implemented hidden prompts, project API validation, Keychain/Credential Manager, non-secret marker, environment compatibility, launcher, repair/rotation, explicit cleanup and trace verifier. macOS real project/vault-only trace proof and isolated native vault lifecycle passed. Windows setup remains blocked on the native host. Unsigned rebuild caused Keychain reauthorization; detached reads now fail bounded without UI. Stable signing/access across real update remains a release gate. |
| Legacy deactivation | Implemented source/version/manifest ownership checks, host disable, exact statusline/user-hook removal, scoped journal, repeat and restoration. Disposable macOS Copilot CLI 1.0.89 deactivation/repeat/rollback passed; unrelated settings and historical plugin data survived. Windows and managed live migration remain pending. |
| Install and managed installation | Fresh signed CLI install verified on macOS ARM64; historical v0.5.0 managed trace proof remains valid. Current candidate managed install and Windows install remain pending. Interactive startup is required by the observed macOS pilot; listings alone do not prove hooks. |
| Automatic/manual update and rollback | **Blocked:** a subsequent signed, five-target verified candidate is not yet published; native Windows unavailable. Hook definition changes in the candidate must be checked after update. `autoUpdate` and branch republishing/downgrade behavior are unproven. |
| Native performance and release workflow | Candidate adds enforcing provider and exact-shared benchmarks, native vault lifecycle, shared conformance/privacy, retained JSON, and stricter package parsing. All five shared performance gates passed. Final provider hook p95 failed on Intel Mac (146.136 ms) and Windows x64 (139.023 ms); ARM64 Mac and both Linux targets passed. All native functional suites passed. Failures remain release blockers; CI does not replace native Copilot proof. |
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

The fourth turn was interrupted with Esc; no `agentStop` was delivered, so
Burnrate did not enqueue an attribution span for it. The session then exited
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
The real-key test entry is scoped only to `/tmp/Burnrate rollout ü/burnrate`;
cleanup with that `BURNRATE_COPILOT_HOME` and `langfuse forget` also required local
Keychain authorization and timed out. Its non-secret marker remains private.
Delete that isolated entry through the explicit command after local authorization;
no original user vault entry, shell profile, or legacy installation was changed.

## Exact candidate and additional host evidence

The final code pair's local native hook benchmark passed at p95 87.145 ms /
p99 96.132 ms. The final code pair above passed provider format, locked Clippy with warnings
as errors, stable/MSRV all-target tests (34 passed, one deliberately ignored
native-vault test), and the separate macOS native-vault lifecycle test. The
shared pair passed workspace stable/MSRV tests, schema/conformance/privacy,
consumer-pin rejection tests and a clean offline consumer run. Packaging
rejection tests and Unix runner syntax checks passed.

[Shared CI 37055615883](https://github.com/upld-internal/burnrate-spec/actions/runs/37055615883)
passed at shared `321ee246b42e5b2ccd45e97b99b49a4784e3f9fb`, including
native Windows stable/MSRV workspace tests and lint. This resolves the fixture
mismatch; it does not establish Windows Copilot support.

[Provider CI 37054721399](https://github.com/upld-internal/burnrate-copilot/actions/runs/37054721399)
passed at provider head `0c7de3cdc2c65fb519ba05e2b327540a2812a42c`, including
Windows Credential Manager create/rotate/missing/delete and the exact hook
strings under PowerShell 5.1 and 7. Protected PR dry runs build GitHub's synthetic
merge source, rather than the feature head: the first full native run used
`89cabb4a202ea1ee5b9253f93b821092b0d3ed3a`, with shared `88494ef397c88c4547ddb334d5b6d232f002da11`.

[Protected run 37054721542](https://github.com/upld-internal/burnrate-copilot/actions/runs/37054721542)
passed macOS ARM64 and both Linux targets. Intel macOS failed the hook gate
(p95 215.431 ms / p99 331.290 ms); Windows failed two pre-existing shared fixture
assumptions (Unix absolute path and CRLF conversion). The shared fixture fix is
pinned in the final pair. The Intel performance failure remains a release
blocker until an exact candidate passes. The benchmark keeps 1,000 events and
1,000 open sessions; its corpus and 100/250 ms limits were not reduced.
[Retained JSON evidence](release-evidence/2026-10-02/) includes successes and
failures. PR dry runs produce unsigned test archives; signing/provenance and
publication steps are skipped.

Additional development-session readback is tied to explicit source identities:

| Provider / shared | Host | Trace / result |
| --- | --- | --- |
| `fcdb52b747561551c21c428aa4bcd49dc47f3c77` / `ee8c4a6ea39b8273ea88a6fe28760dc80d784abb` | Copilot 1.0.88 | `b4d43dcfcc58534633c76055d0158eb8`: branch `feature/ABC-456-second`, Jira `ABC-456`, one parented attribution/native root; verifier passed |
| `0c7de3cdc2c65fb519ba05e2b327540a2812a42c` / `88494ef397c88c4547ddb334d5b6d232f002da11` | Copilot 1.0.91 | `74fcbcce6faede10ac83829447d36651`: real tool turn on `feature/ABC-456-second`, Jira `ABC-456`; verifier passed |
| same exact pair | Copilot 1.0.91 | `8e0c65c5093df86b2de3eb1e7e530eb3`: next turn after branch change to `feature/ABC-789-final`, Jira `ABC-789`; verifier passed |
| same exact pair | Copilot 1.0.91 | `f6be3caec87a93cc0631dbcaa4df7c77`: interrupted tool turn; API readback found the native root and **zero** attribution spans, no `agentStop` sender state |

The 1.0.91 host had updated in VS Code's bundled CLI path during this work;
do not infer version from its path or isolated directory name. That session
`d09407f7-f3b2-457b-84f2-9b9fcd2adb2e` used transient environment credentials,
the staged plugin, and unchanged content opt-ins. Both completed turns carried
`harness=copilot_cli`, `git_repository=upld-internal/burnrate-copilot`, snake_case
branch/Jira keys, one attribution span and native root. The session exited with
one local start/tool/end and an empty sender outbox. The exact binary and hook
SHA-256 values plus metadata-only API results are retained in
[macOS 1.0.91 evidence](release-evidence/2026-10-02/macos-copilot-1.0.91.json).

An attempted isolated 1.0.89 interactive launch required GitHub authentication
and was cancelled at folder trust; it is not a failed trace proof or a completed
session. Fresh signed installation through that CLI still passed. No login,
production catalog, managed policy, or original legacy plugin was altered.

### Final protected dry run

[Run 37055920997](https://github.com/upld-internal/burnrate-copilot/actions/runs/37055920997)
completed all five targets. It built source `6e7e12ea65dede8c095b0ba92d086dd596b04db6`
with shared `321ee246b42e5b2ccd45e97b99b49a4784e3f9fb`. Its Git tree
`b03fc3a52ec37cbb17a608533219f276af203e8c` equals candidate code revision
`4e718c0b41391628774cb1ddd1a7651ef71c367b`'s tree. Documentation added after
that code revision does not change the tested code.

Every target passed native provider format/Clippy/stable/MSRV suites, exact
shared workspace/conformance/privacy, build identity, and shared performance.
Both macOS targets and Windows passed their native credential-store lifecycle;
Windows also passed exact PowerShell 5.1/7 hook smoke before benchmarking.
[Final provider CI 37055921019](https://github.com/upld-internal/burnrate-copilot/actions/runs/37055921019)
passed. Two **provider hook** performance gates remain failed:

| Native runner OS | Target | Hook p95 / p99 ms | Gate |
| --- | --- | --- | --- |
| macOS 14.8.9 (23J631) | ARM64 | 85.369 / 110.972 | pass |
| macOS 15.7.9 (24G830) | Intel x64 | 146.136 / 153.472 | **fail p95** |
| Windows Server 2022 10.0.20348 | native x64 | 139.023 / 155.906 | **fail p95** |
| Ubuntu 24.04.5 | GNU/Linux x64 | 36.304 / 36.870 | pass |
| Ubuntu 24.04.5 | GNU/Linux ARM64 | 24.965 / 25.583 | pass |

The Windows CI OS is recorded as Server 2022; it is not the Windows 10/11
interactive Copilot qualification required by the checklist. All five provider
and shared JSON results, plus host/source identities, are retained in
[release evidence](release-evidence/2026-10-02/). Intel/Windows packaging was
blocked by these failures. No signed candidate, provenance claim, candidate
marketplace publication, or automatic update proof resulted.

The next code gate is to profile entrypoint startup, Git observation, store open
and durable admission on Intel macOS and native Windows without relaxing the
corpus or limits. Provider startup belongs here; provider-neutral storage or Git
improvements belong in `burnrate-spec`, followed by another immutable pin and
exact consumer/native proof. After a passing five-target run, stable macOS vault
access and the signed Windows live checklist still precede a signed pilot update
and rollback proof. Do not promote this candidate while these gates remain open.

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
