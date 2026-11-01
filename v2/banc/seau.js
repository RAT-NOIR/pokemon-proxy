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
const VIA = Object.freeze(['url', 'idProduct', 'candidat']);
const GENESE = '0'.repeat(64);
const EXT = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const COLLECTIONS = Object.freeze({ seaux: 'banc_seaux', scans: 'banc_seau_scans', photos: 'banc_seau_photos', vues: 'banc_seau_vues', verites: 'banc_seau_verites', mesures: 'banc_seau_mesures' });

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
    I(COLLECTIONS.verites, 'banc_seau_verites_seau', { seauId: 1, scanId: 1 })
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
const empreinteScellee = s => hacher({ seauEmpreinte: s.empreinte, tete: s.tete, n: s.n, photosEmpreinte: s.photosEmpreinte, scelleLe: iso(s.scelleLe) });

/**
 * Relit la chaîne d'un seau SANS rien supposer : empreinte du seau, lien au seau précédent, chaque maille (rang contigu, lien, empreinte), puis — si scellé — tête, effectif, photos, scellé.
 * @returns {Promise<{ok:boolean, lignes:number, tete:string|null, problemes:{rang?:number, cause:string}[]}>}
 */
async function verifierChaineSeau(colFn, seauId) {
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
    return { ok: problemes.length === 0, lignes: lignes.length, tete, problemes };
}

