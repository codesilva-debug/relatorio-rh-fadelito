'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3470);

const routes = {
  '/api/login': require('./api/login'),
  '/api/session': require('./api/session'),
  '/api/logout': require('./api/logout'),
  '/api/data': require('./api/data')
};
const publicFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/Fadelito.png': ['Fadelito.png', 'image/png'],
  '/Fadelito.PNG': ['Fadelito.png', 'image/png'],
  '/fadelito.png': ['Fadelito.png', 'image/png']
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

const server = http.createServer(async function (req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  req.query = Object.fromEntries(url.searchParams.entries());

  if (routes[url.pathname]) {
    try { await routes[url.pathname](req, res); }
    catch (error) {
      console.error('Erro na rota ' + url.pathname + ':', error.message);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Erro interno do relatório.' }));
      }
    }
    return;
  }

  if (req.method !== 'GET' || !publicFiles[url.pathname]) {
    res.statusCode = 404;
    res.end('Não encontrado');
    return;
  }

  const item = publicFiles[url.pathname];
  res.statusCode = 200;
  res.setHeader('Content-Type', item[1]);
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(path.join(ROOT, item[0])).pipe(res);
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('Relatório Administrativo disponível em http://127.0.0.1:' + PORT);
  console.log('Login temporário do protótipo: Master / 123');
  console.log('Não publique este acesso temporário em ambiente externo.');
});
process.on('SIGINT', function () { server.close(function () { process.exit(0); }); });
