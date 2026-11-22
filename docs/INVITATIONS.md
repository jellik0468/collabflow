# Workspace invitations

Owners send invitations from Members. Invitees sign in or register with the invited email address and explicitly accept the link to join as members. Tokens contain 256 random bits, are stored as SHA-256 hashes and expire after seven days. Acceptance consumes the token and creates membership in one transaction. Repeating acceptance returns the existing membership, while removing that membership prevents the accepted link from adding the user again.

The link carries its token in the URL fragment. The frontend applies a no-referrer policy. The API accepts tokens in JSON request bodies and returns invitation status without returning raw tokens.

## Email configuration

Configure an SMTP provider with environment variables in the API process:

- SMTP_HOST
- SMTP_PORT, defaulting to 587
- SMTP_USER and SMTP_PASSWORD when the provider requires authentication
- MAIL_FROM using a sender authorized by the provider
- WEB_ORIGIN using the frontend's public origin

Port 465 uses implicit TLS. Other ports require STARTTLS. Production invitation creation returns a service-unavailable error until email is configured. Sending failures remove the pending invitation. External SMTP delivery requires provider credentials and sender verification.

## Local preview

Set MAIL_MODE=file and MAIL_DIRECTORY=.local-mail when running the API locally. Each email is written as a private JSON file containing its recipient and invitation text. The directory is ignored by git. Open the link from the JSON text to test joining. File delivery is disabled when NODE_ENV=production.

Playwright explicitly enables this local transport and verifies the invitation link through a second browser session. Tests use synthetic accounts and require a disposable PostgreSQL database.
