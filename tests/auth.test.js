'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../lib/auth');

test('aceita somente o login temporário Master / 123', function () {
  assert.equal(auth.validateCredentials('Master', '123'), true);
  assert.equal(auth.validateCredentials('master', '123'), false);
  assert.equal(auth.validateCredentials('Master', '1234'), false);
  assert.equal(auth.validateCredentials('Outro', '123'), false);
});

test('senha e usuário são verificados sem depender de .env', function () {
  delete process.env.REPORT_PASSWORD;
  delete process.env.REPORT_SESSION_SECRET;
  assert.equal(auth.validateCredentials('Master', '123'), true);
});
