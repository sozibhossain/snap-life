# =============================================================================
# Production web build for the SNAP Life mobile app.
# Bakes the LIVE client keys into the bundle, exports to dist/, and copies
# vercel.json in. These EXPO_PUBLIC_* keys are public by design (safe to ship).
#
# Run:   .\build-web-prod.ps1
# Then:  cd dist ; vercel --prod
# =============================================================================
Set-Location $PSScriptRoot

# API: point straight at the live backend (CORS_ALLOWED_ORIGINS on Render must
# include this app's Vercel origin). Overrides the localhost value in .env.
$env:EXPO_PUBLIC_API_URL = "https://snap-life-api.onrender.com"

# Clerk PRODUCTION publishable key (instance: clerk.snaplife.co.uk).
$env:EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuc25hcGxpZmUuY28udWsk"

# RevenueCat live SDK keys (public).
$env:EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = "appl_mwBZTxsGGmiudnZsGYAiRoEzdfZ"
$env:EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY = "goog_nlLeoaOHPDicPFZhtMuFuFCZEgC"

Write-Host "Building production web bundle (Clerk LIVE)..." -ForegroundColor Cyan
pnpm exec expo export --platform web --output-dir dist
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed." -ForegroundColor Red; exit 1 }

Copy-Item "$PSScriptRoot\vercel.json" "$PSScriptRoot\dist\vercel.json" -Force
Write-Host "Build done. Next:  cd dist ; vercel --prod" -ForegroundColor Green
