// ============================================================
// LA PROVENANCE PAR CHAMP DES DONNÉES D'ORIGINE BULBAPEDIA, ET LA MARQUE « À RECONFIRMER » — fonction PURE (aucune base)
// ============================================================
// Décision du testeur (2026-10-17) : « pour les cas sans aucun remplaçant, garde la valeur, marque-la à reconfirmer, et ne la sers pas comme seule preuve d'une
// identification ». Ce module PLANIFIE l'écriture ; poser-provenance-bulba.js l'exécute (à blanc par défaut, puis sur un plan SIGNÉ).
//
//   provenance.source = 'bulbapedia' · provenance.le = date de la dernière passe       ← au niveau du DOCUMENT (jamais répétés par champ : −1/3 du poids)
//   provenance.<champ> = { confirmePar: ['pkmncards', 'tcgdex'], accord: 'plein'|'partiel'|'arbitrage', empreinteValeur }        au moins une source INDÉPENDANTE concorde
//   provenance.<champ> = { confirmePar: [], aReconfirmer: true, motif: 'desaccord'|'non-couvert', empreinteValeur }               aucune source ne confirme
//   (+ `contredit: [sources]` quand une source dit autre chose · `via` quand l'arbitrage a tranché)
//     accord « plein »   : une source donne la même valeur · « partiel » : elle ne confirme qu'une inclusion (attaques, date au mois) · « arbitrage » : un vocabulaire, jugé
//     motif « desaccord » : des sources disent autre chose · « non-couvert » : aucune source n'a interrogé ce champ (un doute d'INSTRUMENT, pas de source)
//   provenance.impressions = [{ k: 'intl|Fossil|42', numero: {…}, total: {…}, rarete: {…} }]   clé = tirage|expansion|numéro (#n au n-ième doublon), jamais l'index ; jamais d'entrée { k } vide
//
// 🔑 `empreinteValeur` (sha1 court de la valeur JSON normalisée) : la provenance mémorise CE QU'ELLE CERTIFIE. Une valeur changée plus tard (lot 5, recollecte) ne porte plus de
// confirmation valide : `confirmationValide(doc, champ)` rend faux, et la passe suivante REMPLACE l'entrée périmée par la décision d'aujourd'hui.
// 🔑 FORME ÉTRANGÈRE : une provenance déjà présente sous une autre forme (non objet, autre `source`, entrée sans `confirmePar` / `empreinteValeur`, impressions non tableau) n'est NI
// écrasée NI fusionnée : le document ou le champ est SAUTÉ, compté (`formeEtrangere`) et listé.
// 🔑 `provenance` est un champ INTERNE : le site ne le lit pas, la garde de lot ne le compte pas (aucun set revalidé). Le nom d'une source n'apparaît dans AUCUN champ public.
// 🔑 UN CHAMP `aReconfirmer` NE DOIT JAMAIS ÊTRE LA SEULE PREUVE D'UNE IDENTIFICATION (décision du testeur).
// 🔑 La garde s'écrit par ce qu'elle AUTORISE : « confirmé » = une source qui concorde ou un arbitrage « juste » ; tout le reste est « à reconfirmer ». La valeur n'est JAMAIS modifiée ici.
// ADDITIF ET MONOTONE : un champ absent se pose ; « à reconfirmer » devient confirmé quand une source concorde ; une confirmation s'enrichit (union, meilleur accord) tant que la VALEUR
// certifiée est celle d'aujourd'hui.
const crypto = require('crypto');
const NOMS = { pkc: 'pkmncards', tdx: 'tcgdex', jp: 'pokemon-card.com' };
const SOURCE = 'bulbapedia';
const RANG = { partiel: 1, arbitrage: 2, plein: 3 };

const vide = v => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const nomsSources = srcs => [...new Set(srcs.map(s => NOMS[String(s).split('.')[0]]).filter(Boolean))].sort();

/** JSON canonique : clés triées, dates en ISO, clés `ignorer` omises. */
function canon(v, ignorer = []) {
    const t = x => x instanceof Date ? x.toISOString() : Array.isArray(x) ? x.map(t) : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).filter(k => !ignorer.includes(k)).sort().map(k => [k, t(x[k])])) : x;
    const s = JSON.stringify(t(v));
    return s === undefined ? 'undefined' : s;
}
/** L'empreinte de la valeur certifiée : sha1 court du JSON canonique. */
const empreinteValeur = v => crypto.createHash('sha1').update(canon(v)).digest('hex').slice(0, 10);
/** L'empreinte d'un plan d'écriture : sha256 du JSON canonique des écritures, SANS les dates (`le`, `provenance.le`) — un rejeu à une autre date a la même empreinte. */
const empreintePlan = ecritures => crypto.createHash('sha256').update(canon(ecritures, ['le', 'provenance.le'])).digest('hex');

