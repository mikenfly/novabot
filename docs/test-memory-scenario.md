# Scénario de Test — Système de Mémoire NanoClaw

Test complet du système de mémoire : réconciliation, homonymes, isolation cross-conversation, récupération de contexte, et edge cases.

---

## Phase 1 — Semis (Conversation A: "Projet Orbital")

> Je m'appelle Michael, j'ai 28 ans et je vis à Lyon. Je suis développeur freelance spécialisé en TypeScript et Go, mon entreprise s'appelle Nexus Digital. En ce moment je travaille sur Orbital, un projet client pour AeroDyn : plateforme de gestion de flotte de drones. Contact : Sophie Marchand, CTO d'AeroDyn, deadline v1 le 15 mars. Le serveur de prod est sur AWS eu-west-3 avec PostgreSQL 16. J'ai un call avec Sophie mardi prochain à 14h pour le point projet. Mon setup : MacBook Pro M3, Neovim comme éditeur, serveur sous Arch Linux, je déploie tout avec Docker.

### Checklist Phase 1

- [ ] User : Michael, 28 ans, Lyon, TypeScript/Go, Nexus Digital
- [ ] Project : Orbital (AeroDyn, drones, deadline 15 mars)
- [ ] People : Sophie Marchand (CTO AeroDyn)
- [ ] Timeline : call mardi 14h avec Sophie
- [ ] Facts : setup technique (MacBook Pro M3, Neovim, Arch Linux, Docker, AWS eu-west-3, PostgreSQL 16)
- [ ] Relations correctes (call → Sophie, call → Orbital, Sophie → Orbital, etc.)

---

## Phase 2 — Contradictions (Conversation B: "Général")

> En fait j'ai eu 29 ans la semaine dernière (pas 28). J'ai changé le nom de mon entreprise, c'est plus Nexus Digital, maintenant c'est Kōdo Studio. Pour Orbital, la deadline a été repoussée au 30 mars et le contact chez AeroDyn a changé : Sophie est partie, c'est Marc Dubois le nouveau CTO. Du coup le call de mardi c'est avec Marc maintenant. Ah et j'ai migré de Neovim à Cursor comme éditeur, et mon serveur est passé de Arch Linux à Debian.

### Checklist Phase 2

**Corrections propagées :**
- [ ] User : 29 ans (pas 28), Kōdo Studio (pas Nexus Digital)
- [ ] Orbital deadline : 30 mars (pas 15 mars)
- [ ] Setup : Cursor (pas Neovim), Debian (pas Arch Linux)

**Remplacement de personne :**
- [ ] Sophie Marchand : marquée "ex-CTO" ou "a quitté AeroDyn"
- [ ] Marc Dubois : nouveau CTO, contact Orbital
- [ ] Le call mardi pointe vers Marc — contenu ET relations
- [ ] Pas de relation orpheline vers Sophie

**Pas de doublons :**
- [ ] TypeScript/Go n'apparaît qu'une fois (pas dans Preferences en doublon)

---

## Phase 3 — Homonymes + isolation cross-conversation

3 échanges envoyés en batch. L'agent doit traiter chaque échange dans le contexte de SA conversation, sans confondre les "Marc".

**Exchange 1** (channel: pwa, conversation: "Projet Luna")
> User: "Je viens de démarrer un side project avec Marc Lemaire, un designer UX freelance basé à Bordeaux. Le projet s'appelle Luna — une app de méditation et suivi du sommeil. Marc gère le design et moi le dev. On vise un proto fonctionnel pour fin avril."
> Assistant: "Luna a l'air prometteur ! Si tu as besoin d'aide sur le choix de stack ou l'architecture, n'hésite pas."

**Exchange 2** (channel: pwa, conversation: "Divers")
> User: "Tu connais un bon restaurant italien à Lyon dans le 6ème ? C'est pour samedi soir."
> Assistant: "Je n'ai pas de préférence personnelle, mais La Tavola et L'Osteria dans le 6ème sont bien notés. Vérifie les avis récents sur Google Maps."

**Exchange 3** (channel: pwa, conversation: "Projet Orbital")
> User: "Il a validé les specs du module de tracking hier, on peut lancer le dev. Par contre il veut qu'on ajoute un dashboard analytics en plus dans la v1."
> Assistant: "Super nouvelle pour les specs ! Pour le dashboard analytics, tu as des contraintes de deadline ou c'est flexible ?"

### Checklist Phase 3

**Homonymes :**
- [ ] Marc Lemaire : entrée distincte de Marc Dubois (clés différentes)
- [ ] Marc Lemaire : designer UX, Bordeaux, lié à Luna
- [ ] Marc Dubois : toujours CTO AeroDyn, lié à Orbital
- [ ] Pas de confusion entre les deux Marc

