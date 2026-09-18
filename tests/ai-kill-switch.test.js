/**
 * The AI kill switch (`AI_ENABLED=false`) reaches every AI entry (B337).
 *
 * One rule for the whole surface: with `enableAi` off — the kill switch, demo
 * mode or sandbox — an AI entry is not mounted. HTTP answers 404 before the
 * handler runs (so before any SSE header and before any vendor call), the way
 * `/api/ai/*` always did through its mount gate in `server/routes/api/index.js`;
 * MCP leaves the tool out of `tools/list` and answers `tools/call` as an
 * unknown tool. The public v1 side is pinned in
 * `tests/public-api-v1-translate.test.js`, the weekly digest in
 * `tests/digest-generation.test.js`.
 *
 * The HTTP half is declared, not re-checked per handler: a route carries
 * `ai: true` in its table and `dispatchRoutes` answers for it. So this file
 * pins both the mechanism and the declarations — every presentation route that
 * spends tokens, including `/analyze`, whose missing check was the finding.
 *
 * House shape: the exported route module is called with a req/res double. No
 * database is installed — the gate answers before any storage call, and a
 * handler that ran anyway would fail on the missing database rather than pass.
 *
 * Run with: node --test tests/ai-kill-switch.test.js
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = ['deckyard', 'test', 'killswitch']
  .join('-')
  .padEnd(40, '0');
delete process.env.AI_ENABLED;
delete process.env.DISABLE_AI;
delete process.env.DEMO_MODE;
delete process.env.SANDBOX_MODE;

const { dispatchRoutes } = await import('../server/utils/router.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handleImageLibrary } =
  await import('../server/routes/api/image-library.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

afterEach(() => {
  delete process.env.AI_ENABLED;
});

/** A response double capturing what the http helpers write. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
      this.headersSent = true;
      return this;
    },
    write() {
      return true;
    },
    end(payload) {
      try {
        this.body = payload ? JSON.parse(payload) : null;
      } catch {
        this.body = payload;
      }
      return this;
    },
  };
}

/** A request context carrying just what the routers read. */
function ctx(method, pathname) {
  const req = { method, headers: {}, on() {}, once() {} };
  return {
    req,
    res: makeRes(),
    url: new URL(`http://localhost${pathname}`),
    authedUser: { id: 'u-1', email: 'owner@example.com', role: 'admin' },
    storageScope: null,
    repoRoot: process.cwd(),
  };
}

describe('dispatchRoutes — the `ai` declaration', () => {
  const routes = (seen) => [
    {
      pattern: /^\/api\/x\/([^/]+)\/think$/,
      handler: (_c, id) => {
        seen.push(id);
        return true;
      },
      ai: true,
    },
  ];

  it('runs the handler while AI is on', () => {
    const seen = [];
    const c = ctx('POST', '/api/x/7/think');
    assert.equal(dispatchRoutes(routes(seen), c), true);
    assert.deepEqual(seen, ['7']);
  });

  it('answers 404 without running the handler while AI is off', () => {
    process.env.AI_ENABLED = 'false';
    const seen = [];
    const c = ctx('POST', '/api/x/7/think');
    dispatchRoutes(routes(seen), c);
    assert.equal(c.res.statusCode, 404);
    assert.equal(c.res.body.error, 'not_found');
    assert.deepEqual(seen, [], 'handler must not run');
  });

  it('leaves an unmarked route alone while AI is off', () => {
    process.env.AI_ENABLED = 'false';
    const c = ctx('GET', '/api/plain');
    const plain = [{ pattern: '/api/plain', handler: () => 'hit' }];
    assert.equal(dispatchRoutes(plain, c), 'hit');
  });
});

describe('presentation AI routes are not mounted with AI_ENABLED=false', () => {
  const AI_PATHS = [
    '/api/presentations/p-1/analyze',
    '/api/presentations/p-1/translate',
    '/api/presentations/p-1/translate/fields',
    '/api/presentations/p-1/translate/missing',
    '/api/presentations/p-1/description/generate',
    '/api/presentations/p-1/versions/v-1/compare-ai',
  ];

  for (const path of AI_PATHS) {
    it(`POST ${path} → 404, before the handler`, async () => {
      process.env.AI_ENABLED = 'false';
      const c = ctx('POST', path);
      await handlePresentations(c);
      assert.equal(c.res.statusCode, 404);
      assert.equal(c.res.body?.error, 'not_found');
    });
  }

  it('analyze answers JSON, not an event stream — the check sits before the SSE headers', async () => {
    process.env.AI_ENABLED = 'false';
    const c = ctx('POST', '/api/presentations/p-1/analyze');
    await handlePresentations(c);
    assert.equal(c.res.statusCode, 404);
    assert.match(c.res.headers['Content-Type'], /^application\/json/);
  });

  it('a wrong method is still 404, not 405: the route does not exist here', async () => {
    process.env.AI_ENABLED = 'false';
    const c = ctx('GET', '/api/presentations/p-1/analyze');
    await handlePresentations(c);
    assert.equal(c.res.statusCode, 404);
  });

  it('with AI on, analyze reaches its handler (405 on a GET is the handler speaking)', async () => {
    const c = ctx('GET', '/api/presentations/p-1/analyze');
    await handlePresentations(c);
    assert.equal(c.res.statusCode, 405);
  });
});

describe('alt-text generation follows the same switch', () => {
  for (const path of [
    '/api/image-library/generate-alts',
    '/api/image-library/img-1/generate-alts',
  ]) {
    it(`POST ${path} → 404 with AI_ENABLED=false`, async () => {
      process.env.AI_ENABLED = 'false';
      const c = ctx('POST', path);
      await handleImageLibrary(c);
      assert.equal(c.res.statusCode, 404);
    });
  }
});

describe('MCP — an `ai` tool does not exist with AI_ENABLED=false', () => {
  function server() {
    const s = new McpServer();
    registerTools(s, { defaultOwnerEmail: 'owner@example.com' });
    return s;
  }
  const aiTools = (s) =>
    [...s.tools.values()]
      .filter((tool) => tool.permission === 'ai')
      .map((tool) => tool.name);

  async function listed(s, context) {
    const raw = await s.handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      context,
    );
    return JSON.parse(raw).result.tools.map((tool) => tool.name);
  }

  it('analyze_presentation is one of the ai tools', () => {
    assert.ok(aiTools(server()).includes('analyze_presentation'));
  });

  it('tools/list leaves every ai tool out, with or without a key', async () => {
    process.env.AI_ENABLED = 'false';
    const s = server();
    const keyed = {
      ownerEmail: 'owner@example.com',
      apiKey: { id: 'k-1', tier: 'free', permissions: ['read', 'ai'] },
      transport: 'sse',
    };
    for (const context of [undefined, keyed]) {
      const names = await listed(s, context);
      for (const name of aiTools(s)) {
        assert.ok(!names.includes(name), `${name} must not be listed`);
      }
      assert.ok(names.includes('get_presentation'), 'non-AI tools stay');
    }
  });

  it('tools/list keeps the ai tools while AI is on', async () => {
    const s = server();
    const names = await listed(s);
    for (const name of aiTools(s)) assert.ok(names.includes(name), name);
  });

  it('tools/call analyze_presentation answers as an unknown tool', async () => {
    process.env.AI_ENABLED = 'false';
    const raw = await server().handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'analyze_presentation',
        arguments: { presentationId: 'p-1' },
      },
    });
    const msg = JSON.parse(raw);
    assert.equal(msg.error?.code, -32601);
    assert.match(msg.error.message, /Unknown tool: analyze_presentation/);
  });
});
