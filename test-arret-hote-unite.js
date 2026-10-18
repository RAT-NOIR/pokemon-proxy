// node test-arret-hote-unite.js — CORRECTION 2 (I1) : un arrêt durable ou une pause d'hôte, levé PENDANT une unité artofpkm (liste, mesure, première page de carte), ne fait ni planter
// le worker ni brûler la file : le collecteur RENDS un bilan « arret-hote » / « pause-hote », et issueDeLUnite en fait une unité EN ATTENTE, avec l'ordre d'ARRÊTER la boucle pour cet hôte.
// Aucune requête (les fonctions du client artofpkm sont remplacées), aucune base réelle (modèles en mémoire), dossier de pauses TEMPORAIRE.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.env.R2_BUCKET_IMAGES = 'bucket-faux';
process.env.ARRETS_HOTES_DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'arret-unite-'));
const src = require('./collecte-cartes/artofpkm');
const r2 = require('./collecte-cartes/r2');
const { collecterSet } = require('./collecteur-images.js');
const { issueDeLUnite, bilanDeLException } = require('./collecte-cartes/issue-unite');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const silencieux = async f => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; try { return await f(); } finally { console.log = l; console.warn = w; console.error = e; } };

function fausseBase() {
    const col = new Map();
    const ecrire = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const appliquer = (d, u) => { for (const [k, v] of Object.entries(u.$set || {})) ecrire(d, k, v); for (const k of Object.keys(u.$unset || {})) delete d[k]; };
    const req = d => ({ lean: async () => structuredClone(d), select() { return this; } });
    const rendus = { n: 0 };
    const EtatImages = {
        findById: id => req(col.get(id) ?? null),
        async updateOne(f, u) { if (u.$unset) rendus.n++; const d = col.get(f._id); if (!d) return { matchedCount: 0 }; appliquer(d, u); return { matchedCount: 1 }; },
        findOneAndUpdate(f, u) { let d = col.get(f._id); if (!d) { d = { _id: f._id, ...(u.$setOnInsert || {}) }; col.set(d._id, d); } appliquer(d, u); return { lean: async () => structuredClone(d) }; }
    };
    const echecs = [];
    const Image = { find: () => req([]), findById: () => req(null), countDocuments: async () => 3, async updateOne(f, u) { if (u.$set?.etat === 'echec') echecs.push(f._id); return { matchedCount: 0 }; } };
    const vide = { find: () => req([]), findById: () => req(null), countDocuments: async () => 3, updateOne: async () => ({ matchedCount: 0 }) };
    return { M: { Carte: vide, Image, EtatImages, Set: vide, Etat: { findById: () => req(null) }, Reste: vide }, rendus, echecs };
}
const entree = (sid, n) => ({ titre: `C${n}`, sourceSetId: sid, n, original: `https://cdn.faux/${sid}-${n}`, cleCdn: `${sid}-${n}`, vignette: null });
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'arret-unite-doss-'));
const CODE = 'DHD';
const arretDurable = () => Object.assign(new Error('artofpkm.com ARRÊTÉ DÉFINITIVEMENT (HTTP 403) — aucune requête tant que le coordinateur ne l\'a pas levé'), { bloque: true, arretDefinitif: true, hote: 'artofpkm.com', motif: 'HTTP 403' });
const pause = () => Object.assign(new Error('artofpkm.com EN PAUSE pour ce processus (plus de 20 fausses pages)'), { pauseHote: true, hote: 'artofpkm.com', motif: 'plus de 20 fausses pages' });
const brancher = ({ liste = null, mesure = null, page = null } = {}) => {
    const compte = { liste: 0, mesure: 0, page: 0, tele: 0 };
    src.listerSet = async () => { compte.liste++; if (liste) throw liste(); const l = [1, 2, 3].map(n => entree(649, n)); Object.defineProperty(l, 'pages', { value: [{ lot: 1, chemin: 'sets/176/cards', lues: 3, nouvelles: 3, suites: [] }] }); return l; };
    src.enTeteImage = async () => { compte.mesure++; if (mesure) throw mesure(); return { fmt: 'webp', w: 500, h: 700, octets: 1000, type: 'image/webp' }; };
    src.pageCarte = async () => { compte.page++; if (page) throw page(); return {}; };
    src.telecharger = async () => { compte.tele++; return {}; };
    r2.deposerBinaire = async () => { };
    return compte;
};
const lancer = async (B) => { let leve = null, b = null; try { b = await silencieux(() => collecterSet(CODE, B.M, dossier)); } catch (e) { leve = e; } return { b, leve }; };

