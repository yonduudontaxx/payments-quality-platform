# Payments Quality Platform

[![CI](https://github.com/yonduudontaxx/payments-quality-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/yonduudontaxx/payments-quality-platform/actions/workflows/ci.yml)
[![Security](https://github.com/yonduudontaxx/payments-quality-platform/actions/workflows/security.yml/badge.svg)](https://github.com/yonduudontaxx/payments-quality-platform/actions/workflows/security.yml)

A complete payment transaction testing ecosystem built with Fastify, TypeScript, and PostgreSQL.

**Live test report:** [https://yonduudontaxx.github.io/payments-quality-platform/](https://yonduudontaxx.github.io/payments-quality-platform/)

## Overview

The Payments Quality Platform is a mock payment gateway and automated test harness designed for testing payment flows end-to-end without requiring a real payment processor. It exposes a realistic REST API for account management, payment authorization/capture/refund, webhook delivery simulation, and fault injection — giving teams a self-contained environment to validate payment logic at every layer of the test pyramid.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Fastify API Server                      │
│                                                         │
│  ┌───────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ Accounts  │  │ Payments │  │    Webhooks         │  │
│  │ Module    │  │ Module   │  │    Module           │  │
│  └───────────┘  └──────────┘  └────────────────────┘  │
│                                                         │
│  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │  Idempotency     │  │   Simulation             │   │
│  │  Plugin          │  │   Module                 │   │
│  └──────────────────┘  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                    PostgreSQL 16
```

## Payment State Machine

```
PENDING ──authorize──► AUTHORIZED ──capture──► CAPTURED ──refund──► REFUNDED
    │                      │
    └──(insufficient)───────┴──(simulated decline)──► FAILED
```

A payment begins in the `PENDING` state. Authorization checks the account balance (using `FOR UPDATE` locking) and transitions to `AUTHORIZED` on success, or `FAILED` if funds are insufficient or the simulation module declines the transaction. An authorized payment can be captured (funds deducted) or refunded after capture.

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/accounts` | Create a new account with an initial balance |
| GET | `/accounts/:id` | Retrieve account details and current balance |
| POST | `/payments/authorize` | Reserve funds → `authorized` |
| POST | `/payments/:id/capture` | Settle an authorized payment → `captured` |
| POST | `/payments/:id/refund` | Refund a captured payment → `refunded`, restores balance |
| GET | `/payments/:id` | Retrieve payment details and current state |
| POST | `/simulate/config` | Configure fault injection (timeout, decline rate) |
| GET | `/simulate/config` | Read current simulation config |
| DELETE | `/simulate/config` | Reset simulation to defaults (no faults) |
| POST | `/webhooks/config` | Set the webhook delivery URL |
| GET | `/webhooks/events` | Inspect the webhook event queue |

## Setup

### Prerequisites

- Node.js 24
- Docker (for PostgreSQL)

### Install and Run

```bash
git clone <repo>
cd payments-quality-platform
npm install
docker compose up -d postgres
npm run migrate
npm run dev
```

The server will be available at `http://localhost:3000`.

## Testing

The project implements a full test pyramid: unit tests, integration tests, and E2E tests.

```bash
# Run all tests and generate the Allure report
npm run ci

# Run individual tiers
npm run test:unit         # Jest unit tests (no DB required)
npm run test:integration  # Jest integration tests (requires PostgreSQL)
npm run test:security     # Jest API security tests (requires PostgreSQL)
npm run test:e2e          # Playwright E2E tests (auto-starts server if not running)
```

The E2E tests use Playwright's `webServer` config to automatically start the dev server when it isn't already running. `reuseExistingServer: true` means a manually started server is used as-is.

### Test Scripts Summary

| Command | Description | Requires |
|---------|-------------|---------|
| `npm run ci` | Full suite — all tests + Allure report | PostgreSQL |
| `npm run test:unit` | Jest unit tests — pure logic, no I/O | Nothing |
| `npm run test:integration` | Jest integration tests — hits the DB | PostgreSQL |
| `npm run test:security` | Jest API security tests — see [Security testing](#security-testing) | PostgreSQL |
| `npm run test:e2e` | Playwright E2E tests — full HTTP flows | PostgreSQL |
| `npm run report` | Generate and open the Allure report | Previous test run |
| `npm run build` | TypeScript compilation | Nothing |
| `npm run migrate` | Run database migrations | PostgreSQL |

### Allure Report

Allure results are written to `allure-results/jest/` (unit + integration) and `allure-results/playwright/` (E2E) after each run. `npm run ci` generates the combined report in `allure-report/`. CI publishes the latest report from `main` to [GitHub Pages](https://yonduudontaxx.github.io/payments-quality-platform/). To open a local report:

```bash
npm run report
```

## Simulation / Fault Injection

The simulation module lets you inject failures to test error handling and resilience.

**Configure faults:**

```bash
curl -X POST http://localhost:3000/simulate/config \
  -H "Content-Type: application/json" \
  -d '{"timeout_ms": 500, "decline_rate": 0.3}'
```

- `timeout_ms` — artificial delay added to payment processing (milliseconds)
- `decline_rate` — probability (0.0–1.0) that an authorization is declined regardless of balance

**Reset to defaults (no faults):**

```bash
curl -X DELETE http://localhost:3000/simulate/config
```

## Webhook Simulation

The webhook module records payment lifecycle events and delivers them to a configurable endpoint with automatic retries.

**Register a delivery URL:**

```bash
curl -X POST http://localhost:3000/webhooks/config \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-endpoint.example.com/webhook"}'
```

**Inspect the event queue:**

```bash
curl http://localhost:3000/webhooks/events
```

Returns the list of queued/delivered webhook events, including delivery status and retry count.

**Signed deliveries:** every delivery carries three headers so the receiver can authenticate it:

| Header | Value |
|--------|-------|
| `X-Signature` | `sha256=<hex>`: HMAC-SHA256 of `${X-Timestamp}.${X-Delivery-Id}.${rawBody}` keyed with `WEBHOOK_SIGNING_SECRET` |
| `X-Timestamp` | Unix time in seconds when the delivery was signed |
| `X-Delivery-Id` | The webhook event id; stable across retries so receivers can deduplicate |

`createWebhookVerifier` in `src/modules/webhooks/webhook.signing.ts` is the reference receiver: it compares signatures in constant time, rejects timestamps more than 5 minutes from the receiver's clock, and rejects a delivery id it has already accepted or that falls outside `[A-Za-z0-9_-]{1,128}`. `WEBHOOK_SIGNING_SECRET` must be set when `NODE_ENV=production`; other environments fall back to a fixed test secret.

**Retry behavior:** Failed deliveries are retried with exponential backoff at intervals of 2s, 4s, 8s, 16s, and 32s. A PostgreSQL advisory lock ensures the webhook worker is concurrency-safe across multiple server processes.

## Security testing

`npm run test:security` runs the suite in `test/security/` against the real Fastify app and PostgreSQL. CI runs it as the **Security tests** job on every push and pull request.

| File | Tests | What it proves |
|------|------:|----------------|
| `webhook-signing.test.ts` | 32 | A valid signature is accepted; a tampered body, tampered timestamp or wrong secret is rejected; timestamps more than 5 minutes old or in the future are rejected; a replayed delivery id is rejected, a signature replayed under a different delivery id is rejected as `invalid_signature`, a pinned known-answer digest covers the delivery id, and a replay is rejected including when re-signed; a failed verification does not burn the id; missing headers, non-`sha256` schemes, truncated or non-hex digests, non-numeric timestamps and delivery ids outside `[A-Za-z0-9_-]{1,128}` are rejected |
| `webhook-delivery.test.ts` | 5 | The worker's real HTTP delivery verifies against the raw body; a captured delivery replayed to the receiver is rejected; a captured delivery replayed under a fresh delivery id fails as `invalid_signature`; a body modified in transit fails verification; retries keep the same delivery id |
| `idempotency-abuse.test.ts` | 6 | Reusing an `Idempotency-Key` with a different amount or metadata returns `422 IDEMPOTENCY_KEY_REUSED` and moves no money; the rejection does not leak the original response; a reordered but identical body still replays; five concurrent requests reusing one key with different bodies create exactly one transaction; a capture key reused with a body is rejected |
| `input-tampering.test.ts` | 23 | `amount_cents` that is negative, zero, fractional, over `MAX_AMOUNT_CENTS`, beyond bigint or safe-integer range, a string, `null`, an array or an object returns `400` and leaves the balance unchanged; unknown body fields are rejected; oversized `initial_balance_cents` returns `400`; malformed JSON returns `400`, a body over 1 MiB `413`, an unsupported content type `415`; `__proto__` keys are rejected |
| `sql-injection.test.ts` | 48 | Seven injection payloads in the path parameters of four routes return `4xx`, never `500`, and the response leaks no SQL, driver or stack details; injected `account_id` returns `400` with no rows written; injected `owner_name` and metadata are stored verbatim; injected query strings return `400`; a `pg_sleep` payload does not delay the response |
| `state-machine-races.test.ts` | 5 | Eight concurrent captures of one authorization: exactly one succeeds. Eight concurrent refunds: exactly one succeeds and the balance is credited once, with or without distinct idempotency keys. A capture/refund race never refunds an uncaptured payment. Sixteen concurrent authorizations cannot overdraw the account |
| `error-disclosure.test.ts` | 6 | An unexpected exception and a masked database error return a generic `500` with no message, stack, file path or SQL; validation, malformed-JSON and not-found errors expose only `error`, `message` and `statusCode`; no `X-Powered-By` or `Server` header |
| `rate-limiting.test.ts` | 3 | A client over `RATE_LIMIT_MAX` requests per minute (default 300) gets `429 RATE_LIMITED` with `Retry-After` before validation or the database runs; responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining`; the limit is tracked per client address |
| `cors.test.ts` | 12 | With no `CORS_ORIGIN`, no origin is granted and preflights are not approved; an allowlisted origin is echoed with `Vary: Origin`; other origins and look-alikes (suffix, prefix, scheme, port, `null`) get no grant; each entry in a comma-separated allowlist works; `CORS_ORIGIN=*` never becomes a wildcard; credentials are never allowed |

Static and supply-chain checks run in the **Security** workflow; see [SECURITY.md](SECURITY.md).

## Technical Highlights

- **Race-condition-safe balance checks** — payment authorization uses `SELECT ... FOR UPDATE` to lock the account row, preventing double-spends under concurrent requests.
- **Concurrent-safe webhook worker** — PostgreSQL advisory locks ensure only one worker processes the delivery queue at a time, even if multiple server instances are running.
- **DB-backed idempotency cache** — requests bearing an `Idempotency-Key` header are deduplicated via a PostgreSQL-backed cache with a 24-hour TTL, preventing duplicate payments from retried requests. The cache stores a SHA-256 fingerprint of the request body, so reusing a key with a different body returns `422` instead of replaying the first response.
- **Rate limiting** — `@fastify/rate-limit` caps every route at `RATE_LIMIT_MAX` requests per client per minute.
- **Signed webhooks** — HMAC-SHA256 signatures with timestamp tolerance and delivery-id replay protection.
- **Exponential backoff retries** — webhook delivery retries follow the schedule `[2s, 4s, 8s, 16s, 32s]` before a delivery is marked permanently failed.
- **Full test pyramid** — unit tests validate pure logic in isolation, integration tests cover DB interactions, and Playwright E2E tests drive the full HTTP API to verify end-to-end behavior.

## CI

`security.yml` runs CodeQL, Semgrep, gitleaks and `npm audit` on every push to `main`, every pull request and weekly; see [SECURITY.md](SECURITY.md).


GitHub Actions runs the full test suite:

- on every push to `main` and every pull request
- daily, scheduled for 04:23 UTC. GitHub queues scheduled runs and does not guarantee the start time; since October 2026 they have started 4–8 hours late
- manually, from **Actions → CI → Run workflow** (or `gh workflow run ci.yml`)

```
type check → build → unit tests ─┬─→ integration tests ─┬─→ Allure report
                                 ├─→ security tests ────┤
                                 └─→ E2E tests ──────────┘
```

The unit-test job has no database, so a unit test that touches PostgreSQL fails in CI. The integration, security and E2E jobs each get their own `postgres:16-alpine` service container and run migrations first. Before the E2E tests run, the workflow reads the running server's process environment and fails if `NODE_ENV` is not `test` or `DATABASE_URL` does not point at `payments_test`.

The latest combined report from `main` is published at **https://yonduudontaxx.github.io/payments-quality-platform/**. It is updated by push, scheduled and manual runs on `main` when the unit-test step passed or failed (rather than being skipped or cancelled) and the report contains at least one test, so a type-check, build or test-startup failure keeps the previous report. If the unit tests fail, the integration, security and E2E jobs are skipped and the published report holds the unit results only. Whenever report generation succeeds, the combined report is also uploaded as the `allure-report` artifact (90-day retention), including on pull requests. The report's **Environment** panel records the trigger (`push`, `pull_request`, `schedule` or `workflow_dispatch`), run id, commit, branch, and the server's runtime `NODE_ENV`, database and Node version. Playwright reports are uploaded on E2E failure. `LOG_LEVEL` sets the level of both the Fastify request log and the webhook worker log (default `info`). Without it, the request log is off under `NODE_ENV=test`; the E2E server runs with `LOG_LEVEL=info`, so **Server logs on failure** includes the request log.

Only pull-request runs cancel an in-progress run for the same ref; scheduled, manual and `main` runs always complete.

To view the latest run:

```bash
gh run list --workflow ci.yml --limit 5
gh run view --web
```

## Known Limitations

- **Simulation endpoints are unauthenticated** — In production, `/simulate/*` should be protected by API key or restricted to non-production environments
- **Simulation config is in-process** — Fault injection config is per-process and resets on restart; multi-replica deployments would need shared config (e.g., via Redis or DB)
- **Idempotency cache grows unboundedly** — TTL filtering prevents stale responses but rows are not actively deleted; a cleanup job would be needed in production
