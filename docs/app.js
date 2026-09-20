const $ = s => document.querySelector(s);
const lobby=$('#lobby'), game=$('#game'), nameEl=$('#name'), roomEl=$('#room'), errorEl=$('#error');
let state=null, myId=null, myCards=[], showdownCards={};
let socket=null;

const savedName = localStorage.getItem('pokerName');
if(savedName) nameEl.value=savedName;
const urlRoom = new URLSearchParams(location.search).get('table');
if(urlRoom) roomEl.value=urlRoom.toUpperCase();

function showError(x){ errorEl.textContent=x||'Une erreur est survenue.'; }
function setLobbyEnabled(enabled){
  $('#create').disabled=!enabled;
  $('#join').disabled=!enabled;
}

// Sur GitHub Pages, l'interface est statique : elle se connecte au serveur
// Node.js indiqué dans config.js. En local/Render, elle utilise automatiquement
// l'adresse courante si aucune URL n'est configurée.
const configuredServer = String(window.POKER_SERVER_URL || '').trim().replace(/\/$/, '');
const onGitHubPages = location.hostname.endsWith('github.io');
const serverUrl = configuredServer || (onGitHubPages ? '' : location.origin);

if (typeof io !== 'function') {
  setLobbyEnabled(false);
  showError("La bibliothèque temps réel n'a pas pu être chargée. Vérifie ta connexion Internet puis recharge la page.");
} else if (!serverUrl) {
  setLobbyEnabled(false);
  showError("GitHub Pages est prêt, mais l'adresse du serveur de jeu manque. Ouvre docs/config.js et renseigne window.POKER_SERVER_URL avec l'adresse de ton serveur Render.");
} else {
  socket = io(serverUrl, { timeout: 8000, reconnection: true, reconnectionAttempts: 10, transports: ['websocket','polling'] });
  socket.on('connect',()=>{ setLobbyEnabled(true); if(errorEl.textContent.startsWith('Serveur non connecté')) showError(''); });
  socket.on('connect_error',()=>{
    setLobbyEnabled(false);
    showError(`Impossible de joindre le serveur de jeu (${serverUrl}). Vérifie l'adresse dans docs/config.js et que le serveur est bien en ligne.`);
  });
  socket.on('disconnect',()=>{
    if(!game.classList.contains('hidden')) showGameError('Connexion au serveur perdue… tentative de reconnexion.');
  });

  socket.on('private',data=>{myId=data.playerId;myCards=data.cards||[];render();});
  socket.on('state',s=>{state=s;render();});
  socket.on('showdown',d=>{showdownCards={};for(const p of d.players||[])showdownCards[p.id]=p.cards;render();setTimeout(()=>{showdownCards={};render()},3900)});
}

$('#create').onclick=()=>{
  if(!socket?.connected) return showError('Serveur de jeu non connecté. Vérifie docs/config.js ou le déploiement Render.');
  rememberName();
  $('#create').disabled=true;
  socket.timeout(8000).emit('createTable',{name:nameEl.value},(err,res)=>{
    $('#create').disabled=false;
    if(err) return showError('Le serveur ne répond pas. Vérifie le déploiement Node.js.');
    if(!res?.ok)return showError(res?.error||'Création impossible.');
    enter(res.id);
  });
};
$('#join').onclick=()=>join(roomEl.value);
nameEl.addEventListener('keydown',e=>{if(e.key==='Enter' && roomEl.value) join(roomEl.value)});
roomEl.addEventListener('keydown',e=>{if(e.key==='Enter') join(roomEl.value)});

function rememberName(){ localStorage.setItem('pokerName',(nameEl.value||'Joueur').trim()); }
function join(id){
  if(!socket?.connected) return showError('Serveur de jeu non connecté. Vérifie docs/config.js ou le déploiement Render.');
  rememberName();
  const code=String(id||'').trim().toUpperCase();
  if(!code) return showError('Entre le code de la table.');
  socket.timeout(8000).emit('joinTable',{id:code,name:nameEl.value},(err,res)=>{
    if(err)return showError('Le serveur ne répond pas.');
    if(!res?.ok)return showError(res?.error||'Impossible de rejoindre la table.');
    enter(res.id);
  });
}
function enter(id){ history.replaceState(null,'',`?table=${id}`); lobby.classList.add('hidden'); game.classList.remove('hidden'); $('#tableId').textContent=id; showError(''); }
function showGameError(x){const el=$('#gameError');el.textContent=x||'';clearTimeout(showGameError.t);showGameError.t=setTimeout(()=>el.textContent='',2800)}

