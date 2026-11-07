'use strict';
// BANC-200 — les SEAUX du banc de l'administrateur : un seau (« juge » ou « entraînement ») est DÉCLARÉ avant le scan, horodaté, IMMUABLE ; chaque scan rangé dedans porte l'identifiant du seau EN COURS, posé par ce module au moment
// où la première photo du scan arrive (jamais reconstruit après coup, CLAUDE.md §4) ; la vérité se saisit À L'AVEUGLE (la trace des candidats vus est écrite par le serveur, jamais déclarée par le client).
// Écrit par ce qu'il AUTORISE :
//   · un seau ne naît que par `declarer` (un seul ouvert à la fois, un seul JUGE jamais, une chaîne linéaire : l'empreinte du seau porte celle du précédent) et ne change qu'UNE fois, par `sceller` (ouvert → scellé) ;
//   · un scan n'entre dans le seau EN COURS que s'il est de CE porteur, né APRÈS la déclaration du seau et il y a moins de 15 minutes (SCAN_FRAIS_MS) — un scan plus vieux ne se rattache pas après coup ;
//   · la ligne d'un scan est une maille d'une chaîne (empreinte = sha256 de la maille précédente et de ses propres champs) ; les photos sont des documents distincts, EN OCTETS D'ORIGINE (aucun réencodage), nommés par leur sha256 ;
//     le scellé fige la liste (tête de chaîne) et l'empreinte de toutes les photos ;
//   · la vérité n'est jamais rattachée qu'à une ligne qui existe déjà (§14) ; « candidat » n'est admis que pour un identifiant que le serveur a MONTRÉ.
// Les objets (photos, mesures du client) vivent dans le bucket privé V2_BANC_BUCKET sous `banc-seau/` (stockage.js) : ni la purge du banc réel ni le filet des orphelins n'y touchent. Rien ne se purge seul.
// Aucune URL d'annonce n'est stockée : le client envoie au plus l'EMPREINTE (sha256) de l'adresse, pour repérer les doublons (§5) et les fuites du juge vers l'entraînement.
const crypto = require('crypto');
const mongoose = require('mongoose');
const db = require('../db');
const S = require('./stockage');

const FORME_ID = /^[0-9a-f]{24}$/i, FORME_SEAU = /^[0-9a-f]{16}$/, FORME_NOM = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, FORME_SHA = /^[0-9a-f]{64}$/;
const TYPES = Object.freeze(['juge', 'entrainement']);
const CIBLE_JUGE = 200, CIBLE_MAX = 500, NOTE_MAX = 200, PHOTOS_MAX = 8, MESURES_OCTETS_MAX = 512 * 1024;
const SCAN_FRAIS_MS = 15 * 60e3;
const AUCUNE = Object.freeze(['pas-une-carte', 'hors-catalogue']);
const VIA = Object.freeze(['url', 'idProduct', 'candidat', 'candidat5', 'manuel']);       // `manuel` : « pas une carte » / « hors catalogue » (aucun idProduct n'a été désigné) ; `candidat5` : un clic sur l'un des 5 candidats MÉLANGÉS
// JUGE RAPIDE : le mode de la page, enregistré par le serveur sur CHAQUE vérité ; `candidats-5` n'existe que si les 5 candidats ont été servis pour ce scan (sinon refus)
const MODES = Object.freeze(['candidats-5', 'saisie']);
const NB_CINQ = 5;
/** Fisher-Yates avec crypto.randomInt : aucune place ne ressort plus qu'une autre. Injectable (`melanger`) pour que les bancs fixent une graine. */
const melangerAlea = liste => { const a = liste.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const GENESE = '0'.repeat(64);
const EXT = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const MOTIF_MIN = 5, MOTIF_MAX = 200;
const cibleParDefaut = type => (type === 'juge' ? CIBLE_JUGE : CIBLE_MAX);
const COLLECTIONS = Object.freeze({ seaux: 'banc_seaux', scans: 'banc_seau_scans', photos: 'banc_seau_photos', vues: 'banc_seau_vues', verites: 'banc_seau_verites', mesures: 'banc_seau_mesures', errata: 'banc_seau_errata' });

// Les index qui GARANTISSENT les propriétés (un seul ouvert, un seul juge, une chaîne linéaire, un rang une fois) : créés à la première utilisation (createIndex est idempotent) ET listés dans modeles.js (INDEX_SEAU).
const I = (c, nom, cle, opts = {}) => ({ c, nom, cle, opts: { name: nom, ...opts } });
const INDEX_SEAU = Object.freeze([
    I(COLLECTIONS.seaux, 'banc_seaux_nom', { nom: 1 }, { unique: true }),
    I(COLLECTIONS.seaux, 'banc_seaux_un_ouvert', { etat: 1 }, { unique: true, partialFilterExpression: { etat: 'ouvert' } }),
    I(COLLECTIONS.seaux, 'banc_seaux_un_juge', { type: 1 }, { unique: true, partialFilterExpression: { type: 'juge' } }),
    I(COLLECTIONS.seaux, 'banc_seaux_prec', { prec: 1 }, { unique: true }),
    I(COLLECTIONS.scans, 'banc_seau_scans_rang', { seauId: 1, rang: 1 }, { unique: true }),
    I(COLLECTIONS.scans, 'banc_seau_scans_scan', { scanId: 1 }, { unique: true }),
    I(COLLECTIONS.scans, 'banc_seau_scans_annonce', { annonce: 1 }, { partialFilterExpression: { annonce: { $type: 'string' } } }),
    I(COLLECTIONS.photos, 'banc_seau_photos_seau', { seauId: 1, scanId: 1 }), I(COLLECTIONS.photos, 'banc_seau_photos_sha', { sha256: 1 }),
    I(COLLECTIONS.vues, 'banc_seau_vues_scan', { scanId: 1, carte: 1 }),
    I(COLLECTIONS.verites, 'banc_seau_verites_seau', { seauId: 1, scanId: 1 }),
    I(COLLECTIONS.errata, 'banc_seau_errata_n', { seauId: 1, n: 1 }, { unique: true }), I(COLLECTIONS.errata, 'banc_seau_errata_scan', { scanId: 1 })
]);

const erreur = (code, detail, statut) => Object.assign(new Error(detail || code), { code, detail, statut });
const canon = o => JSON.stringify(Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {}));
const hacher = o => crypto.createHash('sha256').update(canon(o)).digest('hex');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const iso = d => new Date(d).toISOString();
const oid = id => new mongoose.Types.ObjectId(String(id));
const idOk = n => Number.isSafeInteger(n) && n > 0;

