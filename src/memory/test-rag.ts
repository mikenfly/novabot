/**
 * RAG Agent stress test.
 * Seeds the memory DB with a rich, interconnected dataset,
 * then feeds exchanges through the RAG pipeline and verifies results.
 *
 * Usage: npx tsx --env-file=.env src/memory/test-rag.ts
 */

import fs from 'fs';
import path from 'path';

import { MEMORY_DIR, MEMORY_DB_PATH, GROUPS_DIR } from '../config.js';
import {
  initMemoryDatabase,
  getEntry,
  upsertEntry,
  bumpMention,
  addRelation,
  listCategory,
  getAllEntries,
  closeMemoryDatabase,
  checkpointWal,
  getDirtyEmbeddingKeys,
  buildEmbeddingText,
  updateEmbedding,
} from './db.js';
import { generateEmbedding, embeddingToBuffer } from './embeddings.js';
import { generateMemoryContext } from './generate-context.js';
import { runRagAgent, type RagResult } from './rag-agent.js';
import type { ExchangeMessage } from './types.js';

// ─── Helpers ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let testNum = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n━━━ ${title} ━━━`);
}

async function upsertWithEmbedding(
  key: string,
  category: string,
  content: string,
  mentionCount = 1,
): Promise<void> {
  const embedding = await generateEmbedding(content);
  const embBuffer = embeddingToBuffer(embedding);
  upsertEntry({
    key,
    category: category as any,
    content,
    embedding: embBuffer,
  });
  // Bump mention count
  for (let i = 1; i < mentionCount; i++) {
    bumpMention(key);
  }
}

// ─── Seed data ───────────────────────────────────────────────────

