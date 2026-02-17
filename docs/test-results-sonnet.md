# Résultats Test — Sonnet 4.5 (claude-sonnet-4-5-20250929)

Date : 2026-02-17

## Coûts

| Phase | Tool calls | Turns | Coût |
|-------|-----------|-------|------|
| Phase 1 (Semis) | 19 | 20 | $0.103 |
| Phase 2 (Contradictions) | 23 | 24 | $0.152 |
| Phase 3a (Luna + Marc Lemaire) | 8 | 9 | $0.131 |
| Phase 3b (Divers + Orbital "il") | 0 | 1 | $0.025 |
| Phase 4 (Pronoms Luna) | 2 | 3 | $0.039 |
| Phase 5 (Session loss) | 7 | 8 | $0.070 |
| Phase 6a (PostgreSQL correction) | 3 | 4 | $0.053 |
| Phase 6b (Sophie ambiguïté) | 5 | 6 | $0.068 |
| **Total** | **67** | **75** | **$0.641** |

## Logs complets

```
[19:47:13] Context agent reset complete — clean state

=== PHASE 1 ===
[19:47:24] Processing 1 exchange(s) from pwa
  → search_memory(query="Michael développeur freelance", category=user)
  → search_memory(query="Sophie Marchand AeroDyn CTO", category=people)
  → search_memory(query="Orbital projet drones AeroDyn", category=projects)
  → search_memory(query="AWS PostgreSQL serveur production", category=facts)
  → search_memory(query="MacBook Neovim Docker setup développement", category=facts)
  → search_memory(query="deadline v1 mars call Sophie", category=timeline)
  → upsert_entry(category=user, key="michael")
  → upsert_entry(category=people, key="sophie-marchand")
  → upsert_entry(category=projects, key="orbital")
  → upsert_entry(category=facts, key="setup-dev")
  → upsert_entry(category=facts, key="orbital-infra")
  → upsert_entry(category=timeline, key="orbital-deadline-v1")
  → upsert_entry(category=timeline, key="call-sophie-orbital")
  → upsert_entry(category=preferences, key="stack-tech")        ← DOUBLON
  → add_relation(orbital → sophie-marchand)
  → add_relation(orbital → orbital-infra)
  → add_relation(orbital-deadline-v1 → orbital)
  → add_relation(call-sophie-orbital → orbital)
  → add_relation(call-sophie-orbital → sophie-marchand)
  ✓ 19 tool calls, 20 turns, $0.103

=== PHASE 2 ===
[19:49:21] Processing 1 exchange(s) from pwa
  → get_entry(michael, sophie-marchand, orbital, orbital-deadline-v1, call-sophie-orbital, setup-dev, stack-tech)
  → search_memory("Marc Dubois CTO AeroDyn")        ✓ searched before creating
  → upsert_entry: michael (29 ans, Kōdo Studio)
  → upsert_entry: setup-dev (Cursor, Debian)
  → upsert_entry: stack-tech (Cursor updated)
  → upsert_entry: orbital-deadline-v1 (30 mars)
  → upsert_entry: sophie-marchand (ex-CTO)
  → upsert_entry: marc-dubois (nouveau CTO)
  → remove_relation(call-sophie-orbital ↔ orbital)
  → remove_relation(call-sophie-orbital ↔ sophie-marchand)
  → upsert_entry: call-marc-orbital (renommé)
  → upsert_entry: orbital (Marc Dubois, 30 mars)
  → delete_entry(call-sophie-orbital)
  → add_relation(orbital → marc-dubois)
  → add_relation(call-marc-orbital → orbital)
  → add_relation(call-marc-orbital → marc-dubois)
  → remove_relation(orbital ↔ sophie-marchand)
  ✓ 23 tool calls, 24 turns, $0.152

=== PHASE 3 ===
Batch 1 (Luna only):
  → search_memory("Luna app méditation sommeil")
  → search_memory("Marc Lemaire designer")
  → search_memory("proto prototype fin avril")
  → upsert_entry: marc-lemaire        ✓ distinct de marc-dubois
  → upsert_entry: luna
  → upsert_entry: luna-proto-avril
  → add_relation(luna → marc-lemaire)
  → add_relation(luna-proto-avril → luna)
  ✓ 8 tool calls, $0.131

Batch 2 (Divers + Orbital "il"):
  ✓ 0 tool calls, $0.025
  ⚠️ L'agent a ignoré l'échange Orbital ("il a validé les specs")
  → Le test de pronom cross-conversation n'a pas été exercé

=== PHASE 4 ===
  → get_entry(luna)
  → upsert_entry: luna (design minimaliste, tons pastels, mode nuit)
  ✓ "il" dans Luna → Marc Lemaire (pas Marc Dubois)
  ✓ 2 tool calls, $0.039

=== PHASE 5 (Session loss) ===
  → get_entry(key="orbital")        ⚠️ get_entry direct, pas search_memory
  → search_memory("démo call vendredi AeroDyn proto")
  → upsert_entry: call-marc-orbital (effectué)
  → upsert_entry: demo-marc-orbital (vendredi 10h)
  → upsert_entry: orbital (budget 45k€)
  → add_relation(demo-marc-orbital → orbital)
  → add_relation(demo-marc-orbital → marc-dubois)
  ✓ 7 tool calls, $0.070
  ⚠️ Clé "orbital" devinée sans search

=== PHASE 6 ===
Batch 1 (PostgreSQL):
  → get_entry(orbital-infra)
  → upsert_entry: orbital-infra (PostgreSQL 17)
  → upsert_entry: orbital (propagé PostgreSQL 17)
  ✓ 3 tool calls, $0.053

Batch 2 (Sophie):
  → search_memory("Sophie amie lead dev TechFlow")
  → search_memory("déjeuner mercredi Sophie")
  → upsert_entry: sophie-techflow        ✓ distincte de sophie-marchand
  → upsert_entry: dejeuner-sophie-techflow
  → add_relation(dejeuner → sophie-techflow)
  ✓ 5 tool calls, $0.068
```

