# Payments Quality Platform

[![CI](https://github.com/yonduudontaxx/payments-quality-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/yonduudontaxx/payments-quality-platform/actions/workflows/ci.yml)

A complete payment transaction testing ecosystem built with Fastify, TypeScript, and PostgreSQL.

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
npm run test:e2e          # Playwright E2E tests (auto-starts server if not running)
```

The E2E tests use Playwright's `webServer` config to automatically start the dev server when it isn't already running. `reuseExistingServer: true` means a manually started server is used as-is.

### Test Scripts Summary

| Command | Description | Requires |
|---------|-------------|---------|
| `npm run ci` | Full suite — all tests + Allure report | PostgreSQL |
| `npm run test:unit` | Jest unit tests — pure logic, no I/O | Nothing |
| `npm run test:integration` | Jest integration tests — hits the DB | PostgreSQL |
| `npm run test:e2e` | Playwright E2E tests — full HTTP flows | PostgreSQL |
| `npm run report` | Generate and open the Allure report | Previous test run |
| `npm run build` | TypeScript compilation | Nothing |
| `npm run migrate` | Run database migrations | PostgreSQL |

### Allure Report

Allure results are written to `allure-results/jest/` (unit + integration) and `allure-results/playwright/` (E2E) after each run. `npm run ci` generates the combined report in `allure-report/`. To open it:

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

**Retry behavior:** Failed deliveries are retried with exponential backoff at intervals of 2s, 4s, 8s, 16s, and 32s. A PostgreSQL advisory lock ensures the webhook worker is concurrency-safe across multiple server processes.

## Technical Highlights

- **Race-condition-safe balance checks** — payment authorization uses `SELECT ... FOR UPDATE` to lock the account row, preventing double-spends under concurrent requests.
- **Concurrent-safe webhook worker** — PostgreSQL advisory locks ensure only one worker processes the delivery queue at a time, even if multiple server instances are running.
- **DB-backed idempotency cache** — requests bearing an `Idempotency-Key` header are deduplicated via a PostgreSQL-backed cache with a 24-hour TTL, preventing duplicate payments from retried requests.
- **Exponential backoff retries** — webhook delivery retries follow the schedule `[2s, 4s, 8s, 16s, 32s]` before a delivery is marked permanently failed.
- **Full test pyramid** — unit tests validate pure logic in isolation, integration tests cover DB interactions, and Playwright E2E tests drive the full HTTP API to verify end-to-end behavior.

## CI

GitHub Actions runs the full test suite:

- on every push to `main` and every pull request
- daily at 04:00 UTC
- manually, from **Actions → CI → Run workflow** (or `gh workflow run ci.yml`)

```
type check → build → migrate → unit tests ─┬─→ integration tests ─┬─→ Allure report
                                           └─→ E2E tests ──────────┘
```

Each test job gets its own `postgres:16-alpine` service container. Before the E2E tests run, the workflow reads the running server's process environment and fails if `NODE_ENV` is not `test` or `DATABASE_URL` does not point at `payments_test`.

The `allure-report` artifact contains the combined report. Its **Environment** panel records the trigger (`push`, `pull_request`, `schedule` or `workflow_dispatch`), run id, commit, branch, and the server's runtime `NODE_ENV`, database and Node version. Playwright reports are uploaded on E2E failure.

Only pull-request runs cancel an in-progress run for the same ref; scheduled, manual and `main` runs always complete.

To view the latest run:

```bash
gh run list --workflow ci.yml --limit 5
gh run view --web
```

## Known Limitations

- **Simulation endpoints are unauthenticated** — In production, `/simulate/*` should be protected by API key or restricted to non-production environments
- **No webhook HMAC signatures** — Real payment gateways sign webhook payloads; this platform sends unsigned payloads
- **Simulation config is in-process** — Fault injection config is per-process and resets on restart; multi-replica deployments would need shared config (e.g., via Redis or DB)
- **Idempotency cache grows unboundedly** — TTL filtering prevents stale responses but rows are not actively deleted; a cleanup job would be needed in production
