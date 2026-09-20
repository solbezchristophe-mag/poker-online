const $ = s => document.querySelector(s);
const lobby=$('#lobby'), game=$('#game'), nameEl=$('#name'), roomEl=$('#room'), errorEl=$('#error');
let state=null, myId=null, myCards=[], showdownCards={}, socket=null, preAction='';
const settings={fourColor:false,animations:true,sounds:true,compact:false,...JSON.parse(localStorage.getItem('pokerUiSettings')||'{}')};

const savedName=localStorage.getItem('pokerName'); if(savedName) nameEl.value=savedName;
const urlRoom=new URLSearchParams(location.search).get('table'); if(urlRoom) roomEl.value=urlRoom.toUpperCase();
function showError(x){errorEl.textContent=x||''} function setLobbyEnabled(v){$('#create').disabled=!v;$('#join').disabled=!v}
const configuredServer=String(window.POKER_SERVER_URL||'').trim().replace(/\/$/,'');
const onGitHubPages=location.hostname.endsWith('github.io');
const serverUrl=configuredServer||(onGitHubPages?'':location.origin);

if(typeof io!=='function'){setLobbyEnabled(false);showError("La connexion temps réel n'a pas pu démarrer. Vérifie ton serveur Render puis recharge la page.")}
else if(!serverUrl){setLobbyEnabled(false);showError("L'adresse du serveur de jeu manque dans docs/config.js.")}
else{
  socket=io(serverUrl,{timeout:8000,reconnection:true,reconnectionAttempts:10,transports:['websocket','polling']});
  socket.on('connect',()=>{setLobbyEnabled(true);showError('')});
  socket.on('connect_error',()=>{setLobbyEnabled(false);showError(`Impossible de joindre le serveur de jeu (${serverUrl}).`)});
  socket.on('disconnect',()=>{if(!game.classList.contains('hidden'))showGameError('Connexion perdue… reconnexion en cours.')});
  socket.on('private',d=>{myId=d.playerId;myCards=d.cards||[];render()});
  socket.on('state',s=>{const oldHand=state?.handNumber;state=s;if(oldHand&&s.handNumber!==oldHand)playTone('deal');render();applyPreActionIfPossible()});
  socket.on('showdown',d=>{showdownCards={};for(const p of d.players||[])showdownCards[p.id]=p.cards;render();setTimeout(()=>{showdownCards={};render()},3900)});
}

$('#create').onclick=()=>{requestPreferredFullscreen();if(!socket?.connected)return showError('Serveur de jeu non connecté.');rememberName();$('#create').disabled=true;socket.timeout(8000).emit('createTable',{name:nameEl.value},(err,res)=>{$('#create').disabled=false;if(err)return showError('Le serveur ne répond pas.');if(!res?.ok)return showError(res?.error||'Création impossible.');enter(res.id)})};
$('#join').onclick=()=>join(roomEl.value); nameEl.addEventListener('keydown',e=>{if(e.key==='Enter'&&roomEl.value)join(roomEl.value)}); roomEl.addEventListener('keydown',e=>{if(e.key==='Enter')join(roomEl.value)});
function rememberName(){localStorage.setItem('pokerName',(nameEl.value||'Joueur').trim())}
function join(id){requestPreferredFullscreen();if(!socket?.connected)return showError('Serveur de jeu non connecté.');rememberName();const code=String(id||'').trim().toUpperCase();if(!code)return showError('Entre le code de la table.');socket.timeout(8000).emit('joinTable',{id:code,name:nameEl.value},(err,res)=>{if(err)return showError('Le serveur ne répond pas.');if(!res?.ok)return showError(res?.error||'Impossible de rejoindre la table.');enter(res.id)})}
function enter(id){history.replaceState(null,'',`?table=${id}`);lobby.classList.add('hidden');game.classList.remove('hidden');$('#tableId').textContent=id;showError('');playTone('click');syncViewport();requestPreferredFullscreen()}
function showGameError(x){const el=$('#gameError');el.textContent=x||'';clearTimeout(showGameError.t);showGameError.t=setTimeout(()=>el.textContent='',2600)}

