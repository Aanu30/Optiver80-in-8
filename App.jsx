import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Analytics } from '@vercel/analytics/react';

/* ============================================================================
   80-IN-8  ·  Optiver-format mental-arithmetic simulator
   Format, scoring and tiers per the supplied 2025–26 briefing.
   - 80 multiple-choice questions, 8:00 total, ~6.0s each
   - Sequential: no skipping, no going back (like the real test)
   - Scoring: +1 correct, -1 wrong, 0 for questions not reached
     (dominant reported rule; -2/wrong is disputed in sources)
   - "Where you stand" = community-reported tiers, NOT an official percentile
   ========================================================================== */

const TOTAL = 80;
const DURATION = 480; // seconds

const T = {
  bg: '#0b0f14', panel: '#121821', panel2: '#0e141c', line: '#1f2832',
  ink: '#e8eef4', muted: '#7d8b9c', faint: '#4a5765',
  amber: '#f0a92b',   // live clock / pass tier
  cyan: '#36c0c8',    // action / correct / competitive
  red: '#ef5350',     // wrong / low time / below cutoff
  green: '#4ec98f',   // top tier
};
const MONO = "'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/* ----------------------------- exact-decimal engine ----------------------- */
// A number is {m, s} meaning m * 10^-s. All display is exact (no float cruft).
const num = (m, s) => ({ m, s });
const mul = (a, b) => ({ m: a.m * b.m, s: a.s + b.s });
const val = (n) => n.m / Math.pow(10, n.s);
const shiftDown = (n) => ({ m: n.m, s: n.s + 1 });               // /10
const shiftUp = (n) => (n.s >= 1 ? { m: n.m, s: n.s - 1 } : { m: n.m * 10, s: 0 }); // *10
const perturb = (n, k) => ({ m: n.m + k, s: n.s });
const randint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const choice = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function fmt(m, s) {
  const neg = m < 0; let am = Math.abs(m).toString();
  if (s === 0) return (neg ? '-' : '') + am;
  while (am.length <= s) am = '0' + am;
  const intp = am.slice(0, am.length - s);
  const frac = am.slice(am.length - s).replace(/0+$/, '');
  return (neg ? '-' : '') + (frac.length ? intp + '.' + frac : intp);
}

const DENOM = { 2: [1, 5], 4: [2, 25], 5: [1, 2], 8: [3, 125], 10: [1, 1], 16: [4, 625], 20: [2, 5], 25: [2, 4], 40: [3, 25], 50: [2, 2] };

