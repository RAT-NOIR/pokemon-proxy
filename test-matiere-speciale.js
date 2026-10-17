// node test-matiere-speciale.js — la table fermée des produits en matière spéciale (lot METAL) et son effet sur la jointure du texte. Objets FABRIQUÉS : aucune base, aucun disque.
// Cas fondateur : 580162 « Charizard [Energy Burn | Fire Spin] » (métal doré, coffret Ultra-Premium de Celebrations), V2 de 576772 (la carte normale de la Classic Collection).
// Décision du testeur (2026-10-17) : un trou, pas un badge — jamais la fiche ni le scan de la carte normale.
'use strict';
const M = require('./collecte-cartes/matiere-speciale');
const { joindre } = require('./collecte-cartes/jointure');
const { ecrireJointure } = require('./collecte-cartes/ecrire-jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// 1. la table : fermée, datée, motivée
verifier('580162 est en matière spéciale', M.estMatiereSpeciale(580162), true);
verifier('576772 (la carte normale) ne l\'est pas', M.estMatiereSpeciale(576772), false);
verifier('un idProduct en chaîne est lu comme le nombre', M.estMatiereSpeciale('580162'), true);
verifier('undefined / null : jamais', [M.estMatiereSpeciale(undefined), M.estMatiereSpeciale(null)], [false, false]);
verifier('la table est gelée', Object.isFrozen(M.PRODUITS_MATIERE_SPECIALE), true);
verifier('chaque entrée porte motif, décision, date et frère normal', Object.values(M.PRODUITS_MATIERE_SPECIALE).every(e => e.motif && e.decision && /^\d{4}-\d\d-\d\d$/.test(e.date) && Number.isInteger(e.frereNormal)), true);
verifier('l\'entrée est gelée aussi', Object.isFrozen(M.PRODUITS_MATIERE_SPECIALE[580162]), true);

// 1 bis. 580161 « Pikachu [Gnaw | Thunder Jolt] » (métal doré, Celebrations Ultra-Premium) : ruling du coordinateur 2026-10-18
verifier('580161 est en matière spéciale', M.estMatiereSpeciale(580161), true);
{
    const c = (id, n, num) => ({ _id: id, nomEn: n, attaques: [], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: num }] });
    const p = (id, num) => ({ idProduct: id, name: 'Pikachu', nom: 'Pikachu', attaques: [], numero: num });
    const J161 = joindre([c(1, 'Pikachu', '5')], [p(576750, '5'), p(580161, '5')], { idExpansion: 4347, expansionBulba: 'Celebrations', tirage: 'intl' });
    verifier('joindre : 580161 ne se joint jamais, son frère normal oui', J161.lignes.map(l => `${l.carteId}|${l.idProduct}`), ['1|576750']);
    let m161 = null; try { M.garderMatiereSpeciale([580161], 'poseur'); } catch (e) { m161 = e.message; }
    verifier('les poseurs câblés (garde) refusent 580161', /580161/.test(m161 || ''), true);
}

// 2. la garde d'écriture : elle LÈVE en nommant le produit (rien n'est écrit)
let msg = null; try { M.garderMatiereSpeciale([576772, 580162], 'test'); } catch (e) { msg = e.message; }
verifier('la garde lève sur un lot qui contient 580162', /580162/.test(msg || ''), true);
verifier('la garde nomme le contexte', /test/.test(msg || ''), true);
verifier('la garde laisse passer un lot sans produit de la table', (() => { try { M.garderMatiereSpeciale([576772, 1, 2], 'test'); return true; } catch (e) { return false; } })(), true);