**Projet Luna :**
- [ ] Créé dans projects (app méditation/sommeil, proto fin avril)
- [ ] Lié à Marc Lemaire (involves)

**Cross-conversation ("il") :**
- [ ] "Il a validé les specs" → attribué au contexte Orbital (Marc Dubois), PAS à Marc Lemaire
- [ ] Orbital mis à jour (specs tracking validées, dashboard analytics ajouté)

**Filler :**
- [ ] Le restaurant ne crée rien en mémoire (ou très minimal)

---

## Phase 4 — Pronoms dans une autre conversation

**Exchange** (channel: pwa, conversation: "Projet Luna")
> User: "Il m'a envoyé trois maquettes ce matin, c'est vraiment propre. On part sur un design minimaliste, tons pastels. Il propose aussi un mode nuit avec des dégradés sombres."
> Assistant: "Les tons pastels c'est un bon choix pour la méditation. Le mode nuit est essentiel pour une app de suivi du sommeil."

### Checklist Phase 4

- [ ] "Il" dans conversation Luna → Marc Lemaire (pas Marc Dubois)
- [ ] Luna mis à jour (design minimaliste, tons pastels, mode nuit)
- [ ] Marc Lemaire éventuellement mis à jour (envoi de maquettes)
- [ ] Aucun impact sur Orbital ni Marc Dubois

---

## Phase 5 — Perte de session + récupération de contexte

**Avant cet échange : supprimer le fichier `.session` de l'agent** pour simuler une perte totale de contexte conversationnel. La DB reste intacte, mais l'agent repart de zéro pour la compréhension — il doit tout redécouvrir via `search_memory`.

**Exchange** (channel: pwa, conversation: "Retour de call")
> User: "Le call avec le CTO d'AeroDyn s'est super bien passé. Il est satisfait de l'avancement sur le tracking. On a convenu de faire un autre call vendredi prochain à 10h pour la démo du proto. Il m'a aussi confirmé que le budget phase 2 est validé à 45k€."
> Assistant: "Excellent retour ! La démo vendredi sera un moment clé. Tu veux préparer un environnement de démo dédié ou tu montres directement sur la staging ?"

### Checklist Phase 5

**Récupération de contexte :**
- [ ] L'agent a fait `search_memory` pour "CTO AeroDyn" (pas de get_entry direct vu qu'il n'a plus la session)
- [ ] Marc Dubois identifié comme le CTO
- [ ] Orbital identifié comme le projet concerné

**Mises à jour :**
- [ ] Nouveau call vendredi créé dans timeline (lié à Marc Dubois et Orbital)
- [ ] L'ancien call mardi marqué completed ou mis à jour
- [ ] Budget 45k€ phase 2 ajouté quelque part (Orbital ou facts)

**Pas de doublons :**
- [ ] Pas de deuxième entrée Marc Dubois créée
- [ ] Pas de deuxième entrée Orbital créée

---

## Phase 6 — Edge cases : corrections partielles et ambiguïté

2 échanges dans des conversations différentes.

**Exchange 1** (channel: pwa, conversation: "Projet Orbital")
> User: "Petit correctif : le serveur de prod tourne sur PostgreSQL 17 pas 16, je m'étais trompé."
> Assistant: "Noté pour PostgreSQL 17."

**Exchange 2** (channel: pwa, conversation: "Perso")
> User: "Mon amie Sophie vient d'être embauchée comme lead dev chez TechFlow. On déjeune ensemble mercredi midi."
> Assistant: "Sympa ! Elle va bosser sur quoi chez TechFlow ?"

### Checklist Phase 6

**Correction partielle :**
- [ ] PostgreSQL 16 → 17 dans les facts (orbital-infra ou setup-dev)
- [ ] Le reste de l'entrée inchangé (AWS eu-west-3, etc.)
- [ ] Pas de doublon d'entrée infra

**Ambiguïté — "Sophie" :**
- [ ] Nouvelle Sophie ≠ Sophie Marchand (contexte différent : amie, lead dev, TechFlow)
- [ ] Sophie Marchand (ex-CTO) pas modifiée
- [ ] Déjeuner mercredi créé dans timeline (lié à la nouvelle Sophie, pas à Marchand)
- [ ] Clé distincte pour la nouvelle Sophie (pas `sophie-marchand`)

---

## Vérification globale

Après toutes les phases, le contexte final doit être **cohérent et sans artefacts** :

1. Deux Marc distincts (Dubois CTO / Lemaire designer)
2. Deux Sophie distinctes (Marchand ex-CTO / amie lead dev)
3. Deux projets (Orbital / Luna) avec les bonnes personnes liées
4. Timeline propre (calls, déjeuner, avec les bonnes personnes)
5. Aucune donnée obsolète qui traîne (pas de "28 ans", "Neovim", "Arch Linux", "15 mars")
6. Aucun doublon cross-catégorie
