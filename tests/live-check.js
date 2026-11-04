'use strict';
const source = require('../lib/source');
source.getDataset(true).then(function (result) {
  const meta = result.dataset.meta;
  console.log(JSON.stringify({
    status: result.stale ? 'STALE' : 'OK',
    timestamp: meta.sourceTimestamp,
    totalRecords: meta.totalRecords,
    mappedOfficial: meta.mappedOfficial,
    outsideMap: meta.outsideMap,
    reviewUnits: meta.reviewUnits,
    nonUnit: meta.nonUnit,
    missingUnit: meta.missingUnit,
    unitReconciliation: meta.unitReconciliation,
    unmappedUnits: meta.unmappedUnits,
    issues: meta.issues
  }, null, 2));
}).catch(function (error) {
  console.error('Falha no teste de conexão:', error.message);
  process.exitCode = 1;
});
