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
  if ($LASTEXITCODE -ne 0) { throw '语法检查失败' }
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw '自动测试失败' }
  & npm.cmd run dist
  if ($LASTEXITCODE -ne 0) { throw '安装包构建失败' }
}

foreach ($file in @($installer, $blockMap, $updateManifest)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "缺少发布文件：$file" }
}

& gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw '请先运行 gh auth login 登录 GitHub' }

& gh release view $tag --repo Manji1233/codex-flow-desktop *> $null
if ($LASTEXITCODE -eq 0) {
  & gh release upload $tag $installer $blockMap $updateManifest --clobber --repo Manji1233/codex-flow-desktop
} else {
  & gh release create $tag $installer $blockMap $updateManifest --target main --title "ChatGPT Codex $version" --generate-notes --repo Manji1233/codex-flow-desktop
}

if ($LASTEXITCODE -ne 0) { throw 'GitHub Release 发布失败' }
Write-Output "已发布 ChatGPT Codex $version：$tag"
