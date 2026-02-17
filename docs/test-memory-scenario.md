# Scénario de Test — Système de Mémoire NanoClaw

## Phase 1 — Semis d'informations (3 conversations, 1 message chacune)

### Conversation A

> Je m'appelle Michael, j'ai 28 ans et je vis à Lyon. Je suis développeur freelance spécialisé en TypeScript et Go, mon entreprise s'appelle Nexus Digital. En ce moment je travaille sur deux projets : NanoClaw (mon assistant personnel basé sur Claude, stack Node.js + SQLite + Claude API, hébergé sur mon Mac Mini M2) et Orbital (projet client pour AeroDyn, plateforme de gestion de flotte de drones, contact : Sophie Marchand leur CTO, deadline v1 le 15 mars). Mon objectif c'est de finir le système de mémoire de NanoClaw cette semaine et déployer en prod d'ici fin février.

### Conversation B

> Je préfère qu'on se tutoie toujours, j'aime les réponses concises sans blabla, et je déteste les émojis. Mon meilleur ami s'appelle Thomas Renard, il est designer UX et il bosse avec moi sur NanoClaw (il fait le design de la PWA). Ma copine s'appelle Léa, elle est photographe. Mon setup : MacBook Pro M3, Neovim comme éditeur, Arch Linux sur mon serveur, je déploie tout avec Docker.

### Conversation C

> La semaine prochaine j'ai un call avec Sophie d'AeroDyn mardi à 14h pour le point Orbital, et jeudi je présente NanoClaw à Thomas pour son feedback sur le design. Le serveur de prod d'AeroDyn est sur AWS eu-west-3 avec PostgreSQL 16, le repo Orbital est sur leur GitLab privé.

**Attendre ~30 secondes** que le système de mémoire traite les échanges.

---

## Phase 2 — Test de rappel cross-conversation (Conversation D)

Envoyer ces questions **une par une** dans une nouvelle conversation :

**Q1 :** `Sur quels projets je bosse en ce moment ?`
- ✅ Attendu : NanoClaw + Orbital

**Q2 :** `C'est quoi la deadline d'Orbital et qui est mon contact là-bas ?`
- ✅ Attendu : 15 mars, Sophie Marchand (CTO d'AeroDyn)

**Q3 :** `Qu'est-ce que j'ai de prévu la semaine prochaine ?`
- ✅ Attendu : Call mardi 14h avec Sophie + présentation jeudi avec Thomas

**Q4 :** `Thomas il fait quoi exactement ?`
- ✅ Attendu : Designer UX, meilleur ami, bosse sur le design de la PWA NanoClaw

**Q5 :** `C'est quoi mon setup technique ?`
- ✅ Attendu : MacBook Pro M3, Neovim, Arch Linux, Docker, Mac Mini M2

---

## Phase 3 — Mises à jour et contradictions (Conversations E + F)

### Conversation E — un seul message

> En fait j'ai eu 29 ans la semaine dernière (pas 28). J'ai changé le nom de mon entreprise, c'est plus Nexus Digital, maintenant c'est Kōdo Studio. Pour Orbital, la deadline a été repoussée au 30 mars et le contact chez AeroDyn a changé : Sophie est partie, c'est Marc Dubois le nouveau CTO. Ah et j'ai migré de Neovim à Cursor comme éditeur, et mon serveur est passé de Arch Linux à Debian.

**Attendre ~30 secondes**, puis nouvelle conversation F :

### Conversation F — vérification (une question par message)

**Q1 :** `J'ai quel âge ?`
- ✅ Attendu : 29 ans (pas 28)

**Q2 :** `C'est quoi le nom de mon entreprise ?`
- ✅ Attendu : Kōdo Studio (pas Nexus Digital)

**Q3 :** `C'est quoi la deadline d'Orbital et qui est le CTO d'AeroDyn ?`
- ✅ Attendu : 30 mars + Marc Dubois (pas 15 mars / Sophie)

**Q4 :** `J'utilise quoi comme éditeur et quel OS sur mon serveur ?`
- ✅ Attendu : Cursor + Debian (pas Neovim / Arch)

---

## Phase 4 — Stress test : ambiguïté (Conversation G)

### Message 1

> J'ai un nouveau collègue qui s'appelle Thomas Petit. C'est un dev backend Go, il bosse avec moi sur Orbital.

### Message 2

> Thomas m'a envoyé les maquettes du nouveau dashboard hier.

- ✅ Attendu : devrait identifier que c'est Thomas **Renard** (designer) qui envoie des maquettes, pas Thomas Petit (dev backend)

### Message 3

> J'ai commencé un nouveau side project qui s'appelle "Pulse" — c'est un dashboard de monitoring pour mes serveurs perso. Et j'avais aussi commencé un projet en Rust l'année dernière mais j'ai abandonné.

### Question finale

> C'est quoi la liste de tous mes projets en cours actuellement ?

- ✅ Attendu : NanoClaw, Orbital, Pulse (le projet Rust ne devrait PAS apparaître car abandonné)

---

## Vérification en parallèle

Après chaque phase, vérifier :
1. **Paramètres > Développeur > Voir le contexte injecté** — le markdown généré doit contenir les bonnes infos
2. Les catégories doivent être correctes (people, projects, facts, preferences, etc.)
3. Les relations entre entités doivent apparaître (ex: Thomas Renard → NanoClaw)