async function seedDatabase(): Promise<void> {
  section('Seeding database with rich interconnected data');

  // ─── USER PROFILE ───
  await upsertWithEmbedding('profil', 'user',
    'Elodie Martin, 32 ans, graphiste freelance basée à Nantes. Spécialisée en identité visuelle et branding. Travaille depuis chez elle avec un iMac 27 pouces.',
    5);

  // ─── PEOPLE ───
  await upsertWithEmbedding('thomas-renard', 'people',
    'Thomas Renard, directeur créatif chez Studio Vega (agence de pub à Paris). Contact principal pour les projets Studio Vega. Email: thomas@studiovega.fr. Préfère être contacté par email le matin. Exigeant sur les délais.',
    8);

  await upsertWithEmbedding('sophie-laurent', 'people',
    'Sophie Laurent, cheffe de projet chez BioNature (cosmétiques bio). Gère le rebranding complet. Contact: sophie.laurent@bionature.com. Très sympa mais souvent en déplacement.',
    4);

  await upsertWithEmbedding('marc-dubois', 'people',
    'Marc Dubois, photographe freelance basé à Nantes. Collabore régulièrement avec Élodie pour les shootings produit. Tarif jour: 600€. Disponible les mardis et jeudis.',
    6);

  await upsertWithEmbedding('camille-petit', 'people',
    'Camille Petit, développeuse web freelance. Fait les intégrations web des maquettes d\'Élodie. Travaille avec Next.js et Tailwind. Basée à Lyon.',
    3);

  await upsertWithEmbedding('julie-moreau', 'people',
    'Julie Moreau, comptable d\'Élodie. Gère la facturation et les déclarations URSSAF. Rendez-vous trimestriel. Cabinet Moreau & Associés à Nantes.',
    2);

  await upsertWithEmbedding('pierre-garcia', 'people',
    'Pierre Garcia, ancien collègue d\'Élodie chez l\'agence Créativ\'Plus. Maintenant DA chez Publicis Lyon. Recommande parfois des clients à Élodie.',
    2);

  await upsertWithEmbedding('lucas-martin', 'people',
    'Lucas Martin, frère d\'Élodie. Développeur backend chez Doctolib. Vit à Paris. Anniversaire le 15 mars.',
    3);

  // ─── PROJECTS ───
  await upsertWithEmbedding('campagne-printemps-studio-vega', 'projects',
    'Campagne de printemps pour Studio Vega. 3 concepts validés par Thomas (directeur créatif). Budget total: 15000€. Deadline: 15 mars 2026. Inclut affiches, bannières web, et posts réseaux sociaux. Concept retenu: "Renouveau Urbain".',
    10);

  await upsertWithEmbedding('rebranding-bionature', 'projects',
    'Rebranding complet de BioNature (cosmétiques bio). Nouveau logo, charte graphique, packaging 5 produits. Budget: 22000€. Livraison prévue fin avril 2026. Sophie Laurent est la cheffe de projet côté client. Phase actuelle: packaging.',
    7);

  await upsertWithEmbedding('site-web-artisan-dupont', 'projects',
    'Site web vitrine pour Artisan Dupont (boulangerie artisanale à Nantes). Maquettes Figma + intégration par Camille Petit. Budget: 3500€. Petit projet mais client sympa. Livraison: mars 2026.',
    3);

  await upsertWithEmbedding('formation-motion-design', 'projects',
    'Formation en motion design suivie par Élodie sur Domestika. 12 modules, actuellement au module 7. Objectif: pouvoir proposer des animations pour les réseaux sociaux. Temps estimé restant: 3 semaines.',
    4);

  await upsertWithEmbedding('portfolio-redesign', 'projects',
    'Refonte du portfolio personnel d\'Élodie. Migration de Squarespace vers un site custom (Next.js par Camille). Nouveau design minimaliste. En pause depuis janvier — priorité aux projets clients.',
    2);

  // ─── FACTS ───
  await upsertWithEmbedding('setup-materiel', 'facts',
    'Setup d\'Élodie: iMac 27 pouces (2023), iPad Pro avec Apple Pencil pour les croquis, écran secondaire Dell 24". Outils: Figma (maquettes), Adobe Illustrator (logos/vecteurs), Photoshop (retouche), After Effects (motion design en apprentissage).',
    3);

  await upsertWithEmbedding('tarifs-elodie', 'facts',
    'Grille tarifaire: logo simple 1500€, identité visuelle complète 4000-8000€, charte graphique 2500€, maquette web 800€/page, direction artistique 500€/jour. Tarifs révisés en janvier 2026.',
    4);

  await upsertWithEmbedding('studio-vega', 'facts',
    'Studio Vega: agence de publicité parisienne, 25 employés. Client régulier depuis 2024. 3 campagnes réalisées ensemble. Paiement à 30 jours. Thomas Renard est le contact principal.',
    6);

  await upsertWithEmbedding('bionature-entreprise', 'facts',
    'BioNature: marque de cosmétiques bio fondée en 2019, basée à Bordeaux. 12 produits en gamme. Positionnement premium éco-responsable. CA 2025: 2.3M€. Nouveau client d\'Élodie depuis septembre 2025.',
    3);

  await upsertWithEmbedding('urssaf-statut', 'facts',
    'Élodie est en micro-entreprise (auto-entrepreneur). Plafond CA: 77700€. CA 2025: 58000€. Envisage de passer en EURL en 2026 si le CA dépasse 65000€. Julie Moreau gère la compta.',
    2);

  await upsertWithEmbedding('coworking-nantes', 'facts',
    'Élodie fréquente le coworking "La Fabrique" à Nantes les mercredis. Y retrouve Marc Dubois parfois. Abonnement mensuel: 150€/mois.',
    2);

  // ─── PREFERENCES ───
  await upsertWithEmbedding('pref-communication', 'preferences',
    'Préfère les appels le matin (avant 11h). N\'aime pas les réunions qui traînent. Préfère Slack/email pour le suivi quotidien, appel pour les kick-off et les points importants.',
    3);

  await upsertWithEmbedding('pref-design', 'preferences',
    'Style de design: minimaliste, typographie forte, couleurs neutres avec une couleur d\'accent. Inspiration: studios scandinaves. Déteste le skeumorphisme et les dégradés flashy.',
    2);

  await upsertWithEmbedding('pref-musique-travail', 'preferences',
    'Écoute du lo-fi ou du jazz en travaillant. Playlist Spotify "Focus Flow". Ne supporte pas le silence complet ni les open spaces bruyants.',
    1);

  await upsertWithEmbedding('pref-outils', 'preferences',
    'Figma pour tout le design UI/web. Illustrator uniquement pour les logos vectoriels complexes. Notion pour la gestion de projet. Google Drive pour le partage client.',
    2);

  // ─── GOALS ───
  await upsertWithEmbedding('objectif-ca-2026', 'goals',
    'Objectif CA 2026: 70000€ (vs 58000€ en 2025). Levier: augmenter le panier moyen en proposant du motion design en complément. Passage en EURL si atteint.',
    3);

  await upsertWithEmbedding('objectif-motion-design', 'goals',
    'Maîtriser After Effects d\'ici juin 2026 pour proposer des animations comme service complémentaire. Formation Domestika en cours (module 7/12).',
    2);

  await upsertWithEmbedding('objectif-delegation', 'goals',
    'Déléguer plus de travail d\'intégration à Camille pour se concentrer sur le design pur et la direction artistique. Objectif: 3 projets délégués d\'ici été 2026.',
    1);

  // ─── TIMELINE ───
  const now = new Date();
  const addDays = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();

  await upsertWithEmbedding('deadline-studio-vega', 'timeline',
    'Deadline livraison campagne printemps Studio Vega: 15 mars 2026. Livrables: 5 affiches, 10 bannières web, 20 posts sociaux.',
    3);

  await upsertWithEmbedding('rdv-comptable-mars', 'timeline',
    'Rendez-vous trimestriel avec Julie Moreau (comptable) le 20 mars 2026 à 14h. Préparer: factures Q1, justificatifs, question sur passage EURL.',
    2);

  await upsertWithEmbedding('anniversaire-lucas', 'timeline',
    'Anniversaire de Lucas (frère d\'Élodie) le 15 mars. Idée cadeau: cours de cuisine japonaise à Paris (il adore la cuisine japonaise).',
    1);

  await upsertWithEmbedding('livraison-bionature-packaging', 'timeline',
    'Livraison maquettes packaging BioNature: fin mars 2026 (5 produits). Validation par Sophie Laurent attendue.',
    2);

  // ─── RELATIONS ───
  console.log('  Adding relations...');

  // Studio Vega network
  addRelation('campagne-printemps-studio-vega', 'studio-vega', 'involves');
  addRelation('campagne-printemps-studio-vega', 'thomas-renard', 'involves');
  addRelation('thomas-renard', 'studio-vega', 'involves');
  addRelation('deadline-studio-vega', 'campagne-printemps-studio-vega', 'depends_on');

  // BioNature network
  addRelation('rebranding-bionature', 'sophie-laurent', 'involves');
  addRelation('rebranding-bionature', 'bionature-entreprise', 'involves');
  addRelation('sophie-laurent', 'bionature-entreprise', 'involves');
  addRelation('livraison-bionature-packaging', 'rebranding-bionature', 'depends_on');

  // Collaborators
  addRelation('site-web-artisan-dupont', 'camille-petit', 'involves');
  addRelation('portfolio-redesign', 'camille-petit', 'involves');
  addRelation('objectif-delegation', 'camille-petit', 'involves');
  addRelation('marc-dubois', 'coworking-nantes', 'related_to');

  // Finance
  addRelation('objectif-ca-2026', 'urssaf-statut', 'related_to');
  addRelation('objectif-ca-2026', 'objectif-motion-design', 'related_to');
  addRelation('julie-moreau', 'urssaf-statut', 'related_to');
  addRelation('rdv-comptable-mars', 'julie-moreau', 'involves');
  addRelation('rdv-comptable-mars', 'urssaf-statut', 'related_to');

  // Motion design
  addRelation('objectif-motion-design', 'formation-motion-design', 'depends_on');
  addRelation('formation-motion-design', 'setup-materiel', 'related_to');

  // Family
  addRelation('anniversaire-lucas', 'lucas-martin', 'involves');

  // Cross-links
  addRelation('tarifs-elodie', 'objectif-ca-2026', 'related_to');

  // Refresh dirty embeddings (relations changed the context for many entries)
  console.log('  Refreshing contextual embeddings...');
  const dirtyKeys = getDirtyEmbeddingKeys();
  let refreshed = 0;
  for (const key of dirtyKeys) {
    const entry = getEntry(key);
    if (!entry) continue;
    const newText = buildEmbeddingText(key);
    if (entry.embedding_text === newText) continue;
    const emb = await generateEmbedding(newText);
    updateEmbedding(key, embeddingToBuffer(emb), newText);
    refreshed++;
  }
  console.log(`  ✓ Refreshed ${refreshed} embeddings with relation context`);

  checkpointWal();

  const total = getAllEntries().length;
  console.log(`  ✓ Seeded ${total} entries with relations`);
}

