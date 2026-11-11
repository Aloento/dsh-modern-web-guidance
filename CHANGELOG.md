# Changelog

## 0.1.2

`mwg_legacy_scan` was unusable on a real machine. Three defects, one tool:

- **Scanned the home directory by default.** The CLI inherited the harness
  process cwd, which on Windows is `C:\Users\<name>`. A call without `path`
  walked every unrelated install on the box (Edge extensions, Office add-ins)
  and returned dozens of irrelevant findings. The tool now resolves the session
  workspace from `exec.agent.meta.cwd` and refuses to scan the home directory
  when no path was given.
- **Opaque `Error: {`.** When a scan exited non-zero after already printing its
  JSON report (locked file, deleted directory), the error path took the first
  line of stdout — a literal `{`. Partial JSON reports are now accepted with a
  warning, and an error that is not a report never renders as a brace.
- **Unbounded output.** A 54-finding scan returned ~30 KB of raw JSON. The tool
  now returns findings grouped by guide, capped at 15 entries, with
  `full: true` as the explicit opt-in for the raw report.

All four tools now run in the session workspace, so `.mwgrc` is looked up where
the project actually is.

## 0.1.1

Initial public release.

- `mwg_retrieve` keeps the guides it found when one id in the batch is unknown
- cancellation and timeout are no longer reported as generic command failures
- a missing CLI is re-resolved on the next call instead of being cached as absent
- tarball naming is version-aware; stale staged tarballs are pruned
