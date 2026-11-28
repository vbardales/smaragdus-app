// Commentators of the front: two scribes, one per camp, who react to what happens (points invested, new points given, a legion power used,
// or from time to time on their own). The text comes from an LLM API when a key is set (ANTHROPIC_API_KEY, or OPENAI_API_KEY),
// otherwise from the phrase banks below. The prompt only carries public facts (which camp acts, on which planet, who leads where): never a
// player, a score or the content of a tier, and a text with a digit is refused.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// which API the keys select, and its model (nothing secret)
// Background of the campaign given to the model: only public facts, written in lore.txt (editable without touching the code)
const LORE = (() => {
  try { return fs.readFileSync(fileURLToPath(new URL('./lore.txt', import.meta.url)), 'utf8').trim(); } catch { return ''; }
})();

export function provider(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return { name: 'anthropic', model: env.COMMENT_MODEL || 'claude-haiku-5-5' };
  if (env.OPENAI_API_KEY) return { name: 'openai', model: env.COMMENT_MODEL || 'gpt-4o-mini' };
  return null;
}

export const SCRIBES = {
  loyalist: { author: 'Frère Hesper, archiviste de l’Ordo Astronomica', tone: 'solennel, pieux, loyal à l’Empereur, un peu inquiet' },
  renegade: { author: 'Le Scribe de la Fosse', tone: 'cynique, sardonique, fier de la rébellion contre le faux Empereur, jamais vulgaire' },
};

const BANK = {
  invest: {
    loyalist: ['Des étendards impériaux sont plantés sur {p}. Que l’Empereur protège ceux qui les portent.', 'Les fidèles se pressent vers {p} : la foi pèse plus lourd que la poudre.', 'J’ai vu partir des renforts vers {p}. La Garde ne recule pas.'],
    renegade: ['{p} bruisse de nos bannières. Les chiens du trône vont s’en mordre les doigts.', 'Nos frères se tournent vers {p}. La Fosse approuve, et elle a faim.', 'On murmure que {p} sera bientôt à nous. Je note, je souris.'],
  },
  grant: {
    loyalist: ['Les greniers de l’Ordo se garnissent : de nouveaux moyens sont arrivés au front.', 'Un convoi de ravitaillement a franchi le Warp sans encombre. Gloire à l’Empereur.'],
    renegade: ['Des richesses nouvelles gagnent nos rangs. Le Maître de Guerre pourvoit à tout.', 'Les caisses s’ouvrent côté Fosse. Que les loyalistes comptent leurs jours.'],
  },
  power: {
    loyalist: ['Un feu purificateur s’est abattu sur {p}. Je prie pour que le prix n’en soit pas trop lourd.', '{p} a vu la colère de l’Imperium. Le fracas résonne encore dans mes archives.'],
    renegade: ['{p} a brûlé. Il faut savoir sacrifier pour gagner : voilà ce que le trône n’a jamais compris.', 'Les bombes ont chanté sur {p}. Quelle belle musique pour une Fosse.'],
  },
  idle: {
    loyalist: ['La frontière est calme, mais les vigies ne dorment pas. Omnia videre.', 'Je relis mes notes : l’histoire se joue ici, planète après planète.'],
    renegade: ['Le silence est une arme comme une autre. Nous attendons.', 'Qu’ils s’endorment dans leur certitude : la Fosse veille.'],
  },
};

const pick = (l) => l[Math.floor(Math.random() * l.length)];

export function fallbackComment(kind, camp, planetName) {
  const list = BANK[kind]?.[camp] || BANK.idle[camp];
  return pick(list).replaceAll('{p}', planetName || 'la frontière');
}

// the status and the reason the API gives (a low credit balance, an unknown model...), so the admin sees why the phrase banks are used
async function apiError(name, r) {
  const j = await r.json().catch(() => null);
  const why = String(j?.error?.message || '').replace(/s+/g, ' ').slice(0, 160);
  return `${name}: HTTP ${r.status}${why ? ' — ' + why : ''}`;
}

async function askLlm(camp, facts, env) {
  const system = `Tu es ${SCRIBES[camp].author}, chroniqueur de la campagne de Smaragdus dans l'univers Warhammer 30 000 (Hérésie d'Horus). Ton : ${SCRIBES[camp].tone}. Écris UN commentaire de 1 à 2 phrases courtes (240 caractères maximum), en français, comme une note dans ton journal. Tu peux t'appuyer sur les événements récents pour réagir à ce qui vient de se passer. Interdits : tout chiffre, nom de joueur, nombre de points, révélation de contenu secret. Réponds uniquement par le texte du commentaire.${LORE ? `

Contexte (ne pas citer tel quel) :
${LORE}` : ''}`;
  const recent = facts.events?.length ? `\nÉvénements récents (du plus récent au plus ancien) :\n- ${facts.events.join('\n- ')}` : '';
  const user = `Événement : ${facts.event}\nSituation du front : ${facts.situation}${recent}`;
  const signal = AbortSignal.timeout(15000);
  if (env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal, headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } : {}) }, body: JSON.stringify({ model: env.COMMENT_MODEL || 'claude-haiku-5-5', max_tokens: 200, system, messages: [{ role: 'user', content: user }] }) });
    if (!r.ok) throw new Error(await apiError('Anthropic API', r));
    return (await r.json()).content?.find((c) => c.type === 'text')?.text;
  }
  if (env.OPENAI_API_KEY) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal, headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: env.COMMENT_MODEL || 'gpt-4o-mini', max_tokens: 200, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    if (!r.ok) throw new Error(await apiError('OpenAI API', r));
    return (await r.json()).choices?.[0]?.message?.content;
  }
  return null;
}

// returns { camp, author, text, planetId, source, error }; never throws (an API failure falls back on the phrase banks, and says why)
export async function comment({ kind, camp, planet, situation, events = [] }, env = process.env) {
  const side = camp === 'loyalist' ? 'loyaliste' : 'renégat';
  const event = { invest: `des renforts du camp ${side} arrivent sur ${planet?.name}`, grant: 'de nouveaux moyens parviennent aux combattants', power: `un pouvoir de légion a détruit des forces sur ${planet?.name}`, idle: 'rien de notable, une pause dans les combats' }[kind] || 'rien de notable';
  let text = null, error = null;
  try { text = await askLlm(camp, { event, situation, events }, env); } catch (e) { error = e.name === 'TimeoutError' ? 'délai dépassé' : e.message; console.error('Commentary:', error); }
  text = String(text || '').replace(/\s+/g, ' ').trim().replace(/^["«]\s*|\s*["»]$/g, '');
  let source = 'api';
  if (!text || /\d/.test(text) || text.length > 300) {
    if (text) error = 'texte refusé (chiffre ou trop long)';
    source = 'banks'; text = fallbackComment(kind, camp, planet?.name);
  }
  return { camp, author: SCRIBES[camp].author, text, planetId: planet?.id || null, source, error };
}
