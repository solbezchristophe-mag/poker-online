const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('docs'));
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const tables = new Map();
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const BOT_NAMES = ['Alex','Charlie','Sam','Nina','Léo','Maya','Tom','Lina','Noa','Eva','Max','Zoé'];

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function roomId() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function botId() { return 'BOT-' + crypto.randomBytes(4).toString('hex'); }
function getTable(id) { return tables.get(String(id || '').toUpperCase()); }

function createTable(id) {
  return {
    id, hostId: null, players: [], deck: [], community: [], pot: 0,
    currentBet: 0, dealerIndex: -1, turnIndex: 0, phase: 'waiting',
    minRaise: 20, smallBlind: 10, bigBlind: 20, handNumber: 0,
    message: 'En attente de joueurs…', botTimer: null, handTimer: null,
    handToken: 0
  };
}

function makePlayer(id, name, isBot = false) {
  return {
    id, name: cleanName(name), isBot, chips: 2000, bet: 0,
    handContribution: 0, cards: [], folded: false, allIn: false,
    inHand: false, connected: true, acted: false
  };
}

function seatedForHand(p) { return (p.isBot || p.connected) && p.chips > 0; }
function playersInHand(t) { return t.players.filter(p => p.inHand && !p.folded); }
function activeNotAllIn(t) { return t.players.filter(p => p.inHand && !p.folded && !p.allIn); }

function nextIndexMatching(t, from, predicate) {
  if (!t.players.length) return -1;
  for (let i = 1; i <= t.players.length; i++) {
    const idx = (from + i + t.players.length) % t.players.length;
    if (predicate(t.players[idx], idx)) return idx;
  }
  return -1;
}

function nextActiveIndex(t, from) {
  return nextIndexMatching(t, from, p => p.inHand && !p.folded && !p.allIn && p.chips > 0);
}
function nextSeatedWithChips(t, from) {
  return nextIndexMatching(t, from, p => seatedForHand(p));
}

function publicState(t) {
  return {
    id: t.id, hostId: t.hostId,
    players: t.players.map((p, index) => ({
      id: p.id, name: p.name, isBot: p.isBot, chips: p.chips, bet: p.bet,
      folded: p.folded, allIn: p.allIn, inHand: p.inHand,
      connected: p.isBot ? true : p.connected, seat: index,
      isDealer: index === t.dealerIndex,
      isTurn: !['waiting','showdown'].includes(t.phase) && index === t.turnIndex
    })),
    community: t.community, pot: t.pot, currentBet: t.currentBet,
    phase: t.phase, minRaise: t.minRaise, smallBlind: t.smallBlind,
    bigBlind: t.bigBlind, handNumber: t.handNumber, message: t.message,
    maxPlayers: 10
  };
}

function emitState(t) {
  io.to(t.id).emit('state', publicState(t));
  for (const p of t.players) {
    if (!p.isBot && p.connected) io.to(p.id).emit('private', { cards: p.cards || [], playerId: p.id });
  }
}

function payIntoPot(t, p, amount) {
  const paid = Math.max(0, Math.min(amount, p.chips));
  p.chips -= paid;
  p.bet += paid;
  p.handContribution += paid;
  t.pot += paid;
  if (p.chips === 0) p.allIn = true;
  return paid;
}

function postBlind(t, idx, amount) {
  if (idx < 0) return;
  payIntoPot(t, t.players[idx], amount);
}

function resetRoundBets(t) {
  for (const p of t.players) p.bet = 0;
  t.currentBet = 0;
  t.minRaise = t.bigBlind;
}

function dealCommunity(t, count) {
  for (let i = 0; i < count && t.deck.length; i++) t.community.push(t.deck.pop());
}

