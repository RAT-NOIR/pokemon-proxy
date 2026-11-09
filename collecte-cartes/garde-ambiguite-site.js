'use strict';
// ============================================================
// LA GARDE DE LOT REJOUE `documentAmbigu` DU SITE (incident du 2026-11-09)
// ============================================================
// Le site (rat-market-site/lib/impressionsDuSet.ts) applique `documentAmbigu` : un document qui a plusieurs fiches d'impression dans un set ET une image
// de ce set sans numéro fait passer le set ENTIER en « une fiche par document » — les fiches d'impression disparaissent en production. Un de nos lots a posé
// une telle image ; ni la comparaison des comptes (garde-lot.js) ni le contrat de l'API (garde-contrat-api.js) ne l'ont vu.
//
// 🔑 ON NE RECOPIE RIEN : `fichesDuDocument`, `documentAmbigu`, `setParImpression`, `impressionDuSet`, `impressionsEtAnnexes`, `expansionsDuSet`, `tirageDuSet` sont IMPORTÉES du
// site, comme exporter-donnees-logos-site.js et poser-numero-image.js. Une règle absente, ou une exception, REFUSE de conclure (le lot s'arrête) : jamais un « ✅ ».
// 🔑 CE QUI ARRÊTE : (a) un document qui DEVIENT ambigu dans un set touché (absent des ambigus de la sauvegarde, présent après) ; (b) un set qui BASCULE de « par impression » à
// « par document » à cause du lot. Un document déjà ambigu avant le lot ne bloque pas : il s'imprime (persistant).
// Même construction que le site (entreesDuSet.ts : documents = cartes du set, impressions = celles du set puis ses annexes, images = celles du set).
const path = require('path');
const { pathToFileURL } = require('url');

const refus = raison => new Error(`garde ambiguïté du site : je ne peux pas conclure (${String(raison).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 300)})`);
const LIB_PAR_DEFAUT = () => process.env.RAT_MARKET_SITE_LIB || 'C:/Users/Yung/Desktop/rat-market-site/lib';
const importerLocal = chemin => import(pathToFileURL(chemin).href);

/** Importe les règles du site. LÈVE (« je ne peux pas conclure ») si un fichier ou une fonction manque. */
async function chargerRegleAmbiguite({ lib = LIB_PAR_DEFAUT(), importer = importerLocal } = {}) {
    try {
        const [I, E, A, D] = await Promise.all(['impressionsDuSet.ts', 'entreesDuSet.ts', 'annexes.ts', 'impressionDuSet.ts'].map(f => importer(path.join(lib, f))));
        const regle = { fichesDuDocument: I.fichesDuDocument, documentAmbigu: I.documentAmbigu, setParImpression: I.setParImpression, expansionsDuSet: E.expansionsDuSet, tirageDuSet: E.tirageDuSet,
            impressionsEtAnnexes: A.impressionsEtAnnexes, impressionDuSet: D.impressionDuSet };
        for (const [k, f] of Object.entries(regle)) if (typeof f !== 'function') throw new Error(`règle du site absente : ${k} (${lib})`);
        return regle;
    } catch (e) { throw /^garde ambiguïté/.test(e.message) ? e : refus(e.message); }
}

/** Pur. L'état d'ambiguïté des sets `slugs` dans { cartes, sets } : Map slug -> { documents, ambigus: [carteId], parImpression }. Un set absent de `sets` n'a pas d'entrée. */
function etatAmbiguite({ cartes, sets }, slugs, regle) {
    for (const k of ['fichesDuDocument', 'documentAmbigu', 'setParImpression', 'expansionsDuSet', 'tirageDuSet', 'impressionsEtAnnexes', 'impressionDuSet'])
        if (!regle || typeof regle[k] !== 'function') throw refus(`règle du site absente : ${k}`);
    if (!Array.isArray(cartes) || !cartes.length || !Array.isArray(sets) || !sets.length) throw refus('cartes ou sets vides : une comparaison sur du vide ne mesure rien');
    const parSet = new Map(sets.map(s => [s._id, s]));
    const docsParSet = new Map(slugs.map(s => [s, []]));
    for (const c of cartes) for (const s of c.sets || []) if (docsParSet.has(s) && typeof c.nomEn === 'string' && c.nomEn !== '') docsParSet.get(s).push(c);
    const etat = new Map();
    for (const slug of slugs) {
        const set = parSet.get(slug);
        if (!set) continue;
        const cible = { tirage: regle.tirageDuSet(set), expansions: regle.expansionsDuSet(set), deck: set.deck ?? null };
        const documents = docsParSet.get(slug).map(c => ({
            id: c._id,
            fiches: regle.fichesDuDocument(regle.impressionsEtAnnexes(c.impressions || [], c._id, cible, imp => !!imp && regle.impressionDuSet(imp, cible))),
            images: (c.images || []).filter(m => m && m.set === slug)
        }));
        const ambigus = documents.filter(d => regle.documentAmbigu(d.fiches, d.images)).map(d => d.id);
        etat.set(slug, { documents: documents.length, ambigus, parImpression: regle.setParImpression(documents, true) });
    }
    return etat;
}