// ─── Test helpers ─────────────────────────────────────────────

async function testRag(
  testName: string,
  exchange: ExchangeMessage,
  recentExchanges: ExchangeMessage[],
  expectations: {
    minKeys?: number;
    expectedKeys?: string[];
    anyOfKeys?: string[];
    expectedPriority?: 'normal' | 'important' | 'critical';
    minPriority?: 'normal' | 'important' | 'critical';
  },
): Promise<RagResult> {
  testNum++;
  section(`Test ${testNum}: ${testName}`);
  console.log(`  User: "${exchange.user_message.slice(0, 80)}..."`);
  console.log(`  Recent exchanges: ${recentExchanges.length}`);

  const start = Date.now();
  const result = await runRagAgent(`test-${testNum}`, exchange, recentExchanges);
  const elapsed = Date.now() - start;

  console.log(`  Duration: ${elapsed}ms`);
  console.log(`  Priority: ${result.priority}`);
  console.log(`  Keys found: [${result.relevantKeys.join(', ')}]`);
  console.log(`  Reasoning: ${result.reasoning.slice(0, 150)}...`);

  if (expectations.minKeys !== undefined) {
    assert(result.relevantKeys.length >= expectations.minKeys,
      `Found >= ${expectations.minKeys} keys (got ${result.relevantKeys.length})`);
  }

  if (expectations.expectedKeys) {
    for (const key of expectations.expectedKeys) {
      assert(result.relevantKeys.includes(key),
        `Found expected key "${key}"`);
    }
  }

  if (expectations.anyOfKeys) {
    const found = expectations.anyOfKeys.some(k => result.relevantKeys.includes(k));
    assert(found,
      `Found at least one of [${expectations.anyOfKeys.join(', ')}]`);
  }

  if (expectations.expectedPriority) {
    assert(result.priority === expectations.expectedPriority,
      `Priority is "${expectations.expectedPriority}" (got "${result.priority}")`);
  }

  if (expectations.minPriority) {
    const levels = { normal: 0, important: 1, critical: 2 };
    assert(levels[result.priority] >= levels[expectations.minPriority],
      `Priority >= "${expectations.minPriority}" (got "${result.priority}")`);
  }

  return result;
}

