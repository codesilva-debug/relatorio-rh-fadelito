'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('configura Vercel e package.json com JSON válido', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(pkg.engines.node);
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(vercel.functions['api/data.js'].maxDuration, 30);
  assert.equal(fs.existsSync(path.join(root, 'api', 'data.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'index.html')), true);
});

test('todos os elementos referenciados em app.js existem em index.html', function () {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), function (m) { return m[1]; }));
  const referencedIds = Array.from(js.matchAll(/byId\('([^']+)'\)/g), function (m) { return m[1]; });
  assert.ok(referencedIds.length > 20);
  referencedIds.forEach(function (id) {
    assert.equal(htmlIds.has(id), true, 'Elemento #' + id + ' ausente em index.html');
  });
});
