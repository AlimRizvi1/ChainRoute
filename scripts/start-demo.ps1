$ErrorActionPreference = 'Stop'
$demoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $demoRoot
& docker compose up -d --build --wait --wait-timeout 300
if ($LASTEXITCODE -ne 0) { throw 'The services did not start. Check Docker Desktop and the reported service logs.' }
& (Join-Path $PSScriptRoot 'seed-frontend-demo.ps1')
Write-Host 'ChainRoute is ready at http://localhost:5173/login. Use a demo role username and DEMO_USER_PASSWORD from your local .env.'
