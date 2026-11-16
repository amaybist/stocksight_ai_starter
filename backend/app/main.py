"""StockSight AI HTTP API. Market data is provided by Yahoo Finance via yfinance."""

from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import logging
import os
import re
import threading
import time

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from . import storage

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("stocksight")
app = FastAPI(title="StockSight AI API", version="1.0.0", description="Historical market data and experimental stock analysis.")
origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type"])

storage.init_db()
if storage.TOKEN_SECRET == "development-only-change-this-secret" or "replace-with" in storage.TOKEN_SECRET or len(storage.TOKEN_SECRET) < 32:
    logger.warning("STOCKSIGHT_TOKEN_SECRET is a development or short value; configure a long random secret before deployment.")

STOCK_ALIASES = {
    "RELIANCE": "RELIANCE.NS", "TCS": "TCS.NS", "INFOSYS": "INFY.NS", "INFY": "INFY.NS",
    "SBI": "SBIN.NS", "POWERGRID": "POWERGRID.NS", "HDFC": "HDFCBANK.NS", "ICICI": "ICICIBANK.NS",
    "WIPRO": "WIPRO.NS", "ADANI": "ADANIENT.NS",
}
PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"}
_history_cache: dict[tuple[str, str], tuple[float, pd.DataFrame]] = {}
_profile_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


class Credentials(BaseModel):
    email: str = Field(min_length=6, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=128)


class Registration(Credentials):
    display_name: str = Field(min_length=1, max_length=80)


class SymbolPayload(BaseModel):
    symbol: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9.^=-]+$")


class ThemePayload(BaseModel):
    theme: str = Field(pattern=r"^(dark|light)$")


class PredictionRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9.^=-]+$")
    horizon: int = Field(default=1, ge=1, le=30)


def resolve_ticker(symbol: str) -> str:
    cleaned = symbol.strip().upper()
    if not re.fullmatch(r"[A-Z0-9.^=-]{1,30}", cleaned):
        raise HTTPException(status_code=422, detail="Enter a valid stock symbol, for example TCS.NS.")
    return STOCK_ALIASES.get(cleaned, cleaned)


def fetch_history(symbol: str, period: str = "2y") -> pd.DataFrame:
    ticker = resolve_ticker(symbol)
    if period not in PERIODS:
        raise HTTPException(status_code=422, detail="Unsupported historical period.")
    key = (ticker, period)
    now = time.monotonic()
    with _cache_lock:
        cached = _history_cache.get(key)
        if cached and now - cached[0] < 300:
            return cached[1].copy()
    try:
        frame = yf.download(ticker, period=period, interval="1d", auto_adjust=True, progress=False, timeout=12)
    except Exception as exc:
        logger.warning("Market data request failed for %s: %s", ticker, type(exc).__name__)
        raise HTTPException(status_code=502, detail="The market data provider could not be reached. Try again shortly.") from exc
    if frame is None or frame.empty:
        raise HTTPException(status_code=404, detail=f"No historical data found for {ticker}. Check the symbol or try a longer period.")
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)
    required = {"Open", "High", "Low", "Close", "Volume"}
    if not required.issubset(frame.columns):
        raise HTTPException(status_code=502, detail="The market data provider returned an unexpected data format.")
    frame = frame.loc[:, ["Open", "High", "Low", "Close", "Volume"]].copy()
    frame.index = pd.to_datetime(frame.index, errors="coerce")
    frame = frame.loc[~frame.index.isna()].sort_index()
    frame = frame[~frame.index.duplicated(keep="last")]
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna(subset=["Close"])
    if frame.empty:
        raise HTTPException(status_code=404, detail=f"No valid historical data found for {ticker}.")
    with _cache_lock:
        _history_cache[key] = (now, frame.copy())
    return frame