(async () => {
    let B = fausseBase(), c = brancher({ liste: arretDurable });
    let { b, leve } = await lancer(B);
    verifier('I1 artofpkm : un ARRÊT DURABLE levé par la LISTE → aucun plantage, bilan « arret-hote », aucune requête de mesure ni de fichier', [leve, b?.etat, c.mesure, c.tele, b?.arretHote?.hote], [null, 'arret-hote', 0, 0, 'artofpkm.com']);
    verifier('I1 artofpkm : …l\'unité revient en ATTENTE et la boucle s\'ARRÊTE (jamais « refuse »), le verrou de set est rendu', [issueDeLUnite(b, {}), B.rendus.n >= 1], [{ etat: 'attente', arreter: true }, true]);
    B = fausseBase(); c = brancher({ mesure: arretDurable });
    ({ b, leve } = await lancer(B));
    verifier('I1 artofpkm : un ARRÊT DURABLE levé par la MESURE (enTeteImage) → aucun plantage, « arret-hote », attente + arrêt', [leve, b?.etat, c.tele, issueDeLUnite(b, {})], [null, 'arret-hote', 0, { etat: 'attente', arreter: true }]);
    B = fausseBase(); c = brancher({ liste: pause });
    ({ b, leve } = await lancer(B));
    verifier('I1 artofpkm : une PAUSE du processus levée par la LISTE → « pause-hote » (pauseHote nommé), attente + arrêt', [leve, b?.etat, b?.pauseHote?.hote, issueDeLUnite(b, {})], [null, 'pause-hote', 'artofpkm.com', { etat: 'attente', arreter: true }]);
    B = fausseBase(); c = brancher({ mesure: pause });
    ({ b, leve } = await lancer(B));
    verifier('I1 artofpkm : une PAUSE levée par la MESURE → « pause-hote », attente + arrêt', [leve, b?.etat, issueDeLUnite(b, {})], [null, 'pause-hote', { etat: 'attente', arreter: true }]);
    B = fausseBase(); c = brancher({ page: arretDurable });
    ({ b, leve } = await lancer(B));
    verifier('I1 artofpkm : un ARRÊT DURABLE levé par la PREMIÈRE page de carte → « arret-hote », une seule page demandée, attente + arrêt', [leve, b?.etat, c.page, c.tele, issueDeLUnite(b, {})], [null, 'arret-hote', 1, 0, { etat: 'attente', arreter: true }]);
    B = fausseBase(); c = brancher({ page: pause });
    ({ b, leve } = await lancer(B));
    verifier('I1 artofpkm : une PAUSE levée par la première page de carte → « pause-hote », attente + arrêt', [leve, b?.etat, issueDeLUnite(b, {})], [null, 'pause-hote', { etat: 'attente', arreter: true }]);
    // une AUTRE exception garde son chemin (le worker la voit : ce lot ne cache rien d'autre)
    B = fausseBase(); c = brancher({ liste: () => Object.assign(new Error('connexion coupée'), { code: 'ECONNRESET' }) });
    ({ b, leve } = await lancer(B));
    verifier('une exception ordinaire (réseau) n\'est PAS avalée : elle remonte, comme avant', [leve?.message, b], ['connexion coupée', null]);
    // l'exception d'un collecteur de FICHIERS (tcgdex, tpc, pikaqian) passe par bilanDeLException dans le worker
    verifier('I1 worker : une exception d\'arrêt durable / de pause levée par un collecteur → bilan « arret-hote » / « pause-hote » (jamais « erreur »), attente + arrêt', [bilanDeLException('SV1', arretDurable()).etat, bilanDeLException('SV1', pause()).etat, issueDeLUnite(bilanDeLException('SV1', arretDurable()), {}), issueDeLUnite(bilanDeLException('SV1', pause()), {})],
        ['arret-hote', 'pause-hote', { etat: 'attente', arreter: true }, { etat: 'attente', arreter: true }]);
    void assert;
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ le banc a levé :', e.stack); process.exit(1); });
