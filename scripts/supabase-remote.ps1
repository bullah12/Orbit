param(
  [ValidateSet('login', 'status', 'plan', 'apply')]
  [string]$Action = 'plan'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$expectedProject = 'histxhywpsnazvgcacsv'
$projectRefFile = Join-Path $projectRoot 'supabase/.temp/project-ref'

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw 'WSL is required. This setup uses the Supabase CLI already installed in Ubuntu.'
}

if ($Action -eq 'login') {
  & wsl.exe -d Ubuntu -- supabase login --no-browser
  exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $projectRefFile)) {
  throw 'The Supabase project link is missing. Link the intended project before running migrations.'
}
if ((Get-Content -LiteralPath $projectRefFile -Raw).Trim() -ne $expectedProject) {
  throw "Project link does not match Orbit ($expectedProject). No SQL was run."
}

$linuxRoot = (& wsl.exe -d Ubuntu -- wslpath -a $projectRoot.Replace('\', '/'))
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the project directory in Ubuntu.' }
$linuxRoot = ($linuxRoot | Out-String).Trim()
Write-Host "Orbit Supabase project: $expectedProject"

switch ($Action) {
  'status' { & wsl.exe -d Ubuntu -- supabase --workdir $linuxRoot migration list --linked }
  'plan' { & wsl.exe -d Ubuntu -- supabase --workdir $linuxRoot db push --linked --dry-run }
  'apply' {
    # Keep the CLI's confirmation prompt. Do not reset, seed, or repair history here.
    & wsl.exe -d Ubuntu -- supabase --workdir $linuxRoot db push --linked
  }
}
exit $LASTEXITCODE
