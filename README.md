# Ubiquitous - Bot de Trading Solana

Un bot de trading automatisé pour Solana qui surveille les nouvelles pools de liquidité Raydium et effectue des swaps automatiques via Jupiter.

## Prérequis

- Node.js (version 18 ou supérieure)
- npm ou yarn
- Une clé API Helius
- Un portefeuille Solana avec une clé privée

## Installation

1. Clonez le repository et naviguez dans le dossier :
```bash
cd C:\GithubProjects\ubiquitous
```

2. Installez les dépendances :
```bash
npm install
```

3. Configurez vos variables d'environnement :
   - Copiez le fichier `.env.example` vers `.env`
   - Remplissez les variables suivantes dans le fichier `.env` :

```env
PRIV_KEY_WALLET="votre_cle_privee_solana_en_base58"
HELIUS_HTTPS_URI="https://mainnet.helius-rpc.com/?api-key=VOTRE_CLE_API"
HELIUS_WSS_URI="wss://mainnet.helius-rpc.com/?api-key=VOTRE_CLE_API"
HELIUS_HTTPS_URI_TX="https://api.helius.xyz/v0/transactions/?api-key=VOTRE_CLE_API"
JUP_HTTPS_QUOTE_URI="https://quote-api.jup.ag/v6/quote"
JUP_HTTPS_SWAP_URI="https://quote-api.jup.ag/v6/swap"
```

## Utilisation

### Mode Développement
Pour lancer le bot en mode développement avec rechargement automatique :
```bash
npm run dev
```

### Mode Production
1. Compilez le projet :
```bash
npm run build
```

2. Lancez le bot :
```bash
npm start
```

## Configuration

Le fichier `src/config.ts` contient les paramètres configurables :

- **liquidity_pool** : Configuration pour la détection des pools
- **swap** : Montant et slippage pour les swaps (actuellement 0.01 SOL avec 2% de slippage)
- **rug_check** : Paramètres de vérification anti-rug pull

## Fonctionnalités

- ✅ Surveillance en temps réel des nouvelles pools Raydium
- ✅ Vérification anti-rug pull automatique
- ✅ Swaps automatiques via Jupiter
- ✅ Filtrage des tokens Pump.fun (optionnel)
- ✅ Gestion des erreurs et reconnexion automatique

## Sécurité

⚠️ **IMPORTANT** : 
- Ne jamais committer votre fichier `.env` avec vos clés privées
- Utilisez un portefeuille dédié avec un montant limité pour les tests
- Ce bot utilise des fonds réels - testez d'abord sur devnet

## Structure du Projet

```
src/
├── config.ts       # Configuration du bot
├── index.ts        # Point d'entrée principal
├── transactions.ts # Logique de transactions Solana
└── types.ts        # Définitions TypeScript
```

## Dépendances Principales

- `@coral-xyz/anchor` : Framework Solana
- `@solana/web3.js` : SDK Solana
- `ws` : Client WebSocket
- `axios` : Client HTTP
- `dotenv` : Gestion des variables d'environnement

## Support

Ce bot nécessite :
- Une clé API Helius pour l'accès RPC et WebSocket
- Des fonds SOL dans le portefeuille pour les transactions
- Une connexion internet stable
