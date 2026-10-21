$ErrorActionPreference = 'Stop'
$demoRepository = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $demoRepository
$demoArtifacts = Join-Path $demoRepository 'artifacts/demo'
New-Item -ItemType Directory -Force -Path $demoArtifacts | Out-Null
& docker compose run --rm --no-deps -v "${demoRepository}/scripts:/demo-scripts:ro" -v "${demoArtifacts}:/demo-data" backend node /demo-scripts/seed-frontend-demo.cjs
if ($LASTEXITCODE -ne 0) { throw 'Frontend demo seed failed; existing data was preserved.' }
