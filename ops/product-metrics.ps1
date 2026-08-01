[CmdletBinding()]
param([switch]$Local)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SqlPath = Join-Path $PSScriptRoot "product-metrics.sql"
$Wrangler = Join-Path $RepoRoot "node_modules\.bin\wrangler.cmd"
$Target = if ($Local) { "--local" } else { "--remote" }
$Sql = (Get-Content $SqlPath) -join " "

$Output = & $Wrangler d1 execute shoshi-hiki $Target --json --command $Sql
if ($LASTEXITCODE -ne 0) { throw "D1 metrics query failed with exit code $LASTEXITCODE" }
$Payload = ($Output -join [Environment]::NewLine) | ConvertFrom-Json
$Row = $Payload[0].results[0]
if (-not $Row) { throw "D1 metrics query returned no result" }

function Get-Percent {
    param([int]$Numerator, [int]$Denominator)
    if ($Denominator -eq 0) { return $null }
    return [Math]::Round(($Numerator / $Denominator) * 100, 1)
}

$Users = [int]$Row.users
$Searchers = [int]$Row.searchers
$Successful = [int]$Row.successful_searches
$NoResult = [int]$Row.no_result_searches
$Searches = $Successful + $NoResult

[ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    service = "shoshi-hiki"
    environment = if ($Local) { "local" } else { "production" }
    funnel = [ordered]@{
        users = $Users
        searchers = $Searchers
        official_readers = [int]$Row.official_readers
        citation_copiers = [int]$Row.citation_copiers
        savers = [int]$Row.savers
        returned = [int]$Row.returned
        successful_searches = $Successful
        no_result_searches = $NoResult
        searchers_7d = [int]$Row.searchers_7d
        official_readers_7d = [int]$Row.official_readers_7d
        qa_rows = [int]$Row.qa_rows
    }
    rates = [ordered]@{
        searcher_percent = Get-Percent $Searchers $Users
        official_reader_percent = Get-Percent ([int]$Row.official_readers) $Users
        citation_copy_percent = Get-Percent ([int]$Row.citation_copiers) $Users
        saver_percent = Get-Percent ([int]$Row.savers) $Users
        return_percent = Get-Percent ([int]$Row.returned) $Users
        successful_search_percent = Get-Percent $Successful $Searches
    }
} | ConvertTo-Json -Depth 4