$('#start').onclick=()=>socket?.emit('startGame');
$('#addBot').onclick=()=>socket?.emit('addBot',{},res=>{if(!res?.ok)showGameError(res?.error)});
$('#copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(state?.id||'');flashButton($('#copyCode'),'Code copié ✓','Copier le code')}catch{}};
$('#share').onclick=async()=>{
  const link=location.href;
  try{
    if(navigator.share) await navigator.share({title:'Rejoins ma table de poker',text:`Table ${state?.id||''}`,url:link});
    else { await navigator.clipboard.writeText(link);flashButton($('#share'),'Lien copié ✓','Partager'); }
  }catch{}
};
function flashButton(el,label,back){const old=el.textContent;el.textContent=label;setTimeout(()=>el.textContent=back||old,1400)}

document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
  if(!socket?.connected) return showGameError('Serveur non connecté.');
  const action=b.dataset.action, amount=Number($('#raiseAmount').value)||0;
  socket.emit('action',{action,amount});
});

function cardHtml(c){if(!c)return '';const red=c.s==='♥'||c.s==='♦';return `<div class="card ${red?'red':''}"><span>${c.r}</span><small>${c.s}</small></div>`}
function backCards(){return '<div class="miniBack"></div><div class="miniBack second"></div>'}

function render(){
  if(!state)return;
  $('#phase').textContent=phaseName(state.phase)+(state.handNumber?` • Main ${state.handNumber}`:'');
  $('#pot').textContent=state.pot;
  $('#message').textContent=state.message||'';
  $('#community').innerHTML=(state.community||[]).map(cardHtml).join('');
  $('#myCards').innerHTML=(myCards||[]).map(cardHtml).join('') || '<div class="waitingCards">En attente de la prochaine main</div>';
  $('#seatCount').textContent=`${state.players.length}/${state.maxPlayers||10}`;

  const me=state.players.find(p=>p.id===myId);
  const isHost=myId===state.hostId;
  const between=['waiting','showdown'].includes(state.phase);
  $('#hostControls').classList.toggle('hidden',!(isHost && between));
  $('#addBot').disabled=state.players.length>=10;

  const start=$('#start');
  start.classList.toggle('hidden',!(isHost && between));
  start.disabled=state.players.filter(p=>p.connected||p.isBot).length<2;
  start.textContent=state.phase==='showdown'?'Nouvelle main':'Démarrer la partie';

  const canAct=!!me?.isTurn && !me.folded && !me.allIn && !between;
  $('#actions').classList.toggle('disabled',!canAct);
  const callDue=me?Math.max(0,state.currentBet-me.bet):0;
  document.querySelector('[data-action="call"]').textContent=`Suivre ${callDue}`;
  document.querySelector('[data-action="check"]').style.display=callDue===0?'':'none';
  document.querySelector('[data-action="call"]').style.display=callDue>0?'':'none';
  const minRaise=Math.max(state.currentBet+state.minRaise,state.bigBlind);
  $('#raiseAmount').min=minRaise;
  const maxRaise=me?me.bet+me.chips:minRaise;
  $('#raiseAmount').max=Math.max(minRaise,maxRaise);
  if(Number($('#raiseAmount').value)<minRaise) $('#raiseAmount').value=minRaise;

  const box=$('#players');box.innerHTML='';const n=Math.max(1,state.players.length);
  state.players.forEach((p,i)=>{
    const a=(Math.PI*2*i/n)-Math.PI/2;
    const rx=window.innerWidth<720?43:44, ry=window.innerWidth<720?42:40;
    const x=50+rx*Math.cos(a), y=50+ry*Math.sin(a);
    const el=document.createElement('div');
    el.className=`player ${p.isTurn?'turn':''} ${p.folded?'folded':''} ${!p.connected&&!p.isBot?'offline':''}`;
    el.style.left=x+'%';el.style.top=y+'%';
    const revealed=showdownCards[p.id];
    const remove=(isHost&&p.isBot&&between)?`<button class="removeBot" title="Retirer ce bot" data-bot="${p.id}">×</button>`:'';
    const hiddenHand=(p.inHand&&!revealed)?`<div class="hiddenHand">${backCards()}</div>`:'';
    el.innerHTML=`${revealed?`<div class="revealCards">${revealed.map(cardHtml).join('')}</div>`:hiddenHand}<div class="playerBox">${remove}<div class="avatar ${p.isBot?'botAvatar':''}">${p.isBot?'🤖':escapeHtml((p.name[0]||'?').toUpperCase())}</div><div class="playerName"><strong>${escapeHtml(p.name)}</strong>${p.isBot?'<span class="botTag">BOT</span>':''}${p.isDealer?'<span class="dealer">D</span>':''}</div><div class="chips">${p.chips} jetons</div>${p.bet?`<div class="bet">Mise ${p.bet}</div>`:''}${p.allIn?'<div class="allin">ALL-IN</div>':''}${!p.connected&&!p.isBot?'<div class="offlineText">Déconnecté</div>':''}</div>`;
    box.appendChild(el);
  });
  box.querySelectorAll('.removeBot').forEach(btn=>btn.onclick=e=>{e.stopPropagation();socket?.emit('removeBot',{id:btn.dataset.bot},res=>{if(!res?.ok)showGameError(res?.error)})});
}
function phaseName(p){return({waiting:'En attente',preflop:'Pré-flop',flop:'Flop',turn:'Turn',river:'River',showdown:'Abattage'})[p]||p}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
