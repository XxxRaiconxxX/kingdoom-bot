---
trigger: always_on
description: Consult the graphify knowledge graph at graphify-out/ for codebase and architecture questions.
---

## graphify

This project has a graphify knowledge graph at graphify-out/.

Operational notes:
- `graphify-out/` stays at the project root and is ignored by Git because Graphify subcommands resolve it relative to the current repo.
- `.codex/hooks.json` is local machine state; repair it with `npm run graphify:setup` when Codex stops running `graphify hook-check`.

Rules:
- For codebase or architecture questions, when `graphify-out/graph.json` exists, first run `graphify query "<question>"` (CLI) or `query_graph` (MCP). Use `graphify path "<A>" "<B>"` / `shortest_path` for relationships and `graphify explain "<concept>"` / `get_node` for focused concepts. These return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output.
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context
- Prefer `npm run graphify:update` when the package scripts are available; it keeps the repo-local Graphify setup aligned before calling the CLI.
- Use `npm run graphify:doctor` if the graph looks stale, hooks stop firing, or a fresh agent clone does not see Graphify state.
- After modifying code files in this session, run `npm run graphify:update` (or `graphify update .` as fallback) to keep the graph current.