/** Une entrée de champ que NOUS avons écrite : un objet avec `confirmePar` (tableau) et `empreinteValeur`. Tout le reste est une forme étrangère. */
const formeConnue = x => !!x && typeof x === 'object' && !Array.isArray(x) && Array.isArray(x.confirmePar) && typeof x.empreinteValeur === 'string';

/** Fusion monotone de l'ancienne entrée et de la nouvelle. Rend { entree, change }. */
function fusionner(ancienne, neuve) {
    if (!ancienne) return { entree: neuve, change: true };
    // la VALEUR a changé depuis la confirmation : elle ne certifie plus rien, la décision d'aujourd'hui la remplace (même si c'est « à reconfirmer »)
    if (ancienne.empreinteValeur !== neuve.empreinteValeur) return { entree: neuve, change: true };
    if (ancienne.aReconfirmer && !neuve.aReconfirmer) return { entree: neuve, change: true };
    if (!ancienne.aReconfirmer && !neuve.aReconfirmer) {
        const union = [...new Set([...(ancienne.confirmePar || []), ...neuve.confirmePar])].sort();
        const mieux = (RANG[neuve.accord] || 0) > (RANG[ancienne.accord] || 0);
        if (union.length > (ancienne.confirmePar || []).length || mieux) {
            const e = { ...ancienne, confirmePar: union };
            if (mieux) { e.accord = neuve.accord; if (neuve.via) e.via = neuve.via; else delete e.via; }
            return { entree: e, change: true };
        }
    }
    return { entree: ancienne, change: false };
}

/** La décision d'un champ à partir de sa ligne de confrontation et de l'arbitrage éventuel. `valeur` = la valeur Bulbapedia certifiée (son empreinte est mémorisée). */
function decider(ligne, arbitrage, valeur) {
    const emp = empreinteValeur(valeur);
    const reconf = (motif, extra = {}) => ({ confirmePar: [], aReconfirmer: true, motif, empreinteValeur: emp, ...extra });
    if (!ligne) return reconf('non-couvert');                                                          // aucune comparaison possible : sans remplaçant
    const par = Object.entries(ligne.parSource || {});
    const ok = par.filter(([, x]) => x.statut === 'ok').map(([s]) => s);
    const approx = par.filter(([, x]) => x.statut === 'approx').map(([s]) => s);
    const ko = par.filter(([, x]) => x.statut === 'ko').map(([s]) => s);
    const contre = ko.length ? { contredit: nomsSources(ko) } : {};
    if (ok.length) return { confirmePar: nomsSources(ok), accord: 'plein', empreinteValeur: emp, ...contre };
    if (approx.length) return { confirmePar: nomsSources(approx), accord: 'partiel', empreinteValeur: emp, ...contre };
    if (ko.length) {
        if (arbitrage && arbitrage.verdict === 'juste') {
            const temoins = nomsSources((arbitrage.temoins || []).map(t => t.source));
            if (temoins.length) return { confirmePar: temoins, accord: 'arbitrage', empreinteValeur: emp, via: arbitrage.raison || 'arbitrage', ...contre };
        }
        return reconf('desaccord', contre);
    }
    return reconf('non-couvert');
}

const CHAMPS_CARTE = ['illustrateur', 'pv', 'retraite', 'faiblesse', 'resistance', 'attaques', 'ndex'];
const numerique = v => v !== null && v !== undefined && /^\d+$/.test(String(v).trim());

/**
 * L'ORIGINE DES CHAMPS DE SET, d'après le code qui les écrit (relecture 1) : un champ ne s'étiquette « bulbapedia » que si son origine y est PROUVÉE.
 *   · dateSortieEn / dateSortieJa : collecteur-texte.js:193 les écrit depuis l'infobox SANS étiquette, puis poser-dates-sets.js les réécrit (tcgdex, officielle, majorité…) AVEC
 *     `<champ>Source` ; une date sans étiquette est donc d'origine inconnue : elle n'est certifiée que si son étiquette commence par « bulbapedia ».
 *   · type : collecter-type-sets.js:97 écrit `typeSource: 'bulbapedia:infobox'` ; même règle.
 *   · totalImprime : collecteur-texte.js:195 (infobox Bulbapedia) en est le SEUL écrivain non nul — creer-sets-sans-page.js, creer-sets-par-pages-de-cartes.js, creer-sets-reimpressions.js
 *     et collecte-cartes/set-partiel.js écrivent `null`. Pas d'étiquette, origine prouvée par le code.
 * Source inconnue ou absente = AUCUNE provenance posée, comptée (`setsSansOrigine`).
 */
