(() => {
  const errorEl = document.getElementById('error');
  const createBtn = document.getElementById('create');
  const joinBtn = document.getElementById('join');

  function block(message) {
    if (createBtn) createBtn.disabled = true;
    if (joinBtn) joinBtn.disabled = true;
    if (errorEl) errorEl.textContent = message;
  }

  const configuredServer = String(window.POKER_SERVER_URL || '').trim().replace(/\/$/, '');
  const onGitHubPages = location.hostname.endsWith('github.io');
  const serverUrl = configuredServer || (onGitHubPages ? '' : location.origin);

  if (!serverUrl) {
    block("L'adresse du serveur de jeu manque. Ouvre docs/config.js sur GitHub et colle l'adresse de ton serveur Render.");
    return;
  }

  // Charge le client Socket.IO directement depuis le serveur de poker.
  // Cela évite les blocages possibles des CDN externes sur certains navigateurs/réseaux.
  const socketScript = document.createElement('script');
  socketScript.src = `${serverUrl}/socket.io/socket.io.js`;
  socketScript.async = true;
  socketScript.onload = () => {
    const appScript = document.createElement('script');
    appScript.src = 'app.js';
    appScript.async = false;
    appScript.onerror = () => block("Le programme du poker n'a pas pu être chargé. Recharge la page.");
    document.body.appendChild(appScript);
  };
  socketScript.onerror = () => {
    block(`Impossible de charger le serveur temps réel (${serverUrl}). Vérifie que Render est bien en ligne et que l'adresse dans docs/config.js est exacte.`);
  };
  document.body.appendChild(socketScript);
})();
