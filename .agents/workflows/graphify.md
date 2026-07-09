---
name: graphify
description: Turn any folder of files into a navigable knowledge graph
---

# Workflow: graphify

Follow the graphify skill installed at ~/.gemini/config/skills/graphify/SKILL.md to run the full pipeline.

If no path argument is given, use `.` (current directory).

Repo wrappers:
- `npm run graphify:setup` repairs hooks and local Codex wiring for this clone.
- `npm run graphify:update` performs the standard incremental refresh after code changes.
- `npm run graphify:doctor` checks whether the graph, hooks, and local machine state are healthy before deeper audits.
