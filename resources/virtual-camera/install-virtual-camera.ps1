param(
  [ValidateSet('install')][string]$Mode = 'install',
  [Parameter(Mandatory = $true)][string]$SourceDir
)

$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath),
    '-Mode', $Mode, '-SourceDir', ('"{0}"' -f $SourceDir)
  )
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  exit $process.ExitCode
}

$installDir = Join-Path $env:ProgramFiles 'LANCAST Virtual Camera'
$frameDir = Join-Path $env:ProgramData 'LANCAST'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
New-Item -ItemType Directory -Force -Path $frameDir | Out-Null

$files = @(
  'LANCAST.VirtualCamera.exe',
  'LANCAST.VirtualCamera.pdb',
  'LANCAST.VirtualCameraSource.dll',
  'LANCAST.VirtualCameraSource.pdb'
)
foreach ($file in $files) {
  $source = Join-Path $SourceDir $file
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $installDir $file) -Force
  }
}

# The Windows Frame Server runs outside the signed-in user's profile. Keep the
# component read-only but let normal users replace only the current JPEG frame.
& icacls.exe $installDir /inheritance:e /grant '*S-1-5-32-545:(OI)(CI)(RX)' /T /Q | Out-Null
& icacls.exe $frameDir /inheritance:e /grant '*S-1-5-32-545:(OI)(CI)(M)' /T /Q | Out-Null

$sourceDll = Join-Path $installDir 'LANCAST.VirtualCameraSource.dll'
if (-not (Test-Path -LiteralPath $sourceDll)) {
  throw 'The LANCAST virtual-camera source DLL is missing from this build.'
}
& (Join-Path $env:SystemRoot 'System32\regsvr32.exe') /s $sourceDll
if ($LASTEXITCODE -ne 0) { throw "Virtual-camera registration failed with code $LASTEXITCODE." }