$('#start').onclick=()=>{socket?.emit('startGame');playTone('click')};
$('#addBot').onclick=()=>socket?.emit('addBot',{},res=>{if(!res?.ok)showGameError(res?.error);else playTone('click')});
$('#copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(state?.id||'');flashButton($('#copyCode'),'✓','#')}catch{}};
$('#share').onclick=async()=>{const link=location.href;try{if(navigator.share)await navigator.share({title:'Rejoins ma table de poker',text:`Table ${state?.id||''}`,url:link});else{await navigator.clipboard.writeText(link);flashButton($('#share'),'✓','↗')}}catch{}};
function flashButton(el,label,back){el.textContent=label;setTimeout(()=>el.textContent=back,1100)}

function emitAction(action,amount){if(!socket?.connected)return showGameError('Serveur non connecté.');preAction='';updatePreActionUi();socket.emit('action',{action,amount});playTone('action')}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>emitAction(b.dataset.action,Number($('#raiseAmount').value)||0));

const suitClass=s=>s==='♥'?'suit-heart':s==='♦'?'suit-diamond':s==='♣'?'suit-club':'suit-spade';
function cardHtml(c){if(!c)return'';return `<div class="card ${suitClass(c.s)}"><span class="corner"><b>${c.r}</b><small>${c.s}</small></span><span class="suitCenter">${c.s}</span><span class="corner bottom"><b>${c.r}</b><small>${c.s}</small></span></div>`}
function backCards(){return '<div class="miniBack"></div><div class="miniBack second"></div>'}

function betBounds(){const me=state?.players.find(p=>p.id===myId);if(!state||!me)return{min:20,max:20};const min=Math.max(state.currentBet+state.minRaise,state.bigBlind),max=Math.max(min,me.bet+me.chips);return{min,max}}
function setRaise(v){const {min,max}=betBounds();v=Math.max(min,Math.min(max,Math.round(Number(v||min)/Math.max(1,state?.bigBlind/2||10))*Math.max(1,state?.bigBlind/2||10)));$('#raiseAmount').min=min;$('#raiseAmount').max=max;$('#raiseAmount').value=v;$('#raiseLabel').textContent=v}
$('#raiseAmount').addEventListener('input',e=>{$('#raiseLabel').textContent=e.target.value});
$('#raiseMinus').onclick=()=>setRaise(Number($('#raiseAmount').value)-(state?.bigBlind||20));
$('#raisePlus').onclick=()=>setRaise(Number($('#raiseAmount').value)+(state?.bigBlind||20));
document.querySelectorAll('[data-raise-preset]').forEach(btn=>btn.onclick=()=>{if(!state)return;const me=state.players.find(p=>p.id===myId);if(!me)return;const {min,max}=betBounds();const due=Math.max(0,state.currentBet-me.bet);const effectivePot=Math.max(state.bigBlind,state.pot+due);let target=min;const p=btn.dataset.raisePreset;if(p==='third')target=state.currentBet+Math.max(state.minRaise,Math.round(effectivePot/3));if(p==='half')target=state.currentBet+Math.max(state.minRaise,Math.round(effectivePot*.5));if(p==='twothirds')target=state.currentBet+Math.max(state.minRaise,Math.round(effectivePot*2/3));if(p==='pot')target=state.currentBet+Math.max(state.minRaise,effectivePot);if(p==='allin')target=max;setRaise(Math.min(max,target));playTone('click')});

/* pre-actions */
document.querySelectorAll('[data-preaction]').forEach(btn=>btn.onclick=()=>{const p=btn.dataset.preaction;if(p==='clear')preAction='';else preAction=preAction===p?'':p;updatePreActionUi();playTone('click')});
function updatePreActionUi(){document.querySelectorAll('[data-preaction]').forEach(b=>b.classList.toggle('selected',b.dataset.preaction===preAction))}
function applyPreActionIfPossible(){if(!preAction||!state||!myId)return;const me=state.players.find(p=>p.id===myId);if(!me?.isTurn||me.folded||me.allIn)return;const due=Math.max(0,state.currentBet-me.bet);const p=preAction;preAction='';updatePreActionUi();setTimeout(()=>{if(p==='fold')emitAction('fold');else if(p==='checkfold')emitAction(due===0?'check':'fold');else if(p==='call')emitAction(due===0?'check':'call')},90)}

