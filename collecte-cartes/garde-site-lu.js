// ============================================================
// LA LISTE DE CE QUE LE SITE LIT SE CONFRONTE AU SITE, À CHAQUE LOT (tour de correction 1, 2026-10-24)
// ============================================================
// garde-lot.js porte SITE_LIT, la liste (figée, pure) des champs que le site lit — c'est elle qui décide quels sets un lot fait revalider. Une liste recopiée vieillit : un champ que le site ajoute à son gabarit de
// lecture et que SITE_LIT n'a pas est une page qui reste vieille 30 jours, sans erreur (le 19/10, deux lots n'ont revalidé aucun set). Le banc seul ne suffit pas : il ne tourne pas AVANT un lot.
//
// 🔑 IMPORTER, PAS RECOPIER. Ce module importe le gabarit de lecture du site lui-même (rat-market-site/lib/lireDonnee.ts : SPEC_CARTE avec ses images et ses impressions, SPEC_PRODUIT avec visuelSubstitut,
// liens, SPEC_SET), par le MÊME mécanisme que exporter-donnees-logos-site.js (import() dynamique d'un fichier .ts, Node 24), puis aplatit chaque SPEC en chemins de champs (sans regex sur des types : on lit
// l'arbre `{ t: 'objet' | 'liste' | … }`). Tout champ que le site lit et que SITE_LIT ne couvre pas (lui-même, ou un ancêtre : `logo` couvre `logo.preuve`) REFUSE le lot (lot-additif.js, étape 0 ter, code 6,
// « rien n'a été sauvegardé ni écrit »). Écrit par ce qu'il AUTORISE : site introuvable, import qui lève, export absent, forme de SPEC inconnue — tout cela refuse aussi, jamais un « tout va bien ».
// ⚠️ ACCEPTÉ (tour 2, D4) : l'étape 0 ter lit le dossier de travail du site, pas sa version déployée ; une branche locale du site peut donc refuser un lot à tort, et cela échoue fermé.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DOSSIER_SITE_PAR_DEFAUT = 'C:/Users/Yung/Desktop/rat-market-site';
const refus = (raison) => new Error(`garde site lu : je ne peux pas conclure (${String(raison).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 400)})`);
const SPECS_REQUISES = Object.freeze(['SPEC_CARTE', 'SPEC_PRODUIT', 'SPEC_SET']);

/** Importe le gabarit de lecture du site. Rend { dossier, SPEC_CARTE, SPEC_PRODUIT, SPEC_SET }. LÈVE si quoi que ce soit manque ou ne s'importe pas. */
async function chargerSite({ dossier } = {}) {
    const dir = path.resolve(dossier || process.env.SITE_DIR || DOSSIER_SITE_PAR_DEFAUT);
    try {
        const f = path.join(dir, 'lib', 'lireDonnee.ts');
        if (!fs.existsSync(f)) throw new Error(`lib/lireDonnee.ts introuvable dans le dossier du site`);
        const mod = await import(pathToFileURL(f).href);
        const specs = {};
        for (const k of SPECS_REQUISES) {
            if (!mod[k] || typeof mod[k] !== 'object') throw new Error(`${k} absent de lireDonnee.ts`);
            specs[k] = mod[k];
        }
        return { dossier: dir, ...specs };
    } catch (e) { throw refus(e.message); }
}

/**
 * Les chemins (pointés) de tous les champs FEUILLES d'une SPEC du site. `objet` : ses `champs` ; `liste` : les chemins de son élément (un tableau ne change pas le chemin) ; tout autre type est une feuille.
 * `_id` à la racine est l'identité du document, pas un champ affiché : écarté. Une forme inconnue LÈVE (une SPEC qu'on ne sait pas lire ne se compare pas).
 */
function cheminsDeSpec(spec, prefixe = '') {
    if (!spec || typeof spec !== 'object' || typeof spec.t !== 'string') throw refus(`SPEC illisible${prefixe ? ` à « ${prefixe} »` : ''}`);
    if (spec.t === 'objet') {
        if (!spec.champs || typeof spec.champs !== 'object') throw refus(`objet sans champs à « ${prefixe || '(racine)'} »`);
        return Object.entries(spec.champs).flatMap(([k, s]) => (prefixe === '' && k === '_id' ? [] : cheminsDeSpec(s, prefixe ? `${prefixe}.${k}` : k)));
    }
    if (spec.t === 'liste') return cheminsDeSpec(spec.el, prefixe);
    return [prefixe];
}

