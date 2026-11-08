'use strict';
// GALERIE — le dépôt d'un art, EN DEUX TEMPS. Le fichier ne passe JAMAIS par l'API :
//   1. `ouvrirDepot` : refus avant tout (type, taille, borne), puis une URL R2 PRÉSIGNÉE en PUT (5 minutes, une seule clé `galerie/depot/<ref>/<depotId>`, `Content-Type` et `Content-Length` SIGNÉS) ;
//   2. `finaliser` : l'API relit l'objet DEPUIS R2 (jamais depuis le client), vérifie la taille réelle, lit le type à la SIGNATURE D'OCTETS, refuse l'animé, le trop grand, l'illisible, recompresse (images.js),
//      écrit `galerie/attente/<id>.webp` et `-480.webp`, SUPPRIME l'objet brut (dans tous les cas, refus compris), et rend l'art « en-attente ». Idempotent par `depotId`.
// Aucun octet d'image n'entre en base : le document garde la clé, les dimensions, la couleur.
const G = require('./base');
const F = require('./forme');
const I = require('./images');
const svc = require('./service');

const EXPIRE_S = 300, GRACE_FINALISATION_MS = 15 * 60e3, PURGE_MS = 24 * 3600e3;

const refus = (statut, code, detail, extra = {}) => ({ refus: { statut, code, detail, ...extra } });
const refusFichier = (detail) => refus({ 'trop-lourde': 413, format: 415 }[detail] || 422, 'FICHIER', detail);

/** Les arts de l'auteur qui comptent contre la borne : tout sauf ce qui a été retiré/refusé et effacé, plus les dépôts encore ouverts. */
async function enStock(compteId) {
    const [a, d] = await Promise.all([G.col('arts').countDocuments({ auteurId: compteId }), G.col('depots').countDocuments({ compteId, etat: { $in: ['ouvert', 'en-cours'] }, purgeLe: { $gt: new Date() } })]);
    return a + d;
}

async function ouvrirDepot({ compteId, ref, type, octets, bornes, stockage, maintenant = new Date() }) {
    if (!F.TYPES_IMAGE.includes(type)) return refusFichier('format');
    if (!Number.isInteger(octets) || octets < 1) return refus(400, 'ENTREE', 'octets');
    if (octets > bornes.octetsMax) return refusFichier('trop-lourde');
    const mien = String(compteId);
    if ((await enStock(mien)) >= bornes.illustrationsMax) return refus(409, 'CONFLIT', 'borne-illustrations');
    const depotId = F.nouvelId(), cle = `galerie/depot/${ref}/${depotId}`;
    const urlDepot = stockage.presignerDepot({ cle, type, octets, expire: EXPIRE_S });
    await G.col('depots').insertOne({ _id: depotId, compteId: mien, cle, type, octets, etat: 'ouvert', creeLe: maintenant, finaliseAvant: new Date(maintenant.getTime() + GRACE_FINALISATION_MS), purgeLe: new Date(maintenant.getTime() + PURGE_MS), artId: null });
    // TOUR 1 (M1) : la borne n'est pas atomique (deux dépôts simultanés passent le premier contrôle) : réservation (le document ci-dessus), puis CONTRÔLE A POSTERIORI avec annulation.
    // Chaque requête compte tout ce qui existe, la sienne comprise : la dernière arrivée voit toutes les autres et s'annule ; deux arrivées exactement simultanées s'annulent toutes les deux (jamais plus que la borne).
    if ((await enStock(mien)) > bornes.illustrationsMax) { await G.col('depots').deleteOne({ _id: depotId }); return refus(409, 'CONFLIT', 'borne-illustrations'); }
    return { ok: { depotId, urlDepot, expireDans: EXPIRE_S } };
}

/** Le corps du temps 2, validé. { nom, format } | { detail }. Les DEUX certifications sont exigées (`true` exactement). */
function lireCorpsFinalisation(b) {
    if (!F.objet(b) || !F.cles(b, ['nom', 'format', 'certifieDroits', 'certifieNonOfficielle'])) return { detail: 'corps' };
    const p = F.problemeTexte(b.nom, { min: 1, max: 80 });
    if (p) return { detail: p === 'donnee-binaire' ? 'donnee-binaire' : 'nom' };
    if (!F.FORMATS_ART.includes(b.format)) return { detail: 'format' };
    if (b.certifieDroits !== true || b.certifieNonOfficielle !== true) return { detail: 'certification' };
    return { nom: b.nom.normalize('NFKC').trim(), format: b.format };
}

// l'objet brut qui ne part pas entre dans la file de reprise (purges_r2) : le balayeur le retire ; la règle de cycle de vie R2 n'est qu'un filet
async function supprimerBrut(stockage, cle) { await svc.supprimerOuFile(stockage, cle, 'depot'); }