def add_indicators(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    close = out["Close"].astype(float)
    out["SMA20"] = close.rolling(20, min_periods=20).mean()
    out["EMA20"] = close.ewm(span=20, adjust=False).mean()
    out["EMA50"] = close.ewm(span=50, adjust=False).mean()
    spread = out["EMA20"] - out["EMA50"]
    out["EMA_CROSSOVER"] = None
    up_cross = (spread > 0) & (spread.shift(1) <= 0)
    down_cross = (spread < 0) & (spread.shift(1) >= 0)
    out.loc[up_cross, "EMA_CROSSOVER"] = "bullish crossover"
    out.loc[down_cross, "EMA_CROSSOVER"] = "bearish crossover"
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14, min_periods=14).mean()
    loss = (-delta.clip(upper=0)).rolling(14, min_periods=14).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    rsi = rsi.mask((loss == 0) & (gain > 0), 100).mask((loss == 0) & (gain == 0), 50)
    out["RSI14"] = rsi
    ema12, ema26 = close.ewm(span=12, adjust=False).mean(), close.ewm(span=26, adjust=False).mean()
    out["MACD"] = ema12 - ema26
    out["MACD_SIGNAL"] = out["MACD"].ewm(span=9, adjust=False).mean()
    out["BB_MIDDLE"] = close.rolling(20, min_periods=20).mean()
    deviation = close.rolling(20, min_periods=20).std()
    out["BB_UPPER"], out["BB_LOWER"] = out["BB_MIDDLE"] + 2 * deviation, out["BB_MIDDLE"] - 2 * deviation
    out["DAILY_RETURN"] = close.pct_change() * 100
    return out


def clean_value(value):
    if value is None or pd.isna(value) or not np.isfinite(float(value)):
        return None
    return float(value)


def rolling_prediction(values: np.ndarray, index: int, model_name: str) -> float:
    if model_name == "Previous close":
        return float(values[index - 1])
    training = values[max(0, index - 30):index]
    model = LinearRegression().fit(np.arange(len(training)).reshape(-1, 1), training)
    return float(model.predict([[len(training)]])[0])


def select_baseline(values: np.ndarray) -> str:
    """Select between two simple baselines using only a trailing validation slice."""
    if len(values) < 60:
        return "30-session rolling linear trend"
    validation_start = max(40, int(len(values) * 0.8))
    if validation_start >= len(values):
        return "30-session rolling linear trend"
    actual = values[validation_start:]
    trend = [rolling_prediction(values, i, "30-session rolling linear trend") for i in range(validation_start, len(values))]
    previous = [rolling_prediction(values, i, "Previous close") for i in range(validation_start, len(values))]
    return "Previous close" if mean_squared_error(actual, previous) <= mean_squared_error(actual, trend) else "30-session rolling linear trend"


def serialize_history(symbol: str, period: str):
    frame = add_indicators(fetch_history(symbol, period))
    keys = ["Open", "High", "Low", "Close", "Volume", "SMA20", "EMA20", "EMA50", "RSI14", "MACD", "MACD_SIGNAL", "BB_UPPER", "BB_MIDDLE", "BB_LOWER", "DAILY_RETURN"]
    rows = []
    for timestamp, row in frame.iterrows():
        values = {key.lower(): clean_value(row.get(key)) for key in keys}
        values["ema_crossover"] = row.get("EMA_CROSSOVER")
        values["date"] = timestamp.strftime("%Y-%m-%d")
        rows.append(values)
    closes = frame["Close"].astype(float)
    latest = float(closes.iloc[-1])
    previous = float(closes.iloc[-2]) if len(closes) > 1 else None
    ticker = resolve_ticker(symbol)
    change = latest - previous if previous is not None else None
    return {"symbol": ticker, "currency": "INR" if ticker.endswith((".NS", ".BO")) else "USD", "latest_close": latest, "previous_close": previous, "change": change, "change_percent": (change / previous) * 100 if previous else None, "as_of": frame.index[-1].strftime("%Y-%m-%d"), "history": rows}


def current_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to access this resource.")
    user_id = storage.read_token(authorization[7:])
    if user_id is None:
        raise HTTPException(status_code=401, detail="Your session is invalid or expired. Sign in again.")
    with storage.connection() as db:
        user = db.execute("SELECT id, email, display_name FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Account not found. Sign in again.")
    return dict(user)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "StockSight AI API", "data_provider": "Yahoo Finance via yfinance"}


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: Registration):
    email = payload.email.strip().lower()
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="Enter a name for your account.")
    if len(payload.password) < 10 or not any(char.isalpha() for char in payload.password) or not any(char.isdigit() for char in payload.password):
        raise HTTPException(status_code=422, detail="Use a password with at least 10 characters, including a letter and a number.")
    try:
        with storage.connection() as db:
            cursor = db.execute("INSERT INTO users(email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)", (email, display_name, storage.hash_password(payload.password), int(time.time())))
            db.execute("INSERT INTO preferences(user_id, theme) VALUES (?, 'dark')", (cursor.lastrowid,))
            user_id = cursor.lastrowid
    except Exception as exc:
        if "UNIQUE constraint failed" in str(exc):
            raise HTTPException(status_code=409, detail="An account with this email already exists.") from exc
        raise
    return {"access_token": storage.create_token(user_id), "token_type": "bearer", "user": {"id": user_id, "email": email, "display_name": display_name}}