function startHand(t) {
  clearTimeout(t.handTimer); clearTimeout(t.botTimer);
  const eligible = t.players.filter(seatedForHand);
  if (eligible.length < 2) {
    t.phase = 'waiting';
    t.message = 'Il faut au moins 2 joueurs ou bots avec des jetons.';
    emitState(t);
    return;
  }

  t.handToken++;
  t.handNumber++;
  t.deck = makeDeck(); t.community = []; t.pot = 0; t.currentBet = 0;
  t.phase = 'preflop'; t.message = `Main n°${t.handNumber}`;

  t.players.forEach(p => {
    p.cards = []; p.bet = 0; p.handContribution = 0; p.folded = false;
    p.allIn = false; p.inHand = seatedForHand(p); p.acted = false;
  });

  t.dealerIndex = nextSeatedWithChips(t, t.dealerIndex);
  const activeCount = t.players.filter(p => p.inHand).length;
  let sb, bb;
  if (activeCount === 2) {
    sb = t.dealerIndex;
    bb = nextSeatedWithChips(t, sb);
  } else {
    sb = nextSeatedWithChips(t, t.dealerIndex);
    bb = nextSeatedWithChips(t, sb);
  }

  for (let r = 0; r < 2; r++) {
    for (let i = 1; i <= t.players.length; i++) {
      const idx = (t.dealerIndex + i) % t.players.length;
      if (t.players[idx].inHand) t.players[idx].cards.push(t.deck.pop());
    }
  }

  postBlind(t, sb, t.smallBlind);
  postBlind(t, bb, t.bigBlind);
  t.currentBet = Math.max(t.players[sb].bet, t.players[bb].bet);

  // En heads-up, le dealer / petite blind parle en premier préflop.
  t.turnIndex = activeCount === 2 ? sb : nextActiveIndex(t, bb);
  if (t.turnIndex < 0) return runoutAndShowdown(t);
  emitState(t);
  scheduleBotTurn(t);
}

function everyoneSettled(t) {
  const contenders = activeNotAllIn(t);
  if (contenders.length === 0) return true;
  return contenders.every(p => p.acted && p.bet === t.currentBet);
}

function awardIfSingle(t) {
  const live = playersInHand(t);
  if (live.length !== 1) return false;
  const winner = live[0];
  const won = t.pot;
  winner.chips += won;
  t.pot = 0; t.phase = 'showdown';
  t.message = `${winner.name} remporte ${won} jetons.`;
  emitState(t);
  scheduleNextHand(t);
  return true;
}

function firstPostflopActor(t) {
  return nextActiveIndex(t, t.dealerIndex);
}

function advanceStreet(t) {
  if (awardIfSingle(t)) return;
  if (t.phase === 'preflop') { dealCommunity(t, 3); t.phase = 'flop'; }
  else if (t.phase === 'flop') { dealCommunity(t, 1); t.phase = 'turn'; }
  else if (t.phase === 'turn') { dealCommunity(t, 1); t.phase = 'river'; }
  else if (t.phase === 'river') return showdown(t);

  resetRoundBets(t);
  t.players.forEach(p => p.acted = false);
  if (activeNotAllIn(t).length <= 1) return runoutAndShowdown(t);
  t.turnIndex = firstPostflopActor(t);
  emitState(t);
  scheduleBotTurn(t);
}

function runoutAndShowdown(t) {
  while (t.community.length < 5) dealCommunity(t, 1);
  showdown(t);
}

function rankValue(r) { return RANKS.indexOf(r) + 2; }
function combinations(arr, k) {
  const out = [];
  function rec(start, chosen) {
    if (chosen.length === k) return out.push(chosen.slice());
    for (let i = start; i <= arr.length - (k - chosen.length); i++) {
      chosen.push(arr[i]); rec(i + 1, chosen); chosen.pop();
    }
  }
  rec(0, []); return out;
}

function score5(cards) {
  const vals = cards.map(c => rankValue(c.r)).sort((a,b)=>b-a);
  const counts = new Map(); vals.forEach(v => counts.set(v, (counts.get(v)||0)+1));
  const groups = [...counts.entries()].sort((a,b)=> b[1]-a[1] || b[0]-a[0]);
  const flush = cards.every(c => c.s === cards[0].s);
  let unique = [...new Set(vals)]; if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let i=0;i<=unique.length-5;i++) if (unique[i]-unique[i+4]===4) { straightHigh=unique[i]; break; }
  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0][1]===4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1]===3 && groups[1]?.[1]>=2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1]===3) return [3, groups[0][0], ...groups.slice(1).map(g=>g[0]).sort((a,b)=>b-a)];
  if (groups[0][1]===2 && groups[1]?.[1]===2) {
    const hi=Math.max(groups[0][0],groups[1][0]), lo=Math.min(groups[0][0],groups[1][0]);
    const kick=groups.find(g=>g[1]===1)?.[0]||0; return [2,hi,lo,kick];
  }
  if (groups[0][1]===2) return [1, groups[0][0], ...groups.slice(1).map(g=>g[0]).sort((a,b)=>b-a)];
  return [0, ...vals];
}

