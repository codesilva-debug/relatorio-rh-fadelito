'use strict';

const auth = require('../lib/auth');
const { sendJson, readJson } = require('../lib/http');

module.exports = async function login(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método não permitido.' });
  try {
    const body = await readJson(req);
    if (!auth.validateCredentials(body.username, body.password)) {
      return sendJson(res, 401, { error: 'Usuário ou senha incorretos.' });
    }
    auth.createSession(res);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 400, { error: 'Não foi possível validar o acesso.' });
  }
};
