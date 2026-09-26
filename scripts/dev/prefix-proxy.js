#!/usr/bin/env node
// prefix-proxy.js [listen-port] [prefix] [target-port]
//
// A path-stripping reverse proxy, to look at effractor under a prefix the
// way it runs behind nginx or Caddy:
//   effractor --bind 127.0.0.1:8082 --public-url http://localhost:8081/effractor
//   node scripts/dev/prefix-proxy.js 8081 /effractor 8082
// then browse http://localhost:8081/effractor/. For local looks only.
const http = require('node:http');

const [listen = '8081', prefix = '/effractor', target = '8082'] = process.argv.slice(2);

http.createServer((req, res) => {
  if (req.url !== prefix && !req.url.startsWith(prefix + '/')) {
    res.writeHead(404).end('not under ' + prefix + '\n');
    return;
  }
  const headers = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress };
  const upstream = http.request({
    host: '127.0.0.1', port: target, method: req.method,
    path: req.url.slice(prefix.length) || '/', headers,
  }, (answer) => {
    res.writeHead(answer.statusCode, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', (e) => res.writeHead(502).end(e.message + '\n'));
  req.pipe(upstream);
}).listen(Number(listen), '127.0.0.1', () => {
  console.log(`http://localhost:${listen}${prefix}/ -> http://127.0.0.1:${target}/`);
});
