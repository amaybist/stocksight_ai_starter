# Forecast and evaluation methodology

## Data and indicators

Daily adjusted OHLCV history is fetched from Yahoo Finance through yfinance. Records are sorted chronologically, duplicate dates are removed, invalid dates are discarded, and rows without a close are dropped. The API calculates 20-session SMA, 20/50-session EMA, RSI(14), MACD and its signal, 20-session Bollinger Bands (two standard deviations), and daily return. Indicators describe past observations; they are not trade instructions.

## Candidate baselines and estimate

StockSight currently compares two deliberately simple methods:

1. **Previous close:** use the most recent close as the estimate.
2. **Rolling linear trend:** fit ordinary least squares to the prior 30 closes and extrapolate to the requested horizon (1–30 sessions).

For sufficient history, the backend selects the method with lower RMSE on a trailing validation slice drawn only from the available training history. With fewer than 60 observations, it uses the rolling trend because there is not enough data for the selector. This is a baseline-selection demonstration, not a trained neural network and not evidence of future accuracy.

## Walk-forward evaluation

The last 20% of observations is held out as a chronological test period. The selection step uses only a trailing slice of the earlier 80% training period. During testing, each one-session estimate is generated from the preceding history, then the actual observation becomes available for the next walk-forward step. The API returns actual, selected-model estimate, and previous-close estimate for each test date, plus MAE, RMSE, MAPE, and R² for both methods.

MAPE is omitted if actual prices contain zero. R² is shown for context because it may be difficult to interpret for volatile price levels. Historical test results are descriptive and do not guarantee future performance. No confidence interval is shown: these baselines have not been calibrated to produce a statistically justified prediction interval.

## Limitations

- Data freshness, symbol coverage, and request throttling are controlled by Yahoo Finance.
- The dashboard does not model dividends, corporate events, transaction costs, or portfolio risk.
- The current evaluation is a single chronological holdout with a validation slice, not a full nested time-series cross-validation study.
- Estimates are educational only and are not financial advice.
