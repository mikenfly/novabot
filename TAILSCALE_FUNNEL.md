# Tailscale Funnel - Configuration Automatique

## C'est quoi ?

Tailscale Funnel expose votre PWA sur internet avec une adresse HTTPS fixe.

**Avantages** :
- ✅ Adresse HTTPS fixe qui ne change jamais
- ✅ Pas de port forwarding
- ✅ Fonctionne derrière n'importe quel firewall/NAT
- ✅ Gratuit et sans limite
- ✅ Certificat SSL automatique

## Setup (une seule fois)

```bash
sudo tailscale set --operator=$USER
```

## Utilisation

```bash
npm start
```

NanoClaw configure automatiquement Funnel et affiche un **QR code** !

## Votre URL

Format : `https://[machine].tail[xxx].ts.net:10000`

Pour la voir :
```bash
tailscale serve status
```

## Désactiver

```bash
tailscale funnel off
tailscale serve off
```

## Troubleshooting

**"Access denied"** : Exécutez `sudo tailscale set --operator=$USER`

**Pas de QR code** : Tailscale n'est pas configuré, l'app fonctionne quand même en local
