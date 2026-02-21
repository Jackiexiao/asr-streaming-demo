# Repository Guidelines

## Project Structure & Module Organization
This repository contains independent streaming ASR demos grouped by vendor:
- `deepgram/`: Node + Next.js app with a WebSocket proxy (`server.js`), shared helpers in `lib/`, and unit tests in `test/lib/`.
- `aliyun/`: Next.js App Router demo with token issuance in `app/api/token/route.ts`.
- `volcengine/`: Next.js app plus a custom WebSocket bridge in `server.js`, protocol helpers in `lib/`, and tests in `test/`.
- `chrome-safari-asr/`: static browser-native speech recognition comparison (`index.html`).

Keep vendor logic inside its own folder; avoid cross-demo imports.

## Build, Test, and Development Commands
Install dependencies per demo:
- `cd <demo> && pnpm install`

Run locally:
- `cd deepgram && pnpm run dev` (serves demo/proxy on `http://localhost:8081`)
- `cd aliyun && pnpm run dev`
- `cd volcengine && pnpm run dev` (custom server + Next.js on `:3000`)

Production sanity check (inside any Next-based demo):
- `pnpm run build`
- `pnpm run start`

Run tests (Node built-in runner):
- `cd deepgram && node --test test/lib/*.test.js`
- `cd volcengine && node --test test/*.test.js`

## Coding Style & Naming Conventions
- Use 2-space indentation and keep functions focused.
- Match existing style in each module:
  - backend/helper JS uses CommonJS (`require`, `module.exports`)
  - Next UI code uses TS/TSX where present (`app/*.tsx`).
- Prefer descriptive file names by responsibility (examples: `audio.js`, `volc-protocol.js`, `transcript-display.js`).

## Testing Guidelines
- Add or update tests whenever changing PCM conversion, protocol framing/parsing, or transcript assembly behavior.
- Keep tests deterministic; avoid real network calls in unit tests.
- Test files should end with `.test.js` and live under the corresponding demo’s `test/` directory.

## Commit & Pull Request Guidelines
- Follow the commit pattern used in history: `feat(scope): ...`, `fix(scope): ...`, `refactor: ...`, `chore: ...`.
- Keep commits scoped to one demo/vendor when possible.
- PRs should include: purpose, affected folders, verification commands, and screenshots/GIFs for UI changes.

## Security & Configuration Tips
- Copy `.env.example` to `.env.local` per demo; never commit secrets.
- Keep API keys and token signing on the server side (`server.js` or API routes), not in browser scripts.