function gAddSub() {
  if (Math.random() < 0.5) { const a = randint(23, 189), b = randint(18, 179); return { q: `${a} + ${b}`, ans: num(a + b, 0), type: 'addsub' }; }
  const a = randint(60, 199); const b = randint(12, a - 5); return { q: `${a} − ${b}`, ans: num(a - b, 0), type: 'addsub' };
}
function gMul() { let a, b; if (Math.random() < 0.7) { a = randint(12, 79); b = randint(11, 29); } else { a = randint(12, 99); b = randint(11, 19); } return { q: `${a} × ${b}`, ans: num(a * b, 0), type: 'mul' }; }
function gDiv() { const q = randint(3, 40), d = randint(3, 19); return { q: `${q * d} ÷ ${d}`, ans: num(q, 0), type: 'div' }; }
function gDecMul() {
  let sa, sb; do { sa = choice([0, 1, 1, 2, 2, 3]); sb = choice([0, 1, 1, 2, 2, 3]); } while (sa === 0 && sb === 0);
  const ba = randint(2, 99); const bb = randint(2, choice([9, 9, 9, 12, 19]));
  return { q: `${fmt(ba, sa)} × ${fmt(bb, sb)}`, ans: num(ba * bb, sa + sb), type: 'decmul' };
}
function gDecDiv() {
  const ans = choice([num(25, 1), num(15, 1), num(8, 1), num(12, 1), num(35, 1), num(6, 1), num(45, 1), num(2, 0), num(3, 0), num(4, 0), num(5, 0), num(6, 0), num(8, 0), num(60, 0), num(40, 0), num(120, 0), num(16, 1), num(24, 1), num(125, 2), num(75, 2)]);
  const d = choice([num(4, 1), num(25, 2), num(5, 1), num(2, 1), num(8, 1), num(5, 2), num(4, 2), num(9, 2), num(6, 2), num(15, 1), num(150, 0), num(40, 0), num(80, 0), num(120, 0), num(25, 1), num(12, 0)]);
  const dd = mul(ans, d);
  return { q: `${fmt(dd.m, dd.s)} ÷ ${fmt(d.m, d.s)}`, ans, type: 'decdiv' };
}
function gFraction() {
  if (Math.random() < 0.5) { const den = choice([4, 5, 8, 16, 20, 25, 40, 50]); const q = randint(2, 40); return { q: `1/${den} × ${den * q}`, ans: num(q, 0), type: 'frac' }; }
  const den = choice([2, 4, 5, 8, 16, 20, 25, 40, 50]); const [k, f] = DENOM[den]; const n = randint(1, den - 1);
  return { q: `${n}/${den} as a decimal`, ans: num(n * f, k), type: 'frac' };
}
function gAlgebra() {
  const r = Math.random();
  if (r < 0.34) { const a = choice([num(25, 2), num(5, 0), num(15, 1), num(2, 1), num(8, 0), num(5, 1), num(4, 0), num(12, 0), num(25, 1)]); const ans = num(randint(2, 40), 0); const b = mul(a, ans); return { q: `${fmt(a.m, a.s)} × ? = ${fmt(b.m, b.s)}`, ans, type: 'algebra' }; }
  if (r < 0.67) { const q = choice([4, 5, 8, 20, 25]); const p = randint(1, q - 1); const r2 = randint(2, 12); return { q: `${p}/${q} × ? = ${p * r2}`, ans: num(q * r2, 0), type: 'algebra' }; }
  const a = choice([num(4, 0), num(5, 0), num(8, 0), num(25, 1), num(15, 1), num(12, 0)]); const b = num(randint(2, 30), 0); const ans = mul(a, b);
  return { q: `? ÷ ${fmt(a.m, a.s)} = ${fmt(b.m, b.s)}`, ans, type: 'algebra' };
}

function makeOptions(ans) {
  const seen = new Set([fmt(ans.m, ans.s)]); const out = [];
  const cand = [
    shiftDown(ans), shiftUp(ans),
    perturb(ans, ans.s === 0 ? choice([1, 2, -1, -2, 3, -3, 10, -10]) : choice([1, -1, 2, -2])),
    perturb(ans, ans.s === 0 ? choice([5, -5, 11, -11]) : choice([3, -3, 5, -5])),
    shiftDown(shiftDown(ans)), shiftUp(shiftUp(ans)),
  ];
  for (const c of cand) {
    if (out.length >= 3) break;
    const v = val(c); if (!isFinite(v)) continue; if (v <= 0 && val(ans) > 0) continue;
    const av = Math.abs(v); if (av < 1e-8 || av > 1e8) continue;
    const key = fmt(c.m, c.s); if (seen.has(key)) continue;
    seen.add(key); out.push(c);
  }
  let k = 2; while (out.length < 3) { const c = perturb(ans, k); const key = fmt(c.m, c.s); if (!seen.has(key) && val(c) > 0) { seen.add(key); out.push(c); } k++; if (k > 80) break; }
  return shuffle([ans, ...out.slice(0, 3)]).map((n) => ({ str: fmt(n.m, n.s), correct: n === ans }));
}

const GENS = [[gAddSub, 12], [gMul, 12], [gDiv, 8], [gDecMul, 12], [gDecDiv, 16], [gFraction, 12], [gAlgebra, 8]];
function buildTest() {
  const plan = []; for (const [g, n] of GENS) for (let i = 0; i < n; i++) plan.push(g);
  return shuffle(plan).map((g) => { const x = g(); return { ...x, options: makeOptions(x.ans) }; });
}

