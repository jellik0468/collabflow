# Authentication

Registration and login create seven-day sessions. PostgreSQL stores a bcrypt password hash and a SHA-256 hash of the random session token. The browser stores the token in an HttpOnly, SameSite=Lax cookie with the Secure attribute in production. Logout revokes the session server-side and clears the cookie.

The browser uses the same origin for the UI and API. The Vite development server forwards `/api` to the Express server on port 4000. For production, route `/api` to Express on the same HTTPS origin as the frontend, and set `WEB_ORIGIN` to that exact origin. Authentication writes accept JSON and reject a non-matching browser Origin. Registration and login are rate-limited per IP. Configure Express to trust only the actual reverse proxy before exposing the service behind one. The default limiter stores counters in-process.

## Run locally

1. Start PostgreSQL, create a local database and copy `apps/api/.env.example` to `apps/api/.env`.
2. Set `DATABASE_URL` and `WEB_ORIGIN`. The example uses `http://localhost:5173`, so open the app using that hostname.
3. Run `npm ci` and `npm run db:deploy -w @collabflow/api`.
4. Run `npm run dev -w @collabflow/api` and `npm run dev -w @collabflow/web` in separate terminals.

## Verify

Point the shell's `DATABASE_URL` at a disposable PostgreSQL test database. With ports 4000 and 5173 free, run:

```sh
npm ci
npm run typecheck
npm run build
npm run db:deploy -w @collabflow/api
npm test
cd apps/web
npx playwright install chromium
npx playwright test
```

The API suite creates and removes its own users. Playwright creates accounts in the test database and leaves them there, so use a disposable database. CI provisions PostgreSQL and runs both suites.

The authenticated UI still contains the existing preview workspace. Account recovery and email verification are outside the current authentication scope.
