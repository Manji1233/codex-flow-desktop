param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$package = Get-Content package.json -Raw | ConvertFrom-Json
$version = $package.version
$tag = "v$version"
$installer = Join-Path $root "dist\ChatGPT-Codex-Setup-$version.exe"
$blockMap = "$installer.blockmap"
$updateManifest = Join-Path $root 'dist\latest.yml'

if (-not $SkipBuild) {
  if (-not $env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
  if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) { $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/' }
  & npm.cmd run check
  if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed' }
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
  & npm.cmd run dist
  if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
}

foreach ($file in @($installer, $blockMap, $updateManifest)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "Missing release file: $file" }
}

& gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Run gh auth login before publishing' }

& gh release view $tag --repo Manji1233/codex-flow-desktop *> $null
if ($LASTEXITCODE -eq 0) {
  & gh release upload $tag $installer $blockMap $updateManifest --clobber --repo Manji1233/codex-flow-desktop
} else {
  & gh release create $tag $installer $blockMap $updateManifest --target main --title "ChatGPT Codex $version" --generate-notes --repo Manji1233/codex-flow-desktop
}

if ($LASTEXITCODE -ne 0) { throw 'GitHub Release publish failed' }
Write-Output "Published ChatGPT Codex ${version}: $tag"
