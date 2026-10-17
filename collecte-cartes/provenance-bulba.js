// ============================================================
// LA PROVENANCE DES DONNÉES D'ORIGINE BULBAPEDIA : EN BASE LA MARQUE « À RECONFIRMER », DANS UN FICHIER LES CONFIRMATIONS — fonction PURE (aucune base)
// ============================================================
// Décision du testeur (2026-10-17) : « pour les cas sans aucun remplaçant, garde la valeur, marque-la à reconfirmer, et ne la sers pas comme seule preuve d'une
// identification ». Ce module PLANIFIE l'écriture ; poser-provenance-bulba.js l'exécute (à blanc par défaut, puis sur un plan SIGNÉ).
// Correction 2 (coordinateur, 2026-10-18) : la grappe `cartes` est sur l'offre gratuite (212 Mo sur 512, +4,7 Mo par jour). La décision ne demande EN BASE que la marque ;
// les confirmations (~200 000 champs) vont dans un fichier JSON daté avec son empreinte sha256, que le plan d'écriture référence : ce fichier est la preuve de ce qui est confirmé.
//
//   EN BASE (cartes et sets) :
//     provenance.source = 'bulbapedia' · provenance.le = date de la dernière passe        ← posés UNE fois, au document
//     provenance.<champ> = { aReconfirmer: true, motif: 'desaccord'|'non-couvert', v: <empreinteValeur> }      c'est TOUT : ni confirmePar, ni accord
//     provenance.impressions = [{ k: 'intl|Fossil|42', rarete: { aReconfirmer, motif, v }, … }]   clé = tirage|expansion|numéro (#n au n-ième doublon), jamais l'index ;
//                                                                                                  seulement les impressions qui ont une marque, jamais d'entrée { k } vide
//     motif « desaccord » : des sources disent autre chose · « non-couvert » : aucune source n'a interrogé ce champ (un doute d'INSTRUMENT, pas de source)
//   DANS LE FICHIER (jamais en base) : { collection, _id, champ, [k], confirmePar, accord: 'plein'|'partiel'|'arbitrage', empreinteValeur, [via], [contredit] }
//     accord « plein » : une source donne la même valeur · « partiel » : elle ne confirme qu'une inclusion (attaques, date au mois) · « arbitrage » : un vocabulaire, jugé
//
// 🔑 `v` / `empreinteValeur` (sha1 court de la valeur JSON normalisée) : la provenance mémorise CE QU'ELLE MET EN DOUTE / CERTIFIE. Une valeur changée plus tard (lot 5, recollecte)
// rend la marque périmée : la passe suivante la REMPLACE (ou la RETIRE si la valeur est confirmée aujourd'hui) ; `confirmationValide` rend faux pour une confirmation périmée.
// 🔑 FORME ÉTRANGÈRE : une provenance déjà présente sous une autre forme (non objet, autre `source`, entrée qui n'est pas une marque minimale — y compris l'ancienne forme à
// `confirmePar` —, impressions non tableau) n'est NI écrasée NI fusionnée NI retirée : le document ou le champ est SAUTÉ, compté (`formeEtrangere`) et listé.
// 🔑 `provenance` est un champ INTERNE : le site ne le lit pas, la garde de lot ne le compte pas (aucun set revalidé). Le nom d'une source n'apparaît dans AUCUN champ public.
//    Vérifié en lecture seule dans rat-market-site (relecture 2, F6) : la SEULE lecture de `cartes` sans projection est lib/cartes.ts:885 (`findOne`, la fiche). `lireCarte` copie les
//    champs inconnus (lib/lireDonnee.ts:99 : « un champ inconnu d'un objet n'est jamais touché »), donc `provenance` entre dans `doc` — mais la fiche publique `carte` est reconstruite
//    CHAMP PAR CHAMP (lib/cartes.ts:952-989), `doc` n'est ni étalé ni renvoyé ni sérialisé, et aucune route de app/ ne lit `cartes`. `provenance.source` ne sort donc pas : la valeur
//    'bulbapedia' reste lisible (pas de code neutre). Si un lecteur renvoyait un jour `doc` tel quel, il faudrait remplacer 'bulbapedia' par un code neutre (ex. 'b').
// 🔑 UN CHAMP `aReconfirmer` NE DOIT JAMAIS ÊTRE LA SEULE PREUVE D'UNE IDENTIFICATION (décision du testeur).
// 🔑 La garde s'écrit par ce qu'elle AUTORISE : « confirmé » = une source qui concorde ou un arbitrage « juste » ; tout le reste est « à reconfirmer ». La valeur n'est JAMAIS modifiée ici.
// IDEMPOTENT : rejouer sur son propre résultat n'écrit rien. Le fichier des confirmations est RECALCULÉ à chaque passe (état complet, pas un diff).
const crypto = require('crypto');
const NOMS = { pkc: 'pkmncards', tdx: 'tcgdex', jp: 'pokemon-card.com' };
const SOURCE = 'bulbapedia';