/* fullscreen, PWA & viewport adaptatif */
function isStandalone(){return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true}
function syncViewport(){
  const vv=window.visualViewport; const w=Math.round(vv?.width||innerWidth),h=Math.round(vv?.height||innerHeight);
  document.documentElement.style.setProperty('--app-w',`${w}px`);document.documentElement.style.setProperty('--app-h',`${h}px`);
  document.body.classList.toggle('screen-phone',Math.min(w,h)<600);
  document.body.classList.toggle('screen-tablet',Math.min(w,h)>=600&&Math.max(w,h)<1400);
  document.body.classList.toggle('screen-desktop',Math.max(w,h)>=1400);
  document.body.classList.toggle('screen-landscape',w>h);document.body.classList.toggle('screen-portrait',h>=w);
  if(state)requestAnimationFrame(render);
}
async function requestPreferredFullscreen(){
  syncViewport(); if(isStandalone()||document.fullscreenElement)return;
  try{if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:'hide'})}catch{}
}
async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:'hide'});else showGameError('Sur iPhone/iPad, ajoute le jeu à l’écran d’accueil pour un vrai plein écran.')}catch{showGameError('Plein écran non disponible ici. Ajoute le jeu à l’écran d’accueil.')}}
$('#fullscreen').onclick=toggleFullscreen;$('#fullscreenFromSettings').onclick=toggleFullscreen;
document.addEventListener('fullscreenchange',()=>{syncViewport();$('#fullscreen').textContent='⛶'});
window.addEventListener('resize',syncViewport,{passive:true});window.addEventListener('orientationchange',()=>setTimeout(syncViewport,120),{passive:true});
window.visualViewport?.addEventListener('resize',syncViewport,{passive:true});window.visualViewport?.addEventListener('scroll',syncViewport,{passive:true});
syncViewport();

/* settings */
function saveSettings(){localStorage.setItem('pokerUiSettings',JSON.stringify(settings));applySettings()}
function applySettings(){document.body.classList.toggle('four-color',!!settings.fourColor);document.body.classList.toggle('animations-on',!!settings.animations);document.body.classList.toggle('compact-ui',!!settings.compact);$('#fourColor').checked=!!settings.fourColor;$('#animations').checked=!!settings.animations;$('#sounds').checked=!!settings.sounds;$('#compactMode').checked=!!settings.compact}
$('#settingsBtn').onclick=()=>$('#settingsModal').classList.remove('hidden');$('#settingsClose').onclick=()=>$('#settingsModal').classList.add('hidden');$('#settingsModal').addEventListener('click',e=>{if(e.target.id==='settingsModal')e.currentTarget.classList.add('hidden')});
[['fourColor','fourColor'],['animations','animations'],['sounds','sounds'],['compactMode','compact']].forEach(([id,key])=>$('#'+id).onchange=e=>{settings[key]=e.target.checked;saveSettings()});applySettings();
function playTone(kind){if(!settings.sounds)return;try{const AC=window.AudioContext||window.webkitAudioContext;playTone.ctx=playTone.ctx||new AC();const c=playTone.ctx,o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=kind==='deal'?520:kind==='action'?250:390;g.gain.setValueAtTime(.018,c.currentTime);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.055);o.start();o.stop(c.currentTime+.06)}catch{}}