function creerSeaux({ cfg, colFn = n => db.col(n), stockage = null, env = process.env, horloge = () => new Date(), catalogue = null } = {}) {
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

    const vue = async s => ({ id: s._id, nom: s.nom, type: s.type, cible: s.cible, note: s.note ?? null, declareLe: s.declareLe, empreinte: s.empreinte, prec: s.prec, etat: s.etat,
        n: s.etat === 'scelle' ? s.n : await col('scans').countDocuments({ seauId: s._id }),
        ...(s.etat === 'scelle' ? { scelleLe: s.scelleLe, tete: s.tete, photosEmpreinte: s.photosEmpreinte, empreinteScellee: s.empreinteScellee } : {}) });

    async function courant() { await preparer(); const s = await col('seaux').findOne({ etat: 'ouvert' }); return s ? vue(s) : null; }

    async function declarer({ nom, type, cible, note, par }) {
        await preparer();
        if (typeof nom !== 'string' || !FORME_NOM.test(nom)) throw erreur('ENTREE', 'nom');
        if (!TYPES.includes(type)) throw erreur('ENTREE', 'type');
        let c = cible;
        if (type === 'juge') { if (c !== undefined && c !== CIBLE_JUGE) throw erreur('ENTREE', 'cible-juge'); c = CIBLE_JUGE; }
        else { if (c === undefined) c = CIBLE_MAX; if (!Number.isSafeInteger(c) || c < 1 || c > CIBLE_MAX) throw erreur('ENTREE', 'cible'); }
        if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > NOTE_MAX)) throw erreur('ENTREE', 'note');
        if (typeof par !== 'string' || !par) throw erreur('ENTREE', 'declarant');
        if (await col('seaux').findOne({ etat: 'ouvert' })) throw erreur('CONFLIT', 'seau-ouvert');
        if (await col('seaux').findOne({ nom })) throw erreur('CONFLIT', 'nom-pris');
        if (type === 'juge' && await col('seaux').findOne({ type: 'juge' })) throw erreur('CONFLIT', 'juge-existe');
        const dernier = await col('seaux').find({}).sort({ declareLe: -1 }).limit(1).toArray();
        const s = { _id: crypto.randomBytes(8).toString('hex'), nom, type, cible: c, note: note ?? null, declareLe: horloge(), declarePar: par, prec: dernier.length ? dernier[0].empreinte : GENESE, etat: 'ouvert' };
        s.empreinte = empreinteSeau(s);
        try { await col('seaux').insertOne(s); }
        catch (e) { if (e && e.code === 11000) throw erreur('CONFLIT', 'concurrence'); throw e; }
        return vue(s);
    }

    async function sceller(seauId) {
        await preparer();
        if (typeof seauId !== 'string' || !FORME_SEAU.test(seauId)) throw erreur('ENTREE', 'seau-id');
        const s = await col('seaux').findOne({ _id: seauId });
        if (!s) throw erreur('CODE_INVALIDE', 'seau-inconnu', 404);
        if (s.etat === 'scelle') throw erreur('CONFLIT', 'deja-scelle');
        const lignes = await col('scans').find({ seauId }).sort({ rang: 1 }).toArray();
        if (!lignes.length) throw erreur('CONFLIT', 'seau-vide');
        const photos = await col('photos').find({ seauId }).toArray();
        const fin = { etat: 'scelle', scelleLe: horloge(), tete: lignes[lignes.length - 1].empreinte, n: lignes.length, photosEmpreinte: empreintePhotos(photos) };
        fin.empreinteScellee = empreinteScellee({ ...s, ...fin });
        const r = await col('seaux').updateOne({ _id: seauId, etat: 'ouvert' }, { $set: fin });
        if (!r || r.matchedCount !== 1) throw erreur('CONFLIT', 'deja-scelle');
        return vue({ ...s, ...fin });
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
        } else if (ligne.porteur !== porteur) throw erreur('CODE_INVALIDE', 'scan-introuvable', 404);
        const sha = sha256(octets), cle = S.cleSeau(seau._id, sha, ext);
        const id = `${scanId}:${index}`;
        const deja = await col('photos').findOne({ _id: id });
        if (deja) { if (deja.sha256 !== sha) throw erreur('CONFLIT', 'photo-differente'); return { etat: 'deja', rang: ligne ? ligne.rang : null, seauId: seau._id }; }
        const s = await stock();
        if (!ligne) ligne = await creerLigne(seau, an, scanId, porteur, annonce);
        await s.ecrire(cle, octets);
        try { await col('photos').insertOne({ _id: id, seauId: seau._id, scanId, index, sha256: sha, octets: octets.length, type, cle, recuLe: horloge() }); }
        catch (e) {
            if (e && e.code === 11000) { const x = await col('photos').findOne({ _id: id }); if (x && x.sha256 === sha) return { etat: 'deja', rang: ligne.rang, seauId: seau._id }; throw erreur('CONFLIT', 'photo-differente'); }
            throw e;
        }
        return { etat: 'ecrit', rang: ligne.rang, seauId: seau._id };
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
        await (await stock()).ecrire(cle, octets);
        try { await col('mesures').insertOne({ _id: scanId, seauId: seau._id, scanId, sha256: sha, octets: octets.length, cle, recuLe: horloge() }); }
        catch (e) { if (e && e.code === 11000) return { etat: 'deja' }; throw e; }
        return { etat: 'ecrit' };
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
        const ids = lignes.map(l => oid(l.scanId));
        const ans = ids.length ? await analyses().find({ _id: { $in: ids } }, { projection: { cartes: 1 } }).toArray() : [];
        const nCartes = new Map(ans.map(a => [String(a._id), Array.isArray(a.cartes) ? a.cartes.length : 0]));
        const nPhotos = new Map((await col('photos').aggregate([{ $match: { seauId: id } }, { $group: { _id: '$scanId', n: { $sum: 1 } } }]).toArray()).map(x => [x._id, x.n]));
        const nVerites = new Map((await col('verites').aggregate([{ $match: { seauId: id } }, { $group: { _id: '$scanId', n: { $sum: 1 } } }]).toArray()).map(x => [x._id, x.n]));
        const scans = lignes.map(l => ({ scanId: l.scanId, rang: l.rang, photos: nPhotos.get(l.scanId) || 0, cartes: nCartes.get(l.scanId) || 0, etiquetees: nVerites.get(l.scanId) || 0 }));
        const prochain = scans.find(s => s.cartes > 0 && s.etiquetees < s.cartes);
        return { seauId: id, scans, prochain: prochain ? prochain.scanId : null };
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

    /** La vérité d'une carte d'un scan rangé. `candidatsVus` est CALCULÉ ici (une vue enregistrée pour ce scan et cette carte) : le client ne le déclare jamais. */
    async function saisirVerite({ scanId, carte = 0, idProduct, aucune, via, porteur }) {
        const ligne = await ligneDe(scanId, porteur);
        if (!Number.isSafeInteger(carte) || carte < 0) throw erreur('ENTREE', 'carte');
        if (!VIA.includes(via)) throw erreur('ENTREE', 'via');
        if ((idProduct === undefined) === (aucune === undefined)) throw erreur('ENTREE', 'id-product-ou-aucune');
        if (aucune !== undefined && !AUCUNE.includes(aucune)) throw erreur('ENTREE', 'aucune');
        if (idProduct !== undefined && !idOk(idProduct)) throw erreur('ENTREE', 'id-product');
        if (via === 'candidat' && idProduct === undefined) throw erreur('ENTREE', 'candidat-sans-id');
        await carteDe(scanId, carte);
        const vues = await col('vues').find({ scanId, carte }).toArray();
        if (via === 'candidat' && !vues.some(v => Array.isArray(v.ids) && v.ids.includes(idProduct))) throw erreur('CONFLIT', 'candidat-non-vu');
        if (idProduct !== undefined) {
            let table; try { table = await catalogueDe().lire([idProduct]); } catch (e) { console.error(`❌ [v2 banc-seau] catalogue (${(e && (e.code || e.name)) || 'erreur'})`); throw erreur('INDISPONIBLE', 'catalogue', 503); }
            if (!(table instanceof Map) || !table.has(idProduct)) throw erreur('ENTREE', 'id-product-inconnu', 422);
        }
        const candidatsVus = vues.length > 0, id = `${scanId}:${carte}`, now = horloge();
        const contenu = { idProduct: idProduct ?? null, aucune: aucune ?? null, via, candidatsVus, vuesN: vues.length, saisieLe: now };
        for (let essai = 0; essai < 3; essai++) {
            const e = await col('verites').findOne({ _id: id });
            if (!e) {
                try { await col('verites').insertOne({ _id: id, seauId: ligne.seauId, scanId, carte, ...contenu, rev: 1, historique: [] }); return { rev: 1, candidatsVus }; }
                catch (x) { if (x && x.code === 11000) continue; throw x; }
            }
            const ancien = { rev: e.rev, idProduct: e.idProduct, aucune: e.aucune, via: e.via, candidatsVus: e.candidatsVus, saisieLe: e.saisieLe };
            const r = await col('verites').updateOne({ _id: id, rev: e.rev }, { $set: { ...contenu, candidatsVus: candidatsVus || e.candidatsVus === true, rev: e.rev + 1 }, $push: { historique: ancien } });
            if (r && r.matchedCount === 1) return { rev: e.rev + 1, candidatsVus: candidatsVus || e.candidatsVus === true };
        }
        throw erreur('CONFLIT', 'concurrence');
    }

    return { preparer, courant, declarer, sceller, enregistrerPhoto, enregistrerMesures, aEtiqueter, lirePhoto, candidats, saisirVerite, verifierChaine: seauId => verifierChaineSeau(colFn, seauId), cadre };
}

module.exports = { creerSeaux, verifierChaineSeau, empreintePhotos, INDEX_SEAU, COLLECTIONS, TYPES, AUCUNE, VIA, CIBLE_JUGE, CIBLE_MAX, SCAN_FRAIS_MS, PHOTOS_MAX, MESURES_OCTETS_MAX, FORME_ID, FORME_SEAU, FORME_SHA, erreur };