const vide = v => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const nomsSources = srcs => [...new Set(srcs.map(s => NOMS[String(s).split('.')[0]]).filter(Boolean))].sort();

/** JSON canonique : clés triées, dates en ISO, clés `ignorer` omises. */
function canon(v, ignorer = []) {
    const t = x => x instanceof Date ? x.toISOString() : Array.isArray(x) ? x.map(t) : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).filter(k => !ignorer.includes(k)).sort().map(k => [k, t(x[k])])) : x;
    const s = JSON.stringify(t(v));
    return s === undefined ? 'undefined' : s;
}
/** L'empreinte de la valeur : sha1 court du JSON canonique. */
const empreinteValeur = v => crypto.createHash('sha1').update(canon(v)).digest('hex').slice(0, 10);
/** L'empreinte d'un plan d'écriture : sha256 du JSON canonique des écritures (champs ET retraits), SANS les dates (`le`, `provenance.le`). */
const empreintePlan = ecritures => crypto.createHash('sha256').update(canon(ecritures, ['le', 'provenance.le'])).digest('hex');
/** L'empreinte des confirmations : sha256 du JSON canonique de la liste (aucune date dedans). */
const empreinteConfirmations = entrees => crypto.createHash('sha256').update(canon(entrees)).digest('hex');

/** Une marque que NOUS avons écrite en base : { aReconfirmer: true, motif, v }. Tout le reste est une forme étrangère. */
const formeConnue = x => !!x && typeof x === 'object' && !Array.isArray(x) && x.aReconfirmer === true && typeof x.motif === 'string' && typeof x.v === 'string';
const minimale = d => ({ aReconfirmer: true, motif: d.motif, v: d.empreinteValeur });

/** Que faire d'une marque existante face à la décision d'aujourd'hui ? 'rien' | 'poser' | 'retirer'. (La forme étrangère est traitée avant.) */
function action(ancienne, decision) {
    if (!decision.aReconfirmer) return ancienne ? 'retirer' : 'rien';                      // confirmé aujourd'hui : une marque périmée ne reste pas
    if (!ancienne) return 'poser';
    return (ancienne.v !== decision.empreinteValeur || ancienne.motif !== decision.motif) ? 'poser' : 'rien';   // valeur changée ou motif changé : la marque est remplacée
}

/** La décision d'un champ à partir de sa ligne de confrontation et de l'arbitrage éventuel. `valeur` = la valeur Bulbapedia (son empreinte est mémorisée). */
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
 * @returns {{ecritures:{collection:string,_id:*,champs:Object,retraits:string[]}[], confirmations:object[], compte:object}}
 *   ecritures : ce qui s'écrit EN BASE (marques « à reconfirmer » seulement, et le retrait de celles devenues périmées) · confirmations : ce qui va au FICHIER
 */
