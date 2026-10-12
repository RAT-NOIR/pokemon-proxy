// ============================================================
// LA CALIBRATION DE LA CLÉ « MÉTACARTE ∧ SETLIST » — UNE définition, pour le rapport ET pour la garde d'écriture (§21 bis)
// ============================================================
// Vérité connue = les produits DÉJÀ joints par le numéro (cartes_produits.numeroFiche, carte à page), numéro CACHÉ à la clé.
// Quatre épreuves, et CHACUNE compte ses cas ATTEINTS (la clé a dû choisir entre plusieurs candidats) à côté des justes/faux/silences :
//   A  vérité présente : la clé doit rendre la MÊME carte et le même numéro, ou se taire ;
//   B  vraie carte RETIRÉE de la métacarte et de la Setlist : elle ne doit désigner personne ;
//   C  vraie carte retirée de la Setlist seule (la métacarte la désigne encore) : elle ne doit désigner personne ;
//   D  LE DANGER, population isolée sur TOUS les tirages : la métacarte a >= 2 frères joints ET la Setlist du set porte un HOMONYME (>= 2 cartes au
//      même nom). C'est là seulement que la clé peut désigner la voisine — A, B et C, sur les sets qui produisent, n'y sont presque jamais.
// 🔴 §76 / relecture A de SEA-2 : B n'atteignait la Setlist que 19 fois sur 748, C valait 0 par construction. Sans `atteints`, « 0 faux » ne dit rien.
// 🔴 §41 / relecture A : un MAUVAIS export rendait « tout silence » sans erreur. L'appariement export ↔ lignes de jointure est vérifié par
// lecture-sure.apparier (LÈVE à 0), le dénominateur s'imprime, et zéro cas évalué sur une population non vide LÈVE.
const fs = require('fs');
const J = require('./jointure');
const { indexerMetacartes } = require('./cle-nom-attaques');
const { designerParSetlist } = require('./cle-setlist-metacarte');
const { apparier } = require('./lecture-sure');
const k = J.cleNumero;

/**
 * LES MINIMUMS DE CAS ATTEINTS, et pourquoi (imprimés par la garde). Avec 0 faux sur n cas où la clé a eu un choix à faire, la borne haute à 95 % du taux
 * de faux est 3/n (règle de trois) : 100 cas -> 3 %, 300 -> 1 %. On exige donc, SUR LE DANGER (D) : 100 cas atteints en A (la clé a désigné parmi des
 * homonymes) et 100 en C (la vraie carte retirée, un homonyme reste : elle doit se taire) — un faux affirmé par la clé coûte une fiche fausse sur le
 * site, et la barre est de ne pas dépasser ~3 % sur le cas craint. Sur A (les sets qui écrivent) : 100 cas atteints. Les minimums ne se baissent pas pour
 * faire passer un lot (§23) : s'ils ne sont pas atteints, la garde refuse et le dit.
 */
const MINIMUMS = Object.freeze({ A: 100, D_A: 100, D_C: 100 });

const vide = () => ({ cas: 0, atteints: 0, justes: 0, fauxCarte: 0, fauxNumero: 0, silences: 0, faux: [] });

/** Les épreuves A, B et C sur UN produit de vérité connue. */
function evaluer({ base, entrees, p, vraie }) {
    const ctx = { ...base, setlist: entrees };
    const dA = designerParSetlist(ctx, p);
    const A = { atteint: dA.atteint, etat: !dA.carte ? 'silence' : dA.carte._id !== vraie.carteId ? 'fauxCarte' : k(dA.numero) !== k(vraie.numero) ? 'fauxNumero' : 'juste', detail: dA.carte ? `carte ${dA.carte._id} (vérité ${vraie.carteId}) n°${dA.numero} (vérité ${vraie.numero})` : null };
    const dB = designerParSetlist(ctx, p, { sauf: vraie.carteId });
    const dC = designerParSetlist({ ...ctx, setlist: entrees.filter(e => e.carte._id !== vraie.carteId) }, p);
    return { A, B: { atteint: dB.atteint, faux: !!dB.carte }, C: { atteint: dC.atteint, faux: !!dC.carte } };
}
function compter(acc, r, nom) {
    acc.cas++; if (r.atteint) acc.atteints++;
    if (r.etat === 'juste') acc.justes++; else if (r.etat === 'fauxCarte') { acc.fauxCarte++; acc.faux.push(`${nom} : ${r.detail}`); } else if (r.etat === 'fauxNumero') { acc.fauxNumero++; acc.faux.push(`${nom} : ${r.detail}`); } else acc.silences++;
}
function compterRetrait(acc, r, nom) { acc.cas++; if (r.atteint) acc.atteints++; if (r.faux) { acc.fauxCarte++; acc.faux.push(nom); } else acc.silences++; }

