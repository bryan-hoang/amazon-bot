#!/usr/bin/env pwsh
# Stops what verification runs started, after a failed or interrupted run:
# processes whose command line names a run-exe.ps1 scratch folder or an exe-test
# folder, then those folders. Leaves the user's own bot and the evidence alone.
#
#   pwsh -File .agents/skills/verify-amazon-bot/scripts/cleanup.ps1
$pattern = 'amazon-bot-(scratch|exe)-'
$all = @(Get-CimInstance Win32_Process)
# The shell that started this script can name the pattern in its own command
# line, so spare this process and every process above it.
$spare = @{}
$id = $PID
while ($id -and -not $spare.ContainsKey($id)) {
	$spare[$id] = $true
	$id = ($all | Where-Object ProcessId -eq $id).ParentProcessId
}
# Only Edge and the bot itself run from those folders.
$stray = @($all | Where-Object {
		$_.CommandLine -match $pattern -and
		-not $spare.ContainsKey($_.ProcessId) -and
		$_.Name -in @("amazon-bot.exe", "msedge.exe")
	})
foreach ($process in $stray) {
	Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
	"stopped $($process.ProcessId) $($process.Name)"
}
Start-Sleep -Seconds 1
$tmp = [IO.Path]::GetTempPath()
foreach ($dir in Get-ChildItem $tmp -Directory | Where-Object Name -match "^$pattern") {
	Remove-Item -Recurse -Force $dir.FullName -ErrorAction SilentlyContinue
	"removed $($dir.FullName)"
}
"done: stopped $($stray.Count) processes; evidence in $(Join-Path $tmp 'amazon-bot-evidence')"
