'use strict';
// LEDGER-COURSE — un rejeu simultané après remboursement doit rendre un REJEU, jamais un refus, même quand le gagnant a pris la dernière poche
// et n'a pas encore écrit son mouvement. Course ORDONNÉE (déterministe) : l'insertion du mouvement du gagnant est retenue jusqu'à ce que le perdant
// ait regardé une première fois si la clé existe.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
let n = 0;
const compte = async (o = {}) => { const c = M.nouveauCompte({ email: `r${++n}@x.fr`, emailCle: `r${n}@x.fr`, motDePasse: {} }); Object.assign(c, { verifie: true }, o); await db.col('comptes').insertOne(c);
    return { type: 'compte', id: c._id, compte: c, installation: null, surface: 'scanner', administrateur: false }; };
const lire = p => db.col('comptes').findOne({ _id: p.id });
(async () => {
    await H.ouvrirBac('test-argent-course-rejeu.js'); await M.creerIndex();
    const t = new Date('2026-10-10T10:00:00Z');
    // OFFRE-QUOTA : « la dernière poche » est la DERNIÈRE unité du quota du jour (compte gratuit : 10, dont 9 déjà prises)
    const p = await compte();
    const cnt = async () => (await db.col('quota_jour').findOne({ porteur: `compte:${p.id}`, jour: '2026-10-10' })).count;
    await db.col('quota_jour').insertOne({ porteur: `compte:${p.id}`, jour: '2026-10-10', count: 9, expireLe: new Date('2026-12-01') });
    const x1 = await Lg.debiter(p, { scanId: 'cr', cleIdempotence: 'cle-cr', maintenant: t }, cfg);
    await Lg.rembourser(p, x1.credit, 'ia-echec', { scanId: 'cr', maintenant: t }, cfg);
    H.v('départ : débit remboursé, une seule unité devant soi (compteur 9 sur 10)', await cnt(), 9);
    // le crochet : la 1re insertion d'un mouvement « retry » est retenue jusqu'à la 1re lecture de cette clé par un AUTRE appel
    const colReel = db.col; let retenue = false, lectures = 0, ouvrir; const porte = new Promise(r => { ouvrir = r; });
    db.col = nom => {
        const c = colReel(nom); if (nom !== 'mouvements') return c;
        return new Proxy(c, { get: (cible, k) => {
            if (k === 'insertOne') return async doc => { if (!retenue && String(doc.cleIdempotence).includes('|retry|')) { retenue = true; await porte; } return cible.insertOne(doc); };
            if (k === 'findOne') return async (f, ...r) => { const res = await cible.findOne(f, ...r); if (retenue && f && String(f.cleIdempotence).includes('|retry|') && ++lectures === 1) setTimeout(ouvrir, 5); return res; };
            return typeof cible[k] === 'function' ? cible[k].bind(cible) : cible[k];
        } });
    };
    let rs; try { rs = await Promise.all([1, 2].map(() => Lg.debiter(p, { scanId: 'cr', cleIdempotence: 'cle-cr', maintenant: t }, cfg))); } finally { db.col = colReel; }
    H.v('le crochet a bien ordonné la course (insertion retenue, perdant a lu la clé), dénominateur 2', [retenue, lectures >= 1, rs.length], [true, true, 2]);
    H.v('2 rejeux simultanés, dernière poche : les 2 ok (dénominateur 2)', rs.map(r => r.ok), [true, true]);
    H.v('   exactement UN nouveau débit (reessaye) et UN rejeu', [rs.filter(r => r.reessaye).length, rs.filter(r => r.rejoue).length], [1, 1]);
    H.v('   compteur 10 (ni unité en trop ni rendue en trop), un seul débit « debite »', [await cnt(), await db.col('mouvements').countDocuments({ compteId: p.id, type: 'debit', etat: 'debite' })], [10, 1]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
