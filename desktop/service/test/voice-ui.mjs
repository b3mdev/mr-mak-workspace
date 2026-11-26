// No microphone, paid model request, native terminal or personal workspace is used.
import assert from 'node:assert/strict';
import { copyFile, cp, mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';
import { addNotificationChat, permission } from './notification-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/voice-ui-'));
await mkdir(path.join(repo, 'workspace'));
const uiDir = path.join(repo, 'ui');
await cp(path.join(root, 'dist'), uiDir, { recursive: true });
for (const name of ['bento-icon-32.png', 'bento-icon-192.png', 'bento-chats-32.png', 'bento-chats-192.png']) await copyFile(path.join(root, 'public/assets', name), path.join(uiDir, 'assets', name)).catch(() => {});
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
let externalEvents = [], refreshExternal = () => {};
const external = { id: 'synthetic-planner', enabled: true, snapshot: () => externalEvents,
  subscribe(refresh) { refreshExternal = refresh; return () => {}; } };
const service = await createService({ repo, uiDir, mcpOptions: { home: repo, env: {} }, notificationSources: [external] });
const requests = [];
let fail = false;
let stalled;
service.coordinator.ask = async data => {
  requests.push(data);
  const hanging = stalled && data.text === 'Stalled draft';
  if (hanging) {
    stalled.resolve();
    await new Promise(resolve => service.coordinator.run.signal.addEventListener('abort', resolve, { once: true }));
  }
  const result = fail ? 'Fixture request failed. Please retry.' : data.text === 'Long voice result' ? 'São Paulo 🐷 日本語 '.repeat(1000) : 'Fixture completed.';
  const operation = { ...data, at: new Date().toISOString(), status: hanging ? 'interrupted' : fail ? 'failed' : 'completed', result };
  service.coordinator.operations.set(data.id, operation);
  service.coordinator.emit('result', operation);
  return operation;
};
service.quick.ask = async () => null;
const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvWQAAAAASUVORK5CYII=';
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 650, height: 800 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.fixtureMicRequests = 0;
    window.fixtureVoiceMode = 'deny';
    window.fixtureVoice = { track: null, channel: null, sent: [], emit(event) { this.channel?.onmessage?.({ data: JSON.stringify(event) }); } };
    // Patch the prototype: WebKit ignores an own-property override on navigator.mediaDevices.
    MediaDevices.prototype.getUserMedia = async () => {
      window.fixtureMicRequests++;
      if (window.fixtureVoiceMode === 'deny') throw new DOMException('Permission denied', 'NotAllowedError');
      const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
      window.fixtureVoice.track = track;
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    };
    window.RTCPeerConnection = class FixturePeer {
      constructor() {
        this.iceGatheringState = 'complete';
        this.connectionState = 'new';
        this.localDescription = null;
        this.remoteDescription = null;
      }
      addTrack() {}
      addEventListener() {}
      removeEventListener() {}
      createDataChannel() {
        const channel = {
          readyState: 'open',
          onmessage: null,
          onclose: null,
          send(raw) { window.fixtureVoice.sent.push(JSON.parse(raw)); },
          close() { this.readyState = 'closed'; },
        };
        window.fixtureVoice.channel = channel;
        return channel;
      }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
      async setLocalDescription(desc) { this.localDescription = desc; }
      async setRemoteDescription(desc) { this.remoteDescription = desc; this.connectionState = 'connected'; }
      close() { this.connectionState = 'closed'; }
    };
  });
  await page.route('**/api/live/session', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ session: { id: 'fixture-live-session' }, transport: { sdp: 'v=0\r\nanswer' } }),
  }));
  for (const surface of ['chats', 'workspace']) {
    await page.goto(service.urls[surface]);
    const dock = page.locator('.voice-dock');
    const earBadge = page.locator('.voice-nose .voice-ear-badge');
    assert.equal(await dock.getAttribute('data-voice-status'), 'off');
    assert.equal(await earBadge.count(), 0);
    await page.screenshot({ path: path.join(repo, `idle-${surface}.png`) });
    await page.getByRole('button', { name: 'Start voice', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Permission denied' }).waitFor();
    assert.equal(await earBadge.count(), 0);
    await page.getByRole('button', { name: 'Dismiss voice error' }).click();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureMicRequests), 1);

    // Full listening indicator lifecycle: connecting -> cancel -> connecting -> live (ear visible) -> closing (ear gone) -> off.
    await page.evaluate(() => { window.fixtureVoiceMode = 'allow'; window.fixtureVoice.sent = []; });
    await page.getByRole('button', { name: 'Start voice', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.voice-dock')?.getAttribute('data-voice-status') === 'connecting');
    assert.equal(await earBadge.count(), 0);
    await page.getByRole('button', { name: 'Stop voice', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.voice-dock')?.getAttribute('data-voice-status') === 'off');
    assert.equal(await earBadge.count(), 0);

    await page.getByRole('button', { name: 'Start voice', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.fixtureVoice.channel && document.querySelector('.voice-dock')?.getAttribute('data-voice-status') === 'connecting'));
    await page.evaluate(() => window.fixtureVoice.emit({ type: 'session.started' }));
    await page.waitForFunction(() => document.querySelector('.voice-dock')?.getAttribute('data-voice-status') === 'live');
    await earBadge.waitFor({ state: 'visible' });
    assert.equal(await page.locator('.voice-panel .voice-status-listening .voice-ear-svg').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Stop voice', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => {
      const box = document.querySelector('.voice-nose .voice-ear-badge')?.getBoundingClientRect();
      return Boolean(box && box.width >= 19 && box.height >= 19);
    });
    const badgeBox = await earBadge.boundingBox();
    assert.ok(badgeBox && badgeBox.width >= 19 && badgeBox.height >= 19, `Expected visible ear badge on ${surface}, got ${JSON.stringify(badgeBox)}`);
    await page.screenshot({ path: path.join(repo, `listening-${surface}.png`) });

    // Ear badge stays visible on the Talk to Bento icon even when the panel is hidden.
    await page.getByRole('button', { name: 'Toggle conversation' }).click();
    assert.equal(await earBadge.isVisible(), true);
    await page.screenshot({ path: path.join(repo, `listening-${surface}-collapsed.png`) });
    if (surface === 'chats') {
      await page.setViewportSize({ width: 390, height: 800 });
      const fit = await page.evaluate(() => {
        const brand = document.querySelector('.chats-brand')?.getBoundingClientRect();
        const nose = document.querySelector('.voice-nose')?.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > window.innerWidth, gap: brand && nose ? nose.left - brand.right : 0 };
      });
      assert.equal(fit.overflow, false, 'Chats 390px listening state must not overflow horizontally');
      assert.ok(fit.gap >= 4, `Expected clearance between brand and Talk to Bento on 390px Chats, got ${fit.gap}px`);
      await page.setViewportSize({ width: 650, height: 800 });
    }
    await page.getByRole('button', { name: 'Toggle conversation' }).click();

    // Clicking to stop immediately stops the listening ear icon and mutes the mic.
    await page.getByRole('button', { name: 'Stop voice', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.voice-dock')?.getAttribute('data-voice-status') === 'closing');
    assert.equal(await earBadge.count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureVoice.track?.enabled), false);
    assert.ok(await page.evaluate(() => window.fixtureVoice.sent.some(item => item.type === 'session.close')));
    await page.evaluate(() => window.fixtureVoice.emit({ type: 'session.closed' }));
    await page.waitForFunction(() => document.querySelector('.voice-dock')?.getAttribute('data-voice-status') === 'off');
    assert.equal(await earBadge.count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Start voice', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => { window.fixtureMicRequests = 0; });
    const input = page.getByRole('textbox', { name: 'Message Bento Workspace' });
    const before = requests.length;
    await input.fill('First line'); await input.press('Shift+Enter'); await input.pressSequentially('Second line');
    assert.equal(await input.inputValue(), 'First line\nSecond line'); assert.equal(requests.length, before);
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    assert.equal(requests.length, before);
    await page.getByRole('button', { name: 'Toggle conversation' }).click();
    await page.getByRole('button', { name: 'Toggle conversation' }).click();
    assert.equal(await input.inputValue(), 'First line\nSecond line');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('.voice-compose textarea')?.value === '');
    assert.equal(requests.at(-1).text, 'First line\nSecond line'); assert.equal(requests.length, before + 1);

    await input.fill('Review this screenshot');
    await input.evaluate((element, encoded) => {
      const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
      const clipboardData = new DataTransfer(); clipboardData.items.add(new File([bytes], 'Screenshot.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }, imageBase64);
    const attached = page.getByLabel('Attached images', { exact: true });
    await attached.locator('img').waitFor();
    await page.waitForFunction(() => !document.querySelector('.voice-compose button[type=submit]').disabled);
    await attached.getByRole('link').click(); await page.getByRole('dialog', { name: 'Image preview' }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.screenshot({ path: path.join(repo, `composer-${surface}.png`) });
    fail = true;
    await input.press('Enter');
    await page.getByRole('alert').filter({ hasText: 'Fixture request failed' }).waitFor();
    assert.equal(await input.inputValue(), 'Review this screenshot'); assert.equal(await attached.locator('img').count(), 1);
    await page.getByRole('button', { name: 'Dismiss message error' }).click();
    fail = false; await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('.voice-compose textarea')?.value === '');
    assert.equal(await attached.count(), 0);
    assert.equal(requests.at(-1).images.length, 1);
    const saved = requests.at(-1).images[0];
    assert.ok(saved.startsWith(path.join(repo, 'inbox/attachments') + path.sep));
    assert.deepEqual(await readFile(saved), Buffer.from(imageBase64, 'base64'));
    await page.getByLabel('Sent images', { exact: true }).last().locator('img').waitFor();

    await page.locator('input[type=file][aria-label="Choose images for Bento Workspace"]').setInputFiles({ name: 'Reference.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64') });
    await attached.locator('img').waitFor();
    await attached.getByRole('button', { name: /^Remove / }).click();
    assert.equal(await attached.count(), 0);
  }
  const input = page.getByRole('textbox', { name: 'Message Bento Workspace' });
  stalled = Promise.withResolvers();
  await input.fill('Stalled draft'); await input.press('Enter');
  await stalled.promise;
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
  await page.getByText('Coordinator stopped.', { exact: false }).waitFor();
  await input.waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), 'Stalled draft');
  assert.equal(await input.isEnabled(), true);
  stalled = null;

  await page.getByRole('button', { name: 'Start voice', exact: true }).click();
  await page.waitForFunction(() => window.fixtureVoice.channel?.readyState === 'open');
  await page.evaluate(() => {
    window.fixtureVoice.sent = [];
    window.fixtureVoice.emit({ type: 'session.started' });
    window.fixtureVoice.emit({ type: 'session.input_transcript.delta', delta: 'Long voice result' });
    window.fixtureVoice.emit({ type: 'session.delegation.created', delegation: { id: 'large-result' } });
  });
  await page.waitForFunction(() => window.fixtureVoice.sent.some(item => item.type === 'session.commentary.append' && item.delegation_id === 'large-result'));
  const appends = await page.evaluate(() => window.fixtureVoice.sent.filter(item => item.type.endsWith('.append')).map(item => ({ bytes: new TextEncoder().encode(item.content).length, text: item.content })));
  assert.ok(appends.every(item => item.bytes <= 400));
  assert.ok(appends.some(item => item.text.startsWith('completed: São Paulo') && item.text.endsWith('…')));

  await page.getByRole('button', { name: 'Reset context', exact: true }).click();
  await page.getByText('Context reset.', { exact: false }).waitFor();
  assert.equal(await page.locator('.voice-dock').getAttribute('data-voice-status'), 'off');
  assert.equal(await page.evaluate(() => window.fixtureVoice.track.stopped), true);
  assert.equal(await page.locator('.mak-exchange').filter({ hasText: 'Review this screenshot' }).count() > 0, true);

  await page.getByRole('button', { name: 'Local context', exact: true }).click();
  await page.getByRole('heading', { name: 'Computer', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'User profile', exact: true }).waitFor();
  await page.screenshot({ path: path.join(repo, 'local-context.png') });

  const chats = await browser.newPage();
  chats.setDefaultTimeout(10000);
  chats.on('pageerror', error => errors.push(error.message));
  await chats.goto(service.urls.chats);
  await chats.getByRole('button', { name: 'Toggle conversation' }).click();
  assert.ok(await chats.locator('.mak-exchange').count());
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByText('New conversation ready.').waitFor();
  await chats.locator('.mak-exchange').first().waitFor({ state: 'detached' });
  assert.equal(await page.locator('.mak-exchange').count(), 0);
  assert.equal(await input.inputValue(), '');
  assert.equal(await page.locator('.previous-voice').count(), 0);

  // Keep one Live connection open while text and speech route two replies.
  const a = await addNotificationChat(service, 'codex', 'Atlas Colors');
  const b = await addNotificationChat(service, 'claude', 'Atlas Layout');
  await page.getByRole('button', { name: 'Start voice', exact: true }).click();
  await page.waitForFunction(() => window.fixtureVoice.channel?.readyState === 'open');
  await page.evaluate(() => {
    window.fixtureVoice.sent = [];
    window.fixtureVoice.emit({ type: 'session.started' });
  });
  const token = new URL(service.urls.workspace).searchParams.get('token');
  const bootstrap = () => fetch(service.origin + '/api/bootstrap', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.json());
  const firstConversation = (await bootstrap()).coordinatorConversation;
  const callCount = requests.length;
  a.complete('question-a', 'Should I paint the border blue?');
  b.complete('result-b', 'The draft layout is ready.');
  externalEvents = [{ key: 'fixture-id', app: 'Synthetic Planner', title: 'Offline Render', kind: 'question' }];
  refreshExternal();
  await page.waitForFunction(() => document.querySelector('.voice-caption-toggle')?.getAttribute('aria-description') === 'Pending notifications: 3');
  const notificationsTab = owner => owner.getByRole('button', { name: /^Notifications/ });
  await notificationsTab(chats).click();
  await chats.getByRole('button', { name: /Offline Render.*Synthetic Planner.*Read-only/ }).waitFor();
  await notificationsTab(page).click();
  await page.getByRole('button', { name: /Atlas Colors.*Codex.*Agent question/ }).waitFor();
  await page.screenshot({ path: path.join(repo, 'notifications.png') });
  assert.equal(await page.evaluate(() => window.fixtureVoice.sent.filter(item => item.type === 'session.commentary.append').length), 0);
  await page.getByRole('button', { name: /Atlas Colors.*Codex.*Agent question/ }).click();
  await page.getByText('Should I paint the border blue?', { exact: true }).waitFor();
  const command = async (text, expected) => {
    await input.fill(text); await input.press('Enter');
    await page.locator('.mak-exchange').last().getByText(expected, { exact: false }).waitFor();
    await page.waitForFunction(() => document.querySelector('.voice-compose textarea')?.value === '');
  };
  let voiceOffset = 0;
  const speak = async (text, id, expected) => {
    await page.evaluate(({ text, id, start }) => {
      window.fixtureVoice.emit({ type: 'session.input_transcript.delta', delta: text, start_ms: start });
      window.fixtureVoice.emit({ type: 'session.delegation.created', delegation: { id } });
    }, { text, id, start: voiceOffset += 2500 });
    await page.waitForFunction(({ id, expected }) => window.fixtureVoice.sent.some(item =>
      item.type === 'session.commentary.append' && item.delegation_id === id && item.content.includes(expected)), { id, expected });
  };
  await command('List notifications', '3 pending notifications');
  await speak('List notifications', 'fixture-list', 'Atlas Layout');
  await speak('Review notification Atlas', 'fixture-ambiguous', 'Which notification');
  await speak('Yes', 'fixture-no-selection', 'To reply');
  assert.deepEqual([a.writes, b.writes], [[], []]);
  await command('Review notification Atlas Colors', 'Atlas Colors · Codex');
  await command('Send reply to Atlas Colors: Use blue on the border.', 'Reply submitted to the terminal');
  assert.deepEqual(a.writes, ['\x1b[200~Use blue on the border.\x1b[201~', '\r']);
  assert.deepEqual(b.writes, []);

  b.complete('question-b', 'Should I align the title left?');
  await speak('Review notification Atlas Layout', 'fixture-review-b', 'Atlas Layout · Claude Code');
  await page.getByText('Should I align the title left?', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.fixtureVoice.sent.every(item => !item.content?.includes('Should I align'))));
  await speak('Send reply to Atlas Layout saying Align the title left.', 'fixture-send-b', 'Reply submitted to the terminal');
  await page.evaluate(() => window.fixtureVoice.emit({ type: 'session.delegation.created', delegation: { id: 'fixture-send-b' } }));
  assert.deepEqual(b.writes, ['\x1b[200~Align the title left.\x1b[201~', '\r']);
  assert.equal(a.writes.length, 2);

  await b.screen(permission);
  await chats.getByRole('button', { name: /Atlas Layout.*Manual attention/ }).waitFor();
  await speak('Review notification Atlas Layout', 'fixture-manual', 'Manual attention');
  await speak('Send reply to Atlas Layout saying Yes.', 'fixture-blocked', 'Manual attention');
  assert.equal(b.writes.length, 2);

  await notificationsTab(page).click();
  await page.getByRole('button', { name: /Offline Render.*Read-only/ }).click();
  await page.locator('.mak-exchange').last().getByText('Offline Render · Synthetic Planner — external notice', { exact: false }).waitFor();
  await chats.getByRole('button', { name: /Offline Render.*Read-only/ }).waitFor({ state: 'detached' });
  assert.equal(await page.locator('.voice-dock').getAttribute('data-voice-status'), 'live');
  assert.equal(requests.length, callCount, 'notification commands are local');
  assert.deepEqual((await bootstrap()).coordinatorConversation, firstConversation);
  await page.waitForFunction(async token => {
    const response = await fetch('/api/bootstrap', { headers: { Authorization: 'Bearer ' + token } });
    const state = await response.json();
    return state.voiceHistory.some(history => history.captions.some(caption => caption.text === '[Notification reply]'));
  }, token);
  assert.ok(!(await readFile(path.join(repo, '.mrmak/voice-transcripts.json'), 'utf8')).includes('Align the title left.'));
  await page.evaluate(async token => {
    const response = await fetch('/api/settings', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ uiLanguage: 'pt-BR' }) });
    if (!response.ok) throw new Error('Could not change fixture interface language');
  }, token);
  await chats.getByRole('button', { name: /^Notificações/ }).waitFor();
  await speak('Liste as notificações', 'fixture-list-pt', 'atenção manual');
  await chats.close();
  assert.deepEqual(errors, []);
  console.log('Talk to Bento: text, attachments, voice append limits, recovery, local context and conversation sync, and notification replies across text and simulated Live passed.');
  console.log(`Screenshots: ${repo}`);
} finally { await browser?.close(); await service.close(); }
