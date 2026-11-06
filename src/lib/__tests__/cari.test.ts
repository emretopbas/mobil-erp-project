// Cari yön kuralı (lib/cari.ts) — kullanıcının işlem→taraf tablosu.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alreadyVoidedMovementIds, balanceLabel, balanceSide, formatCari, signedCari, weOwe } from '../cari.ts';

test('signedCari: Borç artı, Alacak eksi', () => {
  assert.equal(signedCari('borc', 500), 500);
  assert.equal(signedCari('alacak', 500), -500);
});

test('tedarikçiden alım (Alacak) + ödeme (Borç) → kalan Alacak bakiye, sen borçlusun', () => {
  // 140 alım (alacak), 40 ödeme (borç) → −100
  const bakiye = signedCari('alacak', 14000) + signedCari('borc', 4000);
  assert.equal(bakiye, -10000);
  assert.equal(balanceSide(bakiye), 'alacak');
  assert.equal(balanceLabel(bakiye), 'Alacak');
  assert.equal(weOwe(bakiye), true);
});

test('fazla ödeme tedarikçide Borç bakiyeye döner (hesap sana borçlu)', () => {
  const bakiye = signedCari('alacak', 10000) + signedCari('borc', 12000);
  assert.equal(bakiye, 2000);
  assert.equal(balanceSide(bakiye), 'borc');
  assert.equal(weOwe(bakiye), false);
});

test('müşteri: vadeli satış Borç bakiye → müşteri sana borçlu', () => {
  const bakiye = signedCari('borc', 30000) + signedCari('alacak', 5000);
  assert.equal(bakiye, 25000);
  assert.equal(weOwe(bakiye), false);
  assert.equal(weOwe(0), false);
});

test('formatCari: her zaman işaretli, sıfır işaretsiz', () => {
  assert.equal(formatCari(14000, 'USD'), '+140,00 USD');
  assert.equal(formatCari(-14000, 'USD'), '−140,00 USD');
  assert.equal(formatCari(0, 'USD'), '0,00 USD');
  assert.equal(balanceLabel(0), 'Kapalı');
  assert.equal(balanceSide(0), null);
});

test('alreadyVoidedMovementIds: bir hareketi işaret eden reverses_id onu "silindi" sayar (bug fix: stale "Sil" düğmesi)', () => {
  const original = { id: 'm1', reverses_id: null };
  const unrelated = { id: 'm2', reverses_id: null };
  const reversal = { id: 'm3', reverses_id: 'm1' };
  assert.deepEqual([...alreadyVoidedMovementIds([original, unrelated, reversal])], ['m1']);
  assert.deepEqual([...alreadyVoidedMovementIds([original, unrelated])], []);
  assert.deepEqual([...alreadyVoidedMovementIds([])], []);
});
