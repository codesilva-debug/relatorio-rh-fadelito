'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyUnit } = require('../lib/units');
const { parseDate, classifyStatus, buildReportData } = require('../lib/report-data');

const HEADER = [
  'Carimbo de data/hora', 'Função  / Cargo:', 'Data de abertura:',
  'Unidade solicitante:', 'Horário da vaga:', 'A sala possui:',
  'Responsável solicitante:', 'Mês:', 'Status', 'nome', 'Fechamento:',
  'Dias', 'Status da vaga:', 'Nome completo do colaborador ', 'Total Vivências'
];

test('padroniza variações conhecidas de unidade', function () {
  assert.equal(classifyUnit('Chacara Klabin').name, 'Klabin');
  assert.equal(classifyUnit('Paraiso').name, 'Paraíso');
  assert.equal(classifyUnit('Santo Andre').name, 'Santo André');
  assert.equal(classifyUnit('Sao Caetano').name, 'São Caetano');
  assert.equal(classifyUnit('Vila Sonia').name, 'Vila Sônia');
  assert.equal(classifyUnit('  Fadelito Moema  ').name, 'Moema');
});

test('não associa unidade fora do cadastro a uma escola', function () {
  assert.equal(classifyUnit('Campinas').group, 'outside-map');
  assert.equal(classifyUnit('Global').group, 'non-unit');
  assert.equal(classifyUnit('Guarulhos').group, 'review');
  assert.equal(classifyUnit('').group, 'missing');
});

test('valida datas sem transformar ano digitado incorretamente', function () {
  assert.equal(parseDate('06/01/0026'), null);
  assert.equal(parseDate('03/11/26'), '2026-11-03');
  assert.equal(parseDate('03/11/2026 09:30:00'), '2026-11-03');
});

test('separa aprovadas, canceladas e etapas em andamento', function () {
  assert.equal(classifyStatus('Aprovado'), 'approved');
  assert.equal(classifyStatus('Cancelada'), 'cancelled');
  assert.equal(classifyStatus('Vivência'), 'in-progress');
  assert.equal(classifyStatus(''), 'missing');
});

test('reconcilia registros úteis, descarta linha vazia e não inclui nomes', function () {
  const payload = {
    status: 'success',
    timestamp: '2026-11-04T13:00:00.000Z',
    sheetVagasNome: 'VALIDAÇÃO VAGAS JUL/DEZ',
    totalLinhasVagas: 5,
    totalColunasDetectadas: 68,
    vagas: [
      HEADER,
      ['03/11/2026 09:00:00', 'AUX LIMPEZA', '03/11/2026', 'Chacara Klabin', '8:00 às 18:00', '', '', '11', 'Aprovado', 'Nome privado', '04/11/2026', '1', 'Nova', 'Outro nome', 2],
      ['03/11/2026 10:00:00', 'PORTEIRO', '03/11/2026', 'Campinas', '9:00 às 19:00', '', '', '11', 'Cancelada', '', '', '', 'Substituição', '', 0],
      ['03/11/2026 11:00:00', 'EDUCADORA', '03/11/2026', 'Guarulhos', '8:00 às 18:00', '', '', '11', 'Triagem', '', '', '', 'Nova', '', 1],
      ['', '   ', '', '', '', '', '', '', '', '', '', '', '', '', 0]
    ]
  };
  const result = buildReportData(payload);
  assert.equal(result.rows.length, 3);
  assert.equal(result.meta.totalRecords, 3);
  assert.equal(result.meta.mappedOfficial, 1);
  assert.equal(result.meta.outsideMap, 1);
  assert.equal(result.meta.reviewUnits, 1);
  assert.equal(result.meta.nonUnit, 0);
  assert.equal(result.meta.missingUnit, 0);
  assert.equal(result.meta.unitReconciliation, 3);
  assert.equal(result.rows[0].unit, 'Klabin');
  assert.equal(result.rows[1].unitGroup, 'outside-map');
  assert.equal(result.rows[2].unitGroup, 'review');
  assert.equal(Object.prototype.hasOwnProperty.call(result.rows[0], 'name'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.rows[0], 'employeeName'), false);
});

test('registra status novos na auditoria sem classificá-los como aprovados', function () {
  const payload = {
    status: 'success',
    vagas: [
      HEADER,
      ['03/11/2026 12:00:00', 'AUX LIMPEZA', '03/11/2026', 'Moema', '8:00 às 18:00', '', '', '11', 'Aguardando retorno', '', '', '', 'Nova', '', 0]
    ]
  };
  const result = buildReportData(payload);
  assert.equal(result.rows[0].statusCategory, 'other');
  assert.equal(result.meta.issues.otherStatuses['Aguardando retorno'], 1);
});

test('sinaliza datas atípicas (muito antigas ou futuras) sem alterá-las', function () {
  const payload = {
    status: 'success',
    timestamp: '2026-11-04T13:00:00.000Z',
    vagas: [
      HEADER,
      ['03/11/2026 12:00:00', 'AUX LIMPEZA', '15/08/2016', 'Moema', '8:00 às 18:00', '', '', '8', 'Aprovado', '', '20/08/2016', '5', 'Nova', '', 1]
    ]
  };
  const result = buildReportData(payload);
  assert.equal(result.rows[0].periodDate, '2016-08-15');
  assert.equal(result.rows[0].dateWarning, 'old');
  assert.equal(result.meta.issues.atypicalDates, 1);
});

test('tolera edição acidental do cabeçalho da coluna A (carimbo de data/hora)', function () {
  const editedHeader = HEADER.slice();
  editedHeader[0] = 'ty';
  const payload = {
    status: 'success',
    vagas: [
      editedHeader,
      ['05/01/2026', 'ESTAGIÁRIA MINI', '', 'Higienópolis', '7:00 ÀS 13:00', '', '', '1', 'Aprovado', '', '09/01/2026', '4', 'Nova', '', 1]
    ]
  };
  const result = buildReportData(payload);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].periodDate, '2026-01-05');
  assert.equal(result.rows[0].dateSource, 'carimbo');
});
