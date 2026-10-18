import React, { useState, useEffect, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { 
  Users, History, Plus, DollarSign, ArrowRight, Save, 
  CheckCircle2, AlertCircle, X, ChevronRight, Calculator,
  TrendingUp, TrendingDown, Clock, Minus, LogOut, Settings, RotateCcw, Scale,
  Pencil, ArrowRightLeft, Coins, BookOpen,
  Home, Trophy, Activity, Play, Trash2,
  User, Check, Archive, Menu, Share2
} from 'lucide-react';
// --- Helper Functions ---
const generateId = () => Math.random().toString(36).substr(2, 9);
const formatCurrency = (val) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: activeCurrency }).format(val || 0); } catch (e) { return `$${(val || 0).toFixed(2)}`; } };
const formatDate = (dateString) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(dateString));

// --- Settings, sharing & export helpers ---
const readSetting = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; } };
let activeCurrency = readSetting('pokerTracker_currency', 'USD');
let settleRound = Number(readSetting('pokerTracker_roundTo', '5'));
if (isNaN(settleRound)) settleRound = 5;
const CURRENCIES = [['USD', '$ US dollar'], ['INR', '₹ Indian rupee'], ['EUR', '€ Euro'], ['GBP', '£ British pound'], ['AED', 'AED Dirham'], ['CAD', '$ Canadian dollar'], ['AUD', '$ Australian dollar'], ['SGD', '$ Singapore dollar']];
const ROUND_OPTIONS = [[0, 'Exact amounts'], [1, 'Nearest 1'], [5, 'Nearest 5'], [10, 'Nearest 10'], [50, 'Nearest 50'], [100, 'Nearest 100']];
const currencySymbol = () => {
  try {
    const part = new Intl.NumberFormat('en-US', { style: 'currency', currency: activeCurrency }).formatToParts(0).find(x => x.type === 'currency');
    return part ? part.value : '$';
  } catch (e) { return '$'; }
};
const copyText = async (text) => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
};
const downloadFile = (text, filename, mime) => {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) { return false; }
};
const shareOrCopy = async (title, text) => {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return 'shared'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  return (await copyText(text)) ? 'copied' : 'failed';
};
const INPUT_CLS = 'w-full bg-slate-900 border border-slate-600 rounded-xl py-2.5 px-3 text-white focus:outline-none focus:border-indigo-500';
const gamePayoutId = (tx, idx) => tx.id || `p${idx}`;

// Works out which payments in each game are already covered by recorded payments (from the Ledger or the game)
const computeGameSettlementStates = (games, settlements) => {
  // Administrative balance write-offs must not count as real game payments.
  const actualSettlements = settlements.filter(s => s.type !== 'balance-clear');
  const ordered = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
  const rem = {};
  ordered.forEach(g => {
    rem[g.id] = {};
    (g.players || []).forEach(p => {
      const n = p.net || 0;
      const debt = n < 0 ? -n : 0, credit = n > 0 ? n : 0;
      rem[g.id][p.name] = { debt, credit, debt0: debt, credit0: credit };
    });
  });
  const used = {};
  const clear = (name, amount, kind, onlyGameId, sid) => {
    let left = amount;
    const ids = onlyGameId ? [onlyGameId] : ordered.map(g => g.id);
    ids.forEach(id => {
      const r = rem[id] && rem[id][name];
      if (!r || left <= 0.0001) return;
      const take = Math.min(left, r[kind]);
      if (take > 0.0001) { const key = `${id}|${name}|${kind}`; (used[key] = used[key] || []).push(sid); }
      r[kind] -= take;
      left -= take;
    });
  };
  const sorted = [...actualSettlements].sort((a, b) => ((a.gameId ? 0 : 1) - (b.gameId ? 0 : 1)) || (new Date(a.date) - new Date(b.date)));
  sorted.forEach(st => {
    const only = st.gameId && rem[st.gameId] ? st.gameId : null;
    clear(st.from, st.amount, 'debt', only, st.id);
    clear(st.to, st.amount, 'credit', only, st.id);
  });
  const out = {};
  ordered.forEach(g => {
    const debtPool = {}, creditPool = {};
    Object.keys(rem[g.id]).forEach(name => {
      const r = rem[g.id][name];
      debtPool[name] = Math.max(0, r.debt0 - r.debt);
      creditPool[name] = Math.max(0, r.credit0 - r.credit);
    });
    const taggedHere = new Set(actualSettlements.filter(x => x.gameId === g.id && x.payoutId).map(x => x.id));
    out[g.id] = (g.payouts || []).map((tx, idx) => {
      const pid = gamePayoutId(tx, idx);
      const tagged = actualSettlements.some(s => s.gameId === g.id && s.payoutId === pid);
      const a = tx.amount;
      const payer = debtPool[tx.from] || 0, recv = creditPool[tx.to] || 0;
      if (tagged) {
        debtPool[tx.from] = payer - Math.min(a, payer);
        creditPool[tx.to] = recv - Math.min(a, recv);
        return { state: 'paid', settledAmt: a, sources: [] };
      }
      const cover = Math.min(a, payer, recv);
      debtPool[tx.from] = payer - cover;
      creditPool[tx.to] = recv - cover;
      const sources = [...(used[`${g.id}|${tx.from}|debt`] || []), ...(used[`${g.id}|${tx.to}|credit`] || [])].filter((id, i, arr) => arr.indexOf(id) === i && !taggedHere.has(id));
      return { state: cover >= a - 0.01 ? 'ledger' : cover > 0.01 ? 'partial' : 'open', settledAmt: cover, sources };
    });
  });
  return out;
};



const recoverTruncatedBackup = (source) => {
  if (!/"app"\s*:\s*"StackSettler"/.test(source)) return null;
  const gamesMatch = /"games"\s*:\s*\[/.exec(source);
  if (!gamesMatch) return null;
  const arrayStart = gamesMatch.index + gamesMatch[0].lastIndexOf('[') + 1;
  const games = [];
  let partialGameCount = 0;
  let i = arrayStart;
  while (i < source.length) {
    while (i < source.length && /[\s,]/.test(source[i])) i++;
    if (source[i] !== '{') break;
    const start = i;
    let depth = 0, inString = false, escaped = false, complete = false;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) { i++; complete = true; break; }
      }
    }
    const fragment = source.slice(start, i);
    if (complete) {
      try { games.push(JSON.parse(fragment)); } catch (e) {}
    } else {
      // Keep only complete top-level fields from the final incomplete game object.
      const fields = {};
      let segmentStart = 1, nested = 0, quoted = false, slash = false;
      const addField = (segment) => {
        try { Object.assign(fields, JSON.parse('{' + segment + '}')); } catch (e) {}
      };
      for (let j = 1; j < fragment.length; j++) {
        const ch = fragment[j];
        if (quoted) {
          if (slash) slash = false;
          else if (ch === '\\') slash = true;
          else if (ch === '"') quoted = false;
          continue;
        }
        if (ch === '"') { quoted = true; continue; }
        if (ch === '{' || ch === '[') nested++;
        else if (ch === '}' || ch === ']') nested--;
        else if (ch === ',' && nested === 0) {
          addField(fragment.slice(segmentStart, j));
          segmentStart = j + 1;
        }
      }
      if (Array.isArray(fields.players) && Array.isArray(fields.payouts) && fields.date) {
        fields.id = fields.id || generateId();
        fields.logs = Array.isArray(fields.logs) ? fields.logs : [];
        partialGameCount++;
        games.push(fields);
      }
      break;
    }
  }
  if (!games.length) return null;
  const rosterByName = new Map();
  games.forEach(g => (g.players || []).forEach(p => {
    if (p.name && !rosterByName.has(p.name)) rosterByName.set(p.name, { id: p.id || generateId(), name: p.name });
  }));
  return { app: 'StackSettler', version: 1, games, roster: Array.from(rosterByName.values()), settlements: [], partial: true, recoveredPartialGameCount: partialGameCount };
};

