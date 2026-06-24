import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { supabase } from './supabaseClient';

/* ============================================================================
   80-IN-8  ·  Optiver-format mental-arithmetic simulator
   Format, scoring and tiers per the supplied 2025–26 briefing.
   ========================================================================== */

const TOTAL = 80;
const DURATION = 480; // seconds

const T = {
  bg: '#08090d', bg2: '#0b0d12', surface: '#101218', surface2: '#0c0e14',
  border: '#1b1e27', borderSoft: '#16181f',
  ink: '#f0f2f6', sub: '#9aa3b2', faint: '#586070',
  amber: '#f4b942', green: '#46d399', cyan: '#4fd0d6', red: '#f06560',
};
const DISPLAY = "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

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
const speedColor = (s) => (s < 6 ? T.green : s < 8 ? T.cyan : s < 12 ? T.amber : T.red);
const reachedColor = (r) => (r >= 65 ? T.cyan : r >= 50 ? T.amber : T.red);
const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const fmtDate = (ts) => {
  const d = new Date(ts);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${m[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ----------------------------- persistence -------------------------------- */
// Local (guest) storage key. When signed in, sessions live in Supabase instead.
const KEY = 'optiver_80in8_sessions_v1';

/* ----------------------------- atoms -------------------------------------- */
const Eyebrow = ({ children, color = T.faint }) => (
  <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color }}>{children}</div>
);
const Panel = ({ children, style }) => (
  <div className="card" style={style}>{children}</div>
);
const Wordmark = ({ size = 18 }) => (
  <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: size, letterSpacing: '-0.01em', color: T.ink }}>
    80<span style={{ color: T.amber }}>·</span>IN<span style={{ color: T.amber }}>·</span>8
  </span>
);

/* ============================================================================
   App
   ========================================================================== */
