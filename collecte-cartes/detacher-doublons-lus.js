'use strict';
// ============================================================
// DÉTACHER DEUX DOUBLONS LUS (EX Trainer Kit 2, M2 et M6) — liste FERMÉE, feu vert NOMMÉ de l'éditeur, 2026-10-27
// ============================================================
// Charmander (45331) et Minun (45339) portent DEUX entrées de visuel dans EX-Trainer-Kit-2 : celle de pokemontcg.io (numero « M2 »/« M6 », avec sa preuve) et celle de pkc (numero null), le même
// dessin. Les deux scans ont été regardés : même « 2/12 » (resp. « 6/12 ») et même symbole Minun. Égalité de lecture → on GARDE l'entrée qui porte déjà son numéro et sa preuve, on DÉTACHE l'autre.
//
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE — une entrée n'est détachée que si TOUT ceci est vrai :
//   · la carte existe et porte EXACTEMENT une entrée (set, cleGardee) dont le `numero` est celui de la liste (M2 / M6) ;
//   · elle porte EXACTEMENT une entrée (set, cleDetachee), de source `pkc`, à `numero` null ;
//   · le document `images` correspondant (source pkc, carte, set, cleR2) existe, UN SEUL, à l'état `ok` ;
// sinon refus nommé (« rien à détacher » si c'est déjà fait), et rien n'est écrit pour cette ligne.
// ÉCRITURE : `$pull` de l'entrée (filtre carte + elemMatch set/cleR2) ; le document `images` passe à `etat: 'retire'` (+ retireLe, retireMotif) : une recollecte ne le reprend pas. Les objets R2 ne sont PAS effacés.
const PREUVE = 'les deux scans montrent « 2/12 » (resp. « 6/12 ») et le symbole Minun du kit, lus le 2026-10-27 (S8\\PRIORITES\\m2m6-planches) ; égalité de lecture → on garde l\'entrée qui porte déjà numero M2/M6 et sa preuve ; feu vert nommé de l\'éditeur du 2026-10-27';
const SET = 'EX-Trainer-Kit-2';

const L = (carteId, nom, cleGardee, numeroGarde, cleDetachee) => Object.freeze({ carteId, nom, set: SET, cleGardee, numeroGarde, cleDetachee, preuve: PREUVE });
const LISTE = Object.freeze([
    L(45331, 'Charmander', 'pokemontcg.io/EX-Trainer-Kit-2/M2-45331-en.webp', 'M2', 'pkc/EX-Trainer-Kit-2/sans-numero-45331-en.webp'),
    L(45339, 'Minun', 'pokemontcg.io/EX-Trainer-Kit-2/M6-45339-en.webp', 'M6', 'pkc/EX-Trainer-Kit-2/sans-numero-45339-en.webp')
]);
const porte = (c, set, cleR2) => (c?.images || []).filter(i => i && i.set === set && i.cleR2 === cleR2);

/** Lecture seule. @returns {Promise<{aDetacher:{entree,fausse:object,avecVignette:boolean}[], refus:{entree,raison:string}[]}>} */
async function simuler(db, liste = LISTE) {
    const aDetacher = [], refus = [];
    for (const entree of liste) {
        const carte = await db.collection('cartes').findOne({ _id: entree.carteId });
        if (!carte) { refus.push({ entree, raison: `carte absente (${entree.carteId})` }); continue; }
        const fausses = porte(carte, entree.set, entree.cleDetachee), gardees = porte(carte, entree.set, entree.cleGardee);
        if (!fausses.length) { refus.push({ entree, raison: gardees.length ? 'rien à détacher : la carte ne porte déjà plus ce fichier' : `ni ${entree.cleDetachee} ni ${entree.cleGardee} sur la carte` }); continue; }
        if (fausses.length !== 1) { refus.push({ entree, raison: `${fausses.length} entrées au lieu d'exactement une (set, cleR2) à détacher sur la carte ${entree.carteId}` }); continue; }
        if (fausses[0].source !== 'pkc' || fausses[0].numero !== null) { refus.push({ entree, raison: `l'entrée à détacher n'est pas (source pkc, numero null) : source ${fausses[0].source}, numero ${JSON.stringify(fausses[0].numero)}` }); continue; }
        if (gardees.length !== 1) { refus.push({ entree, raison: `${gardees.length} entrée(s) à garder au lieu d'exactement une (${entree.cleGardee})` }); continue; }
        if (gardees[0].numero !== entree.numeroGarde) { refus.push({ entree, raison: `l'entrée à garder porte le numero ${JSON.stringify(gardees[0].numero)} au lieu de ${entree.numeroGarde}` }); continue; }
        const docs = await db.collection('images').find({ source: 'pkc', carteId: entree.carteId, set: entree.set, cleR2: entree.cleDetachee }).toArray();
        if (docs.length !== 1) { refus.push({ entree, raison: `${docs.length} document(s) images au lieu d'exactement un pour ${entree.cleDetachee}` }); continue; }
        if (docs[0].etat !== 'ok') { refus.push({ entree, raison: `le document images est à l'état « ${docs[0].etat} » (ok attendu)` }); continue; }
        aDetacher.push({ entree, fausse: fausses[0], avecVignette: !!fausses[0].vignette });
    }
    return { aDetacher, refus };
}

