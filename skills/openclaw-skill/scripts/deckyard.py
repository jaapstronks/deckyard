#!/usr/bin/env python3
"""
Deckyard MCP CLI — wraps the Deckyard SSE transport for OpenClaw agents.

Usage:
  python3 deckyard.py create --content "..." [--title "..."] [--theme default] [--lang en-GB]
  python3 deckyard.py list
  python3 deckyard.py get --id PRESENTATION_ID
  python3 deckyard.py iterate --id PRESENTATION_ID --command "Make it punchier"
  python3 deckyard.py url --id PRESENTATION_ID
  python3 deckyard.py list-themes
  python3 deckyard.py validate --id PRESENTATION_ID
  python3 deckyard.py append --id PRESENTATION_ID --content "Additional content"

Environment:
  DECKYARD_URL      Base URL of your Deckyard instance (e.g. https://deckyard.example.com)
  DECKYARD_API_KEY  API key (dk_live_...)

Reads .env from the skill directory if present.
"""

import json
import os
import sys
import urllib.request
import urllib.error

# ─── Config ───────────────────────────────────────────────────────────────

def load_env():
    """Load .env file from skill directory."""
    skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_file = os.path.join(skill_dir, '.env')
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and value:
                        os.environ.setdefault(key, value)

load_env()

DECKYARD_URL = os.environ.get('DECKYARD_URL', '').rstrip('/')
DECKYARD_API_KEY = os.environ.get('DECKYARD_API_KEY', '')

if not DECKYARD_URL:
    print("ERROR: DECKYARD_URL not set. Configure in .env or environment.", file=sys.stderr)
    sys.exit(1)
if not DECKYARD_API_KEY:
    print("ERROR: DECKYARD_API_KEY not set. Configure in .env or environment.", file=sys.stderr)
    sys.exit(1)

MCP_ENDPOINT = f"{DECKYARD_URL}/mcp"

# ─── MCP client ───────────────────────────────────────────────────────────

_request_id = 0

def mcp_call(method, params=None):
    """Send a JSON-RPC request to the Deckyard MCP endpoint."""
    global _request_id
    _request_id += 1

    payload = {
        "jsonrpc": "2.0",
        "id": _request_id,
        "method": method,
    }
    if params:
        payload["params"] = params

    data = json.dumps(payload).encode('utf-8')

    # Unset proxy env vars (sandbox proxies can block direct connections)
    env_backup = {}
    for key in ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']:
        if key in os.environ:
            env_backup[key] = os.environ.pop(key)

    try:
        req = urllib.request.Request(
            MCP_ENDPOINT,
            data=data,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {DECKYARD_API_KEY}',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode('utf-8')
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8') if e.fp else ''
        print(f"HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}", file=sys.stderr)
        sys.exit(1)
    finally:
        # Restore proxy env vars
        for key, value in env_backup.items():
            os.environ[key] = value


def tool_call(tool_name, arguments=None):
    """Call an MCP tool and return the result text."""
    result = mcp_call("tools/call", {
        "name": tool_name,
        "arguments": arguments or {},
    })

    if "error" in result:
        print(f"Error: {result['error'].get('message', 'Unknown error')}", file=sys.stderr)
        sys.exit(1)

    content = result.get("result", {}).get("content", [])
    if not content:
        return "{}"

    text = content[0].get("text", "")

    # Try to parse as JSON for pretty output
    try:
        parsed = json.loads(text)
        return json.dumps(parsed, indent=2, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return text


# ─── Commands ─────────────────────────────────────────────────────────────

def cmd_create(args):
    """Create a presentation from content."""
    content = get_arg(args, '--content', required=True)
    title = get_arg(args, '--title')
    theme = get_arg(args, '--theme', default='default')
    lang = get_arg(args, '--lang')

    arguments = {'content': content, 'theme': theme}
    if title:
        arguments['title'] = title
    if lang:
        arguments['lang'] = lang

    print("Generating presentation... (this may take 10-30 seconds)")
    result = tool_call('create_presentation', arguments)
    print(result)


def cmd_list(args):
    """List presentations."""
    limit = int(get_arg(args, '--limit', default='20'))
    result = tool_call('list_presentations', {'limit': limit})
    print(result)


def cmd_get(args):
    """Get a presentation's full data."""
    pres_id = get_arg(args, '--id', required=True)
    result = tool_call('get_presentation', {'id': pres_id})
    print(result)


def cmd_iterate(args):
    """Modify a presentation with natural language."""
    pres_id = get_arg(args, '--id', required=True)
    command = get_arg(args, '--command', required=True)
    result = tool_call('iterate_presentation', {
        'presentationId': pres_id,
        'command': command,
    })
    print(result)


def cmd_url(args):
    """Get presentation URLs."""
    pres_id = get_arg(args, '--id', required=True)
    result = tool_call('get_presentation_url', {'presentationId': pres_id})
    print(result)


def cmd_list_themes(args):
    """List available themes."""
    result = tool_call('list_themes')
    print(result)


def cmd_validate(args):
    """Validate a presentation."""
    pres_id = get_arg(args, '--id', required=True)
    result = tool_call('validate_presentation', {'presentationId': pres_id})
    print(result)


def cmd_append(args):
    """Add slides from new content."""
    pres_id = get_arg(args, '--id', required=True)
    content = get_arg(args, '--content', required=True)
    result = tool_call('append_slides', {
        'presentationId': pres_id,
        'content': content,
    })
    print(result)


# ─── Arg parsing ──────────────────────────────────────────────────────────

def get_arg(args, name, required=False, default=None):
    """Get a named argument from the args list."""
    try:
        idx = args.index(name)
        if idx + 1 < len(args):
            return args[idx + 1]
    except ValueError:
        pass

    if required:
        print(f"Missing required argument: {name}", file=sys.stderr)
        sys.exit(1)

    return default


COMMANDS = {
    'create': cmd_create,
    'list': cmd_list,
    'get': cmd_get,
    'iterate': cmd_iterate,
    'url': cmd_url,
    'list-themes': cmd_list_themes,
    'validate': cmd_validate,
    'append': cmd_append,
}


def main():
    args = sys.argv[1:]

    if not args or args[0] in ('-h', '--help', 'help'):
        print(__doc__)
        print("Commands:", ', '.join(COMMANDS.keys()))
        sys.exit(0)

    command = args[0]
    if command not in COMMANDS:
        print(f"Unknown command: {command}", file=sys.stderr)
        print(f"Available: {', '.join(COMMANDS.keys())}", file=sys.stderr)
        sys.exit(1)

    # Initialize MCP session (stateless — no session management needed)
    COMMANDS[command](args[1:])


if __name__ == '__main__':
    main()
