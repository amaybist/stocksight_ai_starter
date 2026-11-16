# Project: StockSight AI

## Project Overview
A full-stack stock market analysis and
prediction web application.

## Technology Stack
- Frontend: React
- Backend: Python
- Machine Learning: Python, Scikit-learn
- Database: To be finalized
- Charts: Interactive stock charts

## Main Features
1. Stock price prediction
2. Historical stock data
3. Technical indicators
4. Interactive charts
5. Financial news
6. User authentication
7. Model evaluation

## Development Instructions
- Explain changes before implementing them.
- Write clean, maintainable code.
- Keep frontend and backend separate.
- Avoid unnecessary dependencies.
- Explain important code so I can understand it.
- Do not remove existing working features.

## Current Architecture and Safety
- Frontend source is in `frontend/src`; FastAPI routes and data processing are in `backend/app/main.py`.
- `backend/app/storage.py` owns SQLite account data and session token handling. SQLite is initialized automatically; set `STOCKSIGHT_DB_PATH` to choose another file.
- Yahoo Finance via `yfinance` is the only configured market data/search/news provider. Never invent market prices, headlines, sources, or model performance when provider data is missing.
- Forecasts are experimental statistical estimates. Document the model, chronological evaluation, and limitations whenever prediction behavior changes.
- Put local configuration in the ignored project-root `.env` using `.env.example` as a template. Never commit real secrets. Set `STOCKSIGHT_TOKEN_SECRET` to a random value outside local development.
- Configure allowed browser origins in `CORS_ORIGINS`; do not use a permissive wildcard for account APIs.

## Verification Commands
- Frontend production build: from `frontend`, `npm run build`.
- Backend checks: from `backend`, `.venv\\Scripts\\python.exe -m unittest discover -s tests -v`.
- For API or database changes, keep tests deterministic by mocking external market data and using a temporary SQLite file.

## Data and Modeling Notes
- The forecast is a rolling 30-session linear trend, not a trained neural network. Its walk-forward evaluation is historical and should be shown next to the previous-close benchmark.
- The market overview intentionally uses selected indices and popular tickers; do not label that sample as exchange-wide gainers/losers.
- News entries must include source attribution and link to the provider’s original item. Keep an unavailable state when Yahoo Finance supplies no articles.
- User passwords are salted PBKDF2 hashes. Session tokens are signed, expire after 24 hours, and are revocable. Keep all authorization checks on the backend.
