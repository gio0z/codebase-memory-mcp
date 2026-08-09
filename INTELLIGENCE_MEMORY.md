# intelligence-memory integration

This fork stays intentionally close to `DeusData/codebase-memory-mcp`.

The native C engine remains the authoritative code-graph implementation. The fork adds a thin OMP provider adapter so `gio0z/intelligence-memory` can use that graph as the `structural.code` specialist without importing or duplicating the engine.

## Why the repository keeps the upstream name

Keeping `codebase-memory-mcp` makes the upstream relationship obvious and keeps future upstream syncing/cherry-picking straightforward.

The federation identity is separate from the repository name:

```text
repository       gio0z/codebase-memory-mcp
provider id      codebase-memory
domain           structural.code
authority        authoritative-current-code (85)
```

## Architecture

```text
OMP
 │
 ├─ intelligence-memory
 │    └─ workspace-intelligence:v1 event protocol
 │
 └─ codebase-memory workspace provider
      │
      └─ codebase-memory-mcp cli --raw <tool> <json>
           │
           └─ native persistent code graph
```

The OMP provider does not maintain a second graph database. Every request delegates back to the existing native CLI/MCP implementation.

## Capabilities advertised to intelligence-memory

```text
structural.code.status
structural.code.search
structural.code.references
structural.code.impact
structural.code.architecture
```

`structural.code.impact` discovers candidate symbols with `search_graph` / `search_code`, then follows the real call graph with `trace_path` (falling back to its compatibility alias `trace_call_path`).

## Install for OMP

First make sure the native `codebase-memory-mcp` binary is installed and on `PATH`.

Install `intelligence-memory` separately from `gio0z/intelligence-memory`:

```bash
git clone https://github.com/gio0z/intelligence-memory.git
cd intelligence-memory
npm run setup:omp
```

Then, from this fork checkout:

### macOS / Linux

```bash
bash scripts/setup-intelligence-memory-omp.sh
```

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-intelligence-memory-omp.ps1
```

The installer respects `PI_CODING_AGENT_DIR`. Otherwise it uses the detected OMP agent directory and copies the provider to its `extensions` folder.

Restart OMP after installing.

## Verify

Make sure the current repository has been indexed by codebase-memory. For example:

```bash
codebase-memory-mcp cli index_repository '{"repo_path":"/absolute/path/to/project"}'
```

Then in OMP:

```text
/intel doctor
```

Expected full-stack shape when database-memory and Mem0 are also present:

```text
Workspace Intelligence Doctor
─────────────────────────────────
● database-memory          healthy
● codebase-memory          healthy
● mem0                     healthy

● structural.database      database-memory
● structural.code          codebase-memory
● episodic                 mem0

Overall: HEALTHY
Federation: FULL
```

Try a cross-layer query:

```text
/intel impact users.id
```

The intended flow is:

```text
database-memory impact
        ↓
affected DB entities
        ↓
codebase-memory search_graph/search_code
        ↓
trace_path callers + callees
        ↓
Mem0 relevant history
        ↓
intelligence-memory synthesis
```

## Upstream sync policy

Keep native engine changes separate from intelligence integration changes whenever possible.

Recommended remotes:

```bash
git remote -v
# origin    https://github.com/gio0z/codebase-memory-mcp.git
# upstream  https://github.com/DeusData/codebase-memory-mcp.git
```

Then periodically:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

The integration is intentionally isolated under `omp/`, this document, and dedicated contract tests/workflows to minimize merge conflicts with upstream.