export default function App() {
  const [phase, setPhase] = useState('home');
  const [sessions, setSessions] = useState([]);
  const [storageOK, setStorageOK] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);

  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState(DURATION);
  const [result, setResult] = useState(null);

  const answersRef = useRef([]);
  const startRef = useRef(0);
  const endRef = useRef(0);
  const qStartRef = useRef(0);
  const finishedRef = useRef(false);
  const finishRef = useRef(() => {});
  const userRef = useRef(null);
  const handledUserRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);

  // Pull a user's sessions from Supabase, merging in any local guest runs once.
  const handleAuthUser = useCallback(async (u) => {
    if (handledUserRef.current === u.id) { setUser(u); return; }
    handledUserRef.current = u.id;
    setUser(u);
    try {
      const { data, error } = await supabase.from('sessions').select('ts,data').eq('user_id', u.id).order('ts');
      const cloud = (!error && data) ? data.map((r) => r.data) : [];
      let local = [];
      try { const raw = localStorage.getItem(KEY); local = raw ? JSON.parse(raw) : []; } catch (e) { /* ignore */ }
      const cloudTs = new Set(cloud.map((s) => s.ts));
      const toUpload = local.filter((s) => !cloudTs.has(s.ts));
      if (toUpload.length) {
        await supabase.from('sessions').insert(toUpload.map((s) => ({ user_id: u.id, ts: s.ts, data: s })));
      }
      setSessions([...cloud, ...toUpload].sort((a, b) => a.ts - b.ts));
      setStorageOK(true);
    } catch (e) { setStorageOK(false); }
    setLoaded(true);
  }, []);

  // load fonts + saved sessions (auth-aware)
  useEffect(() => {
    const id = 'gf-80in8';
    if (!document.getElementById(id)) {
      const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@500;600;700&display=swap';
      document.head.appendChild(l);
    }

    const loadLocalInit = () => {
      try { const raw = localStorage.getItem(KEY); setSessions(raw ? JSON.parse(raw) : []); setStorageOK(true); }
      catch (e) { setSessions([]); setStorageOK(false); }
      setLoaded(true);
    };

    if (!supabase) { loadLocalInit(); return undefined; }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session && data.session.user) handleAuthUser(data.session.user);
      else loadLocalInit();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session && session.user) handleAuthUser(session.user);
      else { handledUserRef.current = null; setUser(null); loadLocalInit(); }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, [handleAuthUser]);

  const finishTest = useCallback(() => {
    if (finishedRef.current) return; finishedRef.current = true;
    const ans = answersRef.current;
    let correct = 0, reached = 0, totalAnswerMs = 0;
    const byType = {}; ORDER.forEach((t) => (byType[t] = { att: 0, correct: 0, ms: 0 }));
    for (let i = 0; i < TOTAL; i++) {
      const a = ans[i]; if (!a) continue; reached++; byType[a.type].att++;
      if (a.correct) { correct++; byType[a.type].correct++; }
      const ms = a.ms || 0; byType[a.type].ms += ms; totalAnswerMs += ms;
    }
    const wrong = reached - correct;
    const unreached = TOTAL - reached;
    const score = correct - wrong;
    const timeUsed = Math.min(DURATION, Math.round((Date.now() - startRef.current) / 1000));
    const session = { ts: Date.now(), score, correct, wrong, unreached, reached, timeUsed, byType, totalAnswerMs };
    setSessions((prev) => {
      const next = [...prev, session];
      const u = userRef.current;
      if (supabase && u) {
        supabase.from('sessions').insert({ user_id: u.id, ts: session.ts, data: session }).then(() => {}, () => {});
      } else {
        try { localStorage.setItem(KEY, JSON.stringify(next.slice(-200))); } catch (e) { /* ignore */ }
      }
      return next;
    });
    setResult({
      ...session, band: bandFor(score),
      accuracy: reached ? Math.round((correct / reached) * 100) : 0,
      avgSpeed: reached ? totalAnswerMs / reached / 1000 : null,
    });
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
    answersRef.current = []; finishedRef.current = false;
    setIdx(0); setRemaining(DURATION);
    startRef.current = Date.now(); endRef.current = Date.now() + DURATION * 1000; qStartRef.current = Date.now();
    setResult(null); window.scrollTo(0, 0); setPhase('test');
  };

  const answer = (optIdx) => {
    if (finishedRef.current) return;
    const now = Date.now();
    const q = questions[idx];
    answersRef.current[idx] = { type: q.type, correct: q.options[optIdx].correct, ms: now - qStartRef.current };
    qStartRef.current = now;
    if (idx + 1 >= TOTAL) finishTest(); else setIdx(idx + 1);
  };

  const doReset = () => {
    setConfirmReset(false); setSessions([]);
    const u = userRef.current;
    if (supabase && u) { supabase.from('sessions').delete().eq('user_id', u.id).then(() => {}, () => {}); }
    else { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  };
  const goHome = () => { window.scrollTo(0, 0); setPhase('home'); };
  const signInGoogle = () => { if (supabase) supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }); };
  const signInEmail = (email) => (supabase ? supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } }) : Promise.resolve({ error: true }));
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); window.scrollTo(0, 0); setPhase('home'); };

  const stats = useMemo(() => {
    const n = sessions.length;
    if (!n) return null;
    const scores = sessions.map((s) => s.score);
    const last = scores[n - 1];
    const best = Math.max(...scores);
    const last5 = scores.slice(-5);
    const avg5 = last5.reduce((a, b) => a + b, 0) / last5.length;
    const totalQ = sessions.reduce((a, s) => a + s.reached, 0);

    const accs = []; const reaches = [];
    sessions.forEach((s) => { if (s.reached > 0) accs.push(s.correct / s.reached); reaches.push(s.reached); });
    const avgAcc = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
    const avgReached = reaches.reduce((a, b) => a + b, 0) / reaches.length;

    const agg = {}; ORDER.forEach((t) => (agg[t] = { att: 0, correct: 0, ms: 0, msN: 0 }));
    let totMs = 0; let totMsN = 0;
    sessions.forEach((s) => ORDER.forEach((t) => {
      const b = s.byType && s.byType[t]; if (!b) return;
      agg[t].att += b.att; agg[t].correct += b.correct;
      if (typeof b.ms === 'number' && b.att > 0) { agg[t].ms += b.ms; agg[t].msN += b.att; totMs += b.ms; totMsN += b.att; }
    }));
    const avgSpeed = totMsN ? totMs / totMsN / 1000 : null;

    const trend = scores.map((sc, i) => {
      const w = scores.slice(Math.max(0, i - 2), i + 1);
      const ma = w.reduce((a, b) => a + b, 0) / w.length;
      return { n: i + 1, score: sc, ma: Math.round(ma * 10) / 10 };
    });
    const yMin = Math.min(0, ...scores);
    return { n, last, best, avg5, totalQ, avgAcc, avgReached, agg, avgSpeed, trend, yMin };
  }, [sessions]);

  return (
    <div className="o8" style={{ background: T.bg, color: T.ink, fontFamily: SANS, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <style>{styles}</style>

      {(phase === 'home' || phase === 'results') && (
        <nav className="nav">
          <button onClick={goHome} style={{ display: 'flex', alignItems: 'center' }}><Wordmark /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {phase === 'home' && <button className="ghost" onClick={() => setShowInfo((v) => !v)} style={{ fontSize: 14 }}>How it works</button>}
            {supabase && (user
              ? <UserChip user={user} onSignOut={signOut} />
              : <button className="ghost" onClick={() => setShowAuth(true)} style={{ fontSize: 14 }}>Sign in</button>)}
            <button className="pill btn" onClick={startTest} style={{ fontSize: 14 }}>Start test</button>
          </div>
        </nav>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onGoogle={signInGoogle} onEmail={signInEmail} />}

      <div style={{ flex: 1, padding: '0 18px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          {phase === 'home' && (
            <Home
              stats={stats} sessions={sessions} loaded={loaded} storageOK={storageOK}
              onStart={startTest} showInfo={showInfo} setShowInfo={setShowInfo}
              confirmReset={confirmReset} setConfirmReset={setConfirmReset} doReset={doReset}
            />
          )}
          {phase === 'test' && <div style={{ padding: '26px 0 56px' }}><TestView q={questions[idx]} idx={idx} remaining={remaining} onAnswer={answer} /></div>}
          {phase === 'results' && <div style={{ padding: '30px 0 56px' }}><Results r={result} onRetake={startTest} onHome={goHome} /></div>}
        </div>
      </div>

      {phase === 'home' && <Footer />}
    </div>
  );
}

/* ----------------------------- chrome ------------------------------------- */
function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${T.border}`, marginTop: 32 }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 18px 44px', display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: '46ch' }}>
          <Wordmark size={16} />
          <p style={{ color: T.sub, fontSize: 13, lineHeight: 1.6, margin: '10px 0 0' }}>
            A faithful rehearsal of the Optiver-format mental-arithmetic screen. Your scores and analysis stay in your browser.
          </p>
        </div>
        <p style={{ color: T.faint, fontSize: 12, lineHeight: 1.6, margin: 0, maxWidth: '38ch' }}>
          Not affiliated with Optiver. Score tiers are community-reported, not official, and not a percentile.
        </p>
      </div>
    </footer>
  );
}

const GoogleMark = () => (
  <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.9 6.1C12.2 13.1 17.6 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7C43.9 38 46.5 31.8 46.5 24.5z" />
    <path fill="#FBBC05" d="M10.4 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.9-6.1C.9 16 0 19.9 0 24s.9 8 2.5 11.4l7.9-7.1z" />
    <path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.3-5.7c-2 1.4-4.7 2.3-8.2 2.3-6.4 0-11.8-3.6-13.6-8.8l-7.9 7.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

function UserChip({ user, onSignOut }) {
  const meta = user.user_metadata || {};
  const name = meta.full_name || meta.name || user.email || 'Account';
  const avatar = meta.avatar_url || meta.picture;
  const initial = (name || 'U').trim().charAt(0).toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {avatar
        ? <img src={avatar} alt="" width={26} height={26} referrerPolicy="no-referrer" style={{ borderRadius: 999, border: `1px solid ${T.border}` }} />
        : <div style={{ width: 26, height: 26, borderRadius: 999, background: T.surface, border: `1px solid ${T.border}`, display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: 12, color: T.sub }}>{initial}</div>}
      <span style={{ fontSize: 13, color: T.sub, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <button className="ghost" onClick={onSignOut} style={{ fontSize: 12.5 }}>Sign out</button>
    </div>
  );
}

function AuthModal({ onClose, onGoogle, onEmail }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submitEmail = async () => {
    if (!email || busy) return;
    setBusy(true); setErr('');
    try { const r = await onEmail(email); if (r && r.error) throw r.error; setSent(true); }
    catch (e) { setErr('Could not send the link. Check the address and try again.'); }
    setBusy(false);
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,5,8,.66)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} className="card fadein" style={{ width: '100%', maxWidth: 380, padding: '26px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Wordmark size={16} />
          <button className="ghost" onClick={onClose} aria-label="Close" style={{ fontSize: 18, lineHeight: 1, padding: '4px 9px' }}>×</button>
        </div>
        <h3 style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 22, margin: '16px 0 4px', letterSpacing: '-0.01em' }}>Save your progress</h3>
        <p style={{ color: T.sub, fontSize: 13.5, lineHeight: 1.55, margin: '0 0 20px' }}>Sign in so your scores and analysis follow you across devices. Your existing local runs come with you.</p>

        <button className="btn" onClick={onGoogle} style={{ width: '100%', background: T.ink, color: '#0a0b0f', fontWeight: 600, fontFamily: SANS, fontSize: 15, padding: '12px', borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <GoogleMark /> Continue with Google
        </button>

        {!sent ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
              <div style={{ flex: 1, height: 1, background: T.border }} /><span style={{ fontSize: 11, color: T.faint }}>or</span><div style={{ flex: 1, height: 1, background: T.border }} />
            </div>
            <input
              value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitEmail()}
              placeholder="you@email.com" type="email" autoComplete="email"
              style={{ width: '100%', background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 11, padding: '12px 14px', color: T.ink, fontFamily: SANS, fontSize: 14.5 }}
            />
            <button className="btn" onClick={submitEmail} disabled={busy} style={{ width: '100%', marginTop: 10, background: T.surface, border: `1px solid ${T.border}`, color: T.ink, fontWeight: 600, fontFamily: SANS, fontSize: 14.5, padding: '12px', borderRadius: 11, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            {err && <p style={{ color: T.red, fontSize: 12.5, margin: '10px 0 0' }}>{err}</p>}
          </>
        ) : (
          <p style={{ color: T.green, fontSize: 13.5, lineHeight: 1.55, margin: '18px 0 0' }}>
            Check your inbox — a sign-in link is on its way to <b style={{ color: T.ink }}>{email}</b>. Open it on this device.
          </p>
        )}

        <p style={{ color: T.faint, fontSize: 11, lineHeight: 1.5, margin: '20px 0 0' }}>You can keep using it without an account — local runs just won&apos;t sync.</p>
      </div>
    </div>
  );
}

/* ----------------------------- Home --------------------------------------- */
function Home({ stats, sessions, loaded, storageOK, onStart, showInfo, setShowInfo, confirmReset, setConfirmReset, doReset }) {
  return (
    <div>
      {/* hero */}
      <section style={{ padding: 'clamp(40px,8vh,84px) 0 clamp(28px,5vh,52px)' }}>
        <div className="hero-grid">
          <div className="fadein">
            <Eyebrow color={T.amber}>Optiver-format · mental-arithmetic screen</Eyebrow>
            <h1 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 'clamp(2.6rem,6vw,4.2rem)', lineHeight: 1.02, letterSpacing: '-0.03em', margin: '16px 0 0', color: T.ink }}>
              Beat the<br />eight-minute clock.
            </h1>
            <p style={{ color: T.sub, fontSize: 'clamp(15px,1.5vw,17px)', lineHeight: 1.6, maxWidth: '46ch', margin: '20px 0 0' }}>
              80 mental-arithmetic questions, negatively marked, at roughly six seconds each — the screen prop firms use to filter quant applicants. Rehearse it until the timer stops mattering.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 30 }}>
              <button className="pill btn" onClick={onStart} style={{ fontSize: 16, padding: '14px 26px' }}>Start the test →</button>
              <button className="ghost" onClick={() => setShowInfo((v) => !v)} style={{ fontSize: 15, padding: '14px 16px' }}>How scoring works</button>
            </div>
          </div>

          <div className="fadein" style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: '-24% -8%', background: 'radial-gradient(closest-side, rgba(244,185,66,.16), transparent)', pointerEvents: 'none' }} />
            <Panel style={{ position: 'relative', padding: '30px 38px', textAlign: 'center', minWidth: 248 }}>
              <Eyebrow color={T.faint}>the eight-minute clock</Eyebrow>
              <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(3.4rem,11vw,5rem)', color: T.amber, lineHeight: 1, letterSpacing: '0.01em', margin: '14px 0 12px' }}>8:00</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontFamily: MONO, fontSize: 12.5, color: T.sub }}>
                <span><b style={{ color: T.ink }}>80</b> questions</span>
                <span><b style={{ color: T.ink }}>~6.0s</b> each</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: T.faint }}>no calculator · negative marking</div>
            </Panel>
          </div>
        </div>
      </section>

      {showInfo && <div style={{ marginBottom: 8 }}><InfoPanel /></div>}

      {loaded && stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: `1px solid ${T.border}`, paddingTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 'clamp(1.4rem,3vw,1.8rem)', letterSpacing: '-0.01em', margin: 0 }}>Your progress</h2>
            <span style={{ fontFamily: MONO, fontSize: 12.5, color: T.faint }}>{stats.n} session{stats.n > 1 ? 's' : ''} logged</span>
          </div>

          <ReadinessMeter avg={stats.avg5} />

          <div className="tiles">
            <Tile label="Sessions" value={stats.n} />
            <Tile label="Best score" value={stats.best} color={bandFor(stats.best).color} />
            <Tile label="Avg score" value={stats.avg5.toFixed(1)} sub="last 5" color={bandFor(stats.avg5).color} />
            <Tile label="Avg accuracy" value={`${Math.round(stats.avgAcc * 100)}%`} sub="correct / reached" color={accColor(stats.avgAcc * 100)} />
            <Tile label="Avg reached" value={Math.round(stats.avgReached)} sub="of 80" color={reachedColor(stats.avgReached)} />
            <Tile label="Total Qs" value={stats.totalQ} sub="answered" />
          </div>

          <Panel style={{ padding: '20px 20px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <Eyebrow>Score trend</Eyebrow>
              <span style={{ fontFamily: MONO, fontSize: 11, color: T.faint }}>
                <span style={{ color: T.cyan }}>—</span> score &nbsp; <span style={{ color: T.sub }}>– –</span> 3-run avg &nbsp; <span style={{ color: T.amber }}>– –</span> 55 &nbsp; <span style={{ color: T.green }}>– –</span> 70
              </span>
            </div>
            <div style={{ width: '100%', height: 252 }}>
              <ResponsiveContainer>
                <LineChart data={stats.trend} margin={{ top: 8, right: 16, left: 6, bottom: 0 }}>
                  <CartesianGrid stroke={T.border} strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="n" stroke={T.faint} tick={{ fontSize: 11, fill: T.faint, fontFamily: MONO }} tickLine={false} axisLine={{ stroke: T.border }} />
                  <YAxis domain={[stats.yMin, 80]} allowDecimals={false} stroke={T.faint} tick={{ fontSize: 11, fill: T.faint, fontFamily: MONO }} tickLine={false} axisLine={{ stroke: T.border }} width={40} />
                  <Tooltip
                    contentStyle={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, fontFamily: MONO, fontSize: 12 }}
                    labelStyle={{ color: T.sub }} itemStyle={{ color: T.cyan }}
                    labelFormatter={(l) => `Run #${l}`} />
                  <ReferenceLine y={55} stroke={T.amber} strokeDasharray="4 4" strokeOpacity={0.5} />
                  <ReferenceLine y={70} stroke={T.green} strokeDasharray="4 4" strokeOpacity={0.5} />
                  <Line type="monotone" dataKey="ma" name="3-run avg" stroke={T.sub} strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                  <Line type="monotone" dataKey="score" name="score" stroke={T.cyan} strokeWidth={2.25} dot={{ r: 3, fill: T.cyan, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="split">
            <TypePerf agg={stats.agg} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Diagnostic acc={stats.avgAcc} reached={stats.avgReached} />
              <PaceCard avgSpeed={stats.avgSpeed} />
              <WeakestCard agg={stats.agg} />
            </div>
          </div>

          <RecentTable sessions={sessions} />

          <div style={{ textAlign: 'right' }}>
            {!confirmReset ? (
              <button className="ghost" onClick={() => setConfirmReset(true)} style={{ color: T.faint, fontSize: 12, fontFamily: MONO }}>reset history</button>
            ) : (
              <span style={{ fontSize: 12, fontFamily: MONO, color: T.sub }}>
                delete all sessions?{' '}
                <button className="ghost" onClick={doReset} style={{ color: T.red, fontFamily: MONO, fontSize: 12 }}>yes, delete</button>
                <button className="ghost" onClick={() => setConfirmReset(false)} style={{ color: T.sub, fontFamily: MONO, fontSize: 12 }}>cancel</button>
              </span>
            )}
          </div>
        </div>
      )}

      {loaded && !stats && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 30 }}>
          <Panel style={{ padding: '44px 24px', textAlign: 'center' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 22, color: T.ink }}>No runs yet</div>
            <p style={{ color: T.sub, fontSize: 14.5, lineHeight: 1.6, maxWidth: '44ch', margin: '12px auto 0' }}>
              Take your first test and this fills with your score trend, per-type accuracy and speed, and a read on whether speed or accuracy is what&apos;s holding you back.
            </p>
            <button className="pill btn" onClick={onStart} style={{ marginTop: 22, padding: '13px 24px' }}>Start the test →</button>
          </Panel>
        </div>
      )}
      {loaded && !storageOK && (
        <p style={{ color: T.faint, fontFamily: MONO, fontSize: 11.5, textAlign: 'center', marginTop: 14 }}>
          History isn&apos;t being saved in this view (storage unavailable) — scores reset on reload.
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, sub, color = T.ink }) {
  return (
    <Panel style={{ padding: '15px 16px' }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ fontFamily: MONO, fontSize: 29, fontWeight: 700, color, marginTop: 7, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: MONO, fontSize: 10.5, color: T.faint, marginTop: 5 }}>{sub}</div>}
    </Panel>
  );
}

