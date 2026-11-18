# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Claude Office (repo `claude-hq`) is a local web app. It reads Claude Code's session logs and shows
agents as characters in a pixel-art corporate building: one office per project, one room per agent.
It also runs a router agent (the installed `claude` CLI in headless stream-json mode) that you chat
with from the browser; the router hands work to specialist subagents.

## Commands

- `npm start` builds the client and serves it on http://127.0.0.1:4317 (or the next free port).
  `--no-open` (after `npx tsx src/server/main.ts`) skips opening a browser.
- `npm run dev` runs the server with Vite in middleware mode (hot reload) on the same port.
- `npm run agents:install` copies `agents/*.md` into `~/.claude/agents`. It keeps files the user
  edited unless `--force` is passed. The router can't start until `router.md` is installed.
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest), `npm run e2e` (Playwright, which builds
  and starts its own server on port 4399 against `tests/fixtures/claude`).
- Run one test file: `npx vitest run tests/<name>.test.ts`; one test: add `-t "<test name>"`.
- Env:
  - `OFFICE_PORT`: preferred port.
  - `OFFICE_NO_OPEN=1`: don't open a browser.
  - `OFFICE_LOG_LEVEL`: Fastify log level, default `warn`.
  - `OFFICE_HOME`: where `settings.json` and `routers.json` live, default `~/.claude-office`.
  - `OFFICE_CLAUDE_BIN`: path to the claude executable.
  - `CLAUDE_CONFIG_DIR`: Claude Code's folder, default `~/.claude`. Tests point it at fixtures.

## Architecture

- **Reading logs** (`src/server/logs`):
  - `SessionIndex` summarises every log from its first 64 KB and last 512 KB. Logs reach 140 MB,
    so whole files are never read for the building view.
  - `LogStore` watches the folders with chokidar, polls `~/.claude/sessions` for live pids, and
    fully parses only the sessions a page subscribes to. It does this through `JsonlTail`
    (incremental, byte-safe) feeding `SessionAccumulator` (pure).
  - It emits `projects` and `session` events.
- **Running the router** (`src/server/router`):
  - `RouterManager` keeps at most one `RouterProcess` per project folder and persists router
    phases to `routers.json`, so a task cut off by a restart shows a Resume button.
  - `RouterProcess` owns the queue, the Stop/interrupt logic, and the handoff cap (it interrupts
    the turn once the cap is passed). It answers each `can_use_tool` with
    `permissionPolicy.decide()`: allow, deny (role limits), or ask the user (an Approve/Deny card).
- **Server wiring** (`main.ts`, `app.ts`, `clientHub.ts`):
  - REST for reads, one WebSocket for live updates and commands.
  - `localOnly.ts` rejects any Host or Origin that isn't the office's own: the socket can start
    Claude with the user's permissions.
- **Client**:
  - A Zustand store fed by the socket (`state/`).
  - The PixiJS scenes (`scene/`) are plain classes driven by `SceneCanvas`. They are decorative:
    every fact they draw also appears as text in the side panel (Directory, Rooms, Transcript).
  - `scene/rooms.ts` folds agents into rooms.
  - `lib/signals.ts` decides when to play the "done" and "needs input" cues.
- **Agents** (`agents/`): the router, designer, coder, tester and reviewer definitions.
  - Role limits live in `permissionPolicy.ts`, not only in the prompts. The prompts tell agents
    why an edit was refused.

## Claude Code formats this app depends on (verified against CLI 2.1.316)

Headless router process:
- Command: `claude.exe -p --input-format stream-json --output-format stream-json --verbose
  --permission-prompts host --permission-prompt-tool stdio --agent router [--model m]
  [--resume id]`.
  - Without `--permission-prompt-tool stdio`, every prompt is silently denied
    (`system:permission_denied`), and no request ever reaches the host.
- The CLI approves some commands itself (read-only ones such as `node --version`), so not every
  tool call produces a `can_use_tool`.
- Interrupt: `{"type":"control_request","request_id","request":{"subtype":"interrupt"}}`.
  - The turn then ends with a `result` that has `is_error: true`. After a Stop the user asked
    for, that's expected, not a failure.
- When the server process dies, the router's stdin closes and the CLI exits; no orphans are left.
- Spawn the real `claude.exe`, never the npm `claude.cmd` shim. With `shell: true` the `--agents`
  JSON gets mangled.
- Paths that contain 8.3 short names (`ARYLRO~1`) are denied by a safety check without a prompt.
  Always pass long-form paths as `cwd`.
- Stdin messages:
  - Handshake: `{"type":"control_request","request_id":…,"request":{"subtype":"initialize"}}`.
  - User turn: `{"type":"user","message":{"role":"user","content":"…"}}`.
- Permission request (stdout):
  `{"type":"control_request","request_id","request":{"subtype":"can_use_tool","tool_name","input",`
  `"tool_use_id","agent_id"?}}`.
  - `agent_id` is present only when a subagent is asking.
  - Answer with `{"type":"control_response","response":{"subtype":"success","request_id",`
    `"response":{"behavior":"allow","updatedInput":…}|{"behavior":"deny","message":…}}}`.
- Other stdout events used:
  - `system:init` (`session_id`).
  - `system:task_started` (`tool_use_id`, `subagent_type`). Subagent messages carry `agent_id`.
  - `system:task_updated` and `system:task_notification`.
  - `assistant` and `user`.
  - `result`, which ends a turn and carries `usage` and `total_cost_usd`.

Session logs on disk (`~/.claude/projects/<slug>/`):
- `<sessionId>.jsonl` holds the main thread. Lines have many `type`s; only `user` and `assistant`
  matter for state.
- Assistant content blocks are written as separate lines that share the same `message.id` and
  repeat the same `usage`. Count tokens once per `message.id`.
- Subagent logs are `<sessionId>/subagents/agent-<agentId>.jsonl` (`isSidechain: true`).
  `agent-<agentId>.meta.json` holds `agentType` (the role) and `toolUseId` (the router's Agent call).
- `~/.claude/sessions/<pid>.json` lists running processes: `sessionId`, `cwd`, `status`
  (`busy`/`idle`), `name`, `updatedAt`. A session is live only while that pid exists.

## Rules for this repo

- The server binds to 127.0.0.1 only and makes no outbound network calls.
- The repo is public. Test fixtures are hand-written; never copy real session logs into it.
- Claude Code's log format is internal and undocumented. Parse defensively: unknown event types
  are counted and ignored, a half-written last line is skipped, and `cwd` comes from inside the log
  (the project folder slug cannot be decoded back into a path).
