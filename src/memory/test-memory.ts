/**
 * Memory system test script.
 * Tests DB operations, embeddings, MCP tools, and the full context agent pipeline.
 *
 * Usage: npx tsx --env-file=.env src/memory/test-memory.ts [layer]
 *   layer: "db" | "tools" | "agent" | "all" (default: "all")
 */

import fs from 'fs';
import path from 'path';

import { MEMORY_DIR, MEMORY_DB_PATH, GROUPS_DIR } from '../config.js';
import {
  initMemoryDatabase,
  getEntry,
  upsertEntry,
  bumpMention,
  searchByEmbedding,
  getRelations,
  addRelation,
  removeRelation,
  listCategory,
  getAllEntries,
  closeMemoryDatabase,
  checkpointWal,
} from './db.js';
import { generateEmbedding, embeddingToBuffer } from './embeddings.js';
import { createMemoryMcpServer } from './tools.js';
import { generateMemoryContext } from './generate-context.js';
import type { ExchangeMessage } from './types.js';

// ─── Helpers ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n━━━ ${title} ━━━`);
}

function cleanTestDb(): void {
  // Remove test DB if it exists
  if (fs.existsSync(MEMORY_DB_PATH)) {
    fs.unlinkSync(MEMORY_DB_PATH);
  }
  // Also clean WAL/SHM files
  for (const ext of ['-wal', '-shm']) {
    const f = MEMORY_DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // Remove session file so agent starts fresh
  const sessionFile = path.join(MEMORY_DIR, '.session');
  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile);
  }
}

// ─── Layer 1: Database Operations ──────────────────────────────

async function testDatabase(): Promise<void> {
  section('Layer 1: Database Operations');

  // Create entries in each category
  console.log('\n[Create entries]');
  upsertEntry({
    category: 'user',
    key: 'profil',
    content: 'Michael, développeur, habite à Paris. Travaille sur NanoClaw.',
    origin_type: 'user_statement',
    origin_summary: 'Se présente',
  });
  const userEntry = getEntry('profil');
  assert(userEntry !== null, 'User entry created');
  assert(userEntry!.category === 'user', 'Correct category');
  assert(userEntry!.mention_count === 1, 'mention_count = 1');
  assert(userEntry!.status === 'active', 'Default status = active');

  upsertEntry({
    category: 'people',
    key: 'marie',
    content: 'Épouse de Michael. Travaille en marketing digital. Aime la cuisine italienne.',
    origin_type: 'conversation',
  });
  assert(getEntry('marie') !== null, 'People entry created');

  upsertEntry({
    category: 'goals',
    key: 'cadeau-marie',
    content: 'Trouver un cadeau d\'anniversaire pour Marie. Anniversaire le 15 mars.',
    origin_type: 'conversation',
    origin_summary: 'Discussion sur l\'anniversaire de Marie',
  });
  assert(getEntry('cadeau-marie') !== null, 'Goals entry created');

  upsertEntry({
    category: 'preferences',
    key: 'typescript',
    content: 'Préfère TypeScript à JavaScript. Utilise Zod pour la validation.',
    origin_type: 'inferred',
  });

  upsertEntry({
    category: 'facts',
    key: 'wifi-maison',
    content: 'Le code WiFi de la maison est "Soleil2024!".',
    origin_type: 'user_statement',
  });

  upsertEntry({
    category: 'projects',
    key: 'nanoclaw-memory',
    content: 'Système de mémoire pour NanoClaw. Utilise SQLite avec embeddings vectoriels.',
    origin_type: 'conversation',
  });

  upsertEntry({
    category: 'timeline',
    key: 'dentiste-20-fev',
    content: 'Rendez-vous dentiste le 20 février à 14h.',
    origin_type: 'user_statement',
  });

  const all = getAllEntries();
  assert(all.length === 7, `7 entries total (got ${all.length})`);

  // Upsert existing entry (should update, not create)
  console.log('\n[Upsert existing]');
  upsertEntry({
    category: 'people',
    key: 'marie',
    content: 'Épouse de Michael. Travaille en marketing digital chez L\'Oréal. Aime la cuisine italienne et le yoga.',
    origin_type: 'conversation',
  });
  const marieUpdated = getEntry('marie');
  assert(marieUpdated!.mention_count === 2, 'mention_count incremented to 2');
  assert(marieUpdated!.content.includes('L\'Oréal'), 'Content updated');
  assert(getAllEntries().length === 7, 'No duplicate entry created');

  // Bump mention
  console.log('\n[Bump mention]');
  const before = getEntry('typescript');
  bumpMention('typescript');
  const after = getEntry('typescript');
  assert(after!.mention_count === before!.mention_count + 1, 'mention_count bumped');
  assert(after!.content === before!.content, 'Content unchanged after bump');
  assert(!bumpMention('nonexistent-key'), 'Bump returns false for missing key');

  // Relations
  console.log('\n[Relations]');
  const relResult = addRelation('cadeau-marie', 'marie', 'involves');
  assert(!relResult.error, 'Relation created successfully');
  addRelation('nanoclaw-memory', 'profil', 'related_to');

  const relations = getRelations('cadeau-marie');
  assert(relations.length === 1, 'One relation for cadeau-marie');
  assert(relations[0].target_key === 'marie', 'Relation target is marie');
  assert(relations[0].relation_type === 'involves', 'Relation type is involves');

  // Bidirectional lookup
  const marieRels = getRelations('marie');
  assert(marieRels.length === 1, 'marie has 1 relation (reverse lookup)');

  // Invalid relation
  const badResult = addRelation('cadeau-marie', 'nonexistent', 'involves');
  assert(badResult.error !== undefined, 'Error for missing target key');

  // Remove relation
  const removed = removeRelation('cadeau-marie', 'marie');
  assert(removed, 'Relation removed');
  assert(getRelations('cadeau-marie').length === 0, 'No relations after removal');

  // Re-add for later tests
  addRelation('cadeau-marie', 'marie', 'involves');

  // List category (score ordering)
  console.log('\n[List category]');
  // Bump nanoclaw-memory a few times to make it score higher
  for (let i = 0; i < 5; i++) bumpMention('nanoclaw-memory');
  const projects = listCategory('projects', 10);
  assert(projects.length === 1, 'One project entry');
  assert(projects[0].key === 'nanoclaw-memory', 'Project found');
  assert(projects[0].mention_count === 6, 'Correct mention count (1 + 5 bumps)');

  const goals = listCategory('goals', 10);
  assert(goals.length === 1, 'One active goal');

  console.log('\n[Database tests done]');
}

