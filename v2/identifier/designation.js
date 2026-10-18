'use strict';
// DESIGNATION (2026-10-18) — désigner, parmi les candidats d'une QUESTION (chaîne, garde contradiction ou garde des jumeaux), le SEUL que les champs DÉJÀ lus sur la photo satisfont, à 0 faux. Aucun appel au modèle.
// Module PUR (ni base, ni réseau, ni modèle). Aucune règle recopiée (§21 bis) : les statuts des champs sont `garde-contradiction.statuts`, la garde contradiction est `contredire`, le nom est `nom-compatible`,
// la garde des jumeaux est `jumeaux.garde` : les fonctions de la production.
// 🔑 UNE SEULE RÈGLE, `numero`, ALLUMÉE (décision du coordinateur, tour de correction 1) : +7 sûrs justes, 0 faux sur les deux bancs, elle GARDE le veto de l'attaque (exposition réelle : un numéro qui contredit la vérité et
// concorde avec un rival = 0 sur 116). RETIRÉES DU CODE, non laissées éteintes : « attaque » et les deux variantes « sans veto » (critereASansAttaque, critereASansAttaqueSymbole) fabriquent un faux par construction
// (Dark Tyranitar 143/103 lu 144 avec « Crush » : seul le veto de l'attaque contredit le numéro mal lu ; « attaque » désigne un rival quand l'attaque est mal lue) ; et les règles à gain nul (numeroTotal, total, langue, nom).
// Pour mémoire, mesuré le 2026-10-18 sur le réglage : numero +7 · numeroTotal +5 · total 0 · langue 0 · nom 0 · attaque +13 · critereASansAttaque +11 · …Symbole +12 · union +30, 0 faux observé sur les deux bancs.
// 🔴 IL N'Y A PAS DE RÈGLE « CODE SEUL » (Bill CLK / CLL 030/032 : la photo lit « CLL », le deck frère de même numéro) ; `ctx.designation` surcharge (bancs, mesure), seul `true` allume, une clé inconnue est ignorée.
// ⚠️ SANS SECOND TÉMOIN : une désignation sur une question réduite à des jumeaux de même dessin n'a pas de seconde lecture derrière elle (routes.js ne la joue que sur une QUESTION) : la désignation est la DERNIÈRE garde.
// Écrit par ce qu'il AUTORISE : un candidat X n'est désigné que si TOUTES ces conditions tiennent, pour une règle allumée ; au moindre doute (bloc absent, ligne manquante, index absent) la question d'avant reste.
//   (a) exactement un candidat de la question satisfait le champ de la règle, et tous les autres le contredisent ;
//   (b) la garde contradiction ne répond pas pour X : AUCUN champ lu ne le contredit (attaque et symbole compris) ;
//   (c) la garde des jumeaux conclut pour X, et tout jumeau de X est un candidat de la question ET contredit par le même champ (sinon un jumeau que la photo ne sépare pas serait masqué) ;
//   (d) le champ lu ne désigne aucun produit HORS de la question dans le catalogue entier : aucun produit de la famille de X (même métacarte ou même nom) hors de la question n'est aussi peu contredit que X.
//       La famille vient de l'index du catalogue (`catalogueExiste.famille`, même canal que R4) ; index absent, pas prêt, tronqué ou qui lève => la règle se ferme ;
//   (e) deux produits PARTAGÉS (holo / non holo, tampon non séparé : l'image ne les sépare pas) ne sont JAMAIS séparés par une de ces règles : X sans partage, et aucun candidat n'est le partenaire de X.
const { contredire, statuts, lectureDe, CHAMPS } = require('./garde-contradiction');
const { formesLuesDe, nomCompatible } = require('./nom-compatible');
const { garde, partagesDuFournisseur, idsAffirmes } = require('./jumeaux');
const LD = require('./langue-decisive');

const REGLES_DESIGNATION = Object.freeze({ numero: true });
// Le champ qui sépare, par règle ; `nomCarte` serait le nom lu en confiance haute.
const CHAMPS_DE = Object.freeze({ numero: ['numero'] });
const DURS = Object.freeze(['numero', 'code', 'total', 'langue', 'setTcgdex']);       // un candidat qu'un de ces champs contredit ne satisfait jamais une règle de champ
const compte = { jugees: 0, designees: 0, refus: {}, parRegle: {} };
const compteurs = () => ({ ...compte, refus: { ...compte.refus }, parRegle: { ...compte.parRegle } });
const refuse = motif => { compte.refus[motif] = (compte.refus[motif] || 0) + 1; return null; };

/** Les règles demandées, fusionnées aux règles livrées : seules les clés CONNUES, et seul `true` allume. */
function reglesDe(demandees) {
    const o = demandees && typeof demandees === 'object' ? demandees : {};
    return Object.freeze(Object.fromEntries(Object.keys(REGLES_DESIGNATION).map(k => [k, o[k] === true])));
}
const actives = regles => Object.keys(REGLES_DESIGNATION).filter(k => regles && regles[k] === true);

