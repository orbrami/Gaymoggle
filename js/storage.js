/* ── GAYMOGGLE STORAGE v3 ──────────────────────────────────────────────── */
/* localStorage-based accounts. Username saved permanently on device.       */
/* Season resets every SEASON_DAYS days.                                    */

const STORE_KEY = 'gaymoggle_v3';

const DEFAULTS = {
  username:      '',
  totalGP:       0,
  seasonGP:      0,
  seasonStart:   null,   // ISO date string
  wins:          0,
  losses:        0,
  matches:       0,
  bestScore:     0,
  streak:        0,
  lastPlayDate:  null,
  achievements:  [],
  history:       [],     // last 30 matches
};

function stLoad() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; }
  catch(e) { return { ...DEFAULTS }; }
}
function stSave(d) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch(e) {}
}
function stGet(k)    { return stLoad()[k]; }
function stSet(k, v) { const d = stLoad(); d[k] = v; stSave(d); }

// ── Season Management ──────────────────────────────────────────────────────
function checkSeason() {
  const d   = stLoad();
  const now = Date.now();
  const days = typeof SEASON_DAYS !== 'undefined' ? SEASON_DAYS : 10;

  if (!d.seasonStart) {
    d.seasonStart = now;
    d.seasonGP    = 0;
    stSave(d);
    return;
  }

  const elapsed = (now - d.seasonStart) / (1000 * 60 * 60 * 24);
  if (elapsed >= days) {
    // New season — save previous to history, reset
    d.seasonGP    = 0;
    d.seasonStart = now;
    stSave(d);
  }
}

function getSeasonTimeLeft() {
  const d    = stLoad();
  const days = typeof SEASON_DAYS !== 'undefined' ? SEASON_DAYS : 10;
  if (!d.seasonStart) return days * 24 * 3600 * 1000;
  const end  = d.seasonStart + days * 24 * 3600 * 1000;
  return Math.max(0, end - Date.now());
}

function addGP(amount) {
  const d = stLoad();
  d.totalGP  = (d.totalGP  || 0) + amount;
  d.seasonGP = (d.seasonGP || 0) + amount;
  stSave(d);
  return d;
}

function recordMatch(myScore, strangerScore, strangerName) {
  checkSeason();
  const d   = stLoad();
  const won = myScore > strangerScore;

  d.matches   = (d.matches  || 0) + 1;
  d.wins      = (d.wins     || 0) + (won ? 1 : 0);
  d.losses    = (d.losses   || 0) + (won ? 0 : 1);
  d.bestScore = Math.max(d.bestScore || 0, myScore);

  // Streak
  const today = new Date().toDateString();
  if (d.lastPlayDate === today) {
    // same day
  } else if (d.lastPlayDate === new Date(Date.now()-86400000).toDateString()) {
    d.streak = (d.streak || 0) + 1;
  } else {
    d.streak = 1;
  }
  d.lastPlayDate = today;

  // GP earned
  const gp = Math.round(myScore * 12 + (won ? 60 : 15) + d.streak * 5);
  d.totalGP  = (d.totalGP  || 0) + gp;
  d.seasonGP = (d.seasonGP || 0) + gp;

  // History
  if (!d.history) d.history = [];
  d.history.unshift({ myScore, strangerScore, strangerName, won, gp, date: Date.now() });
  if (d.history.length > 30) d.history.pop();

  stSave(d);
  checkAchievements(d);
  return { won, gp, data: d };
}

