'use strict';
// SECONDE-LECTURE (décision du testeur, §72 du CLAUDE.md) — regagner une partie des affirmations JUSTES que la garde des jumeaux (jumeaux.js) refuse, sans jamais un faux.
// La garde refuse d'affirmer P quand un autre produit de même métacarte et de même langue l'accompagne (le jumeau d'un autre créneau) : la chaîne lit le code et le numéro, et c'est cette
// lecture qui se trompe. Une SECONDE lecture du bas de la carte (code et numéro seulement, plusieurs recadrages, un champ n'est retenu que si DEUX essais le lisent à l'identique)
// peut CONFIRMER P — jamais plus. Module PUR (ni base, ni réseau, ni modèle : le recadrage et le lecteur sont INJECTÉS).
// Les trois leçons du §72 sont des exigences, chacune tenue par un cas de test-seconde-lecture.js :
//   1. le jumeau visé est celui que la première lecture n'écarte que par le CODE ou le NUMÉRO ; un voisin déjà écarté par la langue ne déclenche rien ;
//   2. la carte imprime parfois un autre code que Cardmarket (Start Deck « SI », promos « PROMO », coffrets) : le code lu CONFIRME ; il ne RETIRE un candidat que si un AUTRE candidat porte ce code ;
//   3. elle ne se confirme JAMAIS elle-même : aucun champ absent de la première lecture n'est comblé ni confirmé (deux lectures d'accord du même modèle sur la même photo sont corrélées).
// 🔑 Écrite par ce qu'elle AUTORISE : un seul chemin mène à « confirme » (voir `decider`). Tout le reste rend la réponse d'AVANT (la question), jamais pire.
const S = require('../../scoring');

const JUMEAUX_MAX = 2;                                  // P et ses jumeaux tiennent dans une question : 3 produits au plus (jumeaux.js MAX_PRODUITS)
const ESSAIS_DEFAUT = 3, ESSAIS_MIN = 2;
const bornerEssais = n => (Number.isInteger(n) && n >= ESSAIS_MIN && n <= ESSAIS_DEFAUT ? n : ESSAIS_DEFAUT);

const texte = x => (typeof x === 'string' ? x.replace(/\s+/g, '').trim() : typeof x === 'number' ? String(x) : '');
const normLu = x => { const s = texte(x); return s && !/^null$/i.test(s) ? s.toUpperCase() : null; };

// ── les compteurs : ce que la seconde lecture a COÛTÉ (un appel au modèle ≈ 0,0008 $ par bande, mesuré au labo) — pour la re-mesure
const COMPTEURS = ['declenchees', 'confirmees', 'nonConfirmees', 'echecs', 'appels', 'dejaTentees', 'nonFaisables'];
const compte = Object.fromEntries(COMPTEURS.map(k => [k, 0]));
const compteurs = () => ({ ...compte });
const noter = (k, n = 1) => { compte[k] += n; };
// « jamais deux fois pour le même scan » : une mémoire bornée des scanId déjà tentés (un rejeu d'une même requête ne rappelle pas le modèle)
const MEMOIRE_MAX = 5000;
const tentes = new Set();
function premiereFois(scanId) {
    if (typeof scanId !== 'string' || !scanId) return false;                    // sans identifiant on ne saurait pas s'en souvenir : on ne tente pas
    if (tentes.has(scanId)) { noter('dejaTentees'); return false; }
    if (tentes.size >= MEMOIRE_MAX) tentes.delete(tentes.values().next().value);
    tentes.add(scanId);
    return true;
}
function reinitialiser() { COMPTEURS.forEach(k => { compte[k] = 0; }); tentes.clear(); }

