import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const GRAPH_PATH = path.join(ROOT, 'graphify-out', 'graph.json');
const AGENTS_PATH = path.join(ROOT, 'AGENTS.md');
const AGENT_RULE_PATH = path.join(ROOT, '.agents', 'rules', 'graphify.md');
const AGENT_WORKFLOW_PATH = path.join(ROOT, '.agents', 'workflows', 'graphify.md');
const CODEX_HOOKS_PATH = path.join(ROOT, '.codex', 'hooks.json');

const CODEX_HOOKS = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: 'graphify hook-check',
          },
        ],
      },
    ],
  },
};

function run(command, args, { quiet = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (!allowFailure && result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }

  return result;
}

function ensureGraphifyCli() {
  const result = run('graphify', ['--help'], { quiet: true, allowFailure: true });

  if (result.status === 0) {
    return;
  }

  console.error('[graphify] El CLI no esta disponible en PATH.');
  console.error('[graphify] Instala Graphify con `uv tool install graphifyy` o `python -m pip install graphifyy`.');
  process.exit(1);
}

function ensureCodexHooksFile() {
  mkdirSync(path.dirname(CODEX_HOOKS_PATH), { recursive: true });
  writeFileSync(CODEX_HOOKS_PATH, `${JSON.stringify(CODEX_HOOKS, null, 2)}\n`, 'utf8');
  console.log('[graphify] .codex/hooks.json sincronizado con `graphify hook-check`.');
}

function ensureGitHooksInstalled() {
  const result = run('graphify', ['hook', 'status'], { quiet: true, allowFailure: true });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

  if (result.status !== 0 || /not installed/i.test(output)) {
    console.log('[graphify] Instalando hooks oficiales de Graphify...');
    run('graphify', ['hook', 'install']);
    return;
  }

  console.log(output || '[graphify] Hooks oficiales ya activos.');
}

function printChecklistLine(label, ok, detail) {
  const marker = ok ? 'OK' : 'WARN';
  console.log(`[graphify] ${marker} ${label}: ${detail}`);
}

function doctor() {
  ensureGraphifyCli();

  const agentsText = existsSync(AGENTS_PATH) ? readFileSync(AGENTS_PATH, 'utf8') : '';
  const hasAgentsSection = agentsText.includes('## graphify');
  const hasRule = existsSync(AGENT_RULE_PATH);
  const hasWorkflow = existsSync(AGENT_WORKFLOW_PATH);
  const hasGraph = existsSync(GRAPH_PATH);
  const hasCodexHooks = existsSync(CODEX_HOOKS_PATH);
  const hookStatus = run('graphify', ['hook', 'status'], { quiet: true, allowFailure: true });
  const hookOutput = `${hookStatus.stdout ?? ''}${hookStatus.stderr ?? ''}`.trim() || 'sin salida';
  const updateStatus = hasGraph
    ? run('graphify', ['check-update', '.'], { quiet: true, allowFailure: true })
    : null;
  const updateOutput = updateStatus
    ? `${updateStatus.stdout ?? ''}${updateStatus.stderr ?? ''}`.trim() || 'sin cambios pendientes'
    : 'no hay grafo inicial todavia';

  printChecklistLine('CLI', true, 'graphify disponible');
  printChecklistLine('AGENTS.md', hasAgentsSection, hasAgentsSection ? 'seccion graphify presente' : 'falta la seccion graphify');
  printChecklistLine('.agents/rules', hasRule, hasRule ? 'regla de antigravity presente' : 'falta la regla graphify');
  printChecklistLine('.agents/workflows', hasWorkflow, hasWorkflow ? 'workflow de antigravity presente' : 'falta el workflow graphify');
  printChecklistLine('graphify-out/graph.json', hasGraph, hasGraph ? 'grafo local disponible' : 'falta grafo local; usar `npm run graphify:rebuild`');
  printChecklistLine('.codex/hooks.json', hasCodexHooks, hasCodexHooks ? 'hook local de Codex presente' : 'falta hook local; usar `npm run graphify:setup`');
  printChecklistLine('git hooks', hookStatus.status === 0 && !/not installed/i.test(hookOutput), hookOutput);
  printChecklistLine('staleness', hasGraph, updateOutput);
}

function updateGraph({ rebuild = false } = {}) {
  ensureGraphifyCli();
  ensureCodexHooksFile();

  if (rebuild || !existsSync(GRAPH_PATH)) {
    console.log('[graphify] Lanzando rebuild completo...');
    run('graphify', ['extract', '.']);
    return;
  }

  console.log('[graphify] Lanzando update incremental...');
  run('graphify', ['update', '.']);
}

function setup() {
  ensureGraphifyCli();
  ensureCodexHooksFile();
  ensureGitHooksInstalled();

  if (existsSync(GRAPH_PATH)) {
    const updateStatus = run('graphify', ['check-update', '.'], { quiet: true, allowFailure: true });
    const output = `${updateStatus.stdout ?? ''}${updateStatus.stderr ?? ''}`.trim();

    if (output) {
      console.log(output);
    } else {
      console.log('[graphify] El grafo local ya existe y no reporta actualizacion pendiente.');
    }
  } else {
    console.log('[graphify] No existe graphify-out/graph.json todavia.');
    console.log('[graphify] Usa `npm run graphify:rebuild` para generar el grafo inicial cuando haga falta.');
  }
}

const command = process.argv[2] ?? 'doctor';

switch (command) {
  case 'setup':
    setup();
    break;
  case 'doctor':
    doctor();
    break;
  case 'update':
    updateGraph();
    break;
  case 'rebuild':
    updateGraph({ rebuild: true });
    break;
  default:
    console.error(`[graphify] Comando no soportado: ${command}`);
    console.error('[graphify] Usa uno de: setup, doctor, update, rebuild');
    process.exit(1);
}
