# Signed Windows live test checklist

This gate is **pending**. Test native Windows 10/11 x64 with the signed v0.5.0
`marketplace-pilot` package, not the expired development CI artifact. Windows
ARM64 emulation is outside initial native support. CI PowerShell smoke tests and
Cosign signatures do not establish host dispatch, Defender/SmartScreen acceptance,
or Authenticode signing. Record any OS block without silently bypassing it.

## Prerequisites and isolated installation

Record Windows edition/build/architecture, `copilot --version`, `git --version`,
`$PSVersionTable.PSVersion`, whether `pwsh` exists, and UTC date. GitHub CLI needs
read access to the private repository; Cosign is required for operator verification.
Use a Langfuse **test** project. Do not put keys in chat, files, or arguments.

Run in PowerShell 5.1, and repeat the host session with PowerShell 7 where available:

```powershell
$test = Join-Path $env:USERPROFILE 'Burnrate Tests ü'
New-Item -ItemType Directory -Force $test | Out-Null
$env:COPILOT_HOME = Join-Path $test 'copilot home'
New-Item -ItemType Directory -Force $env:COPILOT_HOME | Out-Null
copilot plugin marketplace add 'upld-internal/burnrate-copilot#marketplace-pilot'
copilot plugin install burnrate-copilot@upld-internal
copilot plugin enable burnrate-copilot@upld-internal
copilot plugin list
```

Read the installed path from this isolated home's `config.json` `installedPlugins`
entry. Verify its name, marketplace, version, and source. Set `$plugin` to its
`cache_path`; do not assume the plugin listing alone establishes activation.
From a checkout containing the operator script, run:

```powershell
.\scripts\verify-windows-install.ps1 -PluginRoot $plugin -Version 0.5.0
$exe = Join-Path $plugin 'bin\x86_64-pc-windows-msvc\burnrate-copilot.exe'
```

The script verifies signed checksums, archive signature, annotated verified tag,
SLSA provenance, manifest, installed executable digest, and `build-info` revisions.
Record its JSON. The v0.5.0 source is
`f3d799a0846386ea0d98107c00fdd1a5364d29dd`, shared revision
`d337cfd6b7b3a20e10a22f28d2f50a54d0a0227c`; marketplace pilot commit
`af31b75f83a7434f05eb84fe3b6e877bab5666ef`. Check the branch still serves that
version before testing. A later candidate needs its own exact signed identities.

## Session environment (v0.5.0)

Use hidden prompts compatible with both PowerShell versions. These variables last
only for the process; do not save secrets as user environment variables.

```powershell
$base = Read-Host 'Langfuse HTTPS base URL'
$public = Read-Host 'Public key' -AsSecureString
$secret = Read-Host 'Secret key' -AsSecureString
$pk = [Net.NetworkCredential]::new('', $public).Password
$sk = [Net.NetworkCredential]::new('', $secret).Password
$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${pk}:${sk}"))
$env:COPILOT_OTEL_ENABLED = 'true'
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "$base/api/public/otel"
$env:OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Basic%20$basic,x-langfuse-ingestion-version=4"
$env:LANGFUSE_BASE_URL = $base
$env:LANGFUSE_PUBLIC_KEY = $pk
$env:LANGFUSE_SECRET_KEY = $sk
```

Both exporters now use the same project credentials. User identity is optional:
set `LANGFUSE_COPILOT_USER_ID` only to a value the user confirms. Only suggest Git
email for `@uplandsoftware.com`. Start without content capture. With explicit
consent, repeat with `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` and
`BURNRATE_LANGFUSE_TURN_IO=true`; verify aborted turns never reuse earlier content.

Create a committed fixture repository in `$test\repö with spaces`, with origin
`git@github.com:upld-internal/burnrate-copilot.git` and branch
`feature/ABC-123-windows-live`. Use a disposable fixture file, not private source.

## Real interactive turns

Start `copilot` **without `--plugin-dir`** from the fixture repository. Confirm
trust and the installed plugin view. Run a tool-using turn and a no-tool turn.
Before each next turn, verify the preceding trace through the Langfuse API.
Change branch in another terminal to `feature/ABC-456-second`, then run another
turn. Start a slow response and press Esc to abort it; finish with `/exit`.
Repeat in a fresh host session from each available PowerShell version. Record the
actual shell Copilot used, rather than equating the parent terminal with hook shell.