@app.post("/api/auth/login")
def login(payload: Credentials):
    with storage.connection() as db:
        user = db.execute("SELECT id, email, display_name, password_hash FROM users WHERE email = ?", (payload.email.strip().lower(),)).fetchone()
    if not user or not storage.verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    return {"access_token": storage.create_token(user["id"]), "token_type": "bearer", "user": {"id": user["id"], "email": user["email"], "display_name": user["display_name"]}}


@app.get("/api/auth/me")
def profile(user=Depends(current_user)):
    with storage.connection() as db:
        preference = db.execute("SELECT theme FROM preferences WHERE user_id = ?", (user["id"],)).fetchone()
    return {**user, "theme": preference["theme"] if preference else "dark"}


@app.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None), user=Depends(current_user)):
    storage.revoke_token(authorization[7:])
    return {"status": "signed_out"}


@app.put("/api/auth/preferences")
def update_preferences(payload: ThemePayload, user=Depends(current_user)):
    with storage.connection() as db:
        db.execute("INSERT INTO preferences(user_id, theme) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme", (user["id"], payload.theme))
    return {"theme": payload.theme}


@app.get("/api/user/watchlist")
def get_watchlist(user=Depends(current_user)):
    with storage.connection() as db:
        rows = db.execute("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY created_at, symbol", (user["id"],)).fetchall()
    return {"symbols": [row["symbol"] for row in rows]}


@app.post("/api/user/watchlist", status_code=status.HTTP_201_CREATED)
def add_watchlist(payload: SymbolPayload, user=Depends(current_user)):
    ticker = resolve_ticker(payload.symbol)
    with storage.connection() as db:
        db.execute("INSERT OR IGNORE INTO watchlist(user_id, symbol, created_at) VALUES (?, ?, ?)", (user["id"], ticker, int(time.time())))
    return {"symbol": ticker, "saved": True}


@app.delete("/api/user/watchlist/{symbol}")
def remove_watchlist(symbol: str, user=Depends(current_user)):
    ticker = resolve_ticker(symbol)
    with storage.connection() as db:
        db.execute("DELETE FROM watchlist WHERE user_id = ? AND symbol = ?", (user["id"], ticker))
    return {"symbol": ticker, "saved": False}


@app.get("/api/stock/{symbol}/history")
def history(symbol: str, period: str = Query(default="2y", pattern=r"^(1d|5d|1mo|3mo|6mo|1y|2y|5y|max)$")):
    return serialize_history(symbol, period)


@app.get("/api/stocks/search")
def search_stocks(q: str = Query(min_length=1, max_length=80)):
    query = q.strip()
    if not query:
        return {"results": []}
    try:
        results = yf.Search(query, max_results=8).quotes
    except Exception as exc:
        logger.warning("Stock search unavailable: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Stock search is temporarily unavailable.") from exc
    return {"results": [{"symbol": item.get("symbol"), "name": item.get("shortname") or item.get("longname") or item.get("symbol"), "exchange": item.get("exchange"), "type": item.get("quoteType")} for item in results if item.get("symbol")]}


@app.get("/api/stock/{symbol}/profile")
def stock_profile(symbol: str):
    ticker = resolve_ticker(symbol)
    now = time.monotonic()
    with _cache_lock:
        cached = _profile_cache.get(ticker)
        if cached and now - cached[0] < 86_400:
            return dict(cached[1])
    try:
        info = yf.Ticker(ticker).get_info() or {}
    except Exception as exc:
        logger.warning("Company profile unavailable for %s: %s", ticker, type(exc).__name__)
        return {"symbol": ticker, "available": False, "message": "Company information is temporarily unavailable from Yahoo Finance."}
    profile = {"symbol": ticker, "name": info.get("longName") or info.get("shortName"), "exchange": info.get("exchange"), "currency": info.get("currency"), "sector": info.get("sector"), "industry": info.get("industry"), "country": info.get("country"), "website": info.get("website"), "employees": info.get("fullTimeEmployees"), "summary": info.get("longBusinessSummary")}
    if not profile["name"]:
        return {"symbol": ticker, "available": False, "message": "Yahoo Finance did not return company information for this symbol."}
    result = {**profile, "available": True}
    with _cache_lock:
        _profile_cache[ticker] = (now, result)
    return result


