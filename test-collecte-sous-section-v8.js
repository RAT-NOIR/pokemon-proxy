'use strict';
// Lot V8, tour 2 (B-I2) — BANC DE BOUT EN BOUT d'une ligne à `sousSection`, à travers `collecterSet` lui-même (la fonction du worker), client artofpkm et base FAUX
// en mémoire : aucune requête, aucune base, aucun bucket. La ligne est la VRAIE DHD (table-sets.js + sources-sets.js : liste 176, sous-section 649).
//   · la ligne mesure, télécharge et joint SEULEMENT sa sous-section (le client faux compte ce qu'on lui demande) ;
//   · sous-section absente de la liste → `refuse-sous-section-absente`, rien de demandé au-delà de la liste ;
//   · le REJEU de la jointure (qui relit la liste d'état NON filtrée) écrit le même `completImages` que la collecte (B-I1) ;
//   · une ligne SANS sous-section se comporte comme avant (témoin).
require('./bancs-dossier-arrets');      // les arrêts et pauses durables d'hôtes : un dossier TEMPORAIRE, jamais le vrai (correction 2, M1)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.R2_BUCKET_IMAGES = 'bucket-faux';
const src = require('./collecte-cartes/artofpkm');
const r2 = require('./collecte-cartes/r2');
const { collecterSet, joindreImages } = require('./collecteur-images.js');
const { ligne } = require('./collecte-cartes/table-sets');
const { sourceDe } = require('./collecte-cartes/sources-sets');

let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };
const silencieux = async f => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; try { return await f(); } finally { console.log = l; console.warn = w; console.error = e; } };

// ── la base fausse : les seules formes de requête de collecterSet et de joindreImages ──
function fausseBase() {
    const cols = { cartes: new Map(), images: new Map(), etat: new Map(), sets: new Map(), restes: [] };
    const lire = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
    const ecrire = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        if (k === '$or') return v.some(s => accepte(d, s));
        const x = lire(d, k);
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
            if ('$in' in v) return Array.isArray(x) ? x.some(y => v.$in.map(Number).includes(Number(y)) || v.$in.includes(y)) : v.$in.some(y => y === x || (typeof y === 'number' && Number(x) === y));
            if ('$exists' in v) return (x !== undefined) === v.$exists;
            if ('$ne' in v) return x !== v.$ne;
            if ('$elemMatch' in v) return Array.isArray(x) && x.some(e => accepte(e, v.$elemMatch));
            return false;
        }
        if (v === null) return x == null;
        return Array.isArray(x) && !Array.isArray(v) ? x.includes(v) : x === v;
    });
    const appliquer = (d, u) => {
        for (const [k, v] of Object.entries(u.$set || {})) ecrire(d, k, v);
        for (const k of Object.keys(u.$unset || {})) delete d[k];
        for (const [k, v] of Object.entries(u.$pull || {})) d[k] = (d[k] || []).filter(e => !accepte(e, v));
        for (const [k, v] of Object.entries(u.$push || {})) (d[k] ??= []).push(...(v.$each || [v]));
    };
    const tous = (col, f) => [...col.values()].filter(d => accepte(d, f));
    const requete = liste => ({ lean: async () => structuredClone(liste), select() { return this; } });
    const modele = col => ({
        find: f => requete(tous(col, f)),
        findById: id => requete2(col.get(id) ?? null),
        async countDocuments(f) { return tous(col, f).length; },
        async updateOne(f, u, o = {}) {
            let d = tous(col, f)[0];
            if (!d) { if (!o.upsert) return { matchedCount: 0, modifiedCount: 0 }; d = { _id: f._id }; col.set(d._id, d); }
            appliquer(d, u); return { matchedCount: 1, modifiedCount: 1 };
        },
        // la prise du verrou (verrou-source.js) : upsert, le banc est seul
        findOneAndUpdate(f, u) { let d = col.get(f._id); if (!d) { d = { _id: f._id, ...(u.$setOnInsert || {}) }; col.set(d._id, d); } appliquer(d, u); return { lean: async () => structuredClone(d) }; }
    });
    const requete2 = d => ({ lean: async () => structuredClone(d), select() { return this; } });
    const M = {
        Carte: modele(cols.cartes), Image: modele(cols.images), EtatImages: modele(cols.etat), Set: modele(cols.sets),
        Etat: { findById: () => requete2(null) },
        Reste: { async deleteMany() { cols.restes.length = 0; }, async insertMany(l) { cols.restes.push(...l); } }
    };
    return { cols, M };
}

