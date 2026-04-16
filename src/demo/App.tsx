import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DepthChart } from "../index";
import type {
  ColorConfig,
  DepthChartHandle,
  OrderBookData,
  ThemeVariant,
} from "../index";

type PairPreset = {
  code: string;
  midPrice: number;
  spread: number;
  decimals: number;
};

const PAIRS: PairPreset[] = [
  { code: "BTC/USDT", midPrice: 65420, spread: 8, decimals: 2 },
  { code: "ETH/USDT", midPrice: 3178, spread: 0.8, decimals: 2 },
  { code: "SOL/USDT", midPrice: 186.24, spread: 0.06, decimals: 3 },
  { code: "DOGE/USDT", midPrice: 0.1821, spread: 0.0004, decimals: 4 },
];

const COLOR_PRESETS: Record<string, Partial<ColorConfig> | undefined> = {
  market: undefined,
  glacier: {
    buyFill: "#0b2733",
    buyStroke: "#7be0ff",
    sellFill: "#3a0f18",
    sellStroke: "#ff7a90",
    backgroundSurface: "#071117",
    backgroundLabel: "#071117",
    textPrimary: "#ecf6f8",
    textSecondary: "#9eb5bb",
    overlay: "#9cc7cf",
  },
  ember: {
    buyFill: "#0e2417",
    buyStroke: "#62ffb2",
    sellFill: "#35150b",
    sellStroke: "#ff9b54",
    backgroundSurface: "#120d0a",
    backgroundLabel: "#120d0a",
    textPrimary: "#fff7f1",
    textSecondary: "#c3a995",
    overlay: "#bcb4ad",
  },
};

function randomVolume(base: number, variance: number, index: number, wallAt: number[]) {
  const wallBoost = wallAt.includes(index) ? base * (2.5 + Math.random()) : 0;
  return Number((base + Math.random() * variance + wallBoost).toFixed(4));
}

function makeBook(pair: PairPreset, levels: number, imbalance: number): OrderBookData {
  const buy = [] as OrderBookData["buy"];
  const sell = [] as OrderBookData["sell"];

  for (let index = 0; index < levels; index += 1) {
    const step = pair.spread + pair.midPrice * 0.0002 * (index + 1);
    const noise = 1 + (Math.random() - 0.5) * 0.22;
    const buyPrice = Number((pair.midPrice - step * noise).toFixed(pair.decimals));
    const sellPrice = Number((pair.midPrice + step * noise).toFixed(pair.decimals));
    const buyBase = 0.6 + imbalance * 0.02;
    const sellBase = 0.6 + (100 - imbalance) * 0.02;

    buy.push({
      price: buyPrice,
      volume: randomVolume(buyBase, 2.4, index, [3, 10, 18]),
    });
    sell.push({
      price: sellPrice,
      volume: randomVolume(sellBase, 2.4, index, [6, 14, 22]),
    });
  }

  return { buy, sell };
}

