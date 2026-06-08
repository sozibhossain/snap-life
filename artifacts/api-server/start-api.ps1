# Load .env, build, and run the api-server.
# Run from PowerShell:
#   cd c:\sozib\app_developments\may-2026\SNAP-Life\SNAP-Life\artifacts\api-server
#   .\start-api.ps1            # build + start
#   .\start-api.ps1 -NoBuild   # skip rebuild (faster restart after env-only changes)

param([switch]$NoBuild)

$ErrorActionPreference = "Stop"
$envFile = Join-Path $PSScriptRoot ".env"

if (-not (Test-Path $envFile)) {
    Write-Host "Missing $envFile" -ForegroundColor Red
    exit 1
}

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $name = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
    Set-Item -Path "Env:$name" -Value $value
}

if ($env:DATABASE_URL -like "REPLACE_ME*") {
    Write-Host "DATABASE_URL is still a placeholder in .env - set your Neon connection string first." -ForegroundColor Red
    exit 1
}

Write-Host "Env loaded. PORT=$env:PORT  NODE_ENV=$env:NODE_ENV" -ForegroundColor Cyan

# Resolve pnpm without depending on PATH being permanently set.
$pnpmCmd = "pnpm"
if (-not (Get-Command $pnpmCmd -ErrorAction SilentlyContinue)) {
    $pnpmCmd = Join-Path $env:APPDATA "npm\pnpm.cmd"
    if (-not (Test-Path $pnpmCmd)) {
        Write-Host "pnpm not found on PATH or at $pnpmCmd" -ForegroundColor Red
        exit 1
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if (-not $NoBuild) {
    Write-Host "Building api-server..." -ForegroundColor Cyan
    & $pnpmCmd --dir "$repoRoot" --filter "@workspace/api-server" run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Starting api-server on http://localhost:$env:PORT" -ForegroundColor Green
& $pnpmCmd --dir "$repoRoot" --filter "@workspace/api-server" run start
