param([switch]$SkipIntegration, [ValidateSet('ai','backend','dashboard','blockchain')][string]$StartAt = 'ai')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
if (!$SkipIntegration) { & (Join-Path $PSScriptRoot 'validate-integration.ps1') }
$evidenceDirectory = Join-Path $repoRoot 'artifacts/integration'
$integration = Get-Content -LiteralPath (Join-Path $evidenceDirectory 'report.json') -Raw | ConvertFrom-Json
if ($integration.automatedApiResult -ne 'passed' -or $integration.failure) { throw 'A successful integration run is required first.' }
$validationEnv = Join-Path $evidenceDirectory '.env.validation'
$savedEnvironment = @{}
foreach ($line in (Get-Content -LiteralPath $validationEnv)) {
    $parts = $line -split '=', 2
    if ($parts.Count -eq 2) {
        $savedEnvironment[$parts[0]] = [Environment]::GetEnvironmentVariable($parts[0], 'Process')
        [Environment]::SetEnvironmentVariable($parts[0], $parts[1], 'Process')
    }
}
$composeArguments = @('compose', '--project-name', 'chainroute-validation', '--env-file', $validationEnv, '-f', 'docker-compose.yml')
$suiteResults = New-Object 'System.Collections.Generic.List[object]'
$suiteOrder = @('ai-tests','backend-tests','dashboard-tests-build','blockchain-tests','blockchain-portability')
$skipCount = @{ ai=0; backend=1; dashboard=2; blockchain=3 }[$StartAt]
$skipSuites = if ($skipCount -gt 0) { $suiteOrder[0..($skipCount - 1)] } else { @() }
if ($skipCount -gt 0) {
    $previous = Get-Content -LiteralPath (Join-Path $evidenceDirectory 'acceptance.json') -Raw | ConvertFrom-Json
    foreach ($name in $skipSuites) {
        $passed = $previous.suites | Where-Object { $_.name -eq $name -and $_.exitCode -eq 0 } | Select-Object -Last 1
        if (!$passed) { throw "Cannot resume: no passing $name evidence. Start from ai." }
        $suiteResults.Add($passed)
    }
}
$secondNodeCreated = $false
function Invoke-Suite([string]$name, [string[]]$commandArguments) {
    if ($skipSuites -contains $name) { return }
    $log = Join-Path $evidenceDirectory "$name.log"
    $started = Get-Date
    $previousPreference = $ErrorActionPreference
    try {
        # Docker progress goes to stderr even for successful commands.
        $ErrorActionPreference = 'Continue'
        & docker @composeArguments @commandArguments 2>&1 | Tee-Object -FilePath $log
        $commandExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    $suiteResults.Add([PSCustomObject]@{ name=$name; exitCode=$commandExit; seconds=((Get-Date)-$started).TotalSeconds; log="artifacts/integration/$name.log" })
    if ($commandExit -ne 0) { throw "$name failed. See $log" }
}

try {
    Invoke-Suite 'ai-tests' @('run','--rm','--no-deps','-v',"${repoRoot}:/workspace:ro",'-w','/workspace/ai-engine',
        '-e','AI_RUN_LOG_PATH=/tmp/acceptance-runs.sqlite3','-e','ALLOCATION_PLAN_PATH=/tmp/acceptance-plan.json',
        'ai-engine','sh','-c','pip install --no-cache-dir -r requirements-test.txt && python -m unittest discover -p "test_*.py" -v')
    Invoke-Suite 'backend-tests' @('run','--rm','--no-deps','-v',"${repoRoot}/backend/test:/app/test:ro",
        '-e','LIVE_AI_ENGINE_URL=http://ai-engine:8000','-e','LIVE_CHAIN_RPC_URL=http://blockchain:8545','-e','LIVE_CONTRACT_PATH=/shared/contract.json',
        'backend','sh','-c','TEST_DATABASE_URL="$DATABASE_URL" node --test test/*.test.cjs')
    if ($skipCount -le 2) {
        & docker @composeArguments run --rm --no-deps -v "${repoRoot}:/validation-src:ro" -v "${evidenceDirectory}:/evidence" backend node /validation-src/scripts/integration-flow.cjs refresh-sessions
        if ($LASTEXITCODE -ne 0) { throw 'Could not refresh the live dashboard test sessions.' }
    }
    Invoke-Suite 'dashboard-tests-build' @('run','--rm','--no-deps','-v',"${repoRoot}/dashboard/vitest.config.ts:/app/dashboard/vitest.config.ts:ro",
        '-v',"${repoRoot}/dashboard/integration:/app/dashboard/integration:ro",'-v',"${evidenceDirectory}:/evidence",
        '-e','CHAINROUTE_LIVE_API=http://backend:8080','-e','CHAINROUTE_INTEGRATION_EVIDENCE=/evidence',
        'dashboard','sh','-c','npm test -- --maxWorkers=2 --testTimeout=20000 && npm run build')
    $testMounts = @('-v',"${repoRoot}/blockchain/test:/app/test:ro",'-v',"${repoRoot}/docs:/docs:ro",'-v',"${repoRoot}/samples:/samples:ro")
    Invoke-Suite 'blockchain-tests' (@('run','--rm','--no-deps') + $testMounts + @('blockchain','npm','test'))
    & docker @composeArguments run -d --no-deps --name chainroute-validation-portability blockchain
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the independent portability node.' }
    $secondNodeCreated = $true
    Invoke-Suite 'blockchain-portability' (@('run','--rm','--no-deps') + $testMounts + @('-e','CHAIN_RPC_URL=http://chainroute-validation-portability:8545','blockchain','npm','test','--','--network','local'))
    Write-Host 'Automated acceptance suites passed; manual/external acceptance items remain in the checklist.'
} finally {
    $summary = [PSCustomObject]@{ evaluatedAt=(Get-Date).ToUniversalTime().ToString('o'); suites=$suiteResults.ToArray(); pending=$integration.pending }
    [IO.File]::WriteAllText((Join-Path $evidenceDirectory 'acceptance.json'), ($summary | ConvertTo-Json -Depth 8))
    if ($secondNodeCreated) { & docker rm -f chainroute-validation-portability | Out-Null }
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
