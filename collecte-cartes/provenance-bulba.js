// ============================================================
// LA PROVENANCE PAR CHAMP DES DONNÉES D'ORIGINE BULBAPEDIA, ET LA MARQUE « À RECONFIRMER » — fonction PURE (aucune base)
// ============================================================
// Décision du testeur (2026-10-17) : « pour les cas sans aucun remplaçant, garde la valeur, marque-la à reconfirmer, et ne la sers pas comme seule preuve d'une
// identification ». Ce module PLANIFIE l'écriture ; poser-provenance-bulba.js l'exécute (à blanc par défaut).
//
//   provenance.<champ> = { source: 'bulbapedia', confirmePar: ['pkmncards', 'tcgdex'], le }          au moins une source INDÉPENDANTE concorde
//   provenance.<champ> = { source: 'bulbapedia', confirmePar: [], aReconfirmer: true, le }           aucune source ne confirme
//   (+ `contredit: [sources]` quand une source dit autre chose · `partiel: true` quand elle ne confirme qu'une inclusion · `via` quand l'arbitrage a tranché)
//   provenance.impressions = [{ k: 'intl|Fossil|42', numero: {…}, total: {…}, rarete: {…} }]        clé = tirage|expansion|numéro (jamais l'index : un rejeu réordonne)
//
// 🔑 `provenance` est un champ INTERNE : il ne porte aucune valeur publique, le site ne le lit pas, et la garde de lot ne le compte pas (aucun set revalidé). Le nom d'une
// source n'apparaît dans AUCUN champ public. Une API qui l'exposerait un jour doit n'en tirer que `aReconfirmer`, jamais le nom.
// 🔑 UN CHAMP `aReconfirmer` NE DOIT JAMAIS ÊTRE LA SEULE PREUVE D'UNE IDENTIFICATION (décision du testeur) : le consommateur compte sur un autre témoin.
// 🔑 La garde s'écrit par ce qu'elle AUTORISE : un champ n'est « confirmé » que par une source qui concorde ou par un arbitrage « juste » ; un désaccord sans arbitrage,
// un arbitrage « fausse » ou « indécidable », une absence de source : tout cela est « à reconfirmer ». La valeur n'est JAMAIS modifiée ici ; une correction est un autre lot.
// ADDITIF ET MONOTONE : un champ absent se pose ; « à reconfirmer » devient confirmé quand une source concorde ; une confirmation s'enrichit (union) ; jamais de dégradation.
const NOMS = { pkc: 'pkmncards', tdx: 'tcgdex', jp: 'pokemon-card.com' };
const SOURCE = 'bulbapedia';

const vide = v => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const nomsSources = srcs => [...new Set(srcs.map(s => NOMS[String(s).split('.')[0]]).filter(Boolean))].sort();

/** Fusion monotone de l'ancienne entrée et de la nouvelle. Rend { entree, change }. */
function fusionner(ancienne, neuve) {
    if (!ancienne) return { entree: neuve, change: true };
    if (ancienne.aReconfirmer && !neuve.aReconfirmer) return { entree: neuve, change: true };
    if (!ancienne.aReconfirmer && !neuve.aReconfirmer) {
        const union = [...new Set([...(ancienne.confirmePar || []), ...neuve.confirmePar])].sort();
        if (union.length > (ancienne.confirmePar || []).length) return { entree: { ...ancienne, confirmePar: union }, change: true };
    }
    return { entree: ancienne, change: false };
}

/** La décision d'un champ à partir de sa ligne de confrontation et de l'arbitrage éventuel. Rend l'entrée (sans `le`). */
function decider(ligne, arbitrage) {
    const reconf = (extra = {}) => ({ source: SOURCE, confirmePar: [], aReconfirmer: true, ...extra });
    if (!ligne) return reconf();                                                                      // aucune comparaison possible : sans remplaçant
    const par = Object.entries(ligne.parSource || {});
    const ok = par.filter(([, x]) => x.statut === 'ok').map(([s]) => s);
    const approx = par.filter(([, x]) => x.statut === 'approx').map(([s]) => s);
    const ko = par.filter(([, x]) => x.statut === 'ko').map(([s]) => s);
    if (ok.length) return { source: SOURCE, confirmePar: nomsSources(ok), ...(ko.length ? { contredit: nomsSources(ko) } : {}) };
    if (approx.length) return { source: SOURCE, confirmePar: nomsSources(approx), partiel: true, ...(ko.length ? { contredit: nomsSources(ko) } : {}) };
    if (ko.length) {
        if (arbitrage && arbitrage.verdict === 'juste') {
            const temoins = nomsSources((arbitrage.temoins || []).map(t => t.source));
            if (temoins.length) return { source: SOURCE, confirmePar: temoins, via: arbitrage.raison || 'arbitrage', contredit: nomsSources(ko) };
        }
        return reconf({ contredit: nomsSources(ko) });
    }
    return reconf();
}

