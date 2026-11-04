'use strict';

(function () {
  const byId = function (id) { return document.getElementById(id); };

  const REFRESH_MS = 5 * 60 * 1000;
  const PAGE_SIZE = 25;
  const BAR_LIMIT = 10;
  const DEFAULT_PRESET = 'year';
  const SELECT_FILTERS = ['unitFilter', 'roleFilter', 'statusFilter', 'shiftFilter', 'typeFilter'];
  const URL_KEYS = {
    periodPreset: 'periodo', dateFrom: 'de', dateTo: 'ate', unitFilter: 'unidade',
    roleFilter: 'funcao', statusFilter: 'status', shiftFilter: 'horario', typeFilter: 'tipo'
  };
  const FILTER_LABELS = { unitFilter: 'Unidade', roleFilter: 'Função', statusFilter: 'Status', shiftFilter: 'Horário', typeFilter: 'Tipo' };
  const PRESET_LABELS = {
    week: 'Semana atual', month: 'Mês atual', prevMonth: 'Mês anterior', last30: 'Últimos 30 dias',
    quarter: 'Últimos 3 meses', year: 'Ano atual', last12: 'Últimos 12 meses', all: 'Todo o histórico', custom: 'Personalizado'
  };
  const STATUS_GROUP_LABELS = { approved: 'Aprovadas', 'in-progress': 'Em andamento', cancelled: 'Canceladas', other: 'Outros / sem status' };
  const UNIT_GROUPS = [
    ['official', 'Unidades do cadastro'], ['outside-map', 'Fora do mapa SP'], ['review', 'Cadastro a revisar'],
    ['non-unit', 'Não é unidade'], ['missing', 'Sem unidade']
  ];
  const UNIT_TAGS = {
    review: ['Revisar cadastro', ''], 'outside-map': ['Fora do mapa SP', ''],
    'non-unit': ['Não é unidade', 'gray'], missing: ['Sem unidade', 'gray']
  };
  const QUALITY = {
    fallback: { label: 'Data pelo carimbo', test: function (r) { return r.dateSource === 'carimbo'; } },
    noDate: { label: 'Sem data válida', test: function (r) { return r.dateSource === 'ausente'; } },
    atypical: { label: 'Data atípica', test: function (r) { return Boolean(r.dateWarning); } },
    monthMismatch: { label: 'Mês divergente', test: monthMismatch },
    noDays: { label: 'Aprovada sem Dias', test: function (r) { return r.statusCategory === 'approved' && r.days == null; } },
    otherStatus: { label: 'Status não reconhecido', test: function (r) { return r.statusCategory === 'other' || r.statusCategory === 'missing'; } },
    unitPending: { label: 'Unidade a revisar', test: function (r) { return r.unitGroup === 'review' || r.unitGroup === 'missing'; } }
  };
  const SECTIONS = ['overview', 'trend', 'cancellations', 'closing', 'experiences', 'dataQuality', 'records'];

  const state = {
    rows: [], meta: null, loading: false, syncMode: 'pending', lastFiltered: [], recordsView: [],
    specificRows: [], specificSummaryText: '',
    quality: '', search: '', recordLimit: PAGE_SIZE, expanded: {},
    unitSort: { key: 'total', dir: 'desc' }, recordSort: { key: 'periodDate', dir: 'desc' },
    coverageStart: null, pendingSelects: {}, periodBeforeMonth: null,
    filterHistory: [], lastSnapshot: null,
    refreshTimer: null, nextRefreshAt: null, lastAttemptAt: 0
  };

  /* ---------- utilidades ---------- */

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function number(value, digits) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }

  function pct(ratio, digits) {
    if (ratio == null || !Number.isFinite(ratio)) return '—';
    return number(ratio * 100, digits == null ? 1 : digits) + '%';
  }

  function plural(count, singular, pluralWord) {
    return number(count) + ' ' + (count === 1 ? singular : pluralWord);
  }

  function days(value) {
    if (value == null) return '—';
    return number(value, 1) + (value === 1 ? ' dia' : ' dias');
  }

  function dateFromIso(value) {
    if (!value) return null;
    const parts = value.split('-').map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function localIso(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function displayDate(value) {
    const date = dateFromIso(value);
    return date ? date.toLocaleDateString('pt-BR') : '—';
  }

  function monthLabel(key, long) {
    const date = dateFromIso(key + '-01');
    if (!date) return key;
    const month = date.toLocaleDateString('pt-BR', { month: long ? 'long' : 'short' }).replace('.', '');
    return long ? month + ' de ' + date.getFullYear() : month + '/' + String(date.getFullYear()).slice(2);
  }

  function addMonthsClamped(date, months) {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last));
  }

  function addDays(date, amount) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
  }

  function daysBetween(fromIso, toIso) {
    const from = dateFromIso(fromIso);
    const to = dateFromIso(toIso);
    return from && to ? Math.round((to - from) / 86400000) + 1 : null;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort(function (a, b) { return a - b; });
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function mean(values) {
    return values.length ? values.reduce(function (sum, item) { return sum + item; }, 0) / values.length : null;
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function shiftMinutes(label) {
    const match = String(label).match(/^(\d{1,2})(?::(\d{2}))?/);
    return match ? Number(match[1]) * 60 + Number(match[2] || 0) : Infinity;
  }

  function monthMismatch(row) {
    if (!row.openingDate || !row.monthCell) return false;
    const month = Number(row.monthCell);
    if (!Number.isInteger(month) || month < 1 || month > 12) return false;
    return Number(row.openingDate.slice(5, 7)) !== month;
  }

  function rowFlags(row) {
    return Object.keys(QUALITY).filter(function (key) { return QUALITY[key].test(row); });
  }

  function statusClass(category) {
    if (category === 'approved') return 'approved';
    if (category === 'in-progress') return 'ongoing';
    if (category === 'cancelled') return 'cancelled';
    return 'other';
  }

  function relativeTime(date) {
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'há menos de 1 min';
    if (seconds < 3600) return 'há ' + Math.round(seconds / 60) + ' min';
    if (seconds < 86400) return 'há ' + Math.round(seconds / 3600) + ' h';
    return 'em ' + date.toLocaleDateString('pt-BR');
  }

  function flashButtonLabel(btn, tempText) {
    if (!btn) return;
    const original = btn.dataset.origLabel || btn.textContent;
    btn.dataset.origLabel = original;
    btn.textContent = tempText;
    window.setTimeout(function () { btn.textContent = original; }, 1800);
  }

  function setMessage(message, kind) {
    const box = byId('globalMessage');
    box.textContent = message || '';
    box.className = 'message' + (kind === 'error' ? ' error' : '');
    box.hidden = !message;
  }

  function scrollToId(id) {
    const target = byId(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleFiltersPanel(forceOpen) {
    const panel = byId('filtersPanel');
    const btn = byId('toggleFiltersBtn');
    const open = forceOpen != null ? forceOpen : panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('active', open);
    if (open) byId('periodPreset').focus({ preventScroll: true });
  }

  /* ---------- histórico de etapas (botão Voltar) ---------- */

  function getFilterSnapshot() {
    return {
      preset: byId('periodPreset').value,
      from: byId('dateFrom').value,
      to: byId('dateTo').value,
      unit: byId('unitFilter').value,
      role: byId('roleFilter').value,
      status: byId('statusFilter').value,
      shift: byId('shiftFilter').value,
      type: byId('typeFilter').value,
      quality: state.quality
    };
  }

  function snapshotsEqual(a, b) {
    if (!a || !b) return false;
    return a.preset === b.preset && a.from === b.from && a.to === b.to &&
      a.unit === b.unit && a.role === b.role && a.status === b.status &&
      a.shift === b.shift && a.type === b.type && a.quality === b.quality;
  }

  function applyFilterSnapshot(snap) {
    byId('periodPreset').value = snap.preset;
    byId('dateFrom').value = snap.from;
    byId('dateTo').value = snap.to;
    byId('unitFilter').value = snap.unit;
    byId('roleFilter').value = snap.role;
    byId('statusFilter').value = snap.status;
    byId('shiftFilter').value = snap.shift;
    byId('typeFilter').value = snap.type;
    state.quality = snap.quality;
  }

  function goBackStep() {
    if (!state.filterHistory.length) return;
    const prev = state.filterHistory.pop();
    applyFilterSnapshot(prev);
    state.lastSnapshot = prev;
    render({ skipHistory: true });
  }

  function updateBackButton() {
    const btn = byId('backBtn');
    const count = state.filterHistory.length;
    btn.hidden = count === 0;
    btn.title = count > 1 ? 'Voltar uma etapa (' + count + ' etapas no histórico)' : 'Voltar para a seleção anterior';
  }

  /* ---------- períodos ---------- */

  function presetRange(preset) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const y = today.getFullYear();
    const m = today.getMonth();
    switch (preset) {
      case 'week': return { from: localIso(addDays(today, -((today.getDay() + 6) % 7))), to: localIso(today) };
      case 'month': return { from: localIso(new Date(y, m, 1)), to: localIso(today) };
      case 'prevMonth': return { from: localIso(new Date(y, m - 1, 1)), to: localIso(new Date(y, m, 0)) };
      case 'last30': return { from: localIso(addDays(today, -29)), to: localIso(today) };
      case 'quarter': return { from: localIso(new Date(y, m - 2, 1)), to: localIso(today) };
      case 'year': return { from: localIso(new Date(y, 0, 1)), to: localIso(today) };
      case 'last12': return { from: localIso(new Date(y, m - 11, 1)), to: localIso(today) };
      case 'all': return { from: '', to: '' };
      default: return null;
    }
  }

  function applyDatePreset(preset) {
    const range = presetRange(preset);
    if (!range) return;
    byId('dateFrom').value = range.from;
    byId('dateTo').value = range.to;
  }

  function applyModalPreset(preset) {
    const range = presetRange(preset);
    if (!range) return;
    byId('spFrom').value = range.from;
    byId('spTo').value = range.to;
  }

  function compareRange(preset, fromIso, toIso) {
    if (!fromIso || !toIso || fromIso > toIso) return null;
    const from = dateFromIso(fromIso);
    const to = dateFromIso(toIso);
    let pFrom;
    let pTo;
    if (preset === 'month') { pFrom = addMonthsClamped(from, -1); pTo = addMonthsClamped(to, -1); }
    else if (preset === 'prevMonth') { pFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1); pTo = new Date(from.getFullYear(), from.getMonth(), 0); }
    else if (preset === 'quarter') { pFrom = addMonthsClamped(from, -3); pTo = addMonthsClamped(to, -3); }
    else if (preset === 'year') { pFrom = addMonthsClamped(from, -12); pTo = addMonthsClamped(to, -12); }
    else if (preset === 'last12') { pFrom = addMonthsClamped(from, -12); pTo = addMonthsClamped(to, -12); }
    else if (preset === 'week') { pFrom = addDays(from, -7); pTo = addDays(to, -7); }
    else {
      const length = daysBetween(fromIso, toIso);
      pTo = addDays(from, -1);
      pFrom = addDays(pTo, -(length - 1));
    }
    const range = { from: localIso(pFrom), to: localIso(pTo) };
    range.label = displayDate(range.from) + ' a ' + displayDate(range.to);
    return range;
  }

  function formatRangeLabel(preset, from, to) {
    if (!from && !to) return 'Todo o histórico';
    if (from && to && from > to) return null;
    let text;
    if (from && to) text = displayDate(from) + ' a ' + displayDate(to);
    else if (from) text = 'A partir de ' + displayDate(from);
    else text = 'Até ' + displayDate(to);
    return (preset !== 'custom' && PRESET_LABELS[preset] ? PRESET_LABELS[preset] + ' · ' : '') + text;
  }

  function periodText(criteria) {
    return formatRangeLabel(byId('periodPreset').value, criteria.from, criteria.to);
  }

  /* ---------- filtros ---------- */

  function readCriteria() {
    return {
      from: byId('dateFrom').value, to: byId('dateTo').value,
      unit: byId('unitFilter').value, role: byId('roleFilter').value, status: byId('statusFilter').value,
      shift: byId('shiftFilter').value, type: byId('typeFilter').value, quality: state.quality
    };
  }

  function matchesStatus(row, value) {
    if (!value) return true;
    if (value.indexOf('cat:') === 0) {
      const category = value.slice(4);
      if (category === 'other') return row.statusCategory === 'other' || row.statusCategory === 'missing';
      return row.statusCategory === category;
    }
    return row.status === value.slice(2);
  }

  function filterRows(c) {
    const qualityTest = c.quality && QUALITY[c.quality] ? QUALITY[c.quality].test : null;
    return state.rows.filter(function (row) {
      if (c.unit && row.unit !== c.unit) return false;
      if (c.role && row.role !== c.role) return false;
      if (c.status && !matchesStatus(row, c.status)) return false;
      if (c.shift && row.shift !== c.shift) return false;
      if (c.type && row.vacancyType !== c.type) return false;
      if (c.from && (!row.periodDate || row.periodDate < c.from)) return false;
      if (c.to && (!row.periodDate || row.periodDate > c.to)) return false;
      if (qualityTest && !qualityTest(row)) return false;
      return true;
    });
  }

  function hasActiveSubFilters() {
    return Boolean(state.quality) || SELECT_FILTERS.some(function (id) { return Boolean(byId(id).value); });
  }

  function hasActiveFilters() {
    return byId('periodPreset').value !== DEFAULT_PRESET || hasActiveSubFilters();
  }

  function filterValueLabel(id, value) {
    if (id === 'statusFilter') {
      return value.indexOf('cat:') === 0 ? STATUS_GROUP_LABELS[value.slice(4)] || value : value.slice(2);
    }
    return value;
  }

  function fillSelect(id, firstLabel, groups) {
    const select = byId(id);
    const previous = state.pendingSelects[id] != null ? state.pendingSelects[id] : select.value;
    const optionHtml = function (option) {
      return '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>';
    };
    select.innerHTML = '<option value="">' + escapeHtml(firstLabel) + '</option>' + groups.filter(function (group) {
      return group.options.length;
    }).map(function (group) {
      const inner = group.options.map(optionHtml).join('');
      return group.label ? '<optgroup label="' + escapeHtml(group.label) + '">' + inner + '</optgroup>' : inner;
    }).join('');
    select.value = Array.from(select.options).some(function (option) { return option.value === previous; }) ? previous : '';
    delete state.pendingSelects[id];
  }

  function countBy(keyFn) {
    const map = new Map();
    state.rows.forEach(function (row) {
      const key = keyFn(row);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }

  function populateFilters() {
    const unitCounts = countBy(function (row) { return row.unit; });
    const unitGroupOf = new Map();
    state.rows.forEach(function (row) { if (!unitGroupOf.has(row.unit)) unitGroupOf.set(row.unit, row.unitGroup); });
    const byName = function (a, b) { return a.localeCompare(b, 'pt-BR'); };
    const withCount = function (map) {
      return function (value) { return { value: value, label: value + ' (' + number(map.get(value)) + ')' }; };
    };

    const unitGroupsList = UNIT_GROUPS.map(function (group) {
      const names = Array.from(unitCounts.keys()).filter(function (name) { return unitGroupOf.get(name) === group[0]; }).sort(byName);
      return { label: group[1], options: names.map(withCount(unitCounts)) };
    });
    fillSelect('unitFilter', 'Todas as unidades', unitGroupsList);
    fillSelect('spUnit', 'Todas as unidades', unitGroupsList);

    const roleCounts = countBy(function (row) { return row.role; });
    const roleGroupsList = [{ options: Array.from(roleCounts.keys()).sort(byName).map(withCount(roleCounts)) }];
    fillSelect('roleFilter', 'Todas as funções', roleGroupsList);
    fillSelect('spRole', 'Todas as funções', roleGroupsList);

    const categoryCounts = countBy(function (row) { return row.statusCategory === 'missing' ? 'other' : row.statusCategory; });
    const statusCounts = countBy(function (row) { return row.status; });
    fillSelect('statusFilter', 'Todos os status', [
      {
        label: 'Grupos', options: ['approved', 'in-progress', 'cancelled', 'other'].filter(function (key) { return categoryCounts.has(key); })
          .map(function (key) { return { value: 'cat:' + key, label: STATUS_GROUP_LABELS[key] + ' (' + number(categoryCounts.get(key)) + ')' }; })
      },
      {
        label: 'Status da planilha', options: Array.from(statusCounts.keys()).sort(byName)
          .map(function (status) { return { value: 's:' + status, label: status + ' (' + number(statusCounts.get(status)) + ')' }; })
      }
    ]);

    const shiftCounts = countBy(function (row) { return row.shift; });
    const shiftGroupsList = [{
      options: Array.from(shiftCounts.keys()).sort(function (a, b) { return shiftMinutes(a) - shiftMinutes(b) || byName(a, b); }).map(withCount(shiftCounts))
    }];
    fillSelect('shiftFilter', 'Todos os horários', shiftGroupsList);
    fillSelect('spShift', 'Todos os horários', shiftGroupsList);

    const typeCounts = countBy(function (row) { return row.vacancyType; });
    const typeGroupsList = [{ options: Array.from(typeCounts.keys()).sort(byName).map(withCount(typeCounts)) }];
    fillSelect('typeFilter', 'Todos os tipos', typeGroupsList);
    fillSelect('spType', 'Todos os tipos', typeGroupsList);
  }

  function resetFilters() {
    SELECT_FILTERS.forEach(function (id) { byId(id).value = ''; });
    byId('periodPreset').value = DEFAULT_PRESET;
    applyDatePreset(DEFAULT_PRESET);
    state.quality = '';
    state.search = '';
    state.periodBeforeMonth = null;
    state.filterHistory = [];
    state.lastSnapshot = null;
    byId('recordSearch').value = '';
  }

  function toggleSelect(id, value) {
    const select = byId(id);
    if (!Array.from(select.options).some(function (option) { return option.value === value; })) return;
    select.value = select.value === value ? '' : value;
    render();
  }

  function setMonthFilter(key) {
    const first = dateFromIso(key + '-01');
    if (!first) return;
    const from = localIso(first);
    const to = localIso(new Date(first.getFullYear(), first.getMonth() + 1, 0));
    if (byId('dateFrom').value === from && byId('dateTo').value === to && state.periodBeforeMonth) {
      const previous = state.periodBeforeMonth;
      byId('periodPreset').value = previous.preset;
      byId('dateFrom').value = previous.from;
      byId('dateTo').value = previous.to;
      state.periodBeforeMonth = null;
      render();
      return;
    }
    if (!state.periodBeforeMonth) {
      state.periodBeforeMonth = { preset: byId('periodPreset').value, from: byId('dateFrom').value, to: byId('dateTo').value };
    }
    byId('periodPreset').value = 'custom';
    byId('dateFrom').value = from;
    byId('dateTo').value = to;
    render();
  }

  /* ---------- URL compartilhável ---------- */

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    const preset = params.get(URL_KEYS.periodPreset);
    if (preset && PRESET_LABELS[preset]) {
      byId('periodPreset').value = preset;
      if (preset === 'custom') {
        byId('dateFrom').value = params.get(URL_KEYS.dateFrom) || '';
        byId('dateTo').value = params.get(URL_KEYS.dateTo) || '';
      } else {
        applyDatePreset(preset);
      }
    } else {
      byId('periodPreset').value = DEFAULT_PRESET;
      applyDatePreset(DEFAULT_PRESET);
    }
    SELECT_FILTERS.forEach(function (id) {
      if (params.get(URL_KEYS[id])) state.pendingSelects[id] = params.get(URL_KEYS[id]);
    });
    const quality = params.get('qualidade');
    if (quality && QUALITY[quality]) state.quality = quality;
  }

  function writeUrlState() {
    const params = new URLSearchParams();
    const preset = byId('periodPreset').value;
    if (preset !== DEFAULT_PRESET) params.set(URL_KEYS.periodPreset, preset);
    if (preset === 'custom') {
      if (byId('dateFrom').value) params.set(URL_KEYS.dateFrom, byId('dateFrom').value);
      if (byId('dateTo').value) params.set(URL_KEYS.dateTo, byId('dateTo').value);
    }
    SELECT_FILTERS.forEach(function (id) { if (byId(id).value) params.set(URL_KEYS[id], byId(id).value); });
    if (state.quality) params.set('qualidade', state.quality);
    const query = params.toString();
    const next = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(null, '', next);
  }

  /* ---------- cálculos ---------- */

  function stats(rows) {
    const s = { total: rows.length, approved: 0, ongoing: 0, cancelled: 0, other: 0, days: [], ongoingByStatus: {}, viv: 0, vivCount: 0 };
    rows.forEach(function (row) {
      if (row.statusCategory === 'approved') {
        s.approved += 1;
        if (row.days != null) s.days.push(row.days);
      } else if (row.statusCategory === 'in-progress') {
        s.ongoing += 1;
        s.ongoingByStatus[row.status] = (s.ongoingByStatus[row.status] || 0) + 1;
      } else if (row.statusCategory === 'cancelled') {
        s.cancelled += 1;
      } else {
        s.other += 1;
      }
      if (row.totalVivencias != null) { s.viv += row.totalVivencias; s.vivCount += 1; }
    });
    s.valid = s.approved + s.ongoing;
    s.mean = mean(s.days);
    s.median = median(s.days);
    s.cancelRate = s.total ? s.cancelled / s.total : null;
    return s;
  }

  function comparison(criteria) {
    const preset = byId('periodPreset').value;
    const range = compareRange(preset, criteria.from, criteria.to);
    if (!range) return { available: false };
    if (!state.coverageStart || range.from < state.coverageStart) return { available: false, range: range };
    const rows = filterRows(Object.assign({}, criteria, { from: range.from, to: range.to }));
    return { available: true, range: range, stats: stats(rows) };
  }

  function deltaHtml(current, previous, kind, goodWhen) {
    if (current == null || previous == null) return '';
    const diff = current - previous;
    if (Math.abs(diff) < 1e-9) return '<span class="delta flat">= igual</span> <span class="delta-ref">ao período anterior</span>';
    const arrow = diff > 0 ? '▲' : '▼';
    let text = '';
    if (kind === 'count') text = arrow + ' ' + number(Math.abs(diff)) + (previous ? ' (' + (diff > 0 ? '+' : '−') + number(Math.abs(diff) / previous * 100) + '%)' : '');
    else if (kind === 'rate') text = arrow + ' ' + number(Math.abs(diff) * 100, 1) + ' p.p.';
    else text = arrow + ' ' + number(Math.abs(diff), 1) + ' dias';
    let cls = 'neutral';
    if (goodWhen) cls = (diff < 0) === (goodWhen === 'down') ? 'good' : 'bad';
    return '<span class="delta ' + cls + '">' + text + '</span> <span class="delta-ref">vs período anterior</span>';
  }

  function setDelta(id, html, title) {
    const el = byId(id);
    el.innerHTML = html || '';
    el.title = html ? title : '';
  }

  /* ---------- painel centralizado: Gerar Relatório Específico ---------- */

  function simpleBarListHtml(entries, colorClass, emptyMsg) {
    if (!entries.length) return '<div class="empty-state">' + escapeHtml(emptyMsg) + '</div>';
    const max = Math.max.apply(null, entries.map(function (e) { return e.value; }).concat([1]));
    return '<div class="bar-list">' + entries.slice(0, 8).map(function (e) {
      return '<div class="bar-row"><span class="bar-label" title="' + escapeHtml(e.label) + '">' + escapeHtml(e.label) + '</span>' +
        '<span class="bar-track"><span class="bar-seg ' + colorClass + '" style="width:' + (e.value / max * 100).toFixed(2) + '%"></span></span>' +
        '<span class="bar-value">' + (e.display || number(e.value)) + '</span></div>';
    }).join('') + '</div>';
  }

  function openSpecificModal() {
    byId('spFocus').value = byId('statusFilter').value === 'cat:in-progress' ? 'ongoing'
      : byId('statusFilter').value === 'cat:cancelled' ? 'cancelled' : 'hires';
    byId('spPreset').value = byId('periodPreset').value;
    byId('spFrom').value = byId('dateFrom').value;
    byId('spTo').value = byId('dateTo').value;
    byId('spRole').value = byId('roleFilter').value;
    byId('spUnit').value = byId('unitFilter').value;
    byId('spType').value = byId('typeFilter').value;
    byId('spShift').value = byId('shiftFilter').value;
    renderModalReport();
    byId('specificModal').showModal();
  }

  function resetModalFilters() {
    byId('spFocus').value = 'hires';
    byId('spPreset').value = 'quarter';
    applyModalPreset('quarter');
    byId('spRole').value = '';
    byId('spUnit').value = '';
    byId('spType').value = '';
    byId('spShift').value = '';
    renderModalReport();
  }

  function renderModalReport() {
    const focus = byId('spFocus').value;
    const preset = byId('spPreset').value;
    const criteria = {
      from: byId('spFrom').value,
      to: byId('spTo').value,
      role: byId('spRole').value,
      unit: byId('spUnit').value,
      type: byId('spType').value,
      shift: byId('spShift').value,
      status: '',
      quality: ''
    };
    const rows = filterRows(criteria);
    const s = stats(rows);

    const focusTitles = {
      hires: 'Contratações (Vagas Aprovadas)',
      ongoing: 'Vagas em Andamento',
      cancelled: 'Vagas Canceladas',
      closing: 'Tempo Médio de Fechamento',
      vivencias: 'Total de Vivências',
      auto: 'Resumo Completo'
    };
    const contextTags = [];
    if (criteria.role) contextTags.push(criteria.role);
    if (criteria.unit) contextTags.push('Unidade ' + criteria.unit);
    if (criteria.type) contextTags.push('Tipo ' + criteria.type);
    if (criteria.shift) contextTags.push('Horário ' + criteria.shift);

    const title = focusTitles[focus] + (contextTags.length ? ' — ' + contextTags.join(' · ') : '');
    const pText = formatRangeLabel(preset, criteria.from, criteria.to) || 'Período inválido';
    byId('specificModalTitle').textContent = title;
    byId('specificSubtitle').textContent = 'Período: ' + pText;

    let targetRows = rows;
    let barColor = 'approved';
    if (focus === 'hires' || focus === 'closing') {
      targetRows = rows.filter(function (r) { return r.statusCategory === 'approved'; });
      barColor = 'approved';
    } else if (focus === 'ongoing') {
      targetRows = rows.filter(function (r) { return r.statusCategory === 'in-progress'; });
      barColor = 'ongoing';
    } else if (focus === 'cancelled') {
      targetRows = rows.filter(function (r) { return r.statusCategory === 'cancelled'; });
      barColor = 'cancelled';
    } else if (focus === 'vivencias') {
      barColor = 'purple';
    }
    state.specificRows = targetRows;

    const unitsSet = new Set(targetRows.map(function (r) { return r.unit; }));
    const subjectText = (criteria.role ? ' de <strong>' + escapeHtml(criteria.role) + '</strong>' : '') +
      (criteria.unit ? ' na unidade <strong>' + escapeHtml(criteria.unit) + '</strong>' : '');

    let headlineNum = '';
    let headlineLabel = '';
    let answerDetail = '';

    if (focus === 'hires') {
      headlineNum = plural(s.approved, 'contratação', 'contratações');
      headlineLabel = 'Vagas com status Aprovado';
      answerDetail = 'Foram contratadas <strong>' + plural(s.approved, 'vaga', 'vagas') + '</strong>' + subjectText +
        ' no período (<strong>' + escapeHtml(pText) + '</strong>) em <strong>' + plural(unitsSet.size, 'unidade', 'unidades') + '</strong>' +
        (s.days.length ? ', com tempo médio para fechar de <strong>' + days(s.mean) + '</strong>.' : '.');
    } else if (focus === 'ongoing') {
      headlineNum = plural(s.ongoing, 'vaga em andamento', 'vagas em andamento');
      headlineLabel = 'Triagem, Briefing e Vivência';
      answerDetail = 'Há <strong>' + plural(s.ongoing, 'vaga em andamento', 'vagas em andamento') + '</strong>' + subjectText +
        ' no período (<strong>' + escapeHtml(pText) + '</strong>) em <strong>' + plural(unitsSet.size, 'unidade', 'unidades') + '</strong>.';
    } else if (focus === 'cancelled') {
      headlineNum = plural(s.cancelled, 'cancelamento', 'cancelamentos');
      headlineLabel = 'Taxa de ' + pct(s.cancelRate) + ' do total de solicitações';
      answerDetail = 'Foram registradas <strong>' + plural(s.cancelled, 'vaga cancelada', 'vagas canceladas') + '</strong>' + subjectText +
        ' de ' + plural(s.total, 'solicitação', 'solicitações') + ' no período (<strong>' + escapeHtml(pText) + '</strong>).';
    } else if (focus === 'closing') {
      headlineNum = days(s.mean);
      headlineLabel = 'Base: ' + plural(s.days.length, 'vaga aprovada', 'vagas aprovadas');
      answerDetail = 'O tempo médio de fechamento' + subjectText + ' foi de <strong>' + days(s.mean) + '</strong> no período (<strong>' + escapeHtml(pText) + '</strong>).';
    } else if (focus === 'vivencias') {
      headlineNum = plural(s.viv, 'vivência', 'vivências');
      headlineLabel = 'Em ' + plural(s.vivCount, 'vaga preenchida', 'vagas preenchidas');
      answerDetail = 'Soma de <strong>' + number(s.viv) + '</strong> na coluna Total Vivências' + subjectText +
        ' no período (<strong>' + escapeHtml(pText) + '</strong>).';
    } else {
      headlineNum = plural(s.approved, 'aprovada', 'aprovadas') + ' · ' + plural(s.ongoing, 'em andamento', 'em andamento');
      headlineLabel = plural(s.cancelled, 'cancelada', 'canceladas') + ' à parte';
      answerDetail = 'Resumo' + subjectText + ' em <strong>' + escapeHtml(pText) + '</strong>: <strong>' +
        number(s.approved) + ' aprovadas</strong>, <strong>' + number(s.ongoing) + ' em andamento</strong> e <strong>' +
        number(s.cancelled) + ' canceladas</strong>.';
    }

    byId('specificAnswer').innerHTML = '<div class="answer-main"><strong>' + escapeHtml(headlineNum) + '</strong><span>' + escapeHtml(headlineLabel) + '</span></div>' +
      '<p class="answer-text">' + answerDetail + '</p>';

    const substCount = targetRows.filter(function (r) { return normalizeText(r.vacancyType).indexOf('substitu') >= 0; }).length;
    const novaCount = targetRows.filter(function (r) { return normalizeText(r.vacancyType).indexOf('nova') >= 0; }).length;

    byId('specificKpis').innerHTML = [
      ['Contratações (Aprovadas)', number(s.approved), s.total ? pct(s.approved / s.total) + ' das solicitações' : '—', 'accent-green'],
      ['Em andamento', number(s.ongoing), Object.keys(s.ongoingByStatus).map(function (k) { return k + ' ' + s.ongoingByStatus[k]; }).join(' · ') || 'Nenhuma', 'accent-blue'],
      ['Canceladas', number(s.cancelled), s.total ? 'Taxa de ' + pct(s.cancelRate) : '—', 'accent-red'],
      ['Tempo médio', days(s.mean), 'Substituição: ' + number(substCount) + ' · Nova: ' + number(novaCount), 'accent-teal']
    ].map(function (card) {
      return '<article class="metric-card ' + card[3] + '"><span class="metric-label">' + escapeHtml(card[0]) + '</span>' +
        '<strong class="metric-value">' + escapeHtml(card[1]) + '</strong><span class="metric-foot">' + escapeHtml(card[2]) + '</span></article>';
    }).join('');

    const countEntries = function (list, keyFn) {
      const m = new Map();
      list.forEach(function (r) {
        const k = keyFn(r) || 'Não informado';
        const inc = focus === 'vivencias' ? (r.totalVivencias || 0) : 1;
        if (inc > 0) m.set(k, (m.get(k) || 0) + inc);
      });
      return Array.from(m.entries()).map(function (item) {
        return { label: item[0], value: item[1], display: number(item[1]) + (targetRows.length && focus !== 'vivencias' ? '<span class="bar-sub">' + pct(item[1] / targetRows.length, 0) + '</span>' : '') };
      }).sort(function (a, b) { return b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'); });
    };

    const byUnit = countEntries(targetRows, function (r) { return r.unit; });
    const byRole = countEntries(targetRows, function (r) { return r.role; });
    const byShift = countEntries(targetRows, function (r) { return r.shift; });
    const byMonthMap = new Map();
    targetRows.forEach(function (r) {
      if (!r.periodDate) return;
      const k = r.periodDate.slice(0, 7);
      const inc = focus === 'vivencias' ? (r.totalVivencias || 0) : 1;
      if (inc > 0) byMonthMap.set(k, (byMonthMap.get(k) || 0) + inc);
    });
    const byMonth = Array.from(byMonthMap.entries()).sort(function (a, b) { return a[0].localeCompare(b[0]); }).map(function (item) {
      return { label: monthLabel(item[0], true), value: item[1] };
    });

    const firstPanelTitle = criteria.unit && !criteria.role ? 'Por função' : (!criteria.unit ? 'Por unidade' : 'Por horário');
    const firstPanelEntries = criteria.unit && !criteria.role ? byRole : (!criteria.unit ? byUnit : byShift);
    const secondPanelTitle = byMonth.length > 1 ? 'Por mês no período' : (criteria.role ? 'Por horário' : 'Por função');
    const secondPanelEntries = byMonth.length > 1 ? byMonth : (criteria.role ? byShift : byRole);

    byId('specificBreakdowns').innerHTML =
      '<article class="panel chart-panel"><div class="panel-heading"><div><h3>' + escapeHtml(firstPanelTitle) + '</h3></div></div>' +
      simpleBarListHtml(firstPanelEntries, barColor, 'Sem registros neste recorte.') + '</article>' +
      '<article class="panel chart-panel"><div class="panel-heading"><div><h3>' + escapeHtml(secondPanelTitle) + '</h3></div></div>' +
      simpleBarListHtml(secondPanelEntries, barColor, 'Sem registros neste recorte.') + '</article>';

    const sortedRows = targetRows.slice().sort(function (a, b) {
      return String(b.periodDate || '').localeCompare(String(a.periodDate || '')) || b.sourceRow - a.sourceRow;
    });
    byId('specificRecordCount').textContent = 'Ver lista de registros (' + plural(sortedRows.length, 'registro', 'registros') + ')';
    byId('specificRecordsTable').innerHTML = sortedRows.length ? sortedRows.map(function (row) {
      return '<tr><td class="num muted">' + number(row.sourceRow) + '</td><td>' + displayDate(row.periodDate) + '</td><td>' + displayDate(row.closingDate) +
        '</td><td>' + escapeHtml(row.role) + '</td><td>' + escapeHtml(row.unit) + '</td><td>' + escapeHtml(row.shift) +
        '</td><td><span class="status-badge ' + statusClass(row.statusCategory) + '">' + escapeHtml(row.status) + '</span></td><td>' +
        escapeHtml(row.vacancyType) + '</td><td class="num">' + (row.days == null ? '—' : number(row.days)) + '</td></tr>';
    }).join('') : emptyRow(9, 'Nenhum registro encontrado para esta combinação.');

    const topUnitsText = byUnit.slice(0, 8).map(function (u) { return u.label + ' (' + number(u.value) + ')'; }).join(', ');
    const monthText = byMonth.map(function (m) { return m.label + ': ' + number(m.value); }).join(' | ');
    const lines = [
      'RELATÓRIO ESPECÍFICO — FADELITO RH',
      title,
      'Período: ' + pText,
      '',
      '• Resultado principal: ' + headlineNum + ' (' + headlineLabel + ')',
      '• Contratações (Aprovadas): ' + number(s.approved),
      '• Em andamento: ' + number(s.ongoing),
      '• Canceladas: ' + number(s.cancelled) + (s.total ? ' (' + pct(s.cancelRate) + ')' : ''),
      '• Tempo médio de fechamento: ' + days(s.mean) + ' (' + plural(s.days.length, 'vaga', 'vagas') + ')',
      '• Tipo de vaga: Substituição (' + number(substCount) + ') | Nova (' + number(novaCount) + ')'
    ];
    if (topUnitsText) lines.push('• Por unidade: ' + topUnitsText);
    if (monthText) lines.push('• Por mês: ' + monthText);
    state.specificSummaryText = lines.join('\n');
  }

  /* ---------- renderização principal ---------- */

  function emptyBlock(message) {
    return '<div class="empty-state">' + escapeHtml(message) +
      (hasActiveFilters() ? ' <button type="button" class="link-button" data-action="clear-filters">Limpar filtros</button>' : '') + '</div>';
  }

  function emptyRow(cols, message) {
    return '<tr><td colspan="' + cols + '">' + emptyBlock(message) + '</td></tr>';
  }

  function renderFilterInfo(criteria, rows) {
    byId('filterResult').textContent = number(rows.length) + ' de ' + number(state.rows.length) + ' registros';
    const description = periodText(criteria);
    const periodEl = byId('periodDescription');
    if (description == null) {
      periodEl.textContent = 'A data “De” é posterior à data “Até”. Ajuste o período.';
      periodEl.classList.add('warning');
    } else {
      periodEl.textContent = description;
      periodEl.classList.remove('warning');
    }

    const chips = SELECT_FILTERS.filter(function (id) { return byId(id).value; }).map(function (id) {
      return { id: id, label: FILTER_LABELS[id] + ': ' + filterValueLabel(id, byId(id).value) };
    });
    if (state.quality) chips.push({ id: 'quality', label: 'Somente: ' + QUALITY[state.quality].label });
    byId('activeChips').innerHTML = chips.map(function (chip) {
      return '<span class="chip" data-action="remove-filter" data-filter="' + chip.id + '" title="Clique para remover este filtro">' + escapeHtml(chip.label) +
        '<button type="button" data-action="remove-filter" data-filter="' + chip.id + '" aria-label="Remover filtro ' + escapeHtml(chip.label) + '">×</button></span>';
    }).join('');

    updateBackButton();
  }

  function renderMetrics(s, cmp) {
    byId('metricTotal').textContent = number(s.valid);
    byId('metricApproved').textContent = number(s.approved);
    byId('metricApprovedFoot').textContent = s.total ? pct(s.approved / s.total) + ' das solicitações' : 'Status Aprovado';
    byId('metricOngoing').textContent = number(s.ongoing);
    const ongoingParts = Object.keys(s.ongoingByStatus).map(function (status) { return status + ' ' + number(s.ongoingByStatus[status]); });
    byId('metricOngoingFoot').textContent = ongoingParts.length ? ongoingParts.join(' · ') : 'Nenhuma em andamento';
    byId('metricCancelled').textContent = number(s.cancelled);
    byId('metricCancelledFoot').textContent = s.total ? 'Taxa de ' + pct(s.cancelRate) + ' · fora do total' : 'Fora do total de vagas';
    byId('metricAverage').textContent = days(s.mean);
    byId('metricAverageFoot').textContent = s.days.length ? 'Base: ' + plural(s.days.length, 'vaga', 'vagas') + ' com Dias preenchido' : 'Sem aprovadas com Dias preenchido';

    if (cmp.available) {
      const ref = 'Comparado com ' + cmp.range.label;
      setDelta('deltaTotal', deltaHtml(s.valid, cmp.stats.valid, 'count', null), ref + ': ' + number(cmp.stats.valid) + ' vagas');
      setDelta('deltaCancelled', s.total && cmp.stats.total ? deltaHtml(s.cancelRate, cmp.stats.cancelRate, 'rate', 'down') : '',
        ref + ': taxa de ' + pct(cmp.stats.cancelRate) + ' (' + number(cmp.stats.cancelled) + ' canceladas)');
      setDelta('deltaAverage', deltaHtml(s.mean, cmp.stats.mean, 'days', 'down'), ref + ': média de ' + days(cmp.stats.mean));
    } else {
      ['deltaTotal', 'deltaCancelled', 'deltaAverage'].forEach(function (id) { setDelta(id, ''); });
    }

    const status = byId('statusFilter').value;
    document.querySelectorAll('.card-link[data-action="status"]').forEach(function (button) {
      const active = status === button.dataset.value;
      if (!button.dataset.label) button.dataset.label = button.textContent;
      button.textContent = active ? 'Mostrar todos os status' : button.dataset.label;
      button.classList.toggle('active', active);
      button.closest('.metric-card').classList.toggle('selected', active);
    });
  }

  function renderComposition(s) {
    const parts = [
      { key: 'approved', label: 'Aprovadas', value: s.approved, filter: 'cat:approved' },
      { key: 'ongoing', label: 'Em andamento', value: s.ongoing, filter: 'cat:in-progress' },
      { key: 'cancelled', label: 'Canceladas', value: s.cancelled, filter: 'cat:cancelled' },
      { key: 'other', label: 'Outros / sem status', value: s.other, filter: 'cat:other' }
    ];
    byId('compositionBar').innerHTML = s.total ? parts.filter(function (part) { return part.value; }).map(function (part) {
      return '<span class="composition-seg ' + part.key + '" style="width:' + (part.value / s.total * 100).toFixed(2) + '%" title="' +
        escapeHtml(part.label + ': ' + number(part.value) + ' (' + pct(part.value / s.total) + ')') + '"></span>';
    }).join('') : '';
    byId('compositionLegend').innerHTML = parts.filter(function (part) { return part.value || part.key !== 'other'; }).map(function (part) {
      return '<button type="button" class="legend-item" data-action="status" data-value="' + part.filter + '"' + (part.value ? '' : ' disabled') + '>' +
        '<i class="swatch ' + part.key + '"></i>' + part.label + ' <strong>' + number(part.value) + '</strong>' +
        '<span class="muted">' + (s.total ? pct(part.value / s.total) : '—') + '</span></button>';
    }).join('');
  }

  function groupEntries(rows, keyFn) {
    const map = new Map();
    rows.forEach(function (row) {
      const key = keyFn(row) || 'Não informado';
      if (!map.has(key)) map.set(key, { label: key, value: 0, approved: 0, ongoing: 0 });
      const item = map.get(key);
      item.value += 1;
      if (row.statusCategory === 'approved') item.approved += 1;
      if (row.statusCategory === 'in-progress') item.ongoing += 1;
    });
    return Array.from(map.values()).sort(function (a, b) { return b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'); });
  }

  function renderBars(id, entries, options) {
    const opts = options || {};
    const target = byId(id);
    if (!entries.length) {
      target.innerHTML = emptyBlock(opts.empty || 'Sem registros para os filtros selecionados.');
      return;
    }
    const limit = opts.limit || BAR_LIMIT;
    const expanded = Boolean(state.expanded[id]);
    const items = expanded || opts.noLimit ? entries : entries.slice(0, limit);
    const max = Math.max.apply(null, entries.map(function (entry) { return entry.value; }).concat([1]));
    const current = opts.filterId ? byId(opts.filterId).value : null;
    const html = items.map(function (entry) {
      const segments = (entry.segments || [{ cls: opts.color || '', value: entry.value }]).filter(function (seg) { return seg.value > 0; });
      const segHtml = segments.map(function (seg) {
        return '<span class="bar-seg ' + seg.cls + '" style="width:' + (seg.value / max * 100).toFixed(2) + '%"></span>';
      }).join('');
      const value = entry.filterValue != null ? entry.filterValue : entry.label;
      const clickable = Boolean(opts.filterId);
      const tag = clickable ? 'button' : 'div';
      const active = clickable && current === value;
      const attrs = clickable ? ' type="button" data-action="filter" data-filter="' + opts.filterId + '" data-value="' + escapeHtml(value) + '"' : '';
      const title = (entry.title || entry.label + ': ' + number(entry.value)) + (clickable ? (active ? ' · clique para remover o filtro' : ' · clique para filtrar') : '');
      return '<' + tag + ' class="bar-row' + (clickable ? ' clickable' : '') + (active ? ' active' : '') + '"' + attrs + ' title="' + escapeHtml(title) + '">' +
        '<span class="bar-label">' + escapeHtml(entry.label) + '</span>' +
        '<span class="bar-track">' + segHtml + '</span>' +
        '<span class="bar-value">' + (entry.display || number(entry.value)) + '</span></' + tag + '>';
    }).join('');
    const more = !opts.noLimit && entries.length > limit ? '<button type="button" class="link-button more-button" data-action="expand" data-target="' + id + '">' +
      (expanded ? 'Mostrar só os ' + limit + ' maiores' : 'Ver todos (' + number(entries.length) + ')') + '</button>' : '';
    target.innerHTML = html + more;
  }

  function renderFunctionBars(rows) {
    const valid = rows.filter(function (row) { return row.statusCategory === 'approved' || row.statusCategory === 'in-progress'; });
    renderBars('functionBars', groupEntries(valid, function (row) { return row.role; }).map(function (entry) {
      return Object.assign(entry, {
        segments: [{ cls: 'approved', value: entry.approved }, { cls: 'ongoing', value: entry.ongoing }],
        title: entry.label + ': ' + plural(entry.value, 'vaga', 'vagas') + ' (' + number(entry.approved) + ' aprovadas, ' + number(entry.ongoing) + ' em andamento)'
      });
    }), { filterId: 'roleFilter' });
  }

  function updateSortHeaders(action, sort) {
    document.querySelectorAll('[data-action="' + action + '"]').forEach(function (button) {
      const th = button.closest('th');
      const active = button.dataset.key === sort.key;
      th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      button.classList.toggle('sorted', active);
      button.dataset.dir = active ? sort.dir : '';
    });
  }

  function compareValues(a, b, dir) {
    const aEmpty = a == null || a === '';
    const bEmpty = b == null || b === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
    return dir === 'asc' ? result : -result;
  }

  function renderUnitTable(rows) {
    const grouped = new Map();
    rows.forEach(function (row) {
      if (!grouped.has(row.unit)) grouped.set(row.unit, { name: row.unit, group: row.unitGroup, total: 0, approved: 0, ongoing: 0, cancelled: 0, requests: 0 });
      const item = grouped.get(row.unit);
      item.requests += 1;
      if (row.statusCategory === 'approved') { item.approved += 1; item.total += 1; }
      else if (row.statusCategory === 'in-progress') { item.ongoing += 1; item.total += 1; }
      else if (row.statusCategory === 'cancelled') item.cancelled += 1;
    });
    const items = Array.from(grouped.values()).map(function (item) {
      item.cancelRate = item.requests ? item.cancelled / item.requests : null;
      return item;
    }).sort(function (a, b) {
      return compareValues(a[state.unitSort.key], b[state.unitSort.key], state.unitSort.dir) || a.name.localeCompare(b.name, 'pt-BR');
    });
    const currentUnit = byId('unitFilter').value;
    byId('unitTable').innerHTML = items.length ? items.map(function (item) {
      const tagInfo = UNIT_TAGS[item.group];
      const tag = tagInfo ? '<span class="table-tag ' + tagInfo[1] + '">' + tagInfo[0] + '</span>' : '';
      const active = currentUnit === item.name;
      return '<tr' + (active ? ' class="active"' : '') + '><td><button type="button" class="link-button cell-link" data-action="filter" data-filter="unitFilter" data-value="' +
        escapeHtml(item.name) + '" title="' + (active ? 'Remover filtro de unidade' : 'Filtrar por ' + escapeHtml(item.name)) + '">' + escapeHtml(item.name) + '</button>' + tag + '</td>' +
        '<td class="num strong">' + number(item.total) + '</td><td class="num">' + number(item.approved) + '</td><td class="num">' + number(item.ongoing) +
        '</td><td class="num">' + number(item.cancelled) + '</td><td class="num">' + pct(item.cancelRate) + '</td></tr>';
    }).join('') : emptyRow(6, 'Sem registros para os filtros selecionados.');

    const sum = function (key) { return items.reduce(function (total, item) { return total + item[key]; }, 0); };
    const requests = sum('requests');
    byId('unitTableTotal').innerHTML = items.length ? '<tr><td>Total</td><td class="num">' + number(sum('total')) + '</td><td class="num">' + number(sum('approved')) +
      '</td><td class="num">' + number(sum('ongoing')) + '</td><td class="num">' + number(sum('cancelled')) + '</td><td class="num">' +
      pct(requests ? sum('cancelled') / requests : null) + '</td></tr>' : '';
    const others = requests - sum('total') - sum('cancelled');
    const reconciled = requests === rows.length;
    byId('unitTableFoot').innerHTML = items.length ? (reconciled ? '<span class="ok-mark">✓</span> ' : '<span class="error-mark">!</span> ') +
      number(sum('total')) + ' vagas + ' + number(sum('cancelled')) + ' canceladas' + (others ? ' + ' + number(others) + ' outros status' : '') +
      ' = ' + number(requests) + ' solicitações em ' + plural(items.length, 'grupo', 'grupos') + (reconciled ? ' · soma confere com o total filtrado.' : ' · soma NÃO confere com o total filtrado.') : '';
    updateSortHeaders('sort-units', state.unitSort);
  }

  function monthKeysBetween(first, last) {
    const keys = [];
    let date = dateFromIso(first + '-01');
    const end = dateFromIso(last + '-01');
    while (date <= end && keys.length < 400) {
      keys.push(localIso(date).slice(0, 7));
      date = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    }
    return keys;
  }

  function renderTrend(rows) {
    const map = new Map();
    let undated = 0;
    rows.forEach(function (row) {
      if (!row.periodDate) { undated += 1; return; }
      const key = row.periodDate.slice(0, 7);
      if (!map.has(key)) map.set(key, { approved: 0, ongoing: 0, cancelled: 0, other: 0, total: 0 });
      const item = map.get(key);
      item[statusClass(row.statusCategory)] += 1;
      item.total += 1;
    });
    let keys = Array.from(map.keys()).sort();
    const target = byId('trendChart');
    if (!keys.length) {
      target.innerHTML = emptyBlock('Sem registros com data para os filtros selecionados.');
      byId('trendNote').textContent = '—';
      return;
    }
    const continuous = monthKeysBetween(keys[0], keys[keys.length - 1]);
    if (continuous.length <= 36) keys = continuous;
    const max = Math.max.apply(null, keys.map(function (key) { return map.has(key) ? map.get(key).total : 0; }).concat([1]));
    const currentMonth = localIso(new Date()).slice(0, 7);
    const from = byId('dateFrom').value;
    const to = byId('dateTo').value;
    let previousKey = null;
    const html = keys.map(function (key) {
      const item = map.get(key) || { approved: 0, ongoing: 0, cancelled: 0, other: 0, total: 0 };
      let gap = '';
      if (previousKey && monthKeysBetween(previousKey, key).length > 2) gap = '<span class="trend-gap" title="Meses sem registros omitidos">…</span>';
      previousKey = key;
      const first = key + '-01';
      const lastDate = dateFromIso(first);
      const last = localIso(new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 0));
      const active = from === first && to === last;
      const partial = key === currentMonth;
      const segments = ['approved', 'ongoing', 'cancelled', 'other'].filter(function (cls) { return item[cls]; }).map(function (cls) {
        return '<span class="trend-seg ' + cls + '" style="height:' + (item[cls] / item.total * 100).toFixed(2) + '%"></span>';
      }).join('');
      const title = monthLabel(key, true) + (partial ? ' (mês em andamento)' : '') + ': ' + plural(item.total, 'solicitação', 'solicitações') +
        ' — ' + number(item.approved) + ' aprovadas, ' + number(item.ongoing) + ' em andamento, ' + number(item.cancelled) + ' canceladas' +
        (item.other ? ', ' + number(item.other) + ' outros' : '') + (active ? ' · clique para voltar ao período anterior' : ' · clique para ver só este mês');
      return gap + '<button type="button" class="trend-col' + (active ? ' active' : '') + (partial ? ' partial' : '') + '" data-action="month" data-value="' + key + '" title="' + escapeHtml(title) + '">' +
        '<span class="trend-value">' + (item.total ? number(item.total) : '') + '</span>' +
        '<span class="trend-area"><span class="trend-stack" style="height:' + (item.total / max * 100).toFixed(2) + '%">' + segments + '</span></span>' +
        '<span class="trend-label">' + escapeHtml(monthLabel(key)) + '</span></button>';
    }).join('');
    target.innerHTML = '<div class="trend-columns">' + html + '</div>';
    const withData = keys.filter(function (key) { return map.has(key); }).length;
    let note = plural(keys.length, 'mês', 'meses') + ' · média de ' + number((rows.length - undated) / Math.max(withData, 1), 1) + ' solicitações por mês com registros';
    if (keys.indexOf(currentMonth) >= 0) note += ' · mês atual ainda em andamento';
    if (undated) note += ' · ' + plural(undated, 'registro sem data não aparece', 'registros sem data não aparecem');
    byId('trendNote').textContent = note;
  }

  function cancelEntries(rows, keyFn) {
    const map = new Map();
    rows.forEach(function (row) {
      const key = keyFn(row) || 'Não informado';
      if (!map.has(key)) map.set(key, { label: key, requests: 0, cancelled: 0 });
      const item = map.get(key);
      item.requests += 1;
      if (row.statusCategory === 'cancelled') item.cancelled += 1;
    });
    return Array.from(map.values()).filter(function (item) { return item.cancelled > 0; }).sort(function (a, b) {
      return b.cancelled - a.cancelled || b.cancelled / b.requests - a.cancelled / a.requests || a.label.localeCompare(b.label, 'pt-BR');
    }).map(function (item) {
      const rate = item.cancelled / item.requests;
      return {
        label: item.label, value: item.cancelled,
        display: number(item.cancelled) + '<span class="bar-sub">' + pct(rate, 0) + '</span>',
        title: item.label + ': ' + number(item.cancelled) + ' de ' + plural(item.requests, 'solicitação cancelada', 'solicitações canceladas') + ' (' + pct(rate) + ')',
        segments: [{ cls: 'cancelled', value: item.cancelled }]
      };
    });
  }

  function renderCancellations(rows) {
    const empty = 'Nenhum cancelamento para os filtros selecionados.';
    renderBars('cancelUnitBars', cancelEntries(rows, function (row) { return row.unit; }), { filterId: 'unitFilter', empty: empty });
    renderBars('cancelRoleBars', cancelEntries(rows, function (row) { return row.role; }), { filterId: 'roleFilter', empty: empty });
  }

  function renderClosing(rows, s) {
    byId('closingMean').textContent = days(s.mean);
    byId('closingMedian').textContent = days(s.median);
    byId('closingCount').textContent = plural(s.days.length, 'vaga', 'vagas');
    byId('closingCoverage').textContent = s.approved ? 'de ' + number(s.approved) + ' aprovadas (' + pct(s.days.length / s.approved, 0) + ')' +
      (s.approved - s.days.length ? ' · ' + number(s.approved - s.days.length) + ' sem Dias' : '') : 'Sem aprovadas no recorte';

    const buckets = [['Até 7 dias', 7], ['8 a 15 dias', 15], ['16 a 30 dias', 30], ['31 a 60 dias', 60], ['Mais de 60 dias', Infinity]];
    const counts = buckets.map(function () { return 0; });
    s.days.forEach(function (value) {
      const index = buckets.findIndex(function (bucket) { return value <= bucket[1]; });
      counts[index] += 1;
    });
    renderBars('closingBuckets', s.days.length ? buckets.map(function (bucket, index) {
      return {
        label: bucket[0], value: counts[index], segments: [{ cls: 'approved', value: counts[index] }],
        display: number(counts[index]) + '<span class="bar-sub">' + pct(counts[index] / s.days.length, 0) + '</span>',
        title: bucket[0] + ': ' + plural(counts[index], 'vaga', 'vagas') + ' (' + pct(counts[index] / s.days.length) + ')'
      };
    }) : [], { noLimit: true, empty: 'Sem vagas aprovadas com Dias preenchido no recorte.' });

    const monthMap = new Map();
    rows.forEach(function (row) {
      if (row.statusCategory !== 'approved' || row.days == null || !row.periodDate) return;
      const key = row.periodDate.slice(0, 7);
      if (!monthMap.has(key)) monthMap.set(key, []);
      monthMap.get(key).push(row.days);
    });
    const months = Array.from(monthMap.entries()).sort(function (a, b) { return a[0].localeCompare(b[0]); });
    byId('closingTable').innerHTML = months.length ? months.map(function (item) {
      return '<tr><td>' + escapeHtml(monthLabel(item[0])) + '</td><td class="num">' + number(item[1].length) +
        '</td><td class="num">' + number(mean(item[1]), 1) + '</td><td class="num">' + number(median(item[1]), 1) + '</td></tr>';
    }).join('') : emptyRow(4, 'Sem fechamentos com Dias preenchido no período.');
  }

  function renderExperiences(rows, s) {
    byId('experienceStats').innerHTML = [
      ['Soma do campo', number(s.viv)],
      ['Registros com valor', number(s.vivCount)],
      ['Média por registro', s.vivCount ? number(s.viv / s.vivCount, 1) : '—']
    ].map(function (item) {
      return '<div class="stat theme-purple"><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>';
    }).join('');
    const sumEntries = function (keyFn) {
      const map = new Map();
      rows.forEach(function (row) {
        if (row.totalVivencias == null) return;
        const key = keyFn(row) || 'Não informado';
        map.set(key, (map.get(key) || 0) + row.totalVivencias);
      });
      return Array.from(map.entries()).filter(function (item) { return item[1] > 0; }).map(function (item) {
        return { label: item[0], value: item[1], segments: [{ cls: 'purple', value: item[1] }] };
      }).sort(function (a, b) { return b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'); });
    };
    renderBars('experienceRoleBars', sumEntries(function (row) { return row.role; }), { filterId: 'roleFilter' });
    renderBars('experienceUnitBars', sumEntries(function (row) { return row.unit; }), { filterId: 'unitFilter' });
  }

  function renderAudit() {
    const meta = state.meta || {};
    const rows = state.rows;
    const metrics = [
      ['Registros na planilha', meta.totalRecords || 0],
      ['Em unidades do cadastro', meta.mappedOfficial || 0],
      ['Fora do mapa SP', meta.outsideMap || 0],
      ['Cadastro a revisar', meta.reviewUnits || 0],
      ['Não é unidade', meta.nonUnit || 0],
      ['Sem unidade', meta.missingUnit || 0]
    ];
    byId('auditMetrics').innerHTML = metrics.map(function (item) {
      return '<div class="audit-metric"><strong>' + number(item[1]) + '</strong><span>' + escapeHtml(item[0]) + '</span></div>';
    }).join('');

    const count = function (key) { return rows.filter(QUALITY[key].test).length; };
    const otherList = Object.entries((meta.issues || {}).otherStatuses || {}).map(function (item) { return item[0] + ' (' + item[1] + ')'; }).join(', ');
    const reconciled = meta.unitReconciliation === meta.totalRecords && meta.totalRecords === rows.length;
    const items = [
      {
        level: reconciled ? 'ok' : 'error',
        text: reconciled ? 'Todos os ' + number(rows.length) + ' registros foram contabilizados uma única vez (a soma por unidade confere).'
          : 'A soma por unidade (' + number(meta.unitReconciliation) + ') não confere com o total (' + number(meta.totalRecords) + ').'
      },
      { key: 'fallback', many: 'registros sem Data de abertura válida — o período usa o Carimbo de data/hora.', one: 'registro sem Data de abertura válida — o período usa o Carimbo de data/hora.', ok: 'Todas as datas de abertura são válidas.' },
      { key: 'noDate', many: 'registros sem nenhuma data válida — não aparecem quando há filtro de período.', one: 'registro sem nenhuma data válida — não aparece quando há filtro de período.', ok: null },
      { key: 'atypical', many: 'registros com data no futuro ou com mais de 2 anos — conferir a digitação na planilha.', one: 'registro com data no futuro ou com mais de 2 anos — conferir a digitação na planilha.', ok: 'Nenhuma data atípica.' },
      { key: 'monthMismatch', many: 'registros com a coluna Mês diferente do mês da Data de abertura.', one: 'registro com a coluna Mês diferente do mês da Data de abertura.', ok: 'A coluna Mês confere com a Data de abertura.' },
      { key: 'noDays', many: 'aprovadas sem Dias preenchido — ficam fora do tempo de fechamento.', one: 'aprovada sem Dias preenchido — fica fora do tempo de fechamento.', ok: 'Todas as aprovadas têm Dias preenchido.' },
      { key: 'otherStatus', many: 'registros com status vazio ou não reconhecido' + (otherList ? ' (' + otherList + ')' : '') + ' — fora dos totais até serem classificados.', one: 'registro com status vazio ou não reconhecido' + (otherList ? ' (' + otherList + ')' : '') + ' — fora dos totais até ser classificado.', ok: 'Todos os status foram reconhecidos.' },
      { key: 'unitPending', many: 'registros com unidade fora do cadastro ou vazia — mantidos nos totais e marcados para revisão.', one: 'registro com unidade fora do cadastro ou vazia — mantido nos totais e marcado para revisão.', ok: 'Todas as unidades foram reconhecidas.' }
    ];
    byId('auditChecklist').innerHTML = items.map(function (item) {
      if (!item.key) {
        return '<li class="check ' + item.level + '"><span class="check-icon">' + (item.level === 'ok' ? '✓' : '!') + '</span><span>' + escapeHtml(item.text) + '</span></li>';
      }
      const total = count(item.key);
      if (!total) return item.ok ? '<li class="check ok"><span class="check-icon">✓</span><span>' + escapeHtml(item.ok) + '</span></li>' : '';
      return '<li class="check warn"><span class="check-icon">!</span><span><strong>' + number(total) + '</strong> ' + escapeHtml(total === 1 ? item.one : item.many) +
        '</span><button type="button" class="button secondary small" data-action="quality" data-value="' + item.key + '">Ver ' + (total === 1 ? 'registro' : 'registros') + '</button></li>';
    }).join('');

    const reasons = { 'outside-map': 'fora do mapa SP', review: 'cadastro a revisar', 'non-unit': 'não é unidade', missing: 'sem unidade' };
    const units = meta.unmappedUnits || [];
    byId('auditUnits').innerHTML = units.length ? units.map(function (item) {
      return '<button type="button" class="audit-chip" data-action="unit-view" data-value="' + escapeHtml(item.name) + '" title="Ver os registros desta unidade">' +
        '<strong>' + escapeHtml(item.name) + '</strong> · ' + plural(item.count, 'registro', 'registros') + ' · ' + (reasons[item.group] || item.group) + '</button>';
    }).join('') : '<span class="muted small-text">Nenhuma unidade pendente.</span>';
  }

  function recordsView(rows) {
    const query = normalizeText(state.search.trim());
    const filtered = query ? rows.filter(function (row) {
      return normalizeText([row.role, row.unit, row.status, row.shift, row.vacancyType, row.sourceRow, displayDate(row.periodDate)].join(' ')).indexOf(query) >= 0;
    }) : rows;
    const sort = state.recordSort;
    return filtered.slice().sort(function (a, b) {
      return compareValues(a[sort.key], b[sort.key], sort.dir) || b.sourceRow - a.sourceRow;
    });
  }

  function renderRecords(rows) {
    const view = recordsView(rows);
    state.recordsView = view;
    const shown = Math.min(view.length, state.recordLimit);
    byId('recordCount').textContent = (state.search.trim() ? number(view.length) + ' de ' + number(rows.length) + ' registros correspondem à busca' : plural(rows.length, 'registro', 'registros')) +
      ' · exibindo ' + number(shown);
    byId('recordsTable').innerHTML = view.length ? view.slice(0, shown).map(function (row) {
      const flags = rowFlags(row).map(function (key) {
        return '<span class="flag">' + escapeHtml(QUALITY[key].label) + '</span>';
      }).join('');
      const tagInfo = UNIT_TAGS[row.unitGroup];
      return '<tr><td class="num muted">' + number(row.sourceRow) + '</td><td>' + displayDate(row.periodDate) + '</td><td>' + displayDate(row.closingDate) +
        '</td><td>' + escapeHtml(row.role) + '</td><td>' + escapeHtml(row.unit) + (tagInfo ? '<span class="table-tag ' + tagInfo[1] + '">' + tagInfo[0] + '</span>' : '') +
        '</td><td>' + escapeHtml(row.shift) + '</td><td><span class="status-badge ' + statusClass(row.statusCategory) + '">' + escapeHtml(row.status) + '</span>' +
        '</td><td>' + escapeHtml(row.vacancyType) + '</td><td class="num">' + (row.days == null ? '—' : number(row.days)) +
        '</td><td class="num">' + (row.totalVivencias == null ? '—' : number(row.totalVivencias)) + '</td><td>' + flags + '</td></tr>';
    }).join('') : emptyRow(11, state.search.trim() ? 'Nenhum registro corresponde à busca.' : 'Sem registros para os filtros selecionados.');
    const remaining = view.length - shown;
    byId('recordsMore').innerHTML = remaining > 0 ? '<button type="button" class="button secondary small" data-action="more-records">Mostrar mais ' + number(Math.min(PAGE_SIZE, remaining)) + '</button>' +
      '<button type="button" class="button plain small" data-action="all-records">Mostrar todos (' + number(view.length) + ')</button>' : '';
    updateSortHeaders('sort-records', state.recordSort);
  }

  function render(options) {
    const opts = options || {};
    const currentSnap = getFilterSnapshot();
    if (!state.lastSnapshot) {
      state.lastSnapshot = currentSnap;
    } else if (!opts.skipHistory && !snapshotsEqual(state.lastSnapshot, currentSnap)) {
      state.filterHistory.push(state.lastSnapshot);
      state.lastSnapshot = currentSnap;
    }
    const criteria = readCriteria();
    const rows = filterRows(criteria);
    state.lastFiltered = rows;
    if (!opts.keepPage) state.recordLimit = PAGE_SIZE;
    const s = stats(rows);
    const cmp = comparison(criteria);
    renderFilterInfo(criteria, rows);
    renderMetrics(s, cmp);
    renderComposition(s);
    renderFunctionBars(rows);
    renderUnitTable(rows);
    renderTrend(rows);
    renderCancellations(rows);
    renderClosing(rows, s);
    renderExperiences(rows, s);
    renderRecords(rows);
    if (byId('specificModal').open) renderModalReport();
    writeUrlState();
  }

  /* ---------- sincronização ---------- */

  function renderSyncInfo() {
    const meta = state.meta || {};
    const sourceDate = meta.sourceTimestamp ? new Date(meta.sourceTimestamp) : null;
    const validDate = sourceDate && !Number.isNaN(sourceDate.getTime());
    const updated = byId('updatedAt');
    if (validDate) {
      updated.textContent = 'Leitura ' + relativeTime(sourceDate) + ' (' + sourceDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ')';
      updated.title = 'Horário informado pela fonte: ' + sourceDate.toLocaleString('pt-BR');
    } else {
      updated.textContent = state.rows.length ? 'Horário da fonte não informado' : '—';
      updated.title = '';
    }
    const modes = {
      ok: ['Dados atualizados', '', 'Conectado à planilha', 'ok'],
      stale: ['Dados possivelmente desatualizados', ' stale', 'Exibindo a última leitura válida', 'stale'],
      error: ['Sem conexão com a planilha', ' stale', 'Sem conexão com a planilha', 'error'],
      pending: ['Carregando', ' pending', 'Conectando à planilha', 'pending']
    };
    const mode = modes[state.syncMode] || modes.pending;
    byId('syncPill').textContent = mode[0];
    byId('syncPill').className = 'sync-pill' + mode[1];
    byId('sidebarStatus').textContent = mode[2];
    byId('statusDot').className = 'status-dot ' + mode[3];
    if (meta.sheetName) byId('footerSource').textContent = 'Fonte: ' + meta.sheetName;
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.nextRefreshAt = Date.now() + REFRESH_MS;
    state.refreshTimer = window.setTimeout(function () {
      if (!byId('appView').hidden) loadData(false);
    }, REFRESH_MS);
  }

  function computeCoverage() {
    const dates = state.rows.map(function (row) { return row.periodDate; }).filter(Boolean).sort();
    const skip = Math.ceil(dates.length * 0.01);
    state.coverageStart = dates.length ? dates[Math.min(skip, dates.length - 1)] : null;
  }

  async function loadData(force) {
    if (state.loading) return;
    state.loading = true;
    state.lastAttemptAt = Date.now();
    const button = byId('refreshBtn');
    button.disabled = true;
    button.textContent = 'Atualizando…';
    if (!state.rows.length) {
      state.syncMode = 'pending';
      byId('main').classList.add('is-loading');
      renderSyncInfo();
    }
    try {
      const response = await fetch('/api/data' + (force ? '?refresh=1' : ''), { cache: 'no-store' });
      if (response.status === 401) {
        showLogin('Sua sessão expirou. Entre novamente.');
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao consultar a planilha.');
      state.rows = Array.isArray(data.rows) ? data.rows : [];
      state.meta = data.meta || {};
      state.syncMode = data.stale ? 'stale' : 'ok';
      computeCoverage();
      populateFilters();
      render({ keepPage: true, skipHistory: true });
      renderAudit();
      setMessage(data.warning || '', data.stale ? 'warning' : '');
    } catch (error) {
      setMessage((error && error.message) || 'Não foi possível carregar os dados.', 'error');
      state.syncMode = state.rows.length ? 'stale' : 'error';
    } finally {
      state.loading = false;
      byId('main').classList.remove('is-loading');
      button.disabled = false;
      button.textContent = 'Atualizar';
      if (!byId('appView').hidden) scheduleRefresh();
      renderSyncInfo();
    }
  }

  /* ---------- sessão ---------- */

  function showLogin(message) {
    window.clearTimeout(state.refreshTimer);
    state.nextRefreshAt = null;
    byId('appView').hidden = true;
    byId('loginView').hidden = false;
    byId('loginMessage').textContent = message || '';
    byId('usernameInput').focus();
  }

  function showApp() {
    byId('loginView').hidden = true;
    byId('appView').hidden = false;
  }

  async function checkSession() {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      const data = await response.json();
      if (data.authenticated) {
        showApp();
        await loadData(false);
        return;
      }
    } catch (error) {
      showLogin('Não foi possível verificar o acesso. Confira se o servidor está em execução.');
      return;
    }
    showLogin();
  }

  async function submitLogin(event) {
    event.preventDefault();
    const button = byId('loginBtn');
    byId('loginMessage').textContent = '';
    button.disabled = true;
    button.textContent = 'Entrando…';
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: byId('usernameInput').value, password: byId('passwordInput').value })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Acesso negado.');
      byId('usernameInput').value = '';
      byId('passwordInput').value = '';
      showApp();
      await loadData(false);
    } catch (error) {
      byId('loginMessage').textContent = (error && error.message) || 'Não foi possível entrar.';
      byId('passwordInput').select();
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' }).catch(function () {});
    state.rows = [];
    state.meta = null;
    state.filterHistory = [];
    state.lastSnapshot = null;
    state.syncMode = 'pending';
    showLogin();
  }

  /* ---------- exportação e impressão ---------- */

  function exportCsv(useSpecific) {
    const rows = useSpecific ? (state.specificRows || []) : (state.recordsView || []);
    if (!rows.length) return;
    const groupLabel = { official: 'Cadastro oficial', 'outside-map': 'Fora do mapa SP', review: 'Cadastro a revisar', 'non-unit': 'Não é unidade', missing: 'Sem unidade' };
    const header = ['Linha da planilha', 'Data (período)', 'Origem da data', 'Fechamento', 'Função', 'Unidade', 'Grupo da unidade', 'Horário',
      'Status', 'Grupo do status', 'Tipo de vaga', 'Dias', 'Total Vivências', 'Observações'];
    const data = rows.map(function (row) {
      return [row.sourceRow, row.periodDate ? displayDate(row.periodDate) : '', row.dateSource === 'abertura' ? 'Data de abertura' : row.dateSource === 'carimbo' ? 'Carimbo de data/hora' : 'Sem data',
        row.closingDate ? displayDate(row.closingDate) : '', row.role, row.unit, groupLabel[row.unitGroup] || row.unitGroup, row.shift,
        row.status, STATUS_GROUP_LABELS[row.statusCategory === 'missing' ? 'other' : row.statusCategory] || '', row.vacancyType,
        row.days == null ? '' : String(row.days).replace('.', ','), row.totalVivencias == null ? '' : String(row.totalVivencias).replace('.', ','),
        rowFlags(row).map(function (key) { return QUALITY[key].label; }).join(' | ')];
    });
    const csvCell = function (value) {
      let safe = value == null ? '' : value;
      if (typeof safe === 'string' && ['=', '+', '@', '-'].indexOf(safe.trimStart().charAt(0)) >= 0) safe = "'" + safe;
      return '"' + String(safe).replace(/"/g, '""') + '"';
    };
    const content = '\uFEFF' + [header].concat(data).map(function (line) { return line.map(csvCell).join(';'); }).join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const from = useSpecific ? byId('spFrom').value : byId('dateFrom').value;
    const to = useSpecific ? byId('spTo').value : byId('dateTo').value;
    anchor.href = url;
    anchor.download = 'relatorio-vagas_' + (from || to ? (from || 'inicio') + '_a_' + (to || 'hoje') : 'todo-historico') + '.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function preparePrint() {
    const criteria = readCriteria();
    const chips = SELECT_FILTERS.filter(function (id) { return byId(id).value; }).map(function (id) {
      return FILTER_LABELS[id] + ': ' + filterValueLabel(id, byId(id).value);
    });
    if (state.quality) chips.push('Somente: ' + QUALITY[state.quality].label);
    byId('printContext').textContent = (periodText(criteria) || 'Período inválido') + (chips.length ? ' · ' + chips.join(' · ') : '') +
      ' · ' + plural(state.lastFiltered.length, 'registro', 'registros') + ' · Gerado em ' + new Date().toLocaleString('pt-BR');
  }

  async function copyReportText() {
    if (!state.specificSummaryText) return;
    try {
      await navigator.clipboard.writeText(state.specificSummaryText);
      flashButtonLabel(byId('copyReportTextBtn'), 'Resumo copiado ✓');
    } catch (error) {
      window.prompt('Copie o resumo abaixo:', state.specificSummaryText);
    }
  }

  /* ---------- navegação ---------- */

  function setActiveNav(id) {
    document.querySelectorAll('.nav-link').forEach(function (link) {
      const active = link.getAttribute('href') === '#' + id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function setupObservers() {
    if (!('IntersectionObserver' in window)) return;
    const spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) setActiveNav(entry.target.id); });
    }, { rootMargin: '-15% 0px -70% 0px' });
    SECTIONS.forEach(function (id) { spy.observe(byId(id)); });
  }

  function handleAction(event) {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const value = el.dataset.value;
    switch (el.dataset.action) {
      case 'filter': toggleSelect(el.dataset.filter, value); break;
      case 'status': toggleSelect('statusFilter', value); break;
      case 'month': setMonthFilter(value); break;
      case 'quality':
        resetFilters();
        state.quality = value;
        render();
        scrollToId('records');
        break;
      case 'unit-view':
        resetFilters();
        byId('unitFilter').value = value;
        render();
        scrollToId('records');
        break;
      case 'clear-filters':
        resetFilters();
        render({ skipHistory: true });
        break;
      case 'remove-filter':
        if (el.dataset.filter === 'quality') state.quality = '';
        else byId(el.dataset.filter).value = '';
        render();
        break;
      case 'expand':
        state.expanded[el.dataset.target] = !state.expanded[el.dataset.target];
        render({ keepPage: true, skipHistory: true });
        break;
      case 'sort-units': toggleSort(state.unitSort, el.dataset.key); render({ keepPage: true, skipHistory: true }); break;
      case 'sort-records': toggleSort(state.recordSort, el.dataset.key); renderRecords(state.lastFiltered); break;
      case 'more-records': state.recordLimit += PAGE_SIZE; renderRecords(state.lastFiltered); break;
      case 'all-records': state.recordLimit = Infinity; renderRecords(state.lastFiltered); break;
      case 'goto': scrollToId(el.dataset.target); break;
      case 'close-help': byId('helpDialog').close(); break;
      default: break;
    }
  }

  function toggleSort(sort, key) {
    const textKeys = ['name', 'role', 'unit', 'shift', 'status', 'vacancyType'];
    if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    else { sort.key = key; sort.dir = textKeys.indexOf(key) >= 0 ? 'asc' : 'desc'; }
  }

  const LOGO_DATA_URI = 'data:image/png;base64,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';
  function ensureLogoLoaded() {
    document.querySelectorAll('.brand-logo').forEach(function (img) {
      img.addEventListener('error', function () {
        if (img.src !== LOGO_DATA_URI) img.src = LOGO_DATA_URI;
      });
      if (img.complete && img.naturalWidth === 0) img.src = LOGO_DATA_URI;
    });
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.href = LOGO_DATA_URI;
  }

  function init() {
    ensureLogoLoaded();
    byId('loginForm').addEventListener('submit', submitLogin);
    byId('togglePassword').addEventListener('click', function () {
      const input = byId('passwordInput');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      this.textContent = show ? 'Ocultar' : 'Mostrar';
      this.setAttribute('aria-pressed', String(show));
      this.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      input.focus();
    });
    byId('backBtn').addEventListener('click', goBackStep);
    byId('toggleFiltersBtn').addEventListener('click', function () { toggleFiltersPanel(); });
    byId('refreshBtn').addEventListener('click', function () { loadData(true); });
    byId('exportBtn').addEventListener('click', function () { exportCsv(false); });
    byId('exportSpecificBtn').addEventListener('click', function () { exportCsv(true); });
    byId('printBtn').addEventListener('click', function () { preparePrint(); window.print(); });
    byId('copyReportTextBtn').addEventListener('click', copyReportText);

    // Painel médio centralizado de Relatório Específico
    byId('generateReportBtn').addEventListener('click', openSpecificModal);
    byId('modalClearBtn').addEventListener('click', resetModalFilters);
    byId('closeSpecificModalBtn').addEventListener('click', function () { byId('specificModal').close(); });
    byId('specificModal').addEventListener('click', function (event) { if (event.target === this) this.close(); });
    byId('spPreset').addEventListener('change', function () {
      applyModalPreset(byId('spPreset').value);
      renderModalReport();
    });
    ['spFrom', 'spTo'].forEach(function (id) {
      byId(id).addEventListener('change', function () {
        byId('spPreset').value = 'custom';
        renderModalReport();
      });
    });
    ['spFocus', 'spRole', 'spUnit', 'spType', 'spShift'].forEach(function (id) {
      byId(id).addEventListener('change', renderModalReport);
    });

    byId('helpBtn').addEventListener('click', function () { byId('helpDialog').showModal(); });
    byId('helpDialog').addEventListener('click', function (event) { if (event.target === this) this.close(); });
    byId('logoutBtn').addEventListener('click', logout);

    // Botões vermelhos de Limpar Filtros (aba de filtros + barra lateral esquerda)
    byId('clearFilters').addEventListener('click', function () {
      resetFilters();
      render({ skipHistory: true });
    });
    byId('sidebarClearBtn').addEventListener('click', function () {
      resetFilters();
      render({ skipHistory: true });
    });

    byId('periodPreset').addEventListener('change', function () {
      state.periodBeforeMonth = null;
      applyDatePreset(byId('periodPreset').value);
      render();
    });
    ['dateFrom', 'dateTo'].forEach(function (id) {
      byId(id).addEventListener('change', function () {
        byId('periodPreset').value = 'custom';
        state.periodBeforeMonth = null;
        render();
      });
    });
    SELECT_FILTERS.forEach(function (id) { byId(id).addEventListener('change', function () { render(); }); });
    let searchTimer = null;
    byId('recordSearch').addEventListener('input', function () {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () {
        state.search = byId('recordSearch').value;
        state.recordLimit = PAGE_SIZE;
        renderRecords(state.lastFiltered);
      }, 150);
    });
    document.addEventListener('click', handleAction);
    window.addEventListener('beforeprint', preparePrint);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !byId('appView').hidden && Date.now() - state.lastAttemptAt > REFRESH_MS) loadData(false);
    });
    window.setInterval(function () { if (!byId('appView').hidden) renderSyncInfo(); }, 30000);

    readUrlState();
    setupObservers();
    checkSession();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

