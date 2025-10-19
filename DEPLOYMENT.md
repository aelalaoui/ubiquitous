# 🚀 Guide de Déploiement Gratuit - Bot de Trading Solana

Ce guide vous explique comment déployer votre bot de trading Solana gratuitement sur plusieurs plateformes cloud.

## 🎯 Options de Déploiement Gratuit

### 1. 🌟 Railway.app (Recommandé)
**Avantages :** 500h gratuites/mois, déploiement facile, excellent pour les bots
**Limites :** Après 500h, le service s'arrête jusqu'au mois suivant

#### Instructions Railway :
1. Créez un compte sur [railway.app](https://railway.app)
2. Connectez votre repository GitHub
3. Sélectionnez "Deploy from GitHub repo"
4. Ajoutez les variables d'environnement dans le dashboard :
   - `PRIV_KEY_WALLET` : Votre clé privée Solana (Base58)
   - `HELIUS_HTTPS_URI` : https://mainnet.helius-rpc.com/?api-key=VOTRE_CLE
   - `HELIUS_WSS_URI` : wss://mainnet.helius-rpc.com/?api-key=VOTRE_CLE
   - `HELIUS_HTTPS_URI_TX` : https://api.helius.xyz/v0/transactions/?api-key=VOTRE_CLE
5. Railway déploiera automatiquement votre bot

### 2. 🎨 Render.com
**Avantages :** Service toujours actif, bon uptime
**Limites :** Le service gratuit "dort" après 15min d'inactivité

#### Instructions Render :
1. Créez un compte sur [render.com](https://render.com)
2. Connectez votre repository GitHub
3. Sélectionnez "Web Service"
4. Utilisez ces paramètres :
   - **Build Command :** `npm ci && npm run build`
   - **Start Command :** `npm start`
5. Ajoutez les variables d'environnement dans l'onglet "Environment"

### 3. ☁️ Heroku (Plan Gratuit Limité)
**Note :** Heroku a supprimé son plan gratuit, mais offre parfois des crédits étudiants

#### Instructions Heroku :
1. Installez Heroku CLI
2. Connectez-vous : `heroku login`
3. Créez une app : `heroku create votre-bot-name`
4. Ajoutez les variables : `heroku config:set VARIABLE=valeur`
5. Déployez : `git push heroku main`

### 4. 🔥 Railway via Docker (Alternative)
Si vous préférez utiliser Docker :

```bash
# Construire l'image
docker build -t solana-bot .

# Lancer localement pour tester
docker run -d --env-file .env solana-bot
```

## ⚙️ Variables d'Environnement Requises

Pour tous les services, vous devez configurer :

```env
PRIV_KEY_WALLET=votre_cle_privee_base58
HELIUS_HTTPS_URI=https://mainnet.helius-rpc.com/?api-key=VOTRE_CLE_API
HELIUS_WSS_URI=wss://mainnet.helius-rpc.com/?api-key=VOTRE_CLE_API
HELIUS_HTTPS_URI_TX=https://api.helius.xyz/v0/transactions/?api-key=VOTRE_CLE_API
JUP_HTTPS_QUOTE_URI=https://quote-api.jup.ag/v6/quote
JUP_HTTPS_SWAP_URI=https://quote-api.jup.ag/v6/swap
```

## 🔧 Préparation du Code

Ajoutez un script de sanity check dans votre `package.json` :

```json
{
  "scripts": {
    "start": "node dist/index.js",
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "health": "node -e \"console.log('Bot is running')\""
  }
}
```

## 📊 Surveillance et Logs

### Railway :
- Logs disponibles dans le dashboard
- Métriques de CPU et mémoire incluses

### Render :
- Logs en temps réel dans le dashboard
- Alertes par email en cas d'erreur

## 🛡️ Sécurité

### Variables Sensibles :
1. **NE JAMAIS** committer le fichier `.env`
2. Utilisez des portefeuilles dédiés avec fonds limités
3. Surveillez régulièrement les transactions

### Recommandations :
- Créez un portefeuille séparé pour le bot
- Limitez les fonds (commencez avec 0.1-0.5 SOL)
- Activez les notifications par email sur vos services

## 🚨 Monitoring

Pour surveiller votre bot en production, ajoutez des logs :

```typescript
// Dans votre code principal
console.log(`[${new Date().toISOString()}] Bot started successfully`);
setInterval(() => {
  console.log(`[${new Date().toISOString()}] Bot heartbeat - Active`);
}, 300000); // Log toutes les 5 minutes
```

## 💰 Coûts

| Service | Gratuit | Limitations |
|---------|---------|-------------|
| Railway | 500h/mois | Service s'arrête après 500h |
| Render | Illimité* | Dort après 15min inactivité |
| Heroku | Crédits étudiants | Variable selon offres |

*Pour Render : Le service se réveille automatiquement sur activité WebSocket

## 📋 Checklist de Déploiement

- [ ] Code poussé sur GitHub
- [ ] Variables d'environnement configurées
- [ ] Clé API Helius obtenue
- [ ] Portefeuille de test créé avec fonds limités
- [ ] Service cloud choisi et configuré
- [ ] Premier déploiement testé
- [ ] Logs de surveillance vérifiés

## 🆘 Dépannage

### Bot se déconnecte souvent :
- Vérifiez vos crédits/limites du service cloud
- Surveillez les logs pour identifier les erreurs

### Erreurs WebSocket :
- Vérifiez votre clé API Helius
- Assurez-vous que l'URL WebSocket est correcte

### Transactions échouent :
- Vérifiez le solde de votre portefeuille
- Augmentez le slippage si nécessaire (dans config.ts)

## 🎉 Recommandation Finale

**Railway.app** est recommandé pour commencer car :
- Setup le plus simple
- 500h gratuites suffisent pour tester
- Excellent dashboard de monitoring
- Supporte nativement les WebSocket longues

Commencez par Railway, testez votre bot, puis migrez vers Render si vous avez besoin d'un uptime 24/7.