async function finaliser({ compteId, pseudo, depotId, corps, bornes, stockage, maintenant = new Date() }) {
    const mien = String(compteId);
    const l = lireCorpsFinalisation(corps);
    if (l.detail) return refus(400, 'ENTREE', l.detail);
    if (!F.idValide(depotId)) return { introuvable: true };
    const depot = await G.col('depots').findOne({ _id: depotId, compteId: mien });
    if (!depot) return { introuvable: true };                                                // le dépôt d'un autre compte répond pareil que l'absent
    if (depot.etat === 'finalise') return { ok: { id: depot.artId, statut: 'en-attente' } };   // rejouée : la même illustration
    if (depot.etat === 'en-cours') {
        // une instance arrêtée en pleine finalisation laisse le dépôt « en-cours » : au-delà de 5 minutes il est REPRIS (sinon tout rejeu répondrait 503 jusqu'à la purge)
        if (!(depot.priseLe && depot.priseLe < new Date(maintenant.getTime() - 5 * 60e3))) return refus(503, 'INDISPONIBLE', 'finalisation-en-cours', { reessayerDans: 3 });
        await G.col('depots').updateOne({ _id: depotId, etat: 'en-cours', priseLe: depot.priseLe }, { $set: { etat: 'ouvert' } });
        depot.etat = 'ouvert';
    }
    if (depot.etat !== 'ouvert' || depot.finaliseAvant <= maintenant) return { introuvable: true };
    // la prise est atomique : un seul appel finalise ce dépôt
    const pris = await G.col('depots').findOneAndUpdate({ _id: depotId, compteId: mien, etat: 'ouvert' }, { $set: { etat: 'en-cours', priseLe: maintenant } }, { returnDocument: 'after' });
    if (!pris) return refus(503, 'INDISPONIBLE', 'finalisation-en-cours', { reessayerDans: 3 });
    const clore = async (etat, plus = {}) => { await G.col('depots').updateOne({ _id: depotId }, { $set: { etat, ...plus } }); };
    const echec = async (detail) => { await supprimerBrut(stockage, depot.cle); await clore('refuse', { motif: detail }); return refusFichier(detail); };
    let tete;
    try { tete = await stockage.tete(depot.cle); } catch (e) { await clore('ouvert'); throw e; }
    if (!tete) { await clore('ouvert'); return refusFichier('illisible'); }                // le fichier n'a pas été envoyé : le dépôt reste ouvert (R2 n'a rien reçu)
    if (tete.octets > bornes.octetsMax || tete.octets > depot.octets) return echec('trop-lourde');
    if (tete.octets !== depot.octets) return echec('illisible');                              // la taille déclarée est signée : un octet de différence n'est pas le fichier annoncé
    // les art ne sont pas recomprimés en parallèle : une seule à la fois par instance (la mémoire du service)
    const r = await I.sousVerrou(async () => {
        let brut;
        try { brut = await stockage.lire(depot.cle, bornes.octetsMax); }
        catch (e) { if (e && e.code === 'TROP_LOURD') throw new I.RefusFichier('trop-lourde', 413); throw e; }
        return I.traiter(brut, { pixelsMax: bornes.pixelsMax, octetsMax: bornes.octetsMax, declare: depot.type });
    }).catch(e => ({ erreur: e }));
    if (r.occupe) { await clore('ouvert'); return refus(503, 'INDISPONIBLE', 'traitement-occupe', { reessayerDans: 5 }); }
    if (r.erreur) {
        if (r.erreur instanceof I.RefusFichier) return echec(r.erreur.detail);
        await clore('ouvert'); throw r.erreur;
    }
    const t = r.valeur;
    const rapport = t.largeur / t.hauteur, attendu = F.RAPPORT_FORMAT[l.format];
    if (Math.abs(rapport - attendu) / attendu > F.TOLERANCE_RAPPORT) { await supprimerBrut(stockage, depot.cle); await clore('refuse', { motif: 'rapport' }); return refus(400, 'ENTREE', 'rapport-format'); }
    const artId = F.nouvelId(), cle = `galerie/attente/${artId}`, clePublique = `galerie/pub/${artId}`;
    try {
        await stockage.ecrire(`${cle}.webp`, t.image, 'image/webp');
        await stockage.ecrire(`${cle}-480.webp`, t.vignette, 'image/webp');
    } catch (e) {
        for (const s of ['.webp', '-480.webp']) { try { await stockage.supprimer(`${cle}${s}`); } catch { /* le cycle de vie ne couvre pas attente/ : reprise à la main */ } }
        await clore('ouvert'); throw e;
    }
    try {
        await G.col('arts').insertOne({ _id: artId, auteurId: mien, pseudo, nom: l.nom, mots: svc.motsDe(l.nom, pseudo), fmt: l.format, largeur: t.largeur, hauteur: t.hauteur, couleur: t.couleur, poids: t.image.length, cle, clePublique, etat: 'en-attente', recuLe: maintenant, creeLe: maintenant, publieLe: null,
            nbJaime: 0, nbEnregistre: 0, motif: null, certification: { droits: true, nonOfficielle: true, le: maintenant }, depotId, artisteDeclare: pseudo, ambiances: [], formats: [] });
    } catch (e) {
        // TOUR 1 (M4) : l'index unique `un_art_par_depot` : une finalisation déjà passée (reprise, rejeu) a posé l'art — on rend CET art, et les objets de cette tentative partent
        if (!e || e.code !== 11000) throw e;
        for (const s of ['.webp', '-480.webp']) await svc.supprimerOuFile(stockage, `${cle}${s}`, 'finalisation-doublon');
        const existant = await G.col('arts').findOne({ depotId, auteurId: mien }, { projection: { _id: 1 } });
        if (!existant) throw e;
        await supprimerBrut(stockage, depot.cle); await clore('finalise', { artId: existant._id });
        return { ok: { id: existant._id, statut: 'en-attente' } };
    }
    await supprimerBrut(stockage, depot.cle);                                                 // l'octet reçu n'est jamais gardé
    await clore('finalise', { artId });
    return { ok: { id: artId, statut: 'en-attente' } };
}

module.exports = { EXPIRE_S, ouvrirDepot, finaliser, lireCorpsFinalisation, enStock };
