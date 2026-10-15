#!/usr/bin/env pwsh
# Read-only check: is this checkout ready to drive amazon-bot? Prints one line per
# check and exits 1 if any check fails.
#
#   pwsh -File .agents/skills/verify-amazon-bot/scripts/doctor.ps1
$repo = (Resolve-Path "$PSScriptRoot/../../../..").Path
$failed = $false
function Check([string]$name, [bool]$ok, [string]$detail) {
	"{0} {1}: {2}" -f ($(if ($ok) { "ok  " } else { "FAIL" }), $name, $detail)
	if (-not $ok) { $script:failed = $true }
}

Check "windows" $IsWindows "the executable and its tests only run on Windows"

$edge = @(
	"${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
	"$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
Check "edge" ($null -ne $edge) $(if ($edge) { $edge } else { "Microsoft Edge not found" })

$node = (node --version) 2>$null
Check "node" ($node -match '^v2[6-9]\.') "found $node; vp pack needs 25.7 or later and .node-version pins 26"

Check "dependencies" (Test-Path "$repo/node_modules/vite-plus") "run 'pnpm install' if this fails"

$exe = "$repo/dist/amazon-bot.exe"
$want = (Get-Content "$repo/package.json" -Raw | ConvertFrom-Json).version
if (Test-Path $exe) {
	$got = (& $exe --version 2>&1) -join ""
	Check "build" ($got -eq $want) "dist/amazon-bot.exe reports '$got', package.json says '$want'"
} else {
	Check "build" $false "dist/amazon-bot.exe missing; run 'pnpm exec vp pack' or let run-exe.ps1 build it"
}

# The user's real bot runs on %LOCALAPPDATA%\amazon-bot\profile. Never drive that one.
$real = Join-Path $env:LOCALAPPDATA "amazon-bot\profile"
$live = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
		Where-Object { $_.CommandLine -and $_.CommandLine.Contains($real) })
Check "user's bot" ($live.Count -eq 0) $(if ($live.Count) { "the user's own bot is running; do not touch it" } else { "not running" })

if ($failed) { exit 1 }