@app.get("/api/market/overview")
def market_overview():
    index_specs = [("^NSEI", "NIFTY 50"), ("^BSESN", "SENSEX"), ("^NSEBANK", "NIFTY BANK")]
    stock_specs = [(symbol, symbol.replace(".NS", "")) for symbol in ("RELIANCE.NS", "TCS.NS", "INFY.NS", "SBIN.NS", "POWERGRID.NS")]

    def summary(spec):
        symbol, name = spec
        try:
            item = serialize_history(symbol, "5d")
            return {"symbol": symbol, "name": name, "price": item["latest_close"], "change": item["change"], "change_percent": item["change_percent"], "as_of": item["as_of"]}
        except HTTPException:
            return {"symbol": symbol, "name": name, "available": False}

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(summary, index_specs + stock_specs))
    indices, stocks = results[:len(index_specs)], results[len(index_specs):]
    available = sum(1 for item in indices if item.get("price") is not None)
    return {"provider": "Yahoo Finance", "indices": indices, "stocks": stocks, "as_of": datetime.now(timezone.utc).isoformat(), "message": None if available else "Market data is temporarily unavailable from the configured provider."}


@app.get("/api/market/news")
def market_news(symbol: str | None = None, limit: int = Query(default=10, ge=1, le=30)):
    ticker = resolve_ticker(symbol) if symbol else "^NSEI"
    try:
        raw_items = yf.Ticker(ticker).get_news(count=limit, tab="news") or []
    except Exception as exc:
        logger.warning("News request unavailable for %s: %s", ticker, type(exc).__name__)
        return {"provider": "Yahoo Finance", "available": False, "articles": [], "message": "News is temporarily unavailable from the configured provider."}
    articles = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, dict):
            content = item
        canonical = content.get("canonicalUrl") or item.get("canonicalUrl") or {}
        click_through = content.get("clickThroughUrl") or item.get("clickThroughUrl") or {}
        provider = content.get("provider") or item.get("provider") or {}
        if isinstance(provider, dict):
            source = provider.get("displayName") or provider.get("name")
        else:
            source = provider
        url = (
            (canonical.get("url") if isinstance(canonical, dict) else canonical)
            or (click_through.get("url") if isinstance(click_through, dict) else click_through)
            or content.get("link")
            or item.get("link")
        )
        title = content.get("title") or item.get("title")
        if not title or not isinstance(url, str) or not url.startswith(("https://", "http://")):
            continue
        articles.append({
            "title": title,
            "source": source or "Yahoo Finance",
            "published_at": content.get("pubDate") or content.get("displayTime") or item.get("pubDate"),
            "url": url,
        })
    return {"provider": "Yahoo Finance", "available": bool(articles), "articles": articles, "message": None if articles else "No recent articles were returned by the provider."}


@app.get("/api/stock/{symbol}/evaluation")
def evaluation(symbol: str, period: str = Query(default="5y", pattern=r"^(1y|2y|5y|max)$")):
    close = fetch_history(symbol, period)["Close"].dropna().astype(float)
    if len(close) < 100:
        raise HTTPException(status_code=422, detail="At least 100 historical sessions are required for a meaningful chronological evaluation.")
    values = close.to_numpy()
    split = max(60, int(len(values) * 0.8))
    selected_model = select_baseline(values[:split])
    actual = values[split:].tolist()
    predicted = [rolling_prediction(values, index, selected_model) for index in range(split, len(values))]
    naive = [rolling_prediction(values, index, "Previous close") for index in range(split, len(values))]
    if len(actual) < 2:
        raise HTTPException(status_code=422, detail="Not enough test observations for evaluation.")
    def metrics(predictions):
        return {"mae": float(mean_absolute_error(actual, predictions)), "rmse": float(np.sqrt(mean_squared_error(actual, predictions))), "mape": float(np.mean(np.abs((np.array(actual) - predictions) / np.array(actual))) * 100) if all(actual) else None, "r2": float(r2_score(actual, predictions))}
    comparison = [{"date": close.index[split + offset].strftime("%Y-%m-%d"), "actual": float(actual[offset]), "estimated": float(predicted[offset]), "previous_close": float(naive[offset])} for offset in range(len(actual))]
    return {"symbol": resolve_ticker(symbol), "model": selected_model, "selection": "Lower RMSE on a trailing validation slice within the training period", "baseline_model": "Previous close", "test_observations": len(actual), "evaluation_start": close.index[split].strftime("%Y-%m-%d"), "evaluation_end": close.index[-1].strftime("%Y-%m-%d"), "metrics": metrics(np.array(predicted)), "baseline_metrics": metrics(np.array(naive)), "comparison": comparison, "note": "Models were selected on earlier validation dates and evaluated walk-forward on a later chronological test period. Results do not guarantee future performance."}


