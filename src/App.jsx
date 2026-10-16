import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, History, Plus, DollarSign, ArrowRight, Save, 
  CheckCircle2, AlertCircle, X, ChevronRight, Calculator,
  TrendingUp, TrendingDown, Clock, Minus, LogOut, Settings, RotateCcw, Scale,
  Pencil, ArrowRightLeft, Coins, BookOpen,
  Home, Trophy, Activity, Play, Trash2,
  User, Check, Archive, Menu
} from 'lucide-react';
// --- Helper Functions ---
const generateId = () => Math.random().toString(36).substr(2, 9);
const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
const formatDate = (dateString) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(dateString));

// --- Greedy Settlement Algorithm ---
const calculateSimplifiedPayouts = (originalPlayers) => {
  const players = originalPlayers.map(p => ({ ...p }));
  
  let totalDiscount = 0;
  
  players.forEach(p => {
    if (p.net < -0.01) {
      const debt = Math.abs(p.net);
      const favoredDebt = Math.floor(debt / 5) * 5;
      const discount = debt - favoredDebt;
      
      p.net = -favoredDebt;
      totalDiscount += discount;
    }
  });
  
  const creditorsList = players.filter(p => p.net > 0.01).sort((a, b) => b.net - a.net);
  for (let c of creditorsList) {
    if (totalDiscount <= 0.001) break;
    if (c.net >= totalDiscount) {
      c.net -= totalDiscount;
      totalDiscount = 0;
    } else {
      totalDiscount -= c.net;
      c.net = 0;
    }
  }

  const debtors = players.filter(p => p.net < -0.01).sort((a, b) => a.net - b.net); 
  const creditors = players.filter(p => p.net > 0.01).sort((a, b) => b.net - a.net);

  const transactions = [];
  let i = 0; 
  let j = 0; 

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    
    const amount = Math.min(Math.abs(debtor.net), creditor.net);
    
    if (amount > 0.01) {
      transactions.push({
        from: debtor.name,
        to: creditor.name,
        amount: parseFloat(amount.toFixed(2))
      });
    }

    debtor.net += amount;
    creditor.net -= amount;

    if (Math.abs(debtor.net) < 0.01) i++;
    if (Math.abs(creditor.net) < 0.01) j++;
  }

  return transactions;
};

// --- Stats Helpers (pure functions) ---
const EPS = 0.005;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const formatShortDate = (d) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(d));
const formatDuration = (mins) => {
  if (mins === null || mins === undefined || isNaN(mins)) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};
const formatSigned = (v) => `${v > EPS ? '+' : ''}${formatCurrency(v)}`;
const formatPct = (v) => (v === null || v === undefined || isNaN(v)) ? '—' : `${(v * 100).toFixed(0)}%`;
const formatSignedPct = (v) => (v === null || v === undefined || isNaN(v)) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
const formatTime = (d) => d ? new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
const ACTIVE_SESSION_KEY = 'pokerTracker_activeSession';
const readActiveSession = () => {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    if (!sess || !sess.startedAt || !Array.isArray(sess.players)) return null;
    return sess;
  } catch (e) { return null; }
};
const toneOf = (v) => (v === null || v === undefined || isNaN(v)) ? undefined : v > EPS ? 'pos' : v < -EPS ? 'neg' : undefined;

const getPlayerGameStats = (game, p) => {
  const bv = game.buyInValue || null;
  const stdCount = (p.buyInCount || 0) + (p.bankedBuyInCount || 0);
  const custom = (p.customBuyInValue || 0) + (p.bankedCustomBuyInValue || 0);
  const cashOut = typeof p.totalCashOut === 'number' ? p.totalCashOut : (p.bankedCashOut || 0) + (p.currentCashOut || 0);
  let buyIn;
  if (typeof p.totalBuyIn === 'number') buyIn = p.totalBuyIn;
  else if (bv) buyIn = stdCount * bv + custom;
  else buyIn = Math.max(0, cashOut - (p.net || 0));
  const units = bv ? buyIn / bv : stdCount;
  let minutes = null;
  if (p.joinedAt) {
    const end = p.cashedOutAt || game.date;
    const diff = (new Date(end) - new Date(p.joinedAt)) / 60000;
    if (!isNaN(diff)) minutes = Math.max(0, diff);
  }
  return { gameId: game.id, date: game.date, net: p.net || 0, buyIn, cashOut, units, minutes };
};

const computePlayerStats = (games, name) => {
  const rows = [];
  games.forEach(g => {
    const p = g.players?.find(pl => pl.name === name);
    if (p) rows.push(getPlayerGameStats(g, p));
  });
  rows.sort((a, b) => new Date(a.date) - new Date(b.date));
  const n = rows.length;
  const empty = {
    name, rows, games: 0, totalNet: 0, totalBuyIn: 0, totalCashOut: 0, wins: 0, losses: 0,
    winRate: null, avgNet: null, roi: null, avgBuyIn: null, avgUnits: null, avgCashOut: null,
    biggestWin: null, biggestLoss: null, avgMinutes: null, totalMinutes: 0, longestMinutes: null,
    hourly: null, bestStreak: 0, streak: 0, streakType: null
  };
  if (n === 0) return empty;

  const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
  const totalNet = sum(rows, r => r.net);
  const totalBuyIn = sum(rows, r => r.buyIn);
  const totalCashOut = sum(rows, r => r.cashOut);
  const wins = rows.filter(r => r.net > EPS).length;
  const losses = rows.filter(r => r.net < -EPS).length;
  const timed = rows.filter(r => r.minutes !== null);
  const totalMinutes = sum(timed, r => r.minutes);

  let best = 0, cur = 0;
  rows.forEach(r => {
    if (r.net > EPS) { cur++; best = Math.max(best, cur); } else cur = 0;
  });
  const typeOf = (r) => r.net > EPS ? 'W' : r.net < -EPS ? 'L' : 'E';
  const streakType = typeOf(rows[n - 1]);
  let streak = 0;
  for (let i = n - 1; i >= 0 && typeOf(rows[i]) === streakType; i--) streak++;

  const nets = rows.map(r => r.net);
  const maxNet = Math.max(...nets);
  const minNet = Math.min(...nets);
  const timedNet = sum(timed, r => r.net);

  return {
    name, rows, games: n, totalNet, totalBuyIn, totalCashOut, wins, losses,
    winRate: wins / n,
    avgNet: totalNet / n,
    roi: totalBuyIn > EPS ? totalNet / totalBuyIn : null,
    avgBuyIn: totalBuyIn / n,
    avgUnits: sum(rows, r => r.units) / n,
    avgCashOut: totalCashOut / n,
    biggestWin: maxNet > EPS ? maxNet : null,
    biggestLoss: minNet < -EPS ? minNet : null,
    avgMinutes: timed.length ? totalMinutes / timed.length : null,
    totalMinutes,
    longestMinutes: timed.length ? Math.max(...timed.map(r => r.minutes)) : null,
    hourly: totalMinutes >= 1 ? timedNet / (totalMinutes / 60) : null,
    bestStreak: best, streak, streakType
  };
};

const RANK_METRICS = [
  { key: 'totalNet', label: 'Earnings', get: s => s.games ? s.totalNet : null, fmt: formatSigned, signed: true },
  { key: 'roi', label: 'ROI', get: s => s.roi, fmt: formatSignedPct, signed: true },
  { key: 'avgNet', label: 'Avg / game', get: s => s.avgNet, fmt: formatSigned, signed: true },
  { key: 'winRate', label: 'Win rate', get: s => s.winRate, fmt: formatPct, signed: false },
  { key: 'hourly', label: '$ / hour', get: s => s.hourly, fmt: v => `${formatSigned(v)}/h`, signed: true },
  { key: 'biggestWin', label: 'Biggest win', get: s => s.biggestWin, fmt: formatSigned, signed: false },
  { key: 'games', label: 'Games played', get: s => s.games ? s.games : null, fmt: v => `${v}`, signed: false }
];

// --- Chart & Stat Components (pure SVG, no libraries) ---
const CHART_W = 600, CHART_H = 220, PAD = { l: 54, r: 14, t: 14, b: 30 };
const shortMoney = (v) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : (Math.round(a * 10) / 10).toString();
  return `${v < -EPS ? '-' : ''}$${s}`;
};

const ChartGrid = ({ min, max, y, axisFmt }) => {
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  return (
    <g>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={CHART_W - PAD.r} y1={y(t)} y2={y(t)} stroke="#334155" strokeWidth="1" strokeDasharray="3 4" />
          <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b">{axisFmt(t)}</text>
        </g>
      ))}
      {min < 0 && max > 0 && <line x1={PAD.l} x2={CHART_W - PAD.r} y1={y(0)} y2={y(0)} stroke="#64748b" strokeWidth="1.5" />}
    </g>
  );
};

const LineChart = ({ data, color = '#ffd24a', axisFmt = shortMoney, valueFmt = formatSigned }) => {
  if (!data.length) return null;
  const vals = data.map(d => d.value);
  let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  if (max === min) max = min + 1;
  const iw = CHART_W - PAD.l - PAD.r, ih = CHART_H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (data.length === 1 ? iw / 2 : (i * iw) / (data.length - 1));
  const y = (v) => PAD.t + ih - ((v - min) / (max - min)) * ih;
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const area = `${x(0)},${y(0)} ${pts} ${x(data.length - 1)},${y(0)}`;
  const labelIdx = data.length <= 6 ? data.map((_, i) => i) : [0, Math.floor((data.length - 1) / 2), data.length - 1];
  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto">
      <ChartGrid min={min} max={max} y={y} axisFmt={axisFmt} />
      <polygon points={area} fill={color} fillOpacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.value)} r="3.5" fill={color}><title>{`${d.label}: ${valueFmt(d.value)}`}</title></circle>
      ))}
      {labelIdx.map(i => (
        <text key={i} x={x(i)} y={CHART_H - 8} textAnchor="middle" fontSize="11" fill="#64748b">{data[i].label}</text>
      ))}
    </svg>
  );
};