function render(){
  if(!state)return;
  $('#phase').textContent=phaseName(state.phase)+(state.handNumber?` • Main ${state.handNumber}`:'');
  $('#blindsLabel').textContent=`${state.smallBlind} / ${state.bigBlind}`;$('#pot').textContent=state.pot;$('#message').textContent=state.message||'';$('#community').innerHTML=(state.community||[]).map(cardHtml).join('');$('#myCards').innerHTML=(myCards||[]).map(cardHtml).join('')||'<div class="waitingCards">En attente</div>';$('#seatCount').textContent=`${state.players.length}/${state.maxPlayers||10}`;
  const me=state.players.find(p=>p.id===myId),isHost=myId===state.hostId,between=['waiting','showdown'].includes(state.phase);$('#hostControls').classList.toggle('hidden',!(isHost&&between));$('#addBot').disabled=state.players.length>=10;
  const start=$('#start');start.classList.toggle('hidden',!(isHost&&between));start.disabled=state.players.filter(p=>p.connected||p.isBot).length<2;start.textContent=state.phase==='showdown'?'Nouvelle main':'Démarrer la partie';
  const canAct=!!me?.isTurn&&!me.folded&&!me.allIn&&!between,waitingToAct=!!me?.inHand&&!me.folded&&!me.allIn&&!between&&!me.isTurn;$('#actions').classList.toggle('hidden',!canAct);$('#actions').classList.remove('disabled');$('#preActions').classList.toggle('hidden',!waitingToAct);if(between){$('#actions').classList.add('hidden');$('#preActions').classList.add('hidden')}
  const due=me?Math.max(0,state.currentBet-me.bet):0;$('#callAmount').textContent=due>0?due:'';document.querySelector('[data-action="check"]').style.display=due===0?'':'none';document.querySelector('[data-action="call"]').style.display=due>0?'':'none';$('#raiseVerb').textContent=state.currentBet>0?'Relancer':'Miser';setRaise(Math.max(Number($('#raiseAmount').value)||0,betBounds().min));
  const box=$('#players');box.innerHTML='';const n=Math.max(1,state.players.length);const myIndex=Math.max(0,state.players.findIndex(p=>p.id===myId));state.players.forEach((p,i)=>{const relative=(i-myIndex+n)%n;const a=Math.PI/2+(Math.PI*2*relative/n);const vw=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-w'))||innerWidth;const vh=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h'))||innerHeight;const portrait=vh>vw&&vw<700;const rx=portrait?44:45,ry=portrait?39:41,x=50+rx*Math.cos(a),y=50+ry*Math.sin(a);const el=document.createElement('div');el.className=`player ${p.id===myId?'me':''} ${p.isTurn?'turn':''} ${p.folded?'folded':''} ${!p.connected&&!p.isBot?'offline':''}`;el.style.left=x+'%';el.style.top=y+'%';const inward=portrait?48:54;el.style.setProperty('--in-x',`${-Math.cos(a)*inward}px`);el.style.setProperty('--in-y',`${-Math.sin(a)*inward}px`);const revealed=showdownCards[p.id],remove=(isHost&&p.isBot&&between)?`<button class="removeBot" title="Retirer ce bot" data-bot="${p.id}">×</button>`:'',hiddenHand=(p.inHand&&!revealed)?`<div class="hiddenHand">${backCards()}</div>`:'';el.innerHTML=`${revealed?`<div class="revealCards">${revealed.map(cardHtml).join('')}</div>`:hiddenHand}<div class="playerBox">${remove}<div class="avatar ${p.isBot?'botAvatar':''}">${p.isBot?'BOT':escapeHtml((p.name[0]||'?').toUpperCase())}</div><div class="playerName"><strong>${escapeHtml(p.name)}</strong>${p.isBot?'<span class="botTag">BOT</span>':''}${p.isDealer?'<span class="dealer">D</span>':''}</div><div class="chips">${p.chips}</div>${p.allIn?'<div class="allin">ALL-IN</div>':''}${!p.connected&&!p.isBot?'<div class="offlineText">Hors ligne</div>':''}</div>${p.bet?`<div class="betChip">${p.bet}</div>`:''}`;box.appendChild(el)});box.querySelectorAll('.removeBot').forEach(btn=>btn.onclick=e=>{e.stopPropagation();socket?.emit('removeBot',{id:btn.dataset.bot},res=>{if(!res?.ok)showGameError(res?.error)})});
}
function phaseName(p){return({waiting:'En attente',preflop:'Pré-flop',flop:'Flop',turn:'Turn',river:'River',showdown:'Abattage'})[p]||p}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
