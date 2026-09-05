# Agent memory — git-tracked, shared across machines

Claude Code's persistent memory for this workspace. It used to live only in
one machine's `~/.claude/projects/<workspace>/memory/`; it moved here
(2026-09-05, at the user's request) so every machine that clones the repo
gets it, and edits to it ride ordinary commits.

`MEMORY.md` is the index — one line per memory, loaded into context each
session. Every other file is one fact with frontmatter; see any of them for
the format.

## Wiring a machine

Claude Code reads memory from a per-workspace directory under `~/.claude`,
whose name is the workspace path with `/` replaced by `-`. Point it here with
a symlink (run once per machine, after opening the workspace in Claude Code
at least once so the project directory exists):

```sh
# from the workspace root (the folder that contains moba2d-core/)
proj=~/.claude/projects/$(pwd | tr / -)
rm -rf "$proj/memory"
ln -s "$(pwd)/moba2d-core/docs/agent-memory" "$proj/memory"
```

If the workspace lives at a different path on that machine, the project
directory name differs with it — the `$(pwd | tr / -)` derives it either way.

Two facts worth knowing before adding files here:

- Core's vocabulary-boundary gate scans only `src/**/*.{ts,vue}`, and the npm
  tarball ships only what `package.json`'s `files` lists (`docs/` is not in
  it) — so pack names in these notes break no gate and leak into no tarball.
- The notes describe all four sibling repos, not just core; core hosts them
  because it is the hub every machine has checked out.
