'use strict';
// Banc MODELE-VISUEL-API tour 2 (M6 / I1) — l'EXCLUSION câblée dans les lecteurs de `analyses` : un scan dont le résultat a été changé par le vecteur de l'extension (`analyses.empreinteExtension.influence`) n'entre jamais dans la ligne du banc
// partagé (banc/etiquette-ligne.js), et une ligne qui porterait le marqueur n'est jamais exportée (mesures/exporter-banc-admin.js). Collections FABRIQUÉES en mémoire : aucune base, aucun bucket, aucun réseau.
// La variante qui affirme l'inverse (même analyse SANS marqueur ⇒ la ligne s'écrit) prouve que le banc sait échouer.
const H = require('./_harnais');
const fs = require('fs'), os = require('os'), path = require('path');
const mongoose = require('mongoose');
const { creerEtiquetteLigne } = require('../banc/etiquette-ligne');
const { exporterBancAdmin } = require('../mesures/exporter-banc-admin');
const { lireConfig } = require('../config');

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const SCAN = new mongoose.Types.ObjectId().toString();
const CLE = 'banc-reel/v2/' + 'a'.repeat(32) + '.webp';
function monde(marqueur) {
    const inserts = [], marques = [];
    const analyse = { _id: new mongoose.Types.ObjectId(SCAN), cartes: [{ idProduct: 1, statut: 'identifiee', etiquetteAdmin: { rev: 1, idProduct: 1 } }], photoBanc: { cle: CLE, sha256: 'b'.repeat(64) }, versionChaine: 'abc1234', versionModele: 'm.1', creeLe: new Date(), ...(marqueur ? { empreinteExtension: marqueur } : {}) };
    const colFn = nom => ({
        findOne: async () => (nom === 'analyses' ? analyse : null),
        insertOne: async d => { inserts.push(d); return { acknowledged: true }; },
        updateOne: async (f, u) => { marques.push(u); return { matchedCount: 1 }; }
    });
    const stockage = { lire: async () => Buffer.from('photo-banc'), ecrire: async () => { }, supprimer: async () => { } };
    const ligne = creerEtiquetteLigne({ cfg, colFn, pret: async () => stockage, sel: () => 'sel-de-banc', horloge: () => new Date(), borner: p => p });
    return { ligne, inserts, marques };
}

(async () => {
    const a = monde({ utilisee: true, code: null, influence: true, promotion: true, lectureConcordante: true, modele: 'm' });
    H.v('1a. scan changé par le vecteur (promotion) : AUCUNE ligne de banc partagée', [await a.ligne.etiquetteAdmin({ scanId: SCAN, carte: 0 }), a.inserts.length], ['exclue-empreinte', 0]);
    H.vrai('1b. … et l\'état « exclue-empreinte » sort la carte de l\'attente (la marque d\'analyse est retirée, pas de reprise sans fin)', a.marques.some(u => u.$unset && 'bancAttente' in u.$unset));
    const b = monde({ utilisee: true, code: null, influence: false, promotion: false, lectureConcordante: false, modele: 'm' });
    H.v('2. 🔑 variante : le vecteur n\'a rien changé (influence faux) ⇒ la ligne s\'écrit — l\'exclusion ne vient donc pas d\'une écriture qui échoue partout', [await b.ligne.etiquetteAdmin({ scanId: SCAN, carte: 0 }), b.inserts.length], ['ecrit', 1]);
    const c = monde(null);
    H.v('3. variante : analyse sans marqueur (cas d\'avant) ⇒ la ligne s\'écrit', [await c.ligne.etiquetteAdmin({ scanId: SCAN, carte: 0 }), c.inserts.length], ['ecrit', 1]);
    const d = monde({ influence: 'oui' });
    H.v('4. un marqueur mal formé (influence non booléen vrai) : écrit comme avant, jamais exclu à tort', d.inserts.length === 0 && (await d.ligne.etiquetteAdmin({ scanId: SCAN, carte: 0 })) === 'ecrit', true);

    // l'exporteur : une ligne portant le marqueur n'est pas exportée
    const dossier = path.join(os.tmpdir(), `exp-empreinte-${process.pid}-${Date.now()}`);
    const lignes = [{ _id: 'l1', source: 'etiquette-admin', etat: 'confirmee', cleR2: CLE, verite: 1, reponse: { statut: 'identifiee', idProduct: 1 }, rev: 1 }, { _id: 'l2', source: 'etiquette-admin', etat: 'confirmee', cleR2: CLE, verite: 2, reponse: { statut: 'identifiee', idProduct: 2 }, rev: 1, empreinteExtension: true }];
    const colFn = nom => ({ find: () => ({ sort: () => ({ toArray: async () => (nom === 'banc_lignes' ? lignes : []) }) }), countDocuments: async () => 0 });
    const r = await exporterBancAdmin({ dossier, colFn, stockage: { lire: async () => Buffer.from('photo') }, base: 'test_scratch' });
    const man = JSON.parse(fs.readFileSync(path.join(dossier, 'manifeste.json'), 'utf8')), lg = JSON.parse(fs.readFileSync(path.join(dossier, 'lignes.json'), 'utf8'));
    H.v('5. exporteur : la ligne marquée n\'est pas exportée, le manifeste COMPTE l\'exclusion', [lg.map(x => x.id), man.exclues, man.lignes], [['l1'], 1, 1]);
    void r;
    fs.rmSync(dossier, { recursive: true, force: true });
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
