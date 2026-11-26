import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { defaultUiLanguage, isUiLanguage, resolveUiLanguage, uiLanguageOptions, uiLanguages } from '../language.mjs';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function readCatalog(relativePath) {
  const filePath = path.join(root, relativePath);
  const source = await readFile(filePath, 'utf8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const entries = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      let expr = node.initializer;
      while (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isParenthesizedExpression(expr)) expr = expr.expression;
      if (ts.isObjectLiteralExpression(expr)) {
        for (const prop of expr.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const key = ts.isStringLiteral(prop.name) || ts.isNoSubstitutionTemplateLiteral(prop.name)
              ? prop.name.text
              : ts.isIdentifier(prop.name) ? prop.name.text : null;
            const val = ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)
              ? prop.initializer.text : null;
            if (key !== null && val !== null) entries[key] = val;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return entries;
}

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('uiLanguage resolver defaults to English and rejects invalid values', () => {
  assert.equal(defaultUiLanguage, 'en');
  assert.deepEqual(uiLanguages, ['en', 'pt-BR']);
  assert.deepEqual(uiLanguageOptions.map(item => item.id), ['en', 'pt-BR']);
  assert.equal(isUiLanguage('en'), true);
  assert.equal(isUiLanguage('pt-BR'), true);
  assert.equal(isUiLanguage('pt'), false);
  assert.equal(isUiLanguage('fr'), false);
  assert.equal(isUiLanguage('__proto__'), false);
  assert.equal(isUiLanguage(null), false);
  assert.equal(resolveUiLanguage('pt-BR'), 'pt-BR');
  assert.equal(resolveUiLanguage('en'), 'en');
  assert.equal(resolveUiLanguage('invalid'), 'en');
  assert.equal(resolveUiLanguage(undefined), 'en');
  assert.equal(resolveUiLanguage(123), 'en');
});

test('EN and PT-BR catalogs have exact key parity, placeholders, brand preservation, and real translation coverage', async () => {
  const en = await readCatalog('src/lib/i18n/en.ts');
  const ptBR = await readCatalog('src/lib/i18n/pt-BR.ts');
  const enKeys = Object.keys(en).sort();
  const ptKeys = Object.keys(ptBR).sort();

  assert.ok(enKeys.length > 400, `Expected full UI catalog, found ${enKeys.length} keys`);
  assert.deepEqual(ptKeys, enKeys, 'EN and PT-BR catalogs must have the exact same keys');

  let translated = 0;
  for (const key of enKeys) {
    assert.ok(en[key].length > 0, `Empty EN string for ${key}`);
    assert.ok(ptBR[key].length > 0, `Empty PT-BR string for ${key}`);
    assert.deepEqual(placeholders(ptBR[key]), placeholders(en[key]), `Placeholder mismatch for key "${key}"`);
    if (ptBR[key] !== en[key]) translated++;
  }

  // Brand names stay intact in both languages.
  assert.equal(en['brand.name'], 'Bento Workspace');
  assert.equal(ptBR['brand.name'], 'Bento Workspace');
  assert.equal(en['brand.network'], 'Rede Bento');
  assert.equal(ptBR['brand.network'], 'Rede Bento');
  assert.ok(ptBR['brand.chatsTitle'].includes('Bento Workspace'));
  assert.ok(ptBR['brand.mobileTitle'].includes('Bento Workspace'));

  // At least 90% of catalog strings are translated (remaining ~5-10% are brand/proper nouns like Codex, MCP, PDF, Status, Prompt).
  const ratio = translated / enKeys.length;
  assert.ok(ratio >= 0.9, `Expected >= 90% translated strings, got ${(ratio * 100).toFixed(1)}% (${translated}/${enKeys.length})`);
});

test('service persists uiLanguage non-destructively across restarts without altering voice settings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-i18n-svc-'));
  await mkdir(path.join(repo, 'workspace'), { recursive: true });
  await mkdir(path.join(repo, '.mrmak'), { recursive: true });
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities: [] }));
  const settingsFile = path.join(repo, '.mrmak', 'settings.json');
  await writeFile(settingsFile, JSON.stringify({
    voiceName: 'marin',
    voiceStyle: 'custom-note',
    transcribeProvider: 'local',
    defaultAgent: 'codex',
  }, null, 2));

  const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
  let service = await createService({ repo, uiDir: path.join(root, 'dist'), mobileOptions: { transport }, mcpOptions: { home: repo, env: {} } });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${service.token}` };
  try {
    // Defaults to English when uiLanguage is absent.
    const initial = await fetch(`${service.origin}/api/bootstrap`, { headers }).then(r => r.json());
    assert.equal(initial.settings.uiLanguage, 'en');
    assert.equal(initial.settings.voiceName, 'marin');

    // Ignores unsupported language values without mutating settings (consistent with theme settings).
    const invalid = await fetch(`${service.origin}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ uiLanguage: 'es-ES' }) });
    assert.equal(invalid.status, 200);
    const afterInvalid = await invalid.json();
    assert.equal(afterInvalid.uiLanguage, 'en');

    // Switches to pt-BR and preserves voice/other settings verbatim.
    const switched = await fetch(`${service.origin}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ uiLanguage: 'pt-BR' }) });
    assert.equal(switched.status, 200);
    const saved = JSON.parse(await readFile(settingsFile, 'utf8'));
    assert.equal(saved.uiLanguage, 'pt-BR');
    assert.equal(saved.voiceName, 'marin');
    assert.equal(saved.voiceStyle, 'custom-note');
    assert.equal(saved.transcribeProvider, 'local');
    assert.equal(saved.defaultAgent, 'codex');

    // Pairs a phone in isolation and tests /mobile/api/bootstrap + /mobile/api/language sync.
    await fetch(`${service.origin}/api/mobile/enable`, { method: 'POST', headers, body: '{}' });
    const pairing = await fetch(`${service.origin}/api/mobile/pair`, { method: 'POST', headers, body: '{}' }).then(r => r.json());
    const mobileOrigin = new URL(pairing.url).origin;
    const token = new URLSearchParams(new URL(pairing.url).hash.slice(1)).get('pair');
    const claim = await fetch(`${mobileOrigin}/mobile/api/pair`, {
      method: 'POST',
      headers: { Origin: mobileOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name: 'Test phone' }),
    }).then(r => r.json());
    await fetch(`${service.origin}/api/mobile/approve`, { method: 'POST', headers, body: JSON.stringify({ id: claim.id }) });
    const finished = await fetch(`${mobileOrigin}/mobile/api/pair/finish`, {
      method: 'POST',
      headers: { Origin: mobileOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(claim),
    });
    const cookie = finished.headers.get('set-cookie')?.split(';')[0] || '';
    assert.ok(cookie.length > 0, 'Expected mobile session cookie');

    const bootstrapPt = await fetch(`${mobileOrigin}/mobile/api/bootstrap`, { headers: { Cookie: cookie } }).then(r => r.json());
    assert.equal(bootstrapPt.uiLanguage, 'pt-BR');

    // Phone rejects invalid language.
    const mobileBad = await fetch(`${mobileOrigin}/mobile/api/language`, {
      method: 'POST',
      headers: { Origin: mobileOrigin, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ language: 'de-DE' }),
    });
    assert.equal(mobileBad.status, 400);

    // Phone switches back to en; desktop settings persist 'en'.
    const mobileEn = await fetch(`${mobileOrigin}/mobile/api/language`, {
      method: 'POST',
      headers: { Origin: mobileOrigin, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ language: 'en' }),
    });
    assert.equal(mobileEn.status, 200);
    const afterMobile = JSON.parse(await readFile(settingsFile, 'utf8'));
    assert.equal(afterMobile.uiLanguage, 'en');
    assert.equal(afterMobile.voiceName, 'marin');

    // Switch back to pt-BR and restart the service to prove disk persistence across restarts.
    await fetch(`${service.origin}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ uiLanguage: 'pt-BR' }) });
    await service.close();
    service = null;

    service = await createService({ repo, uiDir: path.join(root, 'dist'), mobileOptions: { transport }, mcpOptions: { home: repo, env: {} } });
    const restarted = await fetch(`${service.origin}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${service.token}` },
    }).then(r => r.json());
    assert.equal(restarted.settings.uiLanguage, 'pt-BR');
    assert.equal(restarted.settings.voiceName, 'marin');
    assert.equal(restarted.settings.transcribeProvider, 'local');
  } finally {
    await service?.close();
    await rm(repo, { recursive: true, force: true }).catch(() => {});
  }
});
