# Deployment

## Runtime

Use one Node.js API process with a PostgreSQL database. The process serves the compiled frontend, API and Socket.IO. The current event dispatcher and authentication rate limiter store state in that process. Running multiple instances requires additional coordination work.

Build from the repository root with Node.js 22.12+:

```sh
npm ci
npm run typecheck
npm run build
npm run db:deploy -w @collabflow/api
npm start
```

Set NODE_ENV=production when starting the server. Set DATABASE_URL through the host's secret configuration and WEB_ORIGIN to the exact public HTTPS origin, for example https://collabflow.example. PORT defaults to 4000 and may be supplied by the host. A production process checks for a valid HTTPS origin, a configured database URL and the frontend build before listening.

## HTTPS and reverse proxy

Terminate public TLS at the hosting platform or reverse proxy and forward all application requests to the API process. Forward /socket.io polling requests and WebSocket upgrades as well as ordinary pages and /api requests.

Set TRUST_PROXY only to the addresses or CIDR ranges of the actual proxy. If the proxy connects from loopback, TRUST_PROXY=loopback is appropriate. The default trusts no proxy. The proxy must overwrite forwarded client headers so users cannot forge an address used by the rate limiter. Verify this against the chosen host's network layout.

Session cookies are Secure and HttpOnly in production. Frontend assets have immutable cache headers; HTML and authenticated API responses use no-store. The content security policy permits the application's scripts and Google Fonts.

## Email

Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and MAIL_FROM for the chosen email provider. Verify the sender through that provider and test a real delivered invitation before enabling public onboarding. See INVITATIONS.md for local preview details. File delivery is disabled in production.

## Health and shutdown

GET /api/health reports process liveness. GET /api/ready queries PostgreSQL and returns 503 when the database is unavailable. Use readiness for deployment traffic checks.

SIGTERM and SIGINT stop accepting connections, close Socket.IO and disconnect Prisma. The process allows up to ten seconds for shutdown.

## Verification before public release

The repository's CI runs typechecks, builds, migrations, API/socket tests, desktop/mobile browser tests and a separate HTTPS production smoke test. The smoke test launches the compiled production entry point behind a temporary local TLS proxy and checks frontend assets, SPA routes, readiness, registration, Secure/HttpOnly session cookies, session persistence, logout and shutdown.

Public hosting and provider credentials are not present in the repository. Public release verification remains pending until a host, database, HTTPS origin and email provider are configured. Once configured, verify registration, invitation delivery, protected task links and collaboration between independent accounts through the public URL.
