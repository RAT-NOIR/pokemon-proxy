'use strict';
// GALERIE — les CLASSEURS privés de l'Atelier (`/api/classeurs`), leur publication et leur dépublication, sur la base DÉDIÉE (base.js). Un seul stockage (arbitrage O15) : la page est celle de pages.js.
//   · `classeurs` : la copie de TRAVAIL de l'auteur ({ _id, auteurId, titre, etiquettes, couleur, couverture, pages, repriseDe, version, creeLe, majLe }). L'ÉTAT (privé, en attente, public, refusé, retiré) n'y est PAS écrit :
//     il se LIT sur la publication (etatsDe), la seule source — une décision de modération ne laisse donc jamais le classeur dire autre chose.
//   · `publications` : la copie publiée, de MÊME identifiant que le classeur (les votes, la galerie, la reprise et le signalement parlent du même objet). Elle porte la DERNIÈRE VERSION ACCEPTÉE :
//     un classeur public modifié ne la touche pas, il dépose à côté UNE mise à jour en attente (`remplace` = l'identifiant du classeur) que la modération accepte (elle prend la place) ou refuse.
//   · l'écriture d'un classeur est un comparer-et-écrire atomique sur `version` ; un classeur d'autrui, absent ou mal nommé répond le même `introuvable` (jamais « interdit »).
//   · une illustration citée est l'une des SIENNES ou une PUBLIQUE ; une illustration qui disparaît se lit `null`, sans jamais faire tomber la lecture (resoudre).
const G = require('./base');
const F = require('./forme');
const P = require('./pages');

const OCTETS_MAX = 64 * 1024, TAILLE_LISTE = 50, CAP_ATTRIBUT = 200;
const COULEURS = Object.freeze(['rouge', 'orange', 'jaune', 'vert', 'bleu', 'violet', 'rose', 'brun', 'noir', 'blanc', 'gris', 'or']);
const iso = d => (d instanceof Date ? d.toISOString() : null);
const estDup = e => Boolean(e) && e.code === 11000;
const unique = a => [...new Set(a)];

// ═══ la forme du corps ═══
/** Le corps d'un classeur (création ou PUT). { champs } | { detail } | { borne }. `version` n'est admis (et exigé) que pour le PUT ; `pages` n'est exigé que pour le PUT. */
function lireCorps(b, { ecriture }) {
    if (!F.objet(b) || !F.cles(b, ['titre', 'etiquettes', 'couleur', 'couverture', 'pages', ...(ecriture ? ['version'] : [])])) return { detail: 'corps' };
    let version = null;
    if (ecriture) { if (!Number.isInteger(b.version) || b.version < 1) return { detail: 'version-invalide' }; version = b.version; }
    const t = F.problemeTexte(b.titre, { min: 1, max: 80 });
    if (t) return { detail: t === 'donnee-binaire' ? 'donnee-binaire' : 'titre' };
    const titre = b.titre.normalize('NFKC').trim();
    if (!titre) return { detail: 'titre' };
    let etiquettes = [];
    if (b.etiquettes !== undefined) {
        if (!Array.isArray(b.etiquettes) || b.etiquettes.length > 8) return { detail: 'etiquettes' };
        for (const e of b.etiquettes) { const p = typeof e === 'string' ? F.problemeTexte(e, { min: 2, max: 24 }) : 'type'; if (p || e !== e.toLowerCase() || e !== e.trim()) return { detail: p === 'donnee-binaire' ? 'donnee-binaire' : 'etiquettes' }; }
        etiquettes = unique(b.etiquettes.map(e => e.normalize('NFKC')));
    }
    const couleur = b.couleur === undefined || b.couleur === null ? null : b.couleur;
    if (couleur !== null && !COULEURS.includes(couleur)) return { detail: 'couleur' };
    let couverture = null;
    if (b.couverture !== undefined && b.couverture !== null) {
        const k = b.couverture;
        if (F.objet(k) && F.cles(k, ['carte']) && Object.keys(k).length === 1 && require('../collection/forme').cleValide(k.carte)) couverture = { carte: k.carte };
        else if (F.objet(k) && F.cles(k, ['illustration']) && Object.keys(k).length === 1 && F.idValide(k.illustration)) couverture = { illustration: k.illustration };
        else return { detail: 'couverture' };
    }
    if (b.pages === undefined && !ecriture) b = { ...b, pages: [{ nb: 9, blocs: [] }] };
    const p = P.lirePages(b.pages);
    if (p.borne) return { borne: p.borne };
    if (p.detail) return { detail: p.detail };
    return { champs: { titre, etiquettes, couleur, couverture, pages: p.pages }, version };
}
/** Les identifiants d'illustration que citent des champs de classeur (pages et couverture). */
const illustrationsCitees = c => unique([...P.artsCites(c.pages), ...(c.couverture && c.couverture.illustration ? [c.couverture.illustration] : [])]);
/** Parmi `ids`, ceux qu'un lecteur peut voir : les SIENNES (`mien`, ou null) ou les PUBLIQUES. */
async function artsAccessibles(ids, mien) {
    if (!ids.length) return new Set();
    const filtre = mien ? { _id: { $in: ids }, $or: [{ auteurId: mien }, { etat: 'public' }] } : { _id: { $in: ids }, etat: 'public' };
    return new Set((await G.col('arts').find(filtre, { projection: { _id: 1 } }).toArray()).map(a => a._id));
}
/** Les pages et la couverture, avec `null` pour toute illustration que le lecteur ne peut plus voir (supprimée, retirée de la banque, d'autrui et non publique). */
function resoudre(pages, couverture, ok) {
    return {
        pages: pages.map(p => ({ nb: p.nb, blocs: p.blocs.map(b => (b.contenu && b.contenu.type === 'art' && !ok.has(b.contenu.artId) ? { ...b, contenu: null } : b)) })),
        couverture: couverture && couverture.illustration && !ok.has(couverture.illustration) ? null : (couverture || null)
    };
}