function cmpScore(a,b) {
  for (let i=0;i<Math.max(a.length,b.length);i++) {
    const av=a[i]||0,bv=b[i]||0; if(av!==bv) return av-bv;
  }
  return 0;
}
function bestScore(cards) {
  let best = null;
  for (const hand of combinations(cards, 5)) {
    const s=score5(hand); if(!best || cmpScore(s,best)>0) best=s;
  }
  return best;
}

function buildSidePots(t) {
  const levels = [...new Set(t.players.map(p => p.handContribution).filter(x => x > 0))].sort((a,b)=>a-b);
  const pots = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = t.players.filter(p => p.handContribution >= level);
    const amount = (level - previous) * contributors.length;
    const eligible = contributors.filter(p => p.inHand && !p.folded);
    if (amount > 0 && eligible.length) pots.push({ amount, eligible });
    previous = level;
  }
  return pots;
}

function showdown(t) {
  const live = playersInHand(t);
  if (!live.length) return;
  while (t.community.length < 5) dealCommunity(t, 1);

  const scoreMap = new Map(live.map(p => [p.id, bestScore([...p.cards, ...t.community])]));
  const sidePots = buildSidePots(t);
  const wonBy = new Map();

  for (const pot of sidePots) {
    let best = null;
    for (const p of pot.eligible) {
      const s = scoreMap.get(p.id);
      if (!best || cmpScore(s, best) > 0) best = s;
    }
    const winners = pot.eligible.filter(p => cmpScore(scoreMap.get(p.id), best) === 0);
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    for (const w of winners) {
      const gain = share + (rem-- > 0 ? 1 : 0);
      w.chips += gain;
      wonBy.set(w.id, (wonBy.get(w.id) || 0) + gain);
    }
  }

  // Sécurité si aucun side-pot n'a été construit (ne devrait pas arriver).
  if (!sidePots.length && t.pot > 0) {
    let best = [...scoreMap.values()][0];
    for (const s of scoreMap.values()) if (cmpScore(s,best)>0) best=s;
    const winners = live.filter(p => cmpScore(scoreMap.get(p.id),best)===0);
    const share = Math.floor(t.pot/winners.length); let rem=t.pot-share*winners.length;
    for (const w of winners) { const gain=share+(rem-->0?1:0); w.chips+=gain; wonBy.set(w.id,gain); }
  }

  const potTotal = t.pot;
  t.pot = 0; t.phase = 'showdown'; t.players.forEach(p => p.acted = true);
  const winners = live.filter(p => wonBy.has(p.id));
  t.message = `${winners.map(w=>w.name).join(' & ')} ${winners.length>1?'se partagent':'remporte'} ${potTotal} jetons.`;
  io.to(t.id).emit('showdown', { players: live.map(p => ({ id:p.id, name:p.name, cards:p.cards })) });
  emitState(t);
  scheduleNextHand(t);
}

function scheduleNextHand(t) {
  clearTimeout(t.handTimer);
  const token = t.handToken;
  t.handTimer = setTimeout(() => {
    if (!tables.has(t.id) || token !== t.handToken) return;
    if (t.players.filter(seatedForHand).length >= 2) startHand(t);
    else { t.phase='waiting'; t.message='Ajoute un joueur ou un bot pour continuer.'; emitState(t); }
  }, 4200);
}

