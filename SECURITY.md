# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report them privately with [GitHub private vulnerability reporting](https://github.com/Alex90Jennings/clash-of-langs/security/advisories/new). Include steps to reproduce and the impact you expect. You'll get an acknowledgement within a few days, and a fix or mitigation plan once the issue is confirmed.

## Scope

Clash of Langs runs real processes, so these areas are especially relevant:

- **The battle API** (`/api/battle`): config validation and clamping in `src/lib/config.ts`, and anything that could reach a command line
- **The benchmark worker** (`worker/`): token authentication, process limits and container hardening
- **Resource exhaustion**: anything that gets around the per-challenge size, run or time limits

Clash of Langs never runs user-submitted code. Only the harnesses in `bench/` execute, with fixed arguments, a scrubbed environment, timeouts and their own process group. See the security model in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#security-model).

## Supported versions

Only the latest `main` branch is supported.
