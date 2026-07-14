/**
 * "Connect via API / MCP" card for the API Keys settings tab.
 *
 * Deckyard ships a Model Context Protocol server (stdio for local tools,
 * HTTP/SSE for remote agents) but it had no in-product presence. This card
 * surfaces it right where users manage the API keys that authenticate remote
 * access, with copy-paste snippets for the common clients.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/toast.js';

/**
 * A small "Copy" button that writes `getText()` to the clipboard.
 * @param {() => string} getText
 * @returns {HTMLButtonElement}
 */
function copyButton(getText) {
  const btn = h('button', {
    class: 'btn btn-secondary is-compact',
    type: 'button',
    text: t('common.copy', 'Copy'),
  });
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      toast.success(t('common.copied', 'Copied'), { durationMs: 1200 });
    } catch {
      /* clipboard unavailable (e.g. insecure context) — ignore */
    }
  });
  return btn;
}

/**
 * A labelled, copyable code snippet block.
 * @param {Object} opts
 * @param {string} opts.label - Field label above the block
 * @param {string} opts.code - The snippet text (also the copy payload)
 * @param {string} [opts.help] - Optional one-line hint under the label
 * @returns {HTMLElement}
 */
function snippetBlock({ label, code, help }) {
  const wrap = h('div', { class: 'stack mcp-connect-block' });

  const head = h('div', {
    class: 'row spread',
    style: 'align-items: flex-start;',
  });
  head.append(
    h('div', { class: 'field-label', text: label }),
    copyButton(() => code)
  );
  wrap.append(head);

  if (help) wrap.append(h('div', { class: 'help', text: help }));

  const pre = h('pre', { class: 'mcp-connect-code' });
  pre.append(h('code', { text: code }));
  wrap.append(pre);

  return wrap;
}

/**
 * Render the "Connect via API / MCP" card.
 * @returns {HTMLElement}
 */
export function renderMcpConnectCard() {
  const origin = location.origin;
  const card = h('div', { class: 'stack editor-card mcp-connect-card' });

  card.append(
    h('div', {
      class: 'field-label',
      text: t('settings.mcp.title', 'Connect via API / MCP'),
    }),
    h('div', {
      class: 'help',
      text: t(
        'settings.mcp.description',
        'Deckyard speaks the Model Context Protocol: point Claude Desktop, Cursor, or a remote agent at this server to create and edit decks in natural language. Remote access authenticates with one of the API keys above.'
      ),
    })
  );

  // Remote agents (HTTP/SSE) — authenticates with a Deckyard API key.
  const remoteConfig = JSON.stringify(
    {
      deckyard: {
        url: `${origin}/mcp`,
        headers: { Authorization: 'Bearer dk_live_your_api_key' },
      },
    },
    null,
    2
  );

  // Local tools (stdio) — Claude Desktop / Cursor, no API key needed.
  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        deckyard: {
          command: 'node',
          args: ['server/mcp/index.js'],
          cwd: '/path/to/deckyard',
          env: { DECKYARD_MCP_OWNER_EMAIL: 'you@example.com' },
        },
      },
    },
    null,
    2
  );

  card.append(
    snippetBlock({
      label: t('settings.mcp.remote.label', 'Remote agents (HTTP + API key)'),
      help: t(
        'settings.mcp.remote.help',
        'Endpoint /mcp. Create a key above and send it as a Bearer token.'
      ),
      code: remoteConfig,
    }),
    snippetBlock({
      label: t('settings.mcp.desktop.label', 'Claude Desktop / Cursor (local)'),
      help: t(
        'settings.mcp.desktop.help',
        'Add to claude_desktop_config.json. Local stdio needs no API key; set the owner email so decks are attributed to you.'
      ),
      code: desktopConfig,
    })
  );

  // Plain REST alternative — link to the served OpenAPI spec.
  const restRow = h('div', {
    class: 'row',
    style: 'gap: var(--ps-space-3); flex-wrap: wrap;',
  });
  restRow.append(
    h('span', {
      class: 'help',
      text: t('settings.mcp.rest.label', 'Prefer plain REST?'),
    }),
    h('a', {
      class: 'btn btn-secondary is-compact',
      href: '/api/v1/openapi.yaml',
      target: '_blank',
      rel: 'noopener',
      text: t('settings.mcp.rest.link', 'View the OpenAPI spec'),
    })
  );
  card.append(restRow);

  return card;
}
