# Payments Quality Platform

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
| POST | `/payments` | Initiate a new payment (transitions to PENDING) |
| POST | `/payments/:id/authorize` | Authorize a pending payment |
| POST | `/payments/:id/capture` | Capture an authorized payment |
| POST | `/payments/:id/refund` | Refund a captured payment |
| GET | `/payments/:id` | Retrieve payment details and current state |
| POST | `/simulate/config` | Configure fault injection (timeout, decline rate) |
| DELETE | `/simulate/config` | Reset simulation to default (no faults) |
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
# Unit tests (no DB required)
npm run test:unit

# Integration tests (requires PostgreSQL)
docker compose up -d postgres
npm run migrate
npm run test:integration

# E2E tests (requires running server + PostgreSQL)
npm run dev &
npm run test:e2e
```

### Test Scripts Summary

| Command | Description | Requires |
|---------|-------------|---------|
| `npm run test:unit` | Jest unit tests — pure logic, no I/O | Nothing |
| `npm run test:integration` | Jest integration tests — hits the DB | PostgreSQL |
| `npm run test:e2e` | Playwright E2E tests — full HTTP flows | Server + PostgreSQL |
| `npm run build` | TypeScript compilation | Nothing |
| `npm run migrate` | Run database migrations | PostgreSQL |

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

## Known Limitations

- **Simulation endpoints are unauthenticated** — In production, `/simulate/*` should be protected by API key or restricted to non-production environments
- **No webhook HMAC signatures** — Real payment gateways sign webhook payloads; this platform sends unsigned payloads
- **Simulation config is in-process** — Fault injection config is per-process and resets on restart; multi-replica deployments would need shared config (e.g., via Redis or DB)
- **Idempotency cache grows unboundedly** — TTL filtering prevents stale responses but rows are not actively deleted; a cleanup job would be needed in production
