'use strict';

const auth = require('../lib/auth');
const { sendJson } = require('../lib/http');

module.exports = function session(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método não permitido.' });
  return sendJson(res, 200, { authenticated: auth.verifySession(req) });
};