// ═══ l'état, LU sur la publication ═══
/** Pour chaque identifiant de classeur : { visibilite, motif, compteurs }. Aucune publication : privé. La version publique reste servie tant qu'une mise à jour attend ou a été refusée (c'est la mise à jour qui parle à l'auteur). */
async function etatsDe(ids) {
    const sortie = new Map(ids.map(id => [id, { visibilite: 'prive', motif: null, compteurs: null }]));
    if (!ids.length) return sortie;
    const docs = await G.col('publications').find({ $or: [{ _id: { $in: ids } }, { remplace: { $in: ids } }] }, { projection: { etat: 1, motif: 1, remplace: 1, nbJaime: 1, nbEnregistre: 1 } }).toArray();
    for (const id of ids) {
        const main = docs.find(d => d._id === id), attente = docs.find(d => d.remplace === id);
        if (!main) continue;
        if (main.etat !== 'public') { sortie.set(id, { visibilite: main.etat, motif: main.etat === 'en-attente' ? null : (main.motif || null), compteurs: null }); continue; }
        const compteurs = { jaime: main.nbJaime || 0, enregistre: main.nbEnregistre || 0 };
        if (attente) sortie.set(id, attente.etat === 'refuse' ? { visibilite: 'refuse', motif: attente.motif || null, compteurs } : { visibilite: 'en-attente', motif: null, compteurs });
        else sortie.set(id, { visibilite: 'public', motif: null, compteurs });
    }
    return sortie;
}

// ═══ les vues ═══
const apercu = pages => P.cartesDans(pages).slice(0, 9).map(k => k.cle);
function vueAuteur(d, etat, ok) {
    const r = resoudre(d.pages, d.couverture, ok);
    return { id: d._id, titre: d.titre, etiquettes: d.etiquettes || [], couleur: d.couleur ?? null, couverture: r.couverture, pages: r.pages, visibilite: etat.visibilite, motif: etat.motif, repriseDe: d.repriseDe || null, version: d.version, creeLe: iso(d.creeLe), majLe: iso(d.majLe) };
}
function vuePublique(d, ok) {
    const r = resoudre(d.pagesBlocs, d.couverture, ok);
    return { id: d._id, titre: d.titre, etiquettes: d.etiquettes || [], couleur: d.couleur ?? null, couverture: r.couverture, pages: r.pages, visibilite: 'public', motif: null, repriseDe: d.repriseDe || null, version: d.versionClasseur ?? 1, creeLe: iso(d.recuLe), majLe: iso(d.publieLe), auteur: { pseudo: d.pseudo } };
}
function resume(d, etat, ok) {
    const r = resoudre(d.pages, d.couverture, ok);
    return { id: d._id, titre: d.titre, etiquettes: d.etiquettes || [], couleur: d.couleur ?? null, doublesPages: P.doublesPages(d.pages.length), couverture: r.couverture, apercu: apercu(d.pages), visibilite: etat.visibilite, motif: etat.motif, majLe: iso(d.majLe), compteurs: etat.compteurs };
}