// Le candidat que la règle de CHAMP désigne : exactement un satisfait, tous les autres contredisent (a). Même définition que l'étude (reglesChamps), sur les statuts de la production.
function parChamp(champs, { corps, lu, ids, produits }) {
    const formes = formesLuesDe(corps);
    const nomOk = id => (formes.length ? nomCompatible(formes, produits.get(id)) : null);
    const st = id => statuts(lu, produits.get(id));
    const ok = (s, id, k) => (k === 'nomCarte' ? nomOk(id) === true : s[k] === 'ok');
    const ko = (s, id, k) => (k === 'nomCarte' ? nomOk(id) === false : s[k] === 'ko');
    const satisfait = id => { const s = st(id); return !DURS.some(k => s[k] === 'ko') && champs.every(k => ok(s, id, k)) && nomOk(id) !== false; };
    const X = ids.filter(satisfait);
    if (X.length !== 1) return null;
    return ids.every(y => y === X[0] || champs.some(k => ko(st(y), y, k))) ? X[0] : null;
}

/**
 * @param ids       les idProduct de la QUESTION (au moins 2, dans l'ordre où elle est posée)
 * @param corps     la réponse de la chaîne héritée (success true) avec son bloc `lectureGarde`
 * @param produits  Map<idProduct, ligne de catalogue> : doit porter TOUS les candidats (et les jumeaux : la garde les lit)
 * @param jumeaux   le fournisseur de jumeaux de la route (ctx.jumeaux) ; `partagesDe` pour les partages
 * @param regles    les règles allumées (reglesDe)
 * @param catalogueExiste  la fonction de l'index code × numéro (R4), portant `famille(idProduct)` ; absente : toutes les règles se ferment
 * @returns { id, regles: [noms], critere } | null
 */
function designer({ ids, corps, produits, jumeaux, regles, catalogueExiste, trace } = {}) {
    try {
        const noms = actives(regles);
        if (!noms.length) return null;
        if (!Array.isArray(ids) || ids.length < 2 || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length) return null;
        if (!(produits instanceof Map) || ids.some(i => !produits.has(i))) return refuse('ligne de candidat manquante');
        if (!corps || typeof corps !== 'object' || !(corps.lectureGarde && typeof corps.lectureGarde === 'object')) return refuse('bloc lectureGarde absent');
        const lu0 = lectureDe(corps);
        if (!lu0) return refuse('lecture inexploitable');
        compte.jugees++;
        const designes = new Map();                                                    // idProduct -> les règles qui le désignent
        for (const nom of noms) {
            const lu = lectureDe(corps);
            const X = parChamp(CHAMPS_DE[nom], { corps, lu, ids, produits });
            const t = etape => { if (typeof trace === 'function') trace(nom, etape, X); };   // (mesure seulement : où une règle s'arrête)
            if (X === null) { t('a'); continue; }                                      // (a)
            // (b) la garde contradiction se tait parfois quand l'attaque ou le symbole seuls contredisent sans désigner personne : « un élément lu qui contredit le gagnant bloque toujours » (comme critere-a.conditions)
            if (contredire({ corps, gagnant: X, produits }) || CHAMPS.some(k => statuts(lu, produits.get(X))[k] === 'ko')) { refuse('un champ lu contredit le candidat'); t('b'); continue; }
            const g = garde({ jumeaux, produits }, X, true);                           // (c) une SONDE : ni compteur ni journal de la garde des jumeaux
            const groupe = g.action === 'affirmer' ? [] : (g.action === 'question' || g.action === 'nombreux') ? g.ids.filter(i => i !== X) : null;
            if (groupe === null) { refuse('la garde des jumeaux ne conclut pas'); t('c-muette'); continue; }
            if (groupe.some(j => !ids.includes(j))) { refuse('un jumeau du candidat n\'est pas dans la question'); t('c-jumeau'); continue; }
            if (partagesDuFournisseur(jumeaux, X).length || ids.some(y => y !== X && partagesDuFournisseur(jumeaux, y).includes(X))) { refuse('paire partagée'); t('e'); continue; }   // (e)
            const famille = catalogueExiste && catalogueExiste.famille;                // (d)
            if (typeof famille !== 'function') { refuse('index du catalogue absent'); t('d-absent'); continue; }
            const rangee = famille(X);
            if (!Array.isArray(rangee)) { refuse('index du catalogue illisible'); t('d-absent'); continue; }
            const formes = formesLuesDe(corps);
            const cache = rangee.some(y => y && Number.isInteger(y.idProduct) && y.idProduct !== X && !ids.includes(y.idProduct)
                && !CHAMPS.some(k => statuts(lu, y)[k] === 'ko') && !(formes.length && !nomCompatible(formes, y)));
            if (cache) { refuse('un produit hors question n\'est pas contredit'); t('d'); continue; }
            t('ok');
            designes.set(X, [...(designes.get(X) || []), nom]);
        }
        if (designes.size !== 1) return null;
        const [[id, par]] = [...designes];
        compte.designees++;
        for (const n of par) compte.parRegle[n] = (compte.parRegle[n] || 0) + 1;
        const lu = lectureDe(corps);
        console.warn(`ℹ️ [designation-v2] affirmation produit=${id} regles=${par.join('+')} question=${ids.length}`);
        return { id, regles: par, critere: `désignation (${par.join('+')}) : seul des ${ids.length} candidats à satisfaire les champs lus (numéro ${lu.numero || '-'}, total ${lu.total || '-'}, code ${lu.setCode || '-'}), les autres sont contredits, aucun produit du catalogue hors question n'est aussi peu contredit` };
    } catch (e) {
        return refuse(`décision impossible (${(e && e.name) || 'erreur'})`);            // une exception n'est jamais une affirmation
    }
}