/** Les chemins que SITE_LIT déclare, par collection (les sous-listes impressions/images sont préfixées). */
function cheminsDeSiteLit(siteLit) {
    return {
        cartes: [...siteLit.cartes, ...siteLit.impressions.map(c => `impressions.${c}`), ...siteLit.images.map(c => `images.${c}`)],
        produits: [...siteLit.lignes],
        sets: [...siteLit.sets]
    };
}
const couvre = (declare, chemin) => declare === chemin || chemin.startsWith(`${declare}.`);
/**
 * (tour 2, D3) Un chemin du site est couvert si SITE_LIT le déclare, ou déclare un ANCÊTRE — sauf sous un objet à FORME FIGÉE (SITE_LIT.formes : la vignette, dateSortieMois, symbolesIdentification), que la comparaison
 * lit sous-champ par sous-champ : là, le sous-champ doit être exactement l'un de ceux que la comparaison connaît, sinon un sous-champ que le site se met à lire passerait « couvert » par son ancêtre sans que
 * personne le compare. CHOIX (parmi les deux admis) : exiger les sous-chemins, plutôt que comparer l'objet entier — comparer `vignette` ou `symbolesIdentification` en entier ferait revalider des pages pour des
 * champs que le site ne lit pas (sha, octets : le quota Vercel, §63), alors que refuser l'étape 0 ter pour un sous-champ nouveau coûte une ligne de liste, une fois.
 * Les formes sont le sens de lecture « le site ⊆ la comparaison » ; un sous-champ connu de la comparaison que le site ne lit plus est inoffensif (au pire une page de trop) et ne refuse pas.
 */
const estCouvert = (declares, chemin, formes = {}) => {
    const figee = Object.keys(formes).find(f => chemin.startsWith(`${f}.`));
    if (figee) return declares.some(d => couvre(d, figee)) && formes[figee].includes(chemin.slice(figee.length + 1).split('.')[0]);
    return declares.some(d => couvre(d, chemin));
};

/** Les champs que les SPEC du site lisent et que SITE_LIT ne couvre pas : [{ collection, chemin }]. [] = la liste est complète. */
function confronter(specs, siteLit) {
    const decl = cheminsDeSiteLit(siteLit), formes = siteLit.formes || {};
    const manque = [];
    for (const [collection, spec, declares] of [['cartes', specs.SPEC_CARTE, decl.cartes], ['cartes_produits', specs.SPEC_PRODUIT, decl.produits], ['sets', specs.SPEC_SET, decl.sets]]) {
        const chemins = cheminsDeSpec(spec);
        if (!chemins.length) throw refus(`la SPEC de « ${collection} » n'a aucun champ : un vide parfait n'est pas une liste complète`);
        for (const chemin of chemins) if (!estCouvert(declares, chemin, formes)) manque.push({ collection, chemin });
    }
    return manque;
}

/** Charge le site et confronte. Rend { dossier, champs } si la liste est complète ; LÈVE sinon (manque nommé, ou impossibilité de conclure). */
async function verifierSiteLu({ siteLit, dossier } = {}) {
    const site = await chargerSite({ dossier });
    // (tour 2, D3) une entrée pointée de SITE_LIT.sets sans forme dans la comparaison ne comparerait que du vide : refus
    const sansForme = require('./garde-lot').entreesSetsSansForme(siteLit);
    if (sansForme.length) throw new Error(`garde site lu : SITE_LIT.sets porte ${sansForme.join(', ')} sans forme dans la comparaison (SETS_A_FORME de garde-lot.js) — elle comparerait null pour toujours`);
    let manque;
    try { manque = confronter(site, siteLit); } catch (e) { throw /^garde site lu/.test(e.message) ? e : refus(e.message); }
    if (manque.length) throw new Error(`garde site lu : ${manque.length} champ(s) que le site lit sont absents de SITE_LIT (collecte-cartes/garde-lot.js) — un lot ne revaliderait pas leurs pages : ${manque.slice(0, 12).map(m => `${m.collection}.${m.chemin}`).join(', ')}${manque.length > 12 ? ', …' : ''}`);
    return { dossier: site.dossier, champs: ['SPEC_CARTE', 'SPEC_PRODUIT', 'SPEC_SET'].reduce((n, k) => n + cheminsDeSpec(site[k]).length, 0) };
}

module.exports = { chargerSite, cheminsDeSpec, cheminsDeSiteLit, confronter, verifierSiteLu, DOSSIER_SITE_PAR_DEFAUT };