// ── les mailles (UNE définition, partagée par l'écriture et la vérification)
const empreinteSeau = s => hacher({ prec: s.prec, id: s._id, nom: s.nom, type: s.type, cible: s.cible, note: s.note ?? null, declareLe: iso(s.declareLe), declarePar: s.declarePar });
const empreinteLigne = l => hacher({ prec: l.prec, seauId: l.seauId, rang: l.rang, scanId: l.scanId, posteLe: iso(l.posteLe), scanCreeLe: iso(l.scanCreeLe), annonce: l.annonce ?? null });
const empreintePhotos = photos => sha256(photos.map(p => `${p.scanId}:${p.index}:${p.sha256}`).sort().join('\n'));
// le scellé couvre aussi les VÉRITÉS du juge (veritesEmpreinte) : `undefined` pour un seau qui n'en porte pas (l'empreinte ne change pas pour un seau non juge)
const empreinteScellee = s => hacher({ seauEmpreinte: s.empreinte, tete: s.tete, n: s.n, photosEmpreinte: s.photosEmpreinte, scelleLe: iso(s.scelleLe), ...(s.veritesEmpreinte ? { veritesEmpreinte: s.veritesEmpreinte } : {}) });
const empreinteVerites = verites => sha256(verites.map(v => `${v.scanId}:${v.carte}:${v.idProduct ?? ''}|${v.aucune ?? ''}:${v.rev}`).sort().join('\n'));
const valeurDe = v => ({ idProduct: v.idProduct ?? null, aucune: v.aucune ?? null });
// un erratum est une maille d'une SECONDE chaîne, accrochée à l'empreinte du scellé : il garde l'ancienne valeur, la nouvelle, la date et le motif
const empreinteErratum = e => hacher({ prec: e.prec, seauId: e.seauId, n: e.n, scanId: e.scanId, carte: e.carte, ancien: canon(valeurDe(e.ancien)), nouveau: canon(valeurDe(e.nouveau)), via: e.via, motif: e.motif, le: iso(e.le) });

/**
 * Relit la chaîne d'un seau SANS rien supposer : empreinte du seau, lien au seau précédent, chaque maille (rang contigu, lien, empreinte), puis — si scellé — tête, effectif, photos, scellé ; pour un juge scellé, aussi les vérités et la
 * chaîne des errata. `ancre` (fonction seauId → fichier d'ancre | null) compare la tête à l'ancre versionnée HORS de la base ; `stockage` + `relireR2` relit chaque objet du bucket et recalcule son sha256.
 * 🔑 Cette chaîne prouve sa COHÉRENCE INTERNE ; seule l'ancre (hors base) prouve qu'elle n'a pas été réécrite en entier : « non-ancre » est dit, jamais tu.
 * @returns {Promise<{ok:boolean, lignes:number, tete:string|null, errata:number, ancre:string, objets:number, problemes:object[]}>}
 */
async function verifierChaineSeau(colFn, seauId, { ancre = null, stockage = null, relireR2 = false, exigerAncre = true } = {}) {
    const seau = await colFn(COLLECTIONS.seaux).findOne({ _id: seauId });
    if (!seau) throw erreur('CODE_INVALIDE', 'seau-inconnu', 404);
    const problemes = [];
    if (seau.empreinte !== empreinteSeau(seau)) problemes.push({ cause: 'seau' });
    if (seau.prec !== GENESE) { const p = await colFn(COLLECTIONS.seaux).findOne({ empreinte: seau.prec }); if (!p) problemes.push({ cause: 'prec' }); }
    const lignes = await colFn(COLLECTIONS.scans).find({ seauId }).sort({ rang: 1 }).toArray();
    let prec = seau.empreinte, attendu = 1;
    const limite = seau.etat === 'scelle' && Number.isSafeInteger(seau.n) ? seau.n : Infinity;
    for (const l of lignes) {
        if (l.rang > limite) { problemes.push({ rang: l.rang, cause: 'apres-scelle' }); continue; }
        if (l.rang !== attendu) problemes.push({ rang: attendu, cause: 'rang-manquant' });
        attendu = l.rang + 1;
        if (l.prec !== prec) problemes.push({ rang: l.rang, cause: 'lien' });
        if (l.empreinte !== empreinteLigne(l)) problemes.push({ rang: l.rang, cause: 'empreinte' });
        prec = l.empreinte;
    }
    const dansLeScelle = lignes.filter(l => l.rang <= limite);
    const tete = dansLeScelle.length ? dansLeScelle[dansLeScelle.length - 1].empreinte : null;
    if (seau.etat === 'scelle') {
        if (seau.tete !== tete) problemes.push({ cause: 'tete' });
        if (seau.n !== dansLeScelle.length) problemes.push({ cause: 'effectif' });
        const photos = await colFn(COLLECTIONS.photos).find({ seauId }).toArray();
        if (seau.photosEmpreinte !== empreintePhotos(photos)) problemes.push({ cause: 'photos' });
        if (seau.empreinteScellee !== empreinteScellee(seau)) problemes.push({ cause: 'scelle' });
    }
    // les vérités d'un juge scellé et la chaîne de ses errata
    const errata = await colFn(COLLECTIONS.errata).find({ seauId }).sort({ n: 1 }).toArray();
    if (seau.etat === 'scelle' && seau.type === 'juge') {
        const verites = await colFn(COLLECTIONS.verites).find({ seauId }).toArray();
        if (seau.veritesEmpreinte !== empreinteVerites(verites)) problemes.push({ cause: 'verites' });
        let precE = seau.empreinteScellee, nE = 1;
        for (const e of errata) {
            if (e.n !== nE || e.prec !== precE || e.empreinte !== empreinteErratum(e)) { problemes.push({ cause: 'erratum', n: e.n }); }
            precE = e.empreinte; nE = e.n + 1;
        }
    } else if (errata.length) problemes.push({ cause: 'erratum', n: errata[0].n });       // un erratum hors d'un juge scellé n'a pas lieu d'être
    // l'ancre, hors de la base
    let etatAncre = 'sans-objet';
    if (seau.etat === 'scelle') {
        const a = ancre ? await ancre(seauId) : null;
        const dernierE = errata.length ? errata[errata.length - 1] : null;
        if (!a) { etatAncre = 'non-ancre'; if (seau.type === 'juge' && exigerAncre) problemes.push({ cause: 'non-ancre' }); }       // 🔑 un JUGE non ancré n'est PAS ok : la chaîne seule ne prouve que sa cohérence interne
        else if (!(a.tete === seau.tete && a.empreinteScellee === seau.empreinteScellee && (a.veritesEmpreinte ?? null) === (seau.veritesEmpreinte ?? null) && a.n === seau.n)) { etatAncre = 'differente'; problemes.push({ cause: 'ancre' }); }
        // l'ancre porte AUSSI la tête de la chaîne des errata et leur nombre : des errata supprimés, ajoutés ou refaits sans ré-ancrage se voient
        else if ((a.errata ?? 0) !== errata.length || (a.erratumTete ?? null) !== (dernierE ? dernierE.empreinte : null)) { etatAncre = 'perimee'; problemes.push({ cause: 'ancre-errata' }); }
        else etatAncre = 'ok';
    }
    // chaque objet du bucket relu et re-haché (coûteux : une lecture par objet)
    let objets = 0;
    if (relireR2) {
        if (!stockage || typeof stockage.lire !== 'function') problemes.push({ cause: 'stockage-absent' });
        else {
            const docs = [...await colFn(COLLECTIONS.photos).find({ seauId }).toArray(), ...await colFn(COLLECTIONS.mesures).find({ seauId }).toArray()];
            for (const d of docs) {
                objets++;
                let b = null; try { b = await stockage.lire(d.cle); } catch { /* absent */ }
                if (!Buffer.isBuffer(b)) problemes.push({ cause: 'objet-absent', scanId: d.scanId, index: d.index ?? null });
                else if (sha256(b) !== d.sha256) problemes.push({ cause: 'objet-altere', scanId: d.scanId, index: d.index ?? null });
            }
        }
    }
    return { ok: problemes.length === 0, lignes: lignes.length, tete, errata: errata.length, ancre: etatAncre, objets, problemes };
}

