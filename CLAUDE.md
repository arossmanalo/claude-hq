# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Claude Office (repo `claude-hq`) is a local web app. It reads Claude Code's session logs and shows
agents as characters in a pixel-art corporate building: one office per project, one room per agent.
It also runs a router agent (the installed `claude` CLI in headless stream-json mode) that you chat
with from the browser; the router hands work to specialist subagents.

## Commands

- `npm start` builds the client and serves it on http://127.0.0.1:4317 (or the next free port).
- `npm run dev` runs the server with Vite in middleware mode (hot reload) on the same port.
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest), `npm run e2e` (Playwright).
- Run one test file: `npx vitest run tests/<name>.test.ts`; one test: add `-t "<test name>"`.
- Env: `OFFICE_PORT` (preferred port), `OFFICE_NO_OPEN=1` (don't open a browser),
  `OFFICE_LOG_LEVEL` (Fastify log level, default `warn`).

## Layout

- `src/server`: Fastify server, file watching, the router process runner. Run with `tsx`, never compiled.
- `src/client`: React app (Vite root is `src/client`, output `dist/client`).
- `src/shared`: types and zod schemas used by both sides. Everything crossing a boundary
  (a log line, a WebSocket message, a CLI stream event) is parsed with zod there.
- `tests`: Vitest unit tests. `e2e`: Playwright tests.

## Claude Code formats this app depends on (verified against CLI 2.1.316)

Headless router process:
- Command: `claude.exe -p --input-format stream-json --output-format stream-json --verbose
  --permission-prompts host --permission-prompt-tool stdio`.
  - Without `--permission-prompt-tool stdio`, every prompt is silently denied
    (`system:permission_denied`), and no request ever reaches the host.
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
