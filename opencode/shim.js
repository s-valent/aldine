// OpenAI-compatible /chat/completions -> opencode serve translation shim.
// Aldine's AI error-fix speaks the OpenAI chat-completions format; `opencode
// serve` speaks its own session API. This bridge maps one to the other.
//
//   POST /chat/completions
//   { model, max_tokens, messages: [{role, content}] }
//   -> opencode: POST /session, POST /session/:id/message
//   <- { choices: [{ message: { role, content } }] }

const OPENCODE = process.env.OPENCODE_SERVER_URL || 'http://opencode:4096';
const PORT = Number(process.env.PORT || 3000);

// Deny every known tool so the model answers directly instead of trying to
// run bash/read/edit inside a container that has no access to the project.
const STATIC_DENIED_TOOLS = [
  'bash', 'read', 'edit', 'write', 'patch', 'glob', 'grep', 'ls',
  'webfetch', 'fetch', 'task', 'mcp', 'shell', 'fsys',
];

async function toolIds() {
  try {
    const res = await fetch(`${OPENCODE}/experimental/tool/ids`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const ids = await res.json();
    return Array.isArray(ids) ? ids : null;
  } catch {
    return null;
  }
}

async function json(url, opts) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts?.headers || {}) },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`opencode ${url} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : null;
}

function modelRef(requested) {
  if (!requested) return undefined;
  const [providerID, modelID, ...rest] = requested.split('/');
  if (providerID && modelID && rest.length === 0) return { providerID, modelID };
  return undefined; // not provider/model format -> let opencode use its default
}

async function chatCompletions(req) {
  const { model, messages = [] } = req;
  const system = messages.find((m) => m.role === 'system')?.content || undefined;
  const userText = messages
    .filter((m) => m.role !== 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n\n');

  const session = await json(`${OPENCODE}/session`, {
    method: 'POST',
    body: JSON.stringify({ title: 'aldine-ai-fix' }),
  });

  try {
    // Deny every tool (the prompt endpoint maps each tool -> deny permission).
    const denied = Object.fromEntries(((await toolIds()) || STATIC_DENIED_TOOLS).map((id) => [id, false]));
    const payload = {
      model: modelRef(model),
      system,
      parts: [{ type: 'text', text: userText }],
      tools: denied,
    };

    const result = await json(`${OPENCODE}/session/${session.id}/message`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (result.info?.error) {
      throw new Error(`opencode error: ${result.info.error.message || JSON.stringify(result.info.error)}`);
    }
    const content = (result.parts || [])
      .filter((p) => p.type === 'text' && !p.synthetic)
      .map((p) => p.text)
      .join('\n')
      .trim();
    if (!content) {
      throw new Error('opencode returned no text (finish=' + (result.info?.finish || '?') + ')');
    }

    return {
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    };
  } finally {
    json(`${OPENCODE}/session/${session.id}`, { method: 'DELETE' }).catch(() => {});
  }
}

import { createServer } from 'node:http';

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let reqBody;
  try {
    reqBody = JSON.parse(raw || '{}');
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid JSON' }));
    return;
  }
  try {
    const out = await chatCompletions(reqBody);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[aldine-opencode-shim] listening on http://0.0.0.0:${PORT}, opencode at ${OPENCODE}`);
});
