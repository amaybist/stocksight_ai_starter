import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, BrainCircuit, ChartNoAxesCombined, CircleHelp, Clock3, Search, ShieldCheck, UserRound, Newspaper, TrendingUp, LogOut } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const QUICK_STOCKS = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "SBIN.NS", "POWERGRID.NS"];

async function apiRequest(path, options = {}, token = "") {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || "The request could not be completed.");
  return body;
}

function formatMoney(value, currency = "USD") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
function number(value) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}



function PriceChart({ rows, showBands = false, currency = "USD" }) {
  const [activeIndex, setActiveIndex] = useState(null);

  const data = (rows || [])
    .map((row) => {
      const close = Number(row.close ?? row.Close);
      const rawDate = row.date ?? row.Date ?? row.datetime ?? row.timestamp;

      return {
        close,
        upper: row.bb_upper == null && row.BB_UPPER == null ? NaN : Number(row.bb_upper ?? row.BB_UPPER),
        lower: row.bb_lower == null && row.BB_LOWER == null ? NaN : Number(row.bb_lower ?? row.BB_LOWER),
        date: rawDate ? String(rawDate).slice(0, 10) : "—",
      };
    })
    .filter((row) => Number.isFinite(row.close));

  if (data.length === 0) {
    return <div className="chart-empty">No historical price data available.</div>;
  }

  const W = 900;
  const H = 340;
  const left = 76;
  const right = 24;
  const top = 24;
  const bottom = 44;
  const plotW = W - left - right;
  const plotH = H - top - bottom;

  const values = data.flatMap((d) => showBands ? [d.close, d.upper, d.lower].filter(Number.isFinite) : [d.close]);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || Math.max(maxValue * 0.02, 1);
  const paddedMin = minValue - range * 0.08;
  const paddedMax = maxValue + range * 0.08;

  const x = (i) =>
    left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);

  const y = (price) =>
    top + ((paddedMax - price) / (paddedMax - paddedMin)) * plotH;

  const linePoints = data
    .map((d, i) => `${x(i)},${y(d.close)}`)
    .join(" ");
  const upperPoints = data.map((d, i) => Number.isFinite(d.upper) ? `${x(i)},${y(d.upper)}` : null).filter(Boolean).join(" ");
  const lowerPoints = data.map((d, i) => Number.isFinite(d.lower) ? `${x(i)},${y(d.lower)}` : null).filter(Boolean).join(" ");

  const areaPoints = [
    `${x(0)},${top + plotH}`,
    ...data.map((d, i) => `${x(i)},${y(d.close)}`),
    `${x(data.length - 1)},${top + plotH}`,
  ].join(" ");

  const tickCount = 5;
  const ticks = Array.from(
    { length: tickCount },
    (_, i) => paddedMax - (i / (tickCount - 1)) * (paddedMax - paddedMin)
  );

  const dateIndices = Array.from({ length: Math.min(5, data.length) }, (_, i) =>
    Math.round((i / (Math.min(5, data.length) - 1 || 1)) * (data.length - 1))
  ).filter((value, i, arr) => arr.indexOf(value) === i);

  const selectedIndex = activeIndex == null
    ? null
    : Math.max(0, Math.min(activeIndex, data.length - 1));

  const selected = selectedIndex == null ? null : data[selectedIndex];
  const tooltipX = selectedIndex == null ? 0 : x(selectedIndex);
  const tooltipY = selectedIndex == null ? 0 : y(selected.close);
  const tooltipWidth = 150;
  const tooltipHeight = 54;
  const tooltipLeft = Math.max(
    left,
    Math.min(tooltipX + 12, W - right - tooltipWidth)
  );
  const tooltipTop =
    tooltipY - tooltipHeight - 12 < top
      ? Math.min(tooltipY + 12, H - bottom - tooltipHeight)
      : tooltipY - tooltipHeight - 12;

  const formatPrice = (value) =>
    `${currency === "INR" ? "₹" : "$"}${value.toLocaleString(currency === "INR" ? "en-IN" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const handlePointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || data.length < 2) {
      setActiveIndex(0);
      return;
    }

    const svgX = ((event.clientX - rect.left) / rect.width) * W;
    const ratio = Math.max(0, Math.min(1, (svgX - left) / plotW));
    setActiveIndex(Math.round(ratio * (data.length - 1)));
  };

  return (
    <div className="interactive-chart">
      <svg
        className="interactive-price-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Historical closing price chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id="stockSightAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00d9e8" stopOpacity="0.24" />
            <stop offset="90%" stopColor="#00d9e8" stopOpacity="0.015" />
          </linearGradient>
          <filter id="stockSightLineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {ticks.map((tick, i) => (
          <g key={`tick-${i}`}>
            <line
              x1={left}
              y1={y(tick)}
              x2={W - right}
              y2={y(tick)}
              className="chart-gridline"
            />
            <text
              x={left - 12}
              y={y(tick) + 4}
              textAnchor="end"
              className="chart-axis-label"
            >
              {tick.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}

        <polygon points={areaPoints} fill="url(#stockSightAreaFill)" />

        <polyline
          points={linePoints}
          fill="none"
          stroke="#00d9e8"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          filter="url(#stockSightLineGlow)"
          opacity="0.25"
        />

        {showBands && upperPoints && <polyline points={upperPoints} fill="none" stroke="#9b8cff" strokeWidth="1.2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        {showBands && lowerPoints && <polyline points={lowerPoints} fill="none" stroke="#9b8cff" strokeWidth="1.2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}

        <polyline
          points={linePoints}
          fill="none"
          stroke="#00d9e8"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {dateIndices.map((index) => (
          <text
            key={`date-${index}`}
            x={x(index)}
            y={H - 12}
            textAnchor={
              index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"
            }
            className="chart-axis-label"
          >
            {data[index].date}
          </text>
        ))}

        {selected && (
          <g className="chart-hover">
            <line
              x1={tooltipX}
              y1={top}
              x2={tooltipX}
              y2={top + plotH}
              className="chart-crosshair"
            />
            <line
              x1={left}
              y1={tooltipY}
              x2={W - right}
              y2={tooltipY}
              className="chart-crosshair"
              opacity="0.45"
            />
            <circle
              cx={tooltipX}
              cy={tooltipY}
              r="7"
              fill="#00d9e8"
              opacity="0.18"
            />
            <circle
              cx={tooltipX}
              cy={tooltipY}
              r="3.5"
              fill="#00e5f2"
              stroke="#101216"
              strokeWidth="1.5"
            />

            <g transform={`translate(${tooltipLeft}, ${tooltipTop})`}>
              <rect
                width={tooltipWidth}
                height={tooltipHeight}
                rx="7"
                className="chart-tooltip-bg"
              />
              <text x="11" y="19" className="chart-tooltip-date">
                {selected.date}
              </text>
              <text x="11" y="40" className="chart-tooltip-price">
                {formatPrice(selected.close)}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

function VolumeChart({ rows = [] }) {
  const values = rows.slice(-90).map(row => Number(row.volume ?? row.Volume)).filter(Number.isFinite);
  if (!values.length) return <div className="chart-empty">Volume data is unavailable.</div>;
  const max = Math.max(...values, 1);
  const bar = 900 / values.length;
  return <svg className="volume-chart" viewBox="0 0 900 100" role="img" aria-label="Daily trading volume bars">
    {values.map((value, index) => <rect key={index} x={index * bar + bar * .18} y={96 - (value / max) * 88} width={Math.max(1, bar * .64)} height={(value / max) * 88} rx="1" fill="#00d9e8" opacity=".68" />)}
  </svg>;
}

function ForecastChart({ rows = [], forecast }) {
  const actual = rows.slice(-60).map(row => Number(row.close ?? row.Close)).filter(Number.isFinite);
  const estimate = Number(forecast?.estimated_next_close);
  if (!actual.length || !Number.isFinite(estimate)) return <div className="chart-empty">Forecast chart will appear when both price history and an estimate are available.</div>;
  const W = 900, H = 250, left = 18, right = 18, top = 24, bottom = 32;
  const min = Math.min(...actual, estimate), max = Math.max(...actual, estimate);
  const pad = (max - min || Math.max(max * .02, 1)) * .12;
  const low = min - pad, high = max + pad;
  const x = index => left + index * ((W - left - right) / (actual.length + 3));
  const y = value => top + ((high - value) / (high - low)) * (H - top - bottom);
  const actualLine = actual.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const forecastX = x(actual.length + 2);
  return <div className="forecast-chart-wrap"><svg className="forecast-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Actual closing prices and an experimental estimate ${forecast.horizon} sessions ahead`}>
    <line x1={left} y1={H - bottom} x2={W - right} y2={H - bottom} className="chart-gridline"/>
    <polyline points={actualLine} fill="none" stroke="#00d9e8" strokeWidth="2.2" vectorEffect="non-scaling-stroke"/>
    <line x1={x(actual.length - 1)} y1={y(actual.at(-1))} x2={forecastX} y2={y(estimate)} stroke="#a89bff" strokeWidth="2" strokeDasharray="7 6" vectorEffect="non-scaling-stroke"/>
    <circle cx={forecastX} cy={y(estimate)} r="5" fill="#a89bff"/>
    <text x={left} y={H - 8} className="chart-axis-label">Actual close · last {actual.length} sessions</text>
    <text x={Math.min(forecastX + 9, W - 220)} y={Math.max(top + 12, y(estimate) - 10)} className="forecast-chart-label">Estimate · +{forecast.horizon} sessions</text>
  </svg><div className="forecast-chart-legend"><span><i className="actual-dot"/>Historical close</span><span><i className="estimate-dash"/>Model estimate endpoint</span></div></div>;
}