// ─── Layer 1b: Embeddings + Vector Search ──────────────────────

async function testEmbeddings(): Promise<void> {
  section('Layer 1b: Embeddings & Vector Search');

  // Ensure test entries exist (in case embeddings test runs standalone)
  const seedEntries: Array<{ category: any; key: string; content: string }> = [
    { category: 'people', key: 'marie', content: 'Épouse de Michael. Travaille en marketing.' },
    { category: 'goals', key: 'cadeau-marie', content: 'Trouver un cadeau d\'anniversaire pour Marie.' },
    { category: 'preferences', key: 'typescript', content: 'Préfère TypeScript à JavaScript.' },
    { category: 'projects', key: 'nanoclaw-memory', content: 'Système de mémoire pour NanoClaw avec SQLite.' },
    { category: 'facts', key: 'wifi-maison', content: 'Le code WiFi de la maison est Soleil2024.' },
  ];
  for (const entry of seedEntries) {
    if (!getEntry(entry.key)) {
      upsertEntry({ ...entry, origin_type: 'conversation' });
    }
  }

  // Generate embeddings for entries
  console.log('\n[Generate embeddings]');
  for (const { key, content } of seedEntries) {
    const embedding = await generateEmbedding(content);
    assert(embedding.length === 1536, `Embedding for "${key}" has 1536 dimensions`);

    // Store embedding in DB
    upsertEntry({
      category: getEntry(key)!.category,
      key,
      content: getEntry(key)!.content,
      embedding: embeddingToBuffer(embedding),
    });
  }

  // Search by embedding
  console.log('\n[Vector search]');
  const queryEmb = await generateEmbedding('cadeau anniversaire');
  const results = searchByEmbedding(queryEmb, 3);
  assert(results.length > 0, 'Got search results');
  console.log('  Top 3 results for "cadeau anniversaire":');
  for (const r of results) {
    console.log(`    ${r.similarity.toFixed(3)} → ${r.key}: ${r.content.slice(0, 60)}...`);
  }
  assert(
    results[0].key === 'cadeau-marie' || results[0].key === 'marie',
    `Top result is relevant (got "${results[0].key}")`,
  );

  // Search with category filter
  const goalResults = searchByEmbedding(queryEmb, 3, 'goals');
  assert(goalResults.length === 1, 'Filtered to goals only');
  assert(goalResults[0].key === 'cadeau-marie', 'Found cadeau-marie in goals');

  // Search for something technical
  const techEmb = await generateEmbedding('programming language preferences');
  const techResults = searchByEmbedding(techEmb, 3);
  console.log('  Top 3 results for "programming language preferences":');
  for (const r of techResults) {
    console.log(`    ${r.similarity.toFixed(3)} → ${r.key}: ${r.content.slice(0, 60)}...`);
  }
  assert(
    techResults[0].key === 'typescript' || techResults[0].key === 'nanoclaw-memory',
    `Top tech result is relevant (got "${techResults[0].key}")`,
  );

  console.log('\n[Embedding tests done]');
}

