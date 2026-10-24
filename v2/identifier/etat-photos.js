'use strict';
// ETAT-TITRE (décision de l'éditeur, 2026-10-18, 21:47) — « le titre de l'annonce ne doit plus parvenir au modèle pour l'état ».
// L'état de la carte est estimé par un APPEL SÉPARÉ au modèle, sur les PHOTOS SEULES, lancé EN PARALLÈLE de l'appel d'identification (qui reçoit, lui, le titre : il en a besoin pour le numéro et la langue).
// Ce que ce module garantit, et ce qu'un banc (v2/test/test-etat-titre.js) mord :
//   · la requête ne porte QUE la consigne d'état ci-dessous et les images : ni le titre, ni le texte du vendeur, ni le prix, ni rien de l'annonce ; elle est donc la même, octet pour octet, pour tout titre ;
//   · les images sont celles que la chaîne reçoit (les `data:` des photos reçues, ou les URLs de l'annonce) : AUCUN téléchargement ici, le fournisseur du modèle lit les adresses ;
//   · la panne de cet appel (fournisseur, plafond de dépense du modèle, arrêt du scan, réponse illisible) rend un état NUL, jamais un état venu d'ailleurs, et ne lève JAMAIS : l'identification continue.
// Le barème et les règles ci-dessous sont recopiés MOT POUR MOT du bloc « ÉVALUATION DE L'ÉTAT » de la consigne d'identification d'index.js (que ce lot ne modifie pas : le modifier changerait la lecture du code
// du set, mesurée au lot TEMPS-CHAINE) ; un banc compare les deux textes — deux exemplaires d'une règle divergent toujours.
const ETATS = Object.freeze(['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
const CONFIANCES = Object.freeze(['haute', 'moyenne', 'basse']);
const URL_MODELE = 'https://openrouter.ai/api/v1/chat/completions';

const PROMPT_ETAT = `Estime l'ÉTAT PHYSIQUE (l'usure) de la carte Pokémon visible sur ces photos, et rien d'autre. Réponds UNIQUEMENT en JSON strict, sans texte ni markdown autour, format exact :
{"etatEstime": "NM/EX/GD/LP/PL/PO", "etatConfiance": "haute/moyenne/basse", "defautsVus": ["liste courte des défauts visibles, [] si aucun"]}

ÉVALUATION DE L'ÉTAT (etatEstime) — barème Cardmarket, du meilleur au pire : MT > NM > EX > GD > LP > PL > PO.
- NM (Near Mint) : aucun défaut visible, bords nets, coins pointus.
- EX (Excellent) : très légères marques d'usure, minuscule blanchiment de bord.
- GD (Good) : blanchiment net des bords/coins, légères rayures visibles.
- LP (Light Played) : usure marquée, rayures, coins émoussés.
- PL / PO : dégâts importants (pli, déchirure, tache).

RÈGLES IMPORTANTES pour etatConfiance — sois HONNÊTE sur ce que tu ne peux pas voir :
- "basse" si : la carte est sous sleeve/toploader/blister (reflets qui masquent les défauts), photo floue, angle en biais, éclairage mauvais, ou verso non visible.
- "moyenne" si : photo correcte de face mais détails des bords/coins pas nets.
- "haute" UNIQUEMENT si : carte nue, photo nette, bords et coins clairement visibles.
Dans le doute, sois PESSIMISTE (préfère GD à EX) : surestimer l'état conduit à surpayer.
Ne devine pas un état "haute confiance" à partir d'une photo qui ne le permet pas.

PLUSIEURS PHOTOS te sont fournies (recto, verso, gros plans). EXAMINE-LES TOUTES.
Le VERSO est déterminant : c'est là que l'usure se voit le mieux (bords blanchis, coins
usés, dos terni/jauni par le temps, rayures). Une carte au recto impeccable mais au dos
usé n'est PAS NM ni EX — un dos visiblement fatigué signifie GD ou moins.
Ton etatEstime doit refléter la PIRE face observée, pas la meilleure.
Si aucune photo du verso n'est fournie, dis-le via etatConfiance "basse".

defautsVus : décris ce que tu OBSERVES réellement (ex: "blanchiment bord gauche", "rayure sur l'illustration", "coin corné"). Tableau vide [] si tu ne vois aucun défaut. N'invente rien.`;

/** L'état tel que le modèle l'a rendu, normalisé ; ou null si la réponse n'est pas un JSON exploitable. Hors barème ou hors énumération : null champ par champ (jamais une valeur inventée). */
function analyserReponse(contenu) {
    if (typeof contenu !== 'string') return null;
    let o;
    try { o = JSON.parse(contenu.replace(/```json|```/g, '').trim()); } catch { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const e = String(o.etatEstime ?? '').trim().toUpperCase(), c = String(o.etatConfiance ?? '').trim().toLowerCase();
    const d = Array.isArray(o.defautsVus) ? o.defautsVus.filter(x => typeof x === 'string' && x.trim()).slice(0, 10).map(x => x.trim().slice(0, 200)) : null;
    return { etatEstime: ETATS.includes(e) ? e : null, etatConfiance: CONFIANCES.includes(c) ? c : null, defautsVus: d };
}

const NUL = Object.freeze({ etatEstime: null, etatConfiance: null, defautsVus: null });

/**
 * L'appel d'état. NE LÈVE JAMAIS : toute panne rend un état nul avec sa cause.
 * @param o.images   les images de la chaîne (les mêmes que l'identification) — obligatoires, sinon état nul sans appel
 * @param o.appeler  async (corps, config) => réponse du fournisseur (le client SOUS le plafond de dépense du modèle, avec ses en-têtes) ; config porte le signal d'arrêt s'il y en a un
 * @param o.modele   le modèle de la chaîne (index.js : MODELE_IA)
 * @param o.signal   le signal d'arrêt de la borne du scan (PHOTOS-MULTIPLES), s'il existe
 * @param o.journal  { error } (défaut console)
 * @returns { etatEstime, etatConfiance, defautsVus, ms, cause }  cause : null (réponse exploitable), 'sans-image', 'depense', 'arret', 'panne', 'illisible'
 */
async function estimerEtat({ images, appeler, modele, signal = null, journal = console, maintenant = Date.now } = {}) {
    const debut = maintenant();
    const fin = (cause, base = NUL) => ({ ...base, ms: maintenant() - debut, cause });
    try {
        const liste = Array.isArray(images) ? images.filter(Boolean) : [];
        if (liste.length === 0 || typeof appeler !== 'function' || typeof modele !== 'string' || !modele) return fin('sans-image');
        const corps = {
            model: modele, temperature: 0,
            messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT_ETAT }, ...liste.map(url => ({ type: 'image_url', image_url: { url } }))] }]
        };
        const reponse = await appeler(corps, signal ? { signal } : {});
        const [choix] = (reponse && reponse.data && Array.isArray(reponse.data.choices) && reponse.data.choices) || [];
        const { message: lu } = choix || {};                                    // la réponse du MODÈLE (pas une erreur) : déstructurée, la règle « aucun .message » de test-abus-routes.js ne la confond pas avec un message d'exception
        const contenu = lu ? lu.content : undefined;
        const etat = analyserReponse(contenu);
        if (!etat) { journal.error('⚠️ [etat-photos] réponse de l\'estimation de l\'état illisible : état nul'); return fin('illisible'); }
        return fin(null, etat);
    } catch (e) {
        const cause = e && e.code === 'DEPENSE_MODELE_PLAFOND' ? 'depense' : (signal && signal.aborted) || (e && (e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError')) ? 'arret' : 'panne';
        // le statut et un code court SEULEMENT : jamais le corps de la réponse du fournisseur ni le message (la requête peut porter la photo d'un utilisateur en `data:`)
        let resume = cause;
        try { resume = require('./erreur-fournisseur').resumeErreurFournisseur(e); } catch { /* le résumé est facultatif */ }
        journal.error(`⚠️ [etat-photos] estimation de l'état impossible (${cause} : ${resume}) — état nul, l'identification continue`);
        return fin(cause);
    }
}

/**
 * L'état séparé REMPLACE celui que l'identification a rendu (ignoré, gardé comme information dans `etatIdentification`). Pose aussi `msEtat`. Une identification sans état laisse `etatIdentification` à null.
 * Mutation de cardInfo, comme le reste de la lecture ; rend cardInfo.
 */
function fusionner(cardInfo, etat) {
    const lu = cardInfo.etatEstime != null || cardInfo.etatConfiance != null;
    cardInfo.etatIdentification = lu ? { etatEstime: cardInfo.etatEstime ?? null, etatConfiance: cardInfo.etatConfiance ?? null } : null;
    cardInfo.etatEstime = etat.etatEstime;
    cardInfo.etatConfiance = etat.etatConfiance;
    cardInfo.defautsVus = etat.defautsVus;
    cardInfo.msEtat = Number.isFinite(etat.ms) ? etat.ms : null;
    cardInfo.etatCause = etat.cause ?? null;
    return cardInfo;
}

module.exports = { PROMPT_ETAT, ETATS, CONFIANCES, URL_MODELE, analyserReponse, estimerEtat, fusionner };
