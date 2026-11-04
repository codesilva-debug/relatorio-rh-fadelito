'use strict';

const { buildReportData } = require('./report-data');

const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbztqiMq9lsjbc1Xj68GRQSEnI1TNOLB-ZPhq9gJhAa7ZaD81K6Cpony1zLZy-ftIg3qCw/exec';
const CACHE_MS = 5 * 60 * 1000;

let lastGood = null;
let lastFetchAt = 0;
let pending = null;

async function download() {
  const url = process.env.REPORT_SHEETS_API_URL || DEFAULT_URL;
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 25000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error('Google Apps Script respondeu HTTP ' + response.status + '.');
    const payload = await response.json();
    if (!payload || payload.status !== 'success' || !Array.isArray(payload.vagas)) {
      throw new Error('Resposta da planilha incompleta ou em formato inesperado.');
    }
    const dataset = buildReportData(payload);
    if (!dataset.rows.length) throw new Error('A origem não retornou registros válidos.');
    return dataset;
  } finally {
    clearTimeout(timeout);
  }
}

async function getDataset(force) {
  if (!force && lastGood && Date.now() - lastFetchAt < CACHE_MS) {
    return { dataset: lastGood, stale: false, cached: true };
  }
  if (pending) return pending;

  pending = (async function () {
    try {
      const dataset = await download();
      lastGood = dataset;
      lastFetchAt = Date.now();
      return { dataset: dataset, stale: false, cached: false };
    } catch (error) {
      if (lastGood) {
        return {
          dataset: lastGood,
          stale: true,
          cached: true,
          warning: 'A fonte não respondeu. Exibindo a última leitura válida; os dados podem estar desatualizados.'
        };
      }
      throw error;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

module.exports = { getDataset, CACHE_MS };