/**
 * Pur. Compare l'état avant (sauvegarde) et après (base) sur `slugs`. Rend { sets, avant, apres, nouveaux[], bascules[], persistants[], fautives[], ligne }.
 * `fautives` est vide si et seulement si aucun document ne devient ambigu et aucun set ne bascule.
 */
function comparerAmbiguite(etatAvant, etatApres, slugs) {
    const nouveaux = [], bascules = [], persistants = [];
    let avant = 0, apres = 0, rejoues = 0;
    for (const slug of slugs) {
        const A = etatAvant.get(slug), B = etatApres.get(slug);
        if (!B) continue;                                          // set disparu : rien ne s'affiche, rien à juger
        rejoues++;
        const dejaAmbigus = new Set(A ? A.ambigus : []);
        avant += dejaAmbigus.size; apres += B.ambigus.length;
        for (const id of B.ambigus) (dejaAmbigus.has(id) ? persistants : nouveaux).push({ set: slug, carteId: id });
        if (A && A.parImpression && !B.parImpression) bascules.push(slug);
    }
    const fautives = [...nouveaux.map(n => `ambiguïté du site : le document ${n.carteId} devient AMBIGU dans le set ${n.set} (plusieurs fiches d'impression ET une image du set sans numéro)`),
        ...bascules.map(s => `ambiguïté du site : le set ${s} BASCULE de « une fiche par impression » à « une fiche par document » (les fiches d'impression disparaissent)`)];
    const ligne = `ambiguïté du site : ${rejoues} sets rejoués · documents ambigus avant ${avant}, après ${apres}, nouveaux ${nouveaux.length} · bascules ${bascules.length} · persistants ${persistants.length}`;
    return { sets: rejoues, avant, apres, nouveaux, bascules, persistants, fautives, ligne };
}

/** Rejoue la règle du site sur les sets touchés du lot. `touchesFn({avant, apres})` rend les slugs touchés (garde-contrat-api : setsTouchesContrat). N'attrape rien : l'appelant refuse de conclure. */
function verifierAmbiguite({ regle, avant, apres, touchesFn }) {
    if (typeof touchesFn !== 'function') throw refus('liste des sets touchés absente');
    const slugs = [...touchesFn({ avant, apres })];
    const a = etatAmbiguite({ cartes: avant.cartes, sets: avant.sets }, slugs, regle);
    const b = etatAmbiguite({ cartes: apres.cartes, sets: apres.sets }, slugs, regle);
    return comparerAmbiguite(a, b, slugs);
}

/** La forme que lot-additif.js consomme : jamais d'exception, une impossibilité de conclure est une fautive. */
function jouerAmbiguite({ regle, avant, apres, touchesFn }) {
    try {
        const v = verifierAmbiguite({ regle, avant, apres, touchesFn });
        return { ligne: v.ligne, fautives: v.fautives, persistants: v.persistants, v };
    } catch (e) {
        const raison = /^garde ambiguïté/.test(e.message) ? e.message : String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 300);
        return { ligne: 'ambiguïté du site : 🔴 je ne peux pas conclure', fautives: [`ambiguïté du site : je ne peux pas conclure (${raison})`], persistants: [], v: null };
    }
}

module.exports = { chargerRegleAmbiguite, etatAmbiguite, comparerAmbiguite, verifierAmbiguite, jouerAmbiguite };