// ═══ les opérations ═══
/** Les citations d'illustration d'un corps lu : toutes doivent être accessibles à l'auteur. true | false. */
async function citationsPermises(champs, mien) {
    const ids = illustrationsCitees(champs);
    if (!ids.length) return true;
    const ok = await artsAccessibles(ids, mien);
    return ids.every(i => ok.has(i));
}
async function creer({ compteId, champs, max, maintenant = new Date() }) {
    const mien = String(compteId);
    if (!(await citationsPermises(champs, mien))) return { detail: 'illustration-inconnue' };
    if ((await G.col('classeurs').countDocuments({ auteurId: mien }, { limit: max })) >= max) return { borne: 'borne-classeurs', max };
    const doc = { _id: F.nouvelId(), auteurId: mien, ...champs, repriseDe: null, version: 1, creeLe: maintenant, majLe: maintenant };
    await G.col('classeurs').insertOne(doc);
    return { classeur: vueAuteur(doc, { visibilite: 'prive', motif: null }, await artsAccessibles(illustrationsCitees(doc), mien)) };
}
async function lister({ compteId, o = 0 }) {
    const mien = String(compteId);
    const docs = await G.col('classeurs').find({ auteurId: mien }).sort({ creeLe: -1, _id: 1 }).skip(o).limit(TAILLE_LISTE + 1).toArray();
    const page = docs.slice(0, TAILLE_LISTE);
    const [etats, ok] = await Promise.all([etatsDe(page.map(d => d._id)), artsAccessibles(unique(page.flatMap(illustrationsCitees)), mien)]);
    return { classeurs: page.map(d => resume(d, etats.get(d._id), ok)), suite: docs.length > TAILLE_LISTE ? F.ecrireSuite(o + TAILLE_LISTE) : null };
}
/** { introuvable } | { classeur, auteur: boolean }. L'auteur lit sa copie de travail (tout état) ; tout autre lecteur ne lit que la version PUBLIQUE acceptée. */
async function lire({ id, compteId = null }) {
    if (!F.idValide(id)) return { introuvable: true };
    if (compteId) {
        const mien = String(compteId), d = await G.col('classeurs').findOne({ _id: id, auteurId: mien });
        if (d) { const [etats, ok] = await Promise.all([etatsDe([id]), artsAccessibles(illustrationsCitees(d), mien)]); return { classeur: vueAuteur(d, etats.get(id), ok), auteur: true }; }
    }
    const p = await G.col('publications').findOne({ _id: id, etat: 'public', pagesBlocs: { $exists: true } });
    if (!p) return { introuvable: true };
    const ok = await artsAccessibles(illustrationsCitees({ pages: p.pagesBlocs, couverture: p.couverture }), null);
    return { classeur: vuePublique(p, ok), auteur: false };
}

