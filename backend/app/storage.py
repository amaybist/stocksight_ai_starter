"""Small SQLite store for StockSight accounts and per-user data."""

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import base64
from contextlib import contextmanager
from pathlib import Path


DB_PATH = Path(os.getenv("STOCKSIGHT_DB_PATH", str(Path(__file__).resolve().parents[1] / "stocksight.db")))

# Read project-level .env without requiring a dotenv package. Existing process
# environment values always take precedence.
_env_file = Path(__file__).resolve().parents[2] / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _key, _value = _line.split("=", 1)
            os.environ.setdefault(_key.strip(), _value.strip().strip("\"'"))

# Refresh values after loading .env.
DB_PATH = Path(os.getenv("STOCKSIGHT_DB_PATH", str(DB_PATH)))
TOKEN_SECRET = os.getenv("STOCKSIGHT_TOKEN_SECRET", "development-only-change-this-secret")
TOKEN_TTL_SECONDS = 60 * 60 * 24


@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
        db.commit()
    finally:
        db.close()


def init_db():
    with connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS watchlist (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            symbol TEXT NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, symbol)
        );
        CREATE TABLE IF NOT EXISTS preferences (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            theme TEXT NOT NULL DEFAULT 'dark'
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            symbol TEXT NOT NULL, horizon INTEGER NOT NULL, reference_price REAL NOT NULL,
            predicted_price REAL NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_predictions_user_created ON predictions(user_id, created_at DESC);
        """)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"pbkdf2_sha256$310000${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, rounds, salt, expected = encoded.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def create_token(user_id: int) -> str:
    payload = json.dumps({"sub": user_id, "exp": int(time.time()) + TOKEN_TTL_SECONDS, "nonce": secrets.token_urlsafe(12)}, separators=(",", ":")).encode()
    body = base64.urlsafe_b64encode(payload).rstrip(b"=").decode()
    signature = hmac.new(TOKEN_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    token = f"{body}.{signature}"
    with connection() as db:
        db.execute("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)", (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + TOKEN_TTL_SECONDS))
        db.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
    return token


def read_token(token: str) -> int | None:
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(TOKEN_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if payload["exp"] < int(time.time()):
            return None
        user_id = int(payload["sub"])
        with connection() as db:
            active = db.execute("SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = ? AND expires_at >= ?", (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()))).fetchone()
        return user_id if active else None
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


def revoke_token(token: str):
    with connection() as db:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),))
