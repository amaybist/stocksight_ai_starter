# StockSight architecture

## Request flow

```text
React/Vite browser
    ├── historical prices, indicators, forecasts, market overview, search, news
    │       └── FastAPI routes → yfinance/Yahoo Finance
    └── bearer-authenticated account requests
            └── FastAPI auth and user routes → SQLite
```

The browser calls the backend using `VITE_API_URL` (default `http://127.0.0.1:8000`). FastAPI allows only origins listed in `CORS_ORIGINS`. The shared root `.env` is loaded by both Vite and the backend; Vite exposes only variables prefixed with `VITE_` to browser code.

## Persistence

`backend/app/storage.py` creates SQLite tables for:

- `users`: unique email, display name, salted PBKDF2 password hash, creation timestamp.
- `sessions`: SHA-256 hashes of signed bearer tokens and their expiry, enabling revocation at sign-out.
- `watchlist`: per-user normalized symbols with a compound primary key.
- `preferences`: per-user dark/light appearance selection.
- `predictions`: per-user symbol, horizon, reference and estimated prices, model label, and timestamp.

Database access uses parameterized SQL through Python’s built-in `sqlite3`. Set `STOCKSIGHT_DB_PATH` to move the database. The default database is ignored by Git. The schema is initialized with `CREATE TABLE IF NOT EXISTS`; there is no migration framework yet.

## External provider behavior

yfinance supplies price history, ticker search results, and source-linked news. History is sorted, deduplicated, checked for required fields, and cached in memory for five minutes. Provider failures return a safe error or an explicit unavailable result. The market pulse covers three selected indices and a small set of popular stocks; it is not an exchange-wide scanner. Yahoo Finance does not require an API key for this integration, but availability and rate limits are outside this app’s control.

## Account security boundaries

Passwords are salted and hashed with PBKDF2-HMAC-SHA256 (310,000 rounds). Signed tokens expire after 24 hours; only their hashes are persisted. Account routes verify the token and owning user on every request. Configure a random `STOCKSIGHT_TOKEN_SECRET`, serve the app over HTTPS in deployment, and keep `.env` private. The current browser client stores the bearer token in localStorage; a hardened public deployment should move to secure HttpOnly cookies or an identity provider, add rate limiting and account recovery, and review the deployment’s CSP and threat model.

## API documentation

FastAPI generates OpenAPI documentation at `/docs` and `/openapi.json`. A user-facing endpoint list and local setup are in the root README.
