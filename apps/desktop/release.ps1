<#
.SYNOPSIS
  Reproducible release build of Hashgram for Windows. Prints the SHA-256 of
  every artefact and enforces the installer size budget (< 40 MB).

.DESCRIPTION
  Steps: pnpm install (frozen lockfile) -> frontend build -> `tauri build`
  (NSIS + MSI) -> checksums. Code signing and updater signing are applied
  when the owner supplies the keys through the environment; otherwise the
  script says so in the release notes it writes, and SmartScreen will warn
  on first run.

  Environment (all optional):
    TAURI_SIGNING_PRIVATE_KEY           minisign private key (updater manifest signing;
                                        the owner keeps this offline and only sets it on
                                        the release machine for the duration of the build)
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password
    HASHGRAM_CODESIGN_THUMBPRINT        SHA-1 thumbprint of an EV/OV certificate in the
                                        user's certificate store (signtool)
    HASHGRAM_COMMIT                     commit to bake in (default: git rev-parse)

.EXAMPLE
  pwsh apps/desktop/release.ps1
  pwsh apps/desktop/release.ps1 -SkipInstall
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [string]$OutDir = ""
)

$ErrorActionPreference = "Continue"
$here = $PSScriptRoot
Set-Location $here
$root = Resolve-Path (Join-Path $here "..\..")
$commit = if ($env:HASHGRAM_COMMIT) { $env:HASHGRAM_COMMIT } else { (git -C $root rev-parse --short=12 HEAD).Trim() }
$env:HASHGRAM_COMMIT = $commit
if ($OutDir -eq "") { $OutDir = Join-Path $root "dist\desktop" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Step([string]$m) { Write-Host ""; Write-Host "==> $m" }
function Fail([string]$m) { Write-Host "release: $m"; exit 1 }

Step "toolchain"
rustc --version; cargo --version; node --version; pnpm --version
Write-Host "commit $commit"

if (-not $SkipInstall) {
    Step "pnpm install --frozen-lockfile"
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed" }
}

Step "frontend tests"
pnpm exec vitest run
if ($LASTEXITCODE -ne 0) { Fail "frontend tests failed" }

Step "rust tests (desktop crate)"
Push-Location (Join-Path $root "node")
cargo test -p hashgram-desktop
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "rust tests failed" }
Pop-Location

$updater = $false
if ($env:TAURI_SIGNING_PRIVATE_KEY) {
    $updater = $true
    Write-Host "updater artefacts: signing key present, will produce and sign .sig files"
} else {
    Write-Host "updater artefacts: no TAURI_SIGNING_PRIVATE_KEY; unsigned builds cannot be published as updates"
}

Step "sidecars: hashgram-node and the service wrapper (release)"
Push-Location (Join-Path $root "node")
cargo build --release -p hashgram-node -p hashgram-node-service
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "sidecar build failed" }
Pop-Location
$bin = Join-Path $here "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item (Join-Path $root "node\target\release\hashgram-node.exe") (Join-Path $bin "hashgram-node-x86_64-pc-windows-msvc.exe") -Force
Copy-Item (Join-Path $root "node\target\release\hashgram-node-service.exe") (Join-Path $bin "hashgram-node-service-x86_64-pc-windows-msvc.exe") -Force

Step "tauri build (nsis, msi)"
# PowerShell mangles quoted JSON on the command line; hand Tauri a file.
$cfgFile = Join-Path $env:TEMP "hashgram-tauri-override.json"
$cfgJson = if ($updater) { '{"bundle":{"createUpdaterArtifacts":true}}' } else { '{"bundle":{"createUpdaterArtifacts":false}}' }
Set-Content -Path $cfgFile -Value $cfgJson -Encoding ascii
pnpm tauri build --config $cfgFile
if ($LASTEXITCODE -ne 0) { Fail "tauri build failed" }

$bundle = Join-Path $root "node\target\release\bundle"
$artefacts = @()
$artefacts += Get-ChildItem (Join-Path $bundle "nsis") -Filter *.exe -ErrorAction SilentlyContinue
$artefacts += Get-ChildItem (Join-Path $bundle "msi") -Filter *.msi -ErrorAction SilentlyContinue
$artefacts += Get-ChildItem (Join-Path $bundle "nsis") -Filter *.sig -ErrorAction SilentlyContinue
$artefacts += Get-ChildItem (Join-Path $bundle "msi") -Filter *.sig -ErrorAction SilentlyContinue
if (-not $artefacts) { Fail "no artefacts found under $bundle" }

if ($env:HASHGRAM_CODESIGN_THUMBPRINT) {
    Step "code signing"
    foreach ($a in $artefacts | Where-Object { $_.Extension -in ".exe", ".msi" }) {
        signtool sign /sha1 $env:HASHGRAM_CODESIGN_THUMBPRINT /tr http://timestamp.digicert.com /td sha256 /fd sha256 $a.FullName
        if ($LASTEXITCODE -ne 0) { Fail "signtool failed on $($a.Name)" }
    }
} else {
    Write-Host "code signing: no HASHGRAM_CODESIGN_THUMBPRINT; artefacts are unsigned (SmartScreen will warn)"
}

Step "artefacts and SHA-256"
$notes = @()
$notes += "Hashgram for Windows - commit $commit - built $(Get-Date -Format s)"
$notes += ""
$failures = 0
foreach ($a in $artefacts) {
    Copy-Item $a.FullName $OutDir -Force
    $sha = (Get-FileHash $a.FullName -Algorithm SHA256).Hash.ToLower()
    $mb = [math]::Round($a.Length / 1MB, 2)
    $line = "{0}  {1}  {2} MB" -f $sha, $a.Name, $mb
    Write-Host $line
    $notes += $line
    if ($a.Extension -eq ".exe" -and $a.Length -gt 40MB) { Write-Host "  [FAIL] installer exceeds the 40 MB budget"; $failures++ }
}
$notes += ""
$notes += "Code signing: " + $(if ($env:HASHGRAM_CODESIGN_THUMBPRINT) { "signed" } else { "UNSIGNED - Windows SmartScreen will warn on first run until an EV/OV certificate is used" })
$notes += "Updater: " + $(if ($updater) { "signed manifest artefacts produced" } else { "not produced (no offline minisign key on this machine)" })
$notes += "Verify: (Get-FileHash <file> -Algorithm SHA256).Hash.ToLower()"
$notes | Set-Content (Join-Path $OutDir "RELEASE_NOTES.txt") -Encoding ascii
$notes | ForEach-Object { $_ } | Select-Object -Skip 2 | Where-Object { $_ -match "^[0-9a-f]{64}" } | Set-Content (Join-Path $OutDir "SHA256SUMS.txt") -Encoding ascii
Write-Host ""
Write-Host "artefacts in $OutDir"
if ($failures -gt 0) { exit 1 } else { exit 0 }