function planifierProvenance({ cartes, sets, lignes, appariements, arbitrages, maintenant }) {
    const L = new Map(lignes.map(l => [l.champ + '\u0000' + String(l.cle), l]));
    const A = new Map((arbitrages || []).map(a => [a.champ + '\u0000' + String(a.cle), a]));
    const parCarte = new Map();
    for (const a of appariements || []) { if (!parCarte.has(a.carteId)) parCarte.set(a.carteId, []); parCarte.get(a.carteId).push(a); }
    const compte = { cartes: 0, sets: 0, documents: 0, champsAEcrire: 0, champsRetires: 0, confirmes: 0, doublonsCle: 0, clesEnDouble: 0, parChamp: {}, setsSansOrigine: {}, formeEtrangere: { documents: 0, champs: 0, liste: [] } };
    const tally = (champ, d, ecrit) => {
        const p = (compte.parChamp[champ] ||= { plein: 0, partiel: 0, arbitrage: 0, aReconfirmerDesaccord: 0, aReconfirmerNonCouvert: 0, ecrits: 0 });
        if (d.aReconfirmer) { if (d.motif === 'desaccord') p.aReconfirmerDesaccord++; else p.aReconfirmerNonCouvert++; } else p[d.accord] = (p[d.accord] || 0) + 1;
        if (ecrit) p.ecrits++;
    };
    const etrangere = (collection, _id, chemin, doc) => { if (doc) compte.formeEtrangere.documents++; else compte.formeEtrangere.champs++; compte.formeEtrangere.liste.push({ collection, _id, chemin }); };
    const ecritures = [], confirmations = [];
    const confirmer = (collection, _id, champ, k, d) => {
        if (d.aReconfirmer) return;
        const c = { collection, _id, champ }; if (k !== undefined) c.k = k;
        Object.assign(c, { confirmePar: d.confirmePar, accord: d.accord, empreinteValeur: d.empreinteValeur }); if (d.via) c.via = d.via; if (d.contredit) c.contredit = d.contredit;
        confirmations.push(c); compte.confirmes++;
    };

    /** Un champ de premier niveau : confirmation au fichier ; en base, la marque seulement (posée, remplacée ou retirée). */
    const traiter = (collection, _id, p0, doc, nom, d, tag) => {
        confirmer(collection, _id, nom, undefined, d);
        const ancienne = p0?.[nom];
        if (ancienne !== undefined && !formeConnue(ancienne)) { tally(tag, d, false); etrangere(collection, _id, 'provenance.' + nom, false); return; }
        const a = action(ancienne, d);
        tally(tag, d, a !== 'rien');
        if (a === 'poser') { doc.champs['provenance.' + nom] = minimale(d); compte.champsAEcrire++; }
        else if (a === 'retirer') { doc.retraits.push('provenance.' + nom); compte.champsRetires++; compte.champsAEcrire++; }
    };
    const clore = (collection, _id, doc, estNull) => {
        if (!Object.keys(doc.champs).length && !doc.retraits.length) return false;
        if (Object.keys(doc.champs).length) { doc.champs['provenance.source'] = SOURCE; doc.champs['provenance.le'] = maintenant; }
        // `provenance: null` : un `$set` de sous-chemin échouerait (« cannot create field in element {provenance: null} ») — l'objet entier est posé d'un coup
        if (estNull) doc.champs = { provenance: Object.fromEntries(Object.entries(doc.champs).map(([k, v]) => [k.slice('provenance.'.length), v])) };
        ecritures.push({ collection, _id, champs: doc.champs, retraits: doc.retraits }); return true;
    };

    for (const k of cartes) {
        const etat = etatProvenance(k.provenance);
        if (etat === 'etrangere') { etrangere('cartes', k._id, 'provenance', true); continue; }
        const doc = { champs: {}, retraits: [] }; const p0 = etat === 'bulbapedia' ? k.provenance : {};
        const mes = parCarte.get(k._id) || [];
        const confirmeNom = tir => nomsSources(mes.filter(a => a.tirage === tir && a.nomOk).map(a => a.src));
        const interroge = tir => mes.some(a => a.tirage === tir);
        for (const [nom, tir] of [['nomEn', 'intl'], ['nomJa', 'jp']]) {
            if (vide(k[nom])) continue;
            const c = confirmeNom(tir); const emp = empreinteValeur(k[nom]);
            traiter('cartes', k._id, p0, doc, nom, c.length ? { confirmePar: c, accord: 'plein', empreinteValeur: emp } : { confirmePar: [], aReconfirmer: true, motif: interroge(tir) ? 'desaccord' : 'non-couvert', empreinteValeur: emp }, 'carte.' + nom);
        }
        for (const ch of CHAMPS_CARTE) {
            if (vide(k[ch])) continue;
            const cle = 'carte.' + ch;
            traiter('cartes', k._id, p0, doc, ch, decider(L.get(cle + '\u0000' + String(k._id)), A.get(cle + '\u0000' + String(k._id)), k[ch]), cle);
        }
        // impressions : par clé tirage|expansion|numéro, jamais par index ; seulement celles qui portent une marque
        if (p0.impressions !== undefined && !Array.isArray(p0.impressions)) etrangere('cartes', k._id, 'provenance.impressions', false);
        const impressionsEtrangeres = p0.impressions !== undefined && !Array.isArray(p0.impressions);
        const sortie = impressionsEtrangeres ? [] : (p0.impressions || []).map(x => x); const index = new Map();
        sortie.forEach((x, i) => { if (x && typeof x.k === 'string' && !index.has(x.k)) index.set(x.k, i); });
        let changeI = false;
        const cles = clesImpressions(k.impressions);
        (k.impressions || []).forEach((im, idx) => {
            const kk = cles[idx]; if (!kk) return;
            if (kk.includes('#')) compte.clesEnDouble++;
            const ikey = `${k._id}#${idx}`;
            const existe = !impressionsEtrangeres && index.has(kk);
            const cur = existe ? { ...sortie[index.get(kk)] } : { k: kk };
            const apps = mes.filter(a => a.idx === idx && a.nomOk).map(a => a.src);
            const desaccordNom = mes.some(a => a.idx === idx);
            const decisions = {};
            if (!vide(im.numero)) { const emp = empreinteValeur(im.numero); decisions.numero = apps.length ? { confirmePar: nomsSources(apps), accord: 'plein', empreinteValeur: emp } : { confirmePar: [], aReconfirmer: true, motif: desaccordNom ? 'desaccord' : 'non-couvert', empreinteValeur: emp }; }
            if (numerique(im.total)) decisions.total = decider(L.get('impression.total\u0000' + ikey), A.get('impression.total\u0000' + ikey), im.total);
            if (!vide(im.rarete)) decisions.rarete = decider(L.get('impression.rarete\u0000' + ikey), A.get('impression.rarete\u0000' + ikey), im.rarete);
            let changeCet = false;
            for (const [nom, d] of Object.entries(decisions)) {
                confirmer('cartes', k._id, nom, kk, d);
                const ancienne = cur[nom];
                if (impressionsEtrangeres) { tally('impression.' + nom, d, false); continue; }
                if (ancienne !== undefined && !formeConnue(ancienne)) { tally('impression.' + nom, d, false); etrangere('cartes', k._id, `provenance.impressions[${kk}].${nom}`, false); continue; }
                const a = action(ancienne, d);
                tally('impression.' + nom, d, a !== 'rien');
                if (a === 'poser') { cur[nom] = minimale(d); changeCet = true; compte.champsAEcrire++; }
                else if (a === 'retirer') { delete cur[nom]; changeCet = true; compte.champsRetires++; compte.champsAEcrire++; }
            }
            if (changeCet) {
                changeI = true;
                const aDesChamps = Object.keys(cur).length > 1;                                   // jamais d'entrée { k } vide
                if (existe) sortie[index.get(kk)] = aDesChamps ? cur : null; else if (aDesChamps) { index.set(kk, sortie.length); sortie.push(cur); }
            }
        });
        if (changeI) { const res = sortie.filter(Boolean); if (res.length) doc.champs['provenance.impressions'] = res; else doc.retraits.push('provenance.impressions'); }
        if (clore('cartes', k._id, doc, k.provenance === null)) compte.cartes++;
    }

    for (const s of sets) {
        const etat = etatProvenance(s.provenance);
        if (etat === 'etrangere') { etrangere('sets', s._id, 'provenance', true); continue; }
        const doc = { champs: {}, retraits: [] }; const p0 = etat === 'bulbapedia' ? s.provenance : {};
        const { retenus, sansOrigine } = champsDuSet(s);
        for (const ch of sansOrigine) compte.setsSansOrigine[ch] = (compte.setsSansOrigine[ch] || 0) + 1;
        for (const ch of retenus) {
            const cle = 'set.' + ch;
            traiter('sets', s._id, p0, doc, ch, decider(L.get(cle + '\u0000' + String(s._id)), A.get(cle + '\u0000' + String(s._id)), s[ch]), cle);
        }
        if (clore('sets', s._id, doc, s.provenance === null)) compte.sets++;
    }
    compte.documents = ecritures.length;
    return { ecritures, confirmations, compte };
}

