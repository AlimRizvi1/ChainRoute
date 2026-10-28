param([switch]$ResetOnly)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$project = 'chainroute-validation'
$evidenceDirectory = Join-Path $repoRoot 'artifacts/integration'
$validationEnv = Join-Path $evidenceDirectory '.env.validation'
New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

# Dedicated project and ports. Never resets the ordinary chainroute project.
$envText = @"
POSTGRES_DB=chainroute
POSTGRES_USER=chainroute
POSTGRES_PASSWORD=$(New-LocalSecret)
AUTH_TOKEN_SECRET=$(New-LocalSecret)
DEMO_USER_PASSWORD=$(New-LocalSecret)
CHAIN_OPERATOR_PRIVATE_KEY=
CHAIN_SHIPPER_PRIVATE_KEY=
CHAIN_CARRIER_PRIVATE_KEY=
AI_ENGINE_PORT=18000
CHAIN_RPC_PORT=18545
POSTGRES_PORT=15432
BACKEND_PORT=18080
DASHBOARD_PORT=15173
LOG_LEVEL=warn
"@
# Process environment overrides Compose's env file. Set this run's generated
# values explicitly (an empty process value can otherwise mask the env file).
$savedEnvironment = @{}
foreach ($line in ($envText -split "`n")) {
    $name = ($line -split '=', 2)[0].Trim()
    if ($name) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, ($line -split '=', 2)[1].Trim(), 'Process')
    }
}
$composeArguments = @('compose', '--project-name', $project, '--env-file', $validationEnv, '-f', 'docker-compose.yml')
$chainPaused = $false
$engineStopped = $false
function Invoke-Compose {
    & docker @composeArguments @args
    if ($LASTEXITCODE -ne 0) { throw "Validation Compose command failed (exit $LASTEXITCODE)." }
}
function Invoke-Stage([string]$stage) {
    Write-Host "Validation: $stage"
    Invoke-Compose run --rm --no-deps -v "${repoRoot}:/validation-src:ro" -v "${evidenceDirectory}:/evidence" backend node /validation-src/scripts/integration-flow.cjs $stage
}

try {
    # Existing file is needed only to address old containers; replace credentials
    # after destroying this dedicated project's volumes.
    if (!(Test-Path -LiteralPath $validationEnv)) { [IO.File]::WriteAllText($validationEnv, $envText) }
    Invoke-Compose down --volumes --remove-orphans
    [IO.File]::WriteAllText($validationEnv, $envText)
    Invoke-Compose up -d --build --wait --wait-timeout 300
    if ($ResetOnly) { Write-Host 'Clean validation demo ready at http://localhost:15173 (credentials in ignored artifacts/integration/.env.validation).'; return }
    Invoke-Compose stop ai-engine
    $engineStopped = $true
    try { Invoke-Stage 'ai-outage' } finally { Invoke-Compose up -d --no-deps --wait ai-engine; $engineStopped = $false }
    Invoke-Stage 'prepare-late'
    # Stop and restart the process: persisted EVM state, blocks and receipts must survive.
    Invoke-Compose stop blockchain
    $chainPaused = $true
    try { Invoke-Stage 'queue-delivery' } finally { Invoke-Compose up -d --wait blockchain; $chainPaused = $false }
    Invoke-Stage 'finish'
    $routeEvidence = @()
    foreach ($route in @('/', '/login', '/signup', '/overview', '/orders', '/allocations', '/plans', '/ai-lab', '/blockchain', '/contracts', '/contracts/1', '/audit', '/admin', '/admin/resources')) {
        $page = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:15173$route" -TimeoutSec 20
        if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'id="root"') { throw "Dashboard deep route failed: $route" }
        $routeEvidence += [PSCustomObject]@{ path=$route; status=$page.StatusCode }
    }
    $reportFile = Join-Path $evidenceDirectory 'report.json'
    $finishedReport = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
    $finishedReport.checks += [PSCustomObject]@{ name='Published dashboard deep routes serve the SPA'; passed=$true; evidence=$routeEvidence }
    [IO.File]::WriteAllText($reportFile, ($finishedReport | ConvertTo-Json -Depth 50))
    Write-Host 'Automated API integration passed. Evidence: artifacts/integration/report.json'
} finally {
    try {
        if ($chainPaused) { Invoke-Compose up -d --wait blockchain }
        if ($engineStopped) { Invoke-Compose up -d --no-deps ai-engine }
    } finally {
        foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
    }
}
