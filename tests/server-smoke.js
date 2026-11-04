'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const cwd = __dirname + '/..';
const port = '3471';
const child = spawn(process.execPath, ['server.js'], {
  cwd: cwd,
  env: Object.assign({}, process.env, { PORT: port }),
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', function (chunk) { output += chunk.toString(); });
child.stderr.on('data', function (chunk) { output += chunk.toString(); });

function pause(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function requestReady() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/api/session');
      if (response.ok) return;
    } catch (error) {
      await pause(250);
    }
  }
  throw new Error('Servidor local não iniciou. ' + output);
}

(async function () {
  try {
    await requestReady();
    const wrongLogin = await fetch('http://127.0.0.1:' + port + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Master', password: 'errada' })
    });
    assert.equal(wrongLogin.status, 401);

    const login = await fetch('http://127.0.0.1:' + port + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Master', password: '123' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const dataResponse = await fetch('http://127.0.0.1:' + port + '/api/data?refresh=1', {
      headers: { Cookie: cookie }
    });
    assert.equal(dataResponse.status, 200);
    const data = await dataResponse.json();
    assert.ok(data.meta.totalRecords >= 741, 'Total de registros deve refletir a planilha atual (>= 741)');
    assert.ok(data.meta.mappedOfficial >= 733, 'Unidades oficiais mapeadas (>= 733)');
    assert.equal(
      data.meta.mappedOfficial + data.meta.outsideMap + data.meta.reviewUnits + data.meta.nonUnit + data.meta.missingUnit,
      data.meta.totalRecords
    );
    assert.equal(data.rows.length, data.meta.totalRecords);
    assert.equal(data.meta.unitReconciliation, data.meta.totalRecords);
    assert.equal(data.rows.some(function (row) { return Object.prototype.hasOwnProperty.call(row, 'name'); }), false);
    assert.equal(data.rows.some(function (row) { return Object.prototype.hasOwnProperty.call(row, 'employeeName'); }), false);
    console.log(
      'SMOKE OK: login Master/123, sessão, leitura real, ' +
      data.meta.totalRecords + ' registros (' + data.meta.mappedOfficial + ' unidades oficiais), reconciliação 100% e sem campos de nomes.'
    );
  } catch (error) {
    console.error('SMOKE FALHOU:', error.message);
    console.error(output);
    process.exitCode = 1;
  } finally {
    child.kill();
  }
})();