Inspect this session's `events.jsonl` in `$env:COPILOT_HOME\session-state`. Extract
only hook type, success, invocation ID, duration, session ID, and trace ID from
`agentStop` traceparent; never copy prompt/tool/result fields into evidence.

- Each Burnrate hook succeeds with no stdout or flashing console window.
- Local `agentStop` latency excludes detached network work; record all durations.
  Release benchmark budgets are p95 ≤100 ms / p99 ≤250 ms over 100 measured hooks,
  after 20 warmups. A few live turns are dispatch evidence, not a percentile gate.
- One logical start/end pair and one event per tool invocation exist under
  `%LOCALAPPDATA%\burnrate-copilot\store`; no prompt, answer, tool name, arguments,
  or results are stored. Check duplicates, end without start, and a missing store.
- The metadata outbox drains; a failed send leaves local records intact.
- Record the `agentStop` count for completed and aborted turns separately.

## API readback

For every completed turn, read `/api/public/traces/TRACE_ID` and
`/api/public/observations?traceId=TRACE_ID&limit=100` using credentials held in
memory. Retain only the checked identities/metadata/counts, never API response
bodies containing content. Poll with a bounded timeout for asynchronous ingestion.

Require `Copilot Turn`, native `invoke_agent` and generation/tool observations,
resource `service.name=github-copilot`, and exactly one `burnrate.attribution`
child of the turn's native root. Top-level metadata must contain
`harness=copilot_cli`, `git_repository=upld-internal/burnrate-copilot`, and the
correct branch and Jira candidate: `ABC-123` for turns 1–2, `ABC-456` after the
branch change. Reject camelCase `gitBranch`/`jiraKey`. Check user and content only
when configured. Record the aborted turn's attribution or explicit skip; it must
never carry another turn's input/output. HTTP 200 or `sent` alone fails this gate.

## Candidate setup, migration, update, and managed install

These checks require a subsequent signed candidate; they are not v0.5.0 features:

- Run `langfuse setup` from a terminal with hidden prompts. Restart through
  `langfuse launch`; verify vault-only metadata delivery and native root readback.
  Exercise invalid keys (old entry preserved), missing/locked vault, repair,
  rotation, partial environment config, and a mismatched managed project.
- Seed a disposable legacy v0.1.0 installation and statusline. Run
  `migration disable-legacy` twice; restart, activate the signed Rust copy,
  and require no old hooks/statusline. Preserve unrelated hooks and old data.
  Rollback refuses to restore legacy while Rust remains installed.
- Repeat clean install through admin-managed settings in
  `%ProgramFiles%\GitHubCopilot\managed-settings.json`. A plugin catalog without
  secret telemetry can be used with the vault launcher. Record ACLs. Do not put
  a project key in a file readable by other local accounts. Avoid inferring
  Windows automatic installation from the macOS observation: test `-p` first,
  then interactive startup, and inspect actual hook delivery.
- Publish a verified subsequent candidate to `marketplace-pilot`. Capture before
  and after installed binary digests and hook-file hashes. Test automatic startup
  update and explicit marketplace refresh/plugin update separately. Preserve
  unrelated settings and opt-ins, test failed update restoration, and verify one
  attribution span after update and rollback. `autoUpdate: true` is not proof.

## Evidence table

| Gate | Status / exact evidence |
| --- | --- |
| Native Windows edition/build/x64 | Pending |
| Copilot/Git/PowerShell versions | Pending |
| Signed tag/package/source/shared/installed digest | Pending native verification |
| Clean install and actual active hooks | Pending |
| Per-turn durations / completed and aborted stop counts | Pending |
| Local records / privacy / outbox / failed-send independence | Pending |
| Trace IDs / metadata / one span / native parent | Pending |
| Event-time branch change | Pending |
| PS 5.1 and PS 7 host dispatch | Pending |
| Vault setup / repair / missing / rotation / mismatch | Pending candidate |
| Legacy deactivation / rollback / unrelated settings | Pending candidate |
| Managed interactive installation | Pending |
| Automatic/manual changed-hook update and failed rollback | Pending candidate |

Remove only disposable configuration after collecting evidence. Clear ephemeral
credential variables and `$pk`, `$sk`, `$basic`; remove the isolated test vault
entry through the candidate's `langfuse forget` command after testing. Do not
reactivate a real legacy plugin alongside a Rust install.