/** Charge l'export (idProduct -> { name, idMetacard }). */
function chargerExport(chemin) {
    const E = JSON.parse(fs.readFileSync(chemin, 'utf8'));
    if (!Array.isArray(E.products) || !E.products.length) throw new Error(`${chemin} : aucun produit lu (champ « products »)`);
    return new Map(E.products.map(p => [p.idProduct, { name: p.name, idMetacard: p.idMetacard ?? null }]));
}

/**
 * @param {object} o
 * @param {object} o.db            base `cartes` (lecture)
 * @param {string} o.exportPath    l'export Cardmarket (nommé dans la sortie)
 * @param {object[]} o.lignesEcrites  lignes de table des sets qui ÉCRIRAIENT (épreuves A, B, C)
 * @param {object[]} o.lignesDanger   toutes les lignes de table lisibles (épreuve D) ; défaut : lignesEcrites
 * @param {(L:object)=>Promise<{entrees:Array}>} o.lireSetlist  la Setlist résolue d'un set (injectée : lireSetlistDuSet en production)
 * @param {(s:string)=>void} [o.log]
 */
async function calibrer({ db, exportPath, lignesEcrites, lignesDanger = null, lireSetlist, log = () => { } }) {
    const exp = chargerExport(exportPath);
    // les lignes que CETTE clé a écrites (`metacarte+setlist`) ne sont ni vérité ni frères : pas de preuve circulaire
    const lignes = (await db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1, preuve: 1 } }).toArray()).filter(l => l.preuve !== 'metacarte+setlist');
    if (!lignes.length) throw new Error('cartes_produits est vide : la calibration ne peut pas se faire');
    const eligibles = lignes.filter(l => l.numeroFiche != null && l.carteId > 0);
    const avecMeta = [...exp].filter(([, v]) => v.idMetacard != null).map(([id]) => id);
    // §41 : l'appariement export <-> base, le dénominateur imprimé, et LEVÉ à 0 (un mauvais export rendait « tout silence »)
    const a1 = apparier(eligibles.map(l => l.idProduct), [...exp.keys()], { gauche: 'lignes de jointure numérotées', droite: 'produits de l\'export', cle: 'idProduct' });
    const a2 = apparier(eligibles.map(l => l.idProduct), avecMeta, { gauche: 'lignes de jointure numérotées', droite: 'produits de l\'export PORTANT idMetacard', cle: 'idProduct' });
    log(`   DÉNOMINATEUR : export ${exportPath} : ${exp.size} produits lus, ${avecMeta.length} portent une métacarte · ${eligibles.length} lignes de jointure numérotées à carte à page · retrouvées dans l'export ${a1.trouvees.length} (${(a1.taux * 100).toFixed(1)} %), avec métacarte ${a2.trouvees.length} (${(a2.taux * 100).toFixed(1)} %)`);
    const metaDe = id => exp.get(id)?.idMetacard ?? null;
    const base = { parMeta: indexerMetacartes(lignes, metaDe), metacarteDe: metaDe };
    const produit = id => { const v = exp.get(id); return v ? { idProduct: id, name: v.name, ...J.decomposerNomCardmarket(v.name) } : null; };
    const parSlug = new Map(); for (const l of eligibles) (parSlug.get(l.slugSet) || parSlug.set(l.slugSet, []).get(l.slugSet)).push(l);
    const cacheSetlist = new Map();
    const setlistDe = async L => { if (!cacheSetlist.has(L.slugSet)) cacheSetlist.set(L.slugSet, await lireSetlist(L).then(s => s.entrees).catch(e => ({ erreur: e.message }))); return cacheSetlist.get(L.slugSet); };

    const res = { exportPath, denominateurs: { produitsExport: exp.size, avecMetacarte: avecMeta.length, lignesNumerotees: eligibles.length, retrouvees: a1.trouvees.length }, sets: {}, total: { A: vide(), B: vide(), C: vide() }, danger: { A: vide(), C: vide(), parTirage: {}, sets: 0, illisibles: 0, isoles: 0, evalues: 0 }, minimums: MINIMUMS };
    for (const L of lignesEcrites) {
        const entrees = await setlistDe(L);
        if (entrees.erreur) { log(`   ${L.code} : Setlist illisible (${entrees.erreur})`); res.sets[L.code] = { illisible: entrees.erreur }; continue; }
        const S = { A: vide(), B: vide(), C: vide() };
        for (const l of parSlug.get(L.slugSet) || []) {
            const p = produit(l.idProduct); if (!p || !(p.attaques || []).length) continue;
            const r = evaluer({ base, entrees, p, vraie: { carteId: l.carteId, numero: l.numeroFiche } });
            compter(S.A, r.A, p.name); compterRetrait(S.B, r.B, p.name); compterRetrait(S.C, r.C, p.name);
        }
        res.sets[L.code] = S;
        for (const e of ['A', 'B', 'C']) for (const c of ['cas', 'atteints', 'justes', 'fauxCarte', 'fauxNumero', 'silences']) res.total[e][c] += S[e][c];
        for (const e of ['A', 'B', 'C']) res.total[e].faux.push(...S[e].faux);
    }
    if (res.total.A.cas === 0) throw new Error(`🔴 CALIBRATION VIDE : 0 cas évalué sur ${eligibles.length} lignes numérotées (${lignesEcrites.length} sets) — un zéro sur une population non vide est une clé fausse (mauvais export ? mauvais set ?), pas un résultat.`);
    // D : le danger, tous tirages
    for (const L of lignesDanger || lignesEcrites) {
        const entrees = await setlistDe(L);
        if (entrees.erreur) { res.danger.illisibles++; continue; }
        res.danger.sets++;
        const clesParCarte = new Map();   // carteId -> clés de nom
        for (const e of entrees) clesParCarte.set(e.carte._id, J.clesNom(J.nomJointDe(e.carte)));
        for (const l of parSlug.get(L.slugSet) || []) {
            const p = produit(l.idProduct); if (!p || !(p.attaques || []).length) continue;
            res.danger.evalues++;
            // frères : les AUTRES produits de la métacarte joints à une carte à page
            const m = metaDe(p.idProduct); let freres = 0;
            for (const [id, cs] of base.parMeta.get(m) || []) if (id !== p.idProduct && [...cs].some(c => c > 0)) freres++;
            if (freres < 2) continue;
            const kp = J.clesNom(p.nom);
            const homonymes = [...clesParCarte].filter(([id, ks]) => ks.some(x => kp.includes(x))).length;
            if (homonymes < 2) continue;
            res.danger.isoles++;
            const r = evaluer({ base, entrees, p, vraie: { carteId: l.carteId, numero: l.numeroFiche } });
            compter(res.danger.A, r.A, `${L.code} ${p.name}`); compterRetrait(res.danger.C, r.C, `${L.code} ${p.name}`);
            const T = res.danger.parTirage[L.bulba?.tirage ?? '?'] ||= { A: vide(), C: vide() };
            compter(T.A, r.A, `${L.code} ${p.name}`); compterRetrait(T.C, r.C, `${L.code} ${p.name}`);
        }
    }
    return res;
}