/**
 * Pour le chargeur (langue-decisive-charge.js) : les candidats POSSIBLES d'une désignation, dont la garde des jumeaux doit pouvoir conclure. Un sur-ensemble prudent, borné : le produit affirmé, les candidats de la
 * chaîne et ceux que la garde contradiction désigne, non contredits par la lecture et dont un champ au moins concorde. Rien si aucune règle n'est allumée.
 */
function candidatsAPreparer({ corps, produits, regles } = {}) {
    try {
        if (!actives(regles).length || !(produits instanceof Map)) return [];
        const lu = lectureDe(corps);
        if (!lu) return [];
        const g = idsAffirmes(corps)[0];
        const w = Number.isInteger(g) && produits.has(g) ? contredire({ corps, gagnant: g, produits }) : null;
        const pool = [...new Set([...idsAffirmes(corps), ...(Array.isArray(corps.candidats) ? corps.candidats.map(c => c && c.idProduct) : []), ...(w ? w.designe.map(d => d.idProduct) : []), ...lu.vivierIds.slice(0, 40)])]
            .filter(i => Number.isInteger(i) && produits.has(i));
        return pool.filter(id => { const s = statuts(lu, produits.get(id)); return !DURS.some(k => s[k] === 'ko') && s.numero === 'ok'; }).slice(0, 6);
    } catch { return []; }
}

// ── L'INDEX DES FAMILLES (condition d) : pour chaque produit, ceux du catalogue ENTIER qui portent la même métacarte ou le même nom (sans ses attaques entre crochets), sous la forme de lignes que `statuts` sait lire.
// Entrées : numeros_cartes { idProduct, codeSet, numero, numeroUrl, setTcgdex } et catalogue_produits { idProduct, idMetacard, name } ; `visuel(id)` rend { total, tirage } de l'archive (ou null). Pur.
const nomBase = n => String(n || '').split('[')[0].trim().toLowerCase().replace(/\s+/g, ' ');
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
function creerIndexFamilles(numeros, produits, lecteur = () => () => null) {              // `lecteur()` rend, pour UN appel de `famille`, la fonction id => { total, tirage } de l'archive (une version pour tout l'appel)
    const num = new Map();
    for (const n of numeros || []) if (n && Number.isInteger(n.idProduct)) num.set(n.idProduct, n);
    const lignes = new Map(), parMeta = new Map(), parNom = new Map();
    for (const p of produits || []) {
        if (!p || !Number.isInteger(p.idProduct) || !texte(p.name)) continue;
        const n = num.get(p.idProduct) || {};
        lignes.set(p.idProduct, { idProduct: p.idProduct, nomCardmarket: p.name, nomFr: null, numero: texte(n.numero == null ? null : String(n.numero)) || texte(n.numeroUrl == null ? null : String(n.numeroUrl)), total: null,
            set: { code: texte(n.codeSet) }, setTcgdex: texte(n.setTcgdex), tirageSource: null, meta: Number.isInteger(p.idMetacard) ? p.idMetacard : null, base: nomBase(p.name) });
        const meta = Number.isInteger(p.idMetacard) ? p.idMetacard : null, base = nomBase(p.name);
        if (meta !== null) { if (!parMeta.has(meta)) parMeta.set(meta, []); parMeta.get(meta).push(p.idProduct); }
        if (base) { if (!parNom.has(base)) parNom.set(base, []); parNom.get(base).push(p.idProduct); }
    }
    return {
        taille: lignes.size,
        /** Les lignes de la famille de `id` (hors lui). null : le produit est inconnu de l'index (la règle se ferme). */
        famille(id) {
            const L = lignes.get(id);
            if (!L) return null;
            const ids = new Set([...(L.meta !== null ? parMeta.get(L.meta) || [] : []), ...(L.base ? parNom.get(L.base) || [] : [])]);
            ids.delete(id);
            const visuel = lecteur();
            return [...ids].map(i => { const l = lignes.get(i), vis = visuel(i) || {}; return { ...l, total: vis.total ?? null, tirageSource: vis.tirage ?? null }; });
        }
    };
}

module.exports = { designer, reglesDe, actives, candidatsAPreparer, creerIndexFamilles, compteurs, REGLES_DESIGNATION, CHAMPS_DE };