export default function App() {
  const chartRef = useRef<DepthChartHandle>(null);
  const [pairCode, setPairCode] = useState(PAIRS[0].code);
  const [theme, setTheme] = useState<ThemeVariant>("dark");
  const [levels, setLevels] = useState(28);
  const [fillAlpha, setFillAlpha] = useState(0.22);
  const [imbalance, setImbalance] = useState(52);
  const [liveMode, setLiveMode] = useState(true);
  const [auctionMode, setAuctionMode] = useState(false);
  const [preset, setPreset] = useState("market");
  const [highlightInput, setHighlightInput] = useState("");

  const pair = useMemo(
    () => PAIRS.find((item) => item.code === pairCode) ?? PAIRS[0],
    [pairCode],
  );

  const [midPrice, setMidPrice] = useState(pair.midPrice);
  const [indicativePrice, setIndicativePrice] = useState(0);
  const [data, setData] = useState<OrderBookData>(() => makeBook(pair, levels, imbalance));

  useEffect(() => {
    setMidPrice(pair.midPrice);
    setData(makeBook(pair, levels, imbalance));
  }, [pair, levels, imbalance]);

  useEffect(() => {
    if (!liveMode) return;
    const timer = window.setInterval(() => {
      setMidPrice((previous) => {
        const delta = (Math.random() - 0.5) * pair.spread * 0.9;
        const next = Number((previous + delta).toFixed(pair.decimals));
        const livePair = { ...pair, midPrice: next };
        setData(makeBook(livePair, levels, imbalance));
        if (auctionMode) {
          const auctionDrift = next + delta * 1.8;
          setIndicativePrice(Number(auctionDrift.toFixed(pair.decimals)));
        }
        return next;
      });
    }, 900);

    return () => window.clearInterval(timer);
  }, [auctionMode, imbalance, levels, liveMode, pair]);

  useEffect(() => {
    if (!auctionMode) {
      setIndicativePrice(0);
      return;
    }
    setIndicativePrice(Number((midPrice + pair.spread * 0.8).toFixed(pair.decimals)));
  }, [auctionMode, midPrice, pair]);

  const priceFormat = useCallback(
    (value: number) =>
      value.toLocaleString("en-US", {
        minimumFractionDigits: pair.decimals,
        maximumFractionDigits: pair.decimals,
      }),
    [pair.decimals],
  );

  const volumeFormat = useCallback(
    (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 3 }),
    [],
  );

  const buyTotal = data.buy.reduce((total, item) => total + item.volume, 0);
  const sellTotal = data.sell.reduce((total, item) => total + item.volume, 0);

  const refreshBook = useCallback(() => {
    setData(makeBook(pair, levels, imbalance));
  }, [imbalance, levels, pair]);

  const applyHighlight = useCallback(() => {
    const price = Number(highlightInput);
    if (!Number.isFinite(price)) return;
    chartRef.current?.update(price);
  }, [highlightInput]);

  const clearHighlight = useCallback(() => {
    chartRef.current?.clear();
  }, []);

  return (
    <div className={`demo-shell theme-${theme}`}>
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />
      <section className="control-panel">
        <div className="panel-grid">
          <label>
            <span>Pair</span>
            <select value={pairCode} onChange={(event) => setPairCode(event.target.value)}>
              {PAIRS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Palette</span>
            <select value={preset} onChange={(event) => setPreset(event.target.value)}>
              {Object.keys(COLOR_PRESETS).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Levels</span>
            <input
              type="range"
              min="10"
              max="600"
              value={levels}
              onChange={(event) => setLevels(Number(event.target.value))}
            />
            <b>{levels}</b>
          </label>

          <label>
            <span>Order Imbalance</span>
            <input
              type="range"
              min="20"
              max="80"
              value={imbalance}
              onChange={(event) => setImbalance(Number(event.target.value))}
            />
            <b>{imbalance}% bid bias</b>
          </label>

          <label>
            <span>Fill Intensity</span>
            <input
              type="range"
              min="8"
              max="45"
              value={Math.round(fillAlpha * 100)}
              onChange={(event) => setFillAlpha(Number(event.target.value) / 100)}
            />
            <b>{Math.round(fillAlpha * 100)}%</b>
          </label>

          <label>
            <span>Highlight Price</span>
            <div className="inline-actions">
              <input
                type="number"
                value={highlightInput}
                placeholder={String(midPrice)}
                onChange={(event) => setHighlightInput(event.target.value)}
              />
              <button type="button" onClick={applyHighlight}>Apply</button>
              <button type="button" className="ghost" onClick={clearHighlight}>Clear</button>
            </div>
          </label>
        </div>

        <div className="toggle-row">
          <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>Dark</button>
          <button type="button" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>Light</button>
          <button type="button" className={liveMode ? "active" : ""} onClick={() => setLiveMode((value) => !value)}>
            {liveMode ? "Stop Live" : "Start Live"}
          </button>
          <button type="button" className={auctionMode ? "active warning" : ""} onClick={() => setAuctionMode((value) => !value)}>
            {auctionMode ? "Disable Auction" : "Enable Auction"}
          </button>
          <button type="button" onClick={refreshBook}>Refresh Sample</button>
        </div>
      </section>

      <section className="workspace">
        <div className="chart-card">
          <div className="card-topline">
            <span>Interactive Canvas</span>
            <span>Wheel zoom / hover tooltip / imperative highlight</span>
          </div>
          <div className="chart-stage">
            <DepthChart
              ref={chartRef}
              data={data}
              theme={theme}
              pairCode={pair.code}
              midPrice={midPrice}
              indicativePrice={indicativePrice}
              fillAlpha={fillAlpha}
              priceFormat={priceFormat}
              volumeFormat={volumeFormat}
              colorsConfig={COLOR_PRESETS[preset]}
              notEnoughDataText="Not enough sample data. Increase the level count."
            />
          </div>
        </div>

        <aside className="side-panel">
          <div className="metric-card">
            <span>Buy Total</span>
            <strong>{volumeFormat(buyTotal)}</strong>
          </div>
          <div className="metric-card">
            <span>Sell Total</span>
            <strong>{volumeFormat(sellTotal)}</strong>
          </div>
          <div className="metric-card">
            <span>Indicative</span>
            <strong>{auctionMode ? priceFormat(indicativePrice) : "Off"}</strong>
          </div>
          <div className="notes-card">
            <h2>Debug Checklist</h2>
            <ul>
              <li>Switch pairCode and confirm the zoom state resets.</li>
              <li>Enable live mode and watch curve and tooltip stability.</li>
              <li>Turn on auction mode and verify the indicativePrice flow.</li>
              <li>Use the imperative API to highlight a price manually.</li>
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}