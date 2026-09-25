// node test-garde-lot.js — la garde de lot (collecte-cartes/garde-lot.js), fonctions pures, aucune base.
// La règle du testeur (2026-09-24) : chaque lot compare, set par set, fiches, illustrateurs, images et noms, avant et
// après ; un compteur qui baisse sans avoir été annoncé arrête le lot, qui se restaure depuis sa sauvegarde.
// Le cas d'école est celui du §59 : le lot AJOUTE ce qu'il annonce (le total monte) et efface À CÔTÉ.
const { compterEtat, comparer, planRestauration, cleDoc } = require('./collecte-cartes/garde-lot');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const copie = o => structuredClone(o);

const etat0 = {
    cartes: [
        { _id: 1, nomEn: 'Blastoise', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '2', illustrateur: 'Ken Sugimori', illustrateurPreuve: 'tcgdex:a-2' }], images: [{ set: 'Set-A', numero: '2', cleR2: 'a/2' }] },
        { _id: 2, nomEn: 'Pikachu', sets: ['Set-A', 'Set-B'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '58', illustrateur: null }, { tirage: 'jp', expansion: 'Set B', numero: '25' }], images: [{ set: 'Set-B', numero: '25', cleR2: 'b/25', jointeLe: new Date('2026-09-20T10:00:00Z') }] }
    ],
    cartesProduits: [
        { _id: 'p1', idProduct: 100, idExpansion: 11, carteId: 1 },
        { _id: 'p2', idProduct: 101, idExpansion: 11, carteId: 2 },
        { _id: 'p2b', idProduct: 101, idExpansion: 11, carteId: 2, preuve: 'doublon de ligne' },
        { _id: 'p3', idProduct: 200, idExpansion: 12, carteId: 2 }
    ],
    sets: [{ _id: 'Set-A', nomAffichage: 'Set A' }, { _id: 'Set-B', nomAffichage: 'Set B' }, { _id: 'Set-C' }]
};
const avant = compterEtat(etat0);

// ── 1. LES COMPTEURS, un par groupe
verifier('fiches : produits DISTINCTS par expansion (une ligne en double ne fait pas une fiche de plus)', [avant.get('fiches exp:11'), avant.get('fiches exp:12')], [2, 1]);
verifier('illustrateurs : champ posé, null compris ; nommés : une chaîne', [avant.get('illustrateurs imp:intl|Set A'), avant.get('illustrateurs-nommes imp:intl|Set A'), avant.get('illustrateurs imp:jp|Set B') ?? 0], [2, 1, 0]);
verifier('impressions : toutes, par tirage et expansion (sans illustrateur comprises)', [avant.get('impressions imp:intl|Set A'), avant.get('impressions imp:jp|Set B')], [2, 1]);
// 2026-09-24 : une impression écrite depuis la Setlist n'a pas d'illustrateur ; si une relecture l'efface, le compteur
// « illustrateurs » ne bouge pas. Celui-ci, oui.
const lotImp = copie(etat0);
lotImp.cartes[1].impressions = lotImp.cartes[1].impressions.filter(i => i.tirage !== 'jp');
verifier('une impression SANS illustrateur effacée est une baisse', comparer(avant, compterEtat(lotImp)).nonAutorisees.map(b => `${b.cle} ${b.avant}→${b.apres}`), ['impressions imp:jp|Set B 1→0']);
verifier('images, cartes, noms de cartes, nom affiché : par set', [avant.get('images set:Set-A'), avant.get('images set:Set-B'), avant.get('cartes set:Set-A'), avant.get('noms-cartes set:Set-B'), avant.get('nom-affiche set:Set-A'), avant.get('nom-affiche set:Set-C') ?? 0], [1, 1, 2, 1, 1, 0]);

// ── 2. LE CAS DU §59 : +1 fiche annoncée, un illustrateur effacé à côté. Le total monte, le groupe baisse.
const lot = copie(etat0);
lot.cartesProduits.push({ _id: 'p4', idProduct: 300, idExpansion: 13, carteId: 1 });
delete lot.cartes[0].impressions[0].illustrateur;
const c1 = comparer(avant, compterEtat(lot));
verifier('§59 : la baisse d\'un groupe est vue alors que le total des fiches monte', c1.nonAutorisees.map(b => `${b.cle} ${b.avant}→${b.apres}`), ['illustrateurs imp:intl|Set A 2→1', 'illustrateurs-nommes imp:intl|Set A 1→0']);
verifier('§59 : la hausse est comptée à part', c1.hausses, { fiches: 1 });

// ── 3. ANNONCÉE par le dry-run : elle passe ; annoncée TROP PETITE : elle bloque
const annonce = { 'illustrateurs imp:intl|Set A': 1, 'illustrateurs-nommes imp:intl|Set A': 1 };
verifier('baisse annoncée : autorisée', comparer(avant, compterEtat(lot), { annonces: annonce }).nonAutorisees.length, 0);
const lot2 = copie(etat0);
lot2.cartesProduits = lot2.cartesProduits.filter(l => l.idExpansion !== 11);
verifier('baisse PLUS GRANDE que l\'annonce : bloquée', comparer(avant, compterEtat(lot2), { annonces: { 'fiches exp:11': 1 } }).nonAutorisees.map(b => `${b.cle} −${b.baisse} (annoncé ${b.annonce})`), ['fiches exp:11 −2 (annoncé 1)']);
verifier('un groupe qui DISPARAÎT est une baisse (jusqu\'à 0), pas une absence', comparer(avant, compterEtat(lot2)).nonAutorisees.map(b => b.apres), [0]);

