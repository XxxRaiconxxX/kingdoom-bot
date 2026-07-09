# Graphify Operations

This repo keeps Graphify operational as a local working layer for Codex, Antigravity, and other AI agents.

## Canonical layout

- `AGENTS.md`
  - Tracked repo guidance for Codex and any agent that reads repo instructions.
- `.agents/rules/graphify.md`
  - Tracked Antigravity steering rule.
- `.agents/workflows/graphify.md`
  - Tracked Antigravity workflow hint.
- `graphify-out/`
  - Local graph outputs kept at the repo root because Graphify resolves `graphify-out/graph.json` relative to the current project.
  - Ignored by Git on purpose.
- `.codex/hooks.json`
  - Local Codex hook config for `graphify hook-check`.
  - Ignored by Git on purpose.
- `.git/hooks/post-commit` and `.git/hooks/post-checkout`
  - Installed by `graphify hook install`.
  - Keep the code graph refreshed after commits and branch changes.

## Standard commands

- `npm run graphify:setup`
  - Repairs local Codex hook wiring and ensures Graphify git hooks are installed for the current clone.
- `npm run graphify:doctor`
  - Reports whether the CLI, graph, tracked instructions, git hooks, and local Codex hook file are healthy.
- `npm run graphify:update`
  - Incremental refresh for code changes.
  - Use this during active work when files changed but are not committed yet.
- `npm run graphify:rebuild`
  - Full rebuild when the graph is missing, corrupted, or after a major refactor.
- `npm run graphify:watch`
  - Optional long-running watcher for local sessions that need continuous refresh.

## Update policy

- After code commits:
  - The official Graphify git hook should refresh the code graph automatically.
- After branch switches or pulls:
  - The official Graphify checkout hook should refresh the local graph automatically.
- During an uncommitted coding session:
  - Run `npm run graphify:update` before asking architecture or cross-file questions.
- After doc, image, or paper changes:
  - Run a manual refresh or rebuild if those artifacts matter to the graph answer you need.

## Troubleshooting

- If Graphify answers feel stale:
  - Run `npm run graphify:doctor`.
  - Then run `npm run graphify:update`.
- If Codex stops honoring `graphify hook-check`:
  - Run `npm run graphify:setup`.
- If `graphify-out/graph.json` is missing:
  - Run `npm run graphify:rebuild`.
- If another agent clone lacks Graphify behavior:
  - Make sure it reads `AGENTS.md` or `.agents/` and run `npm run graphify:setup` in that clone.
