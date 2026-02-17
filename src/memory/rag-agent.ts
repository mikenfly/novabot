import { query } from '@anthropic-ai/claude-agent-sdk';

import fs from 'fs';
import path from 'path';
import { MEMORY_DIR, RAG_MODEL, RAG_TIMEOUT } from '../config.js';
import { getMemoryContextContent } from './generate-context.js';
import { createMemoryMcpServer } from './tools.js';
import type { ExchangeMessage } from './types.js';

// ==================== Types ====================

export interface RagResult {
  exchangeId: string;
  exchange: ExchangeMessage;
  priority: 'normal' | 'important' | 'critical';
  preContext: string;
  relevantKeys: string[];
  reasoning: string;
  timestamp: string;
}

// ==================== System prompt ====================

const RAG_AGENT_SYSTEM_PROMPT = `Tu es l'agent RAG de NanoClaw. Ta mission est de fouiller la base de mémoire pour trouver TOUTES les entrées pertinentes à un échange donné, AVANT que l'agent de contexte ne le traite.

## Ce que tu reçois

1. Un échange (user message + assistant response) à analyser
2. Les derniers échanges récents DE CETTE CONVERSATION (pour comprendre le fil de discussion)
3. Le contenu actuel de memory-context.md (ce que l'agent principal voit en ce moment)

## Ta mission

### Étape 1 — Extraire les entités et concepts
Lis l'échange ET les échanges récents pour identifier :
- Noms de personnes mentionnées (explicitement ou par pronoms — résous les pronoms avec le contexte)
- Sujets/projets discutés
- Préférences, faits, dates mentionnés
- Tout concept qui POURRAIT avoir une entrée en base
- Les entités implicites (ex: si on parle d'un "projet", chercher aussi le client associé)

### Étape 2 — Recherche agentique en profondeur (OBLIGATOIRE)

Tu dois explorer la base de manière EXHAUSTIVE. Procède en vagues :

**Vague 1 — Recherche initiale :**
Pour CHAQUE entité/concept identifié :
- \`search_memory\` avec le nom/concept comme query
- Essaie des variantes (nom complet, prénom seul, acronyme, synonymes)

**Vague 2 — Exploration des résultats :**
Les résultats de search_memory incluent automatiquement le contenu des entrées liées (depth=1). Analyse ces relations :
- Si des entrées liées semblent pertinentes mais leurs propres relations sont manquantes, relance \`search_memory\` avec \`depth=2\` ou \`depth=3\` pour voir les connexions plus profondes
- Utilise \`get_entry\` avec \`depth=2\` pour explorer des entrées spécifiques en profondeur
- Note les nouvelles entités/concepts découverts dans les relations

**Vague 3 — Recherches complémentaires :**
Pour chaque NOUVELLE entité/concept découvert dans les vagues précédentes :
- \`search_memory\` à nouveau
- Si les résultats semblent incomplets, augmente le depth (2 ou 3) pour ratisser plus large

**Critère d'arrêt :**
Continue les vagues TANT QUE :
- Tu découvres de nouvelles entités/concepts non encore cherchés
- Des relations pointent vers des entrées non encore chargées
- Tu n'as pas encore exploré tous les angles pertinents

Arrête-toi UNIQUEMENT quand tu es convaincu que toute recherche supplémentaire ne produirait pas de nouveaux résultats pertinents. En cas de doute, fais une recherche de plus.

### Étape 3 — Évaluer la priorité d'injection

Compare tes trouvailles avec le contenu de memory-context.md fourni.

Décide le niveau de priorité :

**normal** : Les informations trouvées sont déjà dans memory-context.md OU ne sont pas pertinentes à la conversation en cours. Le flux normal suffit.

**important** : Tu as trouvé des informations PERTINENTES à la conversation en cours qui ne sont PAS dans memory-context.md actuel. Exemples :
- L'utilisateur parle de quelqu'un et tu trouves des détails sur cette personne absents du contexte
- Un projet mentionné a des relations/détails importants non visibles
- Une préférence pertinente au sujet discuté n'est pas dans le contexte

**critical** : Tu as trouvé des informations CONTRADICTOIRES avec ce que l'agent principal semble croire, ou des informations URGENTES que l'agent principal est en train de répondre sans connaître. Exemples :
- L'agent répond avec des infos obsolètes (une personne a changé de rôle, une deadline a bougé)
- L'utilisateur demande quelque chose et l'agent ne sait pas qu'une réponse existe en mémoire
- Information critique sur une deadline imminente ou un changement récent

### Étape 4 — Produire le résultat

Ton DERNIER message doit être UNIQUEMENT un bloc JSON (pas de texte avant ou après) :

\`\`\`json
{
  "priority": "normal",
  "reasoning": "Explication concise de la décision de priorité",
  "relevant_entries": [
    {
      "key": "entry-key",
      "category": "category",
      "content_summary": "Résumé en 1-2 phrases",
      "relevance": "Pourquoi cette entrée est pertinente pour cet échange"
    }
  ],
  "missing_from_context": ["clés trouvées mais absentes de memory-context.md"],
  "pre_context": "Bloc de texte formaté listant les entrées pertinentes avec leur contenu complet et relations, prêt à être lu par l'agent de contexte"
}
\`\`\`

## Règles

- Tu n'as accès qu'aux outils de LECTURE (search, get, list). Tu ne peux PAS modifier la base.
- Sois EXHAUSTIF. Mieux vaut 10 recherches de trop qu'une recherche manquée.
- Si tu ne trouves rien de pertinent, retourne priority "normal" avec un pre_context vide.
- Le pre_context doit contenir le contenu COMPLET des entrées trouvées (pas juste un résumé), avec leurs relations.
- Ne fais PAS de bavardage. Fais tes recherches, puis produis le JSON.`;