function makeExchange(user: string, assistant: string, conversation = 'Pro'): ExchangeMessage {
  return {
    channel: 'pwa',
    conversation_name: conversation,
    user_message: user,
    assistant_response: assistant,
    timestamp: new Date().toISOString(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  // Generate context file first (so RAG can compare)
  await generateMemoryContext();
  console.log('  ✓ Memory context generated');

  // ─── TEST 1: Direct entity mention ───
  // Simple: user mentions Thomas directly
  await testRag(
    'Direct entity mention — "Thomas"',
    makeExchange(
      'Thomas vient de m\'appeler, il veut qu\'on ajoute 2 affiches supplémentaires à la campagne.',
      'D\'accord ! Thomas Renard souhaite ajouter 2 affiches à la campagne de printemps Studio Vega. Je note ça.',
    ),
    [],
    {
      expectedKeys: ['thomas-renard', 'campagne-printemps-studio-vega'],
      minKeys: 2,
    },
  );

  // ─── TEST 2: Indirect reference (pronoun) ───
  // User says "elle" referring to Sophie from previous exchanges
  const recentSophie: ExchangeMessage[] = [
    makeExchange(
      'J\'ai eu Sophie au téléphone ce matin.',
      'Sophie Laurent de BioNature ? Comment ça s\'est passé ?',
    ),
    makeExchange(
      'Oui, elle est contente du logo mais veut des retouches sur le packaging du sérum.',
      'Je note les retouches demandées sur le packaging du sérum BioNature.',
    ),
  ];

  await testRag(
    'Pronoun resolution — "elle veut changer la typo"',
    makeExchange(
      'Elle m\'a aussi dit que la typo du shampoing était trop fine, il faut l\'épaissir.',
      'Compris, Sophie veut une typo plus épaisse sur le packaging du shampoing BioNature.',
    ),
    recentSophie,
    {
      expectedKeys: ['sophie-laurent', 'rebranding-bionature'],
      anyOfKeys: ['bionature-entreprise'],
    },
  );

  // ─── TEST 3: Cross-entity connection ───
  // Mentions two unrelated people — should find both networks
  await testRag(
    'Cross-entity — Marc et Camille on the same project',
    makeExchange(
      'Je pense faire appel à Marc pour le shooting et Camille pour l\'intégration du site Artisan Dupont.',
      'Bonne idée ! Marc Dubois pour les photos produit et Camille Petit pour l\'intégration web du site Artisan Dupont. Je peux t\'aider à les contacter ?',
    ),
    [],
    {
      expectedKeys: ['marc-dubois', 'camille-petit', 'site-web-artisan-dupont'],
      minKeys: 3,
    },
  );

  // ─── TEST 4: Financial context pull ───
  // Mentions money — should pull tarifs, CA, URSSAF context
  await testRag(
    'Financial context — revenue discussion',
    makeExchange(
      'Je suis à combien de CA cette année déjà ? Je me demande si je dois augmenter mes tarifs.',
      'Tu étais à 58000€ en 2025 avec un objectif de 70000€ pour 2026. On peut regarder ta grille tarifaire si tu veux.',
    ),
    [],
    {
      anyOfKeys: ['objectif-ca-2026', 'tarifs-elodie', 'urssaf-statut'],
      minKeys: 2,
    },
  );

  // ─── TEST 5: Implicit entity — no name mentioned ───
  // Mentions "la formation" without specifying which one
  await testRag(
    'Implicit entity — "la formation"',
    makeExchange(
      'J\'ai avancé sur la formation ce weekend, j\'ai fini 2 modules d\'un coup !',
      'Super ! Tu progresses bien sur la formation motion design. Tu en es à quel module maintenant ?',
    ),
    [],
    {
      expectedKeys: ['formation-motion-design'],
      anyOfKeys: ['objectif-motion-design'],
    },
  );

  // ─── TEST 6: Deep relation chain ───
  // Mentions deadline → should find project → people → company
  await testRag(
    'Deep relation chain — deadline reference',
    makeExchange(
      'Il me reste combien de temps pour la deadline du 15 mars ?',
      'La deadline du 15 mars concerne la campagne de printemps Studio Vega. Il te reste environ 4 semaines.',
    ),
    [],
    {
      expectedKeys: ['deadline-studio-vega', 'campagne-printemps-studio-vega'],
      anyOfKeys: ['thomas-renard', 'studio-vega'],
      minKeys: 3,
    },
  );

  // ─── TEST 7: Multiple conversations — family context ───
  // From a personal conversation, mentions brother
  await testRag(
    'Personal context — brother birthday',
    makeExchange(
      'L\'anniversaire de mon frère approche, faut que je trouve un cadeau.',
      'C\'est vrai, l\'anniversaire de Lucas approche ! Tu as une idée de cadeau ?',
      'Perso',
    ),
    [],
    {
      expectedKeys: ['lucas-martin', 'anniversaire-lucas'],
    },
  );

  // ─── TEST 8: Contradictory info detection ───
  // User says budget changed — should detect conflict with stored data
  // First, wipe context to force RAG to see the difference
  await testRag(
    'Contradiction detection — budget change',
    makeExchange(
      'Thomas m\'a dit que le budget de la campagne passe à 20000€ finalement, ils ajoutent des vidéos.',
      'Le budget de la campagne Studio Vega passe de 15000€ à 20000€ avec l\'ajout de vidéos. C\'est une belle augmentation !',
    ),
    [],
    {
      expectedKeys: ['campagne-printemps-studio-vega'],
      anyOfKeys: ['thomas-renard', 'studio-vega'],
      minPriority: 'important',
    },
  );

  // ─── TEST 9: Unknown entity (should return normal) ───
  await testRag(
    'Unknown entity — nothing in DB',
    makeExchange(
      'J\'ai rencontré un nouveau client potentiel, Alexandre Fontaine de la startup GreenTech.',
      'Intéressant ! Alexandre Fontaine de GreenTech. Quel type de projet cherche-t-il ?',
    ),
    [],
    {
      expectedPriority: 'normal',
    },
  );

  // ─── TEST 10: Coworking + collaborator overlap ───
  await testRag(
    'Location context — coworking + Marc',
    makeExchange(
      'Demain c\'est mercredi, je vais bosser à La Fabrique. Marc sera là aussi normalement.',
      'Chouette, tu pourras peut-être discuter du shooting avec Marc au coworking !',
    ),
    [],
    {
      expectedKeys: ['coworking-nantes', 'marc-dubois'],
    },
  );

  // ─── TEST 11: Comptable + URSSAF + timeline ───
  // Complex: multiple related entities through relations
  await testRag(
    'Multi-hop relations — comptable + URSSAF + RDV',
    makeExchange(
      'Faut que je prépare mon rendez-vous avec ma comptable, c\'est bientôt.',
      'Le prochain rendez-vous avec Julie Moreau est prévu le 20 mars. Tu veux qu\'on prépare les documents ?',
    ),
    [],
    {
      expectedKeys: ['julie-moreau', 'rdv-comptable-mars'],
      anyOfKeys: ['urssaf-statut'],
      minKeys: 2,
    },
  );

  // ─── TEST 12: Rich conversation context (many recent exchanges) ───
  const richHistory: ExchangeMessage[] = [
    makeExchange('Salut ! Comment va ?', 'Salut Élodie ! Tout va bien, quoi de neuf ?'),
    makeExchange('Je suis débordée avec Studio Vega en ce moment.', 'La campagne de printemps avance bien ?'),
    makeExchange('Oui mais Thomas me rajoute des trucs tout le temps.', 'C\'est vrai que Thomas Renard est assez exigeant sur les détails.'),
    makeExchange('Et en plus j\'ai BioNature qui m\'envoie des retours.', 'Sophie Laurent t\'a envoyé ses retours sur le packaging ?'),
    makeExchange('Oui, 3 pages de commentaires...', 'Courage ! On priorise quoi en premier ?'),
  ];

  await testRag(
    'Rich history — multiple project discussion',
    makeExchange(
      'Bon, je priorise Studio Vega vu la deadline. BioNature c\'est moins urgent.',
      'Bonne stratégie ! La deadline Studio Vega est le 15 mars, BioNature c\'est fin avril. On s\'y met ?',
    ),
    richHistory,
    {
      expectedKeys: ['campagne-printemps-studio-vega'],
      anyOfKeys: ['rebranding-bionature', 'deadline-studio-vega'],
      minKeys: 3,
    },
  );
}

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🧪 RAG Agent Stress Test');
  console.log('========================\n');

  // Clean start
  const dbPath = MEMORY_DB_PATH;
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    // Also clean WAL/SHM
    for (const ext of ['-wal', '-shm']) {
      const p = dbPath + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  initMemoryDatabase();
  console.log('✓ Fresh database initialized\n');

  await seedDatabase();
  await runTests();

  // ─── Summary ───
  console.log('\n' + '═'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  if (failed > 0) {
    console.log('⚠️  Some tests failed!');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
  }

  closeMemoryDatabase();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
