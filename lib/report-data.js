'use strict';

const { classifyUnit, normalizeKey } = require('./units');

const ATYPICAL_OLD_DAYS = 730;

function parseDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) return null;

  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+.*)?$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (match[3].length === 2) year += 2000;
    if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.toISOString().slice(0, 10);
  }

  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function parseNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeStatus(value) {
  return normalizeKey(value);
}

function classifyStatus(value) {
  const status = normalizeStatus(value);
  if (status === 'aprovado' || status === 'aprovada') return 'approved';
  if (status === 'cancelada' || status === 'cancelado') return 'cancelled';
  if (status === 'triagem' || status === 'briefing' || status === 'vivencia') return 'in-progress';
  if (!status) return 'missing';
  return 'other';
}

function getColumnIndex(header, aliases, required) {
  const normalized = header.map(function (cell) { return normalizeKey(cell); });
  const found = [];
  for (let i = 0; i < normalized.length; i += 1) {
    if (aliases.indexOf(normalized[i]) >= 0) found.push(i);
  }
  if (found.length > 1) throw new Error('Cabeçalho ambíguo: ' + aliases[0]);
  if (required && found.length !== 1) throw new Error('Coluna obrigatória ausente: ' + aliases[0]);
  return found.length ? found[0] : -1;
}

const COLUMN_ALIASES = {
  timestamp: ['carimbo de data hora', 'carimbo', 'timestamp', 'data hora', 'ty'],
  role: ['funcao cargo', 'funcao', 'cargo'],
  openingDate: ['data de abertura', 'abertura'],
  unit: ['unidade solicitante', 'unidade'],
  shift: ['horario da vaga', 'horario'],
  month: ['mes'],
  status: ['status', 'situacao'],
  closingDate: ['fechamento', 'data de fechamento'],
  days: ['dias', 'tempo de fechamento'],
  vacancyType: ['status da vaga', 'tipo de vaga', 'tipo da vaga'],
  vivencias: ['total vivencias', 'vivencias', 'total de vivencias']
};

function buildColumns(header, rowsSample) {
  const columns = {};
  const requiredKeys = ['role', 'openingDate', 'unit', 'shift', 'status', 'closingDate', 'days', 'vacancyType', 'vivencias'];
  Object.keys(COLUMN_ALIASES).forEach(function (key) {
    const required = requiredKeys.indexOf(key) >= 0;
    columns[key] = getColumnIndex(header, COLUMN_ALIASES[key], required);
  });
  if (columns.timestamp < 0) {
    const usedIndices = Object.values(columns);
    if (usedIndices.indexOf(0) < 0 && Array.isArray(rowsSample) && rowsSample.some(function (r) { return Array.isArray(r) && parseDate(r[0]); })) {
      columns.timestamp = 0;
    }
  }
  return columns;
}

function cell(row, index) {
  return index < 0 ? '' : row[index];
}