// ── 4. LE WORKER : une baisse d'IMAGES n'est autorisée que dans un set où il a travaillé pendant la fenêtre
const lot3 = copie(etat0);
lot3.cartes[1].images = [];
verifier('images en baisse hors des sets du worker : bloquée', comparer(avant, compterEtat(lot3), { setsDuWorker: new Set(['Set-A']) }).nonAutorisees.map(b => b.cle), ['images set:Set-B']);
verifier('images en baisse dans un set du worker : autorisée, et dite « worker »', comparer(avant, compterEtat(lot3), { setsDuWorker: new Set(['Set-B']) }).baisses.map(b => b.autorisee), ['worker']);
const lot4 = copie(etat0);
lot4.cartesProduits = lot4.cartesProduits.filter(l => l.idExpansion !== 12);
verifier('le worker n\'autorise QUE des images (une fiche de son set reste bloquée)', comparer(avant, compterEtat(lot4), { setsDuWorker: new Set(['Set-A', 'Set-B', '12']) }).nonAutorisees.map(b => b.cle), ['fiches exp:12']);

// ── 5. LA RESTAURATION : ce que la sauvegarde porte revient, les champs du worker restent tels qu'il les a écrits
const map = docs => new Map(docs.map(d => [cleDoc(d._id), d]));
const actuel = copie(lot);
actuel.cartes[1].images.push({ set: 'Set-B', numero: '26', cleR2: 'b/26' });              // le worker a joint une image pendant le lot
const garderImages = ['images'];
const pC = planRestauration(map(etat0.cartes), map(actuel.cartes), { garder: () => garderImages });
verifier('cartes : la carte à l\'illustrateur effacé est remplacée, celle où seul le worker a écrit ne l\'est pas', pC.remplacer.map(d => d._id), [1]);
verifier('cartes : l\'illustrateur revient', pC.remplacer[0].impressions[0].illustrateur, 'Ken Sugimori');
verifier('cartes : ce qui a changé, par champ', pC.champs, { impressions: 1 });
const pP = planRestauration(map(etat0.cartesProduits), map(actuel.cartesProduits));
verifier('cartes_produits : la ligne ajoutée par le lot est retirée, rien d\'autre', [pP.supprimer, pP.inserer.length, pP.remplacer.length], [['p4'], 0, 0]);
const actuel2 = copie(lot3);
const pI = planRestauration(map(etat0.cartes), map(actuel2.cartes), { garder: () => [] });
verifier('images effacées par le LOT : quand le champ n\'est pas gardé, elles reviennent', pI.remplacer.map(d => d.images.length), [1]);
const pD = planRestauration(map(etat0.cartes), map([actuel.cartes[0]]));
verifier('un document supprimé par le lot est réinséré tel que sauvé (Date comprise)', [pD.inserer.map(d => d._id), pD.inserer[0].images[0].jointeLe instanceof Date], [[2], true]);
verifier('clé de document : 12 et « 12 » ne se confondent pas', cleDoc(12) === cleDoc('12'), false);
verifier('un document identique à l\'ordre des clés près n\'est pas réécrit', planRestauration(map([{ _id: 5, a: 1, b: { c: 1, d: 2 } }]), map([{ b: { d: 2, c: 1 }, a: 1, _id: 5 }])).remplacer.length, 0);

// ── LES SETS TOUCHÉS (2026-09-25) : ce que la revalidation du site demande. Une date, un numeroFiche, une image remplacée ne
// font bouger AUCUN compteur ; les documents, si. Un set dont un document a changé est touché, et lui seul.
const { setsTouches } = require('./collecte-cartes/garde-lot');
const docs0 = copie(etat0);
verifier('rien n\'a changé : aucun set touché, ni catalogue ni espèces', setsTouches({ avant: docs0, apres: copie(etat0) }), { sets: [], catalogue: false, especes: false });
const lDate = copie(etat0); lDate.sets[0].dateSortieEn = 'May 30, 2025';
verifier('une date posée sur un set : ce set, et le catalogue', setsTouches({ avant: docs0, apres: lDate }), { sets: ['Set-A'], catalogue: true, especes: false });
const lFiche = copie(etat0); lFiche.cartesProduits[3].numeroFiche = '25'; lFiche.cartesProduits[3].slugSet = 'Set-B';
const d0b = copie(etat0); d0b.cartesProduits[3].slugSet = 'Set-B';
verifier('un numeroFiche posé sur une ligne : le set de la ligne, pas le catalogue', setsTouches({ avant: d0b, apres: lFiche }), { sets: ['Set-B'], catalogue: false, especes: false });
const lImg = copie(etat0); lImg.cartes[0].images[0].cleR2 = 'a/2-bis';
verifier('une image remplacée (même compte) : le set de l\'image', setsTouches({ avant: docs0, apres: lImg }), { sets: ['Set-A'], catalogue: false, especes: false });
const lCarte = copie(etat0); lCarte.cartes[0].sets.push('Set-C');
verifier('une carte qui entre dans un set : ses sets, le catalogue (compte) et les espèces', setsTouches({ avant: docs0, apres: lCarte }), { sets: ['Set-A', 'Set-C'], catalogue: true, especes: true });
const lLigne = copie(etat0); lLigne.cartesProduits.push({ _id: 'p9', idProduct: 300, idExpansion: 12, carteId: 1, slugSet: 'Set-C' });
verifier('une ligne de jointure ajoutée : son set et le catalogue', setsTouches({ avant: docs0, apres: lLigne }), { sets: ['Set-C'], catalogue: true, especes: false });

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
