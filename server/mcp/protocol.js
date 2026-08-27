/**
 * MCP Protocol — Lightweight JSON-RPC 2.0 implementation
 *
 * Implements the Model Context Protocol without external dependencies.
 * Supports stdio transport (primary) and SSE transport (future).
 */

import {
  MaintenanceWriteError,
  assertWritable,
} from '../config/maintenance.js';
import { enforceToolPolicy, isToolVisible } from './authorization.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'deckyard';
const SERVER_VERSION = '1.0.0';

/**
 * Create a JSON-RPC 2.0 response
 */
export function jsonRpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

/**
 * Create a JSON-RPC 2.0 error response
 */
export function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return JSON.stringify({ jsonrpc: '2.0', id, error });
}

/**
 * Create a failed tool result.
 *
 * A tool that refuses (policy) or throws (execution) answers protocol-cleanly:
 * a successful JSON-RPC response carrying `isError`, not a JSON-RPC error and
 * not an HTTP status — see `docs/reference/api-error-format.md` § 401 versus 403.
 *
 * @param {string|number} id - JSON-RPC request id
 * @param {string} message - Human-readable reason, shown to the calling agent
 * @returns {string} JSON-RPC response string
 */
function toolError(id, message) {
  return jsonRpcResponse(id, {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  });
}

/**
 * Standard JSON-RPC error codes
 */
export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/**
 * Make every deck-scoped tool accept `id` as an alias for `presentationId`.
 *
 * Historically some tools took `id`, others `presentationId`, so agents guessed
 * wrong — and the shared "A presentation id is required (pass `id` or
 * `presentationId`)" error then lied for the tools that only read
 * `presentationId`. This normalises the seam in one place: any tool whose schema
 * has a `presentationId` property (and no distinct `id` property of its own)
 * gains a documented `id` alias, and its handler receives `presentationId`
 * filled in from `id` when only `id` was passed. Tools that already declare
 * their own `id` (get_presentation, validate_presentation, get_presentation_url)
 * are left untouched — they coalesce the two names themselves.
 *
 * @param {Object} inputSchema - JSON Schema for the tool's parameters
 * @param {Function} handler - async (params, context) => result
 * @returns {{inputSchema: Object, handler: Function}}
 */
function withPresentationIdAlias(inputSchema, handler) {
  const props = inputSchema && inputSchema.properties;
  if (!props || !props.presentationId || props.id) {
    return { inputSchema, handler };
  }

  const aliasedSchema = {
    ...inputSchema,
    properties: {
      ...props,
      id: {
        type: 'string',
        description: 'Presentation ID (alias for presentationId)',
      },
    },
  };

  const aliasedHandler = (params, context) => {
    if (params && params.presentationId == null && params.id != null) {
      return handler({ ...params, presentationId: params.id }, context);
    }
    return handler(params, context);
  };

  return { inputSchema: aliasedSchema, handler: aliasedHandler };
}

/**
 * MCP Server class
 * Handles tool registration, message parsing, and routing.
 */
export class McpServer {
  constructor({ name = SERVER_NAME, version = SERVER_VERSION } = {}) {
    this.name = name;
    this.version = version;
    this.tools = new Map();
    this.prompts = new Map();
    this.initialized = false;
  }

  /**
   * Register a tool
   * @param {string} name - Tool name
   * @param {string} description - Human-readable description
   * @param {Object} inputSchema - JSON Schema for parameters
   * @param {Function} handler - async (params) => result
   * @param {Object} [options]
   * @param {boolean} [options.readOnly] - Declare the tool read-only so it
   *   stays available during maintenance mode. Tools that do not declare it
   *   are treated as writes and refused while maintenance is active — fail
   *   closed, so a new (or fork-registered custom) tool that forgets the flag
   *   is blocked rather than slipping past the write-gate.
   * @param {string} [options.permission] - The API-key permission this tool
   *   needs, from `AVAILABLE_PERMISSIONS` (`server/storage/api-keys.js`) — the
   *   same one its `/api/v1` counterpart requires, so a key means the same
   *   thing on both transports. Fail closed as well: a keyed caller cannot
   *   reach a tool that declares no permission (see ./authorization.js).
   */
  tool(
    name,
    description,
    inputSchema,
    handler,
    { readOnly = false, permission = null } = {},
  ) {
    const { inputSchema: schema, handler: wrapped } = withPresentationIdAlias(
      inputSchema,
      handler,
    );
    this.tools.set(name, {
      name,
      description,
      inputSchema: schema,
      handler: wrapped,
      readOnly,
      permission,
    });
  }

  /**
   * Register a prompt template
   * @param {string} name - Prompt name (appears in / menu)
   * @param {string} description - Human-readable description
   * @param {Array} args - [{name, description, required}]
   * @param {Function} handler - async (argValues) => {messages: [{role, content}]}
   */
  prompt(name, description, args, handler) {
    this.prompts.set(name, { name, description, arguments: args, handler });
  }