// 3. la jointure du texte : le produit de la table ne se joint JAMAIS (ni par numéro, ni par nom) ; son frère normal se joint
const carte = (id, nomEn, expansion, tirage, ...numeros) => ({ _id: id, nomEn, attaques: [], impressions: numeros.map(numero => ({ tirage, expansion, numero })) });
const produit = (idProduct, nom, numero) => ({ idProduct, name: nom, nom, attaques: [], numero });
const CEL = 'Celebrations';
const J = joindre([carte(60348, 'Charizard', CEL, 'intl', '4')], [produit(576772, 'Charizard', '4'), produit(580162, 'Charizard', '4')], { idExpansion: 4347, expansionBulba: CEL, tirage: 'intl' });
verifier('Celebrations : seul le frère normal est joint', J.lignes.map(l => `${l.carteId}|${l.idProduct}`), ['60348|576772']);
verifier('Celebrations : 580162 devient un reste « produit-sans-carte » qui le dit', J.restes.filter(r => r.idProduct === 580162).map(r => [r.type, /matière spéciale/.test(r.detail)]), [['produit-sans-carte', true]]);
// par le NOM (carte sans numéro joignable)
const J2 = joindre([carte(60348, 'Charizard', CEL, 'intl')], [produit(580162, 'Charizard', null)], { idExpansion: 4347, expansionBulba: CEL, tirage: 'intl' });
verifier('par le nom aussi : aucune ligne pour 580162', J2.lignes.length, 0);
// un produit ordinaire ne change pas
const J3 = joindre([carte(1, 'Pikachu', CEL, 'intl', '5')], [produit(576750, 'Pikachu', '5')], { idExpansion: 4347, expansionBulba: CEL, tirage: 'intl' });
verifier('un produit ordinaire se joint comme avant', J3.lignes.map(l => `${l.carteId}|${l.idProduct}`), ['1|576750']);

// 3 bis. le CÂBLAGE : chaque chemin qui pose des fiches par métacarte / frères / Setlist appelle la garde AVANT d'écrire (lecture du source : un banc de câblage, pas d'exécution)
{
    const fs = require('fs'), path = require('path');
    const lire = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const f of ['poser-par-metacarte.js', 'poser-fiches-par-freres.js', 'poser-fiches-par-setlist.js']) {
        const s = lire(f), appel = s.indexOf('garderMatiereSpeciale(aEcrire'), ecriture = s.indexOf(".collection('cartes_produits').bulkWrite");
        verifier(`${f} : la garde est appelée AVANT le bulkWrite`, appel > 0 && ecriture > 0 && appel < ecriture, true);
    }
    verifier('jointure.js : `attache` lit la table fermée', /function attache|const attache = [\s\S]{0,400}estMatiereSpeciale\(p\.idProduct\)/.test(lire('collecte-cartes/jointure.js')), true);
    verifier('ecrire-jointure.js : la garde précède l\'upsert des lignes', (() => { const s = lire('collecte-cartes/ecrire-jointure.js'); const a = s.indexOf('garderMatiereSpeciale(J.lignes'), b = s.indexOf('M.CarteProduit.updateOne'); return a > 0 && b > 0 && a < b; })(), true);
}

// 4. l'écriture de la jointure : un lot qui contiendrait une ligne de la table est refusé AVANT toute écriture (défense en profondeur, si `joindre` était contourné)
(async () => {
    const appels = [];
    const M2 = { CarteProduit: { updateOne: async (...a) => { appels.push(['ligne', a]); } }, Reste: { deleteMany: async () => { appels.push(['deleteMany']); }, insertMany: async () => { appels.push(['insertMany']); } }, Carte: { updateOne: async () => { appels.push(['carte']); } } };
    let refus = null;
    try { await ecrireJointure(M2, { slug: 'Celebrations', J: { lignes: [{ _id: '60348|580162', carteId: 60348, idProduct: 580162 }], restes: [] }, produits: [] }); } catch (e) { refus = e.message; }
    verifier('ecrireJointure refuse une ligne de la table', /580162/.test(refus || ''), true);
    verifier('… et n\'écrit RIEN avant de refuser', appels.length, 0);
    await ecrireJointure(M2, { slug: 'Celebrations', J: { lignes: [{ _id: '60348|576772', carteId: 60348, idProduct: 576772 }], restes: [] }, produits: [] });
    verifier('ecrireJointure écrit un lot ordinaire', appels.some(a => a[0] === 'ligne'), true);
    console.log(`\ntest-matiere-speciale : ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
