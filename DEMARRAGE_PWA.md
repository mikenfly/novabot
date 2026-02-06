# PWA Web Interface

Interface web pour discuter avec NanoClaw depuis iOS ou n'importe quel navigateur.

## Démarrage Ultra-Rapide ⚡

```bash
npm start
```

C'est tout ! 🎉

NanoClaw va automatiquement :
1. ✅ Configurer Tailscale Funnel (si disponible)
2. ✅ Générer un token d'accès
3. ✅ Afficher un QR code

**Scannez le QR code avec votre iPhone** → vous êtes connecté !

## Setup Initial Tailscale (une seule fois)

Si c'est la première fois avec Tailscale Funnel :

```bash
sudo tailscale set --operator=$USER
```

Puis relancez `npm start`

## Accès Manuel

Si pas de QR code (pas de Tailscale) :

**Réseau local** :
```bash
hostname -I | awk '{print $1}'  # Obtenir IP
# Puis http://[IP]:3000 dans Safari
```

**Token** :
Le token est généré automatiquement au premier démarrage.
Pour en créer un nouveau : `node scripts/generate-token.js`

## Installation sur iOS

1. Scannez le QR code ou ouvrez l'URL
2. Menu Partager → "Sur l'écran d'accueil"
3. Fini !

## Icônes (optionnel)

Placez `icon-192.png` et `icon-512.png` dans `public/`
Voir `public/CREATE_ICONS.txt` pour les options

## Configuration

```bash
export WEB_PORT=8080        # Changer le port (défaut: 3000)
export WEB_ENABLED=false    # Désactiver la PWA
```

## Fonctionnalités

- Messages synchronisés avec WhatsApp en temps réel
- Pas besoin de @Jimmy - réponses automatiques
- Rendu markdown avec code formaté
- Notifications push natives
- Fonctionne hors ligne