// ── la publication, dérivée du classeur ──
/** L'instantané publié : les pages demandées (dans l'ordre du classeur), les attributs de filtre qu'on sait DÉDUIRE (cartes, sets, couleur du classeur). { vide: true } si rien n'est posé dedans. */
function instantane(d, { categories, pagesPubliees, certification }) {
    const pages = pagesPubliees ? pagesPubliees.map(n => d.pages[n - 1]) : d.pages;
    if (!pages.length || !pages.some(p => p.blocs.some(b => b.contenu))) return { vide: true };
    const cartes = P.cartesDans(pages);
    const borne = a => a.slice(0, CAP_ATTRIBUT);
    return { titre: d.titre, categories, nb: pages[0].nb, pages: pages.length, pagesBlocs: pages,
        attributs: { carte: borne(unique(cartes.map(k => k.cle))), carteIds: borne(unique(cartes.map(k => k.cle.split('|')[0]))), couleur: d.couleur ? [d.couleur] : [], type: [], illustrateur: [], set: borne(unique(cartes.map(k => k.setSlug))) },
        certification, pagesPubliees: pagesPubliees || null, etiquettes: d.etiquettes || [], couleur: d.couleur ?? null, couverture: d.couverture || null, repriseDe: d.repriseDe || null, versionClasseur: d.version };
}
/** Le corps d'une publication : { certifieAuteur: true, cgu, categories?, pagesPubliees? }. { cgu, categories, pagesPubliees } | { detail }. */
function lireCorpsPublication(b, nbPages) {
    if (!F.objet(b) || !F.cles(b, ['certifieAuteur', 'cgu', 'categories', 'pagesPubliees'])) return { detail: 'corps' };
    if (b.certifieAuteur !== true) return { detail: 'auteur-non-certifie' };
    if (typeof b.cgu !== 'string' || F.problemeTexte(b.cgu, { min: 1, max: 40 })) return { detail: 'cgu' };
    let categories = [];
    if (b.categories !== undefined) {
        if (!Array.isArray(b.categories) || b.categories.length > F.CATEGORIES.length || b.categories.some(c => !F.CATEGORIES.includes(c)) || new Set(b.categories).size !== b.categories.length) return { detail: 'categories' };
        categories = b.categories;
    }
    let pagesPubliees = null;
    if (b.pagesPubliees !== undefined && b.pagesPubliees !== null) {
        const l = b.pagesPubliees;
        if (!Array.isArray(l) || !l.length || l.length > P.PAGES_MAX || l.some(n => !Number.isInteger(n) || n < 1 || n > nbPages) || new Set(l).size !== l.length) return { detail: 'pages-publiees' };
        pagesPubliees = [...l].sort((x, y) => x - y);
    }
    return { cgu: b.cgu.normalize('NFKC').trim(), categories, pagesPubliees };
}
/** Dépose (ou remplace) la mise à jour en attente d'un classeur DÉJÀ public : une seule par classeur (index unique sur `remplace`). */
async function deposerMiseAJour(id, auteurId, pseudo, snap, maintenant) {
    for (let essai = 0; essai < 2; essai++) {
        try {
            await G.col('publications').updateOne({ remplace: id }, { $set: { auteurId, pseudo, ...snap, etat: 'en-attente', recuLe: maintenant, motif: null }, $setOnInsert: { _id: F.nouvelId(), publieLe: null, nbJaime: 0, nbEnregistre: 0 } }, { upsert: true });
            return;
        } catch (e) { if (!estDup(e) || essai === 1) throw e; }
    }
}
/** { introuvable } | { refus } (classeur-vide, illustration-refusee) | { ok } */
async function publier({ compteId, pseudo, id, corps, maintenant = new Date() }) {
    const mien = String(compteId);
    const d = F.idValide(id) ? await G.col('classeurs').findOne({ _id: id, auteurId: mien }) : null;
    if (!d) return { introuvable: true };
    const l = lireCorpsPublication(corps, d.pages.length);
    if (l.detail) return { refus: l.detail };
    const snap = instantane(d, { categories: l.categories, pagesPubliees: l.pagesPubliees, certification: { cgu: l.cgu, le: maintenant } });
    if (snap.vide) return { refus: 'classeur-vide' };
    const ids = P.artsCites(snap.pagesBlocs);
    const lus = new Map((ids.length ? await G.col('arts').find({ _id: { $in: ids } }, { projection: { auteurId: 1, etat: 1 } }).toArray() : []).map(a => [a._id, a]));
    if (ids.some(i => { const a = lus.get(i); return a && a.auteurId === mien && ['refuse', 'retire'].includes(a.etat); })) return { refus: 'illustration-refusee' };
    const main = await G.col('publications').findOne({ _id: id }, { projection: { etat: 1 } });
    if (!main) {
        try { await G.col('publications').insertOne({ _id: id, auteurId: mien, pseudo, ...snap, etat: 'en-attente', recuLe: maintenant, publieLe: null, nbJaime: 0, nbEnregistre: 0, motif: null }); }
        catch (e) { if (!estDup(e)) throw e; await G.col('publications').updateOne({ _id: id, etat: { $ne: 'public' } }, { $set: { pseudo, ...snap, etat: 'en-attente', recuLe: maintenant, motif: null } }); }
    } else if (main.etat === 'public') await deposerMiseAJour(id, mien, pseudo, snap, maintenant);
    else await G.col('publications').updateOne({ _id: id }, { $set: { pseudo, ...snap, etat: 'en-attente', recuLe: maintenant, motif: null } });
    // ses illustrations PRIVÉES passent en modération AVEC le classeur, sous la même certification (les publiques d'autrui restent ce qu'elles sont)
    if (ids.length) await G.col('arts').updateMany({ _id: { $in: ids }, auteurId: mien, etat: 'prive' }, { $set: { etat: 'en-attente', recuLe: maintenant, certification: { droits: true, nonOfficielle: true, le: maintenant } } });
    return { ok: true };
}
/** Retire la publication (et la mise à jour en attente) ET les votes qui visaient la copie publiée. Le classeur de travail est intact. */
async function retirerPublication(id) {
    await G.col('publications').deleteMany({ $or: [{ _id: id }, { remplace: id }] });
    await G.col('votes').deleteMany({ type: 'galerie', cible: id });
}
async function depublier({ compteId, id }) {
    const mien = String(compteId);
    if (!F.idValide(id) || !(await G.col('classeurs').findOne({ _id: id, auteurId: mien }, { projection: { _id: 1 } }))) return { introuvable: true };
    await retirerPublication(id);
    return { ok: true };
}
/** Écrit un classeur (PUT) : comparer-et-écrire atomique sur `version`. { introuvable } | { detail } | { borne } | { conflit: { versionActuelle } } | { classeur }. */
async function ecrire({ compteId, id, champs, version, maintenant = new Date() }) {
    const mien = String(compteId);
    if (!F.idValide(id)) return { introuvable: true };
    if (!(await citationsPermises(champs, mien))) return { detail: 'illustration-inconnue' };
    const d = await G.col('classeurs').findOneAndUpdate({ _id: id, auteurId: mien, version }, { $set: { ...champs, majLe: maintenant }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!d) {
        const e = await G.col('classeurs').findOne({ _id: id, auteurId: mien }, { projection: { version: 1 } });
        return e ? { conflit: { versionActuelle: e.version } } : { introuvable: true };
    }
    await synchroniser(d, maintenant);
    const [etats, ok] = await Promise.all([etatsDe([id]), artsAccessibles(illustrationsCitees(d), mien)]);
    return { classeur: vueAuteur(d, etats.get(id), ok) };
}
/** Un classeur en attente ou public MODIFIÉ : la copie en attente suit (en attente : sur place ; public : une mise à jour à côté, l'ancienne version reste servie). Refusé, retiré, privé : rien. */
async function synchroniser(d, maintenant) {
    const main = await G.col('publications').findOne({ _id: d._id }, { projection: { etat: 1, categories: 1, pagesPubliees: 1, certification: 1, pseudo: 1 } });
    if (!main || !['en-attente', 'public'].includes(main.etat)) return;
    const pp = main.pagesPubliees ? main.pagesPubliees.filter(n => n <= d.pages.length) : null;
    if (pp && !pp.length) return;
    const snap = instantane(d, { categories: main.categories || [], pagesPubliees: pp, certification: main.certification || null });
    if (snap.vide) return;
    if (main.etat === 'en-attente') await G.col('publications').updateOne({ _id: d._id }, { $set: { ...snap, recuLe: maintenant } });
    else await deposerMiseAJour(d._id, d.auteurId, main.pseudo, snap, maintenant);
}
async function supprimer({ compteId, id }) {
    const mien = String(compteId);
    if (!F.idValide(id)) return { introuvable: true };
    const r = await G.col('classeurs').deleteOne({ _id: id, auteurId: mien });
    if (r.deletedCount !== 1) return { introuvable: true };
    await retirerPublication(id);
    return { ok: true };
}
/** La vue d'un classeur de l'auteur après une opération (publication, dépublication). */
async function vueDe(compteId, id) {
    const r = await lire({ id, compteId });
    return r.classeur;
}

module.exports = { OCTETS_MAX, COULEURS, lireCorps, lireCorpsPublication, artsAccessibles, etatsDe, creer, lister, lire, publier, depublier, ecrire, supprimer, vueDe, instantane, synchroniser };
