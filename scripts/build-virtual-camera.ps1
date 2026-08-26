param([string]$OutputDir = "$PSScriptRoot\..\resources\virtual-camera")

$ErrorActionPreference = 'Stop'
$upstream = 'https://github.com/smourier/VCamNetSample.git'
$revision = 'bbf09db389a4907159714830e73a3ec2d73e658e'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("lancast-vcam-" + [Guid]::NewGuid().ToString('N'))
$sourceOutput = Join-Path $work 'source-output'
$managerOutput = Join-Path $work 'manager-output'

try {
  git clone --quiet --filter=blob:none $upstream $work
  git -C $work checkout --quiet $revision

  Copy-Item -LiteralPath "$PSScriptRoot\..\native\virtual-camera\Shared.cs" -Destination "$work\VCamNetSampleSourceAOT\Shared.cs" -Force
  Copy-Item -LiteralPath "$PSScriptRoot\..\native\virtual-camera\FrameGenerator.cs" -Destination "$work\VCamNetSampleSourceAOT\FrameGenerator.cs" -Force
  Copy-Item -LiteralPath "$PSScriptRoot\..\native\virtual-camera\Program.cs" -Destination "$work\VCamNetSampleAOT\Program.cs" -Force

  $streamPath = "$work\VCamNetSampleSourceAOT\MediaStream.cs"
  $stream = Get-Content -LiteralPath $streamPath -Raw
  $stream = $stream.Replace('public const int NUM_IMAGE_ROWS = 960;', 'public const int NUM_IMAGE_ROWS = 720;')
  $set3DPattern = '(?s)    public HRESULT Set3DManager\(nint manager\)\s*\{.*?\r?\n    \}\s*\r?\n\s*    public HRESULT BeginGetEvent'
  $set3DReplacement = @'
    public HRESULT Set3DManager(nint manager)
    {
        // LANCAST writes a WIC bitmap in the Frame Server-readable source.
        // Do not configure a GPU allocator whose surfaces cannot be CPU-locked.
        return Constants.S_OK;
    }

    public HRESULT BeginGetEvent
'@
  $stream = [regex]::Replace($stream, $set3DPattern, $set3DReplacement)
  if ($stream -notmatch 'Do not configure a GPU allocator') { throw 'Could not patch the upstream MediaStream CPU path.' }
  $managerProject = "$work\VCamNetSampleAOT\VCamNetSampleAOT.csproj"
  $managerXml = (Get-Content -LiteralPath $managerProject -Raw).Replace('<OutputType>WinExe</OutputType>', '<OutputType>Exe</OutputType>')
  Set-Content -LiteralPath $streamPath -Value $stream -Encoding UTF8
  Set-Content -LiteralPath $managerProject -Value $managerXml -Encoding UTF8

  dotnet publish "$work\VCamNetSampleSourceAOT\VCamNetSampleSourceAOT.csproj" -c Release -r win-x64 --self-contained true -p:AssemblyName=LANCAST.VirtualCameraSource -o $sourceOutput
  dotnet publish $managerProject -c Release -r win-x64 --self-contained true -p:AssemblyName=LANCAST.VirtualCamera -o $managerOutput

  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  Copy-Item -LiteralPath "$sourceOutput\LANCAST.VirtualCameraSource.dll" -Destination $OutputDir -Force
  Copy-Item -LiteralPath "$managerOutput\LANCAST.VirtualCamera.exe" -Destination $OutputDir -Force
  foreach ($pdb in @("$sourceOutput\LANCAST.VirtualCameraSource.pdb", "$managerOutput\LANCAST.VirtualCamera.pdb")) {
    if (Test-Path -LiteralPath $pdb) { Copy-Item -LiteralPath $pdb -Destination $OutputDir -Force }
  }
}
finally {
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