/** Le verdict de la garde : 0 faux partout ET assez de cas atteints. @returns {{ok: boolean, refus: string[]}} */
function verdict(cal, minimums = MINIMUMS) {
    const refus = [];
    const T = cal.total, D = cal.danger;
    for (const [nom, e] of [['A (sets qui écrivent)', T.A], ['A danger (homonymes)', D.A]]) if (e.fauxCarte || e.fauxNumero) refus.push(`${nom} : ${e.fauxCarte} faux de carte, ${e.fauxNumero} faux de numéro`);
    for (const [nom, e] of [['B (vraie carte retirée)', T.B], ['C (retirée de la Setlist)', T.C], ['C danger (homonymes)', D.C]]) if (e.fauxCarte) refus.push(`${nom} : ${e.fauxCarte} désignation(s) d'une autre carte`);
    if (T.A.atteints < minimums.A) refus.push(`A : ${T.A.atteints} cas atteints < minimum ${minimums.A}`);
    if (D.A.atteints < minimums.D_A) refus.push(`danger A : ${D.A.atteints} cas atteints < minimum ${minimums.D_A}`);
    if (D.C.atteints < minimums.D_C) refus.push(`danger C : ${D.C.atteints} cas atteints < minimum ${minimums.D_C}`);
    return { ok: refus.length === 0, refus };
}

function imprimer(cal, log) {
    const ligne = (nom, e) => `   ${nom.padEnd(26)} cas ${String(e.cas).padStart(5)} · ATTEINTS ${String(e.atteints).padStart(5)} · justes ${String(e.justes ?? '—').padStart(5)} · faux ${e.fauxCarte + (e.fauxNumero || 0)} · silences ${e.silences}`;
    log(ligne('A  vérité présente', cal.total.A)); log(ligne('B  retirée (meta+Setlist)', cal.total.B)); log(ligne('C  retirée (Setlist)', cal.total.C));
    log(`   D  DANGER : ${cal.danger.sets} sets lus (${cal.danger.illisibles} illisibles), ${cal.danger.evalues} produits évalués, ${cal.danger.isoles} isolés (métacarte >= 2 frères ET homonyme dans la Setlist)`);
    log(ligne('D-A danger, vérité', cal.danger.A)); log(ligne('D-C danger, retirée', cal.danger.C));
    for (const [t, x] of Object.entries(cal.danger.parTirage).sort()) log(`      danger, tirage ${t.padEnd(8)} A : ${x.A.cas} isolés, ${x.A.atteints} atteints, ${x.A.justes} justes, faux ${x.A.fauxCarte} carte / ${x.A.fauxNumero} numéro · C : ${x.C.atteints} atteints, faux ${x.C.fauxCarte}`);
    log(`   minimums de cas atteints : A ${cal.minimums.A}, D-A ${cal.minimums.D_A}, D-C ${cal.minimums.D_C}`);
}

module.exports = { calibrer, verdict, imprimer, evaluer, chargerExport, MINIMUMS };