const ORIGINE_SET = {
    dateSortieEn: { marqueur: 'dateSortieEnSource', ecritPar: 'collecteur-texte.js:193 puis poser-dates-sets.js (étiquette écrite)' },
    dateSortieJa: { marqueur: 'dateSortieJaSource', ecritPar: 'collecteur-texte.js:193 puis poser-dates-sets.js (étiquette écrite)' },
    type: { marqueur: 'typeSource', ecritPar: 'collecter-type-sets.js:97 (typeSource écrite)' },
    totalImprime: { marqueur: null, ecritPar: 'collecteur-texte.js:195, seul écrivain non nul (les quatre autres créateurs de sets écrivent null)' },
};
/** @returns {{retenus:string[], sansOrigine:string[]}} */
function champsDuSet(s) {
    const retenus = [], sansOrigine = [];
    for (const [ch, o] of Object.entries(ORIGINE_SET)) {
        if (vide(s[ch])) continue;
        if (o.marqueur === null) { retenus.push(ch); continue; }
        const src = s[o.marqueur];
        if (typeof src === 'string' && /^bulbapedia/.test(src)) retenus.push(ch); else sansOrigine.push(ch);
    }
    return { retenus, sansOrigine };
}

/** Les clés d'impression d'une carte (tirage|expansion|numéro, « #n » au n-ième doublon), alignées sur l'index des impressions (null si l'impression n'a pas de clé). */
function clesImpressions(impressions) {
    const vus = new Map();
    return (impressions || []).map(im => {
        if (!im || !im.tirage || !im.expansion) return null;
        const base = `${im.tirage}|${im.expansion}|${im.numero ?? ''}`;
        const n = (vus.get(base) || 0) + 1; vus.set(base, n);
        return n === 1 ? base : `${base}#${n}`;
    });
}

/** L'état de la provenance d'un document : absente, la nôtre, ou ÉTRANGÈRE (on n'y touche pas). */
function etatProvenance(p0) {
    if (p0 === undefined || p0 === null) return 'absente';
    if (typeof p0 !== 'object' || Array.isArray(p0)) return 'etrangere';
    if (!Object.keys(p0).length) return 'absente';
    return p0.source === SOURCE ? 'bulbapedia' : 'etrangere';
}

/**
 * @param {{cartes:object[], sets:object[], lignes:object[], appariements:object[], arbitrages:object[], maintenant:Date}} d
 *   lignes / appariements : confronter-bulba.js · arbitrages : les entrées de arbitrerTout (champ, cle, verdict, temoins, raison)
 * @returns {{ecritures:{collection:string,_id:*,champs:Object}[], compte:object}}
 */
