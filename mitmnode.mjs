#!/usr/bin/env node
// mitmnode.mjs — proxy reverso com observabilidade de streaming (SSE), zero dependências.
//
// Uso:
//   UPSTREAM=https://gemma4-gateway.jhonata-matias.workers.dev PORT=8888 node mitmnode.mjs
//
// Depois aponte o BYOK do VS Code para: "url": "http://localhost:8888/v1"

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { URL } from 'node:url';

const UPSTREAM = process.env.UPSTREAM ?? 'https://gemma4-gateway.jhonata-matias.workers.dev';
const PORT = Number(process.env.PORT ?? 8888);
const LOG_FILE = process.env.LOG_FILE ?? './flows.jsonl';
const MAX_PREVIEW = Number(process.env.MAX_PREVIEW ?? 400);

const up = new URL(UPSTREAM);
const client = up.protocol === 'https:' ? https : http;
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

let counter = 0;

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

function record(event) {
  logStream.write(JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
}

function preview(buf) {
  const s = buf.toString('utf8');
  return s.length > MAX_PREVIEW ? s.slice(0, MAX_PREVIEW) + '…' : s;
}

const server = http.createServer((req, res) => {
  const id = ++counter;
  const reqChunks = [];

  req.on('data', (c) => reqChunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(reqChunks);

    // ---- REQUEST ----
    console.log(`\n${C.cyan(`[#${id}] → ${req.method} ${req.url}`)}`);
    console.log(C.dim(preview(body)));
    record({ id, dir: 'request', method: req.method, url: req.url, headers: req.headers, body: body.toString('utf8') });

    const headers = { ...req.headers };
    headers.host = up.host;
    headers['accept-encoding'] = 'identity'; // SSE legível, sem gzip
    delete headers.connection;
    delete headers['content-length'];
    if (body.length) headers['content-length'] = String(body.length);

    const basePath = up.pathname === '/' ? '' : up.pathname.replace(/\/$/, '');

    const proxyReq = client.request(
      {
        protocol: up.protocol,
        hostname: up.hostname,
        port: up.port || (up.protocol === 'https:' ? 443 : 80),
        path: basePath + req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const t0 = Date.now();
        let last = t0;
        let n = 0;
        let total = 0;

        const outHeaders = { ...proxyRes.headers };
        delete outHeaders['content-encoding'];
        delete outHeaders['transfer-encoding'];
        delete outHeaders['content-length'];

        console.log(C.green(`[#${id}] ← ${proxyRes.statusCode} ${proxyRes.headers['content-type'] ?? ''}`));
        record({ id, dir: 'response.head', status: proxyRes.statusCode, headers: proxyRes.headers });

        res.writeHead(proxyRes.statusCode, outHeaders);
        res.flushHeaders(); // crítico: não segurar os headers do SSE

        proxyRes.on('data', (chunk) => {
          const now = Date.now();
          n++;
          total += chunk.length;
          const dt = now - last;
          last = now;
          console.log(C.dim(`[#${id}]   chunk ${n} +${dt}ms (${chunk.length}b) `) + preview(chunk).replace(/\n/g, '⏎'));
          record({ id, dir: 'response.chunk', n, since_start_ms: now - t0, delta_ms: dt, bytes: chunk.length, data: chunk.toString('utf8') });
          res.write(chunk);
          res.flush?.(); // no-op em http puro, útil se houver compressão
        });

        proxyRes.on('end', () => {
          const total_ms = Date.now() - t0;
          console.log(C.yellow(`[#${id}] ✓ fim — ${n} chunks, ${total}b, ${total_ms}ms`));
          record({ id, dir: 'response.end', chunks: n, bytes: total, total_ms });
          res.end();
        });
      }
    );

    proxyReq.on('error', (err) => {
      console.error(C.red(`[#${id}] ✗ erro upstream: ${err.message}`));
      record({ id, dir: 'error', message: err.message });
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `proxy error: ${err.message}` } }));
    });

    proxyReq.setNoDelay(true);
    proxyReq.end(body);
  });
});

server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`mitmnode → ${UPSTREAM}`);
  console.log(`escutando em http://localhost:${PORT}`);
  console.log(`log: ${LOG_FILE}\n`);
});
