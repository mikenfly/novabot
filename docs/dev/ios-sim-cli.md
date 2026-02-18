# `sim` — CLI Wrapper pour le contrôle du simulateur iOS

Wrapper léger au-dessus de `xcrun simctl`, `axe` et `xcodebuild`.
Objectifs : commandes simples, gestion du contexte, output réduit pour LLM.

## Prérequis

- macOS avec Xcode installé
- `axe` (`brew tap cameroncooke/axe && brew install axe`)
- `xcrun simctl` et `xcodebuild` (fournis avec Xcode)

---

## Commandes

### Simulateur

| Commande | Description | Outils sous-jacents |
|----------|-------------|---------------------|
| `sim list` | Liste les simulateurs disponibles (nom, UDID, état) | `simctl list` |
| `sim boot [name]` | Boot un simulateur (+ `open -a Simulator`) | `simctl boot` |
| `sim shutdown` | Éteint le simulateur actif | `simctl shutdown` |
| `sim status` | État du simulateur actif (booté, app au premier plan) | `simctl list` + filtre |

### Capture

| Commande | Description | Outils sous-jacents |
|----------|-------------|---------------------|
| `sim screenshot [path]` | Screenshot → fichier (défaut: `/tmp/sim-screenshot.png`) | `simctl io screenshot` |
| `sim record start` | Démarre l'enregistrement vidéo | `simctl io recordVideo` |
| `sim record stop` | Arrête l'enregistrement | kill du process |

### UI — Inspection

| Commande | Description | Outils sous-jacents |
|----------|-------------|---------------------|
| `sim ui` | Arbre d'accessibilité filtré (éléments interactifs) | `axe describe-ui` + filtre |
| `sim ui --full` | Arbre complet sans filtrage | `axe describe-ui` |
| `sim ui --at x,y` | Élément à un point précis | `axe describe-ui --point` |

### UI — Interactions

| Commande | Description | Outils sous-jacents |
|----------|-------------|---------------------|
| `sim tap <cible>` | Tap — par label, ID, ou coordonnées | `axe tap` |
| `sim tap --id loginBtn` | Tap par accessibility identifier | `axe tap --id` |
| `sim tap --label "Sign In"` | Tap par label visible | `axe tap --label` |
| `sim tap 200,400` | Tap par coordonnées x,y | `axe tap -x -y` |
| `sim longpress <cible>` | Appui long | `axe tap --duration` |
| `sim swipe <direction>` | Swipe (up/down/left/right) | `axe gesture scroll-*` |
| `sim swipe 100,400 100,100` | Swipe entre deux points | `axe swipe` |
| `sim type "texte"` | Saisie de texte | `axe type` |
| `sim key enter` | Touche clavier (enter, backspace, tab, escape) | `axe key` |
| `sim button home` | Bouton hardware (home, lock, siri) | `axe button` |

### App

| Commande | Description | Outils sous-jacents |
|----------|-------------|---------------------|
| `sim install <path>` | Installer un .app | `simctl install` |
| `sim launch [bundleId]` | Lancer l'app (utilise le contexte si pas de bundleId) | `simctl launch` |
| `sim kill [bundleId]` | Tuer l'app | `simctl terminate` |
| `sim open <url>` | Ouvrir une URL / deep link | `simctl openurl` |
| `sim permissions grant <perm>` | Accorder une permission (camera, photos, location...) | `simctl privacy grant` |

### Build

| Commande | Description | Outils sous-jacents |
|----------|-------------|---------------------|
| `sim build` | Build le scheme actif pour le simulateur actif | `xcodebuild build` |
| `sim build --scheme X` | Build un scheme spécifique | `xcodebuild build` |
| `sim test` | Lance les tests sur le simulateur actif | `xcodebuild test` |
| `sim run` | Build + install + launch en une commande | `xcodebuild` + `simctl` |
| `sim schemes` | Liste les schemes du projet | `xcodebuild -list` |

---

## Gestion du contexte

Un fichier `.sim-context.json` à la racine du projet stocke l'état courant :

```json
{
  "udid": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
  "device_name": "iPhone 16 Pro",
  "bundle_id": "com.novabot.app",
  "scheme": "NovaBotApp",
  "project_path": "/path/to/MyApp.xcodeproj",
  "workspace_path": null
}
```

**Règles :**
- `sim boot "iPhone 16 Pro"` → sauvegarde le UDID et le nom dans le contexte
- `sim launch com.example.app` → sauvegarde le bundle_id
- `sim build --scheme X` → sauvegarde le scheme
- Toutes les commandes utilisent le contexte si l'argument est omis
- `sim status` affiche le contexte courant
- `.sim-context.json` est dans `.gitignore`

**Détection automatique :**
- Au premier `sim build`, scanner le projet pour trouver `.xcodeproj` / `.xcworkspace`
- Si un seul scheme existe, le sélectionner automatiquement
- Si un seul simulateur est booté, l'utiliser automatiquement

---

## Filtrage de l'arbre d'accessibilité