// ─── Layer 2: Context Generation ───────────────────────────────

async function testContextGeneration(): Promise<void> {
  section('Layer 2: Context File Generation');

  // Ensure test entries exist
  if (!getEntry('profil')) {
    upsertEntry({ category: 'user', key: 'profil', content: 'Michael, développeur à Paris.', origin_type: 'user_statement' });
    upsertEntry({ category: 'people', key: 'marie', content: 'Épouse de Michael.', origin_type: 'conversation' });
    upsertEntry({ category: 'goals', key: 'cadeau-marie', content: 'Trouver un cadeau pour Marie.', origin_type: 'conversation' });
    upsertEntry({ category: 'projects', key: 'nanoclaw-memory', content: 'Système de mémoire NanoClaw.', origin_type: 'conversation' });
    upsertEntry({ category: 'preferences', key: 'typescript', content: 'Préfère TypeScript.', origin_type: 'inferred' });
    upsertEntry({ category: 'facts', key: 'wifi', content: 'Code WiFi: Soleil2024!', origin_type: 'user_statement' });
    upsertEntry({ category: 'timeline', key: 'dentiste', content: 'Dentiste le 20 février.', origin_type: 'user_statement' });
  }

  await generateMemoryContext();

  const contextFile = path.join(GROUPS_DIR, 'global', 'memory-context.md');
  assert(fs.existsSync(contextFile), 'memory-context.md created');

  const content = fs.readFileSync(contextFile, 'utf-8');
  console.log('\n--- Generated memory-context.md ---');
  console.log(content);
  console.log('--- End ---\n');

  assert(content.includes('# Memory Context'), 'Has header');
  assert(content.includes('## User'), 'Has User section');
  assert(content.includes('## Active Goals'), 'Has Goals section');
  assert(content.includes('## Current Projects'), 'Has Projects section');
  assert(content.includes('## People'), 'Has People section');
  assert(content.includes('cadeau-marie'), 'Contains cadeau-marie goal');
  assert(content.includes('nanoclaw-memory'), 'Contains nanoclaw-memory project');

  console.log('[Context generation tests done]');
}

// ─── Layer 3: Full Agent Pipeline ──────────────────────────────

