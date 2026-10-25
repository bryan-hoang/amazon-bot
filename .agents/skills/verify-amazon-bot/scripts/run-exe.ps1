#!/usr/bin/env pwsh
# Runs dist/amazon-bot.exe once, the way the user runs it, but bounded and isolated:
# - copies the executable to a scratch folder outside the repo
# - gives it a fresh LOCALAPPDATA, so the user's settings and Edge profile are untouched
# - kills the whole process tree (the bot and its Edge) after -Seconds, whatever happens
# - keeps stdout, stderr, and the exit code as evidence after deleting the scratch folder
#
# Example:
#   pwsh -File .agents/skills/verify-amazon-bot/scripts/run-exe.ps1 -Seconds 90 -- --no-input --dry-run --timeout 60s
#
# No param() block: PowerShell would bind the bot's own dashed flags (and `--`)
# as script parameters. Script options come first; everything after `--` is the bot's.
$ErrorActionPreference = "Stop"
$Seconds = 120
$NoBuild = $false
$BotArgs = @()
for ($i = 0; $i -lt $args.Count; $i++) {
	switch ($args[$i]) {
		"-Seconds" { $Seconds = [int]$args[++$i] }
		"-NoBuild" { $NoBuild = $true }
		"--" { $BotArgs = @($args | Select-Object -Skip ($i + 1)); $i = $args.Count }
		default { throw "unknown option '$($args[$i])'; put the bot's arguments after --" }
	}
}
if ($BotArgs -match '^--no-dry-run(?:=|$)') {
	throw "run-exe.ps1 refuses --no-dry-run because it can place a real order."
}
$repo = (Resolve-Path "$PSScriptRoot/../../../..").Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$evidence = Join-Path ([IO.Path]::GetTempPath()) "amazon-bot-evidence/$stamp"
$scratch = Join-Path ([IO.Path]::GetTempPath()) "amazon-bot-scratch-$stamp"
New-Item -ItemType Directory -Force $evidence, "$scratch/appdata" | Out-Null

if (-not $NoBuild) {
	Push-Location $repo
	try { pnpm exec vp pack 2>&1 | Out-File "$evidence/pack.log" } finally { Pop-Location }
	if ($LASTEXITCODE -ne 0) { throw "vp pack failed; see $evidence/pack.log" }
}
Copy-Item "$repo/dist/amazon-bot.exe" $scratch

$quoted = $BotArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }
$start = @{
	FilePath               = "$scratch/amazon-bot.exe"
	RedirectStandardOutput = "$evidence/stdout.txt"
	RedirectStandardError  = "$evidence/stderr.txt"
	RedirectStandardInput  = "$scratch/empty-stdin.txt"
	Environment            = @{ LOCALAPPDATA = "$scratch/appdata" }
	WindowStyle            = "Hidden"
	PassThru               = $true
}
if ($quoted) { $start.ArgumentList = $quoted }
Set-Content "$scratch/empty-stdin.txt" ""
$process = Start-Process @start
$exited = $process.WaitForExit($Seconds * 1000)
if (-not $exited) { taskkill /T /F /PID $process.Id 2>&1 | Out-Null }

$result = [ordered]@{
	args     = $BotArgs
	exited   = $exited
	exitCode = if ($exited) { $process.ExitCode } else { $null }
	killedAfterSeconds = if ($exited) { $null } else { $Seconds }
	evidence = $evidence
}
$result | ConvertTo-Json | Set-Content "$evidence/result.json"

# Cleanup removes the scratch copy and profile, never the evidence.
Start-Sleep -Seconds 2
Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
$result | ConvertTo-Json
