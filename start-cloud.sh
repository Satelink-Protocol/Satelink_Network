#!/bin/sh
echo "Starting Paperclip on Railway..."

node -e "
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/api/health' || req.url === '/') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'ok'}));
    return;
  }
  const opts = {hostname:'127.0.0.1', port:3101, path:req.url, method:req.method, headers:req.headers};
  const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', e => { res.writeHead(502); res.end(e.message); });
  req.pipe(p);
});
server.listen(3100, '0.0.0.0', () => console.log('[proxy] ready on 0.0.0.0:3100'));
" &

sleep 3
PORT=3101 exec paperclipai onboard --yes --run