function planifierProvenance({ cartes, sets, lignes, appariements, arbitrages, maintenant }) {
    const L = new Map(lignes.map(l => [l.champ + '\u0000' + String(l.cle), l]));
    const A = new Map((arbitrages || []).map(a => [a.champ + '\u0000' + String(a.cle), a]));
    const parCarte = new Map();
    for (const a of appariements || []) { if (!parCarte.has(a.carteId)) parCarte.set(a.carteId, []); parCarte.get(a.carteId).push(a); }
    const compte = { cartes: 0, sets: 0, documents: 0, champsAEcrire: 0, doublonsCle: 0, clesEnDouble: 0, parChamp: {}, setsSansOrigine: {}, formeEtrangere: { documents: 0, champs: 0, liste: [] } };
    const tally = (champ, entree, ecrit) => {
        const p = (compte.parChamp[champ] ||= { plein: 0, partiel: 0, arbitrage: 0, aReconfirmerDesaccord: 0, aReconfirmerNonCouvert: 0, ecrits: 0 });
        if (entree.aReconfirmer) { if (entree.motif === 'desaccord') p.aReconfirmerDesaccord++; else p.aReconfirmerNonCouvert++; } else p[entree.accord] = (p[entree.accord] || 0) + 1;
        if (ecrit) p.ecrits++;
    };
    const etrangere = (collection, _id, chemin, doc) => { if (doc) compte.formeEtrangere.documents++; else compte.formeEtrangere.champs++; compte.formeEtrangere.liste.push({ collection, _id, chemin }); };
    const ecritures = [];

    /** Pose un champ : l'entrée existante de forme étrangère n'est jamais touchée. */
    const poser = (collection, _id, p0, champs, nom, neuve, tag) => {
        const ancienne = p0?.[nom];
        if (ancienne !== undefined && !formeConnue(ancienne)) { etrangere(collection, _id, 'provenance.' + nom, false); return; }
        const { entree, change } = fusionner(ancienne, neuve);
        tally(tag || nom, entree, change);
        if (change) { champs['provenance.' + nom] = entree; compte.champsAEcrire++; }
    };
    const clore = (collection, _id, champs, nb) => {
        if (!nb) return false;
        champs['provenance.source'] = SOURCE; champs['provenance.le'] = maintenant;
        ecritures.push({ collection, _id, champs }); return true;
    };

    for (const k of cartes) {
        const etat = etatProvenance(k.provenance);
        if (etat === 'etrangere') { etrangere('cartes', k._id, 'provenance', true); continue; }
        const champs = {}; const p0 = etat === 'bulbapedia' ? k.provenance : {}; const avantN = compte.champsAEcrire;
        const mes = parCarte.get(k._id) || [];
        const confirmeNom = tir => nomsSources(mes.filter(a => a.tirage === tir && a.nomOk).map(a => a.src));
        const interroge = tir => mes.some(a => a.tirage === tir);
        for (const [nom, tir] of [['nomEn', 'intl'], ['nomJa', 'jp']]) {
            if (vide(k[nom])) continue;
            const c = confirmeNom(tir); const emp = empreinteValeur(k[nom]);
            poser('cartes', k._id, p0, champs, nom, c.length ? { confirmePar: c, accord: 'plein', empreinteValeur: emp } : { confirmePar: [], aReconfirmer: true, motif: interroge(tir) ? 'desaccord' : 'non-couvert', empreinteValeur: emp }, 'carte.' + nom);
        }
        for (const ch of CHAMPS_CARTE) {
            if (vide(k[ch])) continue;
            const cle = 'carte.' + ch;
            poser('cartes', k._id, p0, champs, ch, decider(L.get(cle + '\u0000' + String(k._id)), A.get(cle + '\u0000' + String(k._id)), k[ch]), cle);
        }
        // impressions : par clé tirage|expansion|numéro, jamais par index
        let impressionsEtrangeres = false;
        if (p0.impressions !== undefined && !Array.isArray(p0.impressions)) { impressionsEtrangeres = true; etrangere('cartes', k._id, 'provenance.impressions', false); }
        if (!impressionsEtrangeres) {
            const sortie = (p0.impressions || []).map(x => x); const index = new Map();
            sortie.forEach((x, i) => { if (x && typeof x.k === 'string' && !index.has(x.k)) index.set(x.k, i); });
            let changeI = false;
            const cles = clesImpressions(k.impressions);
            (k.impressions || []).forEach((im, idx) => {
                const kk = cles[idx]; if (!kk) return;
                if (kk.includes('#')) compte.clesEnDouble++;
                const ikey = `${k._id}#${idx}`;
                const existe = index.has(kk);
                const cur = existe ? { ...sortie[index.get(kk)] } : { k: kk };
                const apps = mes.filter(a => a.idx === idx && a.nomOk).map(a => a.src);
                const desaccordNom = mes.some(a => a.idx === idx);
                const champsI = {};
                if (!vide(im.numero)) champsI.numero = apps.length ? { confirmePar: nomsSources(apps), accord: 'plein', empreinteValeur: empreinteValeur(im.numero) } : { confirmePar: [], aReconfirmer: true, motif: desaccordNom ? 'desaccord' : 'non-couvert', empreinteValeur: empreinteValeur(im.numero) };
                if (numerique(im.total)) champsI.total = decider(L.get('impression.total\u0000' + ikey), A.get('impression.total\u0000' + ikey), im.total);
                if (!vide(im.rarete)) champsI.rarete = decider(L.get('impression.rarete\u0000' + ikey), A.get('impression.rarete\u0000' + ikey), im.rarete);
                let changeCet = false;
                for (const [nom, neuve] of Object.entries(champsI)) {
                    const ancienne = cur[nom];
                    if (ancienne !== undefined && !formeConnue(ancienne)) { etrangere('cartes', k._id, `provenance.impressions[${kk}].${nom}`, false); continue; }
                    const { entree, change } = fusionner(ancienne, neuve);
                    tally('impression.' + nom, entree, change);
                    if (change) { cur[nom] = entree; changeCet = true; compte.champsAEcrire++; }
                }
                if (changeCet) {
                    changeI = true;
                    if (existe) sortie[index.get(kk)] = cur; else { index.set(kk, sortie.length); sortie.push(cur); }   // jamais d'entrée { k } vide : on n'arrive ici que s'il y a un champ
                }
            });
            if (changeI) champs['provenance.impressions'] = sortie;
        }
        if (clore('cartes', k._id, champs, compte.champsAEcrire - avantN)) compte.cartes++;
    }

    for (const s of sets) {
        const etat = etatProvenance(s.provenance);
        if (etat === 'etrangere') { etrangere('sets', s._id, 'provenance', true); continue; }
        const champs = {}; const p0 = etat === 'bulbapedia' ? s.provenance : {}; const avantN = compte.champsAEcrire;
        const { retenus, sansOrigine } = champsDuSet(s);
        for (const ch of sansOrigine) compte.setsSansOrigine[ch] = (compte.setsSansOrigine[ch] || 0) + 1;
        for (const ch of retenus) {
            const cle = 'set.' + ch;
            poser('sets', s._id, p0, champs, ch, decider(L.get(cle + '\u0000' + String(s._id)), A.get(cle + '\u0000' + String(s._id)), s[ch]), cle);
        }
        if (clore('sets', s._id, champs, compte.champsAEcrire - avantN)) compte.sets++;
    }
    compte.documents = ecritures.length;
    return { ecritures, compte };
}

