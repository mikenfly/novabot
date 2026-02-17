# Scénario de Test — Système de Mémoire NanoClaw

Test ciblé sur la réconciliation, les relations, et la gestion des contradictions.

---

## Phase 1 — Semis (Conversation A)

> Je m'appelle Michael, j'ai 28 ans et je vis à Lyon. Je suis développeur freelance spécialisé en TypeScript et Go, mon entreprise s'appelle Nexus Digital. En ce moment je travaille sur Orbital, un projet client pour AeroDyn : plateforme de gestion de flotte de drones. Contact : Sophie Marchand, CTO d'AeroDyn, deadline v1 le 15 mars. Le serveur de prod est sur AWS eu-west-3 avec PostgreSQL 16. J'ai un call avec Sophie mardi prochain à 14h pour le point projet. Mon setup : MacBook Pro M3, Neovim comme éditeur, serveur sous Arch Linux, je déploie tout avec Docker.

**Attendre ~30 secondes**, puis vérifier `memory-context.md`.

### Checklist Phase 1

- [ ] User : Michael, 28 ans, Lyon, TypeScript/Go, Nexus Digital
- [ ] Project : Orbital (AeroDyn, drones, deadline 15 mars)
- [ ] People : Sophie Marchand (CTO AeroDyn)
- [ ] Timeline : call mardi 14h avec Sophie
- [ ] Facts : setup technique (MacBook Pro M3, Neovim, Arch Linux, Docker, AWS eu-west-3, PostgreSQL 16)
- [ ] Preferences : aucune (pas mentionnées)
- [ ] Relations correctes (call → Sophie, call → Orbital, Sophie → Orbital, etc.)
- [ ] Relations direction-aware : Orbital affiche `includes: orbital-infra` (pas `part_of: orbital-infra`)

---

## Phase 2 — Contradictions (Conversation B)

> En fait j'ai eu 29 ans la semaine dernière (pas 28). J'ai changé le nom de mon entreprise, c'est plus Nexus Digital, maintenant c'est Kōdo Studio. Pour Orbital, la deadline a été repoussée au 30 mars et le contact chez AeroDyn a changé : Sophie est partie, c'est Marc Dubois le nouveau CTO. Du coup le call de mardi c'est avec Marc maintenant. Ah et j'ai migré de Neovim à Cursor comme éditeur, et mon serveur est passé de Arch Linux à Debian.

**Attendre ~30 secondes**, puis vérifier `memory-context.md`.

### Checklist Phase 2

**Corrections propagées :**
- [ ] User : 29 ans (pas 28), Kōdo Studio (pas Nexus Digital)
- [ ] Orbital deadline : 30 mars (pas 15 mars)
- [ ] Setup : Cursor (pas Neovim), Debian (pas Arch Linux)

**Remplacement de personne :**
- [ ] Sophie Marchand : marquée "ex-CTO", "a quitté AeroDyn"
- [ ] Marc Dubois : nouveau CTO, contact Orbital
- [ ] Le call mardi pointe vers Marc (pas Sophie) — contenu ET relations mis à jour
- [ ] Pas de relation orpheline vers Sophie sur le call ou le projet

**Relations propres :**
- [ ] Orbital → Marc Dubois (involves ou similar)
- [ ] Orbital ne pointe plus vers Sophie (sauf maybe `related_to` historique)
- [ ] Le call est lié à Marc, pas à Sophie
- [ ] Directions correctes dans l'affichage

**Pas de doublons :**
- [ ] TypeScript/Go n'apparaît qu'une fois (dans User ou Facts, pas dans les deux ET dans Preferences)
- [ ] Pas d'entrée "langages-typescript-go" séparée dans Preferences

---

## Vérification

Après chaque phase, vérifier dans **Paramètres > Développeur > Voir le contexte injecté** :
1. Les corrections sont appliquées (pas d'anciennes valeurs qui traînent)
2. Les relations sont propres (pas d'orphelines, directions correctes)
3. Pas de doublons cross-catégories
