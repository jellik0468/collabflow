# Authentication foundation

Implemented: POST /api/auth/register, POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout. Passwords hashed using bcrypt cost 12; 256-bit random session cookies are HttpOnly, SameSite=Lax, Secure in production, and backed by hashed tokens with seven-day expiry and logout revocation.

Requires PostgreSQL DATABASE_URL and `npm run db:deploy -w @collabflow/api` before API use. Production hardening remains: rate limiting, CSRF mitigation, email verification, reset flow, secure reverse-proxy configuration, and integration tests with PostgreSQL. Do not deploy this initial authentication foundation publicly yet.