function ReadinessMeter({ avg }) {
  const pos = Math.max(0, Math.min(80, avg)) / 80 * 100;
  const band = bandFor(avg);
  let msg;
  if (avg < 0) msg = <>Negative — you&apos;re losing more than you score. Fix accuracy before anything else.</>;
  else if (avg < 55) msg = <><b style={{ color: T.amber }}>{Math.ceil(55 - avg)}</b> points to the 55 pass gate.</>;
  else if (avg < 70) msg = <><b style={{ color: T.cyan }}>{Math.ceil(70 - avg)}</b> points to competitive (70).</>;
  else if (avg < 77) msg = <><b style={{ color: T.green }}>{Math.ceil(77 - avg)}</b> points to top tier (77).</>;
  else msg = <>Top tier on recent form. Maintain, then broaden to the rest of the OA.</>;
  const seg = (w, c) => <div style={{ width: `${w}%`, background: c, height: '100%' }} />;
  const ticks = [{ v: '0', p: 0 }, { v: '55', p: 68.75 }, { v: '70', p: 87.5 }, { v: '80', p: 100 }];
  return (
    <Panel style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
        <Eyebrow>Readiness · recent form (avg of last 5)</Eyebrow>
        <span style={{ fontFamily: MONO, fontSize: 13, color: band.color, fontWeight: 500 }}>{band.label}</span>
      </div>
      <div style={{ position: 'relative', marginTop: 22 }}>
        <div style={{ display: 'flex', height: 14, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border}` }}>
          {seg(68.75, 'rgba(240,101,96,.42)')}{seg(18.75, 'rgba(244,185,66,.5)')}{seg(8.75, 'rgba(79,208,214,.5)')}{seg(3.75, 'rgba(70,211,153,.55)')}
        </div>
        <div style={{ position: 'absolute', top: -7, left: `${pos}%`, transform: 'translateX(-50%)', transition: 'left .4s', pointerEvents: 'none' }}>
          <div style={{ width: 2, height: 28, background: T.ink, margin: '0 auto', boxShadow: '0 0 6px rgba(0,0,0,.6)' }} />
        </div>
      </div>
      <div style={{ position: 'relative', height: 14, marginTop: 6 }}>
        {ticks.map((t) => (
          <span key={t.v} style={{ position: 'absolute', left: `${t.p}%`, transform: t.p === 0 ? 'none' : t.p === 100 ? 'translateX(-100%)' : 'translateX(-50%)', fontFamily: MONO, fontSize: 10, color: T.faint }}>{t.v}</span>
        ))}
      </div>
      <p style={{ fontSize: 14, color: T.ink, margin: '12px 0 0', lineHeight: 1.5 }}>
        Recent average <b style={{ fontFamily: MONO, color: band.color }}>{avg.toFixed(1)}</b>. {msg}
      </p>
    </Panel>
  );
}

function TypePerf({ agg }) {
  const head = { display: 'grid', gridTemplateColumns: '1fr 52px 58px', gap: '0 12px' };
  return (
    <Panel style={{ padding: 20 }}>
      <Eyebrow>Performance by type · accuracy &amp; speed</Eyebrow>
      <div style={{ ...head, marginTop: 16, fontFamily: SANS, fontSize: 10, fontWeight: 600, color: T.faint, letterSpacing: '0.1em' }}>
        <span>TYPE</span><span style={{ textAlign: 'right' }}>ACC</span><span style={{ textAlign: 'right' }}>SPEED</span>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 13 }}>
        {ORDER.map((t) => {
          const a = agg[t]; const pct = a.att ? Math.round((a.correct / a.att) * 100) : null;
          const sp = a.msN ? a.ms / a.msN / 1000 : null;
          return (
            <div key={t}>
              <div style={{ ...head, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: T.sub }}>{LABELS[t]}</span>
                <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 12.5, color: pct === null ? T.faint : accColor(pct) }}>{pct === null ? '—' : `${pct}%`}</span>
                <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 12.5, color: sp === null ? T.faint : speedColor(sp) }}>{sp === null ? '—' : `${sp.toFixed(1)}s`}</span>
              </div>
              <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 6, height: 7, overflow: 'hidden', marginTop: 6 }}>
                {pct !== null && <div style={{ width: `${pct}%`, height: '100%', background: accColor(pct) }} />}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.faint, marginTop: 4 }}>{a.att ? `${a.correct}/${a.att} correct` : 'not attempted'}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Diagnostic({ acc, reached }) {
  const a = Math.round(acc * 100); const r = Math.round(reached);
  const accGood = acc >= 0.85; const reachGood = reached >= 65;
  let title; let color; let body;
  if (accGood && reachGood) { title = 'Competitive shape'; color = T.green; body = `Accurate (${a}%) and getting through ${r}/80. The arithmetic gate isn't your limiter anymore — push effort to sequences, probability and the coding OA.`; }
  else if (accGood && !reachGood) { title = 'Speed is the bottleneck'; color = T.amber; body = `You're accurate (${a}%) but only reaching ${r}/80. You compute fine, you're just not fast enough. Drill raw pace on your slow types — that's where the score is.`; }
  else if (!accGood && reachGood) { title = 'Accuracy is the bottleneck'; color = T.amber; body = `You reach ${r}/80 but only ${a}% land. Every wrong answer is a −1, so you're bleeding points by rushing. Ease off on the weak types below.`; }
  else { title = 'Both need work'; color = T.red; body = `Reaching ${r}/80 at ${a}% accuracy. Fix accuracy first — stop the −1 bleed — then push pace once you're reliably past 85%.`; }
  return (
    <Panel style={{ padding: '17px 19px', borderLeft: `3px solid ${color}` }}>
      <Eyebrow color={color}>Diagnosis</Eyebrow>
      <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 17, color, margin: '7px 0 7px' }}>{title}</div>
      <p style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, margin: 0 }}>{body}</p>
    </Panel>
  );
}

