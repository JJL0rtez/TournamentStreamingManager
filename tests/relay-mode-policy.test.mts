import test from 'node:test';
import assert from 'node:assert/strict';
import { productionRelayAllowed, productionRelayError } from '../apps/node-service/src/relay-mode-policy.ts';
test('production capture can enter production relay', () => assert.equal(productionRelayAllowed({outputMode:'production'}),true));
test('legacy capture can enter production relay', () => assert.equal(productionRelayAllowed({}),true));
test('diagnostic capture cannot enter production relay', () => assert.match(productionRelayError({outputMode:'diagnostic'})!,/Diagnostic capture/));
test('missing capture cannot enter production relay', () => assert.equal(productionRelayAllowed(null),false));