function EvaluationChart({ rows = [] }) {
  const points = rows.slice(-120).filter(row => [row.actual, row.estimated, row.previous_close].every(value => Number.isFinite(Number(value))));
  if (!points.length) return <div className="chart-empty">Evaluation chart is unavailable.</div>;
  const series = [points.map(row => Number(row.actual)), points.map(row => Number(row.estimated)), points.map(row => Number(row.previous_close))];
  const all = series.flat(), min = Math.min(...all), max = Math.max(...all), padding = (max - min || 1) * .08;
  const x = index => 18 + index * (864 / Math.max(points.length - 1, 1));
  const y = value => 18 + ((max + padding - value) / ((max + padding) - (min - padding))) * 190;
  const line = values => values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  return <div><svg className="forecast-chart" viewBox="0 0 900 230" role="img" aria-label="Actual prices compared with model and previous close estimates"><polyline points={line(series[0])} fill="none" stroke="#00d9e8" strokeWidth="2" vectorEffect="non-scaling-stroke"/><polyline points={line(series[1])} fill="none" stroke="#a89bff" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/><polyline points={line(series[2])} fill="none" stroke="#f3b45a" strokeWidth="1.4" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/></svg><div className="forecast-chart-legend"><span><i className="actual-dot"/>Actual</span><span><i className="estimate-dash"/>Selected baseline</span><span><i className="previous-dash"/>Previous close</span></div><p className="data-attribution">Showing the most recent {points.length} held-out test sessions.</p></div>;
}