function PaceCard({ avgSpeed }) {
  if (avgSpeed === null) return null;
  const c = speedColor(avgSpeed);
  return (
    <Panel style={{ padding: '17px 19px' }}>
      <Eyebrow>Pace</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 7 }}>
        <span style={{ fontFamily: MONO, fontSize: 29, fontWeight: 700, color: c }}>{avgSpeed.toFixed(1)}s</span>
        <span style={{ fontSize: 12.5, color: T.sub }}>per answered question</span>
      </div>
      <p style={{ fontSize: 12.5, color: T.sub, margin: '8px 0 0', lineHeight: 1.5 }}>
        Clearing all 80 needs about <b style={{ fontFamily: MONO, color: T.ink }}>6.0s</b> each. {avgSpeed <= 6.2 ? 'You are on pace for the full set.' : `You are ${(avgSpeed - 6).toFixed(1)}s over — that gap is the rest of the set.`}
      </p>
    </Panel>
  );
}

function WeakestCard({ agg }) {
  const weak = ORDER.map((t) => ({ t, ...agg[t] })).filter((x) => x.att >= 3).map((x) => ({ ...x, pct: x.correct / x.att })).sort((a, b) => a.pct - b.pct).slice(0, 2);
  if (!weak.length) return null;
  return (
    <Panel style={{ padding: '17px 19px', borderLeft: `3px solid ${T.amber}` }}>
      <Eyebrow color={T.amber}>Drill next</Eyebrow>
      <p style={{ fontSize: 13, color: T.ink, margin: '8px 0 0', lineHeight: 1.5 }}>
        Weakest types: <b>{weak.map((w) => `${LABELS[w.t]} (${Math.round(w.pct * 100)}%)`).join(', ')}</b>. Target these before your next full run.
      </p>
    </Panel>
  );
}

