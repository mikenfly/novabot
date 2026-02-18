# Scénario de Test v2 — Élodie, graphiste freelance

Scénario différent du v1 pour valider les fixes (doublon preferences, pronoms ignorés).

---

## Phase 1 — Semis (Conv A: "Pro")

> Je m'appelle Élodie, j'ai 32 ans, je suis graphiste freelance à Nantes. Je travaille avec deux clients en ce moment : Studio Vega, une agence de pub où mon contact c'est Thomas Renard, le directeur créatif, et la Brasserie Le Comptoir, un restaurant dont la gérante s'appelle Julie Martin. Mon setup c'est un iMac 27", je bosse sur Figma et la suite Adobe. J'ai une deadline pour le rebranding du Comptoir le 28 février, et une réunion avec Thomas jeudi prochain à 10h pour la campagne de printemps de Vega.

### Checklist Phase 1

- [ ] User : Élodie, 32 ans, Nantes, graphiste freelance
- [ ] Projects : Studio Vega + Brasserie Le Comptoir (deux projets distincts)
- [ ] People : Thomas Renard (directeur créatif Vega) + Julie Martin (gérante Comptoir)
- [ ] Facts : setup (iMac 27", Figma, suite Adobe)
- [ ] Timeline : deadline rebranding 28 février + réunion Thomas jeudi 10h
- [ ] Preferences : aucune (pas mentionnées)
- [ ] PAS de doublon Figma/Adobe dans preferences

---

## Phase 2 — Homonyme (Conv B: "Famille")

> Mon frère Thomas passe le weekend prochain à Nantes. Il est développeur Python à Paris. On va visiter le château des ducs de Bretagne samedi matin, et le soir on mange chez moi.

### Checklist Phase 2

- [ ] Thomas (frère) : entrée distincte de Thomas Renard
- [ ] Clés différentes (thomas-frere ou thomas-elodie vs thomas-renard)
- [ ] Visite château + dîner dans timeline
- [ ] Pas de confusion avec Thomas Renard

---

## Phase 3 — Contradictions + pronoms (Conv A: "Pro")

3 échanges envoyés en batch :

**Exchange 1** (Conv A: "Pro")
> Julie est partie du Comptoir, c'est maintenant Karim Assal qui gère. La deadline du rebranding est décalée au 15 mars. Et j'ai switché de Figma à Sketch pour le projet Comptoir.

**Exchange 2** (Conv C: "Courses")
> Tu aurais une recette de gâteau au chocolat simple ? C'est pour l'anniversaire de ma nièce.

**Exchange 3** (Conv A: "Pro")
> Il a beaucoup aimé les premières maquettes que je lui ai montrées. Il veut qu'on ajoute un menu enfant dans le branding.

### Checklist Phase 3

**Contradictions :**
- [ ] Julie Martin : marquée "ancienne gérante" ou "a quitté"
- [ ] Karim Assal : nouveau gérant du Comptoir, relations mises à jour
- [ ] Deadline rebranding : 15 mars (pas 28 février)
- [ ] Sketch mentionné (Figma → Sketch pour ce projet)
- [ ] Contenu du projet Comptoir réécrit avec Karim, 15 mars

**Pronoms cross-conversation :**
- [ ] "Il" dans Exchange 3 (Conv A "Pro", contexte Comptoir) → Karim Assal
- [ ] Projet Comptoir mis à jour : Karim a aimé les maquettes, menu enfant ajouté
- [ ] PAS attribué à Thomas Renard ni Thomas frère

**Filler :**
- [ ] La recette de gâteau ne crée rien (ou très minimal)

---

## Phase 4 — Pronoms dans l'autre conversation (Conv B: "Famille")

> Il a adoré la visite du château, il m'a dit que c'était son meilleur weekend depuis longtemps. On s'est mis d'accord pour qu'il revienne en avril.

### Checklist Phase 4

- [ ] "Il" → Thomas frère (pas Thomas Renard, pas Karim)
- [ ] Visite château mise à jour ou bump
- [ ] Prochaine visite en avril (timeline)
- [ ] Aucun impact sur le contexte pro

---

## Phase 5 — Perte de session + récupération

**Supprimer `.session` avant cet échange.**

> La réunion avec le directeur créatif de l'agence de pub s'est super bien passée. Il a validé les 3 concepts que j'ai proposés pour la campagne de printemps. Le budget est confirmé à 12k€ pour la prod.

### Checklist Phase 5

**Récupération :**
- [ ] Agent fait search_memory (pas juste get_entry) pour retrouver Thomas Renard / Vega
- [ ] Thomas Renard identifié comme directeur créatif
- [ ] Studio Vega identifié comme le projet

**Mises à jour :**
- [ ] Studio Vega mis à jour : 3 concepts validés, campagne printemps, budget 12k€
- [ ] Pas de doublon Thomas Renard ou Studio Vega

---

## Phase 6 — Edge cases

**Exchange 1** (Conv A: "Pro")
> Petit correctif : c'est un iMac 24" pas 27", je me suis trompée.

**Exchange 2** (Conv D: "Perso")
> Ma copine Julie m'a recommandé un cours de poterie, on y va ensemble mercredi à 19h.

### Checklist Phase 6

**Correction partielle :**
- [ ] iMac 27" → 24" dans les facts
- [ ] Le reste du setup inchangé

**Ambiguïté Julie :**
- [ ] Nouvelle Julie ≠ Julie Martin (contexte : copine, poterie)
- [ ] Julie Martin (ancienne gérante) pas modifiée
- [ ] Cours poterie mercredi dans timeline (lié à la nouvelle Julie)
- [ ] Clé distincte

---

## Vérification globale

1. Deux Thomas distincts (Renard directeur créatif / frère développeur)
2. Deux Julie distinctes (Martin ex-gérante / copine poterie)
3. Karim Assal correctement installé comme gérant
4. Deux projets (Vega / Comptoir) avec les bonnes personnes
5. Timeline propre
6. PAS de doublon Figma/Adobe/Sketch dans preferences
7. Pronoms correctement résolus dans chaque conversation
