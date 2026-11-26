import { TelegramError, telegramText } from './telegram-api.mjs';

const instructions = [
  'You are Bento Workspace, the owner’s practical text companion.',
  'Reply concisely in the language the owner is using.',
  'You can talk through ideas and help draft text. You have no tools, terminal, work history, files, or ability to take actions.',
  'For a work reply, ask the owner to use Telegram’s Reply on the specific work alert or use Bento directly.',
].join(' ');

export function telegramConversation({ key, fetcher = fetch }) {
  let history = [];
  const converse = async (text, signal) => {
    signal.throwIfAborted();
    const apiKey = await key();
    if (!apiKey) throw new TelegramError('conversationConfig');
    const input = [...history, { role: 'user', content: text }];
    try {
      const response = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini', instructions, input, tools: [], store: false,
          reasoning: { effort: 'minimal' }, max_output_tokens: 800,
        }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (result?.status !== 'completed' || !Array.isArray(result.output)) throw new Error();
      const answer = telegramText(result.output
        .filter(item => item?.type === 'message' && item.role === 'assistant' && Array.isArray(item.content))
        .flatMap(item => item.content)
        .filter(part => ['output_text', 'refusal'].includes(part?.type))
        .map(part => part.text || part.refusal || '').join('\n'), 1800);
      if (!answer) throw new Error();
      signal.throwIfAborted();
      history = [...input, { role: 'assistant', content: answer }].slice(-8);
      return answer;
    } catch {
      // Provider failures stay local as a fixed code. Never forward request or response diagnostics.
      throw new TelegramError('conversation');
    }
  };
  converse.reset = () => { history = []; };
  return converse;
}
