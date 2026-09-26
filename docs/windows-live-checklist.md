# Windows live test checklist

Scope: branch `copilot/windows-hooks` on a Windows machine with a real GitHub Copilot CLI session. CI already proves the hook commands under Windows PowerShell 5.1 and PowerShell 7 ([run 36216684970](https://github.com/upld-internal/burnrate-copilot/actions/runs/36216684970)). This checklist covers what CI cannot: how Copilot itself runs the `powershell` hook commands, the Langfuse traces, and the setup skill.

Run every command in PowerShell. Record the results in the table at the end and add it to this file.

## 1. Prerequisites

- Windows 10 or 11, x64 or ARM64. ARM64 runs the x64 binary under emulation, which is part of what this test checks.
- Copilot CLI 1.0.88 or newer (`copilot --version`), signed in.
- Git for Windows on `PATH` (`git --version`).
- GitHub CLI signed in with access to `upld-internal` (`gh auth status`).
- A Langfuse public and secret key for the **test** project.
- Note whether PowerShell 7 (`pwsh`) is installed. If you can, repeat section 4 on a machine without it, where Copilot must use Windows PowerShell 5.1.

Check that the old JavaScript plugin is not enabled, since it has the same name and would run its own hooks:

```powershell
copilot plugin list
```

If `burnrate-copilot` is listed as installed, run `copilot plugin disable burnrate-copilot` for the duration of the test and re-enable it afterwards.

## 2. Plugin and binary

Use a path with a space and a non-ASCII character, as real user profiles can have:

```powershell
$test = Join-Path $env:USERPROFILE 'Burnrate Tests ü'
New-Item -ItemType Directory -Force $test | Out-Null
gh repo clone upld-internal/burnrate-copilot (Join-Path $test 'burnrate-copilot') -- --branch copilot/windows-hooks
$plugin = Join-Path $test 'burnrate-copilot\plugin\burnrate-copilot'
$bin = Join-Path $plugin 'bin\x86_64-pc-windows-msvc'
gh run download 36216684970 -R upld-internal/burnrate-copilot -n unsigned-windows-x64-development-binary -D $bin
Unblock-File (Join-Path $bin 'burnrate-copilot.exe')
& (Join-Path $bin 'burnrate-copilot.exe') version
```

The CI artifact is kept for 7 days (until 2026-10-03 for run `36216684970`). After that, start a new run with `gh workflow run CI -R upld-internal/burnrate-copilot --ref copilot/windows-hooks` and use its run ID.

Expected: `0.5.0`. If Microsoft Defender or SmartScreen blocks the unsigned binary, record it: the signed release must not be blocked.

## 3. Session environment

Set the variables in this PowerShell window only, so nothing persists:

```powershell
$host_url = 'https://langf-admin.upland.one'
$pk = Read-Host 'Langfuse public key'
$sk = Read-Host 'Langfuse secret key' -MaskInput
$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${pk}:${sk}"))

$env:COPILOT_OTEL_ENABLED = 'true'
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "$host_url/api/public/otel"
$env:OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Basic%20$basic,x-langfuse-ingestion-version=4"
$env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = 'true'
$env:LANGFUSE_BASE_URL = $host_url
$env:LANGFUSE_PUBLIC_KEY = $pk
$env:LANGFUSE_SECRET_KEY = $sk
$env:BURNRATE_LANGFUSE_TURN_IO = 'true'
$env:LANGFUSE_COPILOT_USER_ID = '<your @uplandsoftware.com email>'
```

`-MaskInput` needs PowerShell 7; in Windows PowerShell 5.1 use `Read-Host -AsSecureString` and convert, or paste the key into a plain `Read-Host` and clear the screen afterwards.

Create the test repository:

```powershell
$repo = Join-Path $test 'repö with spaces'
New-Item -ItemType Directory -Force $repo | Out-Null
git -C $repo init -q
git -C $repo checkout -q -b feature/ABC-123-windows-live
git -C $repo remote add origin git@github.com:upld-internal/burnrate-copilot.git
Set-Content (Join-Path $repo 'README') 'hi'
Set-Location $repo
```

## 4. Interactive session

```powershell
copilot --plugin-dir $plugin
```

1. Run `/plugin list`. Expected: `burnrate-copilot` under external plugins, and no second enabled `burnrate-copilot`.
2. **Turn 1**, which uses a tool: `List the files in this directory, then reply with the single word done.` Watch for a console window flashing and for any pause after the answer.
3. **Turn 2**, with no tool: `Reply with the single word two.`
4. **Branch change:** in a second PowerShell window, run `git -C $repo checkout -q -b feature/ABC-456-second`. Then **turn 3**: `Reply with the single word three.`
5. **Aborted turn:** send `Count slowly from 1 to 200, one number per line.` and press Esc while it is answering.
6. Exit with `/exit`.

## 5. Checks

Find the session ID:

```powershell
$exe = Join-Path $bin 'burnrate-copilot.exe'
$status = & $exe langfuse status | ConvertFrom-Json
$status | ConvertTo-Json -Depth 4
$session = $status.last_attempt.session_id
```

Expected: `configuration` is `configured`, `user_id` is your email, and `last_attempt.state` is `sent` with `http_status` 200.

**Hook durations inside Copilot.** Copilot records each hook's start and end in the session transcript:

```powershell
$events = Get-Content "$env:USERPROFILE\.copilot\session-state\$session\events.jsonl" | ConvertFrom-Json
$starts = @{}
foreach ($e in $events) {
    if ($e.type -eq 'hook.start') { $starts[$e.data.hookInvocationId] = $e }
    if ($e.type -eq 'hook.end' -and $starts.ContainsKey($e.data.hookInvocationId)) {
        $s = $starts[$e.data.hookInvocationId]
        [pscustomobject]@{
            hook = $e.data.hookType
            success = $e.data.success
            ms = [int]([datetimeoffset]$e.timestamp - [datetimeoffset]$s.timestamp).TotalMilliseconds
        }
    }
}
```

Expected: every Burnrate hook reports success. `agentStop` should finish in well under a second; a value near 10 seconds means the host waited for the Langfuse send. Count the `agentStop` rows: one per completed turn, and note what the aborted turn produced.

**Local records:**

```powershell
$store = "$env:LOCALAPPDATA\burnrate-copilot\store"
(Get-ChildItem "$store\events" | Where-Object { (Get-Content $_.FullName -Raw).Contains($session) }).Count
Get-ChildItem "$env:LOCALAPPDATA\burnrate-copilot\state\langfuse-outbox" -ErrorAction SilentlyContinue
```

Expected: a start event, one event per tool use, and an end event for the session. The outbox is empty.

**Langfuse:** open the test project's traces and filter by session ID. For each completed turn, expect one trace with:

- the name `Copilot Turn`;
- top-level metadata `harness=copilot_cli`, `git_repository=upld-internal/burnrate-copilot`, and `git_branch` and `jira_key` of `feature/ABC-123-windows-live` / `ABC-123` for turns 1–2, and `feature/ABC-456-second` / `ABC-456` for turn 3;
- the user set to your email;
- input set to your prompt and output set to the final answer;
- resource attributes showing `service.name=github-copilot`;
- exactly one `burnrate.attribution` span.

For the aborted turn, record whether a trace exists and what it shows. It must not carry another turn's input or output.

## 6. Setup skill

Start a new session with `copilot --plugin-dir $plugin` in `$repo`.

1. Ask: `Use the setup-langfuse skill to check my Burnrate Langfuse setup and set my Langfuse user ID.` Expected:
   - it runs the Windows `.exe` form of the command;
   - it suggests your git email only if it ends in `@uplandsoftware.com`;
   - it asks before changing anything;
   - it never prints the secret key.
2. Approve saving. Then check `[Environment]::GetEnvironmentVariable('LANGFUSE_COPILOT_USER_ID', 'User')`.
3. Run `git -C $repo config user.email someone@example.com` and repeat step 1. Expected: no suggestion; it asks you to type the email. Afterwards, run `git -C $repo config --unset user.email`.

## 7. Clean up

```powershell
[Environment]::SetEnvironmentVariable('LANGFUSE_COPILOT_USER_ID', $null, 'User')
Remove-Item Env:COPILOT_OTEL_ENABLED, Env:OTEL_EXPORTER_OTLP_ENDPOINT, Env:OTEL_EXPORTER_OTLP_HEADERS, Env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, Env:LANGFUSE_BASE_URL, Env:LANGFUSE_PUBLIC_KEY, Env:LANGFUSE_SECRET_KEY, Env:BURNRATE_LANGFUSE_TURN_IO, Env:LANGFUSE_COPILOT_USER_ID
```

Re-enable the JavaScript plugin if you disabled it. The test data in `%LOCALAPPDATA%\burnrate-copilot` and `$test` can be deleted.

## Results

| Item | Result |
| --- | --- |
| Windows edition, build, architecture | |
| Copilot CLI version | |
| PowerShell 7 installed | |
| Binary ran without a Defender or SmartScreen block | |
| No console window flashed | |
| `agentStop` duration per turn (ms) | |
| `agentStop` count vs. completed turns | |
| Aborted turn behavior | |
| Local events for the session, outbox empty | |
| Trace IDs checked | |
| Name, metadata, user, input/output, one Burnrate span | |
| Branch change reflected in turn 3 | |
| Setup skill: suggestion, typed email, consent, no secret shown | |
| Issues found | |
