'use strict';

const OFFICIAL_UNITS = [
  'Granja Viana', 'Osasco', 'Prodesp', 'Portal do Morumbi', 'Panamby',
  'Alto da Boa Vista', 'Marajoara', 'Brooklin', 'Real Parque', 'Campo Belo',
  'Moema', 'Indianópolis', 'Saúde', 'Vila Gumercindo', 'Ipiranga', 'Klabin',
  'Vila Mariana', 'Paraíso', 'Aclimação', 'Jardins', 'Pinheiros',
  'Vila Madalena', 'Vila Leopoldina', 'Lapa', 'Perdizes', 'Higienópolis',
  'Santo André', 'São Caetano', 'Mooca', 'Analia Franco', 'Tatuapé',
  'Vila Sônia', 'Bonfiglioli', 'Sírio'
];

function normalizeKey(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^fadelito\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const officialByKey = new Map(OFFICIAL_UNITS.map(function (name) {
  return [normalizeKey(name), name];
}));

const ALIASES = new Map([
  ['chacara klabin', 'Klabin'],
  ['paraiso', 'Paraíso'],
  ['santo andre', 'Santo André'],
  ['sao caetano', 'São Caetano'],
  ['vila sonia', 'Vila Sônia'],
  ['prodesp taboao', 'Prodesp'],
  ['prodesp taboao da serra', 'Prodesp']
].map(function (entry) {
  return [normalizeKey(entry[0]), entry[1]];
}));

function classifyUnit(rawValue) {
  const raw = String(rawValue == null ? '' : rawValue).trim();
  const key = normalizeKey(raw);

  if (!key) {
    return { name: 'Sem unidade', raw: '', group: 'missing', mapped: false };
  }
  if (key === 'global') {
    return { name: 'Global', raw: raw, group: 'non-unit', mapped: false };
  }
  if (key === 'campinas' || key === 'piracicaba') {
    const name = key === 'campinas' ? 'Campinas' : 'Piracicaba';
    return { name: name, raw: raw, group: 'outside-map', mapped: false };
  }
  if (key === 'nao informada' || key === 'nao informado') {
    return { name: 'Não informada', raw: raw, group: 'missing', mapped: false };
  }

  const canonical = ALIASES.get(key) || officialByKey.get(key);
  if (canonical) {
    return { name: canonical, raw: raw, group: 'official', mapped: true };
  }

  return { name: raw, raw: raw, group: 'review', mapped: false };
}

module.exports = { OFFICIAL_UNITS, normalizeKey, classifyUnit };
