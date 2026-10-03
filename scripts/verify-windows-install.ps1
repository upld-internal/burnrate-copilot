# Operator proof, compatible with Windows PowerShell 5.1 and PowerShell 7.
param(
    [Parameter(Mandatory = $true)][string]$PluginRoot,
    [string]$Version = '0.5.0'
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'invalid_version' }
$repo = 'upld-internal/burnrate-copilot'
$target = 'x86_64-pc-windows-msvc'
$name = "burnrate-copilot-v$Version-$target.tar.gz"
$work = Join-Path ([IO.Path]::GetTempPath()) ("Burnrate verification ü " + [guid]::NewGuid())
New-Item -ItemType Directory $work | Out-Null
function Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'artifact_verification_failed' }
}
try {
    foreach ($asset in $name, "$name.sigstore.json", "$name.intoto.jsonl", 'SHA256SUMS', 'SHA256SUMS.sigstore.json') {
        Checked 'gh' @('release', 'download', "v$Version", '--repo', $repo, '--pattern', $asset, '--dir', $work)
    }
    $identity = "https://github.com/$repo/.github/workflows/release.yml@refs/tags/v$Version"
    foreach ($asset in 'SHA256SUMS', $name) {
        Checked 'cosign' @('verify-blob', '--bundle', (Join-Path $work "$asset.sigstore.json"), '--certificate-identity', $identity, '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', (Join-Path $work $asset))
    }
    $line = @(Get-Content (Join-Path $work 'SHA256SUMS') | Where-Object { $_ -match "^[0-9a-f]{64}  $([regex]::Escape($name))$" })
    if ($line.Count -ne 1) { throw 'missing_or_duplicate_checksum' }
    $expected = $line[0].Substring(0, 64)
    if ((Get-FileHash (Join-Path $work $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'archive_checksum_mismatch' }
    $manifestText = & tar -xOf (Join-Path $work $name) release-manifest.json
    if ($LASTEXITCODE -ne 0) { throw 'manifest_read_failed' }
    $manifest = ($manifestText -join "`n") | ConvertFrom-Json
    if ($manifest.operations_schema_version -ne '1' -or $manifest.product -ne 'burnrate-copilot' -or $manifest.version -ne $Version -or $manifest.target -ne $target -or $manifest.binary_name -ne 'burnrate-copilot.exe' -or $manifest.archive_name -ne $name) { throw 'manifest_mismatch' }
    $tagRef = & gh api "repos/$repo/git/ref/tags/v$Version" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $tagRef.object.type -ne 'tag') { throw 'annotated_tag_required' }
    $tag = & gh api "repos/$repo/git/tags/$($tagRef.object.sha)" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $tag.verification.verified -or $tag.object.sha -ne $manifest.source_revision) { throw 'signed_tag_mismatch' }
    Checked 'gh' @('attestation', 'verify', (Join-Path $work $name), '--repo', $repo, '--bundle', (Join-Path $work "$name.intoto.jsonl"), '--cert-identity', $identity, '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com', '--predicate-type', 'https://slsa.dev/provenance/v1', '--source-ref', "refs/tags/v$Version", '--source-digest', $manifest.source_revision, '--deny-self-hosted-runners')
    $exe = Join-Path $PluginRoot 'bin\x86_64-pc-windows-msvc\burnrate-copilot.exe'
    $digest = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($digest -ne $manifest.binary_sha256) { throw 'installed_binary_mismatch' }
    $info = & $exe build-info | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $info.target -ne $target -or $info.version -ne $Version -or $info.source_revision -ne $manifest.source_revision -or $info.shared_revision -ne $manifest.shared_revision) { throw 'build_identity_mismatch' }
    [pscustomobject]@{ version=$Version; target=$target; source_revision=$info.source_revision; shared_revision=$info.shared_revision; binary_sha256=$digest; package_verified=$true; live_dispatch_verified=$false } | ConvertTo-Json
} finally { Remove-Item -Recurse -Force $work }
