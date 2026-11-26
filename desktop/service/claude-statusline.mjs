// Claude Code runs this as a chat's status line command and writes its live session
// state to stdin as JSON (https://code.claude.com/docs/en/statusline). It saves the
// model, effort and aggregate usage for Bento. Antigravity uses the same
// reporter alongside its built-in status line.
//
// Usage: node claude-statusline.mjs <file.json>.
import { renameSync, writeFileSync } from 'node:fs';
import { statusUsage } from './usage-data.mjs';

const file = process.argv[2];
setTimeout(() => process.exit(0), 3000).unref();
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 2_000_000) process.exit(0); });
process.stdin.on('end', () => {
  if (!file) return;
  try {
    const data = JSON.parse(input);
    const at = Date.now();
    const state = {
      at,
      sessionId: typeof data.session_id === 'string' ? data.session_id : null,
      version: typeof data.version === 'string' ? data.version : null,
      model: { id: typeof data.model?.id === 'string' ? data.model.id : null, displayName: typeof data.model?.display_name === 'string' ? data.model.display_name : null },
      effort: typeof data.effort?.level === 'string' ? data.effort.level : null,
      usage: statusUsage(data, at),
    };
    writeFileSync(`${file}.tmp`, JSON.stringify(state));
    renameSync(`${file}.tmp`, file);
  } catch { /* A partial or unexpected payload leaves the last saved state. */ }
});
