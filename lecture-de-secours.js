// ============================================================
// LA LECTURE DE SECOURS — quand le service de lecture (OpenRouter) ne répond plus
// ============================================================
// 🔑 DEMANDE DU TESTEUR (2026-10-05) : « Si le crédit est épuisé ou que le service ne répond pas, l'API ne tombe pas : elle continue
// avec l'image, le symbole et ce qui est déjà lu, et transforme en question ce qu'elle ne peut plus affirmer. »
// Ce qui est « déjà lu » sans l'IA, c'est le TITRE DE L'ANNONCE, que l'extension envoie à chaque scan. Ce module :
//   · classerPanneIA(e) : la panne est-elle du SERVICE (crédit, quota, clé, serveur, réseau) ? Une réponse illisible du modèle, une
//     requête mal formée (400) ne sont PAS des pannes : elles gardent leur sort d'avant (refus « ia-echec »).
//   · lectureDuTitre(titre) : le numéro (X/Y, ou une promo SWSH186, TG05/TG30…), la langue si le titre la dit, et le reste du titre
//     comme nom, en confiance BASSE (un nom de titre est souvent français, ou approximatif : il ne fait pas foi). Sans numéro : null —
//     un nom seul ne désigne pas une impression, et la route refuse comme avant.
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (en tête de CLAUDE.md) : seules les formes de numéro énumérées ici sont lues ; une année, un
// prix, une note PSA ne sont jamais pris pour un numéro. La sortie a la FORME d'une réponse de l'IA : elle passe par la même
// normalisation (getCardIdFromAI), et la route la marque `lectureDeSecours` — jamais affirmée, toujours une question.
'use strict';

/** La panne du SERVICE, ou null. */
function classerPanneIA(e) {
    const st = e?.response?.status;
    if (st === 402) return 'credit';
    if (st === 429) return 'quota';
    // relecture du 2026-10-05 : 403 n'est PAS une panne — OpenRouter le rend aussi quand la MODÉRATION refuse une photo ; seul 401 dit
    // que la clé ne vaut plus rien
    if (st === 401) return 'cle';
    if (typeof st === 'number' && st >= 500) return 'serveur';
    if (st == null && ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_NETWORK', 'EPIPE'].includes(e?.code)) return 'reseau';
    if (st == null && /timeout/i.test(String(e?.message ?? ''))) return 'reseau';
    return null;
}

/** relecture du 2026-10-05 : OpenRouter rend parfois un 200 dont le CORPS porte l'erreur (`{ error: { code: 402 | 5xx } }`, quand un
 *  fournisseur amont tombe) — la même panne, sans exception axios. Rend la panne, ou null. */
function panneDansLeCorps(data) {
    const c = Number(data?.error?.code);
    if (!data?.error || data?.choices?.length) return null;
    return Number.isFinite(c) ? classerPanneIA({ response: { status: c } }) : null;
}

const PREFIXES_PROMO = ['SWSH', 'SVP', 'HGSS', 'SM', 'XY', 'BW', 'DP', 'SV', 'TG', 'GG', 'RC'];
// le numéro « X/Y » : X = préfixe facultatif (TG, GG, SV, RC…) + 1 à 3 chiffres + une lettre facultative ; Y = un total (chiffres, ou
// préfixe + chiffres comme TG30) ou un code de promo (SM-P, XY-P, S-P, SV-P)
const RE_FRACTION = /(?:^|[\s#°(:,])([A-Za-z]{0,3}\d{1,3}[a-zA-Z]?)\s*\/\s*([A-Za-z]{0,3}\d{1,3}|[A-Za-z]{1,4}-P)(?=$|[\s,.;:)\]!?])/;
const RE_PROMO = new RegExp(`(?:^|[\\s#°(:,])(${PREFIXES_PROMO.join('|')})\\s?-?(\\d{2,3})(?=$|[\\s,.;:)\\]!?])`, 'i');
const BRUIT_DEBUT = /^(?:(?:lot\s+de\s+\d+\s+)?cartes?|pok[eé]mon|tcg|jcc|card|carte\s+pok[eé]mon|japonaise?|japanese|jap|jp|fran[cç]aise?|fr|anglaise?|en)\b[\s:-]*/i;
// ce qui, dans un titre, n'est PAS le nom de la carte : une note de gradation, une année, un mot d'état (relecture du 2026-10-05)
const BRUIT_NOM = /\b(?:psa|pca|cgc|bgs|collect\s*aura)\s*\d+(?:[.,]5)?\b|\b(?:19|20)\d\d\b|\b(?:[ée]tat|neuve?|mint|nm|near\s+mint|excellent|holo|reverse|rare)\b/gi;
// une fraction précédée d'un mot de gradation ou d'état n'est pas un numéro (« état 9/10 », « note 10/10 »), et un total de 10 ou moins
// n'existe pas pour une carte numérotée « X/Y » qu'on vend à l'unité — « 10/10 », « 1/1 », « 5/6 » sont des notes
const AVANT_NOTE = /(?:[ée]tat|note|psa|pca|cgc|bgs|grade)\s*[:\s]*$/i;

function lectureDuTitre(titre) {
    if (typeof titre !== 'string' || !titre.trim()) return null;
    const t = titre.replace(/\s+/g, ' ').trim();
    let number = null, total = null, debut = -1;
    const f = t.match(RE_FRACTION);
    const estUneNote = f && (AVANT_NOTE.test(t.slice(0, f.index + f[0].indexOf(f[1]))) || (/^\d+$/.test(f[2]) && Number(f[2]) <= 10));
    if (f && !estUneNote) { number = f[1]; total = f[2]; debut = f.index + f[0].indexOf(f[1]); }
    else {
        const p = t.match(RE_PROMO);
        if (p) { number = `${p[1].toUpperCase()}${p[2]}`; debut = p.index + p[0].indexOf(p[1]); }
    }
    if (!number) return null;
    // la langue, seulement si le titre la DIT (sinon « EN », comme l'IA quand elle n'est pas sûre — l'occidental est un seul produit)
    const language = /japon|japanese|\bjap\b|\bjpn?\b/i.test(t) ? 'JP' : /chinois|chinese|\bchn?\b|simplifi|traditionn/i.test(t) ? 'ZH' : /cor[ée]en|korean|\bkr\b/i.test(t) ? 'KR' : 'EN';
    let nom = t.slice(0, debut).replace(BRUIT_NOM, ' ').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 6; i++) nom = nom.replace(BRUIT_DEBUT, '').trim();
    nom = nom.replace(/[\s,;:#-]+$/, '').trim();
    if (!nom) return null;   // un numéro sans nom : la route d'avant le refusait aussi (« JSON IA sans nom »)
    // `nomBrut` reste null : il veut dire « le nom IMPRIMÉ sur la carte » (lu en kana par la suite de la chaîne) — un titre n'en est pas un
    return {
        name: nom, nomBrut: null, nomConfiance: 'basse', number, total, setCode: null, language,
        symboleSet: 'illisible', rarete: 'illisible', reverse: null, motif: 'indetermine',
        attaque: null, attaqueBrute: null, illustrateur: null, illustrateurConfiance: null,
        etatEstime: null, etatConfiance: null, defautsVus: [],
        lectureDeSecours: true
    };
}

module.exports = { classerPanneIA, panneDansLeCorps, lectureDuTitre };