/**
 * LE FICHIER DES CONFIRMATIONS : { version, source, genereLe, nombre, empreinte, entrees }. Il est la preuve de ce qui est confirmé (les confirmations ne vont pas en base).
 * `empreinte` = sha256 des entrées ; le plan d'écriture référence le fichier par le sha256 de ses octets ET par cette empreinte.
 */
function construireFichierConfirmations(entrees, genereLe) {
    return { version: 1, source: SOURCE, genereLe: genereLe.toISOString(), nombre: entrees.length, empreinte: empreinteConfirmations(entrees), entrees };
}
/** Le fichier est-il complet et intact ? Rend la liste des erreurs (vide = accord). */
function verifierFichierConfirmations(f) {
    const e = [];
    if (!f || f.source !== SOURCE || f.version !== 1 || !Array.isArray(f.entrees)) return ['fichier des confirmations illisible (source, version ou entrées)'];
    if (f.nombre !== f.entrees.length) e.push(`le fichier annonce ${f.nombre} confirmations et en porte ${f.entrees.length}`);
    if (f.empreinte !== empreinteConfirmations(f.entrees)) e.push('l\'empreinte du fichier ne correspond pas à ses entrées (fichier modifié ou incomplet)');
    return e;
}

/**
 * La confirmation (du fichier) vaut-elle encore pour LA valeur d'aujourd'hui ? Faux si aucune confirmation, si la valeur a changé depuis (empreinte), ou si le document porte
 * une marque « à reconfirmer » sur cette même valeur. Pour une impression : `cle` = sa clé tirage|expansion|numéro.
 * @param {object[]} entrees  les entrées du fichier des confirmations
 */
