# Poker privé — version GitHub + multijoueur

Cette version est organisée pour fonctionner avec **un seul dépôt GitHub** :

- `docs/` = interface hébergée gratuitement avec **GitHub Pages**
- `server.js` = serveur temps réel Node.js / Socket.IO
- `render.yaml` = configuration pratique pour héberger le serveur sur **Render**

## Important

GitHub Pages ne peut pas exécuter Node.js ni Socket.IO côté serveur. Pour le vrai multijoueur par lien, il faut donc :

1. mettre tout ce dossier dans un dépôt GitHub ;
2. activer GitHub Pages sur le dossier `/docs` ;
3. connecter le même dépôt à Render pour démarrer `server.js` ;
4. copier l'URL Render dans `docs/config.js`.

## 1 — Envoyer sur GitHub

Crée un dépôt GitHub, par exemple `poker-online`, puis envoie **tout le contenu de ce dossier** à la racine du dépôt.

Le dépôt doit ressembler à :

```text
poker-online/
├── docs/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── config.js
├── server.js
├── package.json
├── render.yaml
├── .gitignore
└── README.md
```

## 2 — Activer GitHub Pages

Dans GitHub :

**Settings → Pages → Build and deployment → Deploy from a branch**

Puis choisis :

- Branch : `main`
- Folder : `/docs`

GitHub donnera ensuite une adresse de ce type :

`https://TON-COMPTE.github.io/poker-online/`

## 3 — Mettre le serveur multijoueur sur Render

Dans Render :

- crée un **Web Service** ;
- sélectionne le même dépôt GitHub ;
- Build command : `npm install`
- Start command : `npm start`

Render donnera une adresse ressemblant à :

`https://poker-online-xxxx.onrender.com`

Teste :

`https://poker-online-xxxx.onrender.com/health`

Tu dois obtenir :

```json
{"ok":true}
```

## 4 — Relier GitHub Pages au serveur

Ouvre `docs/config.js` sur GitHub et remplace :

```js
window.POKER_SERVER_URL = "";
```

par :

```js
window.POKER_SERVER_URL = "https://poker-online-xxxx.onrender.com";
```

Enregistre/commit la modification. Quelques instants plus tard, recharge ton GitHub Pages.

## 5 — Jouer

Depuis la page GitHub :

- choisis ton pseudo ;
- clique sur **Créer une table** ;
- ajoute des bots si tu joues seul ;
- ou utilise **Partager** pour envoyer le lien de la table ;
- 2 à 10 places sont disponibles.

Les cartes privées ne sont envoyées qu'au joueur concerné. Le pot, les mises et les cartes communes sont synchronisés par le serveur.

## Test en local

```bash
npm install
npm start
```

Puis ouvre :

`http://localhost:3000`

## Correction Safari / GitHub Pages

Cette version ne dépend plus d'un CDN externe pour Socket.IO. La bibliothèque temps réel est chargée directement depuis l'adresse Render définie dans `docs/config.js`. Si le message indique que le serveur temps réel est inaccessible, vérifiez d'abord que l'URL Render est exacte et que le service Render est en ligne.
