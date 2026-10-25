param(
	[Parameter(Mandatory)]
	[string]$BaseSha,
	[Parameter(Mandatory)]
	[string]$HeadSha,
	[string]$PullRequestTitle = ""
)

$ErrorActionPreference = "Stop"
$shaPattern = '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'
if ($BaseSha -notmatch $shaPattern -or $HeadSha -notmatch $shaPattern) {
	throw "BaseSha and HeadSha must be full Git object IDs."
}

if ($BaseSha -match '^0+$') {
	$range = $HeadSha
} else {
	$range = "$BaseSha..$HeadSha"
}
$commits = @(git rev-list --no-merges $range)
if ($LASTEXITCODE -ne 0) { throw "Unable to read commits in '$range'." }

$messagePath = Join-Path ([IO.Path]::GetTempPath()) "amazon-bot-commit-message-$PID.txt"
$exitCode = 0
try {
	if (-not [string]::IsNullOrWhiteSpace($PullRequestTitle)) {
		[IO.File]::WriteAllText($messagePath, $PullRequestTitle, [Text.UTF8Encoding]::new($false))
		mise exec -- hk util check-conventional-commit $messagePath
		if ($LASTEXITCODE -ne 0) { $exitCode = $LASTEXITCODE }
	}

	if ($exitCode -eq 0) {
		foreach ($commit in $commits) {
			$message = git show -s --format=%B $commit
			if ($LASTEXITCODE -ne 0) { throw "Unable to read commit '$commit'." }
			[IO.File]::WriteAllLines($messagePath, [string[]]$message, [Text.UTF8Encoding]::new($false))
			mise exec -- hk util check-conventional-commit $messagePath
			if ($LASTEXITCODE -ne 0) {
				$exitCode = $LASTEXITCODE
				break
			}
		}
	}
} finally {
	Remove-Item -LiteralPath $messagePath -Force -ErrorAction SilentlyContinue
}

exit $exitCode