// --- Greedy Settlement Algorithm ---
const calculateSimplifiedPayouts = (originalPlayers, roundToOverride = settleRound) => {
  const players = originalPlayers.map(p => ({ ...p }));
  
  let totalDiscount = 0;
  
  players.forEach(p => {
    if (p.net < -0.01) {
      const debt = Math.abs(p.net);
      const favoredDebt = roundToOverride > 0 ? Math.floor(debt / roundToOverride) * roundToOverride : debt;
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
  return `${v < -EPS ? '-' : ''}${currencySymbol()}${s}`;
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

const SheetShell = ({ title, subtitle, onClose, children }) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
    <div className="bg-slate-800 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md p-5 max-h-[90vh] overflow-y-auto sheet">
      <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4 sm:hidden" />
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xl font-bold text-white">{title}</h3>
          {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="text-slate-400 p-1 shrink-0"><X size={22} /></button>
      </div>
      {children}
    </div>
  </div>
);

// --- Components ---
export default function App() {
  const [restored] = useState(readActiveSession);
  const [activeTab, setActiveTab] = useState(restored ? 'session' : 'home');
  const [sessionStartedAt, setSessionStartedAt] = useState(restored ? restored.startedAt : null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [currency, setCurrency] = useState(activeCurrency);
  const [roundTo, setRoundTo] = useState(settleRound);
  const [keepAwake, setKeepAwake] = useState(readSetting('pokerTracker_keepAwake', '1') === '1');
  const [sessionNotes, setSessionNotes] = useState(restored && restored.notes ? restored.notes : '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backupText, setBackupText] = useState('');
  const [restoreText, setRestoreText] = useState('');
  const [paymentSheet, setPaymentSheet] = useState(null);
  const [planEdit, setPlanEdit] = useState(null);
  const [resultsEdit, setResultsEdit] = useState(null);
  const [rankPeriod, setRankPeriod] = useState('all');
  const [ledgerPlan, setLedgerPlan] = useState(() => { try { const raw = localStorage.getItem('pokerTracker_ledgerPlan'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } });
  const [noteDraft, setNoteDraft] = useState('');
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
  }, [masterLedger, roundTo]);

  const balanceKey = useMemo(() => masterLedger.map(p => `${p.name}:${round2(p.net)}`).sort().join('|'), [masterLedger]);
  const customLedgerActive = !!(ledgerPlan && ledgerPlan.key === balanceKey);
  const ledgerSettled = masterLedger.every(p => Math.abs(p.net) <= EPS) && (customLedgerActive ? ledgerPlan.rows : masterPayouts).length === 0;
  const gameStates = useMemo(() => computeGameSettlementStates(gamesHistory, settlements), [gamesHistory, settlements]);

  // --- Player stats & rankings ---
  const allStats = useMemo(() => masterLedger.map(p => ({ ...computePlayerStats(gamesHistory, p.name), inRoster: p.inRoster, id: p.id })), [masterLedger, gamesHistory]);
  const statsByName = useMemo(() => { const m = {}; allStats.forEach(st => { m[st.name] = st; }); return m; }, [allStats]);
  const earningsRank = useMemo(() => {
    const r = {};
    allStats.filter(st => st.games > 0).sort((a, b) => b.totalNet - a.totalNet).forEach((st, i) => { r[st.name] = i + 1; });
    return r;
  }, [allStats]);
  const rankedPlayerCount = Object.keys(earningsRank).length;
  const periodStats = useMemo(() => {
    if (rankPeriod === 'all') return allStats;
    const now = new Date();
    const from = rankPeriod === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
      : rankPeriod === 'year' ? new Date(now.getFullYear(), 0, 1)
      : new Date(now.getTime() - 30 * 86400000);
    const games = gamesHistory.filter(g => new Date(g.date) >= from);
    return masterLedger.map(p => ({ ...computePlayerStats(games, p.name), inRoster: p.inRoster, id: p.id }));
  }, [rankPeriod, allStats, gamesHistory, masterLedger]);
  const rankings = useMemo(() => {
    const metric = RANK_METRICS.find(m => m.key === rankMetric) || RANK_METRICS[0];
    const withVal = periodStats.map(st => ({ s: st, v: metric.get(st) }));
    const valid = (x) => x.v !== null && x.v !== undefined && !isNaN(x.v);
    const ranked = withVal.filter(valid).sort((a, b) => (b.v - a.v) || (b.s.games - a.s.games));
    const unranked = withVal.filter(x => !valid(x));
    return { metric, ranked, unranked };
  }, [periodStats, rankMetric]);

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
          buyInValue, chipRatio, calculatedPayouts, notes: sessionNotes
        }));
      } else {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch (e) {}
  }, [sessionStartedAt, sessionPlayers, sessionLogs, buyInValue, chipRatio, calculatedPayouts, sessionNotes]);

  // --- Custom ledger plan: save it, and drop it if balances change underneath it ---
  useEffect(() => {
    try {
      if (ledgerPlan) localStorage.setItem('pokerTracker_ledgerPlan', JSON.stringify(ledgerPlan));
      else localStorage.removeItem('pokerTracker_ledgerPlan');
    } catch (e) {}
  }, [ledgerPlan]);
  useEffect(() => {
    if (ledgerPlan && ledgerPlan.key !== balanceKey) {
      setLedgerPlan(null);
      showToast('Balances changed, so your custom plan was reset');
    }
  }, [balanceKey, ledgerPlan]);

  // --- Keep the screen on during a live session ---
  useEffect(() => {
    if (!isSessionActive || !keepAwake) return undefined;
    let lock = null;
    const acquire = async () => {
      try { if ('wakeLock' in navigator) lock = await navigator.wakeLock.request('screen'); } catch (e) {}
    };
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      try { if (lock) lock.release(); } catch (e) {}
    };
  }, [isSessionActive, keepAwake]);

  useEffect(() => { setNoteDraft(selectedGame && selectedGame.notes ? selectedGame.notes : ''); }, [selectedGame ? selectedGame.id : null]);

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

  const handleSettlePayment = (from, to, amount, meta = {}) => {
    const newTx = { id: generateId(), date: new Date().toISOString(), from, to, amount, ...meta };
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
    setSessionNotes('');
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
      notes: sessionNotes.trim(),
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
      setSessionNotes('');
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
    setSessionNotes('');
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

  // --- Toast, sharing, settings, backup ---
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2600); };
  const doShare = async (title, text) => {
    const r = await shareOrCopy(title, text);
    if (r === 'copied') showToast('Copied to clipboard');
    else if (r === 'failed') showToast("Couldn't share or copy");
  };
  const buildSettlementText = (title, payouts, paidIds) => `${title}\n` + (payouts.length
    ? payouts.map((tx, idx) => `${tx.from} pays ${tx.to} ${formatCurrency(tx.amount)}${paidIds && paidIds[idx] ? ' (paid)' : ''}`).join('\n')
    : 'Everyone is settled up.');
  const persistSettlements = (list) => {
    setSettlements(list);
    try { localStorage.setItem('pokerTracker_settlements', JSON.stringify(list)); } catch (e) {}
  };
  const updateGame = (newGame) => {
    const list = gamesHistory.map(x => x.id === newGame.id ? newGame : x);
    setGamesHistory(list);
    try { localStorage.setItem('pokerTracker_games', JSON.stringify(list)); } catch (e) {}
    if (selectedGame && selectedGame.id === newGame.id) setSelectedGame(newGame);
  };

  const changeCurrency = (code) => {
    activeCurrency = code;
    try { localStorage.setItem('pokerTracker_currency', code); } catch (e) {}
    setCurrency(code);
  };
  const changeRound = (val) => {
    settleRound = val;
    try { localStorage.setItem('pokerTracker_roundTo', String(val)); } catch (e) {}
    setRoundTo(val);
  };
  const changeKeepAwake = (val) => {
    try { localStorage.setItem('pokerTracker_keepAwake', val ? '1' : '0'); } catch (e) {}
    setKeepAwake(val);
  };

  const buildBackup = () => JSON.stringify({
    app: 'StackSettler', version: 1, exportedAt: new Date().toISOString(),
    games: gamesHistory, roster: roster, settlements: settlements, ledgerPlan: ledgerPlan,
    settings: { currency: activeCurrency, roundTo: settleRound, keepAwake: keepAwake }
  });
  const buildCsv = () => {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = ['date,player,buy_in,cash_out,net,minutes'];
    [...gamesHistory].reverse().forEach(g => (g.players || []).forEach(p => {
      const r = getPlayerGameStats(g, p);
      lines.push([esc(new Date(g.date).toISOString()), esc(p.name), r.buyIn.toFixed(2), r.cashOut.toFixed(2), r.net.toFixed(2), r.minutes === null ? '' : Math.round(r.minutes)].join(','));
    }));
    return lines.join('\n');
  };
  const exportNow = async (kind) => {
    const text = kind === 'json' ? buildBackup() : buildCsv();
    const day = new Date().toISOString().slice(0, 10);
    const dl = downloadFile(text, kind === 'json' ? `stacksettler-backup-${day}.json` : `stacksettler-games-${day}.csv`, kind === 'json' ? 'application/json' : 'text/csv');
    const cp = await copyText(text);
    setBackupText(text);
    showToast(dl && cp ? 'File saved and text copied' : dl ? 'File saved' : cp ? 'Copied to clipboard' : 'Select the text below to copy it');
  };
  const restoreBackup = (text) => {
    let data;
    const normalized = String(text || '').replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { data = JSON.parse(normalized); } catch (e) {
      const recovered = recoverTruncatedBackup(normalized);
      if (recovered) {
        const partialGameCount = recovered.recoveredPartialGameCount || 0;
        setConfirmModal({
          title: 'Backup text is truncated',
          message: `I recovered ${recovered.games.length} game record(s)${partialGameCount ? `, including ${partialGameCount} game with incomplete logs` : ''}. The copied text does not contain the roster, settlement archive, or app settings. Continuing replaces current games, rebuilds the player list from the recovered games, clears the settlement archive, and leaves your current app settings unchanged. Use the original .json file if you have it.`,
          confirmLabel: 'Restore recovered games',
          onConfirm: () => restoreBackup(JSON.stringify(recovered))
        });
        return;
      }
      const match = String(e && e.message || '').match(/position (\d+)/i);
      const position = match ? Number(match[1]) : null;
      showToast(`Backup is incomplete or invalid${position === null ? '' : ` near character ${position}`}. Upload the original .json backup file or copy the entire text again.`);
      return;
    }
    if (!data || data.app !== 'StackSettler' || !Array.isArray(data.games)) { showToast('This is not a StackSettler backup'); return; }
    setGamesHistory(data.games);
    try { localStorage.setItem('pokerTracker_games', JSON.stringify(data.games)); } catch (e) {}
    const r = Array.isArray(data.roster) ? data.roster : [];
    setRoster(r); saveRoster(r);
    persistSettlements(Array.isArray(data.settlements) ? data.settlements : []);
    setLedgerPlan(data.ledgerPlan || null);
    if (data.settings) {
      if (data.settings.currency) changeCurrency(data.settings.currency);
      if (typeof data.settings.roundTo === 'number') changeRound(data.settings.roundTo);
      if (typeof data.settings.keepAwake === 'boolean') changeKeepAwake(data.settings.keepAwake);
    }
    setRestoreText('');
    showToast(`Restored ${data.games.length} games`);
  };

  // --- Per-game settlements ---
  const findGameSettlement = (gameId, pid) => settlements.find(s => s.gameId === gameId && s.payoutId === pid);
  const rowState = (game, idx) => {
    const st = (gameStates[game.id] || [])[idx] || { state: 'open', settledAmt: 0 };
    const tx = (game.payouts || [])[idx];
    if (ledgerSettled && !settlements.some(s => s.type === 'balance-clear') && st.state !== 'paid' && tx) return { state: 'ledger', settledAmt: tx.amount, sources: st.sources || [] };
    return st;
  };
  const gameSettleStatus = (game) => {
    const list = game.payouts || [];
    let paid = 0;
    list.forEach((tx, idx) => { const st = rowState(game, idx).state; if (st === 'paid' || st === 'ledger') paid++; });
    return { total: list.length, paid };
  };
  // Warn before a payment would push someone past zero (usually a double payment)
  const overpayMessages = (txs) => {
    const net = {};
    masterLedger.forEach(pl => { net[pl.name] = pl.net; });
    const msgs = [];
    txs.forEach(tx => {
      const nf = net[tx.from] || 0;
      const nt = net[tx.to] || 0;
      if (nf + tx.amount > 0.01) msgs.push(`${tx.from} only owes ${formatCurrency(Math.max(0, -nf))} right now, so paying ${formatCurrency(tx.amount)} would make ${tx.from} owed ${formatCurrency(nf + tx.amount)}.`);
      if (nt - tx.amount < -0.01) msgs.push(`${tx.to} is only owed ${formatCurrency(Math.max(0, nt))} right now, so receiving ${formatCurrency(tx.amount)} would make ${tx.to} owe ${formatCurrency(tx.amount - nt)}.`);
      net[tx.from] = nf + tx.amount;
      net[tx.to] = nt - tx.amount;
    });
    return msgs;
  };
  const confirmPayments = (txs, doIt) => {
    const msgs = overpayMessages(txs);
    if (!msgs.length) { doIt(); return; }
    setConfirmModal({ title: 'This looks like paying twice', message: `${msgs.slice(0, 2).join(' ')} If this was already marked in the Ledger, undo that in the Archive first.`, confirmLabel: 'Mark anyway', onConfirm: doIt });
  };
  const toggleGamePayout = (game, tx, idx) => {
    const pid = gamePayoutId(tx, idx);
    const ex = findGameSettlement(game.id, pid);
    if (ex) { handleDeleteSettlement(ex.id); return; }
    confirmPayments([tx], () => handleSettlePayment(tx.from, tx.to, tx.amount, { gameId: game.id, payoutId: pid }));
  };
  const settleAllGamePayouts = (game) => {
    const add = [];
    (game.payouts || []).forEach((tx, idx) => {
      const pid = gamePayoutId(tx, idx);
      const rs = rowState(game, idx);
      if (rs.state === 'open') add.push({ id: generateId(), date: new Date().toISOString(), from: tx.from, to: tx.to, amount: tx.amount, gameId: game.id, payoutId: pid });
      else if (rs.state === 'partial') add.push({ id: generateId(), date: new Date().toISOString(), from: tx.from, to: tx.to, amount: round2(tx.amount - rs.settledAmt), gameId: game.id, payoutId: pid });
    });
    if (add.length) confirmPayments(add, () => persistSettlements([...add, ...settlements]));
  };
  const undoCover = (ids) => {
    const list = settlements.filter(x => ids.includes(x.id));
    if (!list.length) return;
    const lines = list.map(x => `${x.from} paid ${x.to} ${formatCurrency(x.amount)}`).join(', ');
    setConfirmModal({ title: 'Undo these payments?', message: `${lines}. They are also removed from the Ledger and Archive.`, confirmLabel: 'Undo', onConfirm: () => persistSettlements(settlements.filter(x => !ids.includes(x.id))) });
  };
  const markRestPaid = (game, tx, idx, rest) => {
    const pid = gamePayoutId(tx, idx);
    const amount = round2(rest);
    confirmPayments([{ from: tx.from, to: tx.to, amount }], () => handleSettlePayment(tx.from, tx.to, amount, { gameId: game.id, payoutId: pid }));
  };
  const undoAllGamePayouts = (game) => persistSettlements(settlements.filter(s => s.gameId !== game.id));

  // --- Edit who pays who (game, ledger, or live session) ---
  const rowsFromPayouts = (list) => (list || []).map((tx, idx) => ({ id: gamePayoutId(tx, idx), from: tx.from, to: tx.to, amount: String(tx.amount) }));
  const planContext = (pe) => {
    if (!pe) return { names: [], nets: [] };
    if (pe.kind === 'ledger') return { names: masterLedger.map(p => p.name), nets: masterLedger.map(p => ({ name: p.name, net: p.net })) };
    if (pe.kind === 'session') return { names: sessionPlayers.map(p => p.name), nets: sessionPlayers.map(p => ({ name: p.name, net: p.net })) };
    const g = gamesHistory.find(x => x.id === pe.gameId);
    const ps = g ? (g.players || []) : [];
    return { names: ps.map(p => p.name), nets: ps.map(p => ({ name: p.name, net: p.net })) };
  };
  const openPlanEditor = (g) => setPlanEdit({ kind: 'game', gameId: g.id, rows: rowsFromPayouts(g.payouts) });
  const openLedgerPlanEditor = () => setPlanEdit({ kind: 'ledger', rows: rowsFromPayouts(customLedgerActive ? ledgerPlan.rows : masterPayouts) });
  const openSessionPlanEditor = () => setPlanEdit({ kind: 'session', rows: rowsFromPayouts(calculatedPayouts) });
  const setPlanRow = (idx, patch) => setPlanEdit(prev => {
    const nextRows = prev.rows.map((r, i) => i === idx ? { ...r, ...patch } : r);
    if (!('from' in patch) && !('to' in patch) && !('amount' in patch)) return { ...prev, rows: nextRows };
    const anchor = nextRows[idx];
    const amount = round2(Number(anchor.amount) || 0);
    const balances = planContext(prev).nets.map(p => ({ name: p.name, net: Number(p.net) || 0 }));
    if (!anchor.from || !anchor.to || anchor.from === anchor.to || amount <= 0) return { ...prev, rows: nextRows };
    const payer = balances.find(p => p.name === anchor.from);
    const receiver = balances.find(p => p.name === anchor.to);
    if (!payer || !receiver) return { ...prev, rows: nextRows };
    payer.net = round2(payer.net + amount);
    receiver.net = round2(receiver.net - amount);
    const remainder = calculateSimplifiedPayouts(balances).map(tx => {
      const existing = prev.rows.find((r, i) => i !== idx && r.from === tx.from && r.to === tx.to && Math.abs((Number(r.amount) || 0) - tx.amount) < 0.005);
      return { id: existing ? existing.id : generateId(), from: tx.from, to: tx.to, amount: String(tx.amount) };
    });
    return { ...prev, rows: [{ ...anchor, amount: String(amount) }, ...remainder] };
  });
  const addPlanRow = () => setPlanEdit(prev => {
    const names = planContext(prev).names;
    return { ...prev, rows: [...prev.rows, { id: generateId(), from: names[0] || '', to: names[1] || '', amount: '' }] };
  });
  const removePlanRow = (idx) => setPlanEdit(prev => ({ ...prev, rows: prev.rows.filter((_, i) => i !== idx) }));
  const resetPlanRows = () => setPlanEdit(prev => {
    const nets = planContext(prev).nets;
    const suggested = calculateSimplifiedPayouts(nets.map(n => ({ name: n.name, net: n.net })));
    return { ...prev, rows: suggested.map(tx => ({ id: generateId(), from: tx.from, to: tx.to, amount: String(tx.amount) })) };
  });
  const savePlanEdit = () => {
    const rows = planEdit.rows.map(r => ({ id: r.id, from: r.from, to: r.to, amount: round2(Number(r.amount)) }));
    if (planEdit.kind === 'ledger') {
      setLedgerPlan(rows.length ? { key: balanceKey, rows } : null);
    } else if (planEdit.kind === 'session') {
      setCalculatedPayouts(rows);
    } else {
      const g = gamesHistory.find(x => x.id === planEdit.gameId);
      if (!g) { setPlanEdit(null); return; }
      updateGame({ ...g, payouts: rows });
      // Keep historical payments when the plan is edited. Detach the old payout ID
      // so the payment still affects balances and can cover matching rows in the new plan.
      const keep = settlements.map(s => {
        if (s.gameId !== g.id || !s.payoutId) return s;
        const r = rows.find(x => x.id === s.payoutId);
        if (r && r.from === s.from && r.to === s.to && Math.abs(r.amount - s.amount) < 0.005) return s;
        const { payoutId, ...historicalPayment } = s;
        return historicalPayment;
      });
      if (keep.some((s, i) => s !== settlements[i])) persistSettlements(keep);
    }
    setPlanEdit(null);
    showToast('Plan updated');
  };
  const clearRemainingLedgerBalances = () => {
    const rows = calculateSimplifiedPayouts(masterLedger, 0).filter(tx => tx.amount > EPS);
    if (!rows.length) { showToast('No remaining ledger balances to clear'); return; }
    const total = round2(rows.reduce((sum, tx) => sum + tx.amount, 0));
    setConfirmModal({
      title: 'Clear remaining balances?',
      message: `This writes off the remaining ${formatCurrency(total)} in the combined Ledger. It is recorded in the Archive as a balance clear, not as a real payment, and does not mark individual game payments as paid.`,
      confirmLabel: 'Clear balances',
      onConfirm: () => {
        const date = new Date().toISOString();
        const clears = rows.map(tx => ({ ...tx, id: generateId(), date, type: 'balance-clear' }));
        persistSettlements([...clears, ...settlements]);
        setLedgerPlan(null);
        showToast('Remaining ledger balances cleared');
      }
    });
  };

  const settleLedgerRow = (tx) => {
    confirmPayments([tx], () => {
      handleSettlePayment(tx.from, tx.to, tx.amount);
      if (customLedgerActive) {
        const rows = ledgerPlan.rows.filter(r => r.id !== tx.id);
        const nets = {};
        masterLedger.forEach(p => { nets[p.name] = p.net; });
        if (nets[tx.from] !== undefined) nets[tx.from] += tx.amount;
        if (nets[tx.to] !== undefined) nets[tx.to] -= tx.amount;
        const key = Object.keys(nets).map(n => `${n}:${round2(nets[n])}`).sort().join('|');
        setLedgerPlan(rows.length ? { key, rows } : null);
      }
    });
  };

  // --- Edit a game's results ---
  const openResultsEditor = (g) => setResultsEdit({ gameId: g.id, rows: (g.players || []).map(p => { const r = getPlayerGameStats(g, p); return { name: p.name, buyIn: String(round2(r.buyIn)), cashOut: String(round2(r.cashOut)) }; }) });
  const setResultRow = (idx, patch) => setResultsEdit(prev => ({ ...prev, rows: prev.rows.map((r, i) => i === idx ? { ...r, ...patch } : r) }));
  const saveResultsEdit = () => {
    const g = gamesHistory.find(x => x.id === resultsEdit.gameId);
    if (!g) { setResultsEdit(null); return; }
    const nums = resultsEdit.rows.map(r => ({ name: r.name, buyIn: round2(Number(r.buyIn) || 0), cashOut: round2(Number(r.cashOut) || 0) }));
    const players = (g.players || []).map(p => {
      const n = nums.find(x => x.name === p.name);
      return { ...p, totalBuyIn: n.buyIn, totalCashOut: n.cashOut, net: round2(n.cashOut - n.buyIn), normalizationAdjustment: 0 };
    });
    const payouts = calculateSimplifiedPayouts(players.map(p => ({ name: p.name, net: p.net }))).map(tx => ({ id: generateId(), from: tx.from, to: tx.to, amount: tx.amount }));
    updateGame({ ...g, players, payouts, totalPot: round2(nums.reduce((s, n) => s + n.buyIn, 0)) });
    persistSettlements(settlements.filter(s => s.gameId !== g.id));
    setResultsEdit(null);
    showToast('Game results updated');
  };
  const requestSaveResults = () => {
    const hasPaid = settlements.some(s => s.gameId === resultsEdit.gameId);
    if (hasPaid) setConfirmModal({ title: 'Update results?', message: 'This rebuilds the settlement plan and clears the paid marks for this game.', confirmLabel: 'Update', onConfirm: saveResultsEdit });
    else saveResultsEdit();
  };

  // --- Record a custom payment ---
  const openPaymentSheet = (init = {}) => setPaymentSheet({ from: init.from || '', to: init.to || '', amount: init.amount !== undefined ? String(init.amount) : '', gameId: init.gameId || null });
  const savePayment = () => {
    const amt = round2(Number(paymentSheet.amount));
    if (!paymentSheet.from || !paymentSheet.to || paymentSheet.from === paymentSheet.to || !(amt > 0)) return;
    const pay = { from: paymentSheet.from, to: paymentSheet.to, amount: amt };
    setPaymentSheet(null);
    confirmPayments([pay], () => { handleSettlePayment(pay.from, pay.to, pay.amount, paymentSheet.gameId ? { gameId: paymentSheet.gameId } : {}); showToast('Payment recorded'); });
  };

  // --- Sheets ---
  const renderPlanEditor = () => {
    if (!planEdit) return null;
    const ctx = planContext(planEdit);
    const names = ctx.names;
    if (names.length === 0) return null;
    const rows = planEdit.rows;
    const left = ctx.nets.map(p => {
      let moved = 0;
      rows.forEach(r => { const a = Number(r.amount) || 0; if (r.to === p.name) moved += a; if (r.from === p.name) moved -= a; });
      return { name: p.name, rest: round2(p.net - moved) };
    }).filter(x => Math.abs(x.rest) > 0.009);
    const valid = rows.every(r => r.from && r.to && r.from !== r.to && Number(r.amount) > 0);
    const subtitle = planEdit.kind === 'ledger' ? 'Change who pays whom across all games. Nothing is marked paid until you tap Mark settled.'
      : planEdit.kind === 'session' ? 'Change who pays whom before you end the session.'
      : 'Change who pays whom for this game. Nothing is marked paid until you tap Mark paid.';
    return (
      <SheetShell title="Who pays who" subtitle={subtitle} onClose={() => setPlanEdit(null)}>
        <div className="space-y-3 mb-3">
          {rows.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No payments in the plan. Add one below.</p>}
          {rows.map((r, idx) => (
            <div key={r.id} className="bg-slate-900/50 border border-slate-700 rounded-xl p-3">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <label className="block">
                  <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Pays</span>
                  <select value={r.from} onChange={(e) => setPlanRow(idx, { from: e.target.value })} className={INPUT_CLS}>
                    {names.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Receives</span>
                  <select value={r.to} onChange={(e) => setPlanRow(idx, { to: e.target.value })} className={INPUT_CLS}>
                    {names.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" inputMode="decimal" min="0" placeholder={`Amount (${currencySymbol()})`} value={r.amount} onChange={(e) => setPlanRow(idx, { amount: e.target.value })} className={INPUT_CLS} />
                <button onClick={() => removePlanRow(idx)} className="h-11 w-11 shrink-0 flex items-center justify-center bg-rose-900/30 text-rose-400 rounded-xl"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mb-4">
          <button onClick={addPlanRow} className="flex-1 h-10 bg-slate-700 text-slate-200 rounded-xl text-sm font-semibold flex items-center justify-center"><Plus size={16} className="mr-1" /> Add payment</button>
          <button onClick={resetPlanRows} className="flex-1 h-10 bg-slate-700 text-slate-200 rounded-xl text-sm font-semibold flex items-center justify-center"><RotateCcw size={14} className="mr-1.5" /> Suggested plan</button>
        </div>
        {left.length > 0 && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-3 mb-4 text-sm">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Left unsettled by this plan</div>
            {left.map(x => (
              <div key={x.name} className="flex justify-between text-slate-300"><span>{x.name}</span><span className={x.rest > 0 ? 'text-emerald-400' : 'text-rose-400'}>{x.rest > 0 ? 'is owed ' : 'still owes '}{formatCurrency(Math.abs(x.rest))}</span></div>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={() => setPlanEdit(null)} className="flex-1 bg-slate-700 text-white font-medium py-3 rounded-xl">Cancel</button>
          <button onClick={savePlanEdit} disabled={!valid} className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl disabled:opacity-50">Save plan</button>
        </div>
      </SheetShell>
    );
  };

  const renderResultsEditor = () => {
    if (!resultsEdit) return null;
    const rows = resultsEdit.rows;
    const totalIn = round2(rows.reduce((s, r) => s + (Number(r.buyIn) || 0), 0));
    const totalOut = round2(rows.reduce((s, r) => s + (Number(r.cashOut) || 0), 0));
    const diff = round2(totalOut - totalIn);
    const balanced = Math.abs(diff) <= 0.01;
    return (
      <SheetShell title="Edit results" subtitle="Fix a buy-in or cash-out. The settlement plan is rebuilt." onClose={() => setResultsEdit(null)}>
        <div className="space-y-3 mb-3">
          {rows.map((r, idx) => {
            const net = round2((Number(r.cashOut) || 0) - (Number(r.buyIn) || 0));
            return (
              <div key={r.name} className="bg-slate-900/50 border border-slate-700 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-100 truncate">{r.name}</span>
                  <span className={`font-bold ${toneOf(net) === 'pos' ? 'text-emerald-400' : toneOf(net) === 'neg' ? 'text-rose-400' : 'text-slate-400'}`}>{formatSigned(net)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Bought in ({currencySymbol()})</span>
                    <input type="number" inputMode="decimal" min="0" value={r.buyIn} onChange={(e) => setResultRow(idx, { buyIn: e.target.value })} className={INPUT_CLS} />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Cashed out ({currencySymbol()})</span>
                    <input type="number" inputMode="decimal" min="0" value={r.cashOut} onChange={(e) => setResultRow(idx, { cashOut: e.target.value })} className={INPUT_CLS} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className={`rounded-xl p-3 mb-4 text-sm font-medium ${balanced ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-900/20 text-rose-400 border border-rose-500/30'}`}>
          {balanced ? `Balanced: ${formatCurrency(totalIn)} in, ${formatCurrency(totalOut)} out` : `Cash-outs are ${formatCurrency(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than buy-ins. Fix this to save.`}
        </div>
        <div className="flex gap-3">
          <button onClick={() => setResultsEdit(null)} className="flex-1 bg-slate-700 text-white font-medium py-3 rounded-xl">Cancel</button>
          <button onClick={requestSaveResults} disabled={!balanced} className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl disabled:opacity-50">Save results</button>
        </div>
      </SheetShell>
    );
  };

  const renderPaymentSheet = () => {
    if (!paymentSheet) return null;
    const names = masterLedger.map(p => p.name);
    const amt = Number(paymentSheet.amount);
    const valid = paymentSheet.from && paymentSheet.to && paymentSheet.from !== paymentSheet.to && amt > 0;
    return (
      <SheetShell title="Log a past payment" subtitle="For money that has already been paid, including part-payments. Balances update right away." onClose={() => setPaymentSheet(null)}>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Paid by</span>
            <select value={paymentSheet.from} onChange={(e) => setPaymentSheet(prev => ({ ...prev, from: e.target.value }))} className={INPUT_CLS}>
              <option value="">Choose...</option>
              {names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Paid to</span>
            <select value={paymentSheet.to} onChange={(e) => setPaymentSheet(prev => ({ ...prev, to: e.target.value }))} className={INPUT_CLS}>
              <option value="">Choose...</option>
              {names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <label className="block mb-4">
          <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Amount ({currencySymbol()})</span>
          <input type="number" inputMode="decimal" min="0" value={paymentSheet.amount} onChange={(e) => setPaymentSheet(prev => ({ ...prev, amount: e.target.value }))} className={INPUT_CLS} />
        </label>
        <div className="flex gap-3">
          <button onClick={() => setPaymentSheet(null)} className="flex-1 bg-slate-700 text-white font-medium py-3 rounded-xl">Cancel</button>
          <button onClick={savePayment} disabled={!valid} className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl disabled:opacity-50">Log payment</button>
        </div>
      </SheetShell>
    );
  };

  const renderSettings = () => {
    if (!settingsOpen) return null;
    return (
      <SheetShell title="Settings & backup" subtitle="Everything is stored on this device only." onClose={() => setSettingsOpen(false)}>
        <div className="space-y-5">
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Currency</span>
            <select value={currency} onChange={(e) => changeCurrency(e.target.value)} className={INPUT_CLS}>
              {CURRENCIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Round settlement debts down to</span>
            <select value={roundTo} onChange={(e) => changeRound(Number(e.target.value))} className={INPUT_CLS}>
              {ROUND_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
            <span className="block text-xs text-slate-500 mt-1">Applies to suggested plans. You can still edit any plan by hand.</span>
          </label>
          <label className="flex items-center justify-between bg-slate-900/50 border border-slate-700 rounded-xl p-3 cursor-pointer">
            <span className="text-slate-200 text-sm font-medium">Keep screen awake during a session</span>
            <input type="checkbox" checked={keepAwake} onChange={(e) => changeKeepAwake(e.target.checked)} className="h-5 w-5" />
          </label>

          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Back up your data</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => exportNow('json')} className="h-11 bg-indigo-600 text-white font-bold rounded-xl text-sm flex items-center justify-center">Backup (JSON)</button>
              <button onClick={() => exportNow('csv')} className="h-11 bg-slate-700 text-slate-100 font-semibold rounded-xl text-sm flex items-center justify-center">Games (CSV)</button>
            </div>
            {backupText && (
              <textarea readOnly value={backupText} onFocus={(e) => e.target.select()} className="w-full h-24 mt-2 bg-slate-900 border border-slate-600 rounded-xl p-2 text-xs text-slate-300" />
            )}
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Restore from a backup</div>
            <input type="file" accept=".json,application/json" onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => setRestoreText(String(reader.result || ''));
              reader.readAsText(f);
              e.target.value = '';
            }} className="block w-full text-sm text-slate-400 mb-2" />
            <textarea placeholder="...or paste backup text here" value={restoreText} onChange={(e) => setRestoreText(e.target.value)} className="w-full h-24 bg-slate-900 border border-slate-600 rounded-xl p-2 text-xs text-slate-300" />
            <button disabled={!restoreText.trim()} onClick={() => setConfirmModal({ title: 'Replace all data?', message: 'This replaces your games, players and settlements with the backup.', confirmLabel: 'Restore', onConfirm: () => restoreBackup(restoreText) })} className="w-full h-11 mt-2 bg-slate-700 text-slate-100 font-semibold rounded-xl text-sm disabled:opacity-40">Restore backup</button>
          </div>
        </div>
      </SheetShell>
    );
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
            <span className="block text-xs text-slate-400 mb-1">Buy-in value ({currencySymbol()})</span>
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
            <span className="block text-xs text-slate-400 mb-1">Chips per {currencySymbol()}1</span>
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

      <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
        <span className="block text-xs text-slate-400 mb-1">Game notes</span>
        <textarea rows={2} placeholder="Location, stakes, who hosted..." className="w-full bg-slate-900 border border-slate-600 rounded-xl py-2.5 px-3 text-white focus:outline-none focus:border-indigo-500" value={sessionNotes} onChange={(e) => setSessionNotes(e.target.value)} />
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
          
          <div className="p-5 border-t border-slate-700 bg-slate-900/30 flex flex-col gap-3">
            {calculatedPayouts.length > 0 && (
              <button onClick={() => doShare('StackSettler settlement', buildSettlementText('StackSettler settlement', calculatedPayouts))} className="w-full h-11 bg-slate-700 text-slate-100 font-semibold rounded-xl flex items-center justify-center text-sm"><Share2 size={16} className="mr-2" /> Share plan</button>
            )}
            <button onClick={openSessionPlanEditor} className="w-full h-11 bg-slate-700 text-slate-100 font-semibold rounded-xl flex items-center justify-center text-sm"><Pencil size={16} className="mr-2" /> Edit who pays who</button>
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
                <label className="block text-sm font-medium text-slate-400 mb-2">Amount ({currencySymbol()})</label>
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
                  {(() => { const st = gameSettleStatus(game); if (!st.total) return null; return <div className={`text-xs mt-1 ${st.paid === st.total ? 'text-emerald-400' : 'text-slate-500'}`}>{st.paid === st.total ? 'Settled' : `${st.paid} of ${st.total} settled`}</div>; })()}
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
          <p className="text-sm text-slate-500 mt-1">{rankPeriod === 'all' ? 'Ranked across all saved games.' : 'Ranked for the selected period.'} Tap a player for full stats.</p>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {RANK_METRICS.map(m => (
            <button key={m.key} onClick={() => setRankMetric(m.key)} className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap border transition-colors ${rankMetric === m.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>{m.label}</button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {[['all', 'All time'], ['year', 'This year'], ['month', 'This month'], ['30d', 'Last 30 days']].map(([k, l]) => (
            <button key={k} onClick={() => setRankPeriod(k)} className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border ${rankPeriod === k ? 'bg-slate-600 border-slate-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>{l}</button>
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

  const renderLedger = () => {
    const owing = masterLedger.filter(p => Math.abs(p.net) > 0.009);
    const planRows = customLedgerActive ? ledgerPlan.rows : masterPayouts;
    return (
    <div className="max-w-4xl mx-auto animation-fade-in space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Active Ledger & Dues</h2>
        <p className="text-sm text-slate-500 mt-1">Combined across all games. Decide who pays whom, then mark payments as they happen.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={openLedgerPlanEditor} className="flex-1 h-11 bg-indigo-600 text-white font-bold rounded-xl flex items-center justify-center text-sm"><Pencil size={16} className="mr-1.5" /> Edit who pays who</button>
        <button onClick={() => doShare('StackSettler dues', buildSettlementText('StackSettler dues', planRows))} disabled={planRows.length === 0} className="h-11 px-4 bg-slate-800 border border-slate-700 text-slate-200 rounded-xl flex items-center text-sm font-semibold disabled:opacity-40"><Share2 size={16} className="mr-1.5" /> Share</button>
      </div>
      {owing.length > 0 && (
        <button onClick={clearRemainingLedgerBalances} className="w-full h-11 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm font-semibold">Clear remaining balances (not a payment)</button>
      )}

      {owing.length > 0 && (
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-700"><h3 className="text-white font-bold">Balances</h3></div>
          <div className="divide-y divide-slate-700/60">
            {owing.map(p => (
              <div key={p.name} className="flex items-center justify-between p-4">
                <span className="font-semibold text-slate-100">{p.name}</span>
                <span className={`font-bold ${p.net > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{p.net > 0 ? 'is owed ' : 'owes '}{formatCurrency(Math.abs(p.net))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-700 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-white font-bold">{customLedgerActive ? 'Your plan' : 'Suggested payments'}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{customLedgerActive ? 'You changed who pays whom.' : (roundTo > 0 ? `Debts are rounded down to the nearest ${roundTo}. Change this in Settings.` : 'Exact amounts, no rounding.')}</p>
          </div>
          {customLedgerActive && <button onClick={() => setLedgerPlan(null)} className="text-indigo-400 text-xs font-semibold shrink-0 mt-0.5">Reset to suggested</button>}
        </div>
        <div className="p-4 overflow-y-auto bg-slate-900/20">
          {planRows.length === 0 ? (
            <div className="text-center py-10"><h3 className="text-lg font-medium text-white mb-2">All settled up!</h3></div>
          ) : (
            <div className="space-y-3">
              {planRows.map((tx, idx) => (
                <div key={tx.id || idx} className="flex flex-col gap-3 justify-between p-4 bg-slate-900/60 rounded-xl border border-slate-700/50">
                  <div className="flex items-center space-x-3">
                    <span className="font-semibold text-rose-400 text-lg">{tx.from}</span>
                    <ArrowRight className="text-slate-400" size={16} />
                    <span className="font-semibold text-emerald-400 text-lg">{tx.to}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-2xl font-black text-white flex-1">{formatCurrency(tx.amount)}</div>
                    <button onClick={openLedgerPlanEditor} className="h-10 w-10 flex items-center justify-center bg-slate-700 text-slate-200 rounded-lg" aria-label="Change who pays who"><Pencil size={16} /></button>
                    <button onClick={() => settleLedgerRow(tx)} className="bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 px-4 h-10 rounded-lg text-sm font-medium flex items-center">Mark Settled</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <button onClick={() => openPaymentSheet()} className="w-full text-slate-400 text-sm py-2 flex items-center justify-center">Log a payment that was already made <ChevronRight size={16} className="ml-1" /></button>
    </div>
    );
  };

  const renderArchive = () => (
    <div className="max-w-4xl mx-auto animation-fade-in space-y-4">
      <div><h2 className="text-2xl font-bold text-white">Settlement Archive</h2><p className="text-sm text-slate-500 mt-1">Tap the arrow to undo a payment.</p></div>
      <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden flex flex-col">
        <div className="p-4 overflow-y-auto bg-slate-900/20">
          {settlements.length === 0 && <p className="text-center text-slate-500 text-sm py-8">No payments recorded yet.</p>}
          {settlements.map((tx) => {
            const sg = tx.gameId ? gamesHistory.find(x => x.id === tx.gameId) : null;
            return (
              <div key={tx.id} className="flex items-center justify-between p-4 bg-slate-900/60 rounded-xl border border-slate-700/50 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center space-x-3">
                    <span className="font-semibold text-rose-400">{tx.from}</span>
                    <ArrowRight className="text-slate-500" size={14} />
                    <span className="font-semibold text-emerald-400">{tx.to}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{tx.type === 'balance-clear' ? 'Balance cleared · not a real payment' : formatDate(tx.date)}{tx.type !== 'balance-clear' && sg ? ` · from game ${formatDate(sg.date).split(',')[0]}` : ''}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="font-bold text-slate-200">{formatCurrency(tx.amount)}</div>
                  <button onClick={() => handleDeleteSettlement(tx.id)} className="text-slate-500 hover:text-rose-400 p-1.5 bg-slate-800 rounded transition-colors"><RotateCcw size={16} /></button>
                </div>
              </div>
            );
          })}
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
    const settleStatus = gameSettleStatus(g);
    const undoIds = Array.from(new Set([...settlements.filter(x => x.gameId === g.id).map(x => x.id), ...payouts.flatMap((tx, i) => rowState(g, i).sources || [])]));
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
          <div className="p-5 border-b border-slate-700 flex items-center justify-between"><h3 className="text-white font-bold">Results</h3><button onClick={() => openResultsEditor(g)} className="h-9 px-3 rounded-lg bg-slate-700 text-slate-200 text-xs font-semibold flex items-center"><Pencil size={14} className="mr-1" /> Edit</button></div>
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
          <div className="p-5 border-b border-slate-700 flex items-center justify-between gap-2">
            <h3 className="text-white font-bold flex items-center"><CheckCircle2 size={18} className="mr-2 text-emerald-400" /> Settlement plan</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => doShare(`StackSettler ${formatDate(g.date)}`, buildSettlementText(`StackSettler · ${formatDate(g.date)}`, payouts, payouts.map((tx, i) => ['paid', 'ledger'].includes(rowState(g, i).state))))} className="h-9 px-3 rounded-lg bg-slate-700 text-slate-200 text-xs font-semibold flex items-center"><Share2 size={14} className="mr-1" /> Share</button>
              <button onClick={() => openPlanEditor(g)} className="h-9 px-3 rounded-lg bg-slate-700 text-slate-200 text-xs font-semibold flex items-center"><Pencil size={14} className="mr-1" /> Edit</button>
              <button onClick={() => openPaymentSheet({ gameId: g.id })} className="h-9 px-3 rounded-lg bg-emerald-900/40 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center"><CheckCircle2 size={14} className="mr-1" /> Log done payment</button>
            </div>
          </div>
          <div className="p-5">
            {ledgerSettled && payouts.length > 0 && (
              <div className="mb-3 rounded-xl bg-emerald-900/20 border border-emerald-500/30 text-emerald-400 text-sm font-semibold px-3 py-2.5 flex items-center"><CheckCircle2 size={16} className="mr-2 shrink-0" /> All settled up. The Ledger shows no dues.</div>
            )}
            <p className="text-xs text-slate-500 mb-3">Payments already covered by the Ledger show as Settled. Tap Edit to change who pays whom.</p>
            {payouts.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-2">Everyone broke even. No payouts needed.</p>
            ) : (
              <>
                <div className="space-y-3">
                  {payouts.map((tx, idx) => {
                    const pid = gamePayoutId(tx, idx);
                    const rs = rowState(g, idx);
                    const done = rs.state === 'paid' || rs.state === 'ledger';
                    return (
                      <div key={pid} className={`p-4 bg-slate-900/50 rounded-lg border ${done ? 'border-emerald-500/30' : rs.state === 'partial' ? 'border-amber-500/30' : 'border-slate-700/50'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 min-w-0">
                            <span className="font-semibold text-rose-400 truncate">{tx.from}</span>
                            <ArrowRight className="text-slate-500 shrink-0" size={16} />
                            <span className="font-semibold text-emerald-400 truncate">{tx.to}</span>
                          </div>
                          <div className={`text-lg font-bold shrink-0 ml-2 ${done ? 'text-slate-500 line-through' : 'text-white'}`}>{formatCurrency(tx.amount)}</div>
                        </div>
                        <div className="mt-3">
                          {rs.state === 'paid' ? (
                            <button onClick={() => toggleGamePayout(g, tx, idx)} className="w-full h-10 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-sm font-semibold flex items-center justify-center"><Check size={16} className="mr-1.5" /> Paid · tap to undo</button>
                          ) : rs.state === 'ledger' ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-10 rounded-xl bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 text-sm font-semibold flex items-center justify-center"><Check size={16} className="mr-1.5" /> Settled in the Ledger</div>
                              {rs.sources && rs.sources.length > 0 && (
                                <button onClick={() => undoCover(rs.sources)} className="h-10 px-4 rounded-xl bg-slate-700 text-slate-200 text-sm font-semibold">Undo</button>
                              )}
                            </div>
                          ) : rs.state === 'partial' ? (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-xs text-amber-400 font-semibold">{formatCurrency(rs.settledAmt)} of {formatCurrency(tx.amount)} already settled</div>
                                {rs.sources && rs.sources.length > 0 && <button onClick={() => undoCover(rs.sources)} className="text-xs text-slate-300 font-semibold underline">Undo</button>}
                              </div>
                              <button onClick={() => markRestPaid(g, tx, idx, tx.amount - rs.settledAmt)} className="w-full h-10 rounded-xl bg-indigo-600 text-white text-sm font-bold">Mark rest paid ({formatCurrency(tx.amount - rs.settledAmt)})</button>
                            </div>
                          ) : (
                            <button onClick={() => toggleGamePayout(g, tx, idx)} className="w-full h-10 rounded-xl bg-indigo-600 text-white text-sm font-bold">Mark paid</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-4 text-sm">
                  <span className={settleStatus.paid === settleStatus.total ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>{settleStatus.paid === settleStatus.total ? 'All settled up' : `${settleStatus.paid} of ${settleStatus.total} settled`}</span>
                  <div className="flex items-center gap-4">
                    {undoIds.length > 0 && <button onClick={() => undoCover(undoIds)} className="text-slate-300 font-semibold">Undo payments</button>}
                    {settleStatus.paid < settleStatus.total && <button onClick={() => settleAllGamePayouts(g)} className="text-indigo-400 font-semibold">Mark all paid</button>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
          <h3 className="text-white font-bold mb-2">Notes</h3>
          <textarea rows={3} placeholder="Location, stakes, who hosted..." className="w-full bg-slate-900 border border-slate-600 rounded-xl py-3 px-3 text-white focus:outline-none focus:border-indigo-500" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onBlur={() => { if ((g.notes || '') !== noteDraft.trim()) updateGame({ ...g, notes: noteDraft.trim() }); }} />
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

        {totalGames === 0 && roster.length === 0 && !isSessionActive && (
          <button onClick={() => setSettingsOpen(true)} className="w-full bg-slate-800 border border-slate-700 rounded-3xl p-4 flex items-center justify-between text-left">
            <div>
              <div className="text-white font-bold">Moving from another version?</div>
              <div className="text-sm text-slate-400">Import your backup in Settings & backup.</div>
            </div>
            <ChevronRight size={20} className="text-slate-500 shrink-0" />
          </button>
        )}

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
            <div className="bg-slate-800 border border-slate-700 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-md tall-sheet sheet">
              <div className="flex justify-between mb-4 shrink-0"><h3 className="text-xl font-bold text-white">Select Players</h3><button onClick={() => setNewGameModal({isOpen: false, selectedPlayerIds: []})} className="text-slate-400"><X size={20} /></button></div>
              <form onSubmit={handleAddPlayerFromModal} className="flex gap-2 mb-4 shrink-0">
                <input type="text" placeholder="Add a new player..." className="flex-1 bg-slate-900 border border-slate-600 rounded-lg py-2.5 px-3 text-white focus:outline-none focus:border-indigo-500" value={newGamePlayerInput} onChange={(e) => setNewGamePlayerInput(e.target.value)} />
                <button type="submit" disabled={!newGamePlayerInput.trim()} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 rounded-lg font-medium flex items-center"><Plus size={18} /></button>
              </form>
              <div className="mb-4 bg-slate-900/50 border border-slate-700 p-2 rounded-lg flex-1 min-h-0 overflow-y-auto">
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
              <button onClick={submitNewGame} disabled={newGameModal.selectedPlayerIds.length === 0} className="w-full min-h-[58px] shrink-0 bg-[#6366f1] hover:bg-[#818cf8] active:scale-[0.99] disabled:opacity-45 disabled:cursor-not-allowed text-white text-base font-extrabold py-4 px-4 rounded-xl shadow-lg shadow-indigo-950/40 ring-1 ring-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300 mb-[max(0.5rem,env(safe-area-inset-bottom))]">Start Game Session{newGameModal.selectedPlayerIds.length > 0 ? ` (${newGameModal.selectedPlayerIds.length} players)` : ''}</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const currentTab = (activeTab === 'session' && !isSessionActive) ? 'home' : activeTab;
  const touchStartRef = React.useRef(null);
  const backHandlerRef = React.useRef(null);
  backHandlerRef.current = () => {
    if (planEdit) { setPlanEdit(null); return true; }
    if (paymentSheet) { setPaymentSheet(null); return true; }
    if (confirmModal) { setConfirmModal(null); return true; }
    if (newGameModal.isOpen) { setNewGameModal({ isOpen: false, selectedPlayerIds: [] }); return true; }
    if (settingsOpen) { setSettingsOpen(false); return true; }
    if (moreOpen) { setMoreOpen(false); return true; }
    if (currentTab === 'details') { setActiveTab(detailsBackTab || 'history'); return true; }
    if (currentTab === 'playerStats') { setActiveTab(statsBackTab || 'players'); return true; }
    if (currentTab === 'ledger' || currentTab === 'archive') { setMoreOpen(true); setActiveTab('home'); return true; }
    if (currentTab !== 'home') { setMoreOpen(false); setActiveTab('home'); return true; }
    return false;
  };
  useEffect(() => {
    window.history.pushState({ stackSettler: true }, '');
    const onPopState = () => {
      const handled = backHandlerRef.current ? backHandlerRef.current() : false;
      if (handled) window.history.pushState({ stackSettler: true }, '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      const handled = backHandlerRef.current ? backHandlerRef.current() : false;
      if (!handled) CapacitorApp.exitApp();
    });
    return () => { listenerPromise.then(listener => listener.remove()).catch(() => {}); };
  }, []);
  useEffect(() => {
    const onTouchStart = (e) => {
      const t = e.touches && e.touches.length === 1 ? e.touches[0] : null;
      touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchEnd = (e) => {
      const start = touchStartRef.current;
      const t = e.changedTouches && e.changedTouches[0];
      touchStartRef.current = null;
      if (!start || !t || start.x > 32 || t.clientX - start.x < 80 || Math.abs(t.clientY - start.y) > 70) return;
      const handled = backHandlerRef.current ? backHandlerRef.current() : false;
      if (handled && e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchend', onTouchEnd, true);
    };
  }, []);

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
            {[{ key: 'ledger', label: 'Ledger', Icon: Scale }, { key: 'archive', label: 'Archive', Icon: Archive }, { key: 'settings', label: 'Settings & backup', Icon: Settings }].map(({ key, label, Icon }) => (
              <button key={key} onClick={() => { setMoreOpen(false); if (key === 'settings') setSettingsOpen(true); else setActiveTab(key); }} className="w-full flex items-center p-4 rounded-xl active:bg-slate-700/60 text-left">
                <Icon size={22} className="text-indigo-400 mr-4" />
                <span className="flex-1 text-white font-medium">{label}</span>
                <ChevronRight size={18} className="text-slate-500" />
              </button>
            ))}
          </div>
        </div>
      )}

      {renderPlanEditor()}
      {renderResultsEditor()}
      {renderPaymentSheet()}
      {renderSettings()}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] bg-white text-[#1a1b24] font-semibold text-sm px-4 py-2.5 rounded-full shadow-xl max-w-[90vw] text-center">{toast}</div>
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
