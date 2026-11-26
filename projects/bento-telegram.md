# Bento Workspace Telegram

The owner can pair a dedicated Telegram bot from Bento, receive minimal work alerts, talk to Bento by text, and reply to an explicitly selected work item.

1. Establish private pairing and independent consent for alerts and inbound text. Verify the zero-network default and reject invalid destinations with a simulated Bot API.
2. Project confirmed native events into minimal, deduplicated alerts. Bind Telegram replies to a specific work item and revalidate the live target and composer before submitting.
3. Test the transport, desktop controls, and round trips with fixtures. Document future setup, the Notification Center adapter, and verification limits.

## Owner setup

1. When ready to connect, use a dedicated bot created through Telegram's official BotFather. Turn off group access, inline mode, and private chat topics. Use it with one Bento instance and without a webhook or another polling service. [Telegram bot setup](https://core.telegram.org/bots/tutorial)
2. In Bento Workspace, open **Settings → Telegram**. Save the bot token as the sole line of the local file shown there. The installed desktop uses its machine-local, per-workspace app-data directory. Create the directory with access limited to your OS account and its administrators. On Windows, check the folder and file's Security properties. On macOS and Linux, use mode 700 for the directory and 600 for the file. Use a local editor and keep the token out of chat, shell arguments, and source control.
3. Select **Pair a private bot**. In the named bot's private chat, send the one-time command from Settings. Check the account shown in Bento and approve it locally. The challenge expires after five minutes. Bento verifies the bot and private destination through Telegram before activating either channel.
4. Enable **Work alerts**, **Incoming text and replies**, or both. Send an ordinary text message to converse with Bento. Reply to the specific **Needs a reply** alert when Telegram offers a reply field. Handle permissions, logins, choice menus, and unsupported or changed work items in Bento.
5. To revoke both channels and the local pairing, select **Disconnect bot**. For a leaked token or a storage error during revocation, revoke the token through BotFather and remove the local token file. Pair again to use a new bot.

Alerts contain a work name and state. The integration substitutes a generic title for recognizable paths, links, credential patterns, and unusually long tokens. Bento keeps Workspace prompts, outputs, and transcripts local. Conversation sends the owner's Telegram text and a short in-memory history to the OpenAI Responses API with response storage disabled and no tools enabled. It uses the API key already configured for Bento voice and can incur API charges. Workspace jobs, desktop conversation history, terminal output, and work replies are outside that model conversation. [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create/)

## Delivery and security contract

- Telegram uses outbound HTTPS only. It polls for text when the owner starts a pairing or enables incoming text. The desktop controls use Bento's existing authenticated loopback API. Telegram has no incoming listener. [Telegram Bot API requests and polling](https://core.telegram.org/bots/api#getupdates)
- Pairing requires proving possession of a one-time challenge in a private chat and approving the verified account from Bento. Inbound messages must match both the paired user and chat IDs. Forwarded messages, service messages, group messages, and slash commands outside pairing are ignored. The bot and destination are verified on activation. [Telegram chat validation](https://core.telegram.org/bots/api#getchat)
- A work reply uses Telegram's native Reply to a bot message with an active, local reply binding. That binding is limited to a specific session, PTY, native conversation, and turn. The reply must be a single line of plain text. Bento rechecks process, input revision, activity, model switching, permission policy, and the live composer before paste and after redraw. An unconfirmed paste may leave a draft for local review. A receipt reports submission to the terminal. Reply bindings are single-use, expire after 30 minutes, and are cleared when the integration stops. [Telegram ForceReply](https://core.telegram.org/bots/api#forcereply)
- Alerts use a stable event key. The latest 1,024 claims survive restarts. Telegram sends and inbound effects are claimed on disk before execution, so Bento does not retry ambiguous sends or apply the same update again after restart. A crash between claim and effect can lose that delivery. Messages from before inbound activation are discarded. Settings shows fixed error messages for connection, polling, delivery, and storage failures.

## Notification Center handoff

The Telegram branch starts at the integration snapshot `e2198f5`. Its `watchTelegramWork` adapter listens to the existing managed-session signals. The separate Notification Center branch at `e86dc65` owns its queue, excerpts, local review, and managed-source contract. When merging the two branches, reconcile the shared `Sessions` viewport and guarded-submit changes before switching the event producer.

Keep `TelegramIntegration.publish({ key, title, kind, proof })` as the channel boundary. Read managed items from the internal source snapshot and subscription. Map `completion`, `question`, and `manual` records to `completion`, `question`, and `attention` using a stable origin key. Seed the subscriber from the initial snapshot and publish new items only. Omit excerpts and arbitrary source payloads. Only an eligible managed question may carry reply proof. Reuse the Center's explicit-target delivery validator if it verifies the same turn and preserves current permissions and the two composer checks. External or manual sources are alert-only. Keep Telegram opt-in, its owner binding, message receipts, and provider state in the Telegram adapter.

## Verification

Run `node --test desktop/service/test/telegram.test.mjs` for the Bot API transport fixtures, local desktop API, safe text model fixture, and managed terminal round trips. The baseline can bind a reply for recognized Codex, Claude Code, and Antigravity composers with confirmed native turn lineage. OpenCode and Kimi use the alert path where the baseline emits a qualifying event. Login flows, unknown composers, and native permission prompts require local handling. The handoff author's source skill paths are `.agents/skills/plan/SKILL.md` and `.agents/skills/feature-handoff/SKILL.md`.

The desktop suite passed on Windows with 279 passes and 7 platform skips. Build, lint, and the desktop Settings pairing check passed. Verification uses synthetic credentials and network responses. Real Telegram accounts, provider billing and model behavior, native agent composer variations, installation, and deployment are outside the fixture coverage.
