'use strict';
// Lot W-RESIL2 — une exception levée APRÈS la prise du verrou de set, au milieu de `collecterSet`, doit arrêter le battement
// (sinon le processus ne sort pas seul après SIGTERM : le minuteur garde la boucle d'événements vivante) et TENTER le rendu.
// Base et client artofpkm FAUX, en mémoire : aucune requête, aucune base, aucun bucket.
//   · erreur passagère à la liste, à la mesure, au téléchargement fatal (pageCarte est rattrapée par le collecteur : on lève ailleurs) ;
//   · l'erreur d'origine remonte INCHANGÉE (même objet) ;
//   · un rendu qui échoue (base coupée) ne masque pas l'erreur d'origine et ne relance pas le battement ;
//   · témoin : un retour nommé garde sa valeur, le verrou est rendu, aucun minuteur n'est resté armé.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.R2_BUCKET_IMAGES = 'bucket-faux';

// ── suivi des minuteurs de battement (setInterval/clearInterval globaux, seuls appelants : verrou-source) ──
const armes = new Set();
const setI = global.setInterval, clearI = global.clearInterval;
global.setInterval = (f, ms, ...a) => { const h = setI(f, ms, ...a); armes.add(h); return h; };
global.clearInterval = h => { armes.delete(h); return clearI(h); };

const src = require('./collecte-cartes/artofpkm');
const r2 = require('./collecte-cartes/r2');
const { collecterSet } = require('./collecteur-images.js');

let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };
const silencieux = async f => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; try { return await f(); } finally { console.log = l; console.warn = w; console.error = e; } };

function fausseBase() {
    const col = new Map();
    const lire = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
    const ecrire = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const appliquer = (d, u) => { for (const [k, v] of Object.entries(u.$set || {})) ecrire(d, k, v); for (const k of Object.keys(u.$unset || {})) delete d[k]; };
    const req = d => ({ lean: async () => structuredClone(d), select() { return this; } });
    const journal = { unset: 0 };
    const EtatImages = {
        findById: id => req(col.get(id) ?? null),
        async updateOne(f, u) {
            if (u.$unset && journal.rendreEchoue) { journal.unset++; throw new Error('base coupée (rendu)'); }
            const d = col.get(f._id); if (!d) return { matchedCount: 0, modifiedCount: 0 };
            if (u.$unset) journal.unset++;
            appliquer(d, u); return { matchedCount: 1, modifiedCount: 1 };
        },
        findOneAndUpdate(f, u) { let d = col.get(f._id); if (!d) { d = { _id: f._id, ...(u.$setOnInsert || {}) }; col.set(d._id, d); } appliquer(d, u); return { lean: async () => structuredClone(d) }; }
    };
    const vide = { find: () => req([]), findById: () => req(null), countDocuments: async () => 3, updateOne: async () => ({ matchedCount: 0 }) };
    const M = { Carte: vide, Image: vide, EtatImages, Set: vide, Etat: { findById: () => req(null) }, Reste: vide };
    return { M, col, journal };
}
const entree = (sid, n) => ({ titre: `C${n}`, sourceSetId: sid, n, original: `https://cdn.faux/${sid}-${n}`, cleCdn: `${sid}-${n}`, vignette: null });
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'resil2-'));
const CODE = 'DHD';   // une vraie ligne de table + source (comme test-collecte-sous-section-v8.js)

const brancher = ({ listeLeve = null, mesureLeve = null } = {}) => {
    src.listerSet = async () => {
        if (listeLeve) throw listeLeve;
        const l = [1, 2, 3].map(n => entree(649, n)); Object.defineProperty(l, 'pages', { value: [{ lot: 1, chemin: 'sets/176/cards', lues: 3, nouvelles: 3, suites: [] }] }); return l;
    };
    src.enTeteImage = async () => { if (mesureLeve) throw mesureLeve; return { fmt: 'webp', w: 500, h: 700, octets: 1000, type: 'image/webp' }; };
    src.pageCarte = async () => ({}); src.telecharger = async () => ({}); r2.deposerBinaire = async () => { };
};
const passagere = msg => Object.assign(new Error(msg), { code: 'ECONNRESET' });

(async () => {
    await t('exception à la LISTE (après la prise) : le battement est arrêté, le verrou rendu, l\'erreur remonte inchangée', async () => {
        const B = fausseBase(); const e = passagere('connexion coupée (liste)'); brancher({ listeLeve: e });
        const avant = armes.size;
        let levee = null; try { await silencieux(() => collecterSet(CODE, B.M, dossier)); } catch (x) { levee = x; }
        assert.strictEqual(levee, e, 'l\'erreur d\'origine doit remonter inchangée (même objet)');
        assert.strictEqual(armes.size, avant, `${armes.size - avant} minuterie(s) de battement restée(s) armée(s)`);
        assert.strictEqual(B.journal.unset, 1, 'le rendu n\'a pas été tenté');
    });
    await t('exception à la MESURE : idem', async () => {
        const B = fausseBase(); const e = passagere('connexion coupée (mesure)'); brancher({ mesureLeve: e });
        const avant = armes.size;
        let levee = null; try { await silencieux(() => collecterSet(CODE, B.M, dossier)); } catch (x) { levee = x; }
        assert.strictEqual(levee, e); assert.strictEqual(armes.size, avant, 'minuterie restée armée'); assert.strictEqual(B.journal.unset, 1);
    });
    await t('le rendu échoue aussi (base coupée) : l\'erreur d\'origine n\'est pas masquée, aucune minuterie armée', async () => {
        const B = fausseBase(); B.journal.rendreEchoue = true; const e = passagere('connexion coupée (liste)'); brancher({ listeLeve: e });
        const avant = armes.size;
        let levee = null; try { await silencieux(() => collecterSet(CODE, B.M, dossier)); } catch (x) { levee = x; }
        assert.strictEqual(levee, e, `erreur remontée : ${levee && levee.message}`); assert.strictEqual(armes.size, avant, 'minuterie restée armée'); assert.strictEqual(B.journal.unset, 1, 'rendu non tenté');
    });
    await t('TÉMOIN retour nommé : « refuse-liste-vide » garde sa valeur, rendu une seule fois, aucune minuterie', async () => {
        const B = fausseBase(); brancher(); src.listerSet = async () => { const l = []; Object.defineProperty(l, 'pages', { value: [{ lot: 1, chemin: 'x', lues: 0, nouvelles: 0, suites: [] }] }); return l; };
        const avant = armes.size;
        const r = await silencieux(() => collecterSet(CODE, B.M, dossier));
        assert.ok(r && typeof r.etat === 'string' && r.etat !== 'verifie', JSON.stringify(r));
        assert.strictEqual(armes.size, avant); assert.strictEqual(B.journal.unset, 1, `rendus : ${B.journal.unset}`);
    });
    console.log(`\n${ok} réussi(s), ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ÉCHEC DU BANC', e.stack || e.message); process.exit(2); });