async function testAgent(): Promise<void> {
  section('Layer 3: Full Context Agent Pipeline');

  const { initContextAgent, feedExchange, shutdownContextAgent } = await import('./context-agent.js');

  console.log('\n[Initializing context agent with clean DB]');
  await initContextAgent();

  // Wait a bit for agent to be ready
  await sleep(1000);

  // Test 1: Basic personal info
  console.log('\n[Test 1: Personal info exchange]');
  feedExchange({
    channel: 'pwa',
    conversation_name: 'Test',
    user_message: 'Je m\'appelle Thomas, j\'ai 32 ans et je vis à Lyon. Je suis ingénieur logiciel chez Dassault Systèmes.',
    assistant_response: 'Enchanté Thomas ! C\'est super que tu travailles chez Dassault Systèmes à Lyon. Comment je peux t\'aider ?',
    timestamp: new Date().toISOString(),
  });

  // Wait for agent to process
  console.log('  Waiting for agent to process...');
  await waitForProcessing(15000);
  dumpDb('After test 1');

  // Test 2: People info (should NOT mix with user profile)
  console.log('\n[Test 2: People info — should be separate from user]');
  feedExchange({
    channel: 'pwa',
    conversation_name: 'Test',
    user_message: 'Ma femme Sophie est prof de maths au lycée Ampère. Elle adore le jardinage.',
    assistant_response: 'C\'est noté ! Sophie, prof de maths au lycée Ampère, passionnée de jardinage. Je m\'en souviendrai.',
    timestamp: new Date().toISOString(),
  });

  await waitForProcessing(15000);
  dumpDb('After test 2');

  // Test 3: Goal with person relation (the golden rule test)
  console.log('\n[Test 3: Goal involving a person — golden rule]');
  feedExchange({
    channel: 'whatsapp-main',
    conversation_name: 'Main',
    user_message: 'Il faut que je trouve un cadeau d\'anniversaire pour Sophie, son anniversaire est le 20 mars.',
    assistant_response: 'Je vais t\'aider à trouver un cadeau pour Sophie ! Vu qu\'elle aime le jardinage, on pourrait chercher dans cette direction. Tu as un budget en tête ?',
    timestamp: new Date().toISOString(),
  });

  await waitForProcessing(15000);
  dumpDb('After test 3 — check: goal vs people separation, relation');

  // Test 4: Preferences
  console.log('\n[Test 4: Preferences]');
  feedExchange({
    channel: 'pwa',
    conversation_name: 'Dev',
    user_message: 'J\'utilise toujours Neovim pour coder, avec le thème Catppuccin. Et je préfère pnpm à npm.',
    assistant_response: 'Neovim + Catppuccin, excellent combo ! Et pnpm est effectivement plus rapide et efficace que npm.',
    timestamp: new Date().toISOString(),
  });

  await waitForProcessing(15000);
  dumpDb('After test 4');

  // Test 5: Purely technical exchange — should create minimal or no entries
  console.log('\n[Test 5: Technical exchange — should be quiet]');
  feedExchange({
    channel: 'pwa',
    conversation_name: 'Debug',
    user_message: 'Le build fail avec "Cannot find module \'./utils\'". Tu peux regarder ?',
    assistant_response: 'Le problème vient du fait que le fichier a été renommé en utils.ts mais l\'import utilise encore ./utils. Il faut mettre à jour l\'import en ./utils.js.',
    timestamp: new Date().toISOString(),
  });

  await waitForProcessing(15000);
  const entriesBefore = getAllEntries().length;
  dumpDb('After test 5 — technical exchange (should be minimal new entries)');

  // Test 6: Update existing info (should rewrite, not append)
  console.log('\n[Test 6: Update existing — should rewrite]');
  feedExchange({
    channel: 'pwa',
    conversation_name: 'Test',
    user_message: 'Au fait, Sophie a changé de lycée, elle est maintenant au lycée du Parc.',
    assistant_response: 'C\'est noté, Sophie est maintenant au lycée du Parc !',
    timestamp: new Date().toISOString(),
  });

  await waitForProcessing(15000);
  dumpDb('After test 6 — check: sophie entry rewritten (lycée du Parc), not appended');

  // Test 7: Timeline event
  console.log('\n[Test 7: Timeline event]');
  feedExchange({
    channel: 'whatsapp-main',
    conversation_name: 'Main',
    user_message: 'J\'ai rendez-vous chez le dentiste vendredi prochain à 10h.',
    assistant_response: 'C\'est noté ! Rendez-vous dentiste vendredi à 10h. Tu veux que je te le rappelle ?',
    timestamp: new Date().toISOString(),
  });

  await waitForProcessing(15000);
  dumpDb('After test 7');

  // Test 8: Multi-entity exchange
  console.log('\n[Test 8: Complex multi-entity exchange]');
  feedExchange({
    channel: 'pwa',
    conversation_name: 'Projet',
    user_message: 'Le projet NanoClaw avance bien, j\'ai fini le système de mémoire. Prochaine étape : intégrer les rappels via WhatsApp. Mon collègue Pierre m\'aide sur le déploiement Docker.',
    assistant_response: 'Super progression ! Le système de mémoire est bouclé. Pour les rappels WhatsApp, je peux t\'aider avec l\'intégration. Et c\'est bien d\'avoir Pierre pour le déploiement Docker.',
    timestamp: new Date().toISOString(),
  });

  await waitForProcessing(20000);
  dumpDb('After test 8 — multi-entity');

  // Test 9: Cross-conversation ambiguity (the "il/elle" trap)
  // Two conversations arrive in the same batch. One talks about a person,
  // the other uses "elle" without naming anyone. The agent should NOT
  // cross-contaminate.
  console.log('\n[Test 9: Cross-conversation ambiguity — batch from 2 conversations]');
  feedExchange({
    channel: 'pwa',
    conversation_name: 'Famille',
    user_message: 'Ma sœur Léa vient nous rendre visite ce weekend. Elle arrive samedi matin.',
    assistant_response: 'Super ! Léa arrive samedi matin. Tu veux que je te rappelle de préparer quelque chose ?',
    timestamp: new Date().toISOString(),
  });
  // This exchange is from a DIFFERENT conversation — "elle" here refers to
  // a code review, not Léa
  feedExchange({
    channel: 'pwa',
    conversation_name: 'Code Review',
    user_message: 'Elle plante au démarrage, tu peux regarder la stack trace ?',
    assistant_response: 'Je vois, l\'erreur vient de la connexion à la base de données. Le pool est mal configuré.',
    timestamp: new Date().toISOString(),
  });

  await waitForProcessing(20000);
  dumpDb('After test 9 — check: Léa created, "elle plante" NOT attributed to Léa');

  // Final: Generate context and show it
  console.log('\n[Generating final memory-context.md]');
  await generateMemoryContext();
  const contextFile = path.join(GROUPS_DIR, 'global', 'memory-context.md');
  if (fs.existsSync(contextFile)) {
    console.log('\n--- Final memory-context.md ---');
    console.log(fs.readFileSync(contextFile, 'utf-8'));
    console.log('--- End ---');
  }

  await shutdownContextAgent();
  console.log('\n[Agent tests done]');
}

