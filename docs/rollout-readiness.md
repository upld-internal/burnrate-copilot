# macOS and Windows rollout readiness, 2026-10-02 (updated 2026-10-06)

**Production promotion is blocked.** Signed v0.5.0 is published only to
`marketplace-pilot`. v0.6.0 here is an unreleased candidate. No production catalog
or enterprise rollout was changed. A user-applied temporary local managed fixture
was tested on 2026-10-03; cleanup status is recorded below.

## Identities and preserved work

Provider starting revision: `fc69240fa6db987787f02c35fee0b4a9a59c60c1`.
Shared starting revision: `812d428fc9414df3977a77786cb66f1c435bb6ff`.
Current shared pin: `0c7c72c5ac52392e80bdad6729ac8624b18d2160`, on
`copilot/reconcile-release-contract`, in both provider pin files. Earlier
reconciliation was `321ee246b42e5b2ccd45e97b99b49a4784e3f9fb`; ADRs were renumbered when
the Codex Windows line was merged on 2026-10-06 (shared PR #3): 0014/0015 gate
Windows per provider and qualify Windows latency on a client; 0016 covers
reversible legacy deactivation; 0017/0018 document durable Mac writes and
overlapping Git queries; 0019 reads ordinary `.git` directories directly. The original shared worktree was not edited.

The provider's pre-existing README cleanup paragraph, `.vscode/`, `docs/images/`,
`notes.md`, and `scripts/clean-post-milestone.sh` are preserved. The original
shared README, Copilot attribution document edits, and cleanup script are also
preserved. Current candidate code revision: `bf55a8c0b536234aa89fba352eaf90b88c09cad2`; shared pin above. Required local format, locked Clippy,
stable/MSRV all-target tests and exact offline consumer proof passed. Subsequent
sections preserve earlier tested revisions; do not relabel their traces as the
latest release. The final Mac native acceptance run passed both architectures; the five-target
workflow still failed Windows performance. See the latest exact run below.


## Work completed and gates

| Plan gate | Status and evidence |
| --- | --- |
| Shared contract reconciliation | Implemented at the immutable revision above; shared format, Clippy, workspace stable/MSRV tests, schema/conformance/privacy, consumer-pin acceptance/rejection passed on macOS ARM64. Scheduled Copilot row now uses the historical signed pair. Clean offline consumer proof passed for the exact candidate/shared pair above. |
| Signed Windows live plugin | **Pending:** a Windows 11 x64 SSH handoff is now present in the original workspace; connection/desktop readiness must be rechecked and the signed live checklist run. Revised checklist uses signed marketplace installation, exact manifest verification, interactive/aborted turns, branch change, PS 5.1/7, latency and API readback. CI smoke is not live proof. |
| Secure setup | Implemented hidden prompts, project API validation, Keychain/Credential Manager, non-secret marker, environment compatibility, launcher, repair/rotation, explicit cleanup and trace verifier. macOS real project/vault-only trace proof and isolated native vault lifecycle passed. Windows setup remains pending on the native host. Unsigned rebuild caused Keychain reauthorization; detached reads fail bounded without UI. ARM64 stable Developer ID rebuild and fixture update continuity now have API proof. Approved CI signing and Intel continuity remain release gates. |
| Legacy deactivation | Implemented exact source/version/manifest checks, legacy-only registry enablement, recognized hook neutralization with byte-preserving private backup/checksum, owned statusline/user-hook removal and repeat/rollback. Copilot 1.0.88 live update exposed disabled legacy dispatch; corrected deactivation preserved historical files and kept the old statusline absent through a real turn and automatic update. ARM64 credential-free managed fixture migration passed after restart with unchanged legacy data and API proof. Windows and exact signed candidate managed migration remain pending. |
| Install and managed installation | Fresh signed CLI install verified on macOS ARM64; historical v0.5.0 managed trace proof remains valid. Credential-free ARM64 managed fixture install and hook delivery passed after a second interactive startup. First startup installed but did not activate hooks. Exact signed candidate and Windows install remain pending; listings alone do not prove hooks. |
| Automatic/manual update and rollback | **Blocked:** a subsequent signed, five-target verified candidate is not yet published; native Windows live proof pending. Hook definition changes in the candidate must be checked after update. Controlled native-signed ARM64 Git fixtures proved automatic/manual update, changed hooks, rejected-update preservation and accepted downgrade. They do not replace a five-target signed `marketplace-pilot` package or Windows proof. |
| Native performance and release workflow | Candidate adds enforcing provider and exact-shared benchmarks, native vault lifecycle, shared conformance/privacy, retained JSON, and stricter package parsing. All five shared performance gates passed. Final code/pin run 37098913102 passed both Macs: ARM64 57.494/91.364 ms and Intel 75.132/84.303 ms. Both Linux targets passed. Windows hook p95 105.874 ms and shared orphan recovery 2.691529 s failed on hosted CI. All native functional suites passed. **2026-10-06:** under shared ADR 0015 hosted Windows latency is diagnostic and the gate is a native Windows 11 client. On VEPRO1 (25H2, slow SATA `C:`), provider `700bd25` / shared `4733460` measured hook p95 114–129 ms over three rounds; shared budgets passed, including orphan recovery at 0.81–1.0 s. **Known gap, accepted by the owner on 2026-10-06:** the client hook remains above the 100 ms p95 budget; storage open and record writes are the remaining cost. See [Windows 11 client qualification](macos-hook-performance.md#windows-11-client-qualification-2026-10-06). |
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

## Additional macOS work

Diagnostic revision `153e1969cf9a0697fd47cfcbf1ec771fa5ff3831` adds an opt-in
example and native CI component evidence without changing production hooks,
credential behavior or release thresholds. Local ARM64 measurements found
cached attributed event/capability writes were the largest measured component.
Native diagnostic [run 37091675207](https://github.com/upld-internal/burnrate-copilot/actions/runs/37091675207)
then measured that sequence at Intel p95 108.671 ms. The full Intel hook still
failed at p95 139.588 / p99 307.252 ms; ARM64 Mac passed at 93.609 / 99.718 ms.
Windows hook p95 failed at 150.041 ms, and shared orphan recovery additionally
failed at 3.739053 s against 2 s (it passed in the earlier run). Both Linux
targets passed. All native functional suites and shared conformance/privacy
passed. This points further investigation at shared admission and durable
writes; it is not a completed optimization or release proof. See the
[component methodology and results](macos-hook-performance.md).

The [macOS signing and update acceptance plan](macos-signing-and-update-proof.md)
records the native signing integration still needed, two-version Keychain
proof, changed-hook automatic/manual updates, failure recovery and rollback.
Its signing owner/service and local authorization remain unresolved; no native
signature or signed update is claimed. Signed v0.5.0 cannot read the new vault
entry directly, so rollback to that version needs a proved transient-credential
path. Windows SSH details are now available in the original workspace's new
handoff; that host readiness does not replace signed Copilot live evidence.

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

## Latest Mac completion and required assistance, 2026-10-03

Exact code/shared pair: `bf55a8c0b536234aa89fba352eaf90b88c09cad2` /
`0c7c72c5ac52392e80bdad6729ac8624b18d2160`. Clean offline immutable
consumer proof passed. Native run `37098913102` used synthetic merge source
`671521ea9054771f26b2ff9d3b87c5ff8985c95d`; its raw build identity and host/step summary are retained in
`docs/release-evidence/2026-10-03/37098913102-*`. Both native Mac performance
jobs passed. All previous benchmark failures are retained.

[Mac lifecycle evidence](macos-signing-and-update-proof.md) now records strict
Developer ID signing, Keychain continuity across rebuilt versions, real vault-only
traces and event-time branch change, actual automatic/manual changed-hook update,
rejected-update preservation, accepted downgrade, legacy dispatch defect and
reversible physical correction. The lifecycle fixture is not a five-target
signed pilot release. No production catalog or enterprise policy was published.

The user applied the reviewed secret-free local fixture policy. Clean-home and
legacy-home restarted sessions passed real hook delivery and metadata readback:
`efad7ad2fd1a7ffad2a85bc5e6ce3741` and
`1ad4119e7ee326465c4543a41022f438`. First interactive installation did not
load hooks; a second startup was required. All sessions are closed and normal
user config/settings hashes are unchanged. Administrator removal is pending;
ordinary Copilot sessions must remain closed until file absence is confirmed.
Required release infrastructure: an approved Developer ID signing service or
runner Keychain for both Mac jobs; only the public fingerprint belongs in
`MACOS_SIGNING_IDENTITY`. The local private key was not exported. After that and
the remaining Windows gates pass, a real signed five-target pilot candidate must
repeat the lifecycle checks before final production/policy approval.
