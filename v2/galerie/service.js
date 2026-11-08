'use strict';
// GALERIE — le stockage et les règles de la Communauté, sur la base DÉDIÉE (base.js) : pseudo, fil des pages (publications), banque d'art, votes, reprise (remix), signalements, modération.
// Rien ici ne touche la base de l'API. Les images vivent dans R2 (r2.js) ; la base ne garde que des références (clé, dimensions, couleur).
//   · « public » est le seul état que voit un lecteur ; tout le reste (privé, en attente, refusé, retiré, absent) répond le même INTROUVABLE (404) — les fonctions rendent null, jamais « existe mais interdit ».
//   · UN VOTE par (compte, genre, type, cible) : l'unicité est celle de l'INDEX `vote_unique`, pas d'un test préalable ; le compteur ne bouge (`$inc ±1`) que si la ligne a RÉELLEMENT été créée ou supprimée.
//   · un compteur public est ARRONDI tant qu'il est sous 5 : `jaime: null` + `petitCompteur: true` (la valeur exacte reste côté serveur).
const crypto = require('crypto');
const G = require('./base');
const F = require('./forme');
const P = require('./pages');
const { cleValide } = require('../collection/forme');

const PAGE = 24, PAGE_ART = 40, CAP_TENDANCES = 2000, JOURS_TENDANCE = 7, SEUIL_PETIT = 5;
const iso = d => (d instanceof Date ? d.toISOString() : null);
const compteur = n => (n >= SEUIL_PETIT ? { valeur: n, petit: false } : { valeur: null, petit: true });
const estDup = e => Boolean(e) && e.code === 11000;
const COLL = Object.freeze({ galerie: 'publications', banque: 'arts' });
const CHAMP = Object.freeze({ jaime: 'nbJaime', enregistre: 'nbEnregistre' });

// ce qu'une mise à jour acceptée emporte de l'instantané du classeur (jamais l'identifiant, l'auteur, les compteurs ni la date de première publication)
const CHAMPS_INSTANTANE = Object.freeze(['titre', 'categories', 'nb', 'pages', 'pagesBlocs', 'attributs', 'certification', 'pagesPubliees', 'etiquettes', 'couleur', 'couverture', 'repriseDe', 'versionClasseur']);
const FIN = String.fromCharCode(0xffff);
/** Les MOTS d'un texte (minuscules, sans accent, lettres et chiffres) : la recherche `q` de la banque compare des PRÉFIXES de mots, sur un index multiclé, jamais une regex non ancrée (relecture 1, S-I4). */
const motsDe = (...textes) => [...new Set(textes.flatMap(t => String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)))].slice(0, 20);
/** Le filtre de la recherche `q` : chaque mot de la requête est le PRÉFIXE d'un mot du nom ou du pseudo (index multiclé `mots_1_etat_1`). null : aucun mot exploitable. L'état « public » est ajouté par l'appelant. */
function filtreRecherche(q) {
    const mots = motsDe(q);
    if (!mots.length) return null;
    // $elemMatch : la borne basse et la borne haute doivent valoir pour le MÊME mot (sans lui, un tableau de deux mots satisfait chaque borne par un mot différent)
    return { $and: mots.slice(0, 4).map(w => ({ mots: { $elemMatch: { $gte: w, $lt: w + FIN } } })) };
}

/** L'identifiant opaque d'un compte pour les lectures d'administration et les clés R2 : un HMAC, jamais l'identifiant de compte. */
const refCompte = (compteId, secret) => crypto.createHmac('sha256', String(secret)).update(`galerie-ref|${compteId}`).digest('hex').slice(0, 16);

// ═══ la file de reprise des suppressions R2 (relectures 1 et 2 : un échec ne se perd pas) ═══
/** Une clé R2 à supprimer plus tard : `purges_r2` (base dédiée), rejouée par le balayeur (balayeur.js). Une seule entrée par clé. */
async function mettreEnFile(cle, raison, maintenant = new Date()) {
    await G.col('purges_r2').updateOne({ _id: cle }, { $setOnInsert: { raison, le: maintenant, essais: 0 } }, { upsert: true });
}
/** Supprime une clé ; si R2 échoue, la clé entre dans la file (comptée dans `bilan`). Rend true si l'objet est parti. */
async function supprimerOuFile(stockage, cle, raison, bilan = null) {
    if (!stockage) return false;
    try { await stockage.supprimer(cle); return true; }
    catch (e) {
        console.error(`❌ [galerie] suppression R2 en échec (${(e && (e.name || e.code)) || 'erreur'}) : la clé entre dans la file de reprise`);
        await mettreEnFile(cle, raison);
        if (bilan) bilan.enFile++;
        return false;
    }
}
const clesDe = base => [`${base}.webp`, `${base}-480.webp`];
/** L'objet `attente/` d'un art (image et vignette) : il ne survit à aucune décision. */
async function purgerAttente(stockage, d, raison) { for (const k of clesDe(d.cle)) await supprimerOuFile(stockage, k, raison); }
/** Les copies publiques ET celles d'attente d'un art retiré. */
async function purgerCopies(stockage, d, raison) { for (const k of [...clesDe(d.clePublique), ...clesDe(d.cle)]) await supprimerOuFile(stockage, k, raison); }
/** Un jeton Turnstile n'est accepté qu'UNE fois : seule son empreinte est gardée, dix minutes. true : jeton neuf ; false : déjà vu. */
async function jetonNeuf(jeton, maintenant = new Date()) {
    const h = crypto.createHash('sha256').update(`galerie-turnstile|${jeton}`).digest('hex');
    try { await G.col('jetons_turnstile').insertOne({ h, expireLe: new Date(maintenant.getTime() + 10 * 60e3) }); return true; }
    catch (e) { if (estDup(e)) return false; throw e; }
}