// ─── Utilities ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProcessing(maxWaitMs: number): Promise<void> {
  const start = Date.now();
  const startCount = getAllEntries().length;

  // Wait for either new entries to appear or timeout
  while (Date.now() - start < maxWaitMs) {
    await sleep(2000);
    const current = getAllEntries().length;
    // If count changed and stabilized, we're probably done
    if (current > startCount) {
      // Wait a bit more for the agent to finish all tool calls
      await sleep(3000);
      break;
    }
  }
}

function dumpDb(label: string): void {
  console.log(`\n  ┌─ DB State: ${label}`);
  const entries = getAllEntries();
  for (const e of entries) {
    const rels = getRelations(e.key);
    const relStr = rels.length > 0
      ? ` [${rels.map((r) => `${r.source_key === e.key ? '→' : '←'}${r.source_key === e.key ? r.target_key : r.source_key}(${r.relation_type})`).join(', ')}]`
      : '';
    console.log(`  │ [${e.category}] ${e.key} (mentions: ${e.mention_count}, status: ${e.status})${relStr}`);
    console.log(`  │   "${e.content.slice(0, 100)}${e.content.length > 100 ? '...' : ''}"`);
  }
  console.log(`  └─ Total: ${entries.length} entries\n`);
}

// ─── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const layer = process.argv[2] || 'all';
  console.log(`\n🧪 Memory System Tests — layer: ${layer}\n`);

  // Clean up for fresh test
  cleanTestDb();
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  initMemoryDatabase();

  try {
    if (layer === 'db' || layer === 'all') {
      await testDatabase();
    }

    if (layer === 'embeddings' || layer === 'all') {
      await testEmbeddings();
    }

    if (layer === 'context' || layer === 'all') {
      await testContextGeneration();
    }

    if (layer === 'agent') {
      // Agent test needs a clean DB — it creates its own entries
      closeMemoryDatabase();
      cleanTestDb();
      // Agent will init its own DB
      await testAgent();
    }

    if (layer === 'all') {
      // For "all", run agent after other tests (separate DB)
      closeMemoryDatabase();
      cleanTestDb();
      await testAgent();
    }
  } finally {
    try { closeMemoryDatabase(); } catch { /* ignore */ }
  }

  console.log(`\n━━━ Results ━━━`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