const LABELS = { addsub: 'Addition / subtraction', mul: 'Multiplication', div: 'Division', decmul: 'Decimal ×', decdiv: 'Decimal ÷', frac: 'Fractions', algebra: 'Solve for ?' };
const ORDER = ['addsub', 'mul', 'div', 'decmul', 'decdiv', 'frac', 'algebra'];

function bandFor(score) {
  if (score >= 77) return { key: 'top', label: 'Top performer', range: '77–80', color: T.green, note: 'Elite range. Shift effort to sequences (NumberLogic), probability (Beat the Odds) and the coding OA.' };
  if (score >= 70) return { key: 'comp', label: 'Competitive', range: '70–76', color: T.cyan, note: 'Strong enough to stand out. Hold this, then broaden to the rest of the battery.' };
  if (score >= 55) return { key: 'pass', label: 'Above pass cutoff', range: '55–69', color: T.amber, note: 'Clears the reported ~55 gate, but not yet competitive. Push decimal/fraction speed.' };
  return { key: 'fail', label: 'Below pass cutoff', range: '< 55', color: T.red, note: 'Under the reported ~55 cutoff. Drill your weakest type below, daily, before applying.' };
}

const accColor = (p) => (p < 55 ? T.red : p < 70 ? T.amber : p < 85 ? T.cyan : T.green);
const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/* ----------------------------- persistence (localStorage) ----------------- */
const KEY = 'optiver_80in8_sessions_v1';
async function loadSessions() {
  try { const raw = localStorage.getItem(KEY); return { ok: true, data: raw ? JSON.parse(raw) : [] }; }
  catch (e) { return { ok: false, data: [] }; }
}
async function saveSessions(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr.slice(-200))); return true; }
  catch (e) { return false; }
}

/* ----------------------------- small UI atoms ----------------------------- */
const Eyebrow = ({ children, color = T.muted }) => (
  <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color }}>{children}</div>
);
const Panel = ({ children, style }) => (
  <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, ...style }}>{children}</div>
);

/* ============================================================================
   App
   ========================================================================== */