// ═══ pseudo ═══
async function pseudoDe(compteId) { const p = await G.col('profils').findOne({ _id: String(compteId) }, { projection: { pseudo: 1 } }); return p ? p.pseudo : null; }
/** { ok:true, pseudo } | { conflit:true }. L'unicité est celle de l'index `pseudo_unique` ; un pseudo déjà porté par CE compte est un succès (idempotent). */
async function poserPseudo(compteId, pseudo, maintenant = new Date()) {
    const id = String(compteId);
    for (let essai = 0; essai < 3; essai++) {
        try { await G.col('profils').updateOne({ _id: id }, { $set: { pseudo, pseudoCle: pseudo, majLe: maintenant }, $setOnInsert: { creeLe: maintenant } }, { upsert: true }); break; }
        catch (e) {
            if (!estDup(e)) throw e;
            const moi = await G.col('profils').findOne({ _id: id }, { projection: { pseudo: 1 } });
            if (moi && moi.pseudo === pseudo) break;
            if (moi || essai === 2) return { conflit: true };            // le pseudo est porté par un AUTRE compte (ou la création simultanée de MON profil n'a pas abouti)
        }
    }
    await G.col('publications').updateMany({ auteurId: id }, { $set: { pseudo } });
    for (const a of await G.col('arts').find({ auteurId: id }, { projection: { nom: 1 } }).toArray()) await G.col('arts').updateOne({ _id: a._id }, { $set: { pseudo, mots: motsDe(a.nom, pseudo) } });
    return { ok: true, pseudo };
}

