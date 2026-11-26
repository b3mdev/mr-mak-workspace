const apiOrigin = 'https://api.telegram.org';
const tokenFormat = /^\d{1,16}:[A-Za-z0-9_-]{25,}$/;

export class TelegramError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function telegramBot(token, fetcher = fetch) {
  if (!tokenFormat.test(token)) throw new TelegramError('token');
  return async (method, body, signal) => {
    const timeout = method === 'getUpdates' ? 32_000 : 8_000;
    try {
      const response = await fetcher(apiOrigin + '/bot' + token + '/' + method, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
      });
      if (response.status === 401) throw new TelegramError('token');
      if (response.status === 403) throw new TelegramError('destination');
      if (response.status === 409) throw new TelegramError('pollConflict');
      if (response.status === 429) throw new TelegramError('rateLimit');
      if (!response.ok) throw new TelegramError('telegram');
      const envelope = await response.json();
      if (envelope?.ok !== true || !Object.hasOwn(envelope, 'result')) throw new TelegramError('telegram');
      return envelope.result;
    } catch (error) {
      // Fetch errors and Telegram response descriptions can contain the token URL.
      if (error instanceof TelegramError) throw error;
      throw new TelegramError('connection');
    }
  };
}

export const telegramId = value => Number.isSafeInteger(value) && value > 0 && value < 2 ** 52;
export const privateChat = (chat, id) => telegramId(id) && chat?.id === id && chat.type === 'private';

export function ownerMessage(message) {
  return message && telegramId(message.message_id) && telegramId(message.from?.id) &&
    message.from.is_bot === false && privateChat(message.chat, message.from.id) &&
    !message.sender_chat && !message.forward_origin && !message.via_bot &&
    !message.is_automatic_forward && !message.business_connection_id && !message.is_topic_message &&
    typeof message.text === 'string';
}

export function telegramText(value, limit) {
  return Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim()).slice(0, limit).join('');
}
