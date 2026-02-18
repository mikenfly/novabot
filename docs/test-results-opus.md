# Résultats Test — Opus 4.6 (claude-opus-4-6)

Date : 2026-02-17

## Coûts

| Phase | Tool calls | Turns | Coût | Thinking time max |
|-------|-----------|-------|------|-------------------|
| Phase 1 (Semis) | 22 | 23 | $0.458 | ~10s |
| Phase 2 (Contradictions) | 28 | 29 | $0.940 | ~2m30 |
| Phase 3a (Luna + Marc Lemaire) | 9 | 10 | $0.564 | ~8s |
| Phase 3b (Divers + Orbital "il") | 4 | 5 | $0.343 | ~9s |
| Phase 4 (Pronoms Luna) | 3 | 4 | $0.311 | ~6s |
| Phase 5 (Session loss) | 10 | 11 | $0.501 | ~7s |
| Phase 6a (PostgreSQL correction) | 3 | 4 | $0.726 | ~4m30 |
| Phase 6b (Sophie ambiguïté) | 5 | 6 | $0.427 | ~10s |
| **Total** | **84** | **92** | **$4.270** | |

## Logs complets

```
[20:04:26] Context agent reset complete — clean state

=== PHASE 1 ===
[20:04:39] Processing 1 exchange(s) from pwa
  → search_memory("Michael développeur freelance", category=user)
  → search_memory("Nexus Digital entreprise")
  → search_memory("Orbital AeroDyn drone", category=projects)
  → search_memory("Sophie Marchand CTO", category=people)
  → search_memory("AWS PostgreSQL serveur production", category=facts)
  → search_memory("MacBook Neovim Docker setup", category=facts)
  → search_memory("call Sophie mardi point projet", category=timeline)
  → search_memory("deadline v1 mars", category=timeline)
  → upsert_entry: michael-profil (user)
  → upsert_entry: sophie-marchand (people)
  → upsert_entry: orbital (projects)
  → upsert_entry: setup-dev (facts)
  → upsert_entry: infra-orbital (facts)
  → upsert_entry: call-sophie-orbital (timeline)
  → upsert_entry: orbital-deadline-v1 (timeline)
  → add_relation × 7 (dont related_to + part_of redondants)
  ✓ 22 tool calls, $0.458
  ✅ PAS de doublon preferences/stack-tech

=== PHASE 2 ===
[20:07:13] Processing (2m30 thinking avant 1er tool call!)
  → get_entry × 6 (tous les entries existants)
  → search_memory("Marc Dubois")
  → upsert_entry × 6 (michael-profil, sophie-marchand, marc-dubois, orbital, setup-dev, orbital-deadline-v1)
  → remove_relation × 3 (Sophie ↔ call, call ↔ orbital, orbital ↔ sophie)
  → delete_entry(call-sophie-orbital)
  → upsert_entry: call-marc-orbital (renommé)
  → add_relation × 3 (orbital → marc-dubois, call → marc-dubois, call → orbital)
  → PASS DE VÉRIFICATION: get_entry × 7 sur toutes les entrées modifiées
  ✓ 28 tool calls, $0.940
  ✅ Vérification post-modification unique à Opus

=== PHASE 3 ===
Batch 1 (Luna):
  → search_memory × 3 (Marc Lemaire, Luna, proto)
  → upsert_entry × 3 (marc-lemaire, luna, luna-proto-deadline)
  → add_relation × 3
  ✓ 9 tool calls, $0.564
  ✅ Marc Lemaire distinct de Marc Dubois

Batch 2 (Divers + Orbital "il"):
  → get_entry("orbital")
  → search_memory("module tracking specs Orbital")
  → search_memory("dashboard analytics")
  → upsert_entry("orbital") ← MIS À JOUR avec tracking + dashboard
  ✓ 4 tool calls, $0.343
  ✅✅ RÉUSSI : "il" → Marc Dubois (Sonnet avait ignoré cet échange !)

=== PHASE 4 ===
  → get_entry("luna")
  → upsert_entry("luna") — design minimaliste, pastels, mode nuit
  → bump_mention("marc-lemaire") ← bonus par rapport à Sonnet
  ✓ 3 tool calls, $0.311
  ✅ "il" → Marc Lemaire (pas Marc Dubois)

=== PHASE 5 (Session loss) ===
  → get_entry("call-marc-orbital")      ⚠️ get_entry direct sans search
  → get_entry("orbital")
  → search_memory("budget phase 2 AeroDyn Orbital")
  → search_memory("démo proto vendredi call")
  → upsert_entry: call-marc-orbital (effectué)
  → upsert_entry: demo-orbital-marc (vendredi 10h)
  → upsert_entry: orbital (budget 45k€, démo)
  → add_relation × 2 (demo → marc-dubois, demo → orbital)
  → bump_mention("marc-dubois")
  ✓ 10 tool calls, $0.501
  ⚠️ Même problème que Sonnet : clé devinée sans search

=== PHASE 6 ===
Batch 1 (PostgreSQL):
  → search_memory("PostgreSQL 16")
  → upsert_entry: infra-orbital (PostgreSQL 17)
  → upsert_entry: orbital (propagé)
  ✓ 3 tool calls, $0.726
  ⚠️ 4m30 de thinking time !

Batch 2 (Sophie):
  → search_memory("Sophie amie lead dev TechFlow")
  → search_memory("déjeuner mercredi")
  → upsert_entry: sophie-amie (distincte de sophie-marchand)
  → upsert_entry: dejeuner-sophie-amie (timeline)
  → add_relation(dejeuner → sophie-amie)
  ✓ 5 tool calls, $0.427
  ✅ Sophie correctement distinguée
```