export default function App() {
  const [symbol, setSymbol] = useState("POWERGRID.NS");
  const [query, setQuery] = useState("POWERGRID.NS");
  const [period, setPeriod] = useState("2y");
  const [data, setData] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("overview");
  const requestId = useRef(0);
  const [market, setMarket] = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [news, setNews] = useState(null);
  const [newsFilter, setNewsFilter] = useState("");
  const [recent, setRecent] = useState(() => { try { return JSON.parse(localStorage.getItem("stocksight-recent") || "[]"); } catch { return []; } });
  const [predictionHistory, setPredictionHistory] = useState([]);
  const [theme, setTheme] = useState("dark");
  const [suggestions, setSuggestions] = useState([]);
  const [horizon, setHorizon] = useState(1);
  const [savedPrediction, setSavedPrediction] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem("stocksight-user") || "null"); } catch { return null; } });
  const [token, setToken] = useState(() => localStorage.getItem("stocksight-token") || "");
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("stocksight-watchlist") || '["POWERGRID.NS","RELIANCE.NS","TCS.NS"]'); }
    catch { return ["POWERGRID.NS", "RELIANCE.NS", "TCS.NS"]; }
  });

  useEffect(() => { localStorage.setItem("stocksight-watchlist", JSON.stringify(watchlist)); }, [watchlist]);
  useEffect(() => { localStorage.setItem("stocksight-recent", JSON.stringify(recent)); }, [recent]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  useEffect(() => {
    apiRequest("/api/market/overview").then(setMarket).catch(() => setMarket({ message: "Market overview is temporarily unavailable from Yahoo Finance." }));
  }, []);

  useEffect(() => {
    if (!token) return;
    apiRequest("/api/auth/me", {}, token).then(async (profile) => {
      setUser(profile); setTheme(profile.theme || "dark"); localStorage.setItem("stocksight-user", JSON.stringify(profile));
      const result = await apiRequest("/api/user/watchlist", {}, token);
      setWatchlist(result.symbols);
    }).catch(() => { localStorage.removeItem("stocksight-token"); localStorage.removeItem("stocksight-user"); setToken(""); setUser(null); });
  }, [token]);

  useEffect(() => {
    if (!token || tab !== "account") return;
    apiRequest("/api/user/predictions", {}, token).then(result => setPredictionHistory(result.items || [])).catch(() => setPredictionHistory([]));
  }, [token, tab, savedPrediction]);

  useEffect(() => {
    if (tab !== "news") return;
    apiRequest(`/api/market/news?symbol=${encodeURIComponent(symbol)}&limit=12`).then(setNews).catch((e) => setNews({ available: false, articles: [], message: e.message }));
  }, [tab, symbol]);

  useEffect(() => {
    if (tab !== "details") return;
    let active = true;
    setCompanyProfile(null);
    apiRequest(`/api/stock/${encodeURIComponent(symbol)}/profile`).then(profile => { if (active) setCompanyProfile(profile); }).catch(e => { if (active) setCompanyProfile({ available: false, message: e.message }); });
    return () => { active = false; };
  }, [tab, symbol]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || term.toUpperCase() === symbol) { setSuggestions([]); return; }
    const timer = setTimeout(() => apiRequest(`/api/stocks/search?q=${encodeURIComponent(term)}`).then((result) => setSuggestions(result.results || [])).catch(() => setSuggestions([])), 350);
    return () => clearTimeout(timer);
  }, [query, symbol]);

  async function loadStock(nextSymbol = query, nextPeriod = period) {
    const clean = nextSymbol.trim().toUpperCase().replace(/\s+/g, "");
    if (!clean) { setError("Enter a stock ticker, for example TCS.NS."); return; }
    const currentRequest = ++requestId.current;
    setLoading(true); setError(""); setSymbol(clean); setQuery(clean);
    setSavedPrediction(null);
    setRecent(items => [clean, ...items.filter(item => item !== clean)].slice(0, 6));
    try {
      const responses = await Promise.allSettled([
        apiRequest(`/api/stock/${encodeURIComponent(clean)}/history?period=${nextPeriod}`),
        apiRequest(`/api/stock/${encodeURIComponent(clean)}/forecast?period=5y&horizon=${horizon}`),
        apiRequest(`/api/stock/${encodeURIComponent(clean)}/evaluation?period=5y`),
      ]);
      if (currentRequest !== requestId.current) return;
      if (responses[0].status === "rejected") throw responses[0].reason;
      setData(responses[0].value);
      setSymbol(responses[0].value.symbol || clean);
      setQuery(responses[0].value.symbol || clean);
      setForecast(responses[1].status === "fulfilled" ? responses[1].value : null);
      setEvaluation(responses[2].status === "fulfilled" ? responses[2].value : null);
    } catch (e) {
      if (currentRequest !== requestId.current) return;
      setData(null); setForecast(null); setEvaluation(null);
      setError(`${e.message || "Unable to load stock data."} Make sure the FastAPI backend is running.`);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => { loadStock("POWERGRID.NS", "2y"); }, []);

  const latest = data?.history?.at(-1);
  const currency = data?.currency || (symbol.endsWith(".NS") || symbol.endsWith(".BO") ? "INR" : "USD");
  const money = value => formatMoney(value, currency);
  const changeUp = (data?.change ?? 0) >= 0;
  const chartRows = useMemo(() => data?.history || [], [data]);

  function toggleWatchlist() {
    const exists = watchlist.includes(symbol);
    setWatchlist(old => exists ? old.filter(s => s !== symbol) : [...old, symbol]);
    if (token) apiRequest(`/api/user/watchlist${exists ? `/${encodeURIComponent(symbol)}` : ""}`, { method: exists ? "DELETE" : "POST", ...(exists ? {} : { body: JSON.stringify({ symbol }) }) }, token).catch((e) => setError(e.message));
  }

  async function submitAuth(event) {
    event.preventDefault(); setAuthError("");
    try {
      const result = await apiRequest(`/api/auth/${authMode === "register" ? "register" : "login"}`, { method: "POST", body: JSON.stringify(authMode === "register" ? { email: authEmail, password: authPassword, display_name: displayName } : { email: authEmail, password: authPassword }) });
      if (authMode === "register") await Promise.all(watchlist.map(symbol => apiRequest("/api/user/watchlist", { method: "POST", body: JSON.stringify({ symbol }) }, result.access_token).catch(() => null)));
      localStorage.setItem("stocksight-token", result.access_token); localStorage.setItem("stocksight-user", JSON.stringify(result.user));
      setToken(result.access_token); setUser(result.user); setAuthPassword("");
    } catch (e) { setAuthError(e.message); }
  }

  async function signOut() {
    try { if (token) await apiRequest("/api/auth/logout", { method: "POST" }, token); } catch { /* Clear local credentials even if the API is offline. */ }
    localStorage.removeItem("stocksight-token"); localStorage.removeItem("stocksight-user"); setToken(""); setUser(null);
  }

  async function saveForecast() {
    if (!token) { setAuthError("Sign in to save this prediction to your history."); setTab("account"); return; }
    try {
      const prediction = await apiRequest("/api/stock/predictions", { method: "POST", body: JSON.stringify({ symbol, horizon }) }, token);
      setSavedPrediction(prediction);
    } catch (e) { setError(e.message); }
  }

  async function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (user && token) {
      try { await apiRequest("/api/auth/preferences", { method: "PUT", body: JSON.stringify({ theme: next }) }, token); }
      catch (e) { setError(e.message); }
    }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand brand-button" onClick={() => setTab("landing")} aria-label="StockSight home"><span className="brand-mark">S</span><span>STOCK<span className="brand-accent">SIGHT</span><small>AI MARKET INTELLIGENCE</small></span></button>
      <div className="side-label">WORKSPACE</div>
      {[["landing","Home",TrendingUp],["overview","Dashboard",ChartNoAxesCombined],["details","Stock details",TrendingUp],["prediction","AI Forecast",BrainCircuit],["indicators","Technical analysis",Activity],["news","Market news",Clock3],["account",user ? "My account" : "Sign in",UserRound]].map(([id,label,Icon]) =>
        <button key={id} className={`nav-item ${tab===id?"active":""}`} onClick={() => setTab(id)}><Icon size={17}/>{label}{id==="prediction"&&<span className="nav-pill">ML</span>}</button>
      )}
      <div className="side-label watch-label">WATCHLIST <button title={watchlist.includes(symbol) ? "Remove current stock" : "Add current stock"} aria-label={watchlist.includes(symbol) ? "Remove current stock from watchlist" : "Add current stock to watchlist"} onClick={toggleWatchlist}>{watchlist.includes(symbol) ? "−" : "+"}</button></div>
      {watchlist.map(s => <button key={s} className="watch-item" onClick={() => loadStock(s, period)}><span className="watch-dot"/><span>{s.replace(".NS","")}</span><span className="watch-open">↗</span></button>)}
      <div className="sidebar-bottom"><ShieldCheck size={16}/><span>Research demo<br/><b>Forecasts are experimental</b></span></div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumb">Markets <span>/</span> <b>{symbol}</b></div>
        <button className="topbar-right account-shortcut" onClick={() => setTab("account")}><span className={`status-dot ${loading ? "loading" : ""}`}/> {loading ? "UPDATING DATA" : data ? "HISTORICAL DATA" : "DATA OFFLINE"} <span className="avatar">{user?.display_name?.slice(0, 1).toUpperCase() || "AI"}</span></button>
      </header>

      <section className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-line"/> STOCK ANALYTICS PLATFORM</div><h1>Market <em>Overview</em></h1><p>Explore historical performance, technical indicators and experimental ML forecasts.</p></div>
        <div className="date-chip"><Clock3 size={14}/>{data?.as_of ? `Last data: ${data.as_of}` : "Waiting for data"}</div>
      </section>

      <form className="search-panel" onSubmit={e => { e.preventDefault(); loadStock(); }}>
        <div className="search-icon"><Search size={18}/></div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company or ticker: TCS, Reliance..." aria-label="Search company or stock ticker" autoComplete="off"/>
        <select value={period} onChange={e => { setPeriod(e.target.value); if (data) loadStock(symbol, e.target.value); }} aria-label="Historical period">
          <option value="1d">1 day</option><option value="5d">1 week</option><option value="1mo">1 month</option><option value="3mo">3 months</option><option value="6mo">6 months</option><option value="1y">1 year</option><option value="5y">5 years</option><option value="max">Max</option>
        </select>
        <button className="primary-button" type="submit" disabled={loading}>{loading ? "Loading..." : "Analyze stock →"}</button>
      </form>
      {suggestions.length > 0 && <div className="search-suggestions" role="listbox">{suggestions.map(item => <button type="button" role="option" key={`${item.symbol}-${item.exchange}`} onClick={() => { setQuery(item.symbol); setSuggestions([]); loadStock(item.symbol, period); }}><b>{item.symbol}</b><span>{item.name}</span><small>{item.exchange || item.type}</small></button>)}</div>}
      <div className="quick-tickers">{QUICK_STOCKS.map(s => <button key={s} onClick={() => loadStock(s, period)}>{s.replace(".NS","")}</button>)}</div>
      {error && <div className="error-banner"><CircleHelp size={17}/><span>{error}</span></div>}
      {tab === "overview" && <section className="panel market-overview"><PanelHeading title="Market pulse" badge={market?.provider || "MARKET DATA"}/>{market?.message && <p className="muted-copy">{market.message}</p>}<div className="market-grid">{(market?.indices || []).map(item => <div className="market-card" key={item.symbol}><span>{item.name}</span>{item.available === false ? <b>Unavailable</b> : <><strong>{number(item.price)}</strong><small className={item.change_percent >= 0 ? "positive" : "negative"}>{item.change_percent >= 0 ? "+" : ""}{number(item.change_percent)}%</small></>}</div>)}</div><div className="market-stock-row"><span>Popular stocks</span>{(market?.stocks || []).map(item => <button key={item.symbol} onClick={() => loadStock(item.symbol, period)}>{item.symbol.replace(".NS", "")} {item.available === false ? "—" : `${item.change_percent >= 0 ? "+" : ""}${number(item.change_percent)}%`}</button>)}</div>{market?.stocks?.some(item => item.available !== false) && <div className="sample-movers"><span>Daily movers among selected stocks</span>{[...market.stocks].filter(item => item.available !== false).sort((a,b) => b.change_percent-a.change_percent).slice(0,2).map(item => <button key={`up-${item.symbol}`} onClick={() => loadStock(item.symbol, period)}>{item.symbol.replace(".NS", "")} <b className="positive">+{number(item.change_percent)}%</b></button>)}{[...market.stocks].filter(item => item.available !== false).sort((a,b) => a.change_percent-b.change_percent).slice(0,2).map(item => <button key={`down-${item.symbol}`} onClick={() => loadStock(item.symbol, period)}>{item.symbol.replace(".NS", "")} <b className="negative">{number(item.change_percent)}%</b></button>)}</div>}<p className="data-attribution">Yahoo Finance · selected sample only, not exchange-wide rankings · {market?.as_of ? new Date(market.as_of).toLocaleString() : "loading"}</p></section>}
      {tab === "overview" && recent.length > 1 && <div className="recent-row"><span>Recently viewed</span>{recent.filter(item => item !== symbol).map(item => <button key={item} onClick={() => loadStock(item, period)}>{item.replace(".NS", "")}</button>)}</div>}

      {tab === "account" ? (user ? <section className="panel account-panel"><PanelHeading title="Your account" badge="PERSONAL WORKSPACE"/><div className="account-summary"><div className="account-avatar">{user.display_name?.slice(0,1).toUpperCase()}</div><div><h2>{user.display_name}</h2><p>{user.email}</p></div></div><div className="settings-row"><span>Appearance <small>Preference saved with your account</small></span><button className="secondary-button" onClick={toggleTheme}>Switch to {theme === "dark" ? "light" : "dark"} theme</button></div><h3>Saved predictions</h3>{savedPrediction ? <div className="snapshot-row"><span>{savedPrediction.symbol} · {savedPrediction.horizon} session</span><b>{money(savedPrediction.predicted_price)}</b></div> : <p className="muted-copy">Predictions you save from the forecast page will appear here.</p>}<button className="text-button" onClick={() => setTab("prediction")}>Generate a forecast →</button><div className="saved-prediction-list">{predictionHistory.map(item => <div className="snapshot-row" key={item.id}><span>{item.symbol} · {item.horizon} session{item.horizon === 1 ? "" : "s"} · {new Date(item.generated_at).toLocaleDateString()}</span><b>{money(item.predicted_price)}</b></div>)}</div><button className="secondary-button" onClick={signOut}><LogOut size={15}/> Sign out</button></section> : <section className="panel auth-panel"><PanelHeading title={authMode === "register" ? "Create your account" : "Welcome back"} badge="STOCKSIGHT"/><p className="muted-copy">Save your watchlist and experimental forecast history to this device’s StockSight database.</p><form onSubmit={submitAuth} className="auth-form">{authMode === "register" && <label>Your name<input required minLength="1" maxLength="80" value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>}<label>Email<input type="email" required autoComplete="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} /></label><label>Password<input type="password" required minLength={authMode === "register" ? 10 : 8} autoComplete={authMode === "register" ? "new-password" : "current-password"} value={authPassword} onChange={e => setAuthPassword(e.target.value)} /></label>{authError && <div className="error-banner">{authError}</div>}<button className="primary-button" type="submit">{authMode === "register" ? "Create account" : "Sign in"}</button></form><button className="text-button" onClick={() => { setAuthMode(authMode === "register" ? "login" : "register"); setAuthError(""); }}>{authMode === "register" ? "Already have an account? Sign in" : "New to StockSight? Create an account"}</button></section>) :
      tab === "details" ? <CompanyDetails profile={companyProfile} symbol={symbol} latest={latest} data={data} rows={chartRows} period={period} currency={currency}/> :      tab === "news" ? <section className="panel"><PanelHeading title={`${symbol} market news`} badge={news?.provider || "LIVE SOURCE"}/><input className="news-filter" aria-label="Filter headlines" placeholder="Filter these headlines…" value={newsFilter} onChange={e => setNewsFilter(e.target.value)}/>{news?.articles?.length ? <div className="news-list">{news.articles.filter(article => `${article.title} ${article.source}`.toLowerCase().includes(newsFilter.toLowerCase())).map((article,index) => <a className="news-item" href={article.url} target="_blank" rel="noreferrer" key={`${article.url}-${index}`}><span className="news-source"><Newspaper size={14}/>{article.source || "Yahoo Finance"} · {article.published_at ? new Date(article.published_at).toLocaleDateString() : "Date unavailable"}</span><b>{article.title}</b><span className="news-link">Open original article ↗</span></a>)}</div> : <div className="empty-state"><Newspaper/><h3>News is unavailable</h3><p>{news?.message || "Waiting for the configured provider. No headlines are fabricated."}</p></div>}</section> :
      tab === "indicators" ? <section className="panel"><PanelHeading title="Technical indicators" badge="DAILY"/> <p className="muted-copy">Indicators describe historical price and volume behavior. They are not guaranteed buy or sell signals.</p><div className="indicator-grid">
        <Metric label="RSI (14)" value={number(latest?.rsi14)} note="Below 30 often considered oversold; above 70 overbought"/>
        <Metric label="MACD" value={number(latest?.macd)} note="MACD line"/>
        <Metric label="MACD Signal" value={number(latest?.macd_signal)} note="Signal line"/>
        <Metric label="EMA 20" value={money(latest?.ema20)} note="Short-term exponential average"/>
        <Metric label="EMA 50" value={money(latest?.ema50)} note="Medium-term exponential average"/>
        <Metric label="EMA crossover" value={latest?.ema_crossover || "No recent cross"} note="20-session EMA crossing the 50-session EMA"/>
        <Metric label="SMA 20" value={money(latest?.sma20)} note="20-session simple average"/>
        <Metric label="Bollinger upper" value={money(latest?.bb_upper)} note="20-session average + 2 standard deviations"/>
        <Metric label="Bollinger middle" value={money(latest?.bb_middle)} note="20-session simple moving average"/>
        <Metric label="Bollinger lower" value={money(latest?.bb_lower)} note="20-session average − 2 standard deviations"/>
        <Metric label="Daily return" value={`${number(latest?.daily_return)}%`} note="Change from the prior session"/>
        <Metric label="Volume" value={number(latest?.volume)} note="Latest reported session"/>
      </div><section className="panel technical-chart"><PanelHeading title={`${symbol} Bollinger bands`} badge="PRICE + VOLATILITY"/><PriceChart rows={chartRows} showBands currency={currency}/><div className="chart-legend"><span>Close</span><span className="band-legend">Bollinger bands · 20 sessions</span></div><PanelHeading title="Trading volume" badge="LAST 90 SESSIONS"/><VolumeChart rows={chartRows}/></section></section> :
      tab === "prediction" ? <section className="panel"><PanelHeading title="Experimental price estimate" badge="STATISTICAL BASELINE"/><div className="prediction-controls"><label>Forecast horizon<select value={horizon} onChange={e => { const next = Number(e.target.value); setHorizon(next); apiRequest(`/api/stock/${encodeURIComponent(symbol)}/forecast?period=5y&horizon=${next}`).then(setForecast).catch(e => setError(e.message)); }}><option value="1">Next session</option><option value="5">5 sessions</option><option value="10">10 sessions</option><option value="20">20 sessions</option><option value="30">30 sessions</option></select></label><button className="secondary-button" onClick={saveForecast}>Save to prediction history</button></div><div className="forecast-grid">
        <Metric label="Last close" value={money(forecast?.last_close)} note="Latest available close"/>
        <Metric label="Estimated close" value={money(forecast?.estimated_next_close)} note={forecast?.model || "Waiting for baseline"}/>
        <Metric label="Estimated change" value={`${forecast?.estimated_change_percent == null ? "—" : number(forecast.estimated_change_percent)+"%"}`} note="Trend baseline, not a validated forecast"/>
      </div><p className="disclaimer">{forecast?.warning || "Forecasts are experimental and not financial advice."}</p><section className="forecast-visual panel"><PanelHeading title="Actual prices and estimated endpoint" badge="DISTINCT SERIES"/><ForecastChart rows={chartRows} forecast={forecast}/></section>
      {savedPrediction && <p className="success-note">Saved estimate #{savedPrediction.id} for {savedPrediction.symbol}.</p>}{evaluation && <><div className="evaluation-heading"><h3>Historical walk-forward evaluation</h3><span>{evaluation.evaluation_start} – {evaluation.evaluation_end}</span></div><div className="metrics-row"><Metric label="Trend MAE" value={money(evaluation.metrics?.mae)} note="Lower is better"/><Metric label="Trend RMSE" value={money(evaluation.metrics?.rmse)} note="Lower is better"/><Metric label="Trend MAPE" value={`${number(evaluation.metrics?.mape)}%`} note="Mean absolute percentage error"/><Metric label="Naive baseline MAE" value={money(evaluation.baseline_metrics?.mae)} note="Previous close benchmark"/><Metric label="Naive baseline RMSE" value={money(evaluation.baseline_metrics?.rmse)} note="Previous close benchmark"/><Metric label="Test observations" value={number(evaluation.test_observations)} note="Chronological walk-forward dates"/></div><p className="muted-copy">{evaluation.note} R²: {number(evaluation.metrics?.r2)} (context only; volatile price levels can make it difficult to interpret).</p><EvaluationChart rows={evaluation.comparison || []}/></>}</section> :
      tab === "landing" ? <section className="landing-page"><div className="landing-hero"><div><div className="eyebrow"><span className="eyebrow-line"/> STOCK ANALYSIS, WITH CONTEXT</div><h2>See the market<br/><em>more clearly.</em></h2><p>Explore historical prices, familiar technical indicators, and experimental forecasts with their evaluation shown up front.</p><div className="landing-actions"><button className="primary-button" onClick={() => setTab("overview")}>Open market dashboard</button><button className="secondary-button" onClick={() => setTab("prediction")}>Explore forecasts</button></div></div><div className="landing-market"><span>MARKET DATA STATUS</span><strong>{market?.indices?.some(item => item.price != null) ? "Provider connected" : "Waiting for provider"}</strong><p>Yahoo Finance historical data · daily observations</p><div className="landing-market-price">{money(data?.latest_close)} <small>{data?.symbol || symbol}</small></div><p>Latest available close · {data?.as_of || "No quote loaded"}</p></div></div><div className="landing-features"><article><ChartNoAxesCombined/><h3>Explore performance</h3><p>Review historical prices with selectable daily data ranges and an interactive chart.</p></article><article><Activity/><h3>Read indicators</h3><p>Inspect momentum, moving averages, Bollinger bands, and reported volume.</p></article><article><BrainCircuit/><h3>Evaluate estimates</h3><p>Compare an experimental baseline against a previous-close benchmark on held-out dates.</p></article></div><div className="landing-how"><div><span className="side-label">HOW IT WORKS</span><h3>Market data first.<br/>Model estimates clearly marked.</h3></div><ol><li>Search for a stock or select one from your watchlist.</li><li>Explore actual historical prices and calculated indicators.</li><li>Review the estimate horizon and historical evaluation before drawing conclusions.</li></ol></div><p className="disclaimer">Educational project only. Historical market data can be delayed or incomplete. Estimates are uncertain and are not financial advice.</p></section> :
      <>
        <section className="metric-grid">
          <Metric label="Latest close" value={money(data?.latest_close)} note={data?.as_of ? `As of ${data.as_of}` : "Waiting for market data"} />
          <Metric label="Daily change" value={data?.change == null ? "—" : `${changeUp?"+":""}${money(data?.change)}`} note={data?.change_percent == null ? "Previous session unavailable for this range" : `${changeUp?"+":""}${number(data?.change_percent)}% vs previous close`} trend={data?.change == null ? undefined : changeUp?"up":"down"}/>
          <Metric label="Volume" value={number(latest?.volume)} note="Latest reported session"/>
          <Metric label="EMA (20)" value={money(latest?.ema20)} note="Exponential moving average"/>
        </section>
        
<section className="panel chart-panel">
  <PanelHeading
    title={`${symbol} · Historical closing price`}
    badge={period.toUpperCase()}
  />

  <div className="chart-legend">
    <span className="legend-direction">
      <i className="legend-cyan" />
      Closing price
    </span>
    <span>{chartRows.length} trading sessions</span>
  </div>

  <PriceChart rows={chartRows} currency={currency} />

  <div className="chart-foot">
    <span>{chartRows[0]?.date || "—"}</span>
    <span>Price in {currency} ({currency === "INR" ? "₹" : "$"})</span>
    <span>{data?.as_of || "—"}</span>
  </div>
</section>

        <section className="bottom-grid">
          <div className="panel"><PanelHeading title="Technical snapshot" badge="INDICATORS"/><div className="snapshot-row"><span>RSI (14)</span><b>{number(latest?.rsi14)}</b></div><div className="snapshot-row"><span>MACD</span><b>{number(latest?.macd)}</b></div><div className="snapshot-row"><span>EMA 20</span><b>{money(latest?.ema20)}</b></div><div className="snapshot-row"><span>EMA 50</span><b>{money(latest?.ema50)}</b></div><button className="text-button" onClick={() => setTab("indicators")}>View all indicators →</button></div>
          <div className="panel forecast-panel"><PanelHeading title="Trend forecast preview" badge="EXPERIMENTAL"/><div className="forecast-value">{money(forecast?.estimated_next_close)}</div><div className={`forecast-change ${(forecast?.estimated_change_percent??0)>=0?"positive":"negative"}`}>{forecast?.estimated_change_percent==null?"—":`${forecast.estimated_change_percent>=0?"+":""}${number(forecast.estimated_change_percent)}%`} estimated change</div><p className="muted-copy">A 30-session linear trend estimate. Compare its historical error with the previous-close benchmark.</p><button className="text-button" onClick={() => setTab("prediction")}>Open model evaluation →</button></div>
        </section>
      </>}
      <footer><span>STOCKSIGHT AI <i/> EDUCATIONAL PROJECT</span><span>Market data may be delayed or incomplete. Not investment advice.</span></footer>
    </main>
  </div>;
}

function PanelHeading({ title, badge }) {
  return <div className="panel-heading"><h2>{title}</h2><span>{badge}</span></div>;
}
function Metric({ label, value, note, trend }) {
  return <div className="metric-card"><div className="metric-label">{label}</div><div className={`metric-value ${trend||""}`}>{trend==="up"?<ArrowUpRight size={17}/>:trend==="down"?<ArrowDownRight size={17}/>:null}{value}</div><div className="metric-note">{note}</div></div>;
}

function CompanyDetails({ profile, symbol, latest, data, rows, period, currency }) {
  const money = value => formatMoney(value, currency);
  return <><section className="panel"><PanelHeading title={profile?.name || symbol} badge={profile?.exchange || "COMPANY PROFILE"}/>{profile?.available ? <><div className="company-facts">{[["Sector",profile.sector],["Industry",profile.industry],["Country",profile.country],["Employees",profile.employees ? number(profile.employees) : null],["Website",profile.website]].filter(([,value]) => value).map(([label,value]) => <div key={label}><span>{label}</span><b>{label === "Website" ? <a href={value} target="_blank" rel="noreferrer">{value.replace(/^https?:\/\//, "")}</a> : value}</b></div>)}</div>{profile.summary && <p className="company-summary">{profile.summary}</p>}</> : <div className="empty-state"><TrendingUp/><h3>Company profile unavailable</h3><p>{profile?.message || "Loading company information from Yahoo Finance."}</p></div>}</section><section className="metric-grid detail-metrics"><Metric label="Open" value={money(latest?.open)} note="Latest reported session"/><Metric label="High" value={money(latest?.high)} note="Latest reported session"/><Metric label="Low" value={money(latest?.low)} note="Latest reported session"/><Metric label="Close" value={money(latest?.close)} note={`As of ${data?.as_of || "—"}`}/></section><section className="panel chart-panel"><PanelHeading title={`${symbol} · Historical closing price`} badge={period.toUpperCase()}/><PriceChart rows={rows} currency={currency}/></section></>;
}