// ── le monde de DHD : 3 cartes du deck Dialga ; la liste 176 porte aussi 3 entrées du deck Giratina (648), dont une MÊME nom et MÊME numéro (Alpha 001) ──
const SLUG = 'Dialga-Half-Deck', EXP = 'Giratina vs Dialga Deck Kit';
const carte = (id, nomEn, numero, deck = 'Dialga Half Deck', sets = [SLUG]) => ({ _id: id, nomEn, nomJa: null, sets, images: [], impressions: [{ tirage: 'jp', expansion: EXP, deck, numero }] });
const semer = (B, { sans649 = false } = {}) => {
    B.cols.sets.set(SLUG, { _id: SLUG });
    for (const c of [carte(1, 'Alpha', '001'), carte(2, 'Beta', '002'), carte(3, 'Gamma', '003'), carte(9, 'Delta', '001', 'Giratina Half Deck', ['Giratina-Half-Deck'])]) B.cols.cartes.set(c._id, c);
    const e = (sid, n, nom) => ({ titre: nom, sourceSetId: sid, n, original: `https://cdn.faux/${sid}-${n}`, cleCdn: `${sid}-${n}`, vignette: null });
    const l = [e(648, 1, 'Alpha'), e(648, 2, 'Delta'), e(648, 3, 'Zeta'), ...(sans649 ? [] : [e(649, 1, 'Alpha'), e(649, 2, 'Beta'), e(649, 3, 'Gamma')])];
    return l;
};
const NUM = { 648: { 1: '001', 2: '001', 3: '003' }, 649: { 1: '001', 2: '002', 3: '003' } };
const demandes = { listes: 0, mesures: [], pages: [], telechargements: [] };
function brancherLeClientFaux(liste) {
    demandes.listes = 0; demandes.mesures = []; demandes.pages = []; demandes.telechargements = [];
    src.listerSet = async () => { demandes.listes++; const l = liste.map(x => ({ ...x })); Object.defineProperty(l, 'pages', { value: [{ lot: 1, chemin: 'sets/176/cards', lues: l.length, nouvelles: l.length, suites: [] }] }); return l; };
    src.enTeteImage = async url => { demandes.mesures.push(url); return { fmt: 'webp', w: 500, h: 700, octets: 1000, type: 'image/webp' }; };
    src.pageCarte = async (sid, n) => { demandes.pages.push(`${sid}/${n}`); const nom = liste.find(x => x.sourceSetId === sid && x.n === n).titre; return { numero: NUM[sid][n], total: '014', nomEn: nom, nomJa: null, illustrateur: null, rarete: null, setNomSource: 'Fake', setNomJa: null, original: `https://cdn.faux/${sid}-${n}` }; };
    src.telecharger = async url => { demandes.telechargements.push(url); return { buffer: Buffer.from('x'), octets: 1, sha256: `sha-${url}`, w: 500, h: 700, fmt: 'webp', type: 'image/webp' }; };
    r2.deposerBinaire = async () => { };
}
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-soussection-'));

(async () => {
    const L = ligne('DHD'), S = sourceDe('DHD');
    assert.strictEqual(S.sousSection, 649, 'le banc suppose la vraie ligne DHD');
    const B = fausseBase(); const liste = semer(B); brancherLeClientFaux(liste);
    let collecte;
    await t('collecterSet (DHD) sort « verifie »', async () => {
        collecte = await silencieux(() => collecterSet('DHD', B.M, dossier));
        assert.strictEqual(collecte.etat, 'verifie', JSON.stringify(collecte).slice(0, 200));
    });
    await t('MESURE : seulement des entrées de la sous-section 649', () => {
        assert.ok(demandes.mesures.length > 0 && demandes.mesures.every(u => /649-/.test(u)), demandes.mesures.join(','));
    });
    await t('TÉLÉCHARGEMENT : 3 pages et 3 originaux, tous de la sous-section 649 (rien du deck Giratina)', () => {
        assert.deepStrictEqual(demandes.pages.sort(), ['649/1', '649/2', '649/3']);
        assert.deepStrictEqual(demandes.telechargements.sort(), ['https://cdn.faux/649-1', 'https://cdn.faux/649-2', 'https://cdn.faux/649-3']);
    });
    await t('JOINTURE : les 3 cartes reçoivent l\'image de 649 ; aucune image de 648 n\'est jointe', () => {
        const cles = [1, 2, 3].map(id => B.cols.cartes.get(id).images.map(i => i.cleR2).join('|'));
        assert.deepStrictEqual(cles, ['artofpkm/649/1.webp', 'artofpkm/649/2.webp', 'artofpkm/649/3.webp']);
        assert.ok([...B.cols.images.values()].every(d => d.sourceSetId === 649), 'un document image d\'une autre sous-section a été écrit');
    });
    await t('COMPLÉTUDE : entrées source = 3 (la sous-section), 3 cartes couvertes, concordance vraie', () => {
        const c = B.cols.sets.get(SLUG).completImages;
        assert.strictEqual(c.entreesSource, 3, `entreesSource ${c.entreesSource}`); assert.strictEqual(c.cartesCouvertes, 3); assert.strictEqual(c.concordance, true);
    });
    await t('REJEU (liste d\'état NON filtrée, comme --rejouer-jointure) : le MÊME completImages que la collecte (B-I1)', async () => {
        const avant = B.cols.sets.get(SLUG).completImages;
        const r = await silencieux(() => joindreImages(B.M, L, SLUG, S, { 176: liste }, {}, dossier, { silencieux: true }));
        for (const k of ['entreesSource', 'cartesDuSet', 'imagesOk', 'rattachements', 'cartesCouvertes', 'emplacements', 'concordance']) assert.deepStrictEqual(r[k], avant[k], `${k} : rejeu ${JSON.stringify(r[k])} ≠ collecte ${JSON.stringify(avant[k])}`);
    });
    await t('SOUS-SECTION ABSENTE de la liste : « refuse-sous-section-absente », aucun original demandé', async () => {
        const B2 = fausseBase(); const l2 = semer(B2, { sans649: true }); brancherLeClientFaux(l2);
        const r = await silencieux(() => collecterSet('DHD', B2.M, dossier));
        assert.strictEqual(r.etat, 'refuse-sous-section-absente', JSON.stringify(r));
        assert.strictEqual(demandes.telechargements.length, 0); assert.strictEqual(demandes.pages.length, 0);
    });
    console.log(`\n${ok} réussi(s), ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ÉCHEC DU BANC', e.stack || e.message); process.exit(2); });
