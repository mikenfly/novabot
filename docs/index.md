# NovaBot Documentation

Assistant personnel Claude via messagerie. Simple, sécurisé, extensible.

## 🎯 Philosophie

### Pourquoi NovaBot existe

Alternative légère et sécurisée aux systèmes de bots complexes. Pas de microservices, pas de configurations interminables, pas de processus multiples. Un seul processus Node.js, quelques fichiers sources, facile à comprendre.

### Principes fondamentaux

**Small Enough to Understand**
Le code complet est lisible et compréhensible. Un processus Node.js, une poignée de fichiers. Pas de microservices, pas de files de messages, pas de couches d'abstraction.

**Security Through True Isolation**
Au lieu de systèmes de permissions applicatifs, les agents tournent dans de vrais conteneurs Linux (Apple Container ou Docker). L'isolation est au niveau de l'OS. Les agents ne voient que ce qui est explicitement monté. Bash est sûr car les commandes s'exécutent dans le conteneur.

**Built for One User**
Pas un framework ou une plateforme. C'est du code qui fonctionne pour des besoins spécifiques. Ajoutez les intégrations que vous voulez vraiment, pas toutes les intégrations possibles.

**Customization = Code Changes**
Pas de configuration à rallonge. Si vous voulez un comportement différent, modifiez le code. Le code est assez petit pour que ce soit sûr et pratique.

**AI-Native Development**
Pas besoin d'assistant d'installation - Claude Code guide le setup. Pas besoin de dashboard monitoring - demandez à Claude ce qui se passe. Pas besoin d'UI de logs élaborées - Claude lit les logs. Le code assume que vous avez un collaborateur IA.

**Skills Over Features**
Les contributions devraient être des skills comme `/add-telegram` qui transforment le code, pas des features "support Telegram alongside WhatsApp". Les utilisateurs forkent, lancent des skills pour customiser, et se retrouvent avec du code propre qui fait exactement ce qu'ils veulent.

---

## 🚀 Démarrage

**Première utilisation ?**

→ [Guide de démarrage rapide](quickstart.md) (5 minutes)

## 📖 Documentation

### Essentiel

- **[Démarrage rapide](quickstart.md)** - Installation et premier setup
- **[Channels](channels.md)** - Interfaces disponibles (PWA, WhatsApp, etc.)

### Architecture technique

- **[Architecture](architecture/index.md)** - Documentation technique complète

## 🎯 Cas d'usage

### Usage personnel
Interface web moderne, pas besoin de WhatsApp
→ Voir [Channels - PWA](channels.md#pwa)

### Usage en équipe
Bot dans les groupes WhatsApp existants
→ Voir [Channels - WhatsApp](channels.md#whatsapp)

### Multi-interfaces
PWA + WhatsApp synchronisés
→ Voir [Channels - Configuration](channels.md#configuration)

## 🔗 Liens utiles

- [Repository GitHub](https://github.com/gavrielc/novabot)
- [Issues & Support](https://github.com/gavrielc/novabot/issues)
- [Contribution](../CONTRIBUTING.md)

## ⚡ Commandes rapides

```bash
npm start              # Démarrer NovaBot
npm run auth          # Authentifier WhatsApp
npm run build         # Recompiler
npm run dev           # Mode développement
```

## 📝 Organisation de la documentation

Cette documentation est organisée pour être facilement extensible :

- **Guides utilisateur** : `index.md`, `quickstart.md`, `channels.md`
- **Documentation technique** : `architecture/` (pour développeurs et contributeurs)
- **Ajout de features** : Mettre à jour le fichier approprié ou créer un nouveau dans `architecture/`
