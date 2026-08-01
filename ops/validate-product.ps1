[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WorkerPath = Join-Path $RepoRoot "src\worker.tsx"
$DomainPath = Join-Path $RepoRoot "src\domain\books.ts"
$MigrationPath = Join-Path $RepoRoot "migrations\0001_telemetry.sql"
$AppPath = Join-Path $RepoRoot "public\app.js"
$StylesPath = Join-Path $RepoRoot "public\styles.css"
$SourcePath = Join-Path $RepoRoot "SOURCE.md"
$WranglerPath = Join-Path $RepoRoot "wrangler.jsonc"
$PublicDirectory = Join-Path $RepoRoot "public"

$RequiredFiles = @(
    "DECISIONS.md", "EXPERIMENT.md", "LICENSE", "METRICS.md", "PRIVACY.md", "README.md", "SECURITY.md", "SOURCE.md", "STACK.md",
    ".github\workflows\ci.yml", "migrations\0001_telemetry.sql", "ops\product-metrics.ps1", "ops\product-metrics.sql",
    "ops\submit-indexnow.ps1", "public\app.js", "public\favicon.svg", "public\manifest.webmanifest", "public\og.svg", "public\robots.txt",
    "src\domain\books.ts", "src\worker.tsx", "test\books.test.ts", "test\surface.test.ts"
)
foreach ($RelativePath in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $RelativePath))) { throw "Missing required release file: $RelativePath" }
}

$Worker = Get-Content -Raw -LiteralPath $WorkerPath
$Domain = Get-Content -Raw -LiteralPath $DomainPath
$Migration = Get-Content -Raw -LiteralPath $MigrationPath
$App = Get-Content -Raw -LiteralPath $AppPath
$Styles = Get-Content -Raw -LiteralPath $StylesPath
$Source = Get-Content -Raw -LiteralPath $SourcePath
$Wrangler = Get-Content -Raw -LiteralPath $WranglerPath
$ProductSurface = @($Worker, $App) -join "`n"

if (-not $Worker.Contains('class="catalogue-scene"') -or -not $Worker.Contains('class="card-cabinet"') -or -not $Worker.Contains('class="catalogue-card"') -or -not $App.Contains('card.className = "book-card"') -or -not $Worker.Contains('class="saved-drawer"')) { throw "Expected the catalogue, cabinet, index-card, and saved-drawer visual system" }
if ($ProductSurface -match '(?i)public validation|success criteria|experiment|仮説|成功条件|市場スコア|移行候補|収益性') { throw "Research copy must not appear on the product surface" }
if ($Styles -match '(?i)gradient') { throw "Product CSS must not use gradients" }
if ($Styles -match '(?s)h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px') { throw "Primary heading is too large" }
if ($ProductSurface -match '(?i)innerHTML|eval\(|new Function|dangerouslySetInnerHTML') { throw "Official bibliographic data must not be interpreted as markup or code" }
if (-not $Worker.Contains('app.post("/api/search"') -or -not $Worker.Contains('c.header("Cache-Control", "no-store")')) { throw "Search must use a non-cacheable POST API" }
if ($Worker -match '/search\?q=|URLSearchParams\(.+query') { throw "Search conditions must not enter product URLs" }
if ($Migration -match '(?i)search_query|query_text|isbn|bib_id|email|phone_number|telephone|advertising_id|password') { throw "Search, bibliographic, contact, advertising, and authentication data do not belong in telemetry storage" }
if (-not $Migration.Contains("CHECK(event_name IN") -or -not $Worker.Contains("35 * 86400")) { throw "Expected allowlisted telemetry and 35-day retention" }
if (-not $Worker.Contains('blockConcurrencyWhile') -or -not $Worker.Contains('last_upstream_finished_at') -or -not $Worker.Contains('2000 - (Date.now() - lastFinishedAt)')) { throw "Official API calls must be serialized and courteously delayed after completion" }
if (-not $Domain.Contains('url.searchParams.set("cnt", "20")') -or -not $Domain.Contains('iss-ndl-opac-national') -or -not $Domain.Contains('mediatype') -or -not $Domain.Contains('2_000_000')) { throw "Expected bounded national-bibliography book retrieval" }
if (-not $Domain.Contains('<!DOCTYPE|<!ENTITY') -or -not $Domain.Contains('https://ndlsearch.ndl.go.jp')) { throw "Expected XML and official-destination safeguards" }
if (-not $Source.Contains("国立国会図書館サーチ") -or -not $Source.Contains("iss-ndl-opac-national") -or -not $Source.Contains("クリエイティブ・コモンズ 表示 4.0 国際") -or -not $Source.Contains("加工")) { throw "Official source, attribution, license, and transformation boundaries are incomplete" }
if ($ProductSurface -match '(?i)better-auth|betterAuth') { throw "Account authentication is not needed for local bibliographic cards" }
if ($Wrangler.Contains("00000000-0000-0000-0000-000000000000")) { throw "The production D1 database ID has not been configured" }
if ((Get-Item -LiteralPath (Join-Path $PublicDirectory "og.svg")).Length -lt 1500) { throw "Expected a product-specific OG SVG larger than 1.5 KB" }
if ((Get-Item -LiteralPath $AppPath).Length -lt 7000) { throw "Expected a substantial search and saved-card client" }

$KeyFiles = @(Get-ChildItem -LiteralPath $PublicDirectory -File | Where-Object { $_.Name -match "^[a-zA-Z0-9-]{8,128}\.txt$" })
if ($KeyFiles.Count -ne 1) { throw "Expected exactly one generated IndexNow key file, found $($KeyFiles.Count)" }
$Key = (Get-Content -Raw -LiteralPath $KeyFiles[0].FullName).Trim()
if ($Key -ne $KeyFiles[0].BaseName) { throw "IndexNow key file name and content do not match" }

Write-Output "Product release contract is satisfied"
