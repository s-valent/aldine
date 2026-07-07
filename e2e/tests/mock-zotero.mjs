/** Mock Zotero Web API for e2e tests. Accepts key "test-key-123". */
import http from 'node:http';

const KEY = 'test-key-123';
const USER = 777;

const BIB = `@article{turing1950,
  author = {Turing, Alan M.},
  title = {Computing Machinery and Intelligence},
  journaltitle = {Mind},
  year = {1950},
}

@book{shannon1948,
  author = {Shannon, Claude E.},
  title = {A Mathematical Theory of Communication},
  year = {1948},
}
`;

const server = http.createServer((req, res) => {
  const auth = req.headers['zotero-api-key'];
  const url = new URL(req.url, 'http://x');
  const send = (code, body, headers = {}) => {
    const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(code, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers });
    res.end(buf);
  };

  if (auth !== KEY) return send(403, { error: 'bad key' });

  if (url.pathname === '/keys/current') {
    return send(200, { userID: USER, username: 'testuser', access: { user: { library: true } } });
  }
  if (url.pathname === `/users/${USER}/groups`) {
    return send(200, [{ id: 4242, data: { name: 'Space Lab' } }]);
  }
  if (url.pathname.endsWith('/collections')) {
    return send(200, [
      { key: 'COLL1', data: { name: 'GSaaS Research', parentCollection: false } },
    ]);
  }
  if (url.pathname.includes('/items/top')) {
    if (req.headers['if-modified-since-version'] && Number(req.headers['if-modified-since-version']) >= 42) {
      res.writeHead(304); return res.end();
    }
    if (url.searchParams.get('format') === 'biblatex') {
      return send(200, BIB, { 'Last-Modified-Version': '42', 'Total-Results': '2' });
    }
    return send(200, { items: [] }, { 'Last-Modified-Version': '42', 'Total-Results': '0' });
  }
  send(404, { error: 'not found' });
});

server.listen(4919, () => console.log('[mock-zotero] on :4919'));