function creerSeaux({ cfg, colFn = n => db.col(n), stockage = null, env = process.env, horloge = () => new Date(), catalogue = null, ancresDir = require('./ancre').DOSSIER, melanger = melangerAlea } = {}) {
    const col = n => colFn(COLLECTIONS[n]);
    const analyses = () => colFn('analyses');
    let indexes = null, stockagePret = null;
    const preparer = () => (indexes = indexes || (async () => { for (const i of INDEX_SEAU) await colFn(i.c).createIndex(i.cle, i.opts); })().catch(e => { indexes = null; throw e; }));
    // Un stockage PRÊT : le bucket est vérifié (endpoint UE) avant la première écriture ; un échec n'est pas mémorisé (une panne passagère ne ferme pas le banc).
    async function stock() {
        if (stockagePret) return stockagePret;
        try {
            const s = stockage || S.creerStockageSeauReel(env);
            if (!s || typeof s.verifierBucket !== 'function') throw new Error('verifierBucket absent');
            await s.verifierBucket();
            return (stockagePret = s);
        } catch (e) { console.error(`❌ [v2 banc-seau] stockage non prêt (${(e && (e.code || e.name)) || 'erreur'})`); throw erreur('INDISPONIBLE', 'stockage', 503); }
    }
    let catalogueDefaut = null;
    const catalogueDe = () => catalogue || (catalogueDefaut = catalogueDefaut || require('../identifier/catalogue').creerCatalogue({ cfg }));

    // les compteurs de la barrière d'écriture sont VISIBLES : `enVol` = ecritures - termine (0 au repos ; > 0 et qui dure = une requête tuée, voir reparer-seau.js) ; un champ absent vaut 0 (seau d'avant le tour 2)
    const vue = async s => ({ id: s._id, nom: s.nom, type: s.type, cible: s.cible, note: s.note ?? null, declareLe: s.declareLe, empreinte: s.empreinte, prec: s.prec, etat: s.etat,
        ecritures: s.ecritures ?? 0, termine: s.termine ?? 0, enVol: (s.ecritures ?? 0) - (s.termine ?? 0), derniereReservation: s.derniereReservation ?? null,
        n: s.etat === 'scelle' ? s.n : await col('scans').countDocuments({ seauId: s._id }),
        ...(s.etat === 'scelle' ? { scelleLe: s.scelleLe, tete: s.tete, photosEmpreinte: s.photosEmpreinte, empreinteScellee: s.empreinteScellee, ...(s.veritesEmpreinte ? { veritesEmpreinte: s.veritesEmpreinte } : {}) } : {}) });

    async function courant() { await preparer(); const s = await col('seaux').findOne({ etat: 'ouvert' }); return s ? vue(s) : null; }

    async function declarer({ nom, type, cible, note, par }) {
        await preparer();
        if (typeof nom !== 'string' || !FORME_NOM.test(nom)) throw erreur('ENTREE', 'nom');
        if (!TYPES.includes(type)) throw erreur('ENTREE', 'type');
        let c = cible;
        // la cible est DÉCLARÉE (200 par défaut pour le juge, 500 pour un entraînement) : on ne scelle pas un juge sous sa cible
        if (c === undefined) c = cibleParDefaut(type);
        if (!Number.isSafeInteger(c) || c < 1 || c > CIBLE_MAX) throw erreur('ENTREE', 'cible');
        if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > NOTE_MAX)) throw erreur('ENTREE', 'note');
        if (typeof par !== 'string' || !par) throw erreur('ENTREE', 'declarant');
        if (await col('seaux').findOne({ etat: 'ouvert' })) throw erreur('CONFLIT', 'seau-ouvert');
        if (await col('seaux').findOne({ nom })) throw erreur('CONFLIT', 'nom-pris');
        if (type === 'juge' && await col('seaux').findOne({ type: 'juge' })) throw erreur('CONFLIT', 'juge-existe');
        const dernier = await col('seaux').find({}).sort({ declareLe: -1 }).limit(1).toArray();
        const s = { _id: crypto.randomBytes(8).toString('hex'), nom, type, cible: c, note: note ?? null, declareLe: horloge(), declarePar: par, prec: dernier.length ? dernier[0].empreinte : GENESE, etat: 'ouvert',
            ecritures: 0, termine: 0 };       // la BARRIÈRE D'ÉCRITURE : écritures réservées / terminées (hors de l'empreinte du seau : ce sont des compteurs, pas une déclaration)
        s.empreinte = empreinteSeau(s);
        try { await col('seaux').insertOne(s); }
        catch (e) { if (e && e.code === 11000) throw erreur('CONFLIT', 'concurrence'); throw e; }
        return vue(s);
    }

    // 🔑 LA BARRIÈRE D'ÉCRITURE (tour 2). Toute écriture rattachée à un seau OUVERT (photo, mesure, ligne, vérité d'un juge) commence par RÉSERVER sa place : `updateOne({_id, etat:'ouvert'}, {$inc:{ecritures:1}})` — rien de modifié ⇒ refus ;
    // elle écrit ensuite (objet du bucket, puis documents) et, quoi qu'il arrive, TERMINE (`$inc:{termine:1}`, sans condition d'état : l'écriture est faite ou défaite). Aucune insertion n'a lieu sans une réservation prise sur un seau ouvert.
    // Le scellé ne passe que si `ecritures === termine` (aucune écriture en vol) ET si les deux compteurs n'ont pas bougé depuis la lecture de l'instantané : voir sceller().
    async function reserver(seauId) {
        // chaque réservation garde son HORODATAGE : c'est lui qui dit, plus tard, depuis quand une écriture « en vol » l'est (reparer-seau.js ne répare que passé un délai)
        const r = await col('seaux').updateOne({ _id: seauId, etat: 'ouvert' }, { $inc: { ecritures: 1 }, $set: { derniereReservation: horloge() } });
        if (!r || r.modifiedCount !== 1) throw erreur('CONFLIT', 'seau-scelle');
    }
    const terminer = async seauId => { try { await col('seaux').updateOne({ _id: seauId }, { $inc: { termine: 1 } }); } catch (e) { console.error(`🔴 [v2 banc-seau] écriture non terminée sur ${seauId} (${(e && (e.code || e.name)) || 'erreur'}) : le seau ne se scellera pas avant réparation`); throw e; } };
    /** Exécute `travail` sous une réservation ; la terminaison est TOUJOURS posée. */
    async function sousReservation(seauId, travail) {
        await reserver(seauId);
        try { return await travail(); } finally { await terminer(seauId); }
    }

    /**
     * LE SCELLÉ, en UNE mise à jour conditionnelle. On lit le seau (état, compteurs), on refuse s'il reste des écritures en vol (`ecritures !== termine`), on calcule sur l'instantané, puis
     * `updateOne({_id, etat:'ouvert', ecritures:<lu>, termine:<lu>}, {$set: {etat:'scelle', …}})`. Si une écriture a réservé entre-temps, rien ne change : on recommence, tête recalculée. Aucun état intermédiaire :
     * deux scellés simultanés ne se gênent pas (un seul gagne, l'autre lit « scelle » et dit deja-scelle), et aucun ne remet l'état à « ouvert ».
     */
    async function sceller(seauId) {
        await preparer();
        if (typeof seauId !== 'string' || !FORME_SEAU.test(seauId)) throw erreur('ENTREE', 'seau-id');
        let enVol = null;                                  // le dernier constat d'écritures en vol (écart, dernière réservation)
        const egal = v => (v === 0 ? { $in: [0, null] } : v);            // un champ ABSENT vaut 0 (seau déclaré avant le tour 2) : le filtre du scellé le traite comme tel
        for (let essai = 0; essai < 40; essai++) {
            const s = await col('seaux').findOne({ _id: seauId });
            if (!s) throw erreur('CODE_INVALIDE', 'seau-inconnu', 404);
            if (s.etat !== 'ouvert') throw erreur('CONFLIT', 'deja-scelle');
            const [ec, te] = [s.ecritures ?? 0, s.termine ?? 0];
            if (ec !== te) { enVol = { ecart: ec - te, derniere: s.derniereReservation instanceof Date ? s.derniereReservation : null }; await new Promise(r => setTimeout(r, 25)); continue; }           // des écritures sont en vol : on attend qu'elles aient fini
            enVol = null;
            const lignes = await col('scans').find({ seauId }).sort({ rang: 1 }).toArray();
            if (!lignes.length) throw erreur('CONFLIT', 'seau-vide');
            if (s.type === 'juge' && lignes.length < s.cible) throw erreur('CONFLIT', 'sous-cible');
            const photos = await col('photos').find({ seauId }).toArray();
            const avecPhoto0 = new Set(photos.filter(p => p.index === 0).map(p => p.scanId));
            if (lignes.some(l => !avecPhoto0.has(l.scanId))) throw erreur('CONFLIT', 'ligne-sans-photo');
            const fin = { etat: 'scelle', scelleLe: horloge(), tete: lignes[lignes.length - 1].empreinte, n: lignes.length, photosEmpreinte: empreintePhotos(photos) };
            if (s.type === 'juge') {
                // le juge ne se scelle que complètement étiqueté, et le scellé couvre les vérités
                const verites = await col('verites').find({ seauId }).toArray();
                const ans = await analyses().find({ _id: { $in: lignes.map(l => oid(l.scanId)) } }, { projection: { cartes: 1 } }).toArray();
                const attendues = ans.reduce((n, a) => n + (Array.isArray(a.cartes) ? a.cartes.length : 0), 0);
                if (ans.length !== lignes.length || verites.length !== attendues) throw erreur('CONFLIT', 'verites-incompletes');
                fin.veritesEmpreinte = empreinteVerites(verites);
            }
            fin.empreinteScellee = empreinteScellee({ ...s, ...fin });
            const r = await col('seaux').updateOne({ _id: seauId, etat: 'ouvert', ecritures: egal(ec), termine: egal(te) }, { $set: fin });
            if (r && r.matchedCount === 1) return vue({ ...s, ...fin });
            // une écriture s'est glissée (ou un autre scellé a gagné) : on relit, tête recalculée
        }
        if (enVol) {
            // 🔑 un écart qui DURE n'est plus une collision passagère : code DISTINCT, l'écart et l'âge de la dernière réservation (une requête tuée gèle le banc tant que personne ne répare)
            const ageMs = enVol.derniere ? Math.max(0, horloge().getTime() - enVol.derniere.getTime()) : null;
            throw Object.assign(erreur('CONFLIT', 'ECRITURES_EN_VOL'), { texte: `${enVol.ecart} écriture(s) en vol, dernière réservation ${ageMs === null ? 'à une date inconnue' : `il y a ${Math.round(ageMs / 1000)} s`} : si elle date, la requête est morte (node v2/banc/reparer-seau.js)`, enVol: enVol.ecart, ageMs });
        }
        throw erreur('CONFLIT', 'ecritures-en-cours');
    }

    // Le seau EN COURS et le scan, pour toute écriture : le client DIT quel seau il croit en cours (jamais déduit d'un état périmé).
    async function cadre({ scanId, porteur, seauId }) {
        await preparer();
        if (typeof scanId !== 'string' || !FORME_ID.test(scanId)) throw erreur('ENTREE', 'scan-id');
        const seau = await col('seaux').findOne({ etat: 'ouvert' });
        if (!seau) {
            const autre = typeof seauId === 'string' ? await col('seaux').findOne({ _id: seauId }) : null;
            throw erreur('CONFLIT', autre && autre.etat === 'scelle' ? 'seau-scelle' : 'aucun-seau');
        }
        if (seau._id !== seauId) throw erreur('CONFLIT', 'seau-change');
        const an = await analyses().findOne({ _id: oid(scanId), porteur }, { projection: { creeLe: 1 } });
        if (!an) throw erreur('CODE_INVALIDE', 'scan-introuvable', 404);
        return { seau, an };
    }

    async function creerLigne(seau, an, scanId, porteur, annonce) {
        for (let essai = 0; essai < 5; essai++) {
            const existante = await col('scans').findOne({ scanId });
            if (existante) return existante;
            const dernier = (await col('scans').find({ seauId: seau._id }).sort({ rang: -1 }).limit(1).toArray())[0] || null;
            const rang = dernier ? dernier.rang + 1 : 1;
            if (rang > seau.cible) throw erreur('CONFLIT', 'seau-plein');
            let doublonDe = null, fuiteJuge = null;
            if (annonce) {
                const meme = await col('scans').findOne({ seauId: seau._id, annonce });
                if (meme) doublonDe = meme.scanId;
                const juge = await col('seaux').findOne({ type: 'juge' });
                if (juge && juge._id !== seau._id) { const f = await col('scans').findOne({ seauId: juge._id, annonce }); if (f) fuiteJuge = juge._id; }
            }
            const l = { _id: `${seau._id}:${rang}`, seauId: seau._id, rang, scanId, porteur, posteLe: horloge(), scanCreeLe: an.creeLe, annonce: annonce || null, doublonDe, fuiteJuge, prec: dernier ? dernier.empreinte : seau.empreinte };
            l.empreinte = empreinteLigne(l);
            try { await col('scans').insertOne(l); return l; }
            catch (e) { if (e && e.code === 11000) continue; throw e; }
        }
        throw erreur('CONFLIT', 'concurrence');
    }

    async function enregistrerPhoto({ scanId, porteur, seauId, index, octets, type, annonce }) {
        if (!Number.isInteger(index) || index < 0 || index >= PHOTOS_MAX) throw erreur('ENTREE', 'photo');
        const ext = EXT[type]; if (!ext || !Buffer.isBuffer(octets) || !octets.length) throw erreur('ENTREE', 'image');
        if (annonce !== undefined && annonce !== null && !FORME_SHA.test(annonce)) throw erreur('ENTREE', 'annonce');
        const { seau, an } = await cadre({ scanId, porteur, seauId });
        let ligne = await col('scans').findOne({ scanId });
        if (ligne && ligne.seauId !== seau._id) throw erreur('CONFLIT', 'scan-dans-un-autre-seau');
        if (!ligne) {
            // un scan NEUF : né après la déclaration du seau, et frais — jamais rattaché après coup
            if (!(an.creeLe instanceof Date) || an.creeLe < seau.declareLe) throw erreur('CONFLIT', 'scan-avant-seau');
            if (horloge().getTime() - an.creeLe.getTime() > SCAN_FRAIS_MS) throw erreur('CONFLIT', 'scan-perime');
            // dans un JUGE, l'empreinte d'annonce est OBLIGATOIRE (sans elle la parade contre la fuite du juge vers l'entraînement serait facultative côté client)
            if (seau.type === 'juge' && !annonce) throw erreur('ENTREE', 'annonce-obligatoire');
        } else if (ligne.porteur !== porteur) throw erreur('CODE_INVALIDE', 'scan-introuvable', 404);
        const sha = sha256(octets), cle = S.cleSeau(seau._id, sha, ext);
        const id = `${scanId}:${index}`;
        const deja = await col('photos').findOne({ _id: id });
        if (deja) { if (deja.sha256 !== sha) throw erreur('CONFLIT', 'photo-differente'); return { etat: 'deja', rang: ligne ? ligne.rang : null, seauId: seau._id }; }
        const s = await stock();
        let dh = null; try { dh = await require('./dhash').dhash(octets); } catch { /* sans dHash : l'export le recalcule depuis l'objet, ou refuse */ }
        // BARRIÈRE : place réservée d'abord ; l'objet du bucket, puis la ligne du scan (si neuve), puis le document de la photo ; la terminaison est posée quoi qu'il arrive
        return sousReservation(seau._id, async () => {
            await s.ecrire(cle, octets);
            try {
                if (!ligne) ligne = await creerLigne(seau, an, scanId, porteur, annonce);
                await col('photos').insertOne({ _id: id, seauId: seau._id, scanId, index, sha256: sha, octets: octets.length, type, cle, dhash: dh, recuLe: horloge() });
            } catch (e) {
                // l'insertion a échoué : l'objet n'est retiré que si AUCUN document ne le nomme (la clé est adressée par le contenu, une autre photo peut la partager) ; sinon il reste, compté orphelin par le filet
                let nomme = true; try { nomme = Boolean(await col('photos').findOne({ cle })); } catch { /* on garde */ }
                if (!nomme) { try { await s.supprimer(cle); } catch { /* objet orphelin : sans document, jamais exporté */ } }
                if (e && e.code === 11000) { const x = await col('photos').findOne({ _id: id }); if (x && x.sha256 === sha) return { etat: 'deja', rang: ligne ? ligne.rang : null, seauId: seau._id }; throw erreur('CONFLIT', 'photo-differente'); }
                throw e;
            }
            return { etat: 'ecrit', rang: ligne.rang, seauId: seau._id };
        });
    }

    async function enregistrerMesures({ scanId, porteur, seauId, octets }) {
        if (!Buffer.isBuffer(octets) || !octets.length || octets.length > MESURES_OCTETS_MAX) throw erreur('ENTREE', 'mesures', 413);
        let j; try { j = JSON.parse(octets.toString('utf8')); } catch { throw erreur('ENTREE', 'json', 422); }
        if (!j || typeof j !== 'object') throw erreur('ENTREE', 'json', 422);
        const { seau } = await cadre({ scanId, porteur, seauId });
        const ligne = await col('scans').findOne({ scanId, seauId: seau._id, porteur });
        if (!ligne) throw erreur('CODE_INVALIDE', 'scan-hors-seau', 404);
        const sha = sha256(octets), cle = S.cleSeau(seau._id, sha, 'json');
        const deja = await col('mesures').findOne({ _id: scanId });
        if (deja) { if (deja.sha256 !== sha) throw erreur('CONFLIT', 'mesures-differentes'); return { etat: 'deja' }; }
        const s = await stock();
        return sousReservation(seau._id, async () => {          // BARRIÈRE : réservation, objet, document, terminaison
            await s.ecrire(cle, octets);
            try { await col('mesures').insertOne({ _id: scanId, seauId: seau._id, scanId, sha256: sha, octets: octets.length, cle, recuLe: horloge() }); }
            catch (e) {
                if (e && e.code === 11000) return { etat: 'deja' };
                let nomme = true; try { nomme = Boolean(await col('mesures').findOne({ cle })); } catch { /* on garde */ }
                if (!nomme) { try { await s.supprimer(cle); } catch { /* orphelin */ } }
                throw e;
            }
            return { etat: 'ecrit' };
        });
    }

    const ligneDe = async (scanId, porteur) => {
        await preparer();
        if (typeof scanId !== 'string' || !FORME_ID.test(scanId)) throw erreur('ENTREE', 'scan-id');
        const l = await col('scans').findOne({ scanId, porteur });
        if (!l) throw erreur('CODE_INVALIDE', 'scan-introuvable', 404);       // inconnu, hors seau ou d'un autre porteur : indiscernables
        return l;
    };

    /** La liste de travail : l'ORDRE du scan, le nombre de photos et de vérités — AUCUN candidat, aucune réponse de la chaîne. */
    async function aEtiqueter({ seauId, porteur }) {
        await preparer();
        let id = seauId;
        if (id === undefined) { const c = await col('seaux').findOne({ etat: 'ouvert' }) || (await col('seaux').find({}).sort({ declareLe: -1 }).limit(1).toArray())[0]; id = c && c._id; }
        if (typeof id !== 'string' || !FORME_SEAU.test(id)) throw erreur('ENTREE', 'seau-id');
        const lignes = await col('scans').find({ seauId: id, porteur }).sort({ rang: 1 }).toArray();
        // JUGE EN UN CLIC (tour 1) : le filtre par porteur reste une GARDE (isolation des comptes : un administrateur ne lit ni ne saisit les scans d'un autre). La liste dit seulement COMBIEN de scans du seau sont d'un autre compte (un nombre,
        // jamais un identifiant, un rang ni un porteur) et décrit le seau (nom, type, état, n, cible) : la page peut ainsi expliquer une liste vide.
        const autresComptes = await col('scans').countDocuments({ seauId: id, porteur: { $ne: porteur } });
        const sd = await col('seaux').findOne({ _id: id });
        const vs = sd ? await vue(sd) : null;
        const seau = vs ? { id: vs.id, nom: vs.nom, type: vs.type, etat: vs.etat, n: vs.n, cible: vs.cible } : null;
        const ids = lignes.map(l => oid(l.scanId));
        const ans = ids.length ? await analyses().find({ _id: { $in: ids } }, { projection: { cartes: 1 } }).toArray() : [];
        const nCartes = new Map(ans.map(a => [String(a._id), Array.isArray(a.cartes) ? a.cartes.length : 0]));
        const nPhotos = new Map((await col('photos').aggregate([{ $match: { seauId: id } }, { $group: { _id: '$scanId', n: { $sum: 1 } } }]).toArray()).map(x => [x._id, x.n]));
        const nVerites = new Map((await col('verites').aggregate([{ $match: { seauId: id } }, { $group: { _id: '$scanId', n: { $sum: 1 } } }]).toArray()).map(x => [x._id, x.n]));
        const scans = lignes.map(l => ({ scanId: l.scanId, rang: l.rang, photos: nPhotos.get(l.scanId) || 0, cartes: nCartes.get(l.scanId) || 0, etiquetees: nVerites.get(l.scanId) || 0 }));
        const prochain = scans.find(s => s.cartes > 0 && s.etiquetees < s.cartes);
        return { seauId: id, seau, autresComptes, scans, prochain: prochain ? prochain.scanId : null };
    }

    async function lirePhoto({ scanId, index, porteur }) {
        await ligneDe(scanId, porteur);
        const p = await col('photos').findOne({ _id: `${scanId}:${index}` });
        if (!p) throw erreur('CODE_INVALIDE', 'photo-introuvable', 404);
        let octets; try { octets = await (await stock()).lire(p.cle); } catch (e) { if (e && e.statut === 503) throw e; throw erreur('INDISPONIBLE', 'lecture', 503); }
        return { octets, type: p.type };
    }

    async function carteDe(scanId, carte) {
        const an = await analyses().findOne({ _id: oid(scanId) }, { projection: { cartes: 1, produits: 1 } });
        const c = an && Array.isArray(an.cartes) ? an.cartes[carte] : null;
        if (!c || typeof c !== 'object') throw erreur('CODE_INVALIDE', 'carte-introuvable', 404);
        return { an, c };
    }

    /** Les candidats, À LA DEMANDE : triés par prix croissant (le prix inconnu en dernier), SANS rang ni statut de la chaîne. Les montrer est ENREGISTRÉ (banc_seau_vues). */
    async function candidats({ scanId, carte = 0, porteur }) {
        const ligne = await ligneDe(scanId, porteur);
        if (!Number.isSafeInteger(carte) || carte < 0) throw erreur('ENTREE', 'carte');
        const { an, c } = await carteDe(scanId, carte);
        const ids = [c.idProduct, ...((c.question && Array.isArray(c.question.choix)) ? c.question.choix.map(x => x && x.idProduct) : []), ...((Array.isArray(an.cartes) && an.cartes.length === 1 && Array.isArray(an.produits)) ? an.produits.map(p => p && p.idProduct) : [])].filter(idOk);
        const uniques = [...new Set(ids)].slice(0, 20);
        let table; try { table = await catalogueDe().lire(uniques); } catch (e) { console.error(`❌ [v2 banc-seau] catalogue (${(e && (e.code || e.name)) || 'erreur'})`); throw erreur('INDISPONIBLE', 'catalogue', 503); }
        const prixDe = p => { const g = p.prixGuide; const v = g && (Number.isFinite(g.trend) ? g.trend : Number.isFinite(g.low) ? g.low : null); return v === null || v === undefined ? Infinity : v; };
        const liste = [...table.values()].sort((a, b) => prixDe(a) - prixDe(b) || a.idProduct - b.idProduct)
            .map(p => ({ idProduct: p.idProduct, nom: p.nomCardmarket, set: { slug: p.set.slug, nom: p.set.nom }, numero: p.numero ?? null,
                prix: p.prixGuide ? { trend: p.prixGuide.trend ?? null, low: p.prixGuide.low ?? null } : null, visuel: p.visuel ? p.visuel.url : null, version: p.version ?? null }));
        await col('vues').insertOne({ scanId, carte, seauId: ligne.seauId, le: horloge(), ids: liste.map(x => x.idProduct) });
        return { candidats: liste };
    }

    /**
     * JUGE RAPIDE — les 5 MEILLEURS candidats du modèle pour ce scan (l'ordre du modèle : la carte retenue, puis les choix de sa question, puis les produits de l'analyse), servis dans un ORDRE ALÉATOIRE.
     * Aucun indice : ni rang, ni score, ni prix, ni statut ; mêmes champs pour chacun. L'ordre SERVI est enregistré (vue de mode `candidats-5`) : c'est lui que la vérité reprend, et c'est la liste fermée où le clic doit tomber.
     */
    async function candidats5({ scanId, carte = 0, porteur }) {
        const ligne = await ligneDe(scanId, porteur);
        if (!Number.isSafeInteger(carte) || carte < 0) throw erreur('ENTREE', 'carte');
        const { an, c } = await carteDe(scanId, carte);
        const pool = [...new Set([c.idProduct, ...((c.question && Array.isArray(c.question.choix)) ? c.question.choix.map(x => x && x.idProduct) : []), ...((Array.isArray(an.cartes) && an.cartes.length === 1 && Array.isArray(an.produits)) ? an.produits.map(p => p && p.idProduct) : [])].filter(idOk))].slice(0, 20);
        let table; try { table = await catalogueDe().lire(pool); } catch (e) { console.error(`❌ [v2 banc-seau] catalogue (${(e && (e.code || e.name)) || 'erreur'})`); throw erreur('INDISPONIBLE', 'catalogue', 503); }
        const cinq = pool.filter(id => table.has(id)).slice(0, NB_CINQ);
        let ordre = melanger(cinq.slice());
        if (!Array.isArray(ordre) || ordre.length !== cinq.length || ordre.slice().sort((a, b) => a - b).join() !== cinq.slice().sort((a, b) => a - b).join()) ordre = melangerAlea(cinq);       // un mélangeur qui perdrait ou inventerait un candidat est ignoré
        await col('vues').insertOne({ scanId, carte, seauId: ligne.seauId, le: horloge(), mode: 'candidats-5', ids: ordre });
        return { mode: 'candidats-5', candidats: ordre.map(id => { const p = table.get(id); return { idProduct: p.idProduct, nom: p.nomCardmarket, set: { slug: p.set.slug, nom: p.set.nom }, numero: p.numero ?? null, visuel: p.visuel ? p.visuel.url : null, version: p.version ?? null }; }) };
    }

    /** La vérité d'une carte d'un scan rangé. `candidatsVus` est CALCULÉ ici (une vue enregistrée pour ce scan et cette carte) : le client ne le déclare jamais. `mode` est déclaré par la page, jugé ici ; l'ordre affiché vient du serveur. */
    async function saisirVerite({ scanId, carte = 0, idProduct, aucune, via, photoSuffisante, mode, porteur }) {
        // « la photo suffit-elle à un expert pour trancher l'impression exacte ? » : vrai/faux de l'éditeur, enregistré avec la vérité ; absent = on ne touche pas à la valeur déjà posée
        if (photoSuffisante !== undefined && typeof photoSuffisante !== 'boolean') throw erreur('ENTREE', 'photo-suffisante');
        if (mode !== undefined && !MODES.includes(mode)) throw erreur('ENTREE', 'mode');
        const modeVerite = mode === undefined ? 'saisie' : mode;
        if (via === 'candidat5' && modeVerite !== 'candidats-5') throw erreur('ENTREE', 'mode-via');
        const prep = await preparerVerite({ scanId, carte, idProduct, aucune, via, porteur });
        if (modeVerite === 'candidats-5' && !prep.derniereCinq) throw erreur('CONFLIT', 'mode-sans-vue');
        const p = { ...prep, photoSuffisante, mode: modeVerite, ordreAffiche: modeVerite === 'candidats-5' ? prep.derniereCinq : null };
        // 🔑 un JUGE scellé (ou en cours de scellement) ne reçoit plus AUCUNE vérité : une erreur humaine s'ajoute en ERRATUM (ajouterErratum), jamais par réécriture
        const seau = await col('seaux').findOne({ _id: p.ligne.seauId });
        if (!seau) throw erreur('CONFLIT', 'seau-illisible');
        if (seau.type === 'juge') {
            // le scellé du juge couvre les vérités : une vérité de juge s'écrit SOUS RÉSERVATION (la barrière d'écriture), jamais après le scellé
            if (seau.etat !== 'ouvert') throw erreur('CONFLIT', 'juge-scelle');
            try { return await sousReservation(seau._id, () => ecrireVerite(p)); }
            catch (e) { if (e && e.detail === 'seau-scelle') throw erreur('CONFLIT', 'juge-scelle'); throw e; }
        }
        return ecrireVerite(p);
    }

    /** Les contrôles COMMUNS à une vérité et à un erratum (une seule définition) : la ligne du scan, la forme, la carte, le candidat montré, le catalogue, la trace des vues. */
    async function preparerVerite({ scanId, carte = 0, idProduct, aucune, via, porteur }) {
        const ligne = await ligneDe(scanId, porteur);
        if (!Number.isSafeInteger(carte) || carte < 0) throw erreur('ENTREE', 'carte');
        if (!VIA.includes(via)) throw erreur('ENTREE', 'via');
        if ((idProduct === undefined) === (aucune === undefined)) throw erreur('ENTREE', 'id-product-ou-aucune');
        if (aucune !== undefined && !AUCUNE.includes(aucune)) throw erreur('ENTREE', 'aucune');
        if (idProduct !== undefined && !idOk(idProduct)) throw erreur('ENTREE', 'id-product');
        if ((via === 'candidat' || via === 'candidat5') && idProduct === undefined) throw erreur('ENTREE', 'candidat-sans-id');
        await carteDe(scanId, carte);
        const vues = await col('vues').find({ scanId, carte }).toArray();
        if (via === 'candidat' && !vues.some(v => Array.isArray(v.ids) && v.ids.includes(idProduct))) throw erreur('CONFLIT', 'candidat-non-vu');
        // JUGE RAPIDE : la liste fermée est la DERNIÈRE vue de mode `candidats-5` de ce scan et de cette carte ; un clic hors de cette liste est refusé, avant tout accès au catalogue
        const cinq = vues.filter(v => v.mode === 'candidats-5' && Array.isArray(v.ids)).sort((a, b) => (b.le - a.le) || (String(b._id) < String(a._id) ? -1 : 1))[0];
        const derniereCinq = cinq ? cinq.ids.slice() : null;
        if (via === 'candidat5' && !(derniereCinq && derniereCinq.includes(idProduct))) throw erreur('CONFLIT', 'candidat-hors-liste');
        if (idProduct !== undefined) {
            let table; try { table = await catalogueDe().lire([idProduct]); } catch (e) { console.error(`❌ [v2 banc-seau] catalogue (${(e && (e.code || e.name)) || 'erreur'})`); throw erreur('INDISPONIBLE', 'catalogue', 503); }
            if (!(table instanceof Map) || !table.has(idProduct)) throw erreur('ENTREE', 'id-product-inconnu', 422);
        }
        return { ligne, scanId, carte, idProduct: idProduct ?? null, aucune: aucune ?? null, via, candidatsVus: vues.length > 0, vuesN: vues.length, derniereCinq };
    }

    async function ecrireVerite({ ligne, scanId, carte, idProduct, aucune, via, candidatsVus, vuesN, photoSuffisante, mode, ordreAffiche }) {
        const id = `${scanId}:${carte}`, now = horloge();
        const contenu = { idProduct, aucune, via, candidatsVus, vuesN, saisieLe: now, mode: mode || 'saisie', ordreAffiche: ordreAffiche || null };
        for (let essai = 0; essai < 3; essai++) {
            const e = await col('verites').findOne({ _id: id });
            if (!e) {
                try { await col('verites').insertOne({ _id: id, seauId: ligne.seauId, scanId, carte, ...contenu, photoSuffisante: photoSuffisante ?? null, rev: 1, historique: [] }); return { rev: 1, candidatsVus }; }
                catch (x) { if (x && x.code === 11000) continue; throw x; }
            }
            const ancien = { rev: e.rev, idProduct: e.idProduct, aucune: e.aucune, via: e.via, candidatsVus: e.candidatsVus, photoSuffisante: e.photoSuffisante ?? null, mode: e.mode ?? null, ordreAffiche: e.ordreAffiche ?? null, saisieLe: e.saisieLe };
            const r = await col('verites').updateOne({ _id: id, rev: e.rev }, { $set: { ...contenu, photoSuffisante: photoSuffisante ?? e.photoSuffisante ?? null, candidatsVus: candidatsVus || e.candidatsVus === true, rev: e.rev + 1 }, $push: { historique: ancien } });
            if (r && r.matchedCount === 1) return { rev: e.rev + 1, candidatsVus: candidatsVus || e.candidatsVus === true };
        }
        throw erreur('CONFLIT', 'concurrence');
    }

    /**
     * L'ERRATUM : la seule façon de corriger la vérité d'un juge SCELLÉ. Une maille de plus dans la chaîne des errata (accrochée à l'empreinte du scellé) : elle garde l'ancienne valeur, la nouvelle, la date et le motif.
     * La vérité d'origine n'est jamais réécrite ; la valeur EFFECTIVE est celle du dernier erratum (l'export la rend avec la liste des errata).
     */
    async function ajouterErratum({ scanId, carte = 0, idProduct, aucune, via, motif, porteur }) {
        const m = typeof motif === 'string' ? motif.trim() : '';
        if (m.length < MOTIF_MIN || m.length > MOTIF_MAX) throw erreur('ENTREE', 'motif');
        const p = await preparerVerite({ scanId, carte, idProduct, aucune, via, porteur });
        const seau = await col('seaux').findOne({ _id: p.ligne.seauId });
        if (!seau || seau.type !== 'juge' || seau.etat !== 'scelle') throw erreur('CONFLIT', 'pas-un-juge-scelle');
        const base = await col('verites').findOne({ _id: `${scanId}:${p.carte}` });
        if (!base) throw erreur('CONFLIT', 'verite-absente');
        for (let essai = 0; essai < 4; essai++) {
            const dernier = (await col('errata').find({ seauId: seau._id }).sort({ n: -1 }).limit(1).toArray())[0] || null;
            const duScan = (await col('errata').find({ seauId: seau._id, scanId, carte: p.carte }).sort({ n: -1 }).limit(1).toArray())[0] || null;
            const e = { _id: `${seau._id}:${dernier ? dernier.n + 1 : 1}`, seauId: seau._id, n: dernier ? dernier.n + 1 : 1, scanId, carte: p.carte,
                ancien: duScan ? valeurDe(duScan.nouveau) : valeurDe(base), nouveau: { idProduct: p.idProduct, aucune: p.aucune }, via, candidatsVus: p.candidatsVus, motif: m, le: horloge(), prec: dernier ? dernier.empreinte : seau.empreinteScellee };
            e.empreinte = empreinteErratum(e);
            try { await col('errata').insertOne(e); return { erratum: e.n }; }
            catch (x) { if (x && x.code === 11000) continue; throw x; }
        }
        throw erreur('CONFLIT', 'concurrence');
    }

    async function verifierChaine(seauId, { relireR2 = false } = {}) {
        await preparer();
        return verifierChaineSeau(colFn, seauId, { ancre: id => require('./ancre').lireAncre(id, ancresDir), ...(relireR2 ? { relireR2: true, stockage: await stock() } : {}) });
    }

    return { preparer, courant, declarer, sceller, enregistrerPhoto, enregistrerMesures, aEtiqueter, lirePhoto, candidats, candidats5, saisirVerite, ajouterErratum, verifierChaine, cadre };
}

module.exports = { creerSeaux, verifierChaineSeau, empreintePhotos, empreinteVerites, empreinteScellee, cibleParDefaut, INDEX_SEAU, COLLECTIONS, TYPES, AUCUNE, VIA, CIBLE_JUGE, CIBLE_MAX, SCAN_FRAIS_MS, PHOTOS_MAX, MESURES_OCTETS_MAX, FORME_ID, FORME_SEAU, FORME_SHA, erreur };