// ── la comparaison d'un produit du catalogue avec ce que la carte imprime (mêmes fonctions que la production : scoring.js, jamais une copie)
const codeDe = l => S.normaliserCodeSet(l && l.set && l.set.code);
const numeroDe = l => (l && typeof l.numero === 'string' && l.numero.trim() ? l.numero.trim() : null);
function comparer(lu, ligne) {
    const concorde = [], contredit = [];
    if (!lu || !ligne) return { concorde, contredit };
    const n = lu.numero != null && String(lu.numero).trim() !== '' ? String(lu.numero).trim() : null, ln = numeroDe(ligne);
    let numeroExact = false;
    if (n && ln) {
        const cmp = S.comparerNumeros(n, ln);
        if (cmp === 'exact') { concorde.push('numero'); numeroExact = true; }
        else if (cmp === null || (/[A-Z]/.test(S.numeroComplet(n)) && /[A-Z]/.test(S.numeroComplet(ln)))) contredit.push('numero');
    }
    const lc0 = S.normaliserCodeSet(lu.setCode), ec = codeDe(ligne);
    if (lc0 && ec) {
        const lc = S.ALIAS_CODES_LUS.get(lc0) ?? lc0;
        const prefixeDuNumero = n ? S.normaliserCodeSet((n.match(/^[A-Za-z-]+/) || [''])[0]) : null;
        const [court, long] = lc.length <= ec.length ? [lc, ec] : [ec, lc];
        const parenteParLettre = S.codesApparentes(lc, ec) && !/^\d/.test(long.slice(court.length));
        if (lc === ec || S.memeCodeParConventionX(lc, ec)) concorde.push('code');
        else if (!(numeroExact && lc0 === prefixeDuNumero) && !parenteParLettre) contredit.push('code');
    }
    return { concorde, contredit };
}
// deux lignes ne diffèrent sur un champ que si LES DEUX le connaissent et qu'il diffère : un champ inconnu compte comme « même » (on échoue fermé, comme jumeaux.js)
function separation(p, j) {
    const champs = [];
    const [cp, cj, np, nj] = [codeDe(p), codeDe(j), numeroDe(p), numeroDe(j)];
    if (cp && cj && cp !== cj && !S.memeCodeParConventionX(cp, cj)) champs.push('code');
    if (np && nj && S.comparerNumeros(np, nj) !== 'exact') champs.push('numero');
    return champs;
}
const langue = x => (typeof x === 'string' && x.trim() ? x.trim().toUpperCase().replace(/^JA$/, 'JP') : null);
// LEÇON 1 : un jumeau dont la ligne porte une langue connue et DIFFÉRENTE de celle que la première lecture a lue est déjà séparé par la langue
const separeParLaLangue = (premiere, j) => { const a = langue(premiere && premiere.langue), b = langue(j && j.langue); return Boolean(a && b && a !== b); };

/**
 * Faut-il une seconde lecture ? Seulement quand elle peut changer la décision (chaque bande coûte un appel) :
 * la première lecture a lu au moins le code ou le numéro (LEÇON 3), 1 ou 2 jumeaux, et TOUS ceux que la langue ne sépare pas sont séparables de P par le code ou le numéro.
 */
function besoin({ p, jumeaux, premiere } = {}) {
    const non = raison => ({ declencher: false, raison });
    if (!p || !Array.isArray(jumeaux) || !jumeaux.length || jumeaux.length > JUMEAUX_MAX) return non('aucun jumeau, ou trop de jumeaux pour une question');
    if (!premiere || (!normLu(premiere.setCode) && !normLu(premiere.numero))) return non('la première lecture n\'a lu ni le code ni le numéro : rien à confirmer');
    const fragiles = jumeaux.filter(j => !separeParLaLangue(premiere, j));
    if (!fragiles.length) return non('tous les jumeaux sont déjà séparés par la langue');
    if (fragiles.some(j => !separation(p, j).length)) return non('un jumeau que ni le code ni le numéro ne séparent');
    return { declencher: true, raison: `${fragiles.length} jumeau(x) que seul le code ou le numéro sépare` };
}

/**
 * La décision. @returns { confirme: boolean, raison: string } — `confirme` vrai ⇒ la route peut affirmer P ; faux ⇒ la réponse d'avant (la question) reste.
 * premiere : { setCode, numero, langue } lu par la chaîne ; seconde : { setCode, numero } (consensus de deux essais, null si illisible).
 * UN SEUL chemin mène à « confirme » : (a) aucun champ de la seconde lecture ne contredit P ; (b) pour CHAQUE jumeau non séparé par la langue, un champ de séparation (code ou numéro)
 * que la PREMIÈRE lecture avait lu, que la seconde lit à l'identique de P, et que le jumeau n'a pas.
 */