`axe describe-ui` retourne un JSON potentiellement très gros (centaines d'éléments).
Pour un LLM, on filtre drastiquement.

### Stratégie de `sim ui` (mode filtré par défaut)

**Garder :**
- Éléments interactifs : boutons, liens, champs texte, switches, sliders, pickers
- Éléments avec un label ou un identifier non vide
- Éléments de texte statique visibles (pour comprendre le contexte de l'écran)
- Barre de navigation / titre de la page

**Exclure :**
- Éléments système (status bar, keyboard internals, UITransitionView...)
- Conteneurs purement structurels sans label (Group, Other sans texte)
- Éléments hors écran (frame.y < 0 ou frame.y > hauteur écran)
- Éléments de taille 0x0
- Doublons (même label + même rôle au même endroit)

### Format de sortie simplifié

Au lieu du JSON brut d'AXe, retourner un format compact :

```
[Screen: "Login"]

  [TextField] id=emailField label="Email" (20,200 360x44)
  [TextField] id=passwordField label="Password" (20,260 360x44)
  [Button] id=loginBtn label="Sign In" (20,330 360x50)
  [Button] label="Forgot Password?" (120,400 160x20)
  [Link] label="Create Account" (130,440 130x20)

  --- Keyboard visible ---
  [Key] label="q" [Key] label="w" [Key] label="e" ...
```

**Principes du format :**
- Une ligne par élément
- `[Type]` → rôle AX simplifié
- `id=X` si un accessibility identifier existe (préféré pour `sim tap --id`)
- `label="X"` le texte visible
- `(x,y WxH)` le frame — permet de calculer des taps si besoin
- Indentation pour la hiérarchie (un seul niveau, pas d'arbre profond)
- Sections logiques : header, content, keyboard, tab bar

### Filtrage du clavier

Quand le clavier est visible :
- Ne pas lister toutes les touches (ça pollue le contexte)
- Juste indiquer `--- Keyboard visible ---` avec le type (alphabétique, numérique)
- L'agent sait qu'il peut utiliser `sim type "texte"` directement

### Estimation de taille

- **Écran simple** (login) : ~10-20 lignes → ~500 tokens
- **Écran complexe** (liste scrollable) : ~30-60 lignes → ~1500 tokens
- **Sans filtre** (`--full`) : peut atteindre 200+ lignes → 5000+ tokens

L'objectif est de rester **sous 2000 tokens** pour `sim ui` dans 90% des cas.

---

## Gestion des erreurs

Format uniforme pour toutes les erreurs :

```
ERROR: No simulator booted. Run: sim boot "iPhone 16 Pro"
ERROR: App not found: com.example.app. Run: sim install /path/to/App.app
ERROR: Element not found: --label "Sign In". Run: sim ui to inspect.
ERROR: Build failed (exit 65). See: /tmp/sim-build.log
```

**Règles :**
- Toujours dire quoi faire pour résoudre
- Les logs détaillés de build vont dans un fichier (pas dans stdout)
- Seul le résumé de l'erreur est affiché (première erreur du build, pas les 200 lignes)

---

## Implémentation

**Langage** : Shell script (bash) — pas de dépendance, fonctionne directement.
Alternative : Node.js si le parsing JSON du filtrage est trop complexe en bash.

**Structure** :
```
tools/sim                  # Script principal (point d'entrée)
tools/sim-ui-filter.js     # Filtre l'arbre AXe → format compact (Node.js)
.sim-context.json          # Contexte (auto-généré, gitignored)
```

Le script principal (`sim`) fait ~200 lignes de bash : parsing des arguments, lecture/écriture du contexte, dispatch vers les outils sous-jacents. Le filtre UI est en Node.js car parser du JSON en bash est pénible.

---

## Exemples de workflow complet

### 1. Premier lancement
```bash
sim list                          # voir les simulateurs disponibles
sim boot "iPhone 16 Pro"          # boot + sauvegarde dans le contexte
sim schemes                       # voir les schemes du projet
sim build --scheme NovaBotApp    # build (scheme sauvé dans le contexte)
sim run                           # install + launch (utilise le contexte)
```

### 2. Tester une interaction
```bash
sim screenshot                    # voir l'état actuel
sim ui                            # inspecter les éléments interactifs
sim tap --label "New Chat"        # tapper sur un bouton
sim type "Hello world"            # taper du texte
sim key enter                     # valider
sim screenshot                    # vérifier le résultat
```

### 3. Debug un bug visuel
```bash
sim ui --at 200,350               # qu'est-ce qu'il y a à cet endroit ?
sim swipe up                      # scroller
sim ui                            # re-inspecter après scroll
sim screenshot                    # capturer pour analyse
```

### 4. Cycle de dev itératif
```bash
# Modifier du code Swift...
sim build                         # rebuild (scheme + destination = contexte)
sim run                           # reinstall + relaunch
sim ui                            # vérifier le résultat
sim tap --id "settingsButton"     # naviguer
sim screenshot                    # capturer
```
