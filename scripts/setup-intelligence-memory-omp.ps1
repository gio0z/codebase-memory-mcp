$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Source = Join-Path $RootDir 'omp\extension\workspace-provider.js'

if (-not (Test-Path $Source)) {
  throw "Missing provider extension: $Source"
}

$Binary = Get-Command codebase-memory-mcp -ErrorAction SilentlyContinue
if (-not $Binary) {
  throw 'codebase-memory-mcp is not on PATH. Install/build the engine first.'
}

if ($env:PI_CODING_AGENT_DIR) {
  $AgentDir = $env:PI_CODING_AGENT_DIR
} else {
  $OmpDir = Join-Path $HOME '.omp\agent'
  $OhOmpDir = Join-Path $HOME '.oh-omp\agent'
  if ((Test-Path $OmpDir) -or -not (Test-Path $OhOmpDir)) {
    $AgentDir = $OmpDir
  } else {
    $AgentDir = $OhOmpDir
  }
}

$TargetDir = Join-Path $AgentDir 'extensions'
$Target = Join-Path $TargetDir 'codebase-memory-workspace-provider.js'
New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
Copy-Item -Path $Source -Destination $Target -Force

Write-Host "Installed codebase-memory intelligence provider:"
Write-Host "  $Target"
Write-Host ''
Write-Host 'Provider domain:'
Write-Host '  structural.code'
Write-Host ''
Write-Host 'Next:'
Write-Host '  1. Make sure intelligence-memory is installed in OMP.'
Write-Host '  2. Restart/reload OMP.'
Write-Host '  3. In an indexed project, run: /intel doctor'
