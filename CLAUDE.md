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

## Rules for this repo

- The server binds to 127.0.0.1 only and makes no outbound network calls.
- The repo is public. Test fixtures are hand-written; never copy real session logs into it.
- Claude Code's log format is internal and undocumented. Parse defensively: unknown event types
  are counted and ignored, a half-written last line is skipped, and `cwd` comes from inside the log
  (the project folder slug cannot be decoded back into a path).
