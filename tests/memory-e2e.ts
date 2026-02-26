/**
 * Memory System E2E Test — Organic conversations with Haiku simulator
 *
 * Creates realistic multi-conversation scenarios with a Haiku agent playing the user.
 * Sends messages via PWA API, gets real agent responses, then verifies memory state.
 *
 * Usage: npx tsx tests/memory-e2e.ts
 */

import fs from 'fs';
import path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Load .env manually (avoid dotenv dependency)
const envPath = path.resolve(import.meta.dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

const BASE_URL = `http://localhost:${process.env.WEB_PORT || 17285}`;
const TOKEN = process.env.DEV_TOKEN!;
const REPORT_PATH = path.resolve(import.meta.dirname, 'memory-e2e-report.md');
const LOG_PATH = path.resolve(import.meta.dirname, 'memory-e2e.log');

if (!TOKEN) {
  console.error('DEV_TOKEN not found in .env');
  process.exit(1);
}

// ==================== Helpers ====================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}`;
  process.stdout.write(line + '\n');
  // Also write to log file for non-TTY environments
  fs.appendFileSync(LOG_PATH, line + '\n');
}

const report: string[] = [];
function reportLine(line: string): void {
  report.push(line);
}

async function healthCheck(): Promise<void> {
  log('Checking server health...');
  try {
    const data = await apiGet('/api/health', 5000);
    if (data.status !== 'ok') throw new Error(`Unexpected health: ${JSON.stringify(data)}`);
    log('Server is healthy');
  } catch (err) {
    log(`Server not responding at ${BASE_URL} — is it running?`);
    process.exit(1);
  }
}