function RecentTable({ sessions }) {
  const rows = [...sessions].slice(-8).reverse();
  const cols = { display: 'grid', gridTemplateColumns: '1.4fr 58px 56px 70px 60px', gap: '0 10px' };
  return (
    <Panel style={{ padding: 20 }}>
      <Eyebrow>Recent sessions</Eyebrow>
      <div style={{ marginTop: 16, overflowX: 'auto' }}>
        <div style={{ ...cols, fontFamily: SANS, fontSize: 10, fontWeight: 600, color: T.faint, letterSpacing: '0.1em', paddingBottom: 9, borderBottom: `1px solid ${T.border}` }}>
          <span>WHEN</span><span style={{ textAlign: 'right' }}>SCORE</span><span style={{ textAlign: 'right' }}>ACC</span><span style={{ textAlign: 'right' }}>REACHED</span><span style={{ textAlign: 'right' }}>TIME</span>
        </div>
        {rows.map((s, i) => {
          const acc = s.reached ? Math.round((s.correct / s.reached) * 100) : 0;
          return (
            <div key={i} style={{ ...cols, alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${T.borderSoft}`, fontFamily: MONO, fontSize: 12.5 }}>
              <span style={{ color: T.sub }}>{fmtDate(s.ts)}</span>
              <span style={{ textAlign: 'right', color: bandFor(s.score).color, fontWeight: 700 }}>{s.score}</span>
              <span style={{ textAlign: 'right', color: accColor(acc) }}>{acc}%</span>
              <span style={{ textAlign: 'right', color: T.ink }}>{s.reached}/80</span>
              <span style={{ textAlign: 'right', color: T.sub }}>{fmtClock(s.timeUsed)}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function InfoPanel() {
  const Row = ({ k, v }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, padding: '8px 0', borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: T.amber, letterSpacing: '0.02em' }}>{k}</span>
      <span style={{ fontSize: 13, color: T.ink, lineHeight: 1.5 }}>{v}</span>
    </div>
  );
  return (
    <Panel style={{ padding: '18px 20px' }}>
      <Eyebrow>How this is scored</Eyebrow>
      <div style={{ marginTop: 10 }}>
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

  useEffect(() => {
    const h = (e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= 4) onAnswer(n - 1); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onAnswer, idx]);

  if (!q) return null;
  return (
    <div style={{ minHeight: 460, maxWidth: 720, margin: '0 auto' }}>
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

      <div style={{ height: 4, background: T.border, borderRadius: 4, overflow: 'hidden', marginBottom: 'clamp(30px,8vh,68px)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: clockColor, transition: 'width .2s linear' }} />
      </div>

      <div style={{ textAlign: 'center', marginBottom: 'clamp(30px,8vh,60px)' }}>
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(2.6rem,11vw,5rem)', letterSpacing: '-0.01em', lineHeight: 1.05, color: T.ink }}>
          {q.q}
        </div>
      </div>

      <div className="opts">
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
        <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(1.9rem,6vw,2.6rem)', margin: '6px 0 0', fontWeight: 700, letterSpacing: '-0.02em' }}>80-in-8 complete</h1>
      </header>

      <Panel style={{ padding: '26px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
          <div>
            <Eyebrow>Net score</Eyebrow>
            <div style={{ fontFamily: MONO, fontSize: 'clamp(3.4rem,16vw,5.2rem)', fontWeight: 700, color: b.color, lineHeight: 1 }}>{r.score}</div>
            <div style={{ fontFamily: MONO, fontSize: 12, color: T.faint, marginTop: 2 }}>{r.correct} right &minus; {r.wrong} wrong · max 80</div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <span style={{ display: 'inline-block', background: b.color, color: '#06121a', fontFamily: MONO, fontWeight: 700, fontSize: 13, padding: '5px 12px', borderRadius: 999, letterSpacing: '0.02em' }}>
              {b.label} · {b.range}
            </span>
            <p style={{ color: T.ink, fontSize: 14, lineHeight: 1.55, margin: '12px 0 0' }}>{b.note}</p>
          </div>
        </div>
        <p style={{ color: T.faint, fontFamily: MONO, fontSize: 11, lineHeight: 1.5, marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
          Tiers are community-reported, not official, and not a percentile — Optiver has never published score distributions.
        </p>
      </Panel>

      <div className="tiles" style={{ marginBottom: 12 }}>
        <Tile label="Correct" value={r.correct} color={T.cyan} />
        <Tile label="Wrong" value={r.wrong} color={T.red} />
        <Tile label="Not reached" value={r.unreached} color={T.sub} />
        <Tile label="Accuracy" value={`${r.accuracy}%`} color={accColor(r.accuracy)} />
        <Tile label="Reached" value={`${r.reached}/80`} color={reachedColor(r.reached)} />
        <Tile label="Pace" value={r.avgSpeed === null ? '—' : `${r.avgSpeed.toFixed(1)}s`} sub="per question" color={r.avgSpeed === null ? T.faint : speedColor(r.avgSpeed)} />
      </div>
      <p style={{ color: T.sub, fontFamily: MONO, fontSize: 12, margin: '0 0 18px' }}>
        Finished in {fmtClock(r.timeUsed)} · accuracy is correct &divide; reached.
      </p>

      <Panel style={{ padding: 20, marginBottom: 16 }}>
        <Eyebrow>This session, by type</Eyebrow>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 11 }}>
          {ORDER.map((t) => {
            const a = r.byType[t]; const pct = a.att ? Math.round((a.correct / a.att) * 100) : null;
            const sp = a.att && a.ms ? a.ms / a.att / 1000 : null;
            return (
              <div key={t} style={{ display: 'grid', gridTemplateColumns: '132px 1fr 56px 84px', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: T.sub }}>{LABELS[t]}</span>
                <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 6, height: 11, overflow: 'hidden' }}>
                  {pct !== null && <div style={{ width: `${pct}%`, height: '100%', background: accColor(pct) }} />}
                </div>
                <span style={{ fontFamily: MONO, fontSize: 12, color: sp === null ? T.faint : speedColor(sp), textAlign: 'right' }}>{sp === null ? '—' : `${sp.toFixed(1)}s`}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: pct === null ? T.faint : accColor(pct), textAlign: 'right' }}>
                  {pct === null ? 'not reached' : `${pct}% · ${a.correct}/${a.att}`}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      {drill.length > 0 && (
        <Panel style={{ padding: '15px 19px', marginBottom: 18, borderLeft: `3px solid ${T.amber}` }}>
          <Eyebrow color={T.amber}>Drill next</Eyebrow>
          <p style={{ color: T.ink, fontSize: 14, margin: '8px 0 0', lineHeight: 1.5 }}>
            Weakest this session: <b>{drill.map((d) => LABELS[d.t]).join(' and ')}</b>. Decimal division and two-digit multiplication are the usual culprits — target those before your next full run.
          </p>
        </Panel>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="pill btn" onClick={onRetake} style={{ fontSize: 15, padding: '13px 24px' }}>Retake →</button>
        <button className="btn" onClick={onHome} style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.ink, fontFamily: SANS, fontWeight: 600, fontSize: 15, padding: '13px 24px' }}>Dashboard</button>
      </div>
    </div>
  );
}

/* ----------------------------- styles ------------------------------------- */
const styles = `
.o8 *{box-sizing:border-box}
.o8 button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
.o8 input{outline:none}
.o8 input:focus{border-color:${T.amber}}
.o8 .card{background:${T.surface};border:1px solid ${T.border};border-radius:16px;box-shadow:0 12px 34px -16px rgba(0,0,0,.75)}
.o8 .nav{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;padding:14px 22px;background:rgba(8,9,13,.72);backdrop-filter:saturate(140%) blur(12px);-webkit-backdrop-filter:saturate(140%) blur(12px);border-bottom:1px solid ${T.border}}
.o8 .pill{background:${T.ink};color:#0a0b0f;border-radius:11px;font-family:${SANS};font-weight:600;padding:11px 20px}
.o8 .pill:hover{filter:brightness(.92)}
.o8 .ghost{color:${T.sub};padding:10px 12px;border-radius:10px;font-family:${SANS};transition:color .15s,background .15s}
.o8 .ghost:hover{color:${T.ink};background:rgba(255,255,255,.05)}
.o8 .opt{background:${T.surface};border:1px solid ${T.border};border-radius:14px;padding:22px 16px;font-family:${MONO};color:${T.ink};transition:border-color .12s,background .12s,transform .05s;text-align:center}
.o8 .opt:hover:not(:disabled){border-color:${T.amber};background:#14161d}
.o8 .opt:active{transform:translateY(1px)}
.o8 .opt:focus-visible,.o8 .pill:focus-visible,.o8 .ghost:focus-visible,.o8 .btn:focus-visible{outline:2px solid ${T.amber};outline-offset:2px}
.o8 .btn{transition:filter .15s,transform .06s}
.o8 .btn:hover{filter:brightness(1.05)}
.o8 .btn:active{transform:translateY(1px)}
.o8 .hero-grid{display:grid;grid-template-columns:1fr;gap:36px;align-items:center}
.o8 .opts{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.o8 .tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
.o8 .split{display:grid;grid-template-columns:1.45fr 1fr;gap:16px;align-items:start}
@media(min-width:860px){.o8 .hero-grid{grid-template-columns:1.08fr .92fr}}
@media(max-width:900px){.o8 .tiles{grid-template-columns:repeat(3,1fr)}}
@media(max-width:820px){.o8 .split{grid-template-columns:1fr}}
@media(max-width:560px){.o8 .opts{grid-template-columns:1fr}.o8 .tiles{grid-template-columns:repeat(2,1fr)}}
.o8 .pulse{animation:o8pulse 1s ease-in-out infinite}
@keyframes o8pulse{0%,100%{opacity:1}50%{opacity:.5}}
.o8 .fadein{animation:o8fade .55s ease both}
@keyframes o8fade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.o8 *{animation:none!important;transition:none!important}}
`;
