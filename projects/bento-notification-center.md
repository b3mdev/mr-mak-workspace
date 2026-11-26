# Talk to Bento notification center

Base: integration/bento-pt-br at e2198f5. Work in feat/bento-notification-center.

1. Project native unread and attention signals into a desktop queue with stable origin IDs. Confirm that busy processes, terminal exits and silence do not produce completion items.
2. Add a non-interrupting badge and a review panel to Talk to Bento. Route English and Brazilian Portuguese text and Live transcript commands through the same conversation-scoped, local handler. Require review and an explicit destination and reply before sending. Revalidate the chat, turn and visible composer and retain only delivery receipts.
3. Add an opt-in source contract, exercise a read-only external source end to end and document Windows integration options. Verify all five managed CLI fixtures, cross-window state, simulated Live, stale and ambiguous targets, manual prompts, retries, build and lint.

## Using the center

Open Talk to Bento, then Notifications. The badge counts pending items across the Workspace and Chats windows. The list identifies each source and work item. A review appears in the same Bento conversation, with any safe excerpt shown as quoted source content. Live speaks the item label and status on request. It displays the excerpt locally to keep terminal content out of the voice relay.

| Action | English | Brazilian Portuguese |
| --- | --- | --- |
| List | List notifications | Liste as notificações |
| Review | Review notification 2 | Revise a notificação 2 |
| Continue | Next notification | Próxima notificação |
| Send | Send reply to 2 saying Use blue. | Envie resposta para 2 dizendo Use azul. |

An exact work name can replace the number. Use the number when multiple items have similar names. A colon also separates the destination from the text in the composer. Review the item before sending. A reply is a single line of up to 500 characters. Links, commands, control characters and recognizable credentials are rejected. A shared name or a changed item requires another review. Read-only items leave the center after review for the current service run. A still-pending source can list them again after restart. The original chat's unread state is acknowledged through its existing Chats window behavior.

The service reserves a delivery before writing to the PTY. It checks the reviewed turn, running process and visible composer before pasting and checks the exact pasted draft again before Enter. A successful result confirms submission to the terminal. An unconfirmed result can leave a draft in the original chat. The service retains opaque request and item IDs plus delivery status to prevent resubmission after a retry or restart. The next completion comes from native telemetry.

## Managed source coverage

| Source | Signals exercised in fixtures | Reply coverage |
| --- | --- | --- |
| Codex | Native turn-complete records and rendered menus | A current question and a recognized idle composer |
| Claude Code | Final assistant messages and rendered native menus | A current question and a recognized idle composer |
| Antigravity | Planner responses and rendered prompts | A current question and a recognized idle composer |
| OpenCode | Observer execution and attention events | A matching final assistant message ID and recognized composer. An execution-only ID still gives an unread result. Native permission and question menus require manual attention. |
| Kimi | Managed terminal login and attention signals | Manual attention. The current integration has no trusted native turn identity for reply routing. |

Fixtures also exercise shell attention. An idle shell, terminal bells, an open process, an exit or silence alone never produce a completed turn. This increment identifies a normal question through a current final assistant message ending in a question mark. Screen layouts may vary with the installed CLI version, theme or terminal size. Unknown layouts require manual review. The delivery fixture simulates the PTY and provider; these layouts still require live CLI validation.

## External adapter contract

At the desktop service composition boundary, supply a trusted adapter through `createService({ notificationSources: [...] })`. Each adapter has a stable unique `id`, an explicit `enabled: true` opt-in, a synchronous `snapshot()` and `subscribe(onChange)` returning an unsubscribe function. A snapshot returns the adapter's pending records with stable `key`, source `app`, work `title` and optional ISO `at`. Scope keys to a single event, include the producer's stable work and event identity, and reuse them on replay. The center namespaces keys per adapter. External records expose those fields as read-only metadata and can be reviewed in either desktop window. A notification transport cannot provide a reply endpoint by submitting a record.

The synthetic adapter is wired into service and browser fixtures. Production currently registers the managed source only. Future app or CLI adapters should use explicit per-source opt-in and a vendor-supported notification feed, hook or plugin. They should map only allowlisted metadata and avoid credentials, original messages and attachments. A local transport would need authenticated, per-adapter capabilities and an isolated lifecycle. A future bidirectional adapter would also need a supported reply API, target and item revalidation, separate send authorization and idempotent delivery. A read-only adapter never gains that capability implicitly.

### Windows proposal

Windows documents `UserNotificationListener` for toast snapshots and change events. It requires the `userNotificationListener` capability in an app package manifest and explicit consent from the UI thread. A packaged or package-identity helper is a candidate for the current Tauri NSIS distribution. Validate that deployment route and access revocation on Windows, and filter to user-selected apps before mapping metadata into the adapter. Treat the listener as a read-only source for Bento. Its published methods enumerate or dismiss toasts and do not submit replies through other apps. CLI output that never produces a Windows toast would need an explicit integration with its producer. [Microsoft listener guide](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/notification-listener), [WinRT methods](https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.management.usernotificationlistener?view=winrt-26100), [Package identity for desktop apps](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps).

An opt-in Claude Code hook or OpenCode plugin could publish allowlisted event metadata explicitly, including for a CLI running outside Bento. The external adapter can use the same contract for an app-specific, authenticated notification feed. Those integrations are proposals. [Claude Code hooks](https://code.claude.com/docs/en/hooks), [OpenCode plugins](https://opencode.ai/v2/docs/build/plugins/).
