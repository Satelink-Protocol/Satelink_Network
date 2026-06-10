#!/bin/sh
echo "Starting Paperclip on Railway..."

# Proxy: 0.0.0.0:3100 (Railway LB) → 127.0.0.1:3101 (paperclipai internal)
node -e "
const net = require('net');
const proxy = net.createServer(src => {
  const dst = net.createConnection(3101, '127.0.0.1');
  src.pipe(dst); dst.pipe(src);
  src.on('error', () => dst.destroy());
  dst.on('error', () => src.destroy());
});
proxy.listen(3100, '0.0.0.0', () => console.log('[proxy] 0.0.0.0:3100 ready'));
" &

sleep 3

# Run paperclipai on internal port 3101
PORT=3101 exec paperclipai onboard --yes --bind lan --run