function takeAction(t, p, action, amount) {
  if (['waiting','showdown'].includes(t.phase)) return false;
  const idx = t.players.indexOf(p);
  if (idx !== t.turnIndex || p.folded || !p.inHand || p.allIn) return false;

  const oldCurrent = t.currentBet;
  if (action === 'fold') { p.folded = true; p.acted = true; }
  else if (action === 'check') {
    if (p.bet !== t.currentBet) return false;
    p.acted = true;
  } else if (action === 'call') {
    const due = Math.max(0, t.currentBet - p.bet);
    payIntoPot(t, p, due); p.acted = true;
  } else if (action === 'raise') {
    const requested = Number(amount) || 0;
    const maxTarget = p.bet + p.chips;
    if (maxTarget <= t.currentBet) {
      payIntoPot(t, p, t.currentBet - p.bet); p.acted = true;
    } else {
      const minTarget = t.currentBet + t.minRaise;
      const target = Math.min(maxTarget, Math.max(requested, minTarget));
      payIntoPot(t, p, target - p.bet);
      if (p.bet > oldCurrent) {
        const raiseSize = p.bet - oldCurrent;
        // Une relance all-in inférieure à la relance minimale ne rouvre pas l'action.
        if (raiseSize >= t.minRaise) {
          t.minRaise = raiseSize;
          t.players.forEach(x => { if (x !== p && x.inHand && !x.folded && !x.allIn) x.acted = false; });
        }
        t.currentBet = p.bet;
      }
      p.acted = true;
    }
  } else return false;

  if (awardIfSingle(t)) return true;
  if (everyoneSettled(t)) { advanceStreet(t); return true; }
  t.turnIndex = nextActiveIndex(t, idx);
  if (t.turnIndex < 0) { advanceStreet(t); return true; }
  emitState(t);
  scheduleBotTurn(t);
  return true;
}

function preflopStrength(cards) {
  if (!cards || cards.length < 2) return 0;
  const a=rankValue(cards[0].r), b=rankValue(cards[1].r), hi=Math.max(a,b), lo=Math.min(a,b);
  let s=(hi+lo)/28;
  if (a===b) s += .32 + hi/60;
  if (cards[0].s===cards[1].s) s += .08;
  if (Math.abs(a-b)<=2) s += .06;
  if (hi>=13) s += .08;
  return Math.min(1,s);
}

function botDecision(t, p) {
  const callDue = Math.max(0, t.currentBet - p.bet);
  const stack = p.chips;
  let strength;
  if (t.community.length >= 3) {
    const score = bestScore([...p.cards, ...t.community]);
    strength = Math.min(1, (score[0] / 8) * .8 + ((score[1] || 7) / 14) * .2);
    if (score[0] === 0) strength *= .55;
  } else strength = preflopStrength(p.cards);

  strength = Math.max(0, Math.min(1, strength + (Math.random()-.5)*.16));
  const pressure = callDue / Math.max(1, stack + p.bet);

  if (callDue === 0) {
    if (stack > 0 && strength > .68 && Math.random() < .62) {
      const target = t.currentBet + Math.max(t.minRaise, t.bigBlind * (1 + Math.floor(Math.random()*3)));
      return { action:'raise', amount: Math.min(p.bet+stack, target) };
    }
    return { action:'check' };
  }

  if (strength < .28 && pressure > .06 && Math.random() < .82) return { action:'fold' };
  if (strength < .43 && pressure > .18 && Math.random() < .7) return { action:'fold' };

  if (stack > callDue && strength > .72 && Math.random() < .58) {
    const multiplier = strength > .9 ? 4 : 2 + Math.floor(Math.random()*2);
    const target = t.currentBet + Math.max(t.minRaise, t.bigBlind*multiplier);
    return { action:'raise', amount: Math.min(p.bet+stack, target) };
  }
  return { action:'call' };
}

function scheduleBotTurn(t) {
  clearTimeout(t.botTimer);
  if (['waiting','showdown'].includes(t.phase)) return;
  const p = t.players[t.turnIndex];
  if (!p?.isBot) return;
  const token = t.handToken;
  t.botTimer = setTimeout(() => {
    if (!tables.has(t.id) || token !== t.handToken) return;
    const current = t.players[t.turnIndex];
    if (!current?.isBot || current.id !== p.id) return;
    const d = botDecision(t, current);
    takeAction(t, current, d.action, d.amount);
  }, 650 + Math.floor(Math.random()*850));
}

function uniqueBotName(t) {
  for (const base of BOT_NAMES) if (!t.players.some(p => p.name === base)) return base;
  return `Bot ${t.players.filter(p=>p.isBot).length+1}`;
}

