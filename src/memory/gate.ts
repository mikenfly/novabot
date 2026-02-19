import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';

import { MODEL_GATE, GATE_CONTEXT_EXCHANGES, MEMORY_DIR } from '../config.js';
import type { ExchangeMessage } from './types.js';

const LOG_FILE = path.join(MEMORY_DIR, 'agent.log');

function gateLog(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] [gate] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // ignore
  }
}

const GATE_SYSTEM_PROMPT = `Tu es un filtre rapide pour un système de mémoire. Tu décides si un échange mérite d'être traité par le pipeline de mémorisation.

Réponds PROCESS si l'échange contient des informations qui méritent d'être mémorisées à long terme :
- Personnes mentionnées (noms, rôles, relations)
- Décisions ou validations ("on part sur cette approche", "il a validé")
- Faits personnels (adresses, dates, préférences)
- Avancées projet, jalons, deadlines
- Changements de situation ou de plan
- Confirmations ou infirmations — même un simple "oui" ou "non" qui confirme ou dément une hypothèse, question ou déduction de l'assistant dans un échange précédent. Si l'assistant a posé une question ("c'est ta sœur ?", "il travaille chez X ?") et que l'utilisateur répond, c'est PROCESS.

Réponds SKIP si l'échange est purement :
- Du debug technique sans décision (stack traces, corrections CSS)
- Des questions factuelles génériques ("quel fuseau horaire ?")
- Des acquittements simples SANS question/hypothèse en suspens ("ok", "merci", "ça marche" après une tâche terminée)
- De la conversation banale sans contenu persistant

IMPORTANT : En cas de doute, réponds PROCESS. Il vaut mieux traiter un échange inutile que rater une information importante.
IMPORTANT : Regarde bien les échanges PRÉCÉDENTS. Si l'assistant y pose une question ou fait une supposition, un "oui"/"non"/"exactement" de l'utilisateur CONFIRME cette info et doit être PROCESS.

Réponds en un seul mot (PROCESS ou SKIP) suivi d'une raison en 10 mots max.`;

/**
 * Gate an exchange through Haiku to decide if it should be processed
 * by the RAG + context agent pipeline.
 *
 * Returns true = PROCESS, false = SKIP.
 * Defaults to PROCESS on any error or ambiguous response.
 */
export async function gateExchange(
  exchange: ExchangeMessage,
  recentConversationExchanges: ExchangeMessage[],
): Promise<boolean> {
  const contextExchanges = recentConversationExchanges.slice(-GATE_CONTEXT_EXCHANGES);

  const contextBlock = contextExchanges.length > 0
    ? contextExchanges.map(e =>
        `<exchange time="${e.timestamp}">
<user>${e.user_message}</user>
<assistant>${e.assistant_response}</assistant>
</exchange>`
      ).join('\n')
    : 'Aucun échange précédent.';

  const prompt = `Échanges récents de cette conversation :
${contextBlock}

Dernier échange à évaluer :
<exchange time="${exchange.timestamp}" channel="${exchange.channel}" conversation="${exchange.conversation_name}">
<user>${exchange.user_message}</user>
<assistant>${exchange.assistant_response}</assistant>
</exchange>

Le DERNIER échange apporte-t-il des informations méritant une mémorisation à long terme ? PROCESS ou SKIP ?`;

  try {
    let resultText = '';

    for await (const message of query({
      prompt,
      options: {
        model: MODEL_GATE,
        cwd: MEMORY_DIR,
        tools: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        systemPrompt: GATE_SYSTEM_PROMPT,
        maxTurns: 1,
      },
    })) {
      if (message.type === 'result') {
        const result = message as any;
        if (result.subtype === 'success' && result.result) {
          resultText = result.result;
        }
      }
    }

    const shouldSkip = resultText.toLowerCase().includes('skip');
    gateLog(`${shouldSkip ? 'SKIP' : 'PROCESS'}: [${exchange.conversation_name}] "${exchange.user_message.slice(0, 60)}..." → ${resultText.slice(0, 80)}`);
    return !shouldSkip;
  } catch (err) {
    gateLog(`Error (defaulting to PROCESS): ${err instanceof Error ? err.message : String(err)}`);
    return true; // safe fallback: always process on error
  }
}
