import test from 'node:test';
import assert from 'node:assert/strict';
import { readingVoices } from '../../../src/mobile/readingVoices.ts';
import { LocalReadAloud, readingVoices as serviceVoices } from '../local-read-aloud.mjs';
test('exact fixed voices and strict synthesis inputs', async () => {
  assert.deepEqual(readingVoices, serviceVoices);
  assert.deepEqual(readingVoices.map(voice => voice.id), ['am_michael', 'bf_emma', 'pf_dora', 'pm_alex', 'pm_santa']);
  const speech = new LocalReadAloud('missing-model-fixture');
  await assert.rejects(speech.synthesize('phone', { voice: 'local-au', text: 'hello' }), error => error.status === 400);
  await assert.rejects(speech.synthesize('phone', { voice: 'am_michael', text: 'x'.repeat(2001) }), error => error.status === 400);
  for (const voice of readingVoices) {
    await assert.rejects(speech.synthesize('phone', { voice: voice.id, text: 'Olá' }), error => error.status === 503);
  }
  speech.close();
});