const BarChart = ({ data, colors = ['#ffd24a'], signColors = false, axisFmt = shortMoney, valueFmt = formatCurrency, legend }) => {
  if (!data.length) return null;
  const all = data.flatMap(d => d.values);
  let min = Math.min(0, ...all), max = Math.max(0, ...all);
  if (max === min) max = min + 1;
  const iw = CHART_W - PAD.l - PAD.r, ih = CHART_H - PAD.t - PAD.b;
  const y = (v) => PAD.t + ih - ((v - min) / (max - min)) * ih;
  const groupW = iw / data.length;
  const series = data[0].values.length;
  const barW = Math.min(34, (groupW * 0.72) / series);
  const step = Math.ceil(data.length / 7);
  return (
    <div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto">
        <ChartGrid min={min} max={max} y={y} axisFmt={axisFmt} />
        {data.map((d, i) => {
          const cx = PAD.l + groupW * i + groupW / 2;
          return (
            <g key={i}>
              {d.values.map((v, s) => {
                const bx = cx - (barW * series) / 2 + barW * s;
                const y0 = y(0), y1 = y(v);
                const fill = signColors ? (v >= 0 ? '#34d399' : '#fb7185') : colors[s];
                return (
                  <rect key={s} x={bx} y={Math.min(y0, y1)} width={Math.max(barW - 2, 2)} height={Math.max(Math.abs(y1 - y0), 1)} rx="2" fill={fill}>
                    <title>{`${d.label}: ${valueFmt(v)}`}</title>
                  </rect>
                );
              })}
              {i % step === 0 && <text x={cx} y={CHART_H - 8} textAnchor="middle" fontSize="11" fill="#64748b">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {legend && (
        <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-400">
          {legend.map((l, i) => (
            <span key={i} className="flex items-center"><span className="inline-block w-3 h-3 rounded-sm mr-1.5" style={{ background: l.color }} />{l.name}</span>
          ))}
        </div>
      )}
    </div>
  );
};

const ChartCard = ({ title, subtitle, children }) => (
  <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
    <div className="mb-3">
      <h3 className="text-white font-bold">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const StatTile = ({ label, value, sub, tone }) => (
  <div className="stat-tile bg-slate-800 rounded-3xl p-4 text-[#1a1b24]">
    <div className="text-[11px] font-bold uppercase tracking-wide text-[#1a1b24]/60 mb-1">{label}</div>
    <div className={`text-2xl font-black ${tone === 'pos' ? 'text-[#0b4a22]' : tone === 'neg' ? 'text-[#7a1212]' : 'text-[#1a1b24]'}`}>{value}</div>
    {sub && <div className="text-xs font-medium text-[#1a1b24]/70 mt-1">{sub}</div>}
  </div>
);

// --- Components ---
export default function App() {
  const [restored] = useState(readActiveSession);
  const [activeTab, setActiveTab] = useState(restored ? 'session' : 'home');
  const [sessionStartedAt, setSessionStartedAt] = useState(restored ? restored.startedAt : null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailsBackTab, setDetailsBackTab] = useState('history');
  const isSessionActive = !!sessionStartedAt;
  const [gamesHistory, setGamesHistory] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Active Session State
  const [buyInValue, setBuyInValue] = useState(restored && restored.buyInValue !== undefined ? restored.buyInValue : 20);
  const [chipRatio, setChipRatio] = useState(restored && restored.chipRatio !== undefined ? restored.chipRatio : 100);
  const [sessionLogs, setSessionLogs] = useState(restored && Array.isArray(restored.logs) ? restored.logs.map(l => ({ ...l, time: new Date(l.time) })) : []);
  
  const [cashOutModal, setCashOutModal] = useState({ isOpen: false, playerId: null, chipCount: '' });
  const [customBuyInModal, setCustomBuyInModal] = useState({ isOpen: false, playerId: null, amount: '' });
  const [transferModal, setTransferModal] = useState({ isOpen: false, fromId: '', toId: '', chips: '' });

  const defaultPlayers = [];

  const [sessionPlayers, setSessionPlayers] = useState(restored ? restored.players : defaultPlayers);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [calculatedPayouts, setCalculatedPayouts] = useState(restored && restored.calculatedPayouts ? restored.calculatedPayouts : null);
  
  // --- New Roster State ---
  const [roster, setRoster] = useState([]);
  const [rosterInput, setRosterInput] = useState('');
  const [newGamePlayerInput, setNewGamePlayerInput] = useState('');
  const [newGameModal, setNewGameModal] = useState({ isOpen: false, selectedPlayerIds: [] });
  
  // --- Settled Payments & Player Stats State ---
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [statsBackTab, setStatsBackTab] = useState('players');
  const [rankMetric, setRankMetric] = useState('totalNet');
  const [settlements, setSettlements] = useState([]);
  
  // --- Derived Master Ledger State ---
  const knownPlayerNames = useMemo(() => {
    const names = new Set();
    gamesHistory.forEach(g => g.players?.forEach(p => names.add(p.name)));
    sessionPlayers.forEach(p => names.add(p.name));
    return Array.from(names).sort();
  }, [gamesHistory, sessionPlayers]);

  const masterLedger = useMemo(() => {
    const stats = {};
    roster.forEach(p => {
       stats[p.name] = { net: 0, gamesPlayed: 0, inRoster: true, id: p.id };
    });
    gamesHistory.forEach(game => {
      game.players?.forEach(p => {
        if (!stats[p.name]) stats[p.name] = { net: 0, gamesPlayed: 0, inRoster: false, id: p.id || generateId() };
        stats[p.name].net += p.net;
        stats[p.name].gamesPlayed += 1;
      });
    });
    
    settlements.forEach(tx => {
      if (stats[tx.from]) stats[tx.from].net += tx.amount;
      if (stats[tx.to]) stats[tx.to].net -= tx.amount;
    });

    return Object.keys(stats).map(name => ({
      name, 
      net: stats[name].net,
      gamesPlayed: stats[name].gamesPlayed,
      inRoster: stats[name].inRoster,
      id: stats[name].id
    })).sort((a, b) => b.net - a.net);
  }, [gamesHistory, roster, settlements]);

  const masterPayouts = useMemo(() => {
    return calculateSimplifiedPayouts(masterLedger);
  }, [masterLedger]);

  // --- Player stats & rankings ---
  const allStats = useMemo(() => masterLedger.map(p => ({ ...computePlayerStats(gamesHistory, p.name), inRoster: p.inRoster, id: p.id })), [masterLedger, gamesHistory]);
  const statsByName = useMemo(() => { const m = {}; allStats.forEach(st => { m[st.name] = st; }); return m; }, [allStats]);
  const earningsRank = useMemo(() => {
    const r = {};
    allStats.filter(st => st.games > 0).sort((a, b) => b.totalNet - a.totalNet).forEach((st, i) => { r[st.name] = i + 1; });
    return r;
  }, [allStats]);
  const rankedPlayerCount = Object.keys(earningsRank).length;
  const rankings = useMemo(() => {
    const metric = RANK_METRICS.find(m => m.key === rankMetric) || RANK_METRICS[0];
    const withVal = allStats.map(st => ({ s: st, v: metric.get(st) }));
    const valid = (x) => x.v !== null && x.v !== undefined && !isNaN(x.v);
    const ranked = withVal.filter(valid).sort((a, b) => (b.v - a.v) || (b.s.games - a.s.games));
    const unranked = withVal.filter(x => !valid(x));
    return { metric, ranked, unranked };
  }, [allStats, rankMetric]);

  // --- Load data from local storage ---
  useEffect(() => {
    const load = (key, fallback) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (err) {
        return fallback;
      }
    };
    setGamesHistory(load('pokerTracker_games', []));
    setRoster(load('pokerTracker_roster', []));
    setSettlements(load('pokerTracker_settlements', []));
    setIsLoading(false);
  }, []);

  // --- Keep the live session saved so it survives closing the app ---
  useEffect(() => {
    try {
      if (sessionStartedAt) {
        localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({
          startedAt: sessionStartedAt, players: sessionPlayers, logs: sessionLogs,
          buyInValue, chipRatio, calculatedPayouts
        }));
      } else {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch (e) {}
  }, [sessionStartedAt, sessionPlayers, sessionLogs, buyInValue, chipRatio, calculatedPayouts]);

  // --- Functions ---
  const saveRoster = (newRoster) => {
    localStorage.setItem('pokerTracker_roster', JSON.stringify(newRoster));
  };

  const handleAddRosterPlayer = (e, explicitName = null) => {
    if (e) e.preventDefault();
    const nameToAdd = explicitName || rosterInput.trim();
    if (!nameToAdd) return;
    
    if (roster.some(p => p.name.toLowerCase() === nameToAdd.toLowerCase())) {
      setRosterInput('');
      return; 
    }

    const newRoster = [...roster, { id: generateId(), name: nameToAdd }];
    setRoster(newRoster);
    saveRoster(newRoster);
    setRosterInput('');
  };

  const handleAddPlayerFromModal = (e) => {
    e.preventDefault();
    const name = newGamePlayerInput.trim();
    if (!name) return;
    const existing = roster.find(p => p.name.toLowerCase() === name.toLowerCase());
    let id;
    if (existing) {
      id = existing.id;
    } else {
      id = generateId();
      const newRoster = [...roster, { id, name }];
      setRoster(newRoster);
      saveRoster(newRoster);
    }
    setNewGameModal(prev => prev.selectedPlayerIds.includes(id) ? prev : { ...prev, selectedPlayerIds: [...prev.selectedPlayerIds, id] });
    setNewGamePlayerInput('');
  };

  const handleRemoveRosterPlayer = (id) => {
    const newRoster = roster.filter(p => p.id !== id);
    setRoster(newRoster);
    saveRoster(newRoster);
  };

  const handleSettlePayment = (from, to, amount) => {
    const newTx = { id: generateId(), date: new Date().toISOString(), from, to, amount };
    const updated = [newTx, ...settlements];
    setSettlements(updated);
    localStorage.setItem('pokerTracker_settlements', JSON.stringify(updated));
  };

  const handleDeleteSettlement = (id) => {
    const updated = settlements.filter(s => s.id !== id);
    setSettlements(updated);
    localStorage.setItem('pokerTracker_settlements', JSON.stringify(updated));
  };

  const submitNewGame = () => {
    if (sessionStartedAt) return;
    const selectedPlayers = roster.filter(p => newGameModal.selectedPlayerIds.includes(p.id));
    const initialSession = selectedPlayers.map(p => ({
      id: p.id, name: p.name, buyInCount: 0, bankedBuyInCount: 0, customBuyInValue: 0, bankedCustomBuyInValue: 0, bankedCashOut: 0, currentCashOut: 0, net: 0, cashedOut: false, chips: 0, bankedChips: 0, normalizationAdjustment: 0, chipTransfersIn: 0, chipTransfersOut: 0, bankedChipTransfersIn: 0, bankedChipTransfersOut: 0, joinedAt: new Date().toISOString(), cashedOutAt: null
    }));
    
    setSessionPlayers(initialSession);
    setSessionLogs([]);
    setCalculatedPayouts(null);
    setSessionStartedAt(new Date().toISOString());
    setNewGameModal({ isOpen: false, selectedPlayerIds: [] });
    setActiveTab('session');
    
    if (roster.length === 0) saveRoster(initialSession);
  };

  const logEvent = (action, details) => {
    setSessionLogs(prev => [{ id: generateId(), time: new Date(), action, details }, ...prev]);
  };

  const calculateNet = (player, customBuyIn = buyInValue, customRatio = chipRatio) => {
    const totalStandardBuyIns = player.buyInCount + (player.bankedBuyInCount || 0);
    const totalCustomBuyIns = (player.customBuyInValue || 0) + (player.bankedCustomBuyInValue || 0);
    const totalBuyInMoney = (totalStandardBuyIns * customBuyIn) + totalCustomBuyIns;
    
    const totalCashOutMoney = (player.bankedCashOut || 0) + (player.currentCashOut || 0);

    const ratio = customRatio || 1;
    const transfersInMoney = ((player.chipTransfersIn || 0) + (player.bankedChipTransfersIn || 0)) / ratio;
    const transfersOutMoney = ((player.chipTransfersOut || 0) + (player.bankedChipTransfersOut || 0)) / ratio;

    return (totalCashOutMoney + transfersOutMoney) - (totalBuyInMoney + transfersInMoney) + (player.normalizationAdjustment || 0);
  };

  const handleAddPlayer = (e) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    setSessionPlayers([
      ...sessionPlayers, 
      { id: generateId(), name: newPlayerName.trim(), buyInCount: 0, bankedBuyInCount: 0, customBuyInValue: 0, bankedCustomBuyInValue: 0, bankedCashOut: 0, currentCashOut: 0, net: 0, cashedOut: false, chips: 0, bankedChips: 0, normalizationAdjustment: 0, chipTransfersIn: 0, chipTransfersOut: 0, bankedChipTransfersIn: 0, bankedChipTransfersOut: 0, joinedAt: new Date().toISOString(), cashedOutAt: null }
    ]);
    logEvent('Player Added', `${newPlayerName.trim()} joined the table.`);
    setNewPlayerName('');
    setCalculatedPayouts(null);
  };

  const handleAddBuyIn = (id) => {
    setSessionPlayers(players => players.map(p => {
      if (p.id === id) {
        const updated = { ...p, buyInCount: p.buyInCount + 1 };
        updated.net = calculateNet(updated, buyInValue, chipRatio);
        logEvent('Buy-In Added', `${p.name} added a buy-in (Total: ${updated.buyInCount}).`);
        return updated;
      }
      return p;
    }));
    setCalculatedPayouts(null);
  };

  const handleSubBuyIn = (id) => {
    setSessionPlayers(players => players.map(p => {
      if (p.id === id) {
        const updated = { ...p, buyInCount: p.buyInCount - 1 };
        updated.net = calculateNet(updated, buyInValue, chipRatio);
        logEvent('Buy-In Subtracted', `Removed a standard buy-in from ${p.name}.`);
        return updated;
      }
      return p;
    }));
    setCalculatedPayouts(null);
  };

  const submitCustomBuyIn = (e) => {
    e.preventDefault();
    const amount = Number(customBuyInModal.amount) || 0;
    setSessionPlayers(players => players.map(p => {
      if (p.id === customBuyInModal.playerId) {
        const updated = { ...p, customBuyInValue: (p.customBuyInValue || 0) + amount };
        updated.net = calculateNet(updated, buyInValue, chipRatio);
        logEvent('Custom Buy-in', `${p.name} added a custom buy-in of ${formatCurrency(amount)}.`);
        return updated;
      }
      return p;
    }));
    setCustomBuyInModal({ isOpen: false, playerId: null, amount: '' });
    setCalculatedPayouts(null);
  };

  const submitTransfer = (e) => {
    e.preventDefault();
    const chips = Number(transferModal.chips) || 0;
    const { fromId, toId } = transferModal;
    
    if (fromId === toId || !fromId || !toId) return;

    let fromName = '', toName = '';
    
    setSessionPlayers(players => {
      const updatedPlayers = players.map(p => {
        if (p.id === fromId) {
          fromName = p.name;
          return { ...p, chipTransfersOut: (p.chipTransfersOut || 0) + chips };
        }
        if (p.id === toId) {
          toName = p.name;
          return { ...p, chipTransfersIn: (p.chipTransfersIn || 0) + chips };
        }
        return p;
      });
      return updatedPlayers.map(p => ({ ...p, net: calculateNet(p, buyInValue, chipRatio) }));
    });
    
    logEvent('Chip Transfer', `${fromName} transferred ${chips} chips to ${toName}.`);
    setTransferModal({ isOpen: false, fromId: '', toId: '', chips: '' });
    setCalculatedPayouts(null);
  };

  const openCashOutModal = (id, currentChips = '') => {
    setCashOutModal({ isOpen: true, playerId: id, chipCount: currentChips });
  };

  const submitCashOut = (e) => {
    e.preventDefault();
    const chips = Number(cashOutModal.chipCount) || 0;
    const cashValue = chips / chipRatio;

    setSessionPlayers(players => players.map(p => {
      if (p.id === cashOutModal.playerId) {
        const updated = { ...p, cashedOut: true, chips: chips, currentCashOut: cashValue, cashedOutAt: new Date().toISOString() };
        updated.net = calculateNet(updated);
        logEvent('Cashed Out', `${p.name} cashed out ${chips} chips for ${formatCurrency(cashValue)}.`);
        return updated;
      }
      return p;
    }));
    
    setCashOutModal({ isOpen: false, playerId: null, chipCount: '' });
    setCalculatedPayouts(null);
  };

  const handleRejoin = (id) => {
    setSessionPlayers(players => players.map(p => {
      if (p.id === id) {
        const updated = { 
          ...p, 
          cashedOut: false, 
          cashedOutAt: null,
          bankedCashOut: p.bankedCashOut + p.currentCashOut, 
          bankedBuyInCount: (p.bankedBuyInCount || 0) + p.buyInCount,
          bankedCustomBuyInValue: (p.bankedCustomBuyInValue || 0) + (p.customBuyInValue || 0),
          bankedChips: (p.bankedChips || 0) + p.chips,
          bankedChipTransfersIn: (p.bankedChipTransfersIn || 0) + (p.chipTransfersIn || 0),
          bankedChipTransfersOut: (p.bankedChipTransfersOut || 0) + (p.chipTransfersOut || 0),
          buyInCount: 0,
          customBuyInValue: 0,
          currentCashOut: 0, 
          chips: 0,
          chipTransfersIn: 0,
          chipTransfersOut: 0
        };
        updated.net = calculateNet(updated, buyInValue, chipRatio);
        logEvent('Rejoined', `${p.name} rejoined the game. Previous history banked.`);
        return updated;
      }
      return p;
    }));
    setCalculatedPayouts(null);
  };

  const sessionStats = useMemo(() => {
    const totalBuyIn = sessionPlayers.reduce((sum, p) => sum + ((p.buyInCount + (p.bankedBuyInCount || 0)) * buyInValue) + (p.customBuyInValue || 0) + (p.bankedCustomBuyInValue || 0), 0);
    const totalCashOut = sessionPlayers.reduce((sum, p) => sum + p.bankedCashOut + p.currentCashOut, 0);
    const difference = totalBuyIn - totalCashOut;
    const totalNet = sessionPlayers.reduce((sum, p) => sum + p.net, 0);
    return { totalBuyIn, totalCashOut, difference, totalNet };
  }, [sessionPlayers, buyInValue]);

  const handleNormalize = () => {
    const { totalNet } = sessionStats;
    if (Math.abs(totalNet) < 0.01) return;

    const totalWin = sessionPlayers.filter(p => p.net > 0).reduce((sum, p) => sum + p.net, 0);
    const totalLoss = sessionPlayers.filter(p => p.net < 0).reduce((sum, p) => sum + Math.abs(p.net), 0);

    setSessionPlayers(players => players.map(p => {
      let adj = 0;
      if (totalNet > 0 && p.net > 0) {
        adj = -totalNet * (p.net / totalWin);
      } else if (totalNet < 0 && p.net < 0) {
        adj = Math.abs(totalNet) * (Math.abs(p.net) / totalLoss);
      }
      const updated = { ...p, normalizationAdjustment: p.normalizationAdjustment + adj };
      updated.net = calculateNet(updated);
      return updated;
    }));

    logEvent('Mismatch Normalized', `Proportionally adjusted player nets to resolve a ${formatCurrency(Math.abs(totalNet))} difference.`);
    setCalculatedPayouts(null);
  };

  const handleCalculate = () => {
    if (sessionPlayers.length < 2) {
      setSessionError("Need at least 2 players to calculate.");
      return;
    }
    if (Math.abs(sessionStats.totalNet) > 0.01) {
      setSessionError(`Mismatch detected! Nets are off by ${formatCurrency(Math.abs(sessionStats.totalNet))}. Please Normalize the difference first.`);
      return;
    }
    
    setSessionError('');
    const payouts = calculateSimplifiedPayouts(sessionPlayers);
    setCalculatedPayouts(payouts);
  };

  const handleSaveSession = () => {
    if (!calculatedPayouts) return;

    const endedAt = new Date().toISOString();
    const startedAt = sessionStartedAt || endedAt;
    const durationMinutes = Math.max(0, (new Date(endedAt) - new Date(startedAt)) / 60000);

    const newGame = {
      date: endedAt,
      startedAt: startedAt,
      endedAt: endedAt,
      durationMinutes: durationMinutes,
      totalPot: sessionStats.totalBuyIn,
      buyInValue: buyInValue,
      chipRatio: chipRatio,
      players: sessionPlayers.map(p => ({
        ...p,
        totalBuyIn: ((p.buyInCount + (p.bankedBuyInCount || 0)) * buyInValue) + (p.customBuyInValue || 0) + (p.bankedCustomBuyInValue || 0),
        totalCashOut: (p.bankedCashOut || 0) + (p.currentCashOut || 0)
      })),
      payouts: calculatedPayouts,
      logs: [...sessionLogs].reverse().map(l => ({ id: l.id, time: new Date(l.time).toISOString(), action: l.action, details: l.details }))
    };

    try {
      const gameWithId = { ...newGame, id: generateId() };
      const updatedHistory = [gameWithId, ...gamesHistory];
      setGamesHistory(updatedHistory);
      localStorage.setItem('pokerTracker_games', JSON.stringify(updatedHistory));

      setSelectedGame(gameWithId);
      setDetailsBackTab('history');
      setSessionPlayers(defaultPlayers);
      setSessionLogs([]);
      setCalculatedPayouts(null);
      setSessionError('');
      setSessionStartedAt(null);
      setActiveTab('details');
    } catch (err) {
      setSessionError("Failed to save session. Try again.");
    }
  };

  const handleDiscardSession = () => {
    setSessionPlayers(defaultPlayers);
    setSessionLogs([]);
    setCalculatedPayouts(null);
    setSessionError('');
    setSessionStartedAt(null);
    setActiveTab('home');
  };

  const handleDeleteGame = (gameId) => {
    try {
      const updatedHistory = gamesHistory.filter(g => g.id !== gameId);
      setGamesHistory(updatedHistory);
      localStorage.setItem('pokerTracker_games', JSON.stringify(updatedHistory));
      if (selectedGame?.id === gameId) setActiveTab('history');
    } catch (err) {}
  };

  // --- Views ---
  const renderActiveSession = () => {
    const activePlayers = sessionPlayers.filter(p => !p.cashedOut);
    const cashedOutPlayers = sessionPlayers.filter(p => p.cashedOut);

    return (
    <div className="space-y-4 max-w-xl mx-auto animation-fade-in">
      <div className="flex items-center text-emerald-400 font-semibold text-sm"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-2" /> Live session · started {formatTime(sessionStartedAt)}</div>
      <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center text-slate-300 font-semibold">
            <Settings size={18} className="mr-2 text-indigo-400"/> Game Settings
          </div>
          <button 
            onClick={() => setNewGameModal({ isOpen: true, selectedPlayerIds: roster.map(p => p.id) })}
            className="bg-rose-900/30 hover:bg-rose-900/50 text-rose-400 border border-rose-500/30 px-3 py-2 rounded-lg text-xs font-medium flex items-center transition-colors"
          >
            <Trash2 size={14} className="mr-1.5" /> Clear Table
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">Buy-in value ($)</span>
            <input 
              type="number" 
              inputMode="decimal"
              min="0"
              className="w-full bg-slate-900 border border-slate-600 rounded-xl py-3 px-3 text-white focus:outline-none focus:border-indigo-500"
              value={buyInValue === 0 ? '' : buyInValue}
              onChange={(e) => {
                const newVal = Number(e.target.value) || 0;
                setBuyInValue(newVal);
                setSessionPlayers(players => players.map(p => ({ ...p, net: calculateNet(p, newVal) })));
              }}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">Chips per $1</span>
            <input 
              type="number" 
              inputMode="decimal"
              min="1"
              className="w-full bg-slate-900 border border-slate-600 rounded-xl py-3 px-3 text-white focus:outline-none focus:border-indigo-500"
              value={chipRatio === '' ? '' : chipRatio}
              onChange={(e) => {
                const val = e.target.value;
                const newRatio = val === '' ? '' : Number(val);
                setChipRatio(newRatio);
                if (newRatio) {
                  setSessionPlayers(players => players.map(p => ({ ...p, net: calculateNet(p, buyInValue, newRatio) })));
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#ffd24a] text-[#1a1b24] rounded-3xl p-4">
          <div className="text-[#1a1b24]/70 text-xs font-bold uppercase tracking-wide mb-1 flex items-center"><DollarSign size={14} className="mr-0.5"/> Total buy-ins</div>
          <div className="text-2xl font-black text-[#1a1b24]">{formatCurrency(sessionStats.totalBuyIn)}</div>
        </div>
        <div className="bg-[#9ad9f7] text-[#0c2a3a] rounded-3xl p-4">
          <div className="text-[#0c2a3a]/70 text-xs font-bold uppercase tracking-wide mb-1 flex items-center"><DollarSign size={14} className="mr-0.5"/> Total cash-outs</div>
          <div className="text-2xl font-black text-[#0c2a3a]">{formatCurrency(sessionStats.totalCashOut)}</div>
        </div>
        <div className={`col-span-2 rounded-3xl p-4 flex flex-col justify-center ${Math.abs(sessionStats.totalNet) < 0.01 ? 'bg-[#86e39a] text-[#10331b]' : 'bg-[#ff9b45] text-[#3a1a06]'}`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide mb-1 opacity-70">Difference / mismatch</div>
              <div className={`text-2xl font-black ${Math.abs(sessionStats.totalNet) < 0.01 ? 'text-[#10331b]' : 'text-[#3a1a06]'}`}>
                {formatCurrency(Math.abs(sessionStats.totalNet))}
              </div>
            </div>
            {Math.abs(sessionStats.totalNet) >= 0.01 && (
              <button 
                onClick={handleNormalize}
                className="bg-black/20 text-[#3a1a06] border border-black/20 px-3 py-2 rounded-xl text-xs font-bold flex items-center transition-colors"
              >
                <Scale size={14} className="mr-1.5" /> Normalize
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
              <h2 className="text-lg font-semibold text-white flex items-center">
                <Users className="mr-2 h-5 w-5 text-indigo-400"/> Active Players
              </h2>
              <button 
                onClick={() => setTransferModal({ isOpen: true, fromId: '', toId: '', chips: '' })}
                className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center transition-colors"
                disabled={activePlayers.length < 2}
              >
                <ArrowRightLeft size={14} className="mr-1.5" /> Transfer Chips
              </button>
            </div>
            
            <div className="divide-y divide-slate-700/50">
              {activePlayers.length === 0 && (
                <div className="p-4 text-center text-slate-500">No active players.</div>
              )}
              {activePlayers.map((player) => (
                <div key={player.id} className="p-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100 text-lg flex items-center flex-wrap gap-2">
                      {player.name}
                      {player.bankedCashOut > 0 && <span className="text-xs text-indigo-400 bg-indigo-900/30 px-2 py-0.5 rounded border border-indigo-500/30">Rejoined</span>}
                    </div>
                    <div className="text-sm text-slate-400 mt-0.5 flex items-center flex-wrap gap-x-2 gap-y-1">
                      <span className="text-white font-bold text-base">{player.buyInCount} buy-ins</span>
                      <span>({formatCurrency((player.buyInCount * buyInValue) + (player.customBuyInValue || 0))})</span>
                      {(player.customBuyInValue !== 0) && <span className="text-xs text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">Custom</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => handleSubBuyIn(player.id)} className="h-11 w-11 shrink-0 flex items-center justify-center bg-slate-700 active:bg-slate-600 rounded-xl text-slate-300 transition-colors"><Minus size={18}/></button>
                    <button onClick={() => handleAddBuyIn(player.id)} className="h-11 w-11 shrink-0 flex items-center justify-center bg-indigo-600 active:bg-indigo-500 rounded-xl text-white"><Plus size={18}/></button>
                    <button onClick={() => setCustomBuyInModal({ isOpen: true, playerId: player.id, amount: '' })} className="h-11 w-11 shrink-0 flex items-center justify-center bg-amber-600 active:bg-amber-500 rounded-xl text-white"><Coins size={18}/></button>
                    <button onClick={() => openCashOutModal(player.id)} className="flex-1 h-11 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 active:bg-emerald-600/40 rounded-xl flex items-center justify-center text-sm font-semibold transition-colors">
                      <LogOut size={16} className="mr-1.5" /> Cash Out
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-900/30">
              <form onSubmit={handleAddPlayer} className="flex gap-3">
                <input 
                  type="text" 
                  list="known-players"
                  placeholder="New or returning player name..."
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-indigo-500"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                />
                <datalist id="known-players">
                  {knownPlayerNames.map(name => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <button 
                  type="submit"
                  className="bg-indigo-600 active:bg-indigo-700 text-white font-medium py-3 px-4 rounded-xl flex items-center shrink-0 transition-colors disabled:opacity-50"
                  disabled={!newPlayerName.trim()}
                >
                  <Plus size={18} className="mr-1" /> Add
                </button>
              </form>
            </div>
          </div>

          {cashedOutPlayers.length > 0 && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden animation-fade-in">
              <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                <h2 className="text-lg font-semibold text-white flex items-center">
                  <CheckCircle2 className="mr-2 h-5 w-5 text-emerald-400"/> Cashed Out Players
                </h2>
              </div>
              <div className="divide-y divide-slate-700/50">
                {cashedOutPlayers.map((player) => (
                  <div key={player.id} className="p-4 bg-slate-800/30">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-slate-100 text-lg truncate">{player.name}</div>
                      <span className={`font-bold px-2.5 py-1 rounded-lg bg-slate-900 shrink-0 ${player.net > 0 ? 'text-emerald-400' : player.net < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                        {player.net > 0 ? '+' : ''}{formatCurrency(player.net)}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                      <div className="bg-slate-900/50 rounded-lg py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Buy-in</div>
                        <div className="text-sm font-semibold text-slate-300">{formatCurrency(((player.buyInCount + (player.bankedBuyInCount || 0)) * buyInValue) + (player.customBuyInValue || 0) + (player.bankedCustomBuyInValue || 0))}</div>
                      </div>
                      <div className="bg-slate-900/50 rounded-lg py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Chips</div>
                        <div className="text-sm font-semibold text-slate-300">{(player.chips || 0) + (player.bankedChips || 0)}</div>
                      </div>
                      <div className="bg-slate-900/50 rounded-lg py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Cash</div>
                        <div className="text-sm font-semibold text-emerald-400">{formatCurrency(player.bankedCashOut + player.currentCashOut)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => openCashOutModal(player.id, player.chips)} className="h-11 w-11 shrink-0 flex items-center justify-center text-slate-300 bg-slate-700/60 active:bg-slate-600 rounded-xl transition-colors">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleRejoin(player.id)} className="flex-1 h-11 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 active:bg-indigo-600/40 rounded-xl flex items-center justify-center text-sm font-semibold transition-colors">
                        <RotateCcw size={14} className="mr-1.5" /> Rejoin
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg flex flex-col h-72">
          <div className="p-4 border-b border-slate-700 bg-slate-800/50">
            <h2 className="text-lg font-semibold text-white flex items-center">
              <History className="mr-2 h-5 w-5 text-indigo-400"/> Session Logs
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {sessionLogs.length === 0 ? (
              <p className="text-slate-500 text-sm text-center mt-10">No events yet.</p>
            ) : (
              sessionLogs.map(log => (
                <div key={log.id} className="text-sm border-l-2 border-indigo-500 pl-3 py-1">
                  <div className="text-slate-500 text-xs mb-0.5">{log.time.toLocaleTimeString()} - {log.action}</div>
                  <div className="text-slate-300">{log.details}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {sessionError && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 p-4 rounded-xl flex items-start">
          <AlertCircle className="shrink-0 mr-3 mt-0.5" size={18} />
          <p>{sessionError}</p>
        </div>
      )}

      <div className="flex justify-center pt-2">
        <button
          onClick={handleCalculate}
          className="bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 font-bold py-4 px-6 w-full justify-center rounded-2xl flex items-center text-lg transition-all transform active:scale-95 disabled:opacity-50 disabled:active:scale-100"
          disabled={activePlayers.length > 0}
        >
          <Calculator size={22} className="mr-2" />
          {activePlayers.length > 0 ? "Waiting for Cash Outs..." : "Calculate Payouts"}
        </button>
      </div>

      <div className="flex justify-center">
        <button onClick={() => setConfirmModal({ title: 'Discard this session?', message: 'Nothing will be saved to your game history. This cannot be undone.', confirmLabel: 'Discard', onConfirm: handleDiscardSession })} className="text-slate-500 hover:text-rose-400 text-sm flex items-center transition-colors"><Trash2 size={14} className="mr-1.5" /> Discard session</button>
      </div>

      {calculatedPayouts && (
        <div className="bg-slate-800 rounded-xl border border-emerald-500/30 shadow-xl overflow-hidden mt-8 animation-slide-up">
          <div className="bg-emerald-900/30 p-5 border-b border-slate-700">
            <h3 className="text-xl font-bold text-white flex items-center">
              <CheckCircle2 className="mr-2 text-emerald-400" /> 
              Settlement Plan
            </h3>
            <p className="text-slate-400 text-sm mt-1">Fewest possible transactions to settle the table.</p>
          </div>
          
          <div className="p-5">
            {calculatedPayouts.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                Everyone broke even. No payouts needed!
              </div>
            ) : (
              <div className="space-y-3">
                {calculatedPayouts.map((tx, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <span className="font-semibold text-rose-400 truncate min-w-0">{tx.from}</span>
                      <ArrowRight className="text-slate-500 shrink-0" size={16} />
                      <span className="font-semibold text-emerald-400 truncate min-w-0">{tx.to}</span>
                    </div>
                    <div className="text-lg font-bold text-white bg-slate-800 py-1.5 px-3 rounded-md border border-slate-700 shrink-0 ml-2">
                      {formatCurrency(tx.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="p-5 border-t border-slate-700 bg-slate-900/30 flex justify-end">
            <button 
              onClick={handleSaveSession}
              className="w-full justify-center bg-indigo-600 active:bg-indigo-700 text-white font-bold py-3.5 rounded-xl flex items-center transition-colors"
            >
              <Save size={18} className="mr-2" /> End Session & Save
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {cashOutModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl sm:max-w-sm w-full p-6 max-h-[90vh] overflow-y-auto sheet">
            <h3 className="text-xl font-bold text-white mb-4">Cash Out Player</h3>
            <form onSubmit={submitCashOut}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-400 mb-2">Final Chip Count</label>
                <input 
                  autoFocus
                  type="number" 
                  min="0"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg py-3 px-4 text-white text-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  value={cashOutModal.chipCount}
                  onChange={(e) => setCashOutModal({...cashOutModal, chipCount: e.target.value})}
                  required
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setCashOutModal({isOpen: false, playerId: null, chipCount: ''})} className="flex-1 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors">Cancel</button>
                <button type="submit" className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors">Confirm</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {customBuyInModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl sm:max-w-sm w-full p-6 max-h-[90vh] overflow-y-auto sheet">
            <h3 className="text-xl font-bold text-white mb-4">Custom Amount</h3>
            <form onSubmit={submitCustomBuyIn}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-400 mb-2">Dollar Amount ($)</label>
                <input 
                  autoFocus
                  type="number" 
                  step="0.01"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg py-3 px-4 text-white text-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  value={customBuyInModal.amount}
                  onChange={(e) => setCustomBuyInModal({...customBuyInModal, amount: e.target.value})}
                  required
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setCustomBuyInModal({isOpen: false, playerId: null, amount: ''})} className="flex-1 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors">Cancel</button>
                <button type="submit" className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold transition-colors">Confirm</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {transferModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl sm:max-w-sm w-full p-6 max-h-[90vh] overflow-y-auto sheet">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center"><ArrowRightLeft className="mr-2 text-indigo-400" size={24} /> Transfer Chips</h3>
            <form onSubmit={submitTransfer}>
              <div className="mb-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">From</label>
                  <select className="w-full bg-slate-900 border border-slate-600 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-indigo-500" value={transferModal.fromId} onChange={(e) => setTransferModal({...transferModal, fromId: e.target.value})} required>
                    <option value="" disabled>Select sender...</option>
                    {activePlayers.map(p => <option key={p.id} value={p.id} disabled={p.id === transferModal.toId}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">To</label>
                  <select className="w-full bg-slate-900 border border-slate-600 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-indigo-500" value={transferModal.toId} onChange={(e) => setTransferModal({...transferModal, toId: e.target.value})} required>
                    <option value="" disabled>Select receiver...</option>
                    {activePlayers.map(p => <option key={p.id} value={p.id} disabled={p.id === transferModal.fromId}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Amount</label>
                  <input type="number" min="1" className="w-full bg-slate-900 border border-slate-600 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-indigo-500" value={transferModal.chips} onChange={(e) => setTransferModal({...transferModal, chips: e.target.value})} required />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setTransferModal({isOpen: false, fromId: '', toId: '', chips: ''})} className="flex-1 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors">Cancel</button>
                <button type="submit" className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors">Transfer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    );
  };

  const renderHistory = () => (
    <div className="max-w-4xl mx-auto animation-fade-in space-y-4">
      <div className="flex justify-between items-end mb-2">
        <div>
          <h2 className="text-2xl font-bold text-white">Session History</h2>
          <p className="text-sm text-slate-500 mt-1">Every game you've played. Tap one for the full breakdown.</p>
        </div>
      </div>

      {isSessionActive && (
        <div onClick={() => setActiveTab('session')} className="bg-emerald-900/20 rounded-xl border border-emerald-500/30 p-5 cursor-pointer hover:border-emerald-400/60 transition-colors flex items-center justify-between">
          <div>
            <div className="flex items-center text-emerald-400 font-semibold mb-1"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-2" /> In progress</div>
            <div className="text-slate-400 text-sm">{sessionPlayers.length} players <span className="mx-2">•</span> Pot: {formatCurrency(sessionStats.totalBuyIn)} <span className="mx-2">•</span> Started {formatTime(sessionStartedAt)}</div>
          </div>
          <div className="flex items-center text-emerald-400 font-medium">Resume <ChevronRight size={18} className="ml-1" /></div>
        </div>
      )}

      {gamesHistory.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/50 rounded-2xl border border-slate-700 border-dashed">
          <Clock className="mx-auto h-12 w-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No finished games yet</h3>
          <p className="text-slate-500 text-sm">End a session and it will show up here.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {gamesHistory.map(game => {
            const top = (game.players || []).reduce((best, p) => (!best || p.net > best.net) ? p : best, null);
            const dur = typeof game.durationMinutes === 'number' ? game.durationMinutes : null;
            return (
              <div key={game.id} className="bg-slate-800 rounded-xl border border-slate-700 p-5 hover:border-indigo-500/50 transition-colors cursor-pointer flex items-center justify-between gap-3" onClick={() => { setSelectedGame(game); setDetailsBackTab('history'); setActiveTab('details'); }}>
                <div>
                  <div className="text-white font-semibold mb-1">{formatDate(game.date)}</div>
                  <div className="text-slate-400 text-sm flex flex-wrap items-center gap-y-1">
                    <span className="flex items-center"><Users size={14} className="mr-1.5" /> {game.players?.length || 0} Players</span>
                    <span className="mx-3">•</span><span>Pot: {formatCurrency(game.totalPot)}</span>
                    {dur !== null && (<><span className="mx-3">•</span><span className="flex items-center"><Clock size={13} className="mr-1" />{formatDuration(dur)}</span></>)}
                  </div>
                  {top && top.net > EPS && <div className="text-xs text-emerald-400 mt-1.5">Top: {top.name} {formatSigned(top.net)}</div>}
                </div>
                <div className="flex items-center text-indigo-400 font-medium">View <ChevronRight size={18} className="ml-1" /></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderPlayers = () => (
    <div className="max-w-4xl mx-auto animation-fade-in space-y-6">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Player Roster</h2>
          <p className="text-sm text-slate-500 mt-1">Tap a player to see their stats and graphs.</p>
        </div>
        <button onClick={() => setActiveTab('rankings')} className="text-indigo-400 hover:text-indigo-300 text-sm font-medium flex items-center"><Trophy size={16} className="mr-1.5" /> Rankings</button>
      </div>
      <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
        <div className="p-5 border-b border-slate-700 bg-slate-900/30">
          <form onSubmit={handleAddRosterPlayer} className="flex gap-3">
            <input type="text" placeholder="Enter new player name..." className="flex-1 bg-slate-900 border border-slate-600 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-indigo-500" value={rosterInput} onChange={(e) => setRosterInput(e.target.value)} />
            <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-900/20" disabled={!rosterInput.trim()}>Add Player</button>
          </form>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4">
          {masterLedger.map(p => {
            const st = statsByName[p.name];
            const rank = earningsRank[p.name];
            const hasGames = st && st.games > 0;
            return (
              <div key={p.name} onClick={() => { setSelectedPlayer(p); setStatsBackTab('players'); setActiveTab('playerStats'); }} className="bg-slate-900/50 rounded-xl p-4 border border-slate-700 hover:border-indigo-500/50 transition-colors cursor-pointer flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-200 text-lg flex items-center gap-2">
                    {p.name}
                    {rank && <span className="text-xs font-semibold bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full">#{rank}</span>}
                  </div>
                  <div className="text-sm text-slate-500">{p.gamesPlayed} games{hasGames ? ` · ${formatPct(st.winRate)} wins` : ''}</div>
                  {hasGames && st.avgMinutes !== null && <div className="text-xs text-slate-600 mt-0.5">avg {formatDuration(st.avgMinutes)} / game</div>}
                </div>
                <div className="flex flex-col items-end">
                  <span className={`font-bold ${toneOf(st?.totalNet) === 'pos' ? 'text-emerald-400' : toneOf(st?.totalNet) === 'neg' ? 'text-rose-400' : 'text-slate-400'}`}>{formatSigned(st?.totalNet || 0)}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-600">earnings</span>
                  {p.inRoster ? (
                    <button onClick={(e) => { e.stopPropagation(); handleRemoveRosterPlayer(p.id); }} className="text-slate-500 hover:text-rose-400 mt-2 text-xs font-medium flex items-center"><X size={12} className="mr-0.5" /> Remove</button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); handleAddRosterPlayer(null, p.name); }} className="text-indigo-400 hover:text-indigo-300 mt-2 text-xs font-medium flex items-center"><Plus size={12} className="mr-0.5" /> Add</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderPlayerStats = () => {
    if (!selectedPlayer) return null;
    const st = statsByName[selectedPlayer.name] || computePlayerStats(gamesHistory, selectedPlayer.name);
    const ledger = masterLedger.find(p => p.name === selectedPlayer.name);
    const rank = earningsRank[selectedPlayer.name];
    const rows = st.rows;
    const recentRows = rows.slice(-20);

    let run = 0;
    const cumulative = rows.map(r => { run += r.net; return { label: formatShortDate(r.date), value: round2(run) }; });
    const netBars = recentRows.map(r => ({ label: formatShortDate(r.date), values: [round2(r.net)] }));
    const buyCashBars = recentRows.map(r => ({ label: formatShortDate(r.date), values: [round2(r.buyIn), round2(r.cashOut)] }));
    const timeBars = recentRows.filter(r => r.minutes !== null).map(r => ({ label: formatShortDate(r.date), values: [Math.round(r.minutes)] }));
    const recentList = rows.slice(-8).reverse();

    return (
      <div className="max-w-4xl mx-auto animation-fade-in space-y-6">
        <button onClick={() => setActiveTab(statsBackTab)} className="text-slate-400 hover:text-white flex items-center"><ChevronRight size={20} className="mr-1 rotate-180" /> Back</button>

        <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl overflow-hidden">
          <div className="p-5 flex flex-col gap-4 bg-slate-900/30">
            <div>
              <h2 className="text-3xl font-extrabold text-white">{selectedPlayer.name}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {rank && (
                  <button onClick={() => setActiveTab('rankings')} className="text-xs font-semibold bg-amber-500/15 text-amber-300 px-2.5 py-1 rounded-full flex items-center">
                    <Trophy size={12} className="mr-1" /> #{rank} of {rankedPlayerCount} by earnings
                  </button>
                )}
                <span className="text-xs text-slate-500">{st.games} {st.games === 1 ? 'game' : 'games'} played</span>
              </div>
            </div>
            <div className={`px-6 py-4 rounded-xl border ${toneOf(st.totalNet) === 'pos' ? 'bg-emerald-900/20 border-emerald-500/30' : toneOf(st.totalNet) === 'neg' ? 'bg-rose-900/20 border-rose-500/30' : 'bg-slate-900/50 border-slate-700'}`}>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Lifetime earnings</div>
              <div className={`text-3xl font-black ${toneOf(st.totalNet) === 'pos' ? 'text-emerald-400' : toneOf(st.totalNet) === 'neg' ? 'text-rose-400' : 'text-slate-300'}`}>{formatSigned(st.totalNet)}</div>
            </div>
          </div>
        </div>

        {st.games === 0 ? (
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8 text-center">
            <h3 className="text-lg font-medium text-white mb-2">No games yet</h3>
            <p className="text-slate-500 text-sm">Stats and graphs will appear once {selectedPlayer.name} plays a saved game.</p>
          </div>
        ) : (
          <>
            <div className="tile-grid grid grid-cols-2 gap-3">
              <StatTile label="Games played" value={st.games} sub={`${st.wins}W · ${st.losses}L`} />
              <StatTile label="Win rate" value={formatPct(st.winRate)} sub={`${st.wins} of ${st.games} games`} />
              <StatTile label="Avg profit / game" value={formatSigned(st.avgNet)} tone={toneOf(st.avgNet)} />
              <StatTile label="ROI" value={formatSignedPct(st.roi)} tone={toneOf(st.roi)} sub={`on ${formatCurrency(st.totalBuyIn)} bought in`} />
              <StatTile label="Avg buy-in" value={formatCurrency(st.avgBuyIn)} sub={`≈ ${st.avgUnits.toFixed(1)} buy-ins / game`} />
              <StatTile label="Avg return" value={formatCurrency(st.avgCashOut)} sub={st.totalBuyIn > EPS ? `${(st.totalCashOut / st.totalBuyIn).toFixed(2)}x of buy-in` : undefined} />
              <StatTile label="Biggest win" value={st.biggestWin === null ? '—' : formatSigned(st.biggestWin)} tone="pos" />
              <StatTile label="Biggest loss" value={st.biggestLoss === null ? '—' : formatSigned(st.biggestLoss)} tone="neg" />
              <StatTile label="Avg time / game" value={formatDuration(st.avgMinutes)} sub={st.avgMinutes === null ? 'Tracked from new games' : undefined} />
              <StatTile label="Total time played" value={st.totalMinutes > 0 ? formatDuration(st.totalMinutes) : '—'} sub={st.longestMinutes !== null ? `Longest: ${formatDuration(st.longestMinutes)}` : undefined} />
              <StatTile label="Profit / hour" value={st.hourly === null ? '—' : `${formatSigned(st.hourly)}/h`} tone={toneOf(st.hourly)} />
              <StatTile label="Current streak" value={st.streakType === 'E' ? 'Even' : `${st.streak}${st.streakType}`} tone={st.streakType === 'W' ? 'pos' : st.streakType === 'L' ? 'neg' : undefined} sub={st.streakType === 'W' ? 'wins in a row' : st.streakType === 'L' ? 'losses in a row' : undefined} />
              <StatTile label="Best win streak" value={st.bestStreak} sub="games in a row" />
              <StatTile label="Total bought in" value={formatCurrency(st.totalBuyIn)} />
              <StatTile label="Total cashed out" value={formatCurrency(st.totalCashOut)} />
              <StatTile label="Unsettled balance" value={formatSigned(ledger ? ledger.net : 0)} tone={toneOf(ledger ? ledger.net : 0)} sub="from the Ledger tab" />
            </div>

            <ChartCard title="Earnings over time" subtitle="Running total across all games">
              <LineChart data={cumulative} color="#ffd24a" />
            </ChartCard>

            <ChartCard title="Profit / loss per game" subtitle={rows.length > 20 ? 'Last 20 games' : 'Every game'}>
              <BarChart data={netBars} signColors valueFmt={formatSigned} />
            </ChartCard>

            <ChartCard title="Buy-ins vs. returns" subtitle={rows.length > 20 ? 'Last 20 games' : 'What they put in vs. what they took out'}>
              <BarChart data={buyCashBars} colors={['#ff9b45', '#9ad9f7']} legend={[{ name: 'Bought in', color: '#ff9b45' }, { name: 'Cashed out', color: '#9ad9f7' }]} />
            </ChartCard>

            <ChartCard title="Time played per game" subtitle={timeBars.length ? `Average ${formatDuration(st.avgMinutes)}` : undefined}>
              {timeBars.length ? (
                <BarChart data={timeBars} colors={['#9ad9f7']} axisFmt={formatDuration} valueFmt={formatDuration} />
              ) : (
                <p className="text-sm text-slate-500 py-6 text-center">Time is tracked from games started after this update, so older games have no duration.</p>
              )}
            </ChartCard>

            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
              <h3 className="text-white font-bold mb-3">Recent games</h3>
              <div className="space-y-2">
                {recentList.map((r, i) => (
                  <div key={r.gameId || i} onClick={() => { const g = gamesHistory.find(x => x.id === r.gameId); if (g) { setSelectedGame(g); setDetailsBackTab('playerStats'); setActiveTab('details'); } }} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700/50 hover:border-indigo-500/50 cursor-pointer transition-colors">
                    <div>
                      <div className="text-slate-200 font-medium text-sm">{formatShortDate(r.date)}</div>
                      <div className="text-xs text-slate-500">{formatCurrency(r.buyIn)} in → {formatCurrency(r.cashOut)} out{r.minutes !== null ? ` · ${formatDuration(r.minutes)}` : ''}</div>
                    </div>
                    <div className={`font-bold ${toneOf(r.net) === 'pos' ? 'text-emerald-400' : toneOf(r.net) === 'neg' ? 'text-rose-400' : 'text-slate-400'}`}>{formatSigned(r.net)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderRankings = () => {
    const { metric, ranked, unranked } = rankings;
    const maxAbs = Math.max(...ranked.map(x => Math.abs(x.v)), 0) || 1;
    let lastVal = null, lastRank = 0;
    const rows = ranked.map((x, i) => {
      if (lastVal === null || Math.abs(x.v - lastVal) > 1e-9) { lastRank = i + 1; lastVal = x.v; }
      return { ...x, rank: lastRank };
    });
    const medalColors = ['text-amber-400', 'text-slate-300', 'text-orange-400'];
    const hasAnyGames = allStats.some(s => s.games > 0);

    return (
      <div className="max-w-4xl mx-auto animation-fade-in space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Player Rankings</h2>
          <p className="text-sm text-slate-500 mt-1">Ranked across all saved games. Tap a player for full stats.</p>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {RANK_METRICS.map(m => (
            <button key={m.key} onClick={() => setRankMetric(m.key)} className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap border transition-colors ${rankMetric === m.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>{m.label}</button>
          ))}
        </div>

        {!hasAnyGames ? (
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8 text-center">
            <Trophy size={32} className="mx-auto text-slate-600 mb-3" />
            <h3 className="text-lg font-medium text-white mb-2">No rankings yet</h3>
            <p className="text-slate-500 text-sm">Save a game session and players will be ranked here.</p>
          </div>
        ) : (
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl overflow-hidden">
            <div className="divide-y divide-slate-700/60">
              {rows.map(({ s, v, rank }) => {
                const tone = metric.signed ? toneOf(v) : undefined;
                const barPct = Math.max(4, (Math.abs(v) / maxAbs) * 100);
                return (
                  <div key={s.name} onClick={() => { setSelectedPlayer(masterLedger.find(p => p.name === s.name) || { name: s.name }); setStatsBackTab('rankings'); setActiveTab('playerStats'); }} className="flex items-center gap-4 p-4 hover:bg-slate-700/30 cursor-pointer transition-colors">
                    <div className="w-9 flex justify-center">
                      {rank <= 3 ? <Trophy size={22} className={medalColors[rank - 1]} /> : <span className="text-slate-500 font-bold">{rank}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-bold text-slate-200 truncate">{s.name}</div>
                        <div className={`font-black text-lg ${tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-white'}`}>{metric.fmt(v)}</div>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{s.games} {s.games === 1 ? 'game' : 'games'} · {formatPct(s.winRate)} wins · {formatSigned(s.totalNet)} total</div>
                      <div className="h-1.5 bg-slate-900 rounded-full mt-2 overflow-hidden">
                        <div className={`h-full rounded-full ${tone === 'neg' ? 'bg-rose-500' : tone === 'pos' ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${barPct}%` }} />
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-slate-600" />
                  </div>
                );
              })}
            </div>
            {unranked.length > 0 && (
              <div className="p-4 bg-slate-900/40 border-t border-slate-700/60 text-xs text-slate-500">
                Not enough data for this ranking: {unranked.map(x => x.s.name).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLedger = () => (
    <div className="max-w-4xl mx-auto animation-fade-in space-y-6">
      <div className="flex justify-between items-end mb-6"><div><h2 className="text-2xl font-bold text-white">Active Ledger & Dues</h2></div></div>
      <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden flex flex-col">
        <div className="p-4 overflow-y-auto bg-slate-900/20">
          {masterPayouts.length === 0 ? (
            <div className="text-center py-12"><h3 className="text-lg font-medium text-white mb-2">All settled up!</h3></div>
          ) : (
            <div className="space-y-4">
              {masterPayouts.map((tx, idx) => (
                <div key={idx} className="flex flex-col gap-3 justify-between p-4 bg-slate-900/60 rounded-xl border border-slate-700/50">
                  <div className="flex items-center space-x-4">
                    <span className="font-semibold text-rose-400 text-lg">{tx.from}</span>
                    <ArrowRight className="text-slate-400" size={16} />
                    <span className="font-semibold text-emerald-400 text-lg">{tx.to}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-2xl font-black text-white">{formatCurrency(tx.amount)}</div>
                    <button onClick={() => handleSettlePayment(tx.from, tx.to, tx.amount)} className="bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 px-4 py-2.5 rounded-lg text-sm font-medium flex items-center">Mark Settled</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderArchive = () => (
    <div className="max-w-4xl mx-auto animation-fade-in space-y-6">
      <div className="flex justify-between items-end mb-6"><div><h2 className="text-2xl font-bold text-white">Settlement Archive</h2></div></div>
      <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden flex flex-col">
        <div className="p-4 overflow-y-auto bg-slate-900/20">
          {settlements.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between p-4 bg-slate-900/60 rounded-xl border border-slate-700/50 mb-4">
              <div className="flex items-center space-x-3">
                <span className="font-semibold text-rose-400">{tx.from}</span>
                <ArrowRight className="text-slate-500" size={14} />
                <span className="font-semibold text-emerald-400">{tx.to}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="font-bold text-slate-200">{formatCurrency(tx.amount)}</div>
                <button onClick={() => handleDeleteSettlement(tx.id)} className="text-slate-500 hover:text-rose-400 p-1.5 bg-slate-800 rounded transition-colors"><RotateCcw size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderGameDetails = () => {
    if (!selectedGame) return null;
    const g = selectedGame;
    const rows = (g.players || []).map(p => ({ p, ...getPlayerGameStats(g, p) })).sort((a, b) => b.net - a.net);
    const winner = rows.length && rows[0].net > EPS ? rows[0] : null;
    const loser = rows.length && rows[rows.length - 1].net < -EPS ? rows[rows.length - 1] : null;
    const duration = typeof g.durationMinutes === 'number' ? g.durationMinutes : null;
    const logs = g.logs || [];
    const payouts = g.payouts || [];
    const medalColors = ['text-amber-400', 'text-slate-300', 'text-orange-400'];

    return (
      <div className="max-w-4xl mx-auto animation-fade-in space-y-6">
        <button onClick={() => setActiveTab(detailsBackTab)} className="text-slate-400 hover:text-white flex items-center"><ChevronRight size={20} className="mr-1 rotate-180" /> Back</button>

        <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl overflow-hidden">
          <div className="p-5 bg-slate-900/30 flex flex-col gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Game session</div>
              <h2 className="text-2xl font-extrabold text-white">{formatDate(g.date)}</h2>
              {g.startedAt && <p className="text-sm text-slate-500 mt-2">Started {formatTime(g.startedAt)} · Ended {formatTime(g.endedAt || g.date)}</p>}
            </div>
            <div className="px-6 py-4 rounded-xl border bg-slate-900/50 border-slate-700">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Total pot</div>
              <div className="text-3xl font-black text-white">{formatCurrency(g.totalPot)}</div>
            </div>
          </div>
        </div>

        <div className="tile-grid grid grid-cols-2 gap-3">
          <StatTile label="Players" value={rows.length} />
          <StatTile label="Duration" value={formatDuration(duration)} sub={duration === null ? 'Not tracked for this game' : undefined} />
          <StatTile label="Top winner" value={winner ? winner.p.name : '—'} tone="pos" sub={winner ? formatSigned(winner.net) : undefined} />
          <StatTile label="Biggest loser" value={loser ? loser.p.name : '—'} tone="neg" sub={loser ? formatSigned(loser.net) : undefined} />
          {g.buyInValue ? <StatTile label="Buy-in" value={formatCurrency(g.buyInValue)} sub={g.chipRatio ? `${g.chipRatio} chips per $1` : undefined} /> : null}
        </div>

        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="p-5 border-b border-slate-700"><h3 className="text-white font-bold">Results</h3></div>
          <div className="divide-y divide-slate-700/60">
            {rows.map((r, i) => (
              <div key={r.p.id || r.p.name} onClick={() => { setSelectedPlayer(masterLedger.find(x => x.name === r.p.name) || { name: r.p.name }); setStatsBackTab('details'); setActiveTab('playerStats'); }} className="flex items-center gap-4 p-4 hover:bg-slate-700/30 cursor-pointer transition-colors">
                <div className="w-8 flex justify-center">
                  {i < 3 && r.net > EPS ? <Trophy size={20} className={medalColors[i]} /> : <span className="text-slate-500 font-bold">{i + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-200 truncate">{r.p.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{formatCurrency(r.buyIn)} in → {formatCurrency(r.cashOut)} out{r.minutes !== null ? ` · ${formatDuration(r.minutes)}` : ''}</div>
                </div>
                <div className={`font-black text-lg ${toneOf(r.net) === 'pos' ? 'text-emerald-400' : toneOf(r.net) === 'neg' ? 'text-rose-400' : 'text-slate-400'}`}>{formatSigned(r.net)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="p-5 border-b border-slate-700"><h3 className="text-white font-bold flex items-center"><CheckCircle2 size={18} className="mr-2 text-emerald-400" /> Settlement plan</h3></div>
          <div className="p-5">
            {payouts.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-2">Everyone broke even. No payouts needed.</p>
            ) : (
              <div className="space-y-3">
                {payouts.map((tx, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
                    <div className="flex items-center space-x-3 min-w-0">
                      <span className="font-semibold text-rose-400 truncate">{tx.from}</span>
                      <ArrowRight className="text-slate-500 shrink-0" size={16} />
                      <span className="font-semibold text-emerald-400 truncate">{tx.to}</span>
                    </div>
                    <div className="text-lg font-bold text-white">{formatCurrency(tx.amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {logs.length > 0 && (
          <details className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
            <summary className="p-5 cursor-pointer text-white font-bold flex items-center"><History className="mr-2 h-5 w-5 text-indigo-400" /> Session log ({logs.length} events)</summary>
            <div className="px-5 pb-5 space-y-3">
              {logs.map(log => (
                <div key={log.id} className="text-sm border-l-2 border-indigo-500 pl-3 py-1">
                  <div className="text-slate-500 text-xs mb-0.5">{formatTime(log.time)} - {log.action}</div>
                  <div className="text-slate-300">{log.details}</div>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="pt-2">
          <button onClick={() => setConfirmModal({ title: 'Delete this game?', message: 'It will be removed from history, rankings and player stats. This cannot be undone.', confirmLabel: 'Delete', onConfirm: () => handleDeleteGame(g.id) })} className="text-rose-400 bg-rose-900/20 hover:bg-rose-900/30 px-4 py-2 rounded-lg flex items-center text-sm font-medium transition-colors"><Trash2 size={16} className="mr-2" /> Delete record</button>
        </div>
      </div>
    );
  };

  const renderHome = () => {
    const totalGames = gamesHistory.length;
    const totalPotPlayed = gamesHistory.reduce((sum, g) => sum + (g.totalPot || 0), 0);
    const played = allStats.filter(st => st.games > 0);
    const winners = played.filter(st => st.totalNet > EPS).sort((x, y) => y.totalNet - x.totalNet).slice(0, 3);
    const losers = played.filter(st => st.totalNet < -EPS).sort((x, y) => x.totalNet - y.totalNet).slice(0, 3);
    const openPlayer = (name) => { setSelectedPlayer(masterLedger.find(pl => pl.name === name) || { name }); setStatsBackTab('home'); setActiveTab('playerStats'); };

    return (
      <div className="animation-fade-in space-y-3 relative z-10">
        <div className="px-1 pb-1">
          <div className="text-sm text-slate-400">Welcome to</div>
          <h1 className="text-3xl font-black text-white">StackSettler</h1>
        </div>

        <div onClick={() => setActiveTab('history')} className="bg-[#ffd24a] text-[#1a1b24] rounded-3xl p-5 cursor-pointer">
          <div className="flex items-start justify-between">
            <div className="text-xs font-bold uppercase tracking-wide text-[#1a1b24]/70">Games played</div>
            <div className="w-9 h-9 rounded-full bg-black/10 flex items-center justify-center"><ChevronRight size={18} /></div>
          </div>
          <div className="flex items-end justify-between mt-3">
            <div className="text-6xl font-black leading-none">{totalGames}</div>
            <div className="text-right text-sm font-semibold text-[#1a1b24]/80">
              <div>{masterLedger.length} players</div>
              <div>{formatCurrency(totalPotPlayed)} total pot</div>
            </div>
          </div>
        </div>

        {isSessionActive ? (
          <div className="bg-[#86e39a] text-[#10331b] rounded-3xl p-5">
            <div className="flex items-center font-bold mb-1"><span className="w-2 h-2 rounded-full bg-[#10331b] animate-pulse mr-2" /> Session in progress</div>
            <div className="text-sm text-[#10331b]/70 mb-4">{sessionPlayers.length} players · Pot {formatCurrency(sessionStats.totalBuyIn)} · started {formatTime(sessionStartedAt)}</div>
            <button onClick={() => setActiveTab('session')} className="w-full bg-[#10331b] text-white font-bold py-3.5 rounded-2xl flex items-center justify-center">
              <Play size={20} className="mr-2" /> Resume Session
            </button>
          </div>
        ) : (
          <button onClick={() => setNewGameModal({ isOpen: true, selectedPlayerIds: roster.map(p => p.id) })} className="w-full bg-[#9ad9f7] text-[#0c2a3a] rounded-3xl p-5 flex items-center justify-between text-left">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-[#0c2a3a]/70">New session</div>
              <div className="text-xl font-black">Start New Game Session</div>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#0c2a3a] text-[#9ad9f7] flex items-center justify-center shrink-0"><Play size={22} /></div>
          </button>
        )}

        {played.length === 0 ? (
          <div className="bg-[#8fe6ee] text-[#0a2f33] rounded-3xl p-5">
            <div className="flex items-center font-black mb-1"><Trophy size={18} className="mr-2" /> No winners or losers yet</div>
            <p className="text-sm text-[#0a2f33]/80">Finish a game session and the leaderboard shows up here.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#86e39a] text-[#10331b] rounded-3xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-[#10331b]/70">Top winners</div>
                  <Trophy size={18} />
                </div>
                {winners.length === 0 ? (
                  <p className="text-sm font-medium">No one is ahead yet.</p>
                ) : winners.map((st, i) => (
                  <div key={st.name} onClick={() => openPlayer(st.name)} className="py-1.5 cursor-pointer">
                    <div className="font-bold text-sm truncate">{i + 1}. {st.name}</div>
                    <div className="font-black text-base">{formatSigned(st.totalNet)}</div>
                  </div>
                ))}
              </div>
              <div className="bg-[#ff9b45] text-[#3a1a06] rounded-3xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-[#3a1a06]/70">Top losers</div>
                  <TrendingDown size={18} />
                </div>
                {losers.length === 0 ? (
                  <p className="text-sm font-medium">No one is behind yet.</p>
                ) : losers.map((st, i) => (
                  <div key={st.name} onClick={() => openPlayer(st.name)} className="py-1.5 cursor-pointer">
                    <div className="font-bold text-sm truncate">{i + 1}. {st.name}</div>
                    <div className="font-black text-base">{formatSigned(st.totalNet)}</div>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => setActiveTab('rankings')} className="w-full bg-slate-800 text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center">See full rankings <ChevronRight size={16} className="ml-1" /></button>
          </>
        )}

        {newGameModal.isOpen && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-md max-h-[90vh] overflow-y-auto sheet">
              <div className="flex justify-between mb-4"><h3 className="text-xl font-bold text-white">Select Players</h3><button onClick={() => setNewGameModal({isOpen: false, selectedPlayerIds: []})} className="text-slate-400"><X size={20} /></button></div>
              <form onSubmit={handleAddPlayerFromModal} className="flex gap-2 mb-4">
                <input type="text" placeholder="Add a new player..." className="flex-1 bg-slate-900 border border-slate-600 rounded-lg py-2.5 px-3 text-white focus:outline-none focus:border-indigo-500" value={newGamePlayerInput} onChange={(e) => setNewGamePlayerInput(e.target.value)} />
                <button type="submit" disabled={!newGamePlayerInput.trim()} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 rounded-lg font-medium flex items-center"><Plus size={18} /></button>
              </form>
              <div className="mb-6 bg-slate-900/50 border border-slate-700 p-2 rounded-lg max-h-64 overflow-y-auto">
                {roster.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-6">No players yet. Add your first player above.</p>
                ) : roster.map(p => (
                  <label key={p.id} className="flex items-center p-3 rounded-lg cursor-pointer hover:bg-slate-700">
                    <input type="checkbox" className="mr-3" checked={newGameModal.selectedPlayerIds.includes(p.id)} onChange={(e) => {
                      if (e.target.checked) setNewGameModal(prev => ({...prev, selectedPlayerIds: [...prev.selectedPlayerIds, p.id]}));
                      else setNewGameModal(prev => ({...prev, selectedPlayerIds: prev.selectedPlayerIds.filter(id => id !== p.id)}));
                    }} />
                    <span className="text-white">{p.name}</span>
                  </label>
                ))}
              </div>
              <button onClick={submitNewGame} disabled={newGameModal.selectedPlayerIds.length === 0} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl">Start Game Session{newGameModal.selectedPlayerIds.length > 0 ? ` (${newGameModal.selectedPlayerIds.length} players)` : ''}</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const currentTab = (activeTab === 'session' && !isSessionActive) ? 'home' : activeTab;

  const tabItems = [
    { key: 'home', label: 'Home', Icon: Home },
    ...(isSessionActive ? [{ key: 'session', label: 'Live', Icon: Activity }] : []),
    { key: 'players', label: 'Players', Icon: Users },
    { key: 'rankings', label: 'Rankings', Icon: Trophy },
    { key: 'history', label: 'History', Icon: History },
    { key: 'more', label: 'More', Icon: Menu }
  ];
  const pageTitles = { home: 'Home', session: 'Live session', players: 'Players', playerStats: 'Player stats', rankings: 'Rankings', ledger: 'Ledger', history: 'History', details: 'Game', archive: 'Archive' };
  const moreActive = moreOpen || currentTab === 'ledger' || currentTab === 'archive';

  return (
    <div className="min-h-screen bg-[#15161e] text-slate-300 font-sans">
      <header className="bg-[#1a1b24]/90 backdrop-blur-xl border-b border-slate-800/60 sticky top-0 z-40">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="font-black text-lg text-white shrink-0 tracking-tight"><span className="text-indigo-400 mr-1.5">&#9824;</span>StackSettler</div>
          <div className="text-sm font-medium text-slate-400">{pageTitles[currentTab]}</div>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 pt-4 pb-28 relative z-10">
        {currentTab === 'home' && renderHome()}
        {currentTab === 'session' && renderActiveSession()}
        {currentTab === 'players' && renderPlayers()}
        {currentTab === 'playerStats' && renderPlayerStats()}
        {currentTab === 'rankings' && renderRankings()}
        {currentTab === 'ledger' && renderLedger()}
        {currentTab === 'history' && renderHistory()}
        {currentTab === 'details' && renderGameDetails()}
        {currentTab === 'archive' && renderArchive()}
      </main>

      <nav className="tabbar fixed bottom-0 inset-x-0 z-40 bg-[#1a1b24]/95 backdrop-blur-xl border-t border-slate-800">
        <div className="max-w-xl mx-auto flex">
          {tabItems.map(({ key, label, Icon }) => {
            const active = key === 'more' ? moreActive : (currentTab === key && !moreOpen);
            return (
              <button key={key} onClick={() => { if (key === 'more') setMoreOpen(true); else { setMoreOpen(false); setActiveTab(key); } }} className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-2.5 pb-2 text-[11px] font-medium transition-colors ${active ? 'text-indigo-400' : 'text-slate-500'}`}>
                <span className="relative">
                  <Icon size={22} />
                  {key === 'session' && <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                </span>
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end" onClick={() => setMoreOpen(false)}>
          <div className="bg-slate-800 border-t border-slate-700 rounded-t-3xl w-full max-w-xl mx-auto p-4 sheet" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4" />
            {[{ key: 'ledger', label: 'Ledger', Icon: Scale }, { key: 'archive', label: 'Archive', Icon: Archive }].map(({ key, label, Icon }) => (
              <button key={key} onClick={() => { setMoreOpen(false); setActiveTab(key); }} className="w-full flex items-center p-4 rounded-xl active:bg-slate-700/60 text-left">
                <Icon size={22} className="text-indigo-400 mr-4" />
                <span className="flex-1 text-white font-medium">{label}</span>
                <ChevronRight size={18} className="text-slate-500" />
              </button>
            ))}
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl sm:max-w-sm w-full p-6 max-h-[90vh] overflow-y-auto sheet">
            <h3 className="text-xl font-bold text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-400 text-sm mb-6">{confirmModal.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmModal(null)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 rounded-xl transition-colors">Cancel</button>
              <button onClick={() => { const fn = confirmModal.onConfirm; setConfirmModal(null); if (fn) fn(); }} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-3 rounded-xl transition-colors">{confirmModal.confirmLabel || 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
