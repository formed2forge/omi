# Publishes win-automation-helper as a self-contained single-file exe into
# resources/win-automation-helper/ (gitignored). Ships via electron-builder's
# `asarUnpack: resources/**`, resolved at runtime by resolveHelperPath.ts.
$ErrorActionPreference = 'Stop'
$proj = Join-Path $PSScriptRoot '..\src\main\automation\helper'
$out = Join-Path $PSScriptRoot '..\resources\win-automation-helper'

dotnet publish $proj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -o $out
if ($LASTEXITCODE -ne 0) {
  Write-Host @'
build-automation-helper: dotnet publish failed.
If the error was NU1100 Microsoft.NET.ILLink.Tasks, this SDK needs nuget.org
(PublishSingleFile restores ILLink + runtime packs). Check:
  dotnet nuget list source
then either pull desktop/windows/nuget.config or:
  dotnet nuget add source https://api.nuget.org/v3/index.json -n nuget.org
'@
  throw 'build-automation-helper: dotnet publish failed'
}

if (-not (Test-Path (Join-Path $out 'win-automation-helper.exe'))) {
  throw 'build-automation-helper: win-automation-helper.exe was not produced'
}
Write-Host "build-automation-helper: published to $out"