/**
 * La provenance certifie-t-elle encore LA valeur d'aujourd'hui ? Faux si le champ est « à reconfirmer », sans provenance, de forme étrangère, ou si la valeur a changé
 * depuis (l'empreinte mémorisée ne correspond plus). Pour une impression : `cle` = sa clé tirage|expansion|numéro.
 */
function confirmationValide(doc, champ, cle) {
    const p = doc && doc.provenance;
    if (etatProvenance(p) !== 'bulbapedia') return false;
    let x, valeur;
    if (cle === undefined) { x = p[champ]; valeur = doc[champ]; }
    else {
        const i = clesImpressions(doc.impressions).indexOf(cle);
        const item = Array.isArray(p.impressions) ? p.impressions.find(it => it && it.k === cle) : null;
        if (i < 0 || !item) return false;
        x = item[champ]; valeur = doc.impressions[i][champ];
    }
    return formeConnue(x) && !x.aReconfirmer && x.empreinteValeur === empreinteValeur(valeur);
}

/** Les champs de documents que le planificateur LIT : le chargeur (charger-bulba.js) doit tous les projeter (une projection trop étroite se lit « absent »). */
const CHAMPS_LUS = {
    cartes: ['nomEn', 'nomJa', 'impressions', 'provenance', ...CHAMPS_CARTE],
    sets: ['dateSortieEn', 'dateSortieEnSource', 'dateSortieJa', 'dateSortieJaSource', 'totalImprime', 'type', 'typeSource', 'provenance'],
};

/** Applique un `$set` à chemins pointés à une COPIE d'un document (pour les bancs et la relecture à blanc). */
function appliquer(doc, champs) {
    for (const [chemin, v] of Object.entries(champs)) {
        const parts = chemin.split('.'); let o = doc;
        for (const p of parts.slice(0, -1)) o = (o[p] ||= {});
        o[parts[parts.length - 1]] = v;
    }
    return doc;
}

