# Choosing a JavaScript and TypeScript CLI Parser

Research date: 2026-10-14

Use Commander as the practical default once a small or medium CLI needs
generated help or subcommands. It parses and validates arguments without a
project scaffold. For flat flags or positional arguments, use Node's built-in
`node:util.parseArgs`. Choose `oclif` when you need generated, extensible
commands. No single choice fits every CLI.

## Tradeoffs

| Use case                                                           | Fit                                      | Why                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A few flags and positional arguments, with no added dependency     | `node:util.parseArgs` (low-level parser) | It parses positional arguments when `allowPositionals` is enabled and rejects unknown arguments in strict mode. The caller supplies help and command routing. [Node docs](https://nodejs.org/api/util.html#utilparseargsconfig) |
| A conventional CLI with flags, help, and subcommands               | Commander (CLI library)                  | It validates options and arguments, supports subcommands, and generates help. Its README includes TypeScript examples. [Commander README](https://github.com/tj/commander.js)                                                   |
| A command-oriented CLI that needs rich parsing or shell completion | `yargs` (parser and CLI builder)         | It supports commands, grouped options, generated help, and Bash and Zsh completion. TypeScript definitions are available through `@types/yargs`. [Project README](https://github.com/yargs/yargs)                               |
| A large CLI with generated commands, plugins, or hooks             | `oclif` (framework)                      | It provides a TypeScript project generator, a plugin model, and hooks. [`oclif` introduction](https://oclif.io/docs/introduction/)                                                                                              |

## Popularity Signal

On 2026-10-14, npm's [first-party downloads API](https://github.com/npm/registry/blob/main/docs/download-counts.md) reported these counts.
The 30-day range is 2026-09-14 through 2026-10-13, inclusive.

- [`commander`](https://api.npmjs.org/downloads/point/2026-09-14:2026-10-13/commander): 2,332,909,993
- [`yargs`](https://api.npmjs.org/downloads/point/2026-09-14:2026-10-13/yargs): 1,189,819,045
- [`@oclif/core`](https://api.npmjs.org/downloads/point/2026-09-14:2026-10-13/@oclif%2Fcore): 53,650,273

Commander led this limited package comparison. It does not establish an
overall popularity ranking of CLI tools. npm's [download-count
explanation](https://blog.npmjs.org/post/92574016600/numeric-precision-matters-how-npm-download-counts-work)
defines downloads as successful package-tarball responses. Counts include
automated build servers, such as CI, and mirrors. They do not count unique
users. [`npm install`](https://docs.npmjs.com/cli/v11/commands/npm-install)
installs a package and its dependencies, so transitive use can contribute to
these counts. The `oclif` count covers `@oclif/core`, not the full `oclif`
ecosystem.

## For This Repository

The bot now takes `--url`, `--max-price`, `--dry-run`, `--no-input`, and
`--version`, so [`src/main.ts`](../../src/main.ts) and
[`scripts/probe.ts`](../../scripts/probe.ts) both use Commander. Commander
generates their `--help` text and validates option values while parsing.

## Sources

- [Node API for `util.parseArgs`](https://nodejs.org/api/util.html#utilparseargsconfig)
- [Commander README](https://github.com/tj/commander.js)
- [`yargs` README](https://github.com/yargs/yargs)
- [`oclif` introduction](https://oclif.io/docs/introduction/)
- [npm downloads API documentation](https://github.com/npm/registry/blob/main/docs/download-counts.md)
- npm API results for [`commander`](https://api.npmjs.org/downloads/point/2026-09-14:2026-10-13/commander), [`yargs`](https://api.npmjs.org/downloads/point/2026-09-14:2026-10-13/yargs), and [`@oclif/core`](https://api.npmjs.org/downloads/point/2026-09-14:2026-10-13/@oclif%2Fcore)
- [npm's download-count explanation](https://blog.npmjs.org/post/92574016600/numeric-precision-matters-how-npm-download-counts-work) and [npm install documentation](https://docs.npmjs.com/cli/v11/commands/npm-install)
