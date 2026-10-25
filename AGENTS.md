# Agent Notes

`amazon-bot.exe` is a Windows tool for a nontechnical user: it watches one
Amazon product page and buys the item at or under a price limit. The
[README](README.md) covers usage and the build and check commands.

## Where Things Live

- `src/amazon.ts` holds every Amazon selector and page rule. After changing a
  selector, run `vp run probe <url>` against a live product page.
- `src/main.ts` holds the command-line options, prompts, saved settings, and
  the polling loop.
- The `pack` block in `vite.config.ts` builds the executable.
- The `build` script in `package.json` runs `vp pack`; packaged executable tests
  and release builds use that script.

## Rules and Enforcement

| Rule                                                                                                                                         | Enforcement                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| After changing an Amazon selector, run `vp run probe <url>` against a live product page.                                                     | Manual probe; CI uses stand-in pages and cannot validate live Amazon selectors.                                            |
| After changing dependencies, options, prompts, or startup code, run `vp test --project exe`; add CLI and prompt cases to `test/exe.test.ts`. | Windows CI runs `hk check --all --slow`, including the packaged executable tests.                                          |
| Use bounded `run-exe.ps1` dry runs for verification; real orders charge the user's card and cannot be undone.                                | The runner isolates `LOCALAPPDATA`, kills the process tree, and rejects `--no-dry-run`; a packaged test checks that guard. |
| Use Conventional Commit messages for PR titles and commits.                                                                                  | `hk.pkl` checks local commit messages; CI runs `scripts/check-conventional-commits.ps1` on PR titles and commit ranges.    |
| Use Release Please for versioning; do not add alternate release files after bot comments.                                                    | `release-please-config.json` and `.release-please-manifest.json` are the version source of truth.                          |
| Release Please PR checks require `RELEASE_PLEASE_TOKEN`.                                                                                     | `ci.yml` fails fast if the repository secret is missing.                                                                   |
| Recover a failed release build or upload by rerunning failed jobs.                                                                           | `README.md` documents that full workflow reruns do not resume existing drafts.                                             |