async function apiGet(urlPath: string, timeoutMs = 30_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GET ${urlPath} → ${res.status}: ${await res.text()}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function apiPost(urlPath: string, body?: any, timeoutMs = 60_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`POST ${urlPath} → ${res.status}: ${await res.text()}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ==================== API Wrappers ====================

async function deleteAllConversations(): Promise<void> {
  try {
    const data = await apiGet('/api/conversations', 15_000);
    const ids = data.conversations?.map((c: any) => c.jid) || [];
    if (ids.length > 0) {
      log(`Deleting ${ids.length} existing conversations...`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`${BASE_URL}/api/conversations`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
          signal: controller.signal,
        });
        if (res.ok) log(`Deleted ${ids.length} conversations`);
        else log(`Warning: bulk delete returned ${res.status}`);
      } finally {
        clearTimeout(timer);
      }
    } else {
      log('No existing conversations to delete');
    }
  } catch (err) {
    log(`Warning: could not delete conversations: ${err instanceof Error ? err.message : err}`);
  }
}

async function wipeMemory(): Promise<void> {
  // Delete all conversations first to stop new pipeline work
  await deleteAllConversations();

  // Wait for pipeline to be idle — calling wipe while processing freezes the server
  log('Waiting for pipeline idle before wipe...');
  await waitForPipeline();
  log('Pipeline idle, wiping memory...');
  await apiPost('/api/memory/wipe', undefined, 120_000);
  log('Memory wiped');
}

async function createConversation(name: string): Promise<string> {
  const data = await apiPost('/api/conversations', { name });
  log(`Created conversation: ${name} → ${data.jid}`);
  return data.jid;
}

async function sendMessage(convId: string, content: string): Promise<string> {
  const now = new Date().toISOString();
  await apiPost(`/api/conversations/${convId}/messages`, { content });
  return now;
}

async function waitForAgentResponse(convId: string, since: string, timeoutMs = 180_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const data = await apiGet(`/api/conversations/${convId}/messages?since=${encodeURIComponent(since)}`, 15_000);
      const agentMsg = data.messages?.find((m: any) => !m.is_from_me);
      if (agentMsg) return agentMsg.content;
    } catch {
      // Server busy (context agent processing), retry
    }
    await sleep(3000);
  }
  throw new Error(`Agent response timeout after ${timeoutMs}ms for conv ${convId}`);
}

async function waitForPipeline(timeoutMs = 300_000): Promise<void> {
  // Wait for exchanges to be enqueued (gate Haiku takes a few seconds)
  log('Waiting 15s for exchanges to be enqueued...');
  await sleep(15_000);

  const start = Date.now();
  let lastLog = 0;
  // Require 2 consecutive idle checks to avoid false positives
  let consecutiveIdle = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await apiGet('/api/memory/status', 30_000);
      if (
        status.pendingRag === 0 &&
        status.queueLength === 0 &&
        !status.processing
      ) {
        consecutiveIdle++;
        if (consecutiveIdle >= 2) {
          log(`Pipeline idle (took ${Date.now() - start}ms)`);
          return;
        }
      } else {
        consecutiveIdle = 0;
        if (Date.now() - lastLog > 15_000) {
          log(`Pipeline busy: pendingRag=${status.pendingRag}, queue=${status.queueLength}, processing=${status.processing}`);
          lastLog = Date.now();
        }
      }
    } catch {
      consecutiveIdle = 0;
      // API call failed (server busy during context agent processing), retry
    }
    await sleep(5000);
  }
  throw new Error(`Pipeline idle timeout after ${timeoutMs}ms`);
}

async function getMemoryContext(): Promise<string> {
  const data = await apiGet('/api/memory/context');
  return data.content || '';
}

async function getTraces(convId?: string, limit = 100): Promise<any[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (convId) params.set('conversation', convId);
  const data = await apiGet(`/api/memory/traces?${params}`);
  return data.traces || [];
}

// ==================== Haiku User Simulator ====================

const SIMULATOR_SYSTEM_PROMPT = `Tu es Mathieu, 28 ans, développeur freelance React/Node à Lyon.
Ta copine : Clara (infirmière). Ton frère cadet : Hugo (étudiant en droit).
Ta mère : Françoise. Ton chat : Pixel.
Ton comptable : Laurent Dupuis (cabinet Dupuis et Fils, Lyon).

Tu parles à ton assistant personnel. Tu es naturel, décontracté, parfois tu fais
des fautes, tu utilises du langage familier. Tu ne mets pas toujours la ponctuation.

RÈGLES :
- Génère UNIQUEMENT le message de Mathieu, rien d'autre
- Pas de "Mathieu:" ni de guillemets autour du message
- Suis la directive donnée mais formule-la naturellement avec TES mots
- Adapte-toi aux réponses de l'assistant (ne répète pas ce qu'il sait déjà)
- Quand la directive dit "LONG message" ou "speech-to-text", fais au moins 150 mots avec hésitations, pas de ponctuation, digressions, répétitions
- Quand la directive dit "CORRECTION", sois explicite que tu annules/corriges l'info précédente
- Quand la directive dit "réponse courte" ou "brièvement", fais 1-5 mots maximum`;

async function generateUserMessage(
  history: { role: string; content: string }[],
  directive: string,
): Promise<string> {
  const historyBlock = history.length > 0
    ? history.map(m => `[${m.role}]: ${m.content}`).join('\n\n')
    : '(début de conversation)';

  const prompt = `Historique de la conversation :
${historyBlock}

---
DIRECTIVE pour ton prochain message : ${directive}

Génère le message de Mathieu.`;

  let result = '';

  for await (const message of query({
    prompt,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: SIMULATOR_SYSTEM_PROMPT,
      maxTurns: 1,
      tools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
    },
  })) {
    const msg = message as any;
    if (msg.type === 'result' && msg.subtype === 'success' && msg.result) {
      result = msg.result.trim();
    }
  }

  if (!result) throw new Error('Simulator returned empty message');
  return result;
}

// ==================== Scenarios ====================

interface Exchange {
  directive: string;
}

interface Scenario {
  name: string;
  convId: string;
  exchanges: Exchange[];
}

// ==================== Verification ====================

interface Check {
  label: string;
  type: 'contains' | 'notContains';
  terms: string[];
  // 'contains' = at least one term must be present
  // 'notContains' = none of the terms should be present
}

function verifyContext(context: string, checks: Check[]): { passed: number; failed: number; details: string[] } {
  const contextLower = context.toLowerCase();
  let passed = 0;
  let failed = 0;
  const details: string[] = [];

  for (const check of checks) {
    if (check.type === 'contains') {
      const found = check.terms.some(t => contextLower.includes(t.toLowerCase()));
      if (found) {
        passed++;
        details.push(`  ✓ ${check.label} — found`);
      } else {
        failed++;
        details.push(`  ✗ ${check.label} — NOT FOUND (searched: ${check.terms.join(', ')})`);
      }
    } else {
      const found = check.terms.some(t => contextLower.includes(t.toLowerCase()));
      if (!found) {
        passed++;
        details.push(`  ✓ ${check.label} — correctly absent`);
      } else {
        failed++;
        details.push(`  ✗ ${check.label} — SHOULD BE ABSENT but found`);
      }
    }
  }

  return { passed, failed, details };
}

// ==================== Exchange Runner ====================

async function runExchange(
  convId: string,
  exchangeNum: number,
  directive: string,
  history: { role: string; content: string }[],
): Promise<{ userMsg: string; agentResponse: string }> {
  const t0 = Date.now();

  // Generate user message via Haiku
  log(`E${exchangeNum}: Generating user message...`);
  const userMsg = await generateUserMessage(history, directive);
  const tGen = Date.now();
  log(`E${exchangeNum}: Generated (${tGen - t0}ms, ${userMsg.length} chars): ${userMsg.slice(0, 100)}...`);

  // Send to PWA
  const since = await sendMessage(convId, userMsg);
  log(`E${exchangeNum}: Sent to ${convId}`);

  // Wait for agent response
  const agentResponse = await waitForAgentResponse(convId, since);
  const tDone = Date.now();
  log(`E${exchangeNum}: Agent responded (${tDone - tGen}ms, ${agentResponse.length} chars): ${agentResponse.slice(0, 100)}...`);

  // Update history
  history.push({ role: 'user', content: userMsg });
  history.push({ role: 'assistant', content: agentResponse });

  return { userMsg, agentResponse };
}

// ==================== Main ====================

async function main() {
  const t0Global = Date.now();
  let totalPassed = 0;
  let totalFailed = 0;

  // Clear previous log
  fs.writeFileSync(LOG_PATH, '', 'utf-8');

  reportLine('# Memory E2E Test Report');
  reportLine(`\nStarted: ${new Date().toISOString()}\n`);

  // --- Phase 0: Setup ---
  log('=== Phase 0: Setup ===');
  await healthCheck();

  // Parse --from-phase N to resume from a specific phase
  const fromPhaseArg = process.argv.find(a => a.startsWith('--from-phase='));
  const fromPhase = fromPhaseArg ? parseInt(fromPhaseArg.split('=')[1], 10) : 1;
  const skipWipe = process.argv.includes('--skip-wipe') || fromPhase > 1;

  if (skipWipe) {
    log(`Skipping wipe (resuming from phase ${fromPhase})`);
  } else {
    await wipeMemory();
    await sleep(2000);
  }

  const conv1 = await createConversation('Projet Bakery');
  const conv2 = await createConversation('Discussion perso');
  const conv3 = await createConversation('Finances');

  reportLine('## Setup');
  reportLine(`- conv1 (Projet Bakery): ${conv1}`);
  reportLine(`- conv2 (Discussion perso): ${conv2}`);
  reportLine(`- conv3 (Finances): ${conv3}`);
  if (fromPhase > 1) reportLine(`- Resuming from phase ${fromPhase}`);
  reportLine('');

  // Conversation histories (for the simulator)
  const history1: { role: string; content: string }[] = [];
  const history2: { role: string; content: string }[] = [];
  const history3: { role: string; content: string }[] = [];

  // ==================== Phase 1: Conv 1 — Exchanges 1-4 ====================
  if (fromPhase <= 1) {
  log('=== Phase 1: Conv 1 — Exchanges 1-4 ===');
  reportLine('## Phase 1: Projet Bakery — Premiers échanges (1-4)\n');

  const phase1Directives = [
    "Raconte que tu viens d'avoir Sylvain Moreau au téléphone, il veut un site e-commerce pour sa boulangerie 'Au Pain Doré', commande en ligne de gâteaux/pains, budget 5000€, tu vas le faire en Next.js + Stripe",
    "Parle des maquettes Figma que tu as faites, style rustique/artisanal, Sylvain a validé, tu commences le dev",
    "Fais un LONG message style speech-to-text (pas de ponctuation, hésitations, répétitions). Raconte ta galère avec Stripe Connect pour les paiements différés, 3h sur la doc, c'est complexe",
    "Sylvain t'a rappelé, il veut des créneaux de récupération pour les commandes (time slots)",
  ];

  for (let i = 0; i < phase1Directives.length; i++) {
    const { userMsg, agentResponse } = await runExchange(conv1, i + 1, phase1Directives[i], history1);
    reportLine(`### Exchange ${i + 1}\n`);
    reportLine(`**User:** ${userMsg}\n`);
    reportLine(`**Agent:** ${agentResponse}\n`);
  }

  // Wait for pipeline
  log('Waiting for pipeline...');
  await waitForPipeline();

  // Verify
  const ctx1 = await getMemoryContext();
  const v1 = verifyContext(ctx1, [
    { label: 'Sylvain in context', type: 'contains', terms: ['sylvain'] },
    { label: 'Au Pain Doré in context', type: 'contains', terms: ['au pain doré', 'pain-dore', 'pain doré', 'bakery', 'boulangerie'] },
    { label: '5000€ in context', type: 'contains', terms: ['5000', '5 000'] },
  ]);
  totalPassed += v1.passed;
  totalFailed += v1.failed;
  reportLine(`### Vérifications Phase 1\n`);
  reportLine(v1.details.join('\n'));
  reportLine('');
  } // end phase 1

  // ==================== Phase 2: Conv 1 — Exchanges 5-8 (correction) ====================
  if (fromPhase <= 2) {
  log('=== Phase 2: Conv 1 — Exchanges 5-8 (correction) ===');
  reportLine('## Phase 2: Projet Bakery — Correction (5-8)\n');

  const phase2Directives = [
    "Tu as trouvé la lib cal.com open source, elle s'intègre bien avec Next.js pour les time slots",
    "**CORRECTION** : Oublie cal.com, c'est une usine à gaz, trop de dépendances. Tu fais un truc custom avec date-fns",
    "Deadline fixée au 20 mars, Sylvain part en vacances après. Il reste 2 semaines",
    "Le site est quasi fini, reste les tests de paiement Stripe en mode test + déploiement sur Vercel",
  ];

  for (let i = 0; i < phase2Directives.length; i++) {
    const num = i + 5;
    const { userMsg, agentResponse } = await runExchange(conv1, num, phase2Directives[i], history1);
    reportLine(`### Exchange ${num}\n`);
    reportLine(`**User:** ${userMsg}\n`);
    reportLine(`**Agent:** ${agentResponse}\n`);
  }

  log('Waiting for pipeline...');
  await waitForPipeline();

  const ctx2 = await getMemoryContext();
  const v2 = verifyContext(ctx2, [
    { label: 'cal.com ABSENT from context', type: 'notContains', terms: ['cal.com'] },
    { label: 'Deadline 20 mars in context', type: 'contains', terms: ['20 mars', '20/03', 'deadline'] },
  ]);
  totalPassed += v2.passed;
  totalFailed += v2.failed;
  reportLine(`### Vérifications Phase 2\n`);
  reportLine(v2.details.join('\n'));
  reportLine('');
  } // end phase 2

  // ==================== Phase 3: Conv 2 — Exchanges 9-14 (vie perso) ====================
  if (fromPhase <= 3) {
  log('=== Phase 3: Conv 2 — Exchanges 9-14 (vie perso) ===');
  reportLine('## Phase 3: Vie perso (9-14)\n');

  const phase3Directives = [
    "La mère de Clara est malade (pas grave mais inquiétant), Clara part à Bordeaux ce weekend pour la voir",
    "Hugo passe ses partiels de droit, il est méga stressé. Tu l'as invité à venir bosser chez toi pour changer d'air",
    "L'agent va probablement te poser une question ou faire un commentaire sur Hugo ou la situation. Réponds brièvement, juste 'oui' ou une confirmation très courte (1-5 mots maximum). C'est tout.",
    "Ta mère Françoise veut organiser les 30 ans de Clara le 12 avril. Elle hésite entre un resto et un weekend surprise quelque part",
    "Demande à l'agent s'il se souvient du prénom de la mère de Clara. Tu ne l'as jamais mentionné encore, c'est une question test",
    "LONG message speech-to-text. La mère de Clara s'appelle Monique, elle est à l'hôpital Henri Mondor à Bordeaux. Clara doit poser un jour lundi pour y retourner. Ajoute du bruit typique STT (hésitations, pas de ponctuation, digressions sur la route, la fatigue de Clara)",
  ];

  for (let i = 0; i < phase3Directives.length; i++) {
    const num = i + 9;
    const { userMsg, agentResponse } = await runExchange(conv2, num, phase3Directives[i], history2);
    reportLine(`### Exchange ${num}\n`);
    reportLine(`**User:** ${userMsg}\n`);
    reportLine(`**Agent:** ${agentResponse}\n`);
  }

  log('Waiting for pipeline...');
  await waitForPipeline();

  const ctx3 = await getMemoryContext();
  const v3 = verifyContext(ctx3, [
    { label: 'Monique in context', type: 'contains', terms: ['monique'] },
    { label: '12 avril in context', type: 'contains', terms: ['12 avril', '12/04', 'anniversaire'] },
    { label: 'Hugo in context', type: 'contains', terms: ['hugo'] },
    { label: 'Clara in context', type: 'contains', terms: ['clara'] },
  ]);
  totalPassed += v3.passed;
  totalFailed += v3.failed;
  reportLine(`### Vérifications Phase 3\n`);
  reportLine(v3.details.join('\n'));

  // Check traces for exchange 11 (short response gate)
  const traces = await getTraces(conv2);
  const shortResponseTraces = traces.filter(t => {
    const userMsg = t.exchange?.userMessage?.toLowerCase() || '';
    return userMsg.length < 20; // Short messages
  });
  if (shortResponseTraces.length > 0) {
    reportLine(`\n**Gate decisions for short responses:**`);
    for (const t of shortResponseTraces) {
      reportLine(`- "${t.exchange?.userMessage}" → gate: ${t.rag ? 'PROCESS' : 'SKIP'}`);
    }
  }
  reportLine('');
  } // end phase 3

  // ==================== Phase 4: Conv 3 — Exchanges 15-18 (finance) ====================
  if (fromPhase <= 4) {
  log('=== Phase 4: Conv 3 — Exchanges 15-18 (finance) ===');
  reportLine('## Phase 4: Finance (15-18)\n');

  const phase4Directives = [
    "Tu dois facturer MétalPro, 3200€ HT. Le contact chez eux c'est Pierre Blanc",
    "Tu as reçu un virement de DataSoft, 4800€. Ça correspond à la facture du mois dernier",
    "Ton comptable Laurent t'a dit que tu as dépassé le seuil de TVA, faut passer au régime réel simplifié",
    "Précise que ton comptable c'est Laurent Dupuis, cabinet Dupuis et Fils à Lyon, ça fait 2 ans que tu bosses avec lui",
  ];

  for (let i = 0; i < phase4Directives.length; i++) {
    const num = i + 15;
    const { userMsg, agentResponse } = await runExchange(conv3, num, phase4Directives[i], history3);
    reportLine(`### Exchange ${num}\n`);
    reportLine(`**User:** ${userMsg}\n`);
    reportLine(`**Agent:** ${agentResponse}\n`);
  }

  log('Waiting for pipeline...');
  await waitForPipeline();

  const ctx4 = await getMemoryContext();
  const v4 = verifyContext(ctx4, [
    { label: 'Laurent Dupuis in context', type: 'contains', terms: ['dupuis', 'laurent dupuis', 'laurent-dupuis'] },
    { label: '3200€ in context', type: 'contains', terms: ['3200', '3 200'] },
    { label: '4800€ in context', type: 'contains', terms: ['4800', '4 800'] },
  ]);
  totalPassed += v4.passed;
  totalFailed += v4.failed;
  reportLine(`### Vérifications Phase 4\n`);
  reportLine(v4.details.join('\n'));
  reportLine('');
  } // end phase 4

  // ==================== Phase 5: Conv 2 — Exchanges 19-22 (quotidien) ====================
  if (fromPhase <= 5) {
  log('=== Phase 5: Conv 2 — Exchanges 19-22 (quotidien) ===');
  reportLine('## Phase 5: Quotidien (19-22) — dans conv2\n');

  const phase5Directives = [
    "Pixel (ton chat) a vomi, tu l'as amené chez le véto Dr Martinez. C'était une boule de poils, rien de grave",
    "Les résultats du véto sont OK. Dr Martinez a recommandé des croquettes Royal Canin Hairball Care",
    "Tu t'es inscrit à la salle de sport FitLyon, 35€/mois, tu y vas les mardis et jeudis matin",
    "Clara rentre demain, sa mère Monique va beaucoup mieux. Update la situation",
  ];

  for (let i = 0; i < phase5Directives.length; i++) {
    const num = i + 19;
    const { userMsg, agentResponse } = await runExchange(conv2, num, phase5Directives[i], history2);
    reportLine(`### Exchange ${num}\n`);
    reportLine(`**User:** ${userMsg}\n`);
    reportLine(`**Agent:** ${agentResponse}\n`);
  }

  log('Waiting for pipeline...');
  await waitForPipeline();

  const ctx5 = await getMemoryContext();
  const v5 = verifyContext(ctx5, [
    { label: 'Pixel in context', type: 'contains', terms: ['pixel'] },
    { label: 'Monique still in context', type: 'contains', terms: ['monique'] },
    { label: 'FitLyon or salle de sport in context', type: 'contains', terms: ['fitlyon', 'fit lyon', 'salle de sport', 'sport'] },
  ]);
  totalPassed += v5.passed;
  totalFailed += v5.failed;
  reportLine(`### Vérifications Phase 5\n`);
  reportLine(v5.details.join('\n'));
  reportLine('');
  } // end phase 5

  // ==================== Phase 6: Conv 1 — Exchanges 23-25 (futur) ====================
  if (fromPhase <= 6) {
  log('=== Phase 6: Conv 1 — Exchanges 23-25 (projets futurs) ===');
  reportLine('## Phase 6: Projets futurs (23-25) — dans conv1\n');

  const phase6Directives = [
    "Tu as une idée de SaaS : généraliser ce que tu as fait pour Au Pain Doré. Une plateforme de commandes pour tous les artisans alimentaires",
    "TRÈS LONG message avec tous les détails du SaaS : artisans alimentaires (boulangers, pâtissiers, traiteurs), setup en 10 min, gestion time slots, allergènes, paiement intégré. Pricing : 49€/mois. Objectif : 100 clients = 4900€ MRR. Tu veux un MVP en 2 mois",
    "Hugo connaît Kevin Roux qui fait du marketing digital. Kevin pourrait aider pour le lancement du SaaS. Tu veux les mettre en contact",
  ];

  for (let i = 0; i < phase6Directives.length; i++) {
    const num = i + 23;
    const { userMsg, agentResponse } = await runExchange(conv1, num, phase6Directives[i], history1);
    reportLine(`### Exchange ${num}\n`);
    reportLine(`**User:** ${userMsg}\n`);
    reportLine(`**Agent:** ${agentResponse}\n`);
  }

  log('Waiting for pipeline...');
  await waitForPipeline();

  const ctx6 = await getMemoryContext();
  const v6 = verifyContext(ctx6, [
    { label: 'SaaS in context', type: 'contains', terms: ['saas', 'plateforme commandes', 'artisan'] },
    { label: '49€/mois or MRR in context', type: 'contains', terms: ['49', 'mrr', '4900'] },
    { label: 'Kevin Roux in context', type: 'contains', terms: ['kevin'] },
  ]);
  totalPassed += v6.passed;
  totalFailed += v6.failed;
  reportLine(`### Vérifications Phase 6\n`);
  reportLine(v6.details.join('\n'));
  reportLine('');
  } // end phase 6

  // ==================== Phase 7: Recall Test ====================
  log('=== Phase 7: Recall Test ===');
  reportLine('## Phase 7: Test de rappel\n');

  const recallTests = [
    { convId: conv1, history: history1, question: 'le site du boulanger ça avance ?', expectTerms: ['sylvain', '20 mars', 'vercel', 'stripe'] },
    { convId: conv2, history: history2, question: 'des nouvelles de la mère de Clara ?', expectTerms: ['monique', 'henri mondor', 'bordeaux', 'mieux'] },
    { convId: conv3, history: history3, question: 'combien m\'a payé DataSoft déjà ?', expectTerms: ['4800', '4 800'] },
    { convId: conv1, history: history1, question: 'l\'idée de SaaS tu te souviens des chiffres ?', expectTerms: ['49', 'mrr', '100 clients', '4900'] },
    { convId: conv2, history: history2, question: 'Hugo connaît quelqu\'un en marketing non ?', expectTerms: ['kevin', 'roux'] },
  ];

  for (let i = 0; i < recallTests.length; i++) {
    const test = recallTests[i];
    log(`Recall ${i + 1}: "${test.question}"`);

    const since = await sendMessage(test.convId, test.question);
    const response = await waitForAgentResponse(test.convId, since);

    test.history.push({ role: 'user', content: test.question });
    test.history.push({ role: 'assistant', content: response });

    const responseLower = response.toLowerCase();
    const foundTerms = test.expectTerms.filter(t => responseLower.includes(t.toLowerCase()));
    const score = foundTerms.length + '/' + test.expectTerms.length;

    reportLine(`### Recall ${i + 1}: "${test.question}"\n`);
    reportLine(`**Agent:** ${response}\n`);
    reportLine(`**Expected terms:** ${test.expectTerms.join(', ')}`);
    reportLine(`**Found:** ${foundTerms.join(', ') || 'none'} (${score})\n`);

    log(`Recall ${i + 1}: ${score} terms found`);
  }

  // Wait for any remaining pipeline work from recall questions
  await waitForPipeline();

  // ==================== Phase 8: Final Report ====================
  log('=== Phase 8: Final Report ===');
  reportLine('## Phase 8: Rapport final\n');

  // Memory context dump
  const finalContext = await getMemoryContext();
  reportLine('### Memory Context (final)\n');
  reportLine('```');
  reportLine(finalContext);
  reportLine('```\n');

  // Traces summary
  const allTraces = await getTraces(undefined, 500);
  reportLine(`### Traces: ${allTraces.length} total\n`);

  const gateSkips = allTraces.filter(t => !t.rag);
  const gateProcessed = allTraces.filter(t => t.rag);
  reportLine(`- Gate SKIP: ${gateSkips.length}`);
  reportLine(`- Gate PROCESS: ${gateProcessed.length}`);

  if (gateProcessed.length > 0) {
    const totalRagCost = gateProcessed.reduce((sum: number, t: any) => sum + (t.rag?.costUsd || 0), 0);
    const totalRagTime = gateProcessed.reduce((sum: number, t: any) => sum + (t.rag?.durationMs || 0), 0);
    reportLine(`- RAG total cost: $${totalRagCost.toFixed(3)}`);
    reportLine(`- RAG total time: ${(totalRagTime / 1000).toFixed(1)}s (avg ${(totalRagTime / gateProcessed.length / 1000).toFixed(1)}s)`);
  }

  reportLine('');

  // Final summary
  const totalTime = Date.now() - t0Global;
  reportLine('### Résumé\n');
  reportLine(`- **Durée totale:** ${(totalTime / 60000).toFixed(1)} minutes`);
  reportLine(`- **Vérifications:** ${totalPassed} PASS, ${totalFailed} FAIL`);
  reportLine(`- **Traces:** ${allTraces.length} (${gateProcessed.length} processed, ${gateSkips.length} skipped)`);
  reportLine(`\nCompleted: ${new Date().toISOString()}`);

  // Write report
  fs.writeFileSync(REPORT_PATH, report.join('\n'), 'utf-8');
  log(`Report written to ${REPORT_PATH}`);
  log(`=== DONE: ${totalPassed} PASS, ${totalFailed} FAIL (${(totalTime / 60000).toFixed(1)} min) ===`);
}

main().catch(err => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
