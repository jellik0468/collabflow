# CollabFlow

A collaborative project management application built with React, TypeScript, Express, PostgreSQL, Prisma and Socket.IO.

## Local development

Use Node.js 22.12+ and PostgreSQL. Copy `apps/api/.env.example` to `apps/api/.env` and configure the local database and frontend origin.

```sh
npm ci
npm run db:deploy -w @collabflow/api
npm run dev -w @collabflow/api
```

In another terminal, run `npm run dev -w @collabflow/web`. Open the hostname configured in WEB_ORIGIN.

## Verification

Point DATABASE_URL at a disposable PostgreSQL database before running tests.

```sh
npm run typecheck
npm run build
npm run db:deploy -w @collabflow/api
npm test
cd apps/web
npx playwright install chromium
npx playwright test
cd ../..
npm run test:production
```

The HTTPS production smoke test requires OpenSSL and a Playwright Chromium installation. It runs the compiled production server behind a temporary local HTTPS proxy and removes its synthetic account afterward.

## MVP status

| Feature | Implemented behavior | Verification |
| --- | --- | --- |
| Authentication | Registration, login, logout, session persistence and expiry | PostgreSQL and browser tests |
| Workspaces | Create, rename and switch | PostgreSQL and browser tests |
| Projects | Create, edit, archive and Overview | PostgreSQL and browser tests |
| Tasks | Create, edit, delete, assign, prioritize and date | PostgreSQL and browser tests |
| Kanban | Drag between statuses and use keyboard/touch status controls | API and browser tests |
| Collaboration | Session-authenticated Socket.IO project updates | Socket and multi-page browser tests |
| Permissions | Backend workspace membership and owner/member rules | PostgreSQL authorization tests |
| Dashboard | Actual counts, active projects and assigned open tasks | PostgreSQL and browser tests |
| Comments | Member conversations and author-only deletion | PostgreSQL and multi-page browser tests |
| Invitations | Hashed expiring links, email binding and atomic acceptance | Local mail previews and browser tests. External SMTP remains pending configuration |
| Notifications | Recipient inbox, unread count and persistent read state | PostgreSQL and browser tests |
| Dark mode | Persisted theme control | Browser tests |

Search and shareable desktop/mobile task panels are also implemented. Hosting, public HTTPS and external email delivery still require deployment configuration and verification.

## Production

Build both workspaces, apply migrations to the target database, configure environment variables, then run `npm start`. The API process serves the built frontend, API and Socket.IO at the same origin.

See [deployment instructions](docs/DEPLOYMENT.md), [authentication](docs/AUTHENTICATION.md) and [invitations](docs/INVITATIONS.md).
