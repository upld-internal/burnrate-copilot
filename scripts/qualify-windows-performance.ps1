# Measures the exact Windows release executable on a native Windows 11 client
# under shared ADR 0015: an ordinary (non-elevated, non-Session-0) desktop
# session, local storage, unchanged budgets. Hosted Windows Server latency is
# diagnostic only; publication requires this receipt for the same binary.
#
# Every repetition must pass. Orphan recovery is a single-sample operation, so
# repeating the shared benchmark is what exposes its variance.
param(
    [Parameter(Mandatory)][string]$Binary,
    [Parameter(Mandatory)][string]$Benchmark,
    [Parameter(Mandatory)][string]$SharedRoot,
    [Parameter(Mandatory)][string]$EvidenceRoot,
    [ValidateRange(1, 10)][int]$Repeat = 3
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Binary = (Resolve-Path -LiteralPath $Binary).Path
$Benchmark = (Resolve-Path -LiteralPath $Benchmark).Path
$SharedRoot = (Resolve-Path -LiteralPath $SharedRoot).Path
[IO.Directory]::CreateDirectory($EvidenceRoot) | Out-Null

$os = Get-CimInstance Win32_OperatingSystem
$session = (Get-Process -Id $PID).SessionId
$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsWindows -or $os.ProductType -ne 1 -or [int]$os.BuildNumber -lt 26200 -or
    [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64' -or
    [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64' -or
    $session -eq 0 -or $elevated) {
    throw 'Performance qualification requires an ordinary native Windows 11 25H2 x64 client session'
}

$build = & $Binary build-info | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $build.target -ne 'x86_64-pc-windows-msvc') { throw 'Invalid Windows build information' }
$sharedHead = & git -C $SharedRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $sharedHead -ne $build.shared_revision) { throw 'Shared checkout does not match the binary shared revision' }
$dirty = & git -C $SharedRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Shared checkout must be clean' }
$digest = (Get-FileHash -LiteralPath $Binary -Algorithm SHA256).Hash.ToLowerInvariant()

$runs = @()
for ($n = 1; $n -le $Repeat; $n++) {
    $providerFile = Join-Path $EvidenceRoot "provider-hook-$n.json"
    & $Benchmark $Binary > $providerFile
    $providerExit = $LASTEXITCODE
    $sharedFile = Join-Path $EvidenceRoot "shared-$n.json"
    & cargo run --locked --release --manifest-path "$SharedRoot\Cargo.toml" -p burnrate-adapter-kit --example operational-benchmarks -- --release-profile > $sharedFile 2> (Join-Path $EvidenceRoot "shared-$n-build.log")
    $sharedExit = $LASTEXITCODE
    $runs += [ordered]@{
        provider_exit = $providerExit
        shared_exit = $sharedExit
        provider = Get-Content -Raw -LiteralPath $providerFile | ConvertFrom-Json
        shared = Get-Content -Raw -LiteralPath $sharedFile | ConvertFrom-Json
    }
}
if ($digest -ne (Get-FileHash -LiteralPath $Binary -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Binary changed during qualification' }

$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$receipt = [ordered]@{
    schema_version = 1
    policy = 'windows-client-performance-v1'
    recorded_utc = [DateTime]::UtcNow.ToString('o')
    build_info = $build
    binary_sha256 = $digest
    windows_build = [int]$os.BuildNumber
    windows_display_version = $cv.DisplayVersion
    windows_ubr = [int]$cv.UBR
    product_type = [int]$os.ProductType
    os_architecture = 'X64'
    process_architecture = 'X64'
    session = $session
    elevated = $elevated
    runs = $runs
    passed = -not ($runs | Where-Object { $_.provider_exit -ne 0 -or $_.shared_exit -ne 0 })
}
$receipt | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'windows-client-qualification.json')
if (-not $receipt.passed) { exit 1 }
