# Amazon Bot Features

One file per user-facing feature. Each says how the user reaches it, how to
drive it, and what output proves it works.

| Feature                                | File                                | Driven by                              |
| -------------------------------------- | ----------------------------------- | -------------------------------------- |
| Command-line options, help, and errors | [Options](options.md)               | `run-exe.ps1`                          |
| Questions, saved answers, and defaults | [Prompts](prompts.md)               | Executable tests in a terminal session |
| Unattended run and `--timeout`         | [Unattended run](unattended-run.md) | `run-exe.ps1`                          |
| Reading a live product page            | [Probe](probe.md)                   | `vp run probe`                         |
| Buying (dry run)                       | [Checkout](checkout.md)             | Not drivable by an agent               |
