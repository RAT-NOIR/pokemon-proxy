'use strict';
// B1a.2 — la question qui sépare 2 ou 3 candidats (CONTRAT-2 §3.3, PLAN-IDENTIFICATION §3). Module PUR.
// L'ordre des codes est FERMÉ : le premier dont la réponse donne UN candidat par réponse l'emporte. Rien ne se devine :
// une variante ou un numéro inconnu rend le code inéligible. `visuel` est le repli, toujours possible.
const { choixPour } = require('../choix');

const CODES_QUESTION = Object.freeze(['reverse', 'symbole', 'numero', 'langue', 'premiere-edition', 'visuel']);
const ZONES = Object.freeze({
    symbole: { x: 0.02, y: 0.84, w: 0.30, h: 0.14 },
    numero: { x: 0.02, y: 0.90, w: 0.40, h: 0.08 },
    'premiere-edition': { x: 0.05, y: 0.44, w: 0.25, h: 0.10 }
});
const MARQUE_MIN_PX = 25;
const LANGUES = Object.freeze({
    fr: { EN: 'Anglais', FR: 'Français', DE: 'Allemand', ES: 'Espagnol', IT: 'Italien', JP: 'Japonais', ZH: 'Chinois', PT: 'Portugais', RU: 'Russe', KR: 'Coréen', ID: 'Indonésien', TH: 'Thaï' },
    en: { EN: 'English', FR: 'French', DE: 'German', ES: 'Spanish', IT: 'Italian', JP: 'Japanese', ZH: 'Chinese', PT: 'Portuguese', RU: 'Russian', KR: 'Korean', ID: 'Indonesian', TH: 'Thai' }
});
// Vouvoiement (décision de l'éditeur, DEMANDE §10). Aucune phrase ne parle de prix ni de classement.
const PHRASES = Object.freeze({
    fr: {
        reverse: { texte: 'La carte a-t-elle un reflet sur toute sa surface ?', aide: 'Une carte « reverse » brille presque partout, hors de l’illustration ; une carte normale ne brille pas. Regardez les photos de l’annonce.' },
        symbole: { texte: 'Quel symbole d’extension voyez-vous en bas de la carte ?', aide: 'Plusieurs cartes portent le même nom et le même numéro : seul le symbole de l’extension les distingue.' },
        numero: { texte: 'Quel numéro est imprimé en bas de la carte ?', aide: 'Les cartes proposées portent le même nom : le numéro imprimé les distingue.' },
        langue: { texte: 'En quelle langue la carte est-elle imprimée ?', aide: 'Les cartes proposées existent en plusieurs langues : regardez le texte de la carte.' },
        'premiere-edition': { texte: 'La carte porte-t-elle le tampon « Edition 1 » ?', aide: 'Le tampon se trouve sous l’illustration, à gauche.' },
        visuel: { texte: 'Laquelle de ces cartes est celle de l’annonce ?', aide: 'Plusieurs cartes portent ce nom : comparez l’illustration avec les photos.' }
    },
    en: {
        reverse: { texte: 'Does the card have a foil shine across its whole surface?', aide: 'A "reverse" card shines almost everywhere except the artwork; a normal card does not. Look at the listing photos.' },
        symbole: { texte: 'Which set symbol do you see at the bottom of the card?', aide: 'Several cards share the same name and number: only the set symbol tells them apart.' },
        numero: { texte: 'Which number is printed at the bottom of the card?', aide: 'The proposed cards share a name: the printed number tells them apart.' },
        langue: { texte: 'Which language is the card printed in?', aide: 'The proposed cards exist in several languages: look at the text on the card.' },
        'premiere-edition': { texte: 'Does the card carry the "Edition 1" stamp?', aide: 'The stamp sits below the artwork, on the left.' },
        visuel: { texte: 'Which of these cards is the one in the listing?', aide: 'Several cards share this name: compare the artwork with the photos.' }
    }
});
const LIBELLES = Object.freeze({
    fr: { reverse: 'Reflet sur toute la carte (reverse)', sansReflet: 'Sans reflet sur la carte', tampon: 'Avec le tampon « Edition 1 »', sansTampon: 'Sans le tampon', carte: 'Carte', numero: 'n°' },
    en: { reverse: 'Shine across the whole card (reverse)', sansReflet: 'No shine on the card', tampon: 'With the "Edition 1" stamp', sansTampon: 'Without the stamp', carte: 'Card', numero: 'No.' }
});
// Libellé FR du brief « Avec le tampon « Edition 1 » » : repris à la lettre.

const distincts = xs => new Set(xs).size === xs.length;
const tousConnus = xs => xs.every(x => x !== null && x !== undefined && x !== '');