function confirmationValide(entrees, collection, doc, champ, cle) {
    const c = entrees.find(x => x.collection === collection && x._id === doc._id && x.champ === champ && x.k === cle);
    if (!c) return false;
    let valeur, marque;
    const p = doc.provenance;
    if (cle === undefined) { valeur = doc[champ]; marque = p && typeof p === 'object' ? p[champ] : undefined; }
    else {
        const i = clesImpressions(doc.impressions).indexOf(cle);
        if (i < 0) return false;
        valeur = doc.impressions[i][champ];
        const item = p && Array.isArray(p.impressions) ? p.impressions.find(it => it && it.k === cle) : null;
        marque = item ? item[champ] : undefined;
    }
    const emp = empreinteValeur(valeur);
    if (formeConnue(marque) && marque.v === emp) return false;
    return c.empreinteValeur === emp;
}

/** Les champs de documents que le planificateur LIT : le chargeur (charger-bulba.js) doit tous les projeter (une projection trop étroite se lit « absent »). */
const CHAMPS_LUS = {
    cartes: ['nomEn', 'nomJa', 'impressions', 'provenance', ...CHAMPS_CARTE],
    sets: ['dateSortieEn', 'dateSortieEnSource', 'dateSortieJa', 'dateSortieJaSource', 'totalImprime', 'type', 'typeSource', 'provenance'],
};