/** L'annonce des baisses pour lot-additif (--annonce). */
function annonce(plan) {
    const a = {};
    for (const x of plan.aDetacher) {
        a[`images set:${x.entree.set}`] = (a[`images set:${x.entree.set}`] ?? 0) + 1;
        if (x.avecVignette) a[`vignettes-set set:${x.entree.set}`] = (a[`vignettes-set set:${x.entree.set}`] ?? 0) + 1;
    }
    return a;
}

/** Écrit le plan (la sauvegarde des entrées détachées est écrite AVANT la première écriture). @returns {Promise<number>} */
async function detacher(db, plan, { sauvegarde, ecrireFichier } = {}) {
    if (!sauvegarde) throw new Error('écrire exige une sauvegarde des entrées détachées (--sauvegarde=<f>.json) : rien n\'est écrit');
    if (!plan.aDetacher.length) return 0;
    // une sauvegarde EXISTANTE n'est jamais écrasée : une reprise perdrait les entrées déjà détachées (relecture du 27/10)
    if (require('fs').existsSync(sauvegarde)) throw new Error(`la sauvegarde ${sauvegarde} existe déjà : rien n'est écrit (choisir un nouveau fichier)`);
    ecrireFichier(sauvegarde, { le: new Date().toISOString(), quoi: 'entrées cartes.images détachées (detacher-doublons-lus.js) + documents images passés à « retire »', lignes: plan.aDetacher.map(x => ({ carteId: x.entree.carteId, set: x.entree.set, cleR2: x.entree.cleDetachee, entree: x.fausse })) });
    const maintenant = new Date();
    let n = 0;
    for (const { entree: e } of plan.aDetacher) {
        const r = await db.collection('cartes').updateOne({ _id: e.carteId, images: { $elemMatch: { set: e.set, cleR2: e.cleDetachee } } }, { $pull: { images: { set: e.set, cleR2: e.cleDetachee } } });
        if (!r.modifiedCount) throw new Error(`carte ${e.carteId} : entrée ${e.cleDetachee} introuvable à l'écriture — arrêt (--restaurer remet l'avant)`);
        const d = await db.collection('images').updateOne({ source: 'pkc', carteId: e.carteId, set: e.set, cleR2: e.cleDetachee, etat: 'ok' }, { $set: { etat: 'retire', retireLe: maintenant, retireMotif: e.preuve } });
        if (!d.modifiedCount) throw new Error(`carte ${e.carteId} : document images de ${e.cleDetachee} introuvable à l'état ok — arrêt (--restaurer remet l'avant)`);
        n++;
    }
    return n;
}

/** Remet l'entrée ($push) et repasse le document à `ok` ; refuse si la carte porte déjà l'entrée ou si le document n'est plus « retire ». */
async function restaurer(db, sauvegardee, { ecrire = false, attendu } = {}) {
    const lignes = sauvegardee.lignes;
    if (!Array.isArray(lignes) || !lignes.length) throw new Error('sauvegarde sans ligne : rien à restaurer');
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--restaurer --ecrire exige --attendu=<N> : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== lignes.length) throw new Error(`--attendu=${attendu} mais ${lignes.length} ligne(s) dans la sauvegarde : rien n'est écrit`);
    if (!ecrire) return { lignes: lignes.length };
    for (const l of lignes) {
        const r = await db.collection('cartes').updateOne({ _id: l.carteId, 'images.cleR2': { $ne: l.cleR2 } }, { $push: { images: l.entree } });
        if (!r.modifiedCount) throw new Error(`carte ${l.carteId} : introuvable ou porte déjà ${l.cleR2} (déjà restaurée) — arrêt`);
        const d = await db.collection('images').updateOne({ source: 'pkc', carteId: l.carteId, set: l.set, cleR2: l.cleR2, etat: 'retire' }, { $set: { etat: 'ok' }, $unset: { retireLe: '', retireMotif: '' } });
        if (!d.modifiedCount) throw new Error(`carte ${l.carteId} : document images de ${l.cleR2} introuvable à l'état retire — arrêt`);
    }
    let rendues = 0;
    for (const l of lignes) rendues += porte(await db.collection('cartes').findOne({ _id: l.carteId }), l.set, l.cleR2).length;
    return { lignes: lignes.length, relu: { rendues } };
}

module.exports = { LISTE, PREUVE, SET, simuler, annonce, detacher, restaurer };
