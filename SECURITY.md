# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/yonduudontaxx/payments-quality-platform/security/advisories/new)). Do not open a public issue for a suspected vulnerability.

Include the affected endpoint or file, steps to reproduce, and the impact you expect. The aim is to acknowledge reports within 5 working days and to post an update on the advisory at least every 14 days until it is resolved or declined.

This project is a mock payment gateway for testing. It holds no real funds or card data, but reports about flaws in its payment, idempotency, webhook or validation logic are welcome.

## Supported versions

Only the latest commit on `main` is supported. Fixes are not backported.

## Automated security checks

[`.github/workflows/security.yml`](.github/workflows/security.yml) runs on every push to `main`, every pull request to `main`, weekly on Monday, and on demand:

| Job | Tool | Fails the run when |
|-----|------|--------------------|
| CodeQL | `github/codeql-action` with the `security-extended` query suite for JavaScript/TypeScript | Results are uploaded to code scanning; alerts are triaged there |
| Semgrep | Semgrep CE with the `p/owasp-top-ten` and `p/typescript` rule packs | Any finding; SARIF is uploaded to code scanning |
| Secret scan | gitleaks over the full git history (checksum-verified release binary) | Any secret is detected |
| npm audit | `npm audit --audit-level=high` | A high or critical advisory affects any dependency |

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the API security test suite (`npm run test:security`) as the **Security tests** job; the README's [Security testing](README.md#security-testing) section lists every case.

Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) proposes weekly npm and GitHub Actions updates after a 7-day cooldown. Every third-party action is pinned to a full commit SHA.

## Suppressed findings

None.