// ── LA LIGNE DE COMMANDE (écrite par ce qu'elle AUTORISE).
//   essai à blanc :  --sortie=<plan.json>  (écrit le plan et imprime son sha256)
//   écriture      :  --ecrire --attendu=<n> --plan=<plan.json> --empreinte=<sha256 du fichier>  — `--attendu` (nombre de champs) reste obligatoire ; `--sources=` / `--variants=`
//                    ne sont acceptés que s'ils sont ceux du plan ; l'écriture RECALCULE le plan et refuse s'il diffère (verifierPlanFichier).
const OPTIONS = /^(--ecrire|--lecture-via-ecriture|--attendu=.*|--sources=.+|--variants=.+|--sortie=.+|--plan=.+|--empreinte=.*)$/;
function analyserArguments(argv) {
    const erreurs = [];
    const ecrire = argv.includes('--ecrire'), viaEcriture = argv.includes('--lecture-via-ecriture');
    const val = n => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? null : a.slice(n.length + 3); };
    for (const x of argv) if (!OPTIONS.test(x)) erreurs.push(`argument inconnu : ${x} — autorisés : --ecrire, --attendu=<n>, --plan=<fichier>, --empreinte=<sha256>, --lecture-via-ecriture, --sources=, --variants=, --sortie=`);
    const att = argv.find(x => x.startsWith('--attendu='));
    let attendu = null;
    if (att !== undefined) {
        if (!/^--attendu=\d+$/.test(att)) erreurs.push(`${att} : un entier positif ou nul est exigé`);
        else attendu = Number(att.slice(10));
        if (!ecrire) erreurs.push('--attendu n\'a de sens qu\'avec --ecrire');
    } else if (ecrire) erreurs.push('--ecrire exige --attendu=<n> (le nombre de champs de provenance à écrire, annoncé par la simulation)');
    const plan = val('plan'), empreinte = val('empreinte'), sortie = val('sortie');
    if (ecrire) {
        if (!plan) erreurs.push('--ecrire exige --plan=<fichier> (le plan écrit par l\'essai à blanc, --sortie=)');
        if (empreinte === null) erreurs.push('--ecrire exige --empreinte=<sha256 du fichier de plan> (imprimée par l\'essai à blanc)');
        else if (!/^[0-9a-f]{64}$/.test(empreinte)) erreurs.push('--empreinte : un sha256 (64 caractères hexadécimaux) est exigé');
        if (sortie) erreurs.push('--sortie n\'a de sens qu\'à blanc : l\'écriture lit un plan, elle n\'en écrit pas');
    } else {
        if (plan) erreurs.push('--plan n\'a de sens qu\'avec --ecrire');
        if (empreinte !== null) erreurs.push('--empreinte n\'a de sens qu\'avec --ecrire');
    }
    return { erreurs, ecrire, attendu, viaEcriture, plan, empreinte, sources: val('sources'), variants: val('variants'), sortie };
}
const verifierPlan = (plan, attendu) => plan === attendu ? null : `le plan écrirait ${plan} champs, --attendu=${attendu} : refus avant toute écriture (relancer la simulation)`;
const verifierRelecture = ({ ecrits, attendu, restants, modifies, documents }) => ecrits !== attendu ? `${ecrits} champs écrits, ${attendu} attendus`
    : (Number.isFinite(modifies) && Number.isFinite(documents) && modifies !== documents) ? `${modifies} documents modifiés (modifiedCount) pour ${documents} envoyés`
    : restants ? `${restants} champs restent à écrire après l'écriture (le plan rejoué n'est pas à zéro)` : null;

/**
 * Le plan signé : l'écriture recalcule le plan et le compare à celui de l'essai à blanc. Rend la liste des refus (vide = accord).
 * @param {{plan:object, shaFichier:string, empreinteDonnee:string, recalcul:{attendu:number, empreinteEcritures:string, entrees:Object}, options:{sources:?string, variants:?string}}} d
 *   `entrees` = sha256 des fichiers lus (index des sources, variantes, table d'alias) ; `options` = ce que la ligne de commande de l'écriture donne (null = non donné).
 */
function verifierPlanFichier({ plan, shaFichier, empreinteDonnee, recalcul, options }) {
    const e = [];
    if (shaFichier !== empreinteDonnee) e.push('l\'empreinte donnée n\'est pas le sha256 du fichier de plan (fichier modifié ou mauvaise empreinte)');
    if (plan.attendu !== recalcul.attendu) e.push(`le plan recalculé écrirait ${recalcul.attendu} champs, celui de l'essai à blanc ${plan.attendu}`);
    if (plan.empreinteEcritures !== recalcul.empreinteEcritures) e.push('le contenu des écritures recalculées diffère de celui du plan (les données ont changé depuis l\'essai à blanc)');
    if (canon(plan.entrees) !== canon(recalcul.entrees)) e.push('un fichier d\'entrée (index des sources, variantes, table d\'alias) n\'est plus celui du plan');
    for (const o of ['sources', 'variants']) if (options && options[o] != null && options[o] !== (plan.options || {})[o]) e.push(`--${o}=${options[o]} n'est pas celui du plan (${(plan.options || {})[o] ?? 'défaut'})`);
    return e;
}

module.exports = { planifierProvenance, appliquer, decider, fusionner, champsDuSet, confirmationValide, clesImpressions, empreinteValeur, empreintePlan, verifierPlanFichier,
    analyserArguments, verifierPlan, verifierRelecture, formeConnue, CHAMPS_LUS, ORIGINE_SET, NOMS };
