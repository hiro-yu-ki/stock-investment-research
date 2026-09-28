import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCSV, parseCSV, periodReturn } from '../src/analysis.js';

test('quoted CSV, duplicate dates and invalid observations are audited', () => {
  const input='date,code,name,close,adjusted_close\n2025-01-02,1234,"A, B",100,100\n2025-01-02,1234,"A, B",101,101\n2025-02-03,1234,"A, B",110,110\n2025-02-04,1234,"A, B",-1,1\n';
  assert.equal(parseCSV(input)[1][2], 'A, B');
  const report=auditCSV(input, new Date('2025-03-01T00:00:00Z'));
  assert.equal(report.rowCount, 2);
  assert.equal(report.issues.duplicate, 1);
  assert.equal(report.issues.invalidPrice, 1);
  assert.equal(report.stocks[0].name, 'A, B');
});

test('period return requires an observation close to the target month', () => {
  const rows=[{date:'2025-01-31',close:100,adjusted:100},{date:'2025-02-28',close:110,adjusted:110}];
  assert.ok(Math.abs(periodReturn(rows,1).value-.1)<1e-9);
  assert.equal(periodReturn(rows,3), null);
});