function buildReportData(payload) {
  if (!payload || !Array.isArray(payload.vagas) || !Array.isArray(payload.vagas[0])) {
    throw new Error('A origem não retornou a tabela de vagas esperada.');
  }

  const header = payload.vagas[0];
  const columns = buildColumns(header, payload.vagas.slice(1, 15));
  const rows = [];
  // Datas de referência para sinalizar (sem corrigir) datas atípicas: no futuro ou com mais de 2 anos.
  const referenceDate = parseDate(payload.timestamp) || new Date().toISOString().slice(0, 10);
  const referenceTime = Date.parse(referenceDate + 'T00:00:00Z');
  const oldLimit = new Date(referenceTime - ATYPICAL_OLD_DAYS * 86400000).toISOString().slice(0, 10);
  const futureLimit = new Date(referenceTime + 86400000).toISOString().slice(0, 10);
  let atypicalDates = 0;
  let invalidOpeningDates = 0;
  let monthMismatches = 0;
  let missingStatuses = 0;
  let missingDaysOnApproved = 0;
  let dateFallbacks = 0;
  const otherStatuses = {};

  for (let i = 1; i < payload.vagas.length; i += 1) {
    const source = payload.vagas[i];
    if (!Array.isArray(source)) continue;

    const role = String(cell(source, columns.role) || '').trim();
    const rawUnit = String(cell(source, columns.unit) || '').trim();
    const statusValue = String(cell(source, columns.status) || '').trim();
    const openingRaw = cell(source, columns.openingDate);
    const timestampRaw = cell(source, columns.timestamp);
    const closingRaw = cell(source, columns.closingDate);
    const shift = String(cell(source, columns.shift) || '').trim();
    const monthCell = String(cell(source, columns.month) || '').trim();
    const days = parseNumber(cell(source, columns.days));
    const totalVivencias = parseNumber(cell(source, columns.vivencias));

    if (!role && !rawUnit && !statusValue && !openingRaw && !timestampRaw) continue;

    const unit = classifyUnit(rawUnit);
    const openingDate = parseDate(openingRaw);
    const timestampDate = parseDate(timestampRaw);
    const closingDate = parseDate(closingRaw);
    const periodDate = openingDate || timestampDate;
    const dateSource = openingDate ? 'abertura' : (timestampDate ? 'carimbo' : 'ausente');
    if (openingRaw && !openingDate) invalidOpeningDates += 1;
    if (!openingDate && timestampDate) dateFallbacks += 1;
    if (!statusValue) missingStatuses += 1;

    const monthNumber = Number(monthCell);
    if (openingDate && Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
      const actualMonth = Number(openingDate.slice(5, 7));
      if (actualMonth !== monthNumber) monthMismatches += 1;
    }

    const statusCategory = classifyStatus(statusValue);
    if (statusCategory === 'other') otherStatuses[statusValue] = (otherStatuses[statusValue] || 0) + 1;
    if (statusCategory === 'approved' && days == null) missingDaysOnApproved += 1;

    let dateWarning = null;
    if (periodDate && periodDate < oldLimit) dateWarning = 'old';
    else if (periodDate && periodDate > futureLimit) dateWarning = 'future';
    if (dateWarning) atypicalDates += 1;

    rows.push({
      id: 'R' + (i + 1),
      sourceRow: i + 1,
      role: role || 'Função não informada',
      unit: unit.name,
      rawUnit: unit.raw,
      unitGroup: unit.group,
      unitMapped: unit.mapped,
      shift: shift || 'Não informado',
      status: statusValue || 'Não informado',
      statusCategory: statusCategory,
      openingDate: openingDate,
      closingDate: closingDate,
      periodDate: periodDate,
      dateSource: dateSource,
      dateWarning: dateWarning,
      monthCell: monthCell,
      days: days,
      vacancyType: String(cell(source, columns.vacancyType) || '').trim() || 'Não informado',
      totalVivencias: totalVivencias
    });
  }

  const unitCounts = {};
  const unitGroups = {};
  rows.forEach(function (row) {
    unitCounts[row.unit] = (unitCounts[row.unit] || 0) + 1;
    unitGroups[row.unitGroup] = (unitGroups[row.unitGroup] || 0) + 1;
  });

  const unmappedUnits = Object.keys(unitCounts).filter(function (name) {
    const row = rows.find(function (item) { return item.unit === name; });
    return row && row.unitGroup !== 'official';
  }).map(function (name) {
    return { name: name, count: unitCounts[name], group: rows.find(function (item) { return item.unit === name; }).unitGroup };
  }).sort(function (a, b) { return b.count - a.count; });

  const sumUnitCounts = Object.values(unitCounts).reduce(function (sum, count) { return sum + count; }, 0);
  if (sumUnitCounts !== rows.length) throw new Error('Falha de reconciliação: total por unidade diferente do total de registros.');

  return {
    rows: rows,
    meta: {
      sheetName: payload.sheetVagasNome || 'Planilha de vagas',
      sourceTimestamp: payload.timestamp || null,
      fetchedAt: new Date().toISOString(),
      sourceRows: payload.totalLinhasVagas || payload.vagas.length,
      sourceColumns: payload.totalColunasDetectadas || header.length,
      totalRecords: rows.length,
      unitCounts: unitCounts,
      unitGroups: unitGroups,
      unmappedUnits: unmappedUnits,
      mappedOfficial: unitGroups.official || 0,
      outsideMap: unitGroups['outside-map'] || 0,
      nonUnit: unitGroups['non-unit'] || 0,
      missingUnit: unitGroups.missing || 0,
      reviewUnits: unitGroups.review || 0,
      unitReconciliation: sumUnitCounts,
      issues: {
        invalidOpeningDates: invalidOpeningDates,
        dateFallbacks: dateFallbacks,
        monthMismatches: monthMismatches,
        missingStatuses: missingStatuses,
        missingDaysOnApproved: missingDaysOnApproved,
        atypicalDates: atypicalDates,
        otherStatuses: otherStatuses
      }
    }
  };
}

module.exports = { parseDate, parseNumber, classifyStatus, buildReportData };
