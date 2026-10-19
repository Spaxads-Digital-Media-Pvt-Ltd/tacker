// Conversion Imports CSV parsing (lib/csvImport.ts) — imports the real module.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { parseCsv, parseCsvRecords } from '../csvImport.ts';

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    assert.deepStrictEqual(parseCsv('transactionId,payout,revenue\ntxn-1,5.00,10.00\ntxn-2,1,2'), [
      { transactionId: 'txn-1', payout: '5.00', revenue: '10.00' },
      { transactionId: 'txn-2', payout: '1', revenue: '2' },
    ]);
  });

  it('strips a UTF-8 BOM so the first header is clean (Excel "CSV UTF-8")', () => {
    const rows = parseCsv('\uFEFFtransactionId,payout\r\ntxn-1,5');
    assert.deepStrictEqual(rows, [{ transactionId: 'txn-1', payout: '5' }]);
    assert.ok(!Object.keys(rows[0]!)[0]!.startsWith('\uFEFF'));
  });

  it('handles CRLF, LF and lone CR record endings', () => {
    assert.deepStrictEqual(parseCsv('a,b\r\n1,2\n3,4\r5,6\r\n'), [
      { a: '1', b: '2' }, { a: '3', b: '4' }, { a: '5', b: '6' },
    ]);
  });

  it('unescapes "" inside quoted fields', () => {
    assert.deepStrictEqual(parseCsv('id,note\n1,"say ""hi"""'), [{ id: '1', note: 'say "hi"' }]);
  });

  it('keeps commas and line breaks inside quoted fields', () => {
    assert.deepStrictEqual(parseCsv('id,note,x\n1,"a, b","line1\r\nline2"\n2,c,d'), [
      { id: '1', note: 'a, b', x: 'line1\r\nline2' },
      { id: '2', note: 'c', x: 'd' },
    ]);
  });

  it('an empty quoted field is an empty value', () => {
    assert.deepStrictEqual(parseCsv('a,b,c\n"",x,""'), [{ a: '', b: 'x', c: '' }]);
  });

  it('trims header names and values; spaces before an opening quote are ignored', () => {
    assert.deepStrictEqual(parseCsv(' transactionId , payout \n txn-1 , "5.00" '), [{ transactionId: 'txn-1', payout: '5.00' }]);
  });

  it('skips completely blank lines (incl. Excel trailing ",,,") anywhere', () => {
    assert.deepStrictEqual(parseCsv('\n\na,b\n\n1,2\n   \n,,\n3,4\n\n'), [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('missing trailing cells become empty, extra cells are dropped, empty header names ignored', () => {
    assert.deepStrictEqual(parseCsv('a,b,,c\n1\n1,2,3,4,5'), [
      { a: '1', b: '', c: '' },
      { a: '1', b: '2', c: '4' },
    ]);
  });

  it('header only / empty input → no rows', () => {
    assert.deepStrictEqual(parseCsv('a,b'), []);
    assert.deepStrictEqual(parseCsv(''), []);
    assert.deepStrictEqual(parseCsv('\uFEFF'), []);
  });

  it('an unterminated quote runs to the end instead of dropping text', () => {
    assert.deepStrictEqual(parseCsv('a,b\n1,"open, never closed\nstill here'), [{ a: '1', b: 'open, never closed\nstill here' }]);
  });
});

describe('parseCsvRecords', () => {
  it('returns raw fields, with no trailing empty record for a final newline', () => {
    assert.deepStrictEqual(parseCsvRecords('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  });
  it('a trailing comma is an extra empty field', () => {
    assert.deepStrictEqual(parseCsvRecords('a,'), [['a', '']]);
  });
});