/** Applique un `$set` à chemins pointés, puis les retraits (`$unset`), à une COPIE d'un document (pour les bancs et la relecture à blanc). */
function appliquer(doc, champs, retraits = []) {
    for (const [chemin, v] of Object.entries(champs)) {
        const parts = chemin.split('.'); let o = doc;
        for (const p of parts.slice(0, -1)) o = (o[p] ||= {});
        o[parts[parts.length - 1]] = v;
    }
    for (const chemin of retraits) {
        const parts = chemin.split('.'); let o = doc;
        for (const p of parts.slice(0, -1)) { o = o?.[p]; if (!o) break; }
        if (o) delete o[parts[parts.length - 1]];
    }
    return doc;
}

// ── LA LIGNE DE COMMANDE (écrite par ce qu'elle AUTORISE).
//   essai à blanc :  --sortie=<plan.json>  (écrit le plan ET le fichier des confirmations à côté, imprime leurs sha256)
//   écriture      :  --ecrire --attendu=<n> --plan=<plan.json> --empreinte=<sha256 du fichier de plan>  — `--attendu` (nombre de champs) reste obligatoire ; `--sources=` / `--variants=`
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
 * @param {{plan:object, shaFichier:string, empreinteDonnee:string, recalcul:{attendu:number, empreinteEcritures:string, empreinteConfirmations:string, entrees:Object},
 *          confirmationsFichier:{sha256:string, empreinteInterne:string}, options:{sources:?string, variants:?string}}} d
 *   `entrees` = sha256 des fichiers lus (index des sources, variantes, table d'alias) ; `confirmationsFichier` = le fichier des confirmations tel qu'il est LU sur disque
 *   (sha256 de ses octets, empreinte écrite dedans) ; `options` = ce que la ligne de commande de l'écriture donne (null = non donné).
 */
function verifierPlanFichier({ plan, shaFichier, empreinteDonnee, recalcul, confirmationsFichier, options }) {
    const e = [];
    if (shaFichier !== empreinteDonnee) e.push('l\'empreinte donnée n\'est pas le sha256 du fichier de plan (fichier modifié ou mauvaise empreinte)');
    if (plan.attendu !== recalcul.attendu) e.push(`le plan recalculé écrirait ${recalcul.attendu} champs, celui de l'essai à blanc ${plan.attendu}`);
    if (plan.empreinteEcritures !== recalcul.empreinteEcritures) e.push('le contenu des écritures recalculées diffère de celui du plan (les données ont changé depuis l\'essai à blanc)');
    if (plan.empreinteConfirmations !== recalcul.empreinteConfirmations) e.push('les confirmations recalculées diffèrent de celles du plan (les données ont changé depuis l\'essai à blanc)');
    if (!confirmationsFichier || confirmationsFichier.sha256 !== (plan.confirmations || {}).sha256) e.push('le fichier des confirmations n\'est plus celui du plan (sha256 des octets)');
    else if (confirmationsFichier.empreinteInterne !== plan.empreinteConfirmations) e.push('le fichier des confirmations porte une autre empreinte que celle du plan');
    if (canon(plan.entrees) !== canon(recalcul.entrees)) e.push('un fichier d\'entrée (index des sources, variantes, table d\'alias) n\'est plus celui du plan');
    for (const o of ['sources', 'variants']) if (options && options[o] != null && options[o] !== (plan.options || {})[o]) e.push(`--${o}=${options[o]} n'est pas celui du plan (${(plan.options || {})[o] ?? 'défaut'})`);
    return e;
}

module.exports = { planifierProvenance, appliquer, decider, champsDuSet, confirmationValide, clesImpressions, empreinteValeur, empreintePlan, empreinteConfirmations, construireFichierConfirmations,
    verifierFichierConfirmations, verifierPlanFichier, analyserArguments, verifierPlan, verifierRelecture, formeConnue, CHAMPS_LUS, ORIGINE_SET, NOMS };