const CHAMPS_CARTE = ['illustrateur', 'pv', 'retraite', 'faiblesse', 'resistance', 'attaques', 'ndex'];
const numerique = v => v !== null && v !== undefined && /^\d+$/.test(String(v).trim());

/** Les champs d'un set dont l'origine est Bulbapedia (sa propre source écrite n'est pas un autre fournisseur). */
function champsDuSet(s) {
    const bulba = src => src === undefined || src === null || /^bulbapedia/.test(String(src));
    const c = [];
    if (!vide(s.dateSortieEn) && bulba(s.dateSortieEnSource)) c.push('dateSortieEn');
    if (!vide(s.dateSortieJa) && bulba(s.dateSortieJaSource)) c.push('dateSortieJa');
    if (!vide(s.totalImprime)) c.push('totalImprime');
    if (!vide(s.type) && /^bulbapedia/.test(String(s.typeSource ?? ''))) c.push('type');
    return c;
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
    const compte = { cartes: 0, sets: 0, documents: 0, champsAEcrire: 0, doublonsCle: 0, clesEnDouble: 0, parChamp: {} };
    const tally = (champ, entree, ecrit) => { const p = (compte.parChamp[champ] ||= { confirmes: 0, aReconfirmer: 0, ecrits: 0 }); entree.aReconfirmer ? p.aReconfirmer++ : p.confirmes++; if (ecrit) p.ecrits++; };
    const ecritures = [];

    const poser = (provenance, champs, nom, neuve, tag) => {
        const { entree, change } = fusionner(provenance?.[nom], { ...neuve, le: maintenant });
        tally(tag || nom, entree, change);
        if (change) { champs['provenance.' + nom] = entree; compte.champsAEcrire++; }
        return entree;
    };

    for (const k of cartes) {
        const champs = {}; const p0 = k.provenance || {};
        const mes = parCarte.get(k._id) || [];
        const confirmeNom = tir => nomsSources(mes.filter(a => a.tirage === tir && a.nomOk).map(a => a.src));
        for (const [nom, tir] of [['nomEn', 'intl'], ['nomJa', 'jp']]) {
            if (vide(k[nom])) continue;
            const c = confirmeNom(tir);
            poser(p0, champs, nom, c.length ? { source: SOURCE, confirmePar: c } : { source: SOURCE, confirmePar: [], aReconfirmer: true }, 'carte.' + nom);
        }
        for (const ch of CHAMPS_CARTE) {
            if (vide(k[ch])) continue;
            const cle = 'carte.' + ch;
            poser(p0, champs, ch, decider(L.get(cle + '\u0000' + String(k._id)), A.get(cle + '\u0000' + String(k._id))), cle);
        }
        // impressions : par clé tirage|expansion|numéro, jamais par index
        const ancien = Array.isArray(p0.impressions) ? p0.impressions : [];
        const parK = new Map(ancien.map(x => [x.k, x]));
        const sortie = ancien.map(x => ({ ...x })); const index = new Map(sortie.map((x, i) => [x.k, i]));
        let changeI = false; const vus = new Map();
        (k.impressions || []).forEach((im, idx) => {
            if (!im || !im.tirage || !im.expansion) return;
            // deux impressions à la même clé (fréquent au japonais sans numéro) : la n-ième garde SA provenance sous « #n » (l'ordre des impressions d'un même set est stable)
            const base = `${im.tirage}|${im.expansion}|${im.numero ?? ''}`;
            const n = (vus.get(base) || 0) + 1; vus.set(base, n);
            if (n > 1) compte.clesEnDouble++;
            const kk = n === 1 ? base : `${base}#${n}`;
            const ikey = `${k._id}#${idx}`;
            const cur = index.has(kk) ? sortie[index.get(kk)] : { k: kk };
            const apps = mes.filter(a => a.idx === idx && a.nomOk).map(a => a.src);
            const champsI = {};
            if (!vide(im.numero)) champsI.numero = apps.length ? { source: SOURCE, confirmePar: nomsSources(apps) } : { source: SOURCE, confirmePar: [], aReconfirmer: true };
            if (numerique(im.total)) champsI.total = decider(L.get('impression.total\u0000' + ikey), A.get('impression.total\u0000' + ikey));
            if (!vide(im.rarete)) champsI.rarete = decider(L.get('impression.rarete\u0000' + ikey), A.get('impression.rarete\u0000' + ikey));
            for (const [nom, neuve] of Object.entries(champsI)) {
                const { entree, change } = fusionner(cur[nom], { ...neuve, le: maintenant });
                tally('impression.' + nom, entree, change);
                if (change) { cur[nom] = entree; changeI = true; compte.champsAEcrire++; }
            }
            if (!index.has(kk)) { index.set(kk, sortie.length); sortie.push(cur); }
        });
        if (changeI) champs['provenance.impressions'] = sortie;
        if (Object.keys(champs).length) { ecritures.push({ collection: 'cartes', _id: k._id, champs }); compte.cartes++; }
    }

    for (const s of sets) {
        const champs = {}; const p0 = s.provenance || {};
        for (const ch of champsDuSet(s)) {
            const cle = 'set.' + ch;
            poser(p0, champs, ch, decider(L.get(cle + '\u0000' + String(s._id)), A.get(cle + '\u0000' + String(s._id))), cle);
        }
        if (Object.keys(champs).length) { ecritures.push({ collection: 'sets', _id: s._id, champs }); compte.sets++; }
    }
    compte.documents = ecritures.length;
    return { ecritures, compte };
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

// ── LA LIGNE DE COMMANDE (écrite par ce qu'elle AUTORISE) : `--attendu=<n>` est OBLIGATOIRE avec `--ecrire` — le nombre de champs de provenance annoncé par la simulation ;
// si le plan en trouve un autre, refus AVANT toute écriture ; la relecture est comparée à ce nombre.
const OPTIONS = /^(--ecrire|--lecture-via-ecriture|--attendu=.*|--sources=.+|--variants=.+|--sortie=.+)$/;
function analyserArguments(argv) {
    const erreurs = [];
    const ecrire = argv.includes('--ecrire'), viaEcriture = argv.includes('--lecture-via-ecriture');
    for (const x of argv) if (!OPTIONS.test(x)) erreurs.push(`argument inconnu : ${x} — autorisés : --ecrire, --attendu=<n>, --lecture-via-ecriture, --sources=, --variants=, --sortie=`);
    const att = argv.find(x => x.startsWith('--attendu='));
    let attendu = null;
    if (att !== undefined) {
        if (!/^--attendu=\d+$/.test(att)) erreurs.push(`${att} : un entier positif ou nul est exigé`);
        else attendu = Number(att.slice(10));
        if (!ecrire) erreurs.push('--attendu n\'a de sens qu\'avec --ecrire');
    } else if (ecrire) erreurs.push('--ecrire exige --attendu=<n> (le nombre de champs de provenance à écrire, annoncé par la simulation)');
    return { erreurs, ecrire, attendu, viaEcriture };
}
const verifierPlan = (plan, attendu) => plan === attendu ? null : `le plan écrirait ${plan} champs, --attendu=${attendu} : refus avant toute écriture (relancer la simulation)`;
const verifierRelecture = ({ ecrits, attendu, restants }) => ecrits !== attendu ? `${ecrits} champs écrits, ${attendu} attendus`
    : restants ? `${restants} champs restent à écrire après l'écriture (le plan rejoué n'est pas à zéro)` : null;

module.exports = { planifierProvenance, appliquer, decider, fusionner, champsDuSet, analyserArguments, verifierPlan, verifierRelecture, CHAMPS_LUS, NOMS };
