const PROTOCOL_VERSION = 1;
const EVENT_PREFIX = 'workspace-intelligence:v1';
const EVENTS = Object.freeze({
  discover: `${EVENT_PREFIX}:providers:discover`,
  announce: `${EVENT_PREFIX}:providers:announce`,
  request: `${EVENT_PREFIX}:rpc:request`,
  replyPrefix: `${EVENT_PREFIX}:rpc:reply:`,
});

const CAPS = Object.freeze({
  status: 'structural.code.status',
  search: 'structural.code.search',
  references: 'structural.code.references',
  impact: 'structural.code.impact',
  architecture: 'structural.code.architecture',
});

const AUTHORITY = 85;
const safeOff = (value) => typeof value === 'function' ? value : () => {};
const unique = (values) => [...new Set(values.filter(Boolean))];

function parseJson(text, fallback = null) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch {}
  const first = raw.indexOf('{');
  const firstArray = raw.indexOf('[');
  const start = [first, firstArray].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  if (start == null) return fallback;
  try { return JSON.parse(raw.slice(start)); } catch { return fallback; }
}

function rows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['results', 'matches', 'nodes', 'items', 'data']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function symbolName(row) {
  return row?.qualified_name || row?.qualifiedName || row?.function_name || row?.functionName || row?.symbol || row?.name || null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entityTerms(entity) {
  const value = String(entity || '').trim();
  if (!value) return [];
  const parts = value.split('.').filter(Boolean);
  const table = parts[0] || value;
  const column = parts.at(-1) || value;
  const singular = table.endsWith('s') && table.length > 3 ? table.slice(0, -1) : table;
  return unique([value, table, singular, column, value.replace(/\./g, '_')]);
}

function projectName(item) {
  return item?.name || item?.project || item?.project_name || item?.projectName || null;
}

function projectPath(item) {
  return item?.repo_path || item?.repoPath || item?.path || item?.root || item?.sourcePath || item?.source_path || null;
}

function normalizeClaims(claims, source = 'codebase-memory') {
  return (Array.isArray(claims) ? claims : []).map((claim) => ({
    ...claim,
    temporal: claim.temporal || 'current',
    authority: claim.authority ?? AUTHORITY,
    source: claim.source || source,
    domain: claim.domain || 'structural.code',
  }));
}

function claim(target, entity, symbol, evidence, predicate = 'code-impact') {
  return {
    subject: String(target || entity || symbol),
    predicate,
    object: { entity, symbol },
    temporal: 'current',
    authority: AUTHORITY,
    source: 'codebase-memory',
    domain: 'structural.code',
    evidence,
  };
}

export default function codebaseMemoryWorkspaceProvider(pi) {
  if (!pi?.events?.on || !pi?.events?.emit) return;
  if (typeof pi.exec !== 'function') return;

  let activeCwd = process.cwd();
  let cachedProject = null;

  async function cli(tool, args = {}) {
    const result = await pi.exec(
      'codebase-memory-mcp',
      ['cli', '--raw', tool, JSON.stringify(args)],
      { cwd: activeCwd },
    );
    if (result?.killed) throw new Error(`codebase-memory ${tool} was cancelled.`);
    if (Number(result?.code ?? 0) !== 0) {
      throw new Error(String(result?.stderr || result?.stdout || `codebase-memory ${tool} failed.`).trim());
    }
    const parsed = parseJson(result?.stdout, null);
    if (parsed == null) throw new Error(`codebase-memory ${tool} returned non-JSON output.`);
    return parsed;
  }

  async function resolveProject() {
    if (cachedProject) return cachedProject;
    const data = await cli('list_projects', {});
    const projects = Array.isArray(data) ? data : data?.projects || data?.results || data?.data || [];
    const root = activeCwd.replace(/[\\/]+$/, '');
    const rootName = root.split(/[\\/]/).filter(Boolean).at(-1) || root;
    const byPath = projects.find((item) => {
      const candidate = projectPath(item);
      if (!candidate) return false;
      const normalized = String(candidate).replace(/[\\/]+$/, '');
      return normalized === root || root.startsWith(`${normalized}/`) || root.startsWith(`${normalized}\\`);
    });
    if (byPath) return (cachedProject = projectName(byPath) || rootName);
    const byName = projects.find((item) => projectName(item) === rootName);
    if (byName) return (cachedProject = projectName(byName));
    if (projects.length === 1) return (cachedProject = projectName(projects[0]) || rootName);
    return (cachedProject = rootName);
  }

  async function searchGraph(project, query, limit = 12) {
    return await cli('search_graph', {
      project,
      name_pattern: query ? `.*${escapeRegex(query)}.*` : '.*',
      limit: Number(limit || 12),
    });
  }

  async function searchCode(project, query, limit = 12) {
    return await cli('search_code', {
      project,
      query: String(query || ''),
      limit: Number(limit || 12),
    });
  }

  async function references(input = {}) {
    const project = await resolveProject();
    const target = String(input.target || input.entity || input.query || '');
    const entities = unique([target, ...(input.entities || [])]).slice(0, Number(input.limit || 8));
    const references = [];
    const candidates = [];

    for (const entity of entities) {
      for (const term of entityTerms(entity)) {
        const graph = await searchGraph(project, term, 8).catch(() => null);
        if (graph) {
          references.push({ entity, term, mode: 'graph', result: graph });
          for (const row of rows(graph)) {
            const symbol = symbolName(row);
            if (symbol) candidates.push({ entity, symbol, row });
          }
        }
        const text = await searchCode(project, term, 8).catch(() => null);
        if (text) {
          references.push({ entity, term, mode: 'text', result: text });
          for (const row of rows(text)) {
            const symbol = symbolName(row);
            if (symbol) candidates.push({ entity, symbol, row });
          }
        }
        if (references.length >= Number(input.limit || 8) * 3) break;
      }
    }

    const seen = new Set();
    const deduped = candidates.filter((candidate) => {
      if (!candidate.symbol || seen.has(candidate.symbol)) return false;
      seen.add(candidate.symbol);
      return true;
    }).slice(0, Number(input.limit || 8));

    return {
      project,
      target,
      entities,
      references,
      candidates: deduped,
      claims: deduped.map((item) => claim(target, item.entity, item.symbol, item.row, 'code-reference')),
    };
  }

  const handlers = {
    [CAPS.status]: async () => {
      const projects = await cli('list_projects', {});
      const project = await resolveProject();
      return {
        healthy: true,
        project,
        projects,
        engine: 'codebase-memory-mcp',
        transport: 'cli',
        capabilities: Object.values(CAPS),
        claims: [],
      };
    },

    [CAPS.search]: async (input = {}) => {
      const project = await resolveProject();
      const query = String(input.query || '');
      const graph = await searchGraph(project, query, input.limit || 12).catch(() => null);
      if (graph) return { project, query, mode: 'graph', result: graph, claims: [] };
      const text = await searchCode(project, query, input.limit || 12);
      return { project, query, mode: 'text', result: text, claims: [] };
    },

    [CAPS.references]: references,

    [CAPS.impact]: async (input = {}) => {
      const base = await references(input);
      const traces = [];
      const traceErrors = [];
      for (const candidate of base.candidates || []) {
        try {
          let trace;
          try {
            trace = await cli('trace_path', {
              project: base.project,
              function_name: candidate.symbol,
              direction: 'both',
              max_depth: Math.max(1, Math.min(Number(input.maxDepth || input.max_depth || 4), 5)),
            });
          } catch {
            trace = await cli('trace_call_path', {
              project: base.project,
              function_name: candidate.symbol,
              direction: 'both',
              max_depth: Math.max(1, Math.min(Number(input.maxDepth || input.max_depth || 4), 5)),
            });
          }
          traces.push({ ...candidate, trace });
        } catch (error) {
          traceErrors.push({ symbol: candidate.symbol, message: String(error?.message || error) });
        }
      }
      return {
        ...base,
        traces,
        traceErrors,
        mode: traces.length ? 'graph-trace' : 'reference-fallback',
        claims: traces.length
          ? traces.map((item) => claim(base.target, item.entity, item.symbol, item.trace, 'code-impact'))
          : normalizeClaims(base.claims),
      };
    },

    [CAPS.architecture]: async () => {
      const project = await resolveProject();
      const architecture = await cli('get_architecture', { project });
      return { project, architecture, claims: [] };
    },
  };

  const descriptor = {
    protocolVersion: PROTOCOL_VERSION,
    id: 'codebase-memory',
    label: 'Codebase Memory',
    version: 'fork-intelligence-v1',
    priority: AUTHORITY,
    capabilities: Object.values(CAPS),
    domains: ['structural.code'],
    authority: 'authoritative-current-code',
    metadata: {
      store: 'independent',
      transport: 'pi.events+cli',
      engine: 'codebase-memory-mcp',
      fork: 'gio0z/codebase-memory-mcp',
    },
  };

  const announce = () => pi.events.emit(EVENTS.announce, { descriptor, timestamp: Date.now() });
  const offDiscover = safeOff(pi.events.on(EVENTS.discover, announce));
  const offRequest = safeOff(pi.events.on(EVENTS.request, async (request = {}) => {
    if (!request.requestId) return;
    if (request.providerId && request.providerId !== descriptor.id) return;
    const handler = handlers[request.capability];
    if (!handler) return;
    const replyEvent = `${EVENTS.replyPrefix}${request.requestId}`;
    try {
      const data = await handler(request.input || {}, request.context || {});
      pi.events.emit(replyEvent, {
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        provider: descriptor,
        capability: request.capability,
        success: true,
        data,
        timestamp: Date.now(),
      });
    } catch (error) {
      pi.events.emit(replyEvent, {
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        provider: descriptor,
        capability: request.capability,
        success: false,
        error: { code: 'PROVIDER_ERROR', message: String(error?.message || error) },
        timestamp: Date.now(),
      });
    }
  }));

  pi.on('session_start', async (_event, ctx) => {
    activeCwd = ctx?.cwd || process.cwd();
    cachedProject = null;
    announce();
  });
  pi.on('session_switch', async (_event, ctx) => {
    activeCwd = ctx?.cwd || activeCwd;
    cachedProject = null;
    announce();
  });
  pi.on('session_shutdown', async () => {
    offDiscover();
    offRequest();
  });

  announce();
}
