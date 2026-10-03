import assert from 'node:assert/strict';
import test from 'node:test';
import type { Issuer } from './models.js';
import { normalize, scoreIssuer } from './issuer-matcher.js';

const bankIssuer = {
  uuid: '11111111-1111-4111-8111-111111111111',
  name: 'Deutsche Bank AG',
  address: null,
  zipCode: null,
  city: null,
  country: null,
  custom: {},
  folderUuid: null,
} as Issuer;

test('does not assign a bank found only in payment details', () => {
  const text = normalize(`
    Rechnung für die Wartung Ihrer Klimaanlage
    Vielen Dank für Ihren Auftrag.

    Bankverbindung: Deutsche Bank AG
    IBAN DE12 3456 7890 1234 5678 90
    BIC DEUTDEFFXXX
  `);

  assert.equal(scoreIssuer(bankIssuer, text), null);
});

test('accepts an issuer identified in the document header', () => {
  const text = normalize(`
    Deutsche Bank AG
    Privatkundenbereich
    Kontoauszug
  `);

  assert.equal(scoreIssuer(bankIssuer, text)?.issuer.uuid, bankIssuer.uuid);
});