## Contexte final

```markdown
# Memory Context

## User
Michael, 29 ans, vit à Lyon. Développeur freelance spécialisé en TypeScript et Go. Son entreprise s'appelle Kōdo Studio.

## Current Projects
- **orbital** (mentioned 4x): Projet client pour AeroDyn : plateforme de gestion de flotte de drones. Contact côté client : Marc Dubois (CTO AeroDyn). Backend sur AWS eu-west-3 avec PostgreSQL 17. Deadline v1 le 30 mars. Budget phase 2 validé à 45k€. [involves: marc-dubois, involves: orbital-infra, includes: orbital-deadline-v1, includes: call-marc-orbital, includes: demo-marc-orbital]
- **luna** (mentioned 2x): Side project de Michael avec Marc Lemaire (designer UX) : app de méditation et suivi du sommeil. Direction artistique : design minimaliste, tons pastels, mode nuit. Objectif : proto fin avril. [involves: marc-lemaire, includes: luna-proto-avril]

## People
- **sophie-marchand** (mentioned 2x): Sophie Marchand, ex-CTO d'AeroDyn. A quitté AeroDyn (remplacée par Marc Dubois).
- **sophie-techflow** (mentioned 1x): Sophie (nom inconnu), amie de Michael. Lead dev chez TechFlow.
- **marc-lemaire** (mentioned 1x): Marc Lemaire, designer UX freelance, Bordeaux. Collabore sur Luna.
- **marc-dubois** (mentioned 1x): Marc Dubois, CTO AeroDyn. Contact Orbital.

## Facts
- **orbital-infra** (mentioned 2x): AWS eu-west-3, PostgreSQL 17.
- **setup-dev** (mentioned 2x): MacBook Pro M3, Cursor, Debian, Docker.

## Preferences
- **stack-tech** (mentioned 2x): TypeScript, Go, Cursor, Docker.    ← DOUBLON

## Timeline
- **orbital-deadline-v1**: 30 mars (repoussée depuis 15 mars)
- **luna-proto-avril**: fin avril
- **demo-marc-orbital**: vendredi prochain 10h
- **dejeuner-sophie-techflow**: mercredi midi
```

## Bilan

### ✅ Réussi
- Homonymes Marc (Dubois/Lemaire) séparés
- Homonymes Sophie (Marchand/TechFlow) séparés
- Pronom "il" Luna → Marc Lemaire (Phase 4)
- Corrections propagées (29 ans, Kōdo, Cursor, Debian, 30 mars, PostgreSQL 17)
- Remplacement Sophie→Marc complet
- Récupération post-session loss
- Budget 45k€ intégré
- Pas de doublons d'entrées (sauf preferences)

### ⚠️ Problèmes
1. **Doublon `preferences/stack-tech`** — info déjà dans user + setup-dev
2. **Phase 3 "il" Orbital ignoré** — specs tracking + dashboard analytics non persistés
3. **Phase 5 get_entry direct** — clé "orbital" devinée sans search_memory
