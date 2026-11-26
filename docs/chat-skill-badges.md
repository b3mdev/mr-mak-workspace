# Chat skill badges

The badge column is part of the chat view introduced on the local branch
`feat/chat-skill-badges`, based on `84c43a2`. Its details panel stays inside
the active chat. Opening it leaves the terminal connected and the composer
intact. Use Tab and Enter to open a badge and Escape to close its details.

| Badge state | Evidence |
| --- | --- |
| Loaded | A successful Claude Code `Skill` tool result matched its structured call for this session. |
| Available in catalog | The local definition is discoverable in a provider with an observation adapter, or a Bento enablement flag was passed at launch. |
| Load status unknown | Bento lacks attributable load evidence. A discovered definition still opens for reading. |
| Disabled in this session | Bento passed a Codex disable flag when this chat's terminal started. |

Saved Codex settings apply the next time Bento starts the selected chat.
Codex 0.172.0 was verified with `skills/list` and session-level flags. The
active terminal keeps its settings, and other chats retain their own choices.
Current Codex and Antigravity catalog discovery provides no load confirmation
in this integration. Claude Code confirms tool invocations from its native
transcript when matching records are present.

Editing instructions writes the indicated source file after **Save**. Its
frontmatter stays in place, and a revision check keeps edits made outside
Bento. A later skill invocation or session can read the updated file.
Plugin files, bundled skills, protected paths, and synchronized project
copies remain readable in the panel. Maintain synchronized copies through the
project's existing skill workflow.

`desktop/service/chat-skills.mjs` owns discovery, permissions and persistence
inputs. `native-events.mjs` recognizes structured Claude results.
`sessions.mjs` associates evidence and launch flags with each managed chat.
`src/desktop/ChatSkillRail.tsx` renders the badges and details.

Verify in the branch with `npm run build`, `npm run lint`,
`node --test desktop/service/test/chat-skills.test.mjs` and
`node desktop/service/test/chat-skills-ui.mjs`. The fixtures check distinct
chat states, unavailable telemetry and activation, keyboard focus, explicit
save, conflict and read-only rejection, active-terminal continuity,
narrow layout, and Brazilian Portuguese.