io.on('connection', socket => {
  socket.on('createTable', ({ name }, cb) => {
    let id; do { id = roomId(); } while (tables.has(id));
    const t = createTable(id); tables.set(id, t);
    const p = makePlayer(socket.id, name || 'Joueur');
    t.players.push(p); t.hostId = p.id;
    socket.join(id); socket.join(socket.id); socket.data.tableId=id;
    emitState(t); cb?.({ ok:true, id });
  });

  socket.on('joinTable', ({ id, name }, cb) => {
    const t = getTable(id);
    if (!t) return cb?.({ ok:false, error:'Table introuvable.' });
    if (t.players.length >= 10) return cb?.({ ok:false, error:'Table complète (10 places).' });
    if (!['waiting','showdown'].includes(t.phase)) return cb?.({ ok:false, error:'Une main est en cours. Réessaie dans quelques secondes.' });
    const p = makePlayer(socket.id, name || 'Joueur');
    t.players.push(p); if (!t.hostId) t.hostId = p.id;
    socket.join(t.id); socket.join(socket.id); socket.data.tableId=t.id;
    emitState(t); cb?.({ ok:true, id:t.id });
  });

  socket.on('addBot', (_data, cb) => {
    const t=getTable(socket.data.tableId);
    if(!t || t.hostId!==socket.id) return cb?.({ok:false,error:'Seul le créateur peut ajouter un bot.'});
    if(t.players.length>=10) return cb?.({ok:false,error:'Table complète (10 places).'});
    if(!['waiting','showdown'].includes(t.phase)) return cb?.({ok:false,error:'Ajoute les bots entre deux mains.'});
    const bot=makePlayer(botId(), uniqueBotName(t), true);
    t.players.push(bot); emitState(t); cb?.({ok:true});
  });

  socket.on('removeBot', ({ id }, cb) => {
    const t=getTable(socket.data.tableId);
    if(!t || t.hostId!==socket.id) return cb?.({ok:false,error:'Action non autorisée.'});
    if(!['waiting','showdown'].includes(t.phase)) return cb?.({ok:false,error:'Retire les bots entre deux mains.'});
    const i=t.players.findIndex(p=>p.id===id && p.isBot);
    if(i<0) return cb?.({ok:false,error:'Bot introuvable.'});
    t.players.splice(i,1);
    if(t.dealerIndex>=t.players.length) t.dealerIndex=-1;
    emitState(t); cb?.({ok:true});
  });

  socket.on('startGame', () => {
    const t=getTable(socket.data.tableId); if(!t || t.hostId!==socket.id) return;
    if(['waiting','showdown'].includes(t.phase)) startHand(t);
  });

  socket.on('action', ({ action, amount }) => {
    const t=getTable(socket.data.tableId); if(!t) return;
    const p=t.players.find(x=>x.id===socket.id); if(!p) return;
    takeAction(t,p,action,amount);
  });

  socket.on('disconnect', () => {
    const t=getTable(socket.data.tableId); if(!t) return;
    const p=t.players.find(x=>x.id===socket.id); if(!p) return;
    p.connected=false;
    if(p.inHand) { p.folded=true; p.acted=true; }
    const humansConnected=t.players.filter(x=>!x.isBot && x.connected);
    if (!humansConnected.length) {
      clearTimeout(t.botTimer); clearTimeout(t.handTimer); tables.delete(t.id); return;
    }
    if(t.hostId===p.id) t.hostId=humansConnected[0].id;
    if (p.inHand && awardIfSingle(t)) return;
    if (t.turnIndex === t.players.indexOf(p)) {
      t.turnIndex = nextActiveIndex(t, t.turnIndex);
      if (t.turnIndex < 0 || everyoneSettled(t)) advanceStreet(t);
      else { emitState(t); scheduleBotTurn(t); }
    } else emitState(t);
  });
});

function cleanName(name) {
  const s=String(name||'Joueur').trim().replace(/[<>]/g,'').slice(0,18);
  return s || 'Joueur';
}

server.listen(PORT, () => console.log(`Poker en ligne : http://localhost:${PORT}`));
