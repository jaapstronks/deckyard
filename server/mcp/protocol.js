/**
 * MCP Protocol — Lightweight JSON-RPC 2.0 implementation
 *
 * Implements the Model Context Protocol without external dependencies.
 * Supports stdio transport (primary) and SSE transport (future).
 */

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
   */
  tool(name, description, inputSchema, handler) {
    this.tools.set(name, { name, description, inputSchema, handler });
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
        return this._handleToolsList(id);

      case 'tools/call':
        return this._handleToolsCall(id, params, context);

      case 'prompts/list':
        return this._handlePromptsList(id);

      case 'prompts/get':
        return this._handlePromptsGet(id, params);

      case 'ping':
        return jsonRpcResponse(id, {});

      default:
        return jsonRpcError(id, ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${method}`);
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

  _handleToolsList(id) {
    const tools = [];
    for (const tool of this.tools.values()) {
      tools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
    return jsonRpcResponse(id, { tools });
  }

  async _handleToolsCall(id, params, context) {
    const { name, arguments: args } = params || {};

    if (!name || !this.tools.has(name)) {
      return jsonRpcError(id, ErrorCodes.METHOD_NOT_FOUND, `Unknown tool: ${name}`);
    }

    const tool = this.tools.get(name);

    try {
      const result = await tool.handler(args || {}, context);
      return jsonRpcResponse(id, {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        }],
      });
    } catch (err) {
      return jsonRpcResponse(id, {
        content: [{
          type: 'text',
          text: `Error: ${err.message}`,
        }],
        isError: true,
      });
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
      return jsonRpcError(id, ErrorCodes.METHOD_NOT_FOUND, `Unknown prompt: ${name}`);
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
        const errResp = jsonRpcError(null, ErrorCodes.PARSE_ERROR, 'Parse error');
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
