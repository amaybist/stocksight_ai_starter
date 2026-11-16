import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from fastapi import HTTPException

from app import main, storage


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        storage.DB_PATH = Path(self.temp_dir.name) / "test.db"
        storage.init_db()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_health_and_registration_login_logout(self):
        self.assertEqual(main.health()["status"], "ok")
        registered = main.register(main.Registration(email="demo@example.com", password="marketpass123", display_name="Demo"))
        token = registered["access_token"]
        bearer = f"Bearer {token}"
        user = main.current_user(bearer)
        self.assertEqual(user["email"], "demo@example.com")
        signed_in = main.login(main.Credentials(email="demo@example.com", password="marketpass123"))
        self.assertTrue(storage.read_token(signed_in["access_token"]))
        with self.assertRaises(HTTPException) as error:
            main.login(main.Credentials(email="demo@example.com", password="wrongpassword1"))
        self.assertEqual(error.exception.status_code, 401)
        added = main.add_watchlist(main.SymbolPayload(symbol="TCS"), user)
        self.assertEqual(added["symbol"], "TCS.NS")
        self.assertEqual(main.get_watchlist(user)["symbols"], ["TCS.NS"])
        self.assertEqual(main.update_preferences(main.ThemePayload(theme="light"), user)["theme"], "light")
        main.remove_watchlist("TCS", user)
        self.assertEqual(main.get_watchlist(user)["symbols"], [])
        main.logout(bearer, user)
        with self.assertRaises(HTTPException) as error:
            main.current_user(bearer)
        self.assertEqual(error.exception.status_code, 401)

    def test_indicator_edge_cases_and_forecast_horizon(self):
        dates = pd.date_range("2025-01-01", periods=80, freq="B")
        rising = pd.DataFrame({"Close": np.arange(100.0, 180.0)}, index=dates)
        result = main.add_indicators(rising)
        self.assertEqual(result["RSI14"].iloc[-1], 100)
        frame = pd.DataFrame({"Close": np.linspace(100, 120, 80)}, index=dates)
        with patch.object(main, "fetch_history", return_value=frame):
            response = main.forecast("TCS.NS", "5y", 5)
        self.assertEqual(response["horizon"], 5)
        self.assertIn(response["model"], {"30-session rolling linear trend", "Previous close"})
        user = main.register(main.Registration(email="saved@example.com", password="marketpass123", display_name="Saved"))
        account = main.current_user(f"Bearer {user['access_token']}")
        with patch.object(main, "fetch_history", return_value=frame):
            saved = main.create_prediction(main.PredictionRequest(symbol="TCS.NS", horizon=5), account)
        self.assertEqual(main.prediction_history(10, account)["items"][0]["id"], saved["id"])

    def test_walk_forward_evaluation_returns_comparison_points(self):
        dates = pd.date_range("2022-01-01", periods=180, freq="B")
        frame = pd.DataFrame({"Close": np.linspace(100, 160, len(dates))}, index=dates)
        with patch.object(main, "fetch_history", return_value=frame):
            report = main.evaluation("TCS.NS", "5y")
        self.assertGreater(report["test_observations"], 0)
        self.assertEqual(len(report["comparison"]), report["test_observations"])
        self.assertIn("actual", report["comparison"][0])
        self.assertIn("estimated", report["comparison"][0])

    def test_invalid_symbol_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            main.resolve_ticker("bad ticker")
        self.assertEqual(error.exception.status_code, 422)

    def test_company_profile_reports_provider_fields(self):
        with patch.object(main.yf, "Ticker") as ticker:
            ticker.return_value.get_info.return_value = {"longName": "Example Company", "sector": "Utilities", "country": "India"}
            profile = main.stock_profile("TCS.NS")
        self.assertTrue(profile["available"])
        self.assertEqual(profile["name"], "Example Company")
        self.assertEqual(profile["sector"], "Utilities")


if __name__ == "__main__":
    unittest.main()
