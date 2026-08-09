import test from 'node:test';
import assert from 'node:assert/strict';
import providerExtension from '../omp/extension/workspace-provider.js';

class Bus {
  constructor() { this.handlers = new Map(); }
  on(name, fn) {
    const list = this.handlers.get(name) || [];
    list.push(fn);
    this.handlers.set(name, list);
    return () => this.handlers.set(name, (this.handlers.get(name) || []).filter((item) => item !== fn));
  }
  emit(name, payload) {
    for (const fn of [...(this.handlers.get(name) || [])]) fn(payload);
  }
}

function fakePi() {
  const events = new Bus();
  const lifecycle = new Map();
  const calls = [];
  return {
    api: {
      events,
      on(name, fn) {
        const list = lifecycle.get(name) || [];
        list.push(fn);
        lifecycle.set(name, list);
      },
      async exec(_command, args) {
        const tool = args[2];
        const input = JSON.parse(args[3] || '{}');
        calls.push({ tool, input });
        let data;
        if (tool === 'list_projects') data = [{ name: 'demo', repoPath: '/workspace/demo' }];
        else if (tool === 'search_graph') data = { results: [{ qualified_name: 'demo.src.user.updateUser', name: 'updateUser' }] };
        else if (tool === 'search_code') data = { results: [{ qualified_name: 'demo.src.user.updateUser', text: 'users.id' }] };
        else if (tool === 'trace_path') data = { root: input.function_name, callers: ['demo.src.api.patchUser'], callees: ['demo.src.repo.saveUser'] };
        else if (tool === 'get_architecture') data = { packages: ['api', 'repo'] };
        else throw new Error(`unexpected tool ${tool}`);
        return { code: 0, stdout: JSON.stringify(data), stderr: '', killed: false };
      },
    },
    events,
    lifecycle,
    calls,
  };
}

function rpc(events, capability, input = {}) {
  const requestId = `req-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const off = events.on(`workspace-intelligence:v1:rpc:reply:${requestId}`, (reply) => {
      off();
      resolve(reply);
    });
    events.emit('workspace-intelligence:v1:rpc:request', {
      requestId,
      providerId: 'codebase-memory',
      capability,
      input,
    });
    setTimeout(() => {
      off();
      reject(new Error('RPC timeout'));
    }, 500);
  });
}

test('OMP provider advertises structural.code and returns graph impact', async () => {
  const { api, events, lifecycle, calls } = fakePi();
  let announced;
  events.on('workspace-intelligence:v1:providers:announce', (payload) => {
    announced = payload.descriptor;
  });

  providerExtension(api);
  assert.equal(announced.id, 'codebase-memory');
  assert.equal(announced.authority, 'authoritative-current-code');
  assert.ok(announced.capabilities.includes('structural.code.impact'));

  const start = lifecycle.get('session_start')[0];
  await start({}, { cwd: '/workspace/demo' });

  const reply = await rpc(events, 'structural.code.impact', {
    target: 'users.id',
    entities: ['users', 'orders.user_id'],
    limit: 2,
  });

  assert.equal(reply.success, true);
  assert.equal(reply.data.mode, 'graph-trace');
  assert.equal(reply.data.traces[0].trace.root, 'demo.src.user.updateUser');
  assert.equal(reply.data.claims[0].authority, 85);
  assert.equal(reply.data.claims[0].domain, 'structural.code');
  assert.ok(calls.some((call) => call.tool === 'trace_path'));
});