  /**
   * Handle a parsed JSON-RPC message
   * @param {Object} msg - Parsed JSON-RPC message
   * @param {Object} [context] - Optional per-request context (e.g. ownerEmail from SSE session)
   * @returns {Promise<string|null>} JSON response string, or null for notifications
   */
  async handleMessage(msg, context) {
    if (!msg || typeof msg !== 'object') {
      return jsonRpcError(null, ErrorCodes.PARSE_ERROR, 'Parse error');
    }

    const { method, params, id } = msg;

    // Notifications (no id) — don't send response
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') {
        this.initialized = true;
      }
      return null;
    }

    switch (method) {
      case 'initialize':
        return this._handleInitialize(id, params);

      case 'tools/list':
        return this._handleToolsList(id, context);

      case 'tools/call':
        return this._handleToolsCall(id, params, context);

      case 'prompts/list':
        return this._handlePromptsList(id);

      case 'prompts/get':
        return this._handlePromptsGet(id, params);

      case 'ping':
        return jsonRpcResponse(id, {});

      default:
        return jsonRpcError(
          id,
          ErrorCodes.METHOD_NOT_FOUND,
          `Unknown method: ${method}`,
        );
    }
  }

  _handleInitialize(id, params) {
    const capabilities = { tools: {} };
    if (this.prompts.size > 0) {
      capabilities.prompts = {};
    }
    return jsonRpcResponse(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities,
      serverInfo: {
        name: this.name,
        version: this.version,
      },
    });
  }

  _handleToolsList(id, context) {
    const tools = [];
    for (const tool of this.tools.values()) {
      // Don't advertise what this key may not call — the enforcing gate is
      // _handleToolsCall; this only keeps the menu honest.
      if (!isToolVisible(tool, context)) continue;
      const entry = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
      if (tool.readOnly) entry.annotations = { readOnlyHint: true };
      tools.push(entry);
    }
    return jsonRpcResponse(id, { tools });
  }

  async _handleToolsCall(id, params, context) {
    const { name, arguments: args } = params || {};

    if (!name || !this.tools.has(name)) {
      return jsonRpcError(
        id,
        ErrorCodes.METHOD_NOT_FOUND,
        `Unknown tool: ${name}`,
      );
    }

    const tool = this.tools.get(name);

    // Permission + quota gate — the MCP spelling of v1's requirePermission and
    // its rate limiters, so one API key may do the same things on both
    // transports and spends one set of counters doing them (./authorization.js).
    const policy = await enforceToolPolicy(tool, context);
    if (!policy.ok) {
      return toolError(id, policy.message);
    }

    // Maintenance write-gate — the same choke-point the HTTP API dispatcher
    // goes through (server/routes/api/index.js). A mutating tool call is a
    // write; refuse it protocol-cleanly (a tool error result, not a raw 503)
    // while reads keep working.
    if (!tool.readOnly) {
      try {
        assertWritable();
      } catch (err) {
        if (!(err instanceof MaintenanceWriteError)) throw err;
        return toolError(
          id,
          `${err.message} Writes are refused until maintenance ends; retry in ${err.retryAfter} seconds. Read tools keep working.`,
        );
      }
    }

    try {
      const result = await tool.handler(args || {}, context);
      return jsonRpcResponse(id, {
        content: [
          {
            type: 'text',
            text:
              typeof result === 'string'
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      });
    } catch (err) {
      return toolError(id, err.message);
    }
  }

  _handlePromptsList(id) {
    const prompts = [];
    for (const prompt of this.prompts.values()) {
      prompts.push({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments,
      });
    }
    return jsonRpcResponse(id, { prompts });
  }

  async _handlePromptsGet(id, params) {
    const { name, arguments: args } = params || {};

    if (!name || !this.prompts.has(name)) {
      return jsonRpcError(
        id,
        ErrorCodes.METHOD_NOT_FOUND,
        `Unknown prompt: ${name}`,
      );
    }

    const prompt = this.prompts.get(name);

    try {
      const result = await prompt.handler(args || {});
      return jsonRpcResponse(id, {
        description: prompt.description,
        messages: result.messages,
      });
    } catch (err) {
      return jsonRpcError(id, ErrorCodes.INTERNAL_ERROR, err.message);
    }
  }
}

/**
 * Run the MCP server over stdio
 * Reads JSON-RPC messages from stdin, writes responses to stdout.
 * Messages are queued and processed sequentially to preserve ordering.
 */
export function runStdio(server) {
  let buffer = '';
  const messageQueue = [];
  let processing = false;

  async function processQueue() {
    if (processing) return;
    processing = true;

    while (messageQueue.length > 0) {
      const line = messageQueue.shift();
      try {
        const msg = JSON.parse(line);
        const response = await server.handleMessage(msg);
        if (response) {
          process.stdout.write(response + '\n');
        }
      } catch (err) {
        const errResp = jsonRpcError(
          null,
          ErrorCodes.PARSE_ERROR,
          'Parse error',
        );
        process.stdout.write(errResp + '\n');
      }
    }

    processing = false;
  }

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;

    // Extract complete lines (each JSON-RPC message is one line)
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line) messageQueue.push(line);
    }

    processQueue();
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  // Suppress unhandled rejection crashes
  process.on('unhandledRejection', (err) => {
    process.stderr.write(`[MCP] Unhandled rejection: ${err?.message || err}\n`);
  });
}
