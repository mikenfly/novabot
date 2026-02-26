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

const GATE_SYSTEM_PROMPT = `Tu es un filtre pour un système de mémoire. Par défaut, tout échange est PROCESS. Tu ne cherches que les raisons de SKIP.

Réponds SKIP uniquement si l'échange remplit TOUTES ces conditions :
1. Le message utilisateur ne contient AUCUN nom de personne, lieu, date, montant, ni outil/service nommé
2. Le message ne contient AUCUNE décision, choix, validation, correction, deadline ou avancement
3. Le message ne confirme ni n'infirme une question ou supposition de l'assistant dans les échanges précédents

Exemples de SKIP (les 3 conditions sont remplies) :
- "ok merci" / "ça marche" / "cool" (acquittement pur, rien en suspens)
- "Quel fuseau horaire à Tokyo ?" (question factuelle générique)
- Copier-coller d'un stack trace ou log d'erreur brut

Exemples de PROCESS (au moins 1 condition échoue) :
- "oui" en réponse à "c'est ton frère ?" → confirme une info (condition 3)
- "j'ai galéré sur Stripe" → outil nommé (condition 1)
- "c'est quasi fini" → avancement (condition 2)
- "ouais c'est rien de grave" → infirme une inquiétude précédente (condition 3)

En cas de doute → PROCESS. Mieux vaut traiter un échange vide que rater une information.

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
