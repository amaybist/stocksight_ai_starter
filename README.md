# StockSight AI

StockSight AI is an educational stock analysis dashboard built with React and FastAPI. It displays historical prices and technical indicators using Yahoo Finance data, and offers a small statistical trend estimate with a chronological walk-forward evaluation. It is not a trading system or investment advice.

## Features

- Search by company name or ticker using Yahoo Finance search suggestions.
- Stock details with provider-returned company profile information and latest OHLC values.
- Daily historical price ranges from one day to maximum available history.
- Market pulse for NIFTY 50, SENSEX, NIFTY Bank, and a clearly limited set of popular stocks.
- Interactive historical close chart and volume chart.
- SMA, EMA, RSI, MACD, Bollinger Bands, daily return, and reported volume.
- Experimental 1–30 session linear trend estimate, separated from actual market data.
- Walk-forward chronological evaluation compared with a previous-close baseline.
- Yahoo Finance sourced company/market headlines with links to the original articles, when available.
- SQLite accounts, password hashing, expiring/revocable bearer sessions, per-user watchlists, appearance preference, and saved estimates.
- Dark and light appearance modes.

The project does not include a portfolio/trading system, account email verification or password reset, or an independent marketing landing page. Yahoo Finance may rate-limit requests or omit data; unavailable results are shown as unavailable. Stock coverage and article availability depend on the provider.

## Technology and layout

- Frontend: React 18, Vite, CSS, Lucide icons.
- Backend: FastAPI, pandas, NumPy, yfinance, scikit-learn.
- Persistence: SQLite using Python’s standard `sqlite3` module.
- Forecast: rolling linear trend over the most recent 30 closes. Evaluation is walk-forward and chronological; it is not a trained LSTM and does not establish future accuracy.

```text
backend/app/main.py       FastAPI routes, provider/data processing, baseline model
backend/app/storage.py    SQLite schema, password hashing, signed sessions
backend/tests/test_api.py API, auth, persistence, and forecast checks
frontend/src/App.jsx      Dashboard and interactive views
frontend/src/styles.css   Responsive dashboard styling and themes
docs/ARCHITECTURE.md      Data flow, storage, security, and provider notes
docs/ML_METHODOLOGY.md    Forecast selection and chronological evaluation
.env.example              Shared frontend/backend environment template
```

## Run locally (PowerShell)

From the project root, configure the shared environment file:

```powershell
Copy-Item .env.example .env
```

Before using accounts beyond a local demo, replace `STOCKSIGHT_TOKEN_SECRET` in `.env` with a long random secret. For example:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Install and start the backend in one terminal:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Install and start the frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`). FastAPI docs are at `http://127.0.0.1:8000/docs`; health is at `/api/health`.

The shared root `.env` is loaded by the backend and Vite. `VITE_API_URL` selects the backend URL in the browser, `CORS_ORIGINS` is a comma-separated allowlist, `STOCKSIGHT_TOKEN_SECRET` signs sessions, and `STOCKSIGHT_DB_PATH` optionally selects the SQLite file. Do not commit `.env`; the repository ignores it.

## API overview

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | API/provider status |
| POST | `/api/auth/register` | Create account and session |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Current user and appearance preference (Bearer token) |
| POST | `/api/auth/logout` | Revoke current session (Bearer token) |
| PUT | `/api/auth/preferences` | Save dark/light preference (Bearer token) |
| GET/POST | `/api/user/watchlist` | Read or add watchlist item (Bearer token) |
| DELETE | `/api/user/watchlist/{symbol}` | Remove watchlist item (Bearer token) |
| GET | `/api/user/predictions` | Saved estimates (Bearer token) |
| GET | `/api/stocks/search?q=...` | Provider-backed ticker search |
| GET | `/api/stock/{symbol}/profile` | Provider-backed company information |
| GET | `/api/market/overview` | Selected market indices and popular symbols |
| GET | `/api/market/news?symbol=TCS.NS` | Source-linked provider news |
| GET | `/api/stock/{symbol}/history?period=2y` | Historical prices and indicators |
| GET | `/api/stock/{symbol}/forecast?horizon=5` | Unsaved experimental baseline estimate |
| POST | `/api/stock/predictions` | Generate and save an estimate (Bearer token) |
| GET | `/api/stock/{symbol}/evaluation?period=5y` | Walk-forward metrics and previous-close comparison |

Every account-only route requires `Authorization: Bearer <access_token>`. Registration requires a password of at least 10 characters with a letter and a number. Sessions expire after 24 hours and can be revoked by sign-out.

Full request and response schemas are available from the generated OpenAPI page at `/docs` when the backend is running.

## Prediction methodology

The API compares a previous-close estimate with a linear trend fit to the prior 30 closes. It selects the method with lower RMSE on a trailing validation slice of the earlier training data, then evaluates it on a later chronological holdout using walk-forward predictions. The report includes actual and estimated values, MAE, RMSE, MAPE, R², dates, and a same-date previous-close benchmark. This is a deliberately simple statistical baseline, not an LSTM or an AI accuracy claim. Evaluation is historical and may not represent future results. Confidence bounds are omitted because this baseline has not been calibrated to provide them. See [the methodology](docs/ML_METHODOLOGY.md) for details.

Price history is cached in memory for five minutes to reduce duplicate downloads. SQLite is created automatically at `backend/stocksight.db` unless `STOCKSIGHT_DB_PATH` is set. The backend normalizes date ordering, removes duplicate dates, filters invalid closes, and returns safe provider errors.

## Verification

Run the backend checks from the `backend` directory:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Run the frontend production build from the `frontend` directory:

```powershell
npm run build
```

Yahoo Finance data and search/news endpoints require network access to Yahoo Finance but no API key. A news API key is not currently required or configured.