// ═══ lectures publiques : le fil des pages ═══
/** Les arts POSÉS d'une page portent de quoi s'afficher (correction 3 du site) : { art, col, row, fmt, url, largeur, hauteur }, lus sur la banque (un seul aller-retour pour toute la page). Un art qui n'est plus public est OMIS. */
async function liensDesArts(listes, urlPublique) {
    const ids = [...new Set(listes.flat().map(x => x.art))];
    const lus = ids.length ? await G.col('arts').find({ _id: { $in: ids }, etat: 'public' }, { projection: { clePublique: 1, largeur: 1, hauteur: 1 } }).toArray() : [];
    const m = new Map(lus.map(a => [a._id, a]));
    return poses => poses.filter(x => m.has(x.art)).map(x => ({ art: x.art, col: x.col, row: x.row, fmt: x.fmt, url: `${urlPublique}/${m.get(x.art).clePublique}.webp`, largeur: m.get(x.art).largeur, hauteur: m.get(x.art).hauteur }));
}
/** La page 1 d'une publication, sous la forme de la lecture publique : les arts POSÉS (à compléter par liensDesArts) et les pochettes de cartes. Le stockage est celui de pages.js (`pagesBlocs`). */
const premierePage = d => P.versArtsEtCartes((d.pagesBlocs || [])[0] || { nb: d.nb || 9, blocs: [] });
function versPublication(d, arts) {
    const c = compteur(d.nbJaime || 0);
    return { id: d._id, pseudo: d.pseudo, publieLe: iso(d.publieLe), titre: d.titre, categories: d.categories, nb: d.nb, pages: d.pages, jaime: c.valeur, petitCompteur: c.petit, arts, cartes: premierePage(d).cartes };
}
// la lecture de la liste ne ramène que la PAGE 1 de chaque publication (les suivantes se lisent par /pages/{n}) ; le reste du document (auteur, certification, motif, attributs, copie de travail) n'en sort jamais
const PROJ_PUBLIC = { pagesBlocs: { $slice: 1 }, attributs: 0, auteurId: 0, certification: 0, motif: 0, pagesPubliees: 0, etiquettes: 0, couleur: 0, couverture: 0, repriseDe: 0, versionClasseur: 0, remplace: 0 };
const depuisJours = (maintenant, j) => new Date(maintenant.getTime() - j * 86400e3);
/** Le tri « tendances » : les j'aime des 7 derniers jours (lignes de vote datées), sur au plus CAP_TENDANCES candidats ; à égalité, le plus récent d'abord. */
async function ordreTendances(coll, type, filtre, maintenant) {
    const candidats = await G.col(coll).find(filtre, { projection: { _id: 1, publieLe: 1 } }).sort({ publieLe: -1, _id: 1 }).limit(CAP_TENDANCES).toArray();
    if (!candidats.length) return [];
    const ids = candidats.map(c => c._id);
    const nb = new Map((await G.col('votes').aggregate([{ $match: { type, genre: 'jaime', cible: { $in: ids }, le: { $gte: depuisJours(maintenant, JOURS_TENDANCE) } } }, { $group: { _id: '$cible', n: { $sum: 1 } } }]).toArray()).map(r => [r._id, r.n]));
    return candidats.map((c, i) => ({ id: c._id, n: nb.get(c._id) || 0, i })).sort((a, b) => b.n - a.n || a.i - b.i).map(x => x.id);
}
async function page(coll, type, filtre, tri, o, taille, projection, maintenant) {
    let docs;
    if (tri === 'tendances') {
        const ordre = (await ordreTendances(coll, type, filtre, maintenant)).slice(o, o + taille + 1);
        const lus = new Map((await G.col(coll).find({ _id: { $in: ordre } }, { projection }).toArray()).map(d => [d._id, d]));
        docs = ordre.map(i => lus.get(i)).filter(Boolean);
    } else {
        const tri_ = tri === 'top' ? { nbJaime: -1, publieLe: -1, _id: 1 } : { publieLe: -1, _id: 1 };
        docs = await G.col(coll).find(filtre, { projection }).sort(tri_).skip(o).limit(taille + 1).toArray();
    }
    return { docs: docs.slice(0, taille), suite: docs.length > taille ? F.ecrireSuite(o + taille) : null };
}
async function listerPublications({ categorie, tri = 'nouveautes', carte, couleur, type, illustrateur, set, o = 0, urlPublique, maintenant = new Date() }) {
    const filtre = { etat: 'public' };
    if (categorie) filtre.categories = categorie;
    if (carte) filtre[/^-?\d+$/.test(carte) ? 'attributs.carteIds' : 'attributs.carte'] = carte;
    if (couleur) filtre['attributs.couleur'] = couleur;
    if (type) filtre['attributs.type'] = type;
    if (illustrateur) filtre['attributs.illustrateur'] = illustrateur;
    if (set) filtre['attributs.set'] = set;
    const r = await page('publications', 'galerie', filtre, tri, o, PAGE, PROJ_PUBLIC, maintenant);
    const pages = r.docs.map(premierePage);
    const poser = await liensDesArts(pages.map(p => p.arts), urlPublique);
    return { publications: r.docs.map((d, i) => versPublication(d, poser(pages[i].arts))), suite: r.suite };
}
async function filtresDeLaGalerie() {
    const liste = async champ => (await G.col('publications').aggregate([{ $match: { etat: 'public' } }, { $unwind: `$attributs.${champ}` }, { $group: { _id: `$attributs.${champ}`, n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 100 }]).toArray()).map(r => ({ valeur: r._id, n: r.n }));
    const [carte, couleur, type, illustrateur, set] = await Promise.all(['carte', 'couleur', 'type', 'illustrateur', 'set'].map(liste));
    return { carte, couleur, type, illustrateur, set };
}
async function pageDePublication(id, n, urlPublique) {
    const d = await G.col('publications').findOne({ _id: id, etat: 'public' }, { projection: { pagesBlocs: 1, pages: 1 } });
    if (!d || !Number.isInteger(n) || n < 1 || n > d.pages) return null;
    const page = (d.pagesBlocs || [])[n - 1];
    if (!page) return null;
    const { arts, cartes } = P.versArtsEtCartes(page);
    const poser = await liensDesArts([arts], urlPublique);
    return { n, nb: page.nb, arts: poser(arts), cartes };
}

// ═══ lectures publiques : la banque d'art ═══
function versArt(d, urlPublique) {
    const c = compteur(d.nbJaime || 0);
    return { id: d._id, nom: d.nom, fmt: d.fmt, auteur: d.pseudo, aime: c.valeur, petitCompteur: c.petit, url: `${urlPublique}/${d.clePublique}.webp`, largeur: d.largeur, hauteur: d.hauteur };
}
async function listerArts({ format, q, tri = 'nouveautes', o = 0, urlPublique, maintenant = new Date() }) {
    const filtre = { etat: 'public' };
    if (format) filtre.fmt = format;
    if (q) { const f = filtreRecherche(q); if (!f) return { arts: [], suite: null }; Object.assign(filtre, f); }
    const r = await page('arts', 'banque', filtre, tri, o, PAGE_ART, { auteurId: 0, certification: 0, motif: 0, cle: 0, depotId: 0 }, maintenant);
    return { arts: r.docs.map(d => versArt(d, urlPublique)), suite: r.suite };
}
async function formatsDeLaBanque() {
    const out = { '1': 0, '2h': 0, '2v': 0, '4': 0 };
    for (const r of await G.col('arts').aggregate([{ $match: { etat: 'public' } }, { $group: { _id: '$fmt', n: { $sum: 1 } } }]).toArray()) if (Object.hasOwn(out, r._id)) out[r._id] = r.n;
    return out;
}

// ═══ les publications : créées par l'EXPLOITATION (aucune route n'en crée dans cette liste) ═══
/** Pose une publication (page de la galerie). Valide la forme ; l'auteur est un compte qui a un pseudo. Le seul appelant d'aujourd'hui est l'exploitation (et les bancs) : la route de publication d'un classeur est hors de la liste fermée. */
async function publierPourExploitation(p, maintenant = new Date()) {
    const mal = d => { throw new Error(`publication refusée : ${d}`); };
    if (!F.objet(p) || typeof p.auteurId !== 'string' || !p.auteurId) mal('auteurId');
    if (F.problemeTexte(p.titre, { min: 1, max: 80 })) mal('titre');
    if (!Array.isArray(p.categories) || p.categories.some(c => !F.CATEGORIES.includes(c))) mal('categories');
    if (!P.NB.includes(p.nb)) mal('nb');
    if (!Number.isInteger(p.pages) || p.pages < 1 || p.pages > 100) mal('pages');
    const pseudo = await pseudoDe(p.auteurId); if (!pseudo) mal('pseudo-requis');
    const arts = (a, nb) => Array.isArray(a) && a.length <= 16 && a.every(x => F.objet(x) && F.idValide(x.art) && F.FORMATS_ART.includes(x.fmt) && Number.isInteger(x.col) && Number.isInteger(x.row) && x.col >= 0 && x.row >= 0
        && x.col + P.TAILLE_FORMAT[x.fmt][0] <= P.GRILLES[nb][0] && x.row + P.TAILLE_FORMAT[x.fmt][1] <= P.GRILLES[nb][1]);
    const cartes = (c, nb) => Array.isArray(c) && c.length <= nb && c.every(x => x === null || (F.objet(x) && cleValide(x.cle) && !F.problemeTexte(x.nom, { min: 1, max: 80 })));
    if (!arts(p.arts, p.nb) || !cartes(p.cartes, p.nb)) mal('page 1');
    const suite = p.pagesSuite || [];
    // une page suivante peut avoir SA grille (`nb`), à défaut celle de la page 1
    if (suite.length !== p.pages - 1 || suite.some((x, i) => !F.objet(x) || x.n !== i + 2 || !P.NB.includes(x.nb === undefined ? p.nb : x.nb) || !arts(x.arts, x.nb === undefined ? p.nb : x.nb) || !cartes(x.cartes, x.nb === undefined ? p.nb : x.nb))) mal('pages suivantes');
    const etat = p.etat || 'en-attente';
    if (!['en-attente', 'public'].includes(etat)) mal('etat');
    const cites = [...new Set([p.arts, ...suite.map(x => x.arts)].flat().map(x => x.art))];
    if (cites.length && (await G.col('arts').countDocuments({ _id: { $in: cites }, etat: 'public' })) !== cites.length) mal('un art cité n\'existe pas ou n\'est pas public');
    const toutes = [p.cartes, ...suite.map(x => x.cartes)].flat().filter(Boolean).map(x => x.cle);
    const texte = a => (Array.isArray(a) ? [...new Set(a.filter(x => typeof x === 'string' && x && !F.problemeTexte(x, { max: 80 })))].slice(0, 200) : []);
    const attrs = F.objet(p.attributs) ? p.attributs : {};
    const pagesBlocs = [P.depuisArtsEtCartes(p.nb, p.arts, p.cartes), ...suite.map(x => P.depuisArtsEtCartes(x.nb === undefined ? p.nb : x.nb, x.arts, x.cartes))];
    const doc = { _id: F.nouvelId(), auteurId: p.auteurId, pseudo, titre: p.titre.normalize('NFKC'), categories: [...new Set(p.categories)], nb: p.nb, pages: p.pages, pagesBlocs,
        attributs: { carte: [...new Set(toutes)], carteIds: [...new Set(toutes.map(c => c.split('|')[0]))], couleur: texte(attrs.couleur), type: texte(attrs.type), illustrateur: texte(attrs.illustrateur), set: texte(attrs.set) },
        etat, recuLe: maintenant, publieLe: etat === 'public' ? maintenant : null, nbJaime: 0, nbEnregistre: 0, motif: null,
        certification: F.objet(p.certification) ? { cgu: String(p.certification.cgu || '').slice(0, 40), le: maintenant } : null };
    await G.col('publications').insertOne(doc);
    return doc._id;
}

// ═══ les votes ═══
/** { _id, auteurId } de la cible si elle est PUBLIQUE, sinon null (l'appelant répond le même INTROUVABLE). */
const cibleVotable = (type, id) => (F.idValide(id) ? G.col(COLL[type]).findOne({ _id: id, etat: 'public' }, { projection: { auteurId: 1, nbJaime: 1, nbEnregistre: 1 } }) : Promise.resolve(null));
/**
 * Pose ou retire un vote. Rend { introuvable } | { auteur } | { borne } | { actif, nb } — `actif` : l'état APRÈS l'appel ; `nb` : le compteur exact (l'arrondi public est fait par la route).
 * Idempotent : PUT répété = aucun effet (la ligne existe déjà), DELETE d'un vote absent = aucun effet. Le compteur n'est modifié que si une ligne a été créée / supprimée.
 */
async function voter({ compteId, type, genre, id, poser, max, maintenant = new Date() }) {
    const cible = await cibleVotable(type, id);
    if (!cible) return { introuvable: true };
    if (cible.auteurId === String(compteId)) return { auteur: true };
    const champ = CHAMP[genre], filtre = { compte: String(compteId), genre, type, cible: id }, coll = G.col(COLL[type]);
    if (poser) {
        if (!(await G.col('votes').findOne(filtre, { projection: { _id: 1 } }))) {
            if ((await G.col('votes').countDocuments({ compte: String(compteId), genre }, { limit: max })) >= max) return { borne: max };
            try { await G.col('votes').insertOne({ ...filtre, le: maintenant }); await coll.updateOne({ _id: id }, { $inc: { [champ]: 1 } }); }
            catch (e) { if (!estDup(e)) throw e; }                       // un PUT simultané a déjà posé la ligne : aucun effet de plus
        }
    } else if ((await G.col('votes').deleteOne(filtre)).deletedCount === 1) await coll.updateOne({ _id: id, [champ]: { $gt: 0 } }, { $inc: { [champ]: -1 } });
    const apres = await coll.findOne({ _id: id }, { projection: { [champ]: 1 } });
    return { actif: poser, nb: apres ? apres[champ] || 0 : 0 };
}
/** Passage d'EXPLOITATION : recalcule les deux compteurs de chaque cible depuis les lignes de vote (une écriture interrompue entre la ligne et le compteur ne dérive pas pour toujours). Rend le nombre de cibles corrigées. */
async function recompterVotes() {
    let corriges = 0;
    for (const [type, coll] of Object.entries(COLL)) {
        const reel = new Map();
        for (const r of await G.col('votes').aggregate([{ $match: { type } }, { $group: { _id: { cible: '$cible', genre: '$genre' }, n: { $sum: 1 } } }]).toArray()) reel.set(`${r._id.cible}|${r._id.genre}`, r.n);
        for await (const d of G.col(coll).find({}, { projection: { nbJaime: 1, nbEnregistre: 1 } })) {
            const j = reel.get(`${d._id}|jaime`) || 0, e = reel.get(`${d._id}|enregistre`) || 0;
            if ((d.nbJaime || 0) !== j || (d.nbEnregistre || 0) !== e) { await G.col(coll).updateOne({ _id: d._id }, { $set: { nbJaime: j, nbEnregistre: e } }); corriges++; }
        }
    }
    return corriges;
}
/** Les identifiants que le compte a aimés / enregistrés, les plus récents d'abord, 2 000 au plus de chaque. */
async function mesVotes(compteId, max = 2000) {
    const lire = async (genre, type) => (await G.col('votes').find({ compte: String(compteId), genre, type }, { projection: { cible: 1 } }).sort({ le: -1 }).limit(max).toArray()).map(v => v.cible);
    const [classeurs, illustrations, jc, ji] = await Promise.all([lire('enregistre', 'galerie'), lire('enregistre', 'banque'), lire('jaime', 'galerie'), lire('jaime', 'banque')]);
    return { classeurs, illustrations, jaime: { classeurs: jc, illustrations: ji } };
}

// ═══ la reprise (remix) ═══
/**
 * Copie la page publique dans un NOUVEAU classeur privé du compte (même forme que les classeurs de l'Atelier) : la structure et les arts, les cartes VIDES (`contenu: null`).
 * Un art qui n'est plus public n'est pas copié (la zone se lit vide). { introuvable } | { borne } | { classeurId }.
 */
async function remixer({ compteId, id, max, maintenant = new Date() }) {
    const source = F.idValide(id) ? await G.col('publications').findOne({ _id: id, etat: 'public', pagesBlocs: { $exists: true } }) : null;
    if (!source) return { introuvable: true };
    const mien = String(compteId);
    if ((await G.col('classeurs').countDocuments({ auteurId: mien }, { limit: max })) >= max) return { borne: max };
    const cites = P.artsCites(source.pagesBlocs);
    const publics = new Set(cites.length ? (await G.col('arts').find({ _id: { $in: cites }, etat: 'public' }, { projection: { _id: 1 } }).toArray()).map(a => a._id) : []);
    const pages = source.pagesBlocs.map(p => ({ nb: p.nb, blocs: p.blocs.map(b => (b.genre === 'carte' ? { ...b, contenu: null } : (b.contenu && publics.has(b.contenu.artId) ? b : { ...b, contenu: null }))) }));
    const classeur = { _id: F.nouvelId(), auteurId: mien, titre: `Remix de ${source.titre}`.slice(0, 80), etiquettes: [], couleur: null, couverture: null, pages, repriseDe: { id: source._id, pseudo: source.pseudo }, version: 1, creeLe: maintenant, majLe: maintenant };
    await G.col('classeurs').insertOne(classeur);
    return { classeurId: classeur._id };
}

// ═══ les signalements ═══
/** Enregistre un signalement si la cible existe et est publique ; sinon ne fait RIEN (la route répond pareil dans les deux cas). Un compte ne signale une cible qu'une fois (index unique partiel). Aucune adresse IP n'est écrite. */
async function signaler({ compteId = null, cibleType, cibleId, motif, precision = null, maintenant = new Date() }) {
    const cible = await G.col(COLL[cibleType]).findOne({ _id: cibleId, etat: 'public' }, { projection: { _id: 1 } });
    if (!cible) return { enregistre: false };
    const doc = { _id: F.nouvelId(), cibleType, cibleId, motif, precision, compteId: compteId === null ? null : String(compteId), le: maintenant, echeance: new Date(maintenant.getTime() + 24 * 3600e3), etat: 'ouvert', conserveJusqua: new Date(maintenant.getTime() + 366 * 86400e3) };
    try { await G.col('signalements').insertOne(doc); } catch (e) { if (!estDup(e)) throw e; return { enregistre: false }; }
    return { enregistre: true };
}

// ═══ la modération ═══
const TAILLE_FILE = 50;
async function elementPublication(d, secret) {
    return { id: `pub.${d._id}`, file: 'publications', genre: 'classeur', cible: { id: d._id, titre: d.titre, apercu: P.cartesDans(d.pagesBlocs || []).slice(0, 9).map(c => c.cle) },
        auteur: { pseudo: d.pseudo, ref: refCompte(d.auteurId, secret) }, certification: d.certification ? { cgu: d.certification.cgu, le: iso(d.certification.le) } : null, signalements: [], recuLe: iso(d.recuLe), echeance: null };
}
async function elementArt(d, secret, stockage) {
    const lien = cle => { try { return stockage ? stockage.presignerLecture({ cle, expire: 3600 }) : undefined; } catch { return undefined; } };
    const cible = { id: d._id, titre: d.nom, apercu: [], image: lien(`${d.cle}.webp`), vignette: lien(`${d.cle}-480.webp`) };
    for (const k of ['image', 'vignette']) if (cible[k] === undefined) delete cible[k];
    return { id: `art.${d._id}`, file: 'publications', genre: 'illustration', cible, auteur: { pseudo: d.pseudo, ref: refCompte(d.auteurId, secret) },
        certification: d.certification ? { cgu: d.certification.cgu || 'droits+non-officielle', le: iso(d.certification.le) } : null, signalements: [], recuLe: iso(d.recuLe), echeance: null };
}
async function elementSignalement(s, secret, stockage) {
    const coll = COLL[s.cibleType], d = await G.col(coll).findOne({ _id: s.cibleId });
    const cible = d ? (s.cibleType === 'banque' ? (await elementArt(d, secret, stockage)).cible : (await elementPublication(d, secret)).cible) : { id: s.cibleId, titre: null, apercu: [] };
    return { id: `sig.${s._id}`, file: 'signalements', genre: s.cibleType === 'banque' ? 'illustration' : 'classeur', cible,
        auteur: d ? { pseudo: d.pseudo, ref: refCompte(d.auteurId, secret) } : { pseudo: null, ref: null }, certification: null,
        signalements: [{ motif: s.motif, precision: s.precision, le: iso(s.le) }], recuLe: iso(s.le), echeance: iso(s.echeance) };
}
/** La file : les plus anciens d'abord. `publications` = publications et arts EN ATTENTE ; `signalements` = signalements ouverts. */
async function fileModeration({ file, o = 0, secret, stockage = null }) {
    let elements;
    if (file === 'signalements') {
        const l = await G.col('signalements').find({ etat: 'ouvert' }).sort({ le: 1, _id: 1 }).skip(o).limit(TAILLE_FILE + 1).toArray();
        elements = await Promise.all(l.map(s => elementSignalement(s, secret, stockage)));
    } else {
        const [p, a] = await Promise.all([G.col('publications').find({ etat: 'en-attente' }).sort({ recuLe: 1, _id: 1 }).limit(o + TAILLE_FILE + 1).toArray(), G.col('arts').find({ etat: 'en-attente' }).sort({ recuLe: 1, _id: 1 }).limit(o + TAILLE_FILE + 1).toArray()]);
        const tous = [...p.map(d => ({ d, art: false })), ...a.map(d => ({ d, art: true }))].sort((x, y) => x.d.recuLe - y.d.recuLe || (x.d._id < y.d._id ? -1 : 1)).slice(o, o + TAILLE_FILE + 1);
        elements = await Promise.all(tous.map(x => (x.art ? elementArt(x.d, secret, stockage) : elementPublication(x.d, secret))));
    }
    return { elements: elements.slice(0, TAILLE_FILE), suite: elements.length > TAILLE_FILE ? F.ecrireSuite(o + TAILLE_FILE) : null };
}

/**
 * Applique UNE décision. Le journal (qui, quand, quoi, motif) est écrit AVANT l'effet, puis le résultat en dessous : une décision n'a jamais d'effet sans trace.
 * Rend { introuvable } | { auteur } | { conflit } | { invalide } | { indispo } | { ok:true }.
 * accepter : la copie publique de l'image est faite AVANT le passage à « public » (la copie échoue : la publication reste « en-attente », jamais « public » sans fichier).
 * Un modérateur ne décide jamais sur sa propre création (pas-l-auteur).
 */
async function decider({ id, decision, motif = null, precision = null, moderateur, stockage, secret, maintenant = new Date() }) {
    const m = F.RE_ID_MODERATION.exec(id);
    if (!m) return { introuvable: true };
    const [, genre, brut] = m, qui = String(moderateur.compteId);
    const trace = async (extra) => G.col('journal_moderation').insertOne({ _id: F.nouvelId(), quand: maintenant, qui: refCompte(qui, secret), droit: moderateur.droit, decision, element: genre, id: brut, motif, precision, conserveJusqua: new Date(maintenant.getTime() + 366 * 86400e3), ...extra });
    const resultat = (r) => G.col('journal_moderation').insertOne({ _id: F.nouvelId(), quand: new Date(), resultat: r, decision, element: genre, id: brut, conserveJusqua: new Date(maintenant.getTime() + 366 * 86400e3) });
    const note = decision === 'accepter' ? null : { code: motif, texte: precision || '' };
    if (genre === 'sig') {
        const s = await G.col('signalements').findOne({ _id: brut });
        if (!s) return { introuvable: true };
        if (!['retirer', 'classer'].includes(decision)) return { invalide: true };
        if (s.etat !== 'ouvert') return { conflit: true };
        const cible = await G.col(COLL[s.cibleType]).findOne({ _id: s.cibleId });
        if (decision === 'retirer' && cible && cible.auteurId === qui) return { auteur: true };
        await trace({ cible: { type: s.cibleType, id: s.cibleId } });
        if (decision === 'retirer' && cible && cible.etat === 'public') {
            const r = await G.col(COLL[s.cibleType]).updateOne({ _id: cible._id, etat: 'public' }, { $set: { etat: 'retire', motif: note, retireLe: maintenant } });
            if (r.modifiedCount === 1 && s.cibleType === 'banque') await purgerCopies(stockage, cible, 'retrait');
        }
        await G.col('signalements').updateMany({ cibleType: s.cibleType, cibleId: s.cibleId, etat: 'ouvert', ...(decision === 'classer' ? { _id: s._id } : {}) }, { $set: { etat: decision === 'classer' ? 'classe' : 'traite', decideLe: maintenant } });
        await resultat('applique');
        return { ok: true };
    }
    const type = genre === 'art' ? 'banque' : 'galerie', coll = G.col(COLL[type]);
    const d = await coll.findOne({ _id: brut });
    if (!d) return { introuvable: true };
    if (decision === 'classer') return { invalide: true };
    if (d.auteurId === qui) return { auteur: true };
    const attendu = decision === 'retirer' ? 'public' : 'en-attente';
    if (d.etat !== attendu) return { conflit: true };
    await trace({ cible: { type, id: brut } });
    if (d.remplace) {
        // une MISE À JOUR d'un classeur déjà public : accepter la met à la place de la version publique (même identifiant : les votes restent) ; refuser la garde pour l'auteur, avec le motif, et la version publique reste servie
        if (decision === 'accepter') {
            const cible = await coll.findOne({ _id: d.remplace, etat: 'public' }, { projection: { _id: 1 } });
            if (!cible) { await resultat('conflit'); return { conflit: true };}       // la version publique a été retirée ou dépubliée entre-temps
            const champs = Object.fromEntries(CHAMPS_INSTANTANE.filter(k => d[k] !== undefined).map(k => [k, d[k]]));
            const r = await coll.updateOne({ _id: d.remplace, etat: 'public' }, { $set: { ...champs, motif: null } });
            if (r.modifiedCount !== 1) { await resultat('conflit'); return { conflit: true }; }
            await coll.deleteOne({ _id: brut, etat: 'en-attente' });
        } else {
            const r = await coll.updateOne({ _id: brut, etat: 'en-attente' }, { $set: { etat: 'refuse', motif: note } });
            if (r.modifiedCount !== 1) { await resultat('conflit'); return { conflit: true }; }
        }
        await resultat('applique');
        return { ok: true };
    }
    if (decision === 'accepter') {
        const copies = [];
        if (type === 'banque') {
            try { for (const s of ['.webp', '-480.webp']) { await stockage.copier(`${d.cle}${s}`, `${d.clePublique}${s}`); copies.push(s); } }
            catch (e) { console.error(`❌ [galerie] copie publique en échec (${(e && (e.name || e.code)) || 'erreur'}) : la publication reste en attente`); await resultat('echec-copie'); return { indispo: true }; }
        }
        const r = await coll.updateOne({ _id: brut, etat: 'en-attente' }, { $set: { etat: 'public', publieLe: maintenant, motif: null } });
        if (r.modifiedCount !== 1) { if (type === 'banque') await purgerCopies(stockage, d, 'conflit-acceptation'); await resultat('conflit'); return { conflit: true }; }
        if (type === 'banque') await purgerAttente(stockage, d, 'acceptation');      // la copie publique suffit : l'objet d'attente ne reste pas lisible
    } else {
        const r = await coll.updateOne({ _id: brut, etat: attendu }, { $set: { etat: decision === 'refuser' ? 'refuse' : 'retire', motif: note, ...(decision === 'retirer' ? { retireLe: maintenant } : {}) } });
        if (r.modifiedCount !== 1) { await resultat('conflit'); return { conflit: true }; }
        if (decision === 'refuser' && type === 'banque') await purgerAttente(stockage, d, 'refus');
        if (decision === 'retirer' && type === 'banque') await purgerCopies(stockage, d, 'retrait');
    }
    await resultat('applique');
    return { ok: true };
}

// ═══ la suppression d'un compte ═══
/** Tout ce que la Communauté garde d'un compte part avec lui : profil (pseudo), votes, arts (et leurs objets R2), dépôts ouverts, classeurs, publications ; ses signalements sont ANONYMISÉS (ils restent dans la file). Rend un décompte. */
async function supprimerDuCompte(compteId, stockage = null, secret = null) {
    const id = String(compteId), n = {}, bilan = { enFile: 0 };
    // Une suppression R2 qui échoue n'est JAMAIS avalée : la clé entre dans la file de reprise (purges_r2), rejouée par le balayeur. Les dépôts expirés (sans document) se retrouvent par le PRÉFIXE du compte.
    for (const a of await G.col('arts').find({ auteurId: id }, { projection: { cle: 1, clePublique: 1 } }).toArray()) for (const k of [...clesDe(a.cle), ...clesDe(a.clePublique)]) await supprimerOuFile(stockage, k, 'compte', bilan);
    for (const d of await G.col('depots').find({ compteId: id }, { projection: { cle: 1 } }).toArray()) await supprimerOuFile(stockage, d.cle, 'compte', bilan);
    if (stockage && secret) {
        const prefixe = `galerie/depot/${refCompte(id, secret)}/`;
        let apres = null;
        do { const l = await stockage.lister(prefixe, { apres, max: 500 }); for (const o of l.objets) await supprimerOuFile(stockage, o.cle, 'compte', bilan); apres = l.suivant; } while (apres);
    }
    // les compteurs des cibles votées redescendent (un vote effacé ne reste pas compté)
    for (const v of await G.col('votes').find({ compte: id }, { projection: { genre: 1, type: 1, cible: 1 } }).limit(20000).toArray()) await G.col(COLL[v.type]).updateOne({ _id: v.cible, [CHAMP[v.genre]]: { $gt: 0 } }, { $inc: { [CHAMP[v.genre]]: -1 } });
    n.votes = (await G.col('votes').deleteMany({ compte: id })).deletedCount;
    n.arts = (await G.col('arts').deleteMany({ auteurId: id })).deletedCount;
    n.depots = (await G.col('depots').deleteMany({ compteId: id })).deletedCount;
    n.classeurs = (await G.col('classeurs').deleteMany({ auteurId: id })).deletedCount;
    n.publications = (await G.col('publications').deleteMany({ auteurId: id })).deletedCount;
    n.signalements = (await G.col('signalements').updateMany({ compteId: id }, { $set: { compteId: null } })).modifiedCount;
    n.profil = (await G.col('profils').deleteOne({ _id: id })).deletedCount;
    n.purgesEnFile = bilan.enFile;
    return n;
}

module.exports = { PAGE, PAGE_ART, SEUIL_PETIT, motsDe, filtreRecherche, mettreEnFile, supprimerOuFile, clesDe, jetonNeuf, refCompte, compteur, pseudoDe, poserPseudo, listerPublications, filtresDeLaGalerie, pageDePublication, versPublication, listerArts, formatsDeLaBanque, versArt,
    publierPourExploitation, voter, recompterVotes, mesVotes, remixer, signaler, fileModeration, decider, supprimerDuCompte, COLL };
