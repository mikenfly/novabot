# Architecture - Documentation technique

Documentation technique complète pour développeurs et contributeurs.

## 📚 Table des matières

### Vue d'ensemble
- **[Overview](overview.md)** - Architecture globale, diagrammes système, technology stack

### Composants principaux
- **[Channels](channels.md)** - Architecture modulaire des channels (PWA, WhatsApp)
- **[Containers](containers.md)** - Docker/Apple Container, isolation, lifecycle
- **[Authentication](authentication.md)** - Système de tokens, device management
- **[Database](database.md)** - SQLite, stockage messages, sessions
- **[IPC](ipc.md)** - Inter-process communication, task scheduling

### Sécurité
- **[Security](security.md)** - Isolation conteneurs, mount security, IPC namespacing

## 🎯 Pour commencer

**Nouveau développeur ?**
Commencez par [Overview](overview.md) pour comprendre l'architecture globale.

**Ajouter un channel ?**
Consultez [Channels](channels.md) pour voir comment les channels sont implémentés.

**Contribuer à la sécurité ?**
Lisez [Security](security.md) pour comprendre le modèle de sécurité.

## 🔧 Développement

### Setup développement

```bash
git clone https://github.com/gavrielc/novabot.git
cd novabot
npm install
npm run build
npm run dev    # Hot reload
```

### Structure du code

```
src/
├── index.ts                # Router principal
├── config.ts               # Configuration globale
├── channels-config.ts      # Loader channels.yaml
├── pwa-channel.ts          # Logic PWA
├── web-server.ts           # API REST + WebSocket
├── auth.ts                 # Authentification
├── container-runner.ts     # Exécution agent
├── db.ts                   # SQLite
└── task-scheduler.ts       # Tâches programmées
```

### Tests

```bash
npm test                    # (À implémenter)
npm run typecheck          # Vérification TypeScript
```

## 🤝 Contribution

Voir [CONTRIBUTING.md](../../CONTRIBUTING.md) pour :
- Guidelines de code
- Process PR
- Style guide

## 📖 Documentation complémentaire

- [README.md](../../README.md) - Vue d'ensemble du projet
- [CLAUDE.md](../../CLAUDE.md) - Instructions pour Claude Code
- [Guides utilisateur](../index.md) - Documentation utilisateur