function decider({ p, jumeaux, premiere, seconde } = {}) {
    const non = raison => ({ confirme: false, raison });
    try {
        if (!p || !Array.isArray(jumeaux) || !jumeaux.length) return non('entrée incomplète');
        const s = seconde || {};
        const lu2 = { setCode: normLu(s.setCode), numero: normLu(s.numero) };
        if (!lu2.setCode && !lu2.numero) return non('la seconde lecture n\'a rien lu à l\'identique deux fois');
        // LEÇON 3 : on ne confirme que les champs que la PREMIÈRE lecture a lus (jamais un champ comblé par la seconde)
        const conf = { setCode: normLu(premiere && premiere.setCode) ? lu2.setCode : null, numero: normLu(premiere && premiere.numero) ? lu2.numero : null };
        if (!conf.setCode && !conf.numero) return non('aucun champ lu par la première lecture n\'est relu par la seconde');
        const cP = comparer(conf, p);
        // la CONTRADICTION lit tout ce que la seconde a lu (le sens prudent : elle retire une affirmation)
        const rP = comparer(lu2, p);
        const pourJ = j => comparer(lu2, j);
        // LEÇON 2 : le code lu ne retire pas à lui seul ; il retire si un AUTRE candidat porte ce code sans être contredit sur le numéro
        const autreAuCodeLu = rP.contredit.includes('code') && jumeaux.some(j => { const x = pourJ(j); return x.concorde.includes('code') && !x.contredit.includes('numero'); });
        const contre = rP.contredit.filter(f => f !== 'code' || autreAuCodeLu);
        if (contre.length) return non(`la seconde lecture contredit le produit (${contre.join(', ')})`);
        for (const j of jumeaux) {
            if (separeParLaLangue(premiere, j)) continue;
            const seps = separation(p, j);
            const cJ = comparer(conf, j);
            if (!seps.some(f => cP.concorde.includes(f) && cJ.contredit.includes(f))) return non(`la seconde lecture ne confirme pas ce qui sépare le jumeau ${j.idProduct}`);
        }
        return { confirme: true, raison: 'la seconde lecture confirme, pour le produit lu, un champ qui le sépare de chacun de ses jumeaux' };
    } catch (e) {
        return non(`décision impossible (${(e && e.name) || 'erreur'})`);                 // une exception n'est jamais une confirmation
    }
}

/**
 * Le fournisseur d'essais. `recadrer({ photos, corps })` rend les bandes (au plus 3, recadrages DISTINCTS) ou [] ; `lecteur(bande)` rend { setCode, number, total } (le modèle, injecté).
 * Deux essais d'abord, le troisième seulement s'ils divergent. Un champ n'est retenu que si DEUX essais le lisent à l'identique ; sinon null.
 * Ne LÈVE JAMAIS : un échec rend { echec: true } ; chaque appel TENTÉ est compté (compteur.appels, et le compteur global) — c'est le coût, qu'il ait réussi ou non.
 */
function creerFournisseur({ recadrer, lecteur, maxEssais } = {}) {
    const essaisMax = bornerEssais(maxEssais);
    return async function seconde({ photos, corps, compteur } = {}) {
        const c = compteur && typeof compteur === 'object' ? compteur : { appels: 0 };
        const essais = [];
        const lire = async bande => {
            c.appels = (c.appels || 0) + 1;                                        // l'appel est compté AVANT d'être tenté : un appel qui échoue a coûté quand même (la route additionne au compteur global)
            const r = await lecteur(bande);
            if (!r || typeof r !== 'object' || r.illisible) { essais.push({ setCode: null, numero: null, total: null }); return; }     // une réponse illisible est un essai sans champ, jamais un champ
            essais.push({ setCode: normLu(r.setCode), numero: normLu(r.number ?? r.numero), total: normLu(r.total) });
        };
        try {
            const bandes = await recadrer({ photos, corps });
            if (!Array.isArray(bandes) || !bandes.length) return { setCode: null, numero: null, total: null, essais, echec: false, raison: 'aucune bande à lire (pas de recadrage possible)' };
            await lire(bandes[0]);
            if (bandes.length > 1) await lire(bandes[1]);
            const accord = f => essais.length >= 2 && essais[0][f] === essais[1][f];
            if (essais.length === 2 && essaisMax >= 3 && bandes.length > 2 && !(accord('setCode') && accord('numero'))) await lire(bandes[2]);
        } catch (e) {
            return { setCode: null, numero: null, total: null, essais, echec: true, raison: `échec de la lecture (${(e && (e.code || e.name)) || 'erreur'})` };
        }
        const consensus = f => { const n = new Map(); for (const e of essais) if (e[f] != null) n.set(e[f], (n.get(e[f]) ?? 0) + 1); const [v, k] = [...n].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]; return k >= 2 ? v : null; };
        const r = { setCode: consensus('setCode'), numero: consensus('numero'), total: consensus('total'), essais, echec: false };
        r.raison = r.setCode || r.numero ? `lu par ${essais.length} essais (accord d'au moins deux)` : 'illisible : aucun champ lu deux fois à l\'identique';
        return r;
    };
}

module.exports = { besoin, decider, creerFournisseur, bornerEssais, comparer, separation, premiereFois, reinitialiser, compteurs, noter, JUMEAUX_MAX, ESSAIS_DEFAUT };