export default function App() {
  const [phase, setPhase] = useState('home'); // home | test | results
  const [sessions, setSessions] = useState([]);
  const [storageOK, setStorageOK] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState(DURATION);
  const [result, setResult] = useState(null);

  const answersRef = useRef([]);
  const startRef = useRef(0);
  const endRef = useRef(0);
  const finishedRef = useRef(false);
  const finishRef = useRef(() => {});

  useEffect(() => { (async () => { const { ok, data } = await loadSessions(); setSessions(data); setStorageOK(ok); setLoaded(true); })(); }, []);

  const finishTest = useCallback(() => {
    if (finishedRef.current) return; finishedRef.current = true;
    const ans = answersRef.current;
    let correct = 0, reached = 0;
    const byType = {}; ORDER.forEach((t) => (byType[t] = { att: 0, correct: 0 }));
    for (let i = 0; i < TOTAL; i++) {
      const a = ans[i]; if (!a) continue; reached++; byType[a.type].att++;
      if (a.correct) { correct++; byType[a.type].correct++; }
    }
    const wrong = reached - correct;
    const unreached = TOTAL - reached;
    const score = correct - wrong;
    const timeUsed = Math.min(DURATION, Math.round((Date.now() - startRef.current) / 1000));
    const session = { ts: Date.now(), score, correct, wrong, unreached, reached, timeUsed, byType };
    setSessions((prev) => { const next = [...prev, session]; saveSessions(next); return next; });
    setResult({ ...session, band: bandFor(score), accuracy: reached ? Math.round((correct / reached) * 100) : 0 });
    setPhase('results');
  }, []);
  finishRef.current = finishTest;

  useEffect(() => {
    if (phase !== 'test') return;
    const id = setInterval(() => {
      const left = Math.max(0, (endRef.current - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) { clearInterval(id); finishRef.current(); }
    }, 200);
    return () => clearInterval(id);
  }, [phase]);

  const startTest = () => {
    setQuestions(buildTest());
    answersRef.current = [];
    finishedRef.current = false;
    setIdx(0);
    setRemaining(DURATION);
    startRef.current = Date.now();
    endRef.current = Date.now() + DURATION * 1000;
    setResult(null);
    setPhase('test');
  };

  const answer = (optIdx) => {
    if (finishedRef.current) return;
    const q = questions[idx];
    answersRef.current[idx] = { type: q.type, correct: q.options[optIdx].correct };
    if (idx + 1 >= TOTAL) finishTest(); else setIdx(idx + 1);
  };

  const doReset = () => { setConfirmReset(false); setSessions([]); saveSessions([]); };

  /* derived dashboard stats */
  const stats = useMemo(() => {
    const n = sessions.length;
    if (!n) return null;
    const scores = sessions.map((s) => s.score);
    const last = scores[n - 1];
    const best = Math.max(...scores);
    const last5 = scores.slice(-5);
    const avg5 = last5.reduce((a, b) => a + b, 0) / last5.length;
    const totalQ = sessions.reduce((a, s) => a + s.reached, 0);
    const agg = {}; ORDER.forEach((t) => (agg[t] = { att: 0, correct: 0 }));
    sessions.forEach((s) => ORDER.forEach((t) => { if (s.byType && s.byType[t]) { agg[t].att += s.byType[t].att; agg[t].correct += s.byType[t].correct; } }));
    const trend = sessions.map((s, i) => ({ n: i + 1, score: s.score }));
    const yMin = Math.min(0, ...scores);
    return { n, last, best, avg5, totalQ, agg, trend, yMin };
  }, [sessions]);

  return (
    <div className="o8" style={{ background: T.bg, color: T.ink, fontFamily: SANS, minHeight: '100vh', padding: '24px 16px 56px' }}>
      <style>{`
        .o8 *{box-sizing:border-box}
        .o8 button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
        .o8 .opt{background:${T.panel};border:1px solid ${T.line};border-radius:12px;padding:22px 16px;font-family:${MONO};color:${T.ink};transition:border-color .12s,background .12s,transform .04s;text-align:center}
        .o8 .opt:hover:not(:disabled){border-color:${T.cyan};background:#16202b}
        .o8 .opt:active{transform:translateY(1px)}
        .o8 .opt:focus-visible{outline:2px solid ${T.cyan};outline-offset:2px}
        .o8 .btn{border-radius:10px;font-weight:600;transition:filter .12s,transform .04s}
        .o8 .btn:hover{filter:brightness(1.08)}
        .o8 .btn:active{transform:translateY(1px)}
        .o8 .btn:focus-visible{outline:2px solid ${T.cyan};outline-offset:2px}
        .o8 .hero{display:grid;grid-template-columns:1fr;gap:18px}
        .o8 .opts{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
        .o8 .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
        @media(min-width:700px){.o8 .hero{grid-template-columns:1.25fr 1fr;align-items:stretch}}
        @media(max-width:560px){.o8 .opts{grid-template-columns:1fr}.o8 .tiles{grid-template-columns:repeat(2,1fr)}}
        .o8 .pulse{animation:o8pulse 1s ease-in-out infinite}
        @keyframes o8pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @media(prefers-reduced-motion:reduce){.o8 *{animation:none!important;transition:none!important}}
      `}</style>

      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        {phase === 'home' && (
          <Home
            stats={stats} loaded={loaded} storageOK={storageOK}
            onStart={startTest} showInfo={showInfo} setShowInfo={setShowInfo}
            confirmReset={confirmReset} setConfirmReset={setConfirmReset} doReset={doReset}
          />
        )}
        {phase === 'test' && (
          <TestView q={questions[idx]} idx={idx} remaining={remaining} onAnswer={answer} />
        )}
        {phase === 'results' && result && (
          <Results r={result} onRetake={startTest} onHome={() => setPhase('home')} />
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Home --------------------------------------- */
function Home({ stats, loaded, storageOK, onStart, showInfo, setShowInfo, confirmReset, setConfirmReset, doReset }) {
  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <Eyebrow color={T.amber}>Optiver-format · mental-arithmetic screen</Eyebrow>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
          <h1 style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(2.4rem,8vw,3.6rem)', letterSpacing: '-0.02em', margin: 0, lineHeight: 1 }}>80-IN-8</h1>
          <span style={{ color: T.muted, fontSize: 14 }}>the arithmetic gate, simulated exactly</span>
        </div>
      </header>

      {/* hero / signature */}
      <div className="hero" style={{ marginBottom: 22 }}>
        <Panel style={{ padding: '22px 22px 24px' }}>
          <p style={{ color: T.ink, fontSize: 15, lineHeight: 1.55, margin: '0 0 8px' }}>
            80 questions. 8 minutes. No calculator. Multiple choice with negative marking. Sequential — you can&apos;t skip or go back.
          </p>
          <p style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.55, margin: '0 0 20px' }}>
            Decimal- and fraction-heavy, like the real screen. The distractors are built around decimal-place slips — the error that actually fails people.
          </p>
          <button className="btn" onClick={onStart}
            style={{ background: T.cyan, color: '#04231f', fontFamily: MONO, fontSize: 16, fontWeight: 700, padding: '14px 26px', letterSpacing: '0.02em' }}>
            Start the test →
          </button>
          <button className="btn" onClick={() => setShowInfo((v) => !v)}
            style={{ marginLeft: 10, color: T.muted, fontSize: 13, padding: '14px 8px', fontFamily: MONO }}>
            {showInfo ? 'hide scoring' : 'how scoring works'}
          </button>
        </Panel>

        {/* terminal-style clock lockup = the signature */}
        <Panel style={{ background: T.panel2, padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Eyebrow>the clock</Eyebrow>
          <div style={{ fontFamily: MONO, fontSize: 'clamp(3rem,12vw,4.6rem)', fontWeight: 700, color: T.amber, lineHeight: 1, letterSpacing: '0.02em', margin: '8px 0 2px' }}>8:00</div>
          <div style={{ display: 'flex', gap: 18, marginTop: 10, fontFamily: MONO, fontSize: 13, color: T.muted }}>
            <span><span style={{ color: T.ink }}>80</span> questions</span>
            <span><span style={{ color: T.ink }}>~6.0s</span> each</span>
          </div>
        </Panel>
      </div>

      {showInfo && <InfoPanel />}

      {/* dashboard */}
      {loaded && stats && (
        <>
          <div className="tiles" style={{ marginBottom: 16 }}>
            <Tile label="Sessions" value={stats.n} />
            <Tile label="Best score" value={stats.best} color={bandFor(stats.best).color} />
            <Tile label="Last score" value={stats.last} color={bandFor(stats.last).color} />
            <Tile label="Avg (last 5)" value={stats.avg5.toFixed(1)} />
          </div>

          <Panel style={{ padding: '18px 18px 10px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <Eyebrow>Score trend</Eyebrow>
              <span style={{ fontFamily: MONO, fontSize: 11, color: T.faint }}>
                <span style={{ color: T.amber }}>--</span> 55 cutoff &nbsp; <span style={{ color: T.green }}>--</span> 70 competitive
              </span>
            </div>
            <div style={{ width: '100%', height: 230 }}>
              <ResponsiveContainer>
                <LineChart data={stats.trend} margin={{ top: 8, right: 14, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={T.line} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="n" stroke={T.muted} tick={{ fontSize: 11, fill: T.muted }} tickLine={false} axisLine={{ stroke: T.line }} />
                  <YAxis domain={[stats.yMin, 80]} stroke={T.muted} tick={{ fontSize: 11, fill: T.muted }} tickLine={false} axisLine={{ stroke: T.line }} width={34} />
                  <Tooltip
                    contentStyle={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, fontFamily: MONO, fontSize: 12 }}
                    labelStyle={{ color: T.muted }} itemStyle={{ color: T.cyan }}
                    labelFormatter={(l) => `Test #${l}`} formatter={(v) => [v, 'score']} />
                  <ReferenceLine y={55} stroke={T.amber} strokeDasharray="4 4" strokeOpacity={0.55} />
                  <ReferenceLine y={70} stroke={T.green} strokeDasharray="4 4" strokeOpacity={0.55} />
                  <Line type="monotone" dataKey="score" stroke={T.cyan} strokeWidth={2} dot={{ r: 3, fill: T.cyan, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel style={{ padding: 18, marginBottom: 16 }}>
            <Eyebrow>Lifetime accuracy by type · your drill order</Eyebrow>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ORDER.map((t) => {
                const a = stats.agg[t]; const pct = a.att ? Math.round((a.correct / a.att) * 100) : null;
                return (
                  <div key={t} style={{ display: 'grid', gridTemplateColumns: '128px 1fr 76px', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12.5, color: T.muted }}>{LABELS[t]}</span>
                    <div style={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 6, height: 12, overflow: 'hidden' }}>
                      {pct !== null && <div style={{ width: `${pct}%`, height: '100%', background: accColor(pct), transition: 'width .3s' }} />}
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: pct === null ? T.faint : accColor(pct), textAlign: 'right' }}>
                      {pct === null ? '—' : `${pct}% · ${a.correct}/${a.att}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <div style={{ textAlign: 'right' }}>
            {!confirmReset ? (
              <button className="btn" onClick={() => setConfirmReset(true)} style={{ color: T.faint, fontSize: 12, fontFamily: MONO, padding: '6px 8px' }}>reset history</button>
            ) : (
              <span style={{ fontSize: 12, fontFamily: MONO, color: T.muted }}>
                delete all sessions?{' '}
                <button className="btn" onClick={doReset} style={{ color: T.red, fontFamily: MONO, fontSize: 12, padding: '6px 8px' }}>yes, delete</button>
                <button className="btn" onClick={() => setConfirmReset(false)} style={{ color: T.muted, fontFamily: MONO, fontSize: 12, padding: '6px 8px' }}>cancel</button>
              </span>
            )}
          </div>
        </>
      )}

      {loaded && !stats && (
        <Panel style={{ padding: 22, textAlign: 'center', color: T.muted, fontSize: 14 }}>
          No sessions yet. Run your first test — your scores and per-type weak spots will track here.
        </Panel>
      )}
      {loaded && !storageOK && (
        <p style={{ color: T.faint, fontFamily: MONO, fontSize: 11.5, marginTop: 14, textAlign: 'center' }}>
          History isn&apos;t being saved in this view (storage unavailable) — scores will reset when you reload.
        </p>
      )}
    </>
  );
}

function Tile({ label, value, color = T.ink }) {
  return (
    <Panel style={{ padding: '14px 16px' }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, color, marginTop: 6, lineHeight: 1 }}>{value}</div>
    </Panel>
  );
}

function InfoPanel() {
  const Row = ({ k, v }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, padding: '7px 0', borderTop: `1px solid ${T.line}` }}>
      <span style={{ fontFamily: MONO, fontSize: 12, color: T.amber, letterSpacing: '0.04em' }}>{k}</span>
      <span style={{ fontSize: 13, color: T.ink, lineHeight: 1.5 }}>{v}</span>
    </div>
  );
  return (
    <Panel style={{ padding: '16px 18px', marginBottom: 22 }}>
      <Eyebrow>How this is scored</Eyebrow>
      <div style={{ marginTop: 8 }}>
        <Row k="Format" v="80 multiple-choice questions, 8:00 total. Sequential — answering advances you; you can't skip or return." />
        <Row k="Scoring" v={<>+1 correct, &minus;1 wrong, 0 for questions you don&apos;t reach. This is the dominant reported rule; some sources report &minus;2 per wrong — that&apos;s disputed, so don&apos;t guess blindly.</>} />
        <Row k="Tiers" v={<><b style={{ color: T.red }}>&lt;55</b> below cutoff · <b style={{ color: T.amber }}>55&ndash;69</b> pass · <b style={{ color: T.cyan }}>70&ndash;76</b> competitive · <b style={{ color: T.green }}>77&ndash;80</b> top.</>} />
        <Row k="Reality check" v="These tiers are community-reported, not official, and are NOT a percentile. Optiver has never published score distributions, so any 'top X%' claim would be invented." />
      </div>
    </Panel>
  );
}

/* ----------------------------- Test --------------------------------------- */
function TestView({ q, idx, remaining, onAnswer }) {
  const secs = Math.ceil(remaining);
  const low = secs <= 30; const critical = secs <= 15;
  const clockColor = low ? T.red : T.amber;
  const pct = Math.max(0, (remaining / DURATION) * 100);

  // keyboard 1-4 to answer
  useEffect(() => {
    const h = (e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= 4) onAnswer(n - 1); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onAnswer, idx]);

  if (!q) return null;
  return (
    <div style={{ minHeight: 460 }}>
      {/* status bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className={critical ? 'pulse' : ''} style={{ fontFamily: MONO, fontSize: 'clamp(2rem,8vw,2.8rem)', fontWeight: 700, color: clockColor, lineHeight: 1, letterSpacing: '0.02em' }}>
          {fmtClock(secs)}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700 }}>
            <span style={{ color: T.ink }}>{idx + 1}</span><span style={{ color: T.faint }}> / {TOTAL}</span>
          </div>
          <Eyebrow color={T.faint}>question</Eyebrow>
        </div>
      </div>

      {/* depletion bar */}
      <div style={{ height: 4, background: T.line, borderRadius: 4, overflow: 'hidden', marginBottom: 'clamp(28px,7vh,64px)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: clockColor, transition: 'width .2s linear' }} />
      </div>

      {/* question */}
      <div style={{ textAlign: 'center', marginBottom: 'clamp(28px,7vh,56px)' }}>
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(2.6rem,11vw,5rem)', letterSpacing: '-0.01em', lineHeight: 1.05, color: T.ink }}>
          {q.q}
        </div>
      </div>

      {/* options */}
      <div className="opts" style={{ maxWidth: 560, margin: '0 auto' }}>
        {q.options.map((o, i) => (
          <button key={i} className="opt" onClick={() => onAnswer(i)}>
            <span style={{ color: T.faint, fontSize: 12, marginRight: 8 }}>{i + 1}</span>
            <span style={{ fontSize: 'clamp(1.3rem,4.5vw,1.7rem)', fontWeight: 600 }}>{o.str}</span>
          </button>
        ))}
      </div>

      <p style={{ textAlign: 'center', color: T.faint, fontFamily: MONO, fontSize: 11.5, marginTop: 26 }}>
        keys 1&ndash;4 to answer · can&apos;t skip or go back · unreached = no penalty
      </p>
    </div>
  );
}

/* ----------------------------- Results ------------------------------------ */
function Results({ r, onRetake, onHome }) {
  const b = r.band;
  const drill = ORDER
    .map((t) => ({ t, ...(r.byType[t]) }))
    .filter((x) => x.att >= 2)
    .map((x) => ({ ...x, pct: x.correct / x.att }))
    .sort((a, c) => a.pct - c.pct)
    .slice(0, 2);

  return (
    <div>
      <header style={{ marginBottom: 18 }}>
        <Eyebrow color={T.amber}>Result</Eyebrow>
        <h1 style={{ fontFamily: MONO, fontSize: 'clamp(1.8rem,6vw,2.4rem)', margin: '4px 0 0', fontWeight: 700 }}>80-in-8 complete</h1>
      </header>

      {/* score + band */}
      <Panel style={{ padding: '24px 22px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <Eyebrow>Net score</Eyebrow>
            <div style={{ fontFamily: MONO, fontSize: 'clamp(3.4rem,16vw,5.2rem)', fontWeight: 700, color: b.color, lineHeight: 1 }}>{r.score}</div>
            <div style={{ fontFamily: MONO, fontSize: 12, color: T.faint, marginTop: 2 }}>{r.correct} right &minus; {r.wrong} wrong &middot; max 80</div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <span style={{ display: 'inline-block', background: b.color, color: '#06121a', fontFamily: MONO, fontWeight: 700, fontSize: 13, padding: '5px 12px', borderRadius: 999, letterSpacing: '0.03em' }}>
              {b.label} · {b.range}
            </span>
            <p style={{ color: T.ink, fontSize: 14, lineHeight: 1.55, margin: '12px 0 0' }}>{b.note}</p>
          </div>
        </div>
        <p style={{ color: T.faint, fontFamily: MONO, fontSize: 11, lineHeight: 1.5, marginTop: 16, borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
          Tiers are community-reported, not official, and not a percentile — Optiver has never published score distributions.
        </p>
      </Panel>

      {/* stat tiles */}
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Correct" value={r.correct} color={T.cyan} />
        <Tile label="Wrong" value={r.wrong} color={T.red} />
        <Tile label="Not reached" value={r.unreached} color={T.muted} />
        <Tile label="Accuracy" value={`${r.accuracy}%`} color={accColor(r.accuracy)} />
      </div>
      <p style={{ color: T.muted, fontFamily: MONO, fontSize: 12, margin: '-4px 0 18px' }}>
        Reached {r.reached}/{TOTAL} · finished in {fmtClock(r.timeUsed)} · accuracy is correct &divide; reached.
      </p>

      {/* per-type breakdown */}
      <Panel style={{ padding: 18, marginBottom: 16 }}>
        <Eyebrow>This session, by type</Eyebrow>
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ORDER.map((t) => {
            const a = r.byType[t]; const pct = a.att ? Math.round((a.correct / a.att) * 100) : null;
            return (
              <div key={t} style={{ display: 'grid', gridTemplateColumns: '128px 1fr 84px', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12.5, color: T.muted }}>{LABELS[t]}</span>
                <div style={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 6, height: 12, overflow: 'hidden' }}>
                  {pct !== null && <div style={{ width: `${pct}%`, height: '100%', background: accColor(pct) }} />}
                </div>
                <span style={{ fontFamily: MONO, fontSize: 12, color: pct === null ? T.faint : accColor(pct), textAlign: 'right' }}>
                  {pct === null ? 'not reached' : `${pct}% · ${a.correct}/${a.att}`}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      {drill.length > 0 && (
        <Panel style={{ padding: '14px 18px', marginBottom: 18, borderColor: T.amber }}>
          <Eyebrow color={T.amber}>Drill next</Eyebrow>
          <p style={{ color: T.ink, fontSize: 14, margin: '8px 0 0', lineHeight: 1.5 }}>
            Weakest this session: <b>{drill.map((d) => LABELS[d.t]).join('</b> and <b>')}</b>. Decimal division and two-digit multiplication are the usual culprits — target those before your next full run.
          </p>
        </Panel>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onRetake} style={{ background: T.cyan, color: '#04231f', fontFamily: MONO, fontWeight: 700, fontSize: 15, padding: '13px 24px' }}>Retake →</button>
        <button className="btn" onClick={onHome} style={{ background: T.panel, border: `1px solid ${T.line}`, color: T.ink, fontFamily: MONO, fontSize: 15, padding: '13px 24px' }}>Dashboard</button>
      </div>
      <Analytics />
    </div>
  );
}
