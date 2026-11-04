'use strict';

const auth = require('../lib/auth');
const source = require('../lib/source');
const { sendJson } = require('../lib/http');

module.exports = async function data(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método não permitido.' });
  if (!auth.verifySession(req)) return sendJson(res, 401, { error: 'Sessão expirada.' });

  try {
    const result = await source.getDataset(req.query && req.query.refresh === '1');
    return sendJson(res, 200, {
      rows: result.dataset.rows,
      meta: result.dataset.meta,
      stale: result.stale,
      cached: result.cached,
      warning: result.warning || null
    });
  } catch (error) {
    console.error('Falha ao carregar relatório:', error.message);
    return sendJson(res, 503, { error: 'Não foi possível atualizar a planilha. Tente novamente mais tarde.' });
  }
};
