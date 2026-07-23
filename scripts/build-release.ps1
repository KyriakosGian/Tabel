[CmdletBinding()]
param(
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot 'dist'
}
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$manifestPath = Join-Path $projectRoot 'manifest.json'
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
$version = $manifest.version
$stageRoot = Join-Path ([IO.Path]::GetTempPath()) ("tabel-release-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $outputRoot ("tabel-$version-chrome-web-store.zip")

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

try {
  foreach ($file in @('manifest.json', 'background.js')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stageRoot
  }
  foreach ($directory in @('dashboard', 'options', 'icons', '_locales')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $stageRoot -Recurse
  }

  # The Web Store assigns the production public key on the first upload.
  $releaseManifestPath = Join-Path $stageRoot 'manifest.json'
  $releaseManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $releaseManifestPath | ConvertFrom-Json
  $releaseManifest.PSObject.Properties.Remove('key')
  $releaseJson = $releaseManifest | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText(
    $releaseManifestPath,
    $releaseJson,
    [Text.UTF8Encoding]::new($false)
  )

  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($required in @(
      'manifest.json',
      'background.js',
      'dashboard/dashboard.html',
      'options/options.html',
      '_locales/el/messages.json',
      '_locales/en/messages.json',
      'icons/icon128.png'
    )) {
      if ($entryNames -notcontains $required) {
        throw "Release archive is missing $required"
      }
    }
    if ($entryNames | Where-Object { $_ -match '^(tests|docs|release|scripts|dist)/' }) {
      throw 'Release archive contains non-runtime files.'
    }

    $manifestEntry = $archive.GetEntry('manifest.json')
    $reader = [IO.StreamReader]::new($manifestEntry.Open(), [Text.Encoding]::UTF8)
    try {
      $packedManifest = $reader.ReadToEnd() | ConvertFrom-Json
    } finally {
      $reader.Dispose()
    }
    if ($packedManifest.PSObject.Properties.Name -contains 'key') {
      throw 'Release manifest must not contain a development key.'
    }
  } finally {
    $archive.Dispose()
  }

  Write-Output $archivePath
} finally {
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $resolvedStage = [IO.Path]::GetFullPath($stageRoot)
  if ($resolvedStage.StartsWith($tempRoot) -and (Split-Path $resolvedStage -Leaf) -like 'tabel-release-*') {
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force -ErrorAction SilentlyContinue
  }
}