## Contexte final

```markdown
# Memory Context

## User
Michael, 29 ans, vit à Lyon. Développeur freelance spécialisé en TypeScript et Go. Son entreprise s'appelle Kōdo Studio.

## Current Projects
- **orbital** (mentioned 5x): Orbital — projet client pour AeroDyn (contact : Marc Dubois, CTO). Plateforme de gestion de flotte de drones. TypeScript et Go. Deadline v1 le 30 mars. Module tracking : specs validées, dev en cours, Marc satisfait. Dashboard analytics ajouté v1. Budget phase 2 validé à 45k€. Démo proto le 28 février. AWS eu-west-3, PostgreSQL 17. [involves: marc-dubois, includes: orbital-deadline-v1, includes: infra-orbital, related_to: call-marc-orbital, related_to: demo-orbital-marc]
- **luna** (mentioned 2x): Luna — side project avec Marc Lemaire (designer UX). App méditation et sommeil. Design minimaliste, tons pastels, mode nuit dégradés sombres. Maquettes en cours. Proto fin avril 2026. [involves: marc-lemaire, includes: luna-proto-deadline]

## People
- **marc-dubois** (mentioned 2x): Marc Dubois, CTO AeroDyn. Contact Orbital.
- **marc-lemaire** (mentioned 2x): Marc Lemaire, designer UX, Bordeaux. Luna.
- **sophie-marchand** (mentioned 2x): Sophie Marchand, ex-CTO AeroDyn. Remplacée par Marc Dubois.
- **sophie-amie** (mentioned 1x): Sophie, amie, lead dev TechFlow.

## Facts
- **infra-orbital** (mentioned 2x): AWS eu-west-3, PostgreSQL 17.
- **setup-dev** (mentioned 2x): MacBook Pro M3, Cursor, Debian, Docker.

## Timeline
- **orbital-deadline-v1**: 30 mars (repoussée depuis 15 mars)
- **luna-proto-deadline**: fin avril 2026
- **demo-orbital-marc**: vendredi 28 février 10h
- **dejeuner-sophie-amie**: mercredi 18 février midi
```

## Bilan

### ✅ Réussi (pareil que Sonnet)
- Homonymes Marc (Dubois/Lemaire) séparés
- Homonymes Sophie (Marchand/amie) séparés
- Pronom "il" Luna → Marc Lemaire (Phase 4)
- Corrections propagées (29 ans, Kōdo, Cursor, Debian, 30 mars, PostgreSQL 17)
- Remplacement Sophie→Marc complet
- Récupération post-session loss
- Budget 45k€ intégré

### ✅ Mieux que Sonnet
1. **PAS de doublon preferences/stack-tech** — Opus a évité la création
2. **Phase 3 "il" → Orbital mis à jour** — Sonnet avait ignoré l'échange, Opus a correctement persisté tracking specs + dashboard analytics
3. **Pass de vérification post-Phase 2** — Opus a relu toutes les entrées après modification
4. **bump_mention** sur les personnes référencées sans changement

### ⚠️ Problèmes
1. **Relations redondantes** — Crée related_to + part_of sur les mêmes liens (doublon visuel)
2. **Phase 5 get_entry direct** — Même problème que Sonnet (clé devinée)
3. **Thinking time excessif** — Jusqu'à 4m30 entre tool calls (Phase 6a)
4. **Coût API** — $4.27 total vs $0.64 pour Sonnet (6.7x plus cher)
