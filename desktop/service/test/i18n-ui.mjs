// Isolated E2E check for non-destructive pt-BR <-> en localization across Workspace, Chats, and Mobile.
// Never modifies the user's real Workspace, settings, voice preferences, or installed app.
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { localDay } from '../workspace.mjs';
import { desktopAuth, launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = await mkdtemp(path.join(os.tmpdir(), 'bento-i18n-ui-'));

await mkdir(path.join(repo, 'workspace', 'sample'), { recursive: true });
await mkdir(path.join(repo, 'workspace', '_shared'), { recursive: true });
await mkdir(path.join(repo, '.mrmak'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await cp(path.join(root, 'public', 'assets'), path.join(repo, 'ui', 'assets'), { recursive: true });
for (const name of ['report.css', 'report.js']) {
  await copyFile(path.join(root, 'workspace', '_shared', name), path.join(repo, 'workspace', '_shared', name));
}

const reportHtml = '<!doctype html><html><body><h1>Project notes</h1><p>User report content stays unchanged.</p></body></html>';
await writeFile(path.join(repo, 'workspace', 'sample', 'report.html'), reportHtml);
await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({
  entities: [{
    id: 'sample',
    title: 'Character Workshop',
    description: 'User authored summary stays intact.',
    category: 'research',
    type: 'group',
    folder: 'sample',
    status: 'active',
    created: localDay(),
    steps: [{ name: 'Notes', path: 'report.html' }],
  }],
}));
// Pre-seed voice preferences to prove language switching never touches them.
const settingsPath = path.join(repo, '.mrmak', 'settings.json');
await writeFile(settingsPath, JSON.stringify({
  voiceName: 'marin',
  transcribeProvider: 'local',
}, null, 2));

const transport = {
  probe: async () => ({ ready: true, installed: true }),
  enable: async origin => ({ origin }),
  disable: async () => {},
};
const now = Date.now();
let usageQueries = 0;
const service = await createService({
  codexUsageQuery: async () => {
    usageQueries++;
    return { total: 1200000, at: now, quotas: [
      { key: 'active', label: 'Fixture current quota', minutes: 300, percent: 25, remaining: null, resetsAt: now + 3600000 },
      { key: 'expired', label: 'Fixture expired quota', minutes: null, percent: 90, remaining: null, resetsAt: now - 60000 },
    ] };
  },
  repo,
  uiDir: path.join(repo, 'ui'),
  mobileOptions: { transport },
  mcpOptions: { home: repo, env: {} },
});
service.sessions.beginDiscovery = () => {};

let browser;
try {
  browser = await launchBrowser();
  const desktopContext = await browser.newContext({ viewport: { width: 1300, height: 920 } });
  await desktopAuth(desktopContext, service.urls.workspace);
  const workspace = await desktopContext.newPage();
  const chats = await desktopContext.newPage();
  await chats.setViewportSize({ width: 620, height: 850 });
  workspace.setDefaultTimeout(15000);
  chats.setDefaultTimeout(15000);

  const errors = [];
  workspace.on('pageerror', err => errors.push(`workspace: ${err.message}`));
  chats.on('pageerror', err => errors.push(`chats: ${err.message}`));

  // 1. Default English check on Workspace and Chats.
  await workspace.goto(service.urls.workspace);
  await chats.goto(service.urls.chats);

  await expect(workspace.locator('html')).toHaveAttribute('lang', 'en');
  await expect(workspace.locator('html')).toHaveAttribute('data-ui-language', 'en');
  await expect(workspace.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  const usagePanel = workspace.getByRole('region', { name: 'Agent usage', exact: true });
  const expandUsage = usagePanel.getByRole('button', { name: 'Expand', exact: true });
  const activeQuota = usagePanel.getByRole('listitem').filter({ hasText: 'Fixture current quota' });
  const expiredQuota = usagePanel.getByRole('listitem').filter({ hasText: 'Fixture expired quota' });
  const accountTokens = usagePanel.getByText('1,200,000', { exact: true });
  await expect(expandUsage).toHaveAttribute('aria-expanded', 'false');
  await expect(activeQuota).toContainText('25% used');
  await expect(expiredQuota).toHaveCount(0);
  await expect(accountTokens).toHaveCount(0);
  await expandUsage.press('Enter');
  await expect(usagePanel.getByRole('button', { name: 'Collapse', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(accountTokens).toBeVisible();
  await expect(expiredQuota).toContainText('awaiting');
  await expect(expiredQuota.getByRole('meter')).toHaveCount(0);
  await expect(usagePanel.locator('[data-agent="claude"]').getByText('Unavailable', { exact: true })).toHaveCount(2);
  await usagePanel.getByRole('button', { name: 'Refresh agent usage' }).click();
  await expect(usagePanel.getByRole('status')).toContainText('Checked');
  assert.equal(usageQueries, 1, 'Refreshing the panel reuses the cached CLI result');
  await expect(workspace.getByRole('button', { name: '+ New card', exact: true })).toBeVisible();
  await expect(workspace.locator('.home [data-card="sample"]')).toContainText('Character Workshop');

  await expect(chats.locator('html')).toHaveAttribute('lang', 'en');
  await expect(chats.locator('.chats-brand')).toContainText('Bento Workspace');
  await expect(chats.getByRole('button', { name: /History/ })).toBeVisible();
  await expect(chats.getByRole('button', { name: 'Open your first chat' })).toBeVisible();

  // 2. Switch to pt-BR via Workspace Settings selector and verify live cross-window sync.
  await workspace.getByRole('button', { name: 'Toggle settings', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const settingsLangSelect = workspace.locator('.workspace-settings select[aria-label="Interface language"]');
  await expect(settingsLangSelect).toHaveValue('en');
  await settingsLangSelect.selectOption('pt-BR');

  // Verify html lang & data attribute and Workspace Settings translated live.
  await expect(workspace.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(workspace.locator('html')).toHaveAttribute('data-ui-language', 'pt-BR');
  const localizedUsage = workspace.getByRole('region', { name: 'Uso dos agentes' });
  await expect(localizedUsage.getByText('1.200.000', { exact: true })).toBeVisible();
  await expect(localizedUsage.getByText(/25% usado/)).toBeVisible();
  await localizedUsage.getByRole('button', { name: 'Recolher', exact: true }).press('Space');
  await expect(localizedUsage.getByRole('button', { name: 'Expandir', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(localizedUsage.getByText('1.200.000', { exact: true })).toHaveCount(0);
  await expect(localizedUsage.getByText(/25% usado/)).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Idioma', exact: true })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Aparência', exact: true })).toBeVisible();
  await expect(workspace.locator('.workspace-settings select[aria-label="Idioma da interface"]')).toHaveValue('pt-BR');
  // Brand & voice options preserved verbatim.
  await expect(workspace.locator('.workspace-settings')).toContainText('Bento Workspace');
  await expect(workspace.locator('.workspace-settings')).toContainText('Cedar');
  await expect(workspace.locator('.workspace-settings')).toContainText('Marin');

  // Check overflow on Workspace with Settings open in pt-BR.
  const wsSettingsOverflow = await workspace.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(wsSettingsOverflow <= 1, `Workspace settings overflow in pt-BR: ${wsSettingsOverflow}px`);

  // Check Files, MCP, and Rede Bento panels in pt-BR.
  await workspace.getByRole('button', { name: 'Alternar Arquivos', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'Arquivos', exact: true })).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Pastas principais', exact: true })).toBeVisible();

  await workspace.getByRole('button', { name: 'Alternar MCP', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'MCP', exact: true })).toBeVisible();
  await expect(workspace.locator('.mcp-summary')).toContainText('conexões ativadas');

  await workspace.getByRole('button', { name: 'Rede Bento', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'Rede Bento', exact: true })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Conexões', exact: true })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Tarefas dos computadores', exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'Fechar Rede Bento', exact: true }).click();

  // Check HomeGrid, Sidebar, NewCard, EntityControls, and untouched user content in pt-BR.
  await expect(workspace.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Pastas de projetos', exact: true })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Resultados do Workspace', exact: true })).toBeVisible();
  await expect(workspace.locator('.home [data-card="sample"]')).toContainText('Character Workshop');
  await expect(workspace.locator('.home [data-card="sample"]')).toContainText('User authored summary stays intact.');

  await workspace.getByRole('button', { name: 'Mostrar menu', exact: true }).click();
  await expect(workspace.getByRole('button', { name: 'Ocultar menu', exact: true })).toBeVisible();
  await expect(workspace.getByRole('textbox', { name: 'Buscar itens' })).toBeVisible();

  await workspace.getByRole('button', { name: '+ Novo card', exact: true }).click();
  await expect(workspace.getByRole('dialog', { name: 'Novo card do Workspace' })).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Criar card', exact: true })).toBeVisible();
  await workspace.keyboard.press('Escape');

  const cardStatusBtn = workspace.locator('.home [data-card="sample"] .entity-status-button');
  await cardStatusBtn.click();
  const cardMenu = workspace.getByRole('dialog', { name: 'Configurações do card: Character Workshop' });
  await expect(cardMenu).toBeVisible();
  await expect(cardMenu.getByRole('button', { name: 'Ativo', exact: true })).toBeVisible();
  await expect(cardMenu.getByRole('button', { name: 'Concluído', exact: true })).toBeVisible();
  await expect(cardMenu.getByRole('button', { name: 'Arquivado', exact: true })).toBeVisible();
  await workspace.keyboard.press('Escape');

  // Check narrow desktop viewport (768px) layout in pt-BR.
  await workspace.setViewportSize({ width: 768, height: 850 });
  const wsNarrowOverflow = await workspace.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(wsNarrowOverflow <= 1, `Workspace 768px overflow in pt-BR: ${wsNarrowOverflow}px`);
  await workspace.setViewportSize({ width: 1300, height: 920 });

  // 3. Verify Chats synced live to pt-BR without reloading.
  await expect(chats.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(chats.locator('.chats-brand')).toContainText('Bento Workspace');
  await expect(chats.getByRole('button', { name: /Histórico/ })).toBeVisible();
  await expect(chats.getByRole('button', { name: 'Abrir seu primeiro chat' })).toBeVisible();

  // Check Chats dialogs: New chat, History, Chat appearance popover, Mobile access, VoiceDock.
  await chats.getByRole('button', { name: 'Novo chat', exact: true }).click();
  await expect(chats.getByRole('heading', { name: 'Novo chat', exact: true })).toBeVisible();
  await expect(chats.getByRole('button', { name: 'Abrir chat' })).toBeVisible();
  await chats.keyboard.press('Escape');

  await chats.getByRole('button', { name: /Histórico/ }).click();
  await expect(chats.getByRole('region', { name: 'Histórico de chats' })).toBeVisible();
  await chats.getByRole('button', { name: 'Fechar histórico', exact: true }).click();

  await chats.getByRole('button', { name: 'Aparência do chat', exact: true }).click();
  await expect(chats.locator('.browser-settings-panel select[aria-label="Idioma da interface"]')).toHaveValue('pt-BR');
  await chats.keyboard.press('Escape');

  await chats.getByRole('button', { name: 'Acesso móvel', exact: true }).click();
  await expect(chats.getByRole('dialog', { name: 'Acesso móvel' })).toBeVisible();
  await expect(chats.getByRole('heading', { name: 'Configurações do celular', exact: true })).toBeVisible();
  await chats.keyboard.press('Escape');

  await chats.getByRole('button', { name: 'Alternar conversa', exact: true }).click();
  await expect(chats.locator('.voice-panel')).toBeVisible();
  await expect(chats.locator('.voice-tabs')).toContainText('Conversa');
  await chats.getByRole('button', { name: /^Notificações/ }).click();
  await expect(chats.getByRole('region', { name: 'Notificações' })).toBeVisible();
  await chats.getByRole('button', { name: 'Alternar conversa', exact: true }).click();

  const chatsOverflow = await chats.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(chatsOverflow <= 1, `Chats 620px overflow in pt-BR: ${chatsOverflow}px`);

  // 4. Mobile pairing and pt-BR <-> en live synchronization at 390x844.
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${service.token}` };
  await fetch(`${service.origin}/api/mobile/enable`, { method: 'POST', headers, body: '{}' });
  const pairing = await fetch(`${service.origin}/api/mobile/pair`, { method: 'POST', headers, body: '{}' }).then(r => r.json());

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await mobileContext.newPage();
  mobile.setDefaultTimeout(15000);
  mobile.on('pageerror', err => errors.push(`mobile: ${err.message}`));

  // Unpaired Connect screen has language toggle and clean layout.
  await mobile.goto(pairing.url);
  await expect(mobile.locator('.mobile-connect .language-toggle')).toBeVisible();
  await mobile.locator('.mobile-connect .language-toggle').click();
  await expect(mobile.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(mobile.getByRole('heading', { name: 'Conectar este celular' })).toBeVisible();
  const mobileConnectOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(mobileConnectOverflow <= 1, `Mobile connect 390px overflow in pt-BR: ${mobileConnectOverflow}px`);

  // Pair phone and verify paired Mobile UI in pt-BR.
  await mobile.getByRole('button', { name: 'Solicitar conexão' }).click();
  await expect(mobile.getByRole('heading', { name: 'Confirme no computador' })).toBeVisible();
  const mobileState = await fetch(`${service.origin}/api/mobile`, { headers }).then(r => r.json());
  assert.equal(mobileState.pending.length, 1);
  await fetch(`${service.origin}/api/mobile/approve`, { method: 'POST', headers, body: JSON.stringify({ id: mobileState.pending[0].id }) });

  await expect(mobile.getByRole('button', { name: 'Configurações do celular', exact: true })).toBeVisible();
  await expect(mobile.locator('.mobile-header h1')).toHaveText('Chats');
  await mobile.getByRole('button', { name: 'Configurações do celular', exact: true }).click();
  const mobileLangSelect = mobile.locator('.mobile-device-settings select[aria-label="Idioma da interface"]');
  await expect(mobileLangSelect).toHaveValue('pt-BR');
  const mobileSettingsOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(mobileSettingsOverflow <= 1, `Mobile settings 390px overflow in pt-BR: ${mobileSettingsOverflow}px`);

  // Check Mobile Results and Rede Bento tabs in pt-BR.
  await mobile.getByRole('button', { name: 'Configurações do celular', exact: true }).click();
  await mobile.getByRole('button', { name: 'Resultados', exact: true }).click();
  await expect(mobile.getByRole('textbox', { name: 'Buscar um relatório' })).toBeVisible();
  await mobile.getByRole('button', { name: 'Rede', exact: true }).click();
  await expect(mobile.locator('.mobile-header h1')).toHaveText('Rede Bento');
  await mobile.getByRole('button', { name: 'Chats', exact: true }).click();

  // 5. Persistence across reloads in pt-BR.
  await workspace.reload();
  await chats.reload();
  await mobile.reload();
  await expect(workspace.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(workspace.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible();
  await expect(chats.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(chats.getByRole('button', { name: /Histórico/ })).toBeVisible();
  await expect(mobile.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(mobile.getByRole('button', { name: 'Configurações do celular', exact: true })).toBeVisible();

  // Verify report content and voice settings were never altered.
  const persistedSettings = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(persistedSettings.uiLanguage, 'pt-BR');
  assert.equal(persistedSettings.voiceName, 'marin');
  assert.equal(persistedSettings.transcribeProvider, 'local');
  assert.equal(await readFile(path.join(repo, 'workspace', 'sample', 'report.html'), 'utf8'), reportHtml);

  // 6. Switch back to English FROM Mobile Phone Settings and verify live propagation + reload persistence.
  await mobile.getByRole('button', { name: 'Configurações do celular', exact: true }).click();
  await mobile.locator('.mobile-device-settings select[aria-label="Idioma da interface"]').selectOption('en');

  await expect(mobile.locator('html')).toHaveAttribute('lang', 'en');
  await expect(mobile.getByRole('button', { name: 'Phone settings', exact: true })).toBeVisible();
  await expect(workspace.locator('html')).toHaveAttribute('lang', 'en');
  await expect(workspace.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(chats.locator('html')).toHaveAttribute('lang', 'en');
  await expect(chats.getByRole('button', { name: /History/ })).toBeVisible();

  // 7. Quick language toggle pill in Workspace Topbar switches en -> pt-BR -> en cleanly.
  await workspace.locator('.topbar .language-toggle').click();
  await expect(workspace.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(workspace.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible();
  await workspace.locator('.topbar .language-toggle').click();
  await expect(workspace.locator('html')).toHaveAttribute('lang', 'en');
  await expect(workspace.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();

  await workspace.reload();
  await expect(workspace.locator('html')).toHaveAttribute('lang', 'en');
  const revertedSettings = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(revertedSettings.uiLanguage, 'en');
  assert.equal(revertedSettings.voiceName, 'marin');

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join('; ')}`);
  await mobileContext.close();
  await desktopContext.close();
  console.log('i18n UI check passed: EN <-> PT-BR live switching, Workspace/Chats/Mobile sync, persistence across reloads, untouched user data & voice prefs, and zero layout overflow.');
} finally {
  await browser?.close();
  await service.close();
  await rm(repo, { recursive: true, force: true }).catch(() => {});
}
