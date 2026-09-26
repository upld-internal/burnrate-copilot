# Runs the plugin's Windows hook commands the way a host does: the exact
# `powershell` strings from hooks.json, raw UTF-8 JSON on stdin, and a plugin
# root and repository whose paths contain spaces and non-ASCII characters.
# Requires PowerShell 7 (pwsh) for ProcessStartInfo.ArgumentList; it exercises
# both Windows PowerShell 5.1 and PowerShell 7 as the hook shell.
param(
    [Parameter(Mandatory)][string]$Binary
)
$ErrorActionPreference = 'Stop'

$root = Join-Path $env:RUNNER_TEMP "bürnrate smoke $([guid]::NewGuid().ToString('N').Substring(0, 8))"
$plugin = Join-Path $root 'plugin root ü'
$bin = Join-Path $plugin 'bin\x86_64-pc-windows-msvc'
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item $Binary (Join-Path $bin 'burnrate-copilot.exe')
$repo = Join-Path $root 'repö with spaces'
New-Item -ItemType Directory -Force $repo | Out-Null
git -C $repo init -q
git -C $repo checkout -q -b 'feature/ABC-123-windows'

$env:PLUGIN_ROOT = $plugin
$env:LOCALAPPDATA = Join-Path $root 'local app data'
$store = Join-Path $env:LOCALAPPDATA 'burnrate-copilot\store'
$hooks = (Get-Content (Join-Path $PSScriptRoot '..\plugin\burnrate-copilot\hooks.json') -Raw | ConvertFrom-Json).hooks

function Invoke-Hook([string]$Shell, [string]$HookName, [hashtable]$Payload) {
    $info = [Diagnostics.ProcessStartInfo]::new($Shell)
    foreach ($argument in '-NoProfile', '-NonInteractive', '-Command', $hooks.$HookName[0].powershell) {
        $info.ArgumentList.Add($argument)
    }
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $process = [Diagnostics.Process]::Start($info)
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Payload | ConvertTo-Json -Compress))
    $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $process.StandardInput.Close()
    # Reading to end waits for every holder of the stdout pipe, as a host does.
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $timer.Stop()
    [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $stdout
        Stderr = $stderr.Trim()
        Seconds = $timer.Elapsed.TotalSeconds
    }
}

function Assert-Hook($Result, [string]$Label) {
    if ($Result.ExitCode -ne 0) { throw "$Label failed with $($Result.ExitCode): $($Result.Stderr)" }
    if ($Result.Stdout.Trim()) { throw "$Label wrote to stdout: $($Result.Stdout)" }
}

$shells = @(
    (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
    (Get-Command pwsh).Source
)
foreach ($shell in $shells) {
    $session = "windows-smoke-$([IO.Path]::GetFileNameWithoutExtension($shell))"
    $traceparent = '00-32d796bfcf46f9746b04321034d0eee7-156da77f891786f8-01'
    $base = @{ sessionId = $session; timestamp = 1790383418583; cwd = $repo }

    # Local lifecycle and tool records, with Langfuse not configured.
    Remove-Item Env:LANGFUSE_BASE_URL, Env:LANGFUSE_PUBLIC_KEY, Env:LANGFUSE_SECRET_KEY -ErrorAction SilentlyContinue
    Assert-Hook (Invoke-Hook $shell 'sessionStart' ($base + @{ source = 'new'; traceparent = $traceparent })) "$shell sessionStart"
    Assert-Hook (Invoke-Hook $shell 'postToolUse' ($base + @{ toolName = 'powershell'; toolArgs = @{ command = 'Get-ChildItem' }; toolResult = @{ resultType = 'success' }; traceparent = $traceparent })) "$shell postToolUse"
    Assert-Hook (Invoke-Hook $shell 'sessionEnd' ($base + @{ reason = 'complete'; traceparent = $traceparent })) "$shell sessionEnd"

    $events = Get-ChildItem (Join-Path $store 'events') | Where-Object { (Get-Content $_.FullName -Raw).Contains($session) }
    if ($events.Count -ne 3) { throw "$shell expected 3 local events for $session, found $($events.Count)" }
    $attributed = Get-ChildItem (Join-Path $store 'attributions') | Where-Object {
        $text = Get-Content $_.FullName -Raw -Encoding utf8
        $text.Contains($session) -and $text.Contains('feature/ABC-123-windows')
    }
    if ($attributed.Count -lt 1) { throw "$shell recorded no Git branch for the non-ASCII repository path" }

    # agentStop must return while the detached sender is still connecting to an
    # unreachable Langfuse host; a leaked stdout handle would hold the host.
    $env:LANGFUSE_BASE_URL = 'https://10.255.255.1'
    $env:LANGFUSE_PUBLIC_KEY = 'pk-lf-smoke'
    $env:LANGFUSE_SECRET_KEY = 'sk-lf-smoke'
    $stop = Invoke-Hook $shell 'agentStop' ($base + @{ stopReason = 'end_turn'; traceparent = $traceparent })
    Assert-Hook $stop "$shell agentStop"
    if ($stop.Seconds -gt 4) { throw "$shell agentStop held the host for $($stop.Seconds) seconds" }
    $status = & (Join-Path $bin 'burnrate-copilot.exe') langfuse status | ConvertFrom-Json
    if ($status.last_attempt.session_id -ne $session) { throw "$shell agentStop did not record an attempt" }
    Write-Output ("{0}: 3 events, branch attributed, agentStop returned in {1:N2}s ({2})" -f $shell, $stop.Seconds, $status.last_attempt.state)
}
