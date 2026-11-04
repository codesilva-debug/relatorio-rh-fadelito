'use strict';

const auth = require('../lib/auth');
const { sendJson } = require('../lib/http');

module.exports = function logout(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método não permitido.' });
  auth.clearSession(res);
  return sendJson(res, 200, { ok: true });
};