@app.get("/api/stock/{symbol}/forecast")
def forecast(symbol: str, period: str = Query(default="5y", pattern=r"^(1y|2y|5y|max)$"), horizon: int = Query(default=1, ge=1, le=30)):
    close = fetch_history(symbol, period)["Close"].dropna().astype(float)
    if len(close) < 30:
        raise HTTPException(status_code=422, detail="At least 30 historical sessions are needed for this baseline estimate.")
    values = close.to_numpy()
    # The forecast is the documented trend estimate. Keep the previous-close
    # benchmark in evaluation, but do not use it as the forecast itself because
    # that baseline always repeats the latest observed price.
    model_name = "30-session rolling linear trend"
    window = close.tail(30).to_numpy()
    if model_name == "Previous close":
        predicted = float(close.iloc[-1])
    else:
        model = LinearRegression().fit(np.arange(len(window)).reshape(-1, 1), window)
        predicted = max(0.0, float(model.predict([[len(window) - 1 + horizon]])[0]))
    reference = float(close.iloc[-1])
    return {"symbol": resolve_ticker(symbol), "horizon": horizon, "last_close": reference, "estimated_next_close": predicted, "estimated_change_percent": (predicted / reference - 1) * 100 if reference else 0, "model": model_name, "as_of": close.index[-1].strftime("%Y-%m-%d"), "warning": "Experimental 30-session linear trend. Compare it with the previous-close benchmark in historical evaluation; it may be less accurate. Not financial advice. No confidence interval is provided."}


@app.post("/api/stock/predictions")
def create_prediction(payload: PredictionRequest, user=Depends(current_user)):
    ticker = resolve_ticker(payload.symbol)
    close = fetch_history(ticker, "5y")["Close"].dropna().astype(float)
    if len(close) < 30:
        raise HTTPException(status_code=422, detail="At least 30 historical sessions are needed for this baseline estimate.")
    model_name = select_baseline(close.to_numpy())
    window = close.tail(30).to_numpy()
    if model_name == "Previous close":
        predicted = float(close.iloc[-1])
    else:
        model = LinearRegression().fit(np.arange(len(window)).reshape(-1, 1), window)
        predicted = max(0.0, float(model.predict([[len(window) - 1 + payload.horizon]])[0]))
    reference = float(close.iloc[-1])
    created = int(time.time())
    with storage.connection() as db:
        cursor = db.execute("INSERT INTO predictions(user_id, symbol, horizon, reference_price, predicted_price, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (user["id"], ticker, payload.horizon, reference, predicted, model_name, created))
    return {"id": cursor.lastrowid, "symbol": ticker, "horizon": payload.horizon, "reference_price": reference, "predicted_price": predicted, "change_percent": (predicted / reference - 1) * 100 if reference else 0, "model": model_name, "as_of": close.index[-1].strftime("%Y-%m-%d"), "generated_at": datetime.fromtimestamp(created, timezone.utc).isoformat(), "warning": "Experimental baseline selected from earlier validation data, not financial advice. No confidence interval is provided."}


@app.get("/api/user/predictions")
def prediction_history(limit: int = Query(default=50, ge=1, le=100), user=Depends(current_user)):
    with storage.connection() as db:
        rows = db.execute("SELECT id, symbol, horizon, reference_price, predicted_price, model, created_at FROM predictions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", (user["id"], limit)).fetchall()
    return {"items": [{**dict(row), "change_percent": (row["predicted_price"] / row["reference_price"] - 1) * 100 if row["reference_price"] else 0, "generated_at": datetime.fromtimestamp(row["created_at"], timezone.utc).isoformat()} for row in rows]}