/** Chaque entrée : un test d'éligibilité et la fabrique de libellés (un par candidat, dans l'ordre d'entrée). */
function libellesDe(code, cs, L, langue) {
    switch (code) {
        case 'reverse': {
            const vs = cs.map(c => c.variante);
            if (cs.length !== 2 || !tousConnus(vs) || !distincts(vs) || !vs.every(x => ['reverse', 'normale', 'holo'].includes(x)) || !vs.includes('reverse')) return null;
            return cs.map(c => (c.variante === 'reverse' ? L.reverse : L.sansReflet));
        }
        case 'symbole': {
            const noms = cs.map(c => c.nomCardmarket), nums = cs.map(c => c.numero);
            if (new Set(noms).size !== 1 || !tousConnus(nums) || new Set(nums).size !== 1) return null;
            if (!distincts(cs.map(c => c.set.slug)) || !distincts(cs.map(c => c.set.nom))) return null;
            return cs.map(c => c.set.nom);
        }
        case 'numero': {
            const nums = cs.map(c => c.numero);
            if (!tousConnus(nums) || !distincts(nums)) return null;
            return cs.map(c => `${L.numero} ${c.numero}${c.total ? '/' + c.total : ''}`);
        }
        case 'langue': {
            const ls = cs.map(c => c.langue);
            if (!tousConnus(ls) || !distincts(ls) || !ls.every(x => LANGUES[langue][x])) return null;
            return cs.map(c => LANGUES[langue][c.langue]);
        }
        case 'premiere-edition': {
            const vs = cs.map(c => c.variante);
            if (cs.length !== 2 || !tousConnus(vs) || !distincts(vs) || !vs.includes('premiere-edition')) return null;
            return cs.map(c => (c.variante === 'premiere-edition' ? L.tampon : L.sansTampon));
        }
        default: return null;   // 'visuel' est traité à part : il ne dépend d'aucune donnée
    }
}

/** La zone ne survit que si elle couvre une marque d'au moins 25 px dans CHAQUE visuel ; un candidat sans visuel => null. */
function zoneDe(code, cs) {
    const z = ZONES[code];
    if (!z) return null;
    for (const c of cs) {
        if (!c.visuel) return null;
        if (z.w * c.visuel.w < MARQUE_MIN_PX || z.h * c.visuel.h < MARQUE_MIN_PX) return null;
    }
    return { ...z };
}

function construireQuestion(candidats, ctx = {}) {
    if (!Array.isArray(candidats) || candidats.length < 2 || candidats.length > 3) throw new Error(`construireQuestion : 2 ou 3 candidats, reçu ${Array.isArray(candidats) ? candidats.length : typeof candidats}`);
    const langue = ctx.langueInterface === 'fr' ? 'fr' : 'en';                    // une langue inconnue rend l'anglais
    const L = LIBELLES[langue];
    const ids = choixPour(candidats.map(c => c.idProduct));                          // lève sur un doublon ; trie par idProduct
    const parId = new Map(candidats.map(c => [c.idProduct, c]));
    const ordonnes = ids.map(x => parId.get(x.idProduct));
    let code = null, libelles = null;
    for (const c of CODES_QUESTION) {
        if (c === 'visuel') break;
        const l = libellesDe(c, ordonnes, L, langue);
        if (l) { code = c; libelles = l; break; }
    }
    if (!code) {
        code = 'visuel';
        libelles = ordonnes.map((c, i) => `${L.carte} ${'ABC'[i]} — ${c.set.nom}`);
    }
    const q = {
        code, texte: PHRASES[langue][code].texte, aide: PHRASES[langue][code].aide, zone: zoneDe(code, ordonnes),
        choix: ids.map((x, i) => ({ id: x.id, libelle: libelles[i], idProduct: x.idProduct }))
    };
    verifierBijection(q, candidats);                                                 // la propriété s'applique à la sortie même
    return q;
}

/** Chaque choix désigne EXACTEMENT un candidat, et réciproquement. Rend true, ou lève en disant pourquoi. */
function verifierBijection(question, candidats) {
    const echec = m => { throw new Error('bijection : ' + m); };
    if (!question || !CODES_QUESTION.includes(question.code)) echec('code hors liste fermée');
    if (!Array.isArray(question.choix) || !Array.isArray(candidats)) echec('forme');
    if (question.choix.length !== candidats.length) echec(`${question.choix.length} choix pour ${candidats.length} candidats`);
    const idsCandidats = candidats.map(c => c.idProduct);
    const idsChoix = question.choix.map(c => c.idProduct);
    if (!distincts(idsChoix)) echec('un candidat désigné deux fois');
    for (const id of idsCandidats) if (idsChoix.filter(x => x === id).length !== 1) echec(`le candidat ${id} n'est pas désigné exactement une fois`);
    for (const id of idsChoix) if (!idsCandidats.includes(id)) echec(`le choix ${id} ne désigne aucun candidat`);
    if (!distincts(question.choix.map(c => c.id)) || !question.choix.every(c => typeof c.id === 'string' && c.id)) echec('identifiants de choix');
    const libs = question.choix.map(c => c.libelle);
    if (!libs.every(l => typeof l === 'string' && l.trim()) || !distincts(libs)) echec('libellés vides ou identiques');
    return true;
}
module.exports = { construireQuestion, verifierBijection, CODES_QUESTION, ZONES, MARQUE_MIN_PX };