// ==================== Execution ====================

export async function runRagAgent(
  exchangeId: string,
  exchange: ExchangeMessage,
  recentExchanges: ExchangeMessage[],
): Promise<RagResult> {
  const mcpServer = createMemoryMcpServer({ readOnly: true });
  const currentContext = getMemoryContextContent();

  const exchangeBlock = `<exchange channel="${exchange.channel}" conversation="${exchange.conversation_name}" time="${exchange.timestamp}">
<user>${exchange.user_message}</user>
<assistant>${exchange.assistant_response}</assistant>
</exchange>`;

  const recentBlock = recentExchanges.length > 0
    ? `<recent_exchanges>\n${recentExchanges.map(e =>
        `<exchange channel="${e.channel}" conversation="${e.conversation_name}" time="${e.timestamp}">
<user>${e.user_message}</user>
<assistant>${e.assistant_response}</assistant>
</exchange>`
      ).join('\n')}\n</recent_exchanges>`
    : '<recent_exchanges>Aucun échange récent.</recent_exchanges>';

  const memoryBlock = currentContext
    ? `<current_memory_context>\n${currentContext}\n</current_memory_context>`
    : '<current_memory_context>Vide — aucun contexte injecté actuellement.</current_memory_context>';

  const prompt = `Analyse cet échange :

${exchangeBlock}

Échanges récents (contexte conversationnel) :
${recentBlock}

Contexte mémoire actuel de l'agent principal :
${memoryBlock}`;

  // Run with timeout
  return Promise.race([
    executeRagQuery(exchangeId, exchange, prompt, mcpServer),
    new Promise<RagResult>((resolve) =>
      setTimeout(() => resolve(fallbackResult(exchangeId, exchange, 'RAG agent timed out')), RAG_TIMEOUT),
    ),
  ]);
}

const LOG_FILE = path.join(MEMORY_DIR, 'agent.log');

function ragLog(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] [rag] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // ignore
  }
}

async function executeRagQuery(
  exchangeId: string,
  exchange: ExchangeMessage,
  prompt: string,
  mcpServer: ReturnType<typeof createMemoryMcpServer>,
): Promise<RagResult> {
  let resultText = '';
  let toolCallCount = 0;

  try {
    for await (const message of query({
      prompt,
      options: {
        model: RAG_MODEL,
        cwd: MEMORY_DIR,
        tools: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        systemPrompt: RAG_AGENT_SYSTEM_PROMPT,
        mcpServers: { memory: mcpServer },
      },
    })) {
      // Log tool calls
      if (message.type === 'assistant' && 'message' in message) {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              toolCallCount++;
              const input = block.input as Record<string, any>;
              const name = block.name.replace('mcp__memory__', '');
              const summary = name === 'search_memory'
                ? `query="${input.query}"${input.category ? `, category=${input.category}` : ''}`
                : name === 'get_entry'
                  ? `key="${input.key}"`
                  : JSON.stringify(input).slice(0, 80);
              ragLog(`  → ${name}(${summary})`);
            }
          }
        }
      }

      if (message.type === 'result') {
        const result = message as any;
        if (result.subtype === 'success' && result.result) {
          resultText = result.result;
        }
        ragLog(`  ✓ ${toolCallCount} tool calls, $${result.total_cost_usd?.toFixed(3) || '?'}`);
      }
    }
  } catch (err) {
    ragLog(`  ✗ error: ${err instanceof Error ? err.message : String(err)}`);
    return fallbackResult(exchangeId, exchange, `RAG query error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const parsed = parseRagResult(exchangeId, exchange, resultText);
  if (resultText && parsed.relevantKeys.length === 0 && toolCallCount > 0) {
    ragLog(`  ⚠ RAG output had no keys despite ${toolCallCount} tool calls. Result snippet: ${resultText.slice(0, 200)}`);
  }
  return parsed;
}

// ==================== Result parsing ====================

function parseRagResult(
  exchangeId: string,
  exchange: ExchangeMessage,
  resultText: string,
): RagResult {
  // Try to extract JSON from markdown code block
  const jsonMatch = resultText.match(/```json\s*\n([\s\S]*?)\n```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : resultText;

  try {
    const parsed = JSON.parse(jsonStr);
    return buildRagResult(exchangeId, exchange, parsed);
  } catch {
    // Try to find any JSON object in the text
    const objectMatch = resultText.match(/\{[\s\S]*"priority"[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        return buildRagResult(exchangeId, exchange, parsed);
      } catch {
        // give up
      }
    }
    return fallbackResult(exchangeId, exchange, 'Failed to parse RAG output');
  }
}

function buildRagResult(exchangeId: string, exchange: ExchangeMessage, parsed: any): RagResult {
  const validPriorities = ['normal', 'important', 'critical'] as const;
  const priority = validPriorities.includes(parsed.priority) ? parsed.priority : 'normal';

  return {
    exchangeId,
    exchange,
    priority,
    preContext: parsed.pre_context || '',
    relevantKeys: (parsed.relevant_entries || []).map((e: any) => e.key).filter(Boolean),
    reasoning: parsed.reasoning || '',
    timestamp: new Date().toISOString(),
  };
}

function fallbackResult(exchangeId: string, exchange: ExchangeMessage, reasoning: string): RagResult {
  return {
    exchangeId,
    exchange,
    priority: 'normal',
    preContext: '',
    relevantKeys: [],
    reasoning,
    timestamp: new Date().toISOString(),
  };
}