// ── Achievements ───────────────────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id:'first',      icon:'🏁', name:'First Steps',        desc:'Play your first match',       check: d => d.matches >= 1  },
  { id:'win1',       icon:'🏆', name:'Winner Winner',       desc:'Win your first match',        check: d => d.wins >= 1     },
  { id:'win10',      icon:'👑', name:'Gay Royalty',         desc:'Win 10 matches',              check: d => d.wins >= 10    },
  { id:'win50',      icon:'💎', name:'Gay Legend',          desc:'Win 50 matches',              check: d => d.wins >= 50    },
  { id:'score10',    icon:'💯', name:'Perfectly Gay',       desc:'Score a perfect 10',          check: d => d.bestScore>=10 },
  { id:'score9',     icon:'🌈', name:'Almost Perfect',      desc:'Score 9+',                    check: d => d.bestScore>=9  },
  { id:'matches10',  icon:'🔥', name:'Hooked',              desc:'Play 10 matches',             check: d => d.matches >= 10 },
  { id:'matches50',  icon:'🚀', name:'Obsessed',            desc:'Play 50 matches',             check: d => d.matches >= 50 },
  { id:'streak3',    icon:'⚡', name:'On Fire',             desc:'3-day streak',                check: d => d.streak >= 3   },
  { id:'streak7',    icon:'🌟', name:'Gay Week',            desc:'7-day streak',                check: d => d.streak >= 7   },
  { id:'gp500',      icon:'⭐', name:'500 Club',            desc:'Earn 500 Gay Points™',        check: d => d.totalGP>=500  },
  { id:'gp2000',     icon:'💫', name:'2000 Club',           desc:'Earn 2000 Gay Points™',       check: d => d.totalGP>=2000 },
  { id:'overtime',   icon:'⏰', name:'Extra Spicy',         desc:'Trigger overtime in a match', check: d => d._overtime     },
  { id:'private',    icon:'🔐', name:'Exclusive',           desc:'Play a private match',        check: d => d._playedPrivate},
];

function checkAchievements(d) {
  if (!d.achievements) d.achievements = [];
  const newOnes = [];
  for (const a of ACHIEVEMENTS) {
    if (!d.achievements.includes(a.id) && a.check(d)) {
      d.achievements.push(a.id);
      newOnes.push(a);
    }
  }
  if (newOnes.length) stSave(d);
  return newOnes;
}

function getAllAchievements() {
  const d = stLoad();
  return ACHIEVEMENTS.map(a => ({ ...a, unlocked: (d.achievements||[]).includes(a.id) }));
}

// ── Gay Labels ─────────────────────────────────────────────────────────────
const GAY_LABELS = [
  { min:0,   label:'Straight as an Arrow',      emoji:'👔' },
  { min:1,   label:'Probably Just Metrosexual', emoji:'💼' },
  { min:2,   label:'One Gay Friend Away',        emoji:'🤝' },
  { min:3,   label:'The "Ally"™',               emoji:'🏳️‍🌈'},
  { min:4,   label:'Bisexual Lighting™',         emoji:'💡' },
  { min:5,   label:'Technically Pan',            emoji:'🍳' },
  { min:6,   label:'Gay Coded',                  emoji:'🌈' },
  { min:7,   label:'Full-on Gay',                emoji:'💅' },
  { min:8,   label:'Extremely Gay',              emoji:'👑' },
  { min:9,   label:'Mother of All Homos',        emoji:'🏆' },
  { min:9.6, label:'Certified Homosexual™',      emoji:'✨' },
];

function getLabel(score) {
  let best = GAY_LABELS[0];
  for (const l of GAY_LABELS) { if (score >= l.min) best = l; }
  return best;
}

// ── Leaderboard ────────────────────────────────────────────────────────────
// localStorage leaderboard: each device stores its own entry.
// Shared via same key pool — all stored under individual keys with a prefix.
// This gives a "real" per-device leaderboard that persists.
function updateLeaderboardEntry() {
  const d    = stLoad();
  if (!d.username) return;
  const key  = 'gm_lb_' + btoa(d.username).replace(/=/g,'');
  const entry = {
    username:  d.username,
    seasonGP:  d.seasonGP || 0,
    totalGP:   d.totalGP  || 0,
    wins:      d.wins     || 0,
    streak:    d.streak   || 0,
    bestScore: d.bestScore|| 0,
    updated:   Date.now(),
  };
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch(e) {}
}

function getLeaderboard() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith('gm_lb_')) continue;
    try {
      const e = JSON.parse(localStorage.getItem(k));
      if (e && e.username) entries.push(e);
    } catch(e) {}
  }
  entries.sort((a,b) => (b.seasonGP||0) - (a.seasonGP||0));
  return entries;
}

// ── Init ───────────────────────────────────────────────────────────────────
checkSeason();
