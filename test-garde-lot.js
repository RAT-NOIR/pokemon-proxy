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
// (relecture du 2026-10-07, nuit) une catégorie effacée par un lot ne faisait bouger aucun compteur : seule une revalidation partait
const etatCat = copie(etat0); etatCat.cartes[0].categorie = 'pokemon';
const lotCat = copie(etatCat); delete lotCat.cartes[0].categorie;
verifier('une catégorie effacée est une baisse', comparer(compterEtat(etatCat), compterEtat(lotCat)).nonAutorisees.map(b => `${b.cle} ${b.avant}→${b.apres}`), ['categories-cartes set:Set-A 1→0']);
// (2026-10-08, incident 01:10 UTC) un rejeu de jointure a effacé `vignette` de 1 089 entrées de cartes.images : (set, cleR2, numero)
// ne bougeaient pas, la garde n'a rien vu. Les vignettes se comptent par set, avant et après, par la même fonction.
const etatVig = copie(etat0); etatVig.cartes[0].images[0].vignette = { cleR2: 'vignettes/a/2.webp', w: 200, h: 280 };
const lotVigPerdue = copie(etatVig); delete lotVigPerdue.cartes[0].images[0].vignette;
// Relecture : le compteur est un ENSEMBLE de clés (set|carte|numero|cleR2), pas un nombre par set — une perdue et une gagnée à compte égal
// doivent arrêter. Une entrée qui a DISPARU (baisse d'images déjà comptée) n'est pas en plus une baisse de vignette.
const K_A = 'vignettes-images set:Set-A|1|2|a/2';
verifier('compteur : une clé par entrée d\'images qui porte une vignette', [compterEtat(etatVig).get(K_A), compterEtat(etat0).get(K_A) ?? 0], [1, 0]);
verifier('une vignette effacée (le reste de l\'entrée intact) est une baisse', comparer(compterEtat(etatVig), compterEtat(lotVigPerdue)).nonAutorisees.map(b => `${b.cle} ${b.avant}→${b.apres}`), [`${K_A} 1→0`, 'vignettes-set set:Set-A 1→0']);   // la clé ET le nombre du set
verifier('une vignette effacée peut s\'annoncer (par clé)', comparer(compterEtat(etatVig), compterEtat(lotVigPerdue), { annonces: { [K_A]: 1 } }).nonAutorisees.length, 0);
verifier('des vignettes qui MONTENT : le lot passe', comparer(compterEtat(etat0), compterEtat(etatVig)).nonAutorisees.length, 0);
verifier('sans worker prouvé sur le set : la baisse de vignette arrête', comparer(compterEtat(etatVig), compterEtat(lotVigPerdue), { setsDuWorker: new Set(['Set-B']) }).nonAutorisees.length, 2);
verifier('worker actif sur CE set (même preuve que pour les images) : la baisse de vignette est dispensée, dite « worker »', comparer(compterEtat(etatVig), compterEtat(lotVigPerdue), { setsDuWorker: new Set(['Set-A']) }).baisses.map(b => b.autorisee), ['worker', 'expliquée par les clés']);
{ // worker actif sur A, lot qui efface une vignette du set B : arrêt
    const e = copie(etat0); e.cartes[1].images[0].vignette = { cleR2: 'vignettes/b/25.webp', w: 200, h: 280 };
    const l = copie(e); delete l.cartes[1].images[0].vignette;
    verifier('worker actif sur A, vignette effacée dans B : arrêt', comparer(compterEtat(e), compterEtat(l), { setsDuWorker: new Set(['Set-A']) }).nonAutorisees.map(b => b.groupe), ['set:Set-B|2|25|b/25', 'set:Set-B']);
}
{ // une perdue + une gagnée dans le même set, compte égal
    const e = copie(etat0); e.cartes[0].images.push({ set: 'Set-A', numero: '3', cleR2: 'a/3' });
    e.cartes[0].images[0].vignette = { cleR2: 'vignettes/a/2.webp', w: 200, h: 280 };
    const l = copie(e); delete l.cartes[0].images[0].vignette; l.cartes[0].images[1].vignette = { cleR2: 'vignettes/a/3.webp', w: 200, h: 280 };
    verifier('une vignette perdue + une gagnée dans le même set (compte égal) : ARRÊT', comparer(compterEtat(e), compterEtat(l)).nonAutorisees.map(b => b.cle), [K_A]);
}
{ // l'entrée a disparu : c'est la baisse d'IMAGES (déjà comptée), pas en plus une baisse de vignette
    const l = copie(etatVig); l.cartes[0].images = [];
    verifier('entrée disparue avec sa vignette : une seule baisse (images), pas de baisse de vignette en plus', comparer(compterEtat(etatVig), compterEtat(l)).nonAutorisees.map(b => b.compteur), ['images']);
}
{ // 2e relecture : un REMPLACEMENT d'image à compte égal (autre cleR2, sans vignette) — la clé disparue est sautée, `images` reste égal :
  // seul le NOMBRE de vignettes du set le voit
    const l = copie(etatVig); l.cartes[0].images[0] = { set: 'Set-A', numero: '2', cleR2: 'a/2-bis' };
    const c = comparer(compterEtat(etatVig), compterEtat(l));
    verifier('remplacement d\'image à compte égal, nouvelle entrée sans vignette : ARRÊT par le nombre de vignettes du set', c.nonAutorisees.map(b => `${b.cle} ${b.avant}→${b.apres}`), ['vignettes-set set:Set-A 1→0']);
    verifier('… et le worker prouvé sur ce set le dispense', comparer(compterEtat(etatVig), compterEtat(l), { setsDuWorker: new Set(['Set-A']) }).nonAutorisees.length, 0);
    verifier('rejeu qui revignette (l\'entrée neuve reçoit sa vignette) : le lot passe', (() => { const g = copie(l); g.cartes[0].images[0].vignette = { cleR2: 'vignettes/a/2-bis.webp' }; return comparer(compterEtat(etatVig), compterEtat(g)).nonAutorisees.length; })(), 0);
    // annonces : par SET (retrait de masse voulu) ou par CLÉ (précis)
    verifier('annonce PAR SET (vignettes-set set:S) : couvre les clés perdues ET le nombre', comparer(compterEtat(etatVig), compterEtat(lotVigPerdue), { annonces: { 'vignettes-set set:Set-A': 1 } }).nonAutorisees.length, 0);
    verifier('annonce par SET trop petite : bloque', comparer(compterEtat(e2()), compterEtat(e2(true)), { annonces: { 'vignettes-set set:Set-A': 1 } }).nonAutorisees.length > 0, true);
    verifier('annonce PAR CLÉ seule : couvre aussi le nombre (une clé perdue annoncée explique la baisse)', comparer(compterEtat(etatVig), compterEtat(lotVigPerdue), { annonces: { [K_A]: 1 } }).nonAutorisees.length, 0);
    function e2(perdues) { const e = copie(etat0); e.cartes[0].images.push({ set: 'Set-A', numero: '3', cleR2: 'a/3' }); for (const im of e.cartes[0].images) if (!perdues) im.vignette = { cleR2: 'v' }; return e; }
    verifier('annonce par set : un retrait de masse (2 clés) pour une annonce de 2 passe', comparer(compterEtat(e2()), compterEtat(e2(true)), { annonces: { 'vignettes-set set:Set-A': 2 } }).nonAutorisees.length, 0);
}
{ const { validerAnnonces } = require('./collecte-cartes/garde-lot'); let leve = false; try { validerAnnonces({ [K_A]: 1, 'vignettes-set set:Set-A': 3 }); } catch { leve = true; }
  verifier('l\'annonce « vignettes-images » est un compteur connu', leve, false); }
{ // restauration CHIRURGICALE : on ne remet que le champ vignette, jamais le tableau images
    const { planVignettes } = require('./collecte-cartes/garde-lot');
    const sauve = [{ _id: 1, images: [{ set: 'Set-A', numero: '2', cleR2: 'a/2', jointeLe: 'ancien', vignette: { cleR2: 'v/a2' } }, { set: 'Set-A', numero: '3', cleR2: 'a/3', vignette: { cleR2: 'v/a3' } }, { set: 'Set-B', numero: '1', cleR2: 'b/1', vignette: { cleR2: 'v/b1' } }] }];
    const actuel = [{ _id: 1, images: [{ set: 'Set-A', numero: '2', cleR2: 'a/2', jointeLe: 'nouveau' }, { set: 'Set-A', numero: '3', cleR2: 'a/3', vignette: { cleR2: 'v/posee-depuis' } }, { set: 'Set-B', numero: '1', cleR2: 'b/1' }, { set: 'Set-A', numero: '9', cleR2: 'a/9' }] }];
    const p = planVignettes(sauve, actuel, new Set(['Set-A']));
    verifier('planVignettes : seulement l\'entrée du set fautif qui a perdu sa vignette (pas celle posée depuis, pas un autre set, pas une entrée neuve)', p.map(x => [x._id, x.set, x.cleR2, x.vignette.cleR2, 'jointeLe' in x]), [[1, 'Set-A', 'a/2', 'v/a2', false]]);   // jointeLe n'est pas restauré : date d'audit que ni la garde ni le site ne lisent, l'ancienne écraserait une plus récente
    verifier('planVignettes : une entrée disparue n\'est pas recréée', planVignettes(sauve, [{ _id: 1, images: [] }], new Set(['Set-A'])).length, 0);
}
verifier('images, cartes, noms de cartes, nom affiché : par set', [avant.get('images set:Set-A'), avant.get('images set:Set-B'), avant.get('cartes set:Set-A'), avant.get('noms-cartes set:Set-B'), avant.get('nom-affiche set:Set-A'), avant.get('nom-affiche set:Set-C') ?? 0], [1, 1, 2, 1, 1, 0]);

// PP-HOLO (2026-10-17) : le champ « partagée holo/non-holo » se compte par set. Un rejeu qui l'efface laisse `images` et la vignette intacts : seul ce compteur le voit.
const etatPH = copie(etat0); etatPH.cartes[0].images[0].partageeHoloNonHolo = true; etatPH.cartes[0].images[0].produitsPartages = [100, 101];
const lotPHefface = copie(etatPH); delete lotPHefface.cartes[0].images[0].partageeHoloNonHolo; delete lotPHefface.cartes[0].images[0].produitsPartages;
verifier('PP-HOLO compteur : une image marquée « partagée holo/non-holo » se compte par set ; une ordinaire ou un `false` non', [compterEtat(etatPH).get('images-partagees-holo set:Set-A'), compterEtat(etat0).get('images-partagees-holo set:Set-A') ?? 0, compterEtat((() => { const x = copie(etatPH); x.cartes[0].images[0].partageeHoloNonHolo = false; return x; })()).get('images-partagees-holo set:Set-A') ?? 0], [1, 0, 0]);
verifier('PP-HOLO : un rejeu qui EFFACE le champ (l\'image reste, `images` ne bouge pas) est une BAISSE qui arrête le lot', comparer(compterEtat(etatPH), compterEtat(lotPHefface)).nonAutorisees.map(b => `${b.cle} ${b.avant}→${b.apres}`), ['images-partagees-holo set:Set-A 1→0']);
verifier('PP-HOLO : le worker prouvé sur le set ne dispense PAS cette baisse (il n\'écrit pas ce champ)', comparer(compterEtat(etatPH), compterEtat(lotPHefface), { setsDuWorker: new Set(['Set-A']) }).nonAutorisees.length, 1);
verifier('PP-HOLO : la baisse peut s\'annoncer (retrait partiel voulu)', comparer(compterEtat(etatPH), compterEtat(lotPHefface), { annonces: { 'images-partagees-holo set:Set-A': 1 } }).nonAutorisees.length, 0);
verifier('PP-HOLO : la POSE du champ est une hausse visible, pas une baisse', (c => [c.nonAutorisees.length, c.hausses])(comparer(compterEtat(etat0), compterEtat(etatPH))), [0, { 'images-partagees-holo': 1 }]);
verifier('PP-HOLO : les autres groupes ne bougent pas (mêmes clés avant/après hors du nouveau compteur)', [...compterEtat(etatPH)].filter(([k]) => !k.startsWith('images-partagees-holo')).map(([k, n]) => `${k}=${n}`).join('|') === [...compterEtat(etat0)].map(([k, n]) => `${k}=${n}`).join('|'), true);
{ const { validerAnnonces } = require('./collecte-cartes/garde-lot'); let leve = false; try { validerAnnonces({ 'images-partagees-holo set:Set-A': 1 }); } catch { leve = true; }
  verifier('PP-HOLO : l\'annonce « images-partagees-holo » est un compteur connu', leve, false); }

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
verifier('rien n\'a changé : aucun set touché, ni catalogue ni espèces', setsTouches({ avant: docs0, apres: copie(etat0) }), { sets: [], catalogue: false, especes: false, setsInfo: false });
const lDate = copie(etat0); lDate.sets[0].dateSortieEn = 'May 30, 2025';
verifier('une date posée sur un set : ce set, et le catalogue', setsTouches({ avant: docs0, apres: lDate }), { sets: ['Set-A'], catalogue: true, especes: false, setsInfo: true });
const lFiche = copie(etat0); lFiche.cartesProduits[3].numeroFiche = '25'; lFiche.cartesProduits[3].slugSet = 'Set-B';
const d0b = copie(etat0); d0b.cartesProduits[3].slugSet = 'Set-B';
verifier('un numeroFiche posé sur une ligne : le set de la ligne, pas le catalogue', setsTouches({ avant: d0b, apres: lFiche }), { sets: ['Set-B'], catalogue: false, especes: false, setsInfo: false });
const lImg = copie(etat0); lImg.cartes[0].images[0].cleR2 = 'a/2-bis';
verifier('une image remplacée (même compte) : le set de l\'image', setsTouches({ avant: docs0, apres: lImg }), { sets: ['Set-A'], catalogue: false, especes: false, setsInfo: false });
// 🔴 2026-09-25 (soir) : un lot de 60 sets en a revalidé 336. Une carte qui changeait faisait revalider TOUTES ses appartenances ;
// or une image posée par le worker dans UN set ne change que la page de ce set — et une carte de promo réimprimée appartient à
// 20 sets. Le quota du site (Vercel) paie chaque revalidation : le set touché est celui de la PARTIE qui a changé.
const lCarte = copie(etat0); lCarte.cartes[0].sets.push('Set-C');
verifier('une carte qui entre dans un set : CE set seulement, le catalogue (compte) et les espèces', setsTouches({ avant: docs0, apres: lCarte }), { sets: ['Set-C'], catalogue: true, especes: true, setsInfo: false });
verifier('(setsTouches) une vignette effacée : le set de l\'image est touché (le site la lit)', setsTouches({ avant: etatVig, apres: lotVigPerdue }).sets, ['Set-A']);
const lImgB = copie(etat0); lImgB.cartes[1].images.push({ set: 'Set-B', numero: '99', cleR2: 'b/99' });
verifier('une image ajoutée dans UN set d\'une carte à deux sets : ce set seulement, ni catalogue ni espèces', setsTouches({ avant: docs0, apres: lImgB }), { sets: ['Set-B'], catalogue: false, especes: false, setsInfo: false });
// Le repli prudent ne doit pas se déclencher parce qu'une AUTRE carte a déjà touché le même set (mesuré sur le lot du soir :
// 505 sets pour des images posées dans 3).
const lImg2 = copie(etat0); lImg2.cartes[0].images.push({ set: 'Set-B', numero: '7', cleR2: 'b/7' }); lImg2.cartes[1].images.push({ set: 'Set-B', numero: '99', cleR2: 'b/99' });
const d0c = copie(etat0); d0c.cartes[0].sets.push('Set-D'); lImg2.cartes[0].sets.push('Set-D');
verifier('deux cartes, une image chacune dans le MÊME set : ce set seulement', setsTouches({ avant: d0c, apres: lImg2 }), { sets: ['Set-B'], catalogue: false, especes: false, setsInfo: false });
const lNom = copie(etat0); lNom.cartes[1].nomEn = 'Pikachu ex';
verifier('un nom de carte changé : tous ses sets, le catalogue et les espèces', setsTouches({ avant: docs0, apres: lNom }), { sets: ['Set-A', 'Set-B'], catalogue: true, especes: true, setsInfo: false });
// (2026-10-07, nuit) le site lit `categorie` (page de la carte, listes d'espèces : lib/cartes.ts, lib/pokemon.ts) — un lot qui la
// pose sur les fiches simples ne revalidait rien
const lCat = copie(etat0); lCat.cartes[1].categorie = 'pokemon';
verifier('une catégorie posée : tous les sets de la carte et les espèces, pas le catalogue', setsTouches({ avant: docs0, apres: lCat }), { sets: ['Set-A', 'Set-B'], catalogue: false, especes: true, setsInfo: false });
const lIll = copie(etat0); lIll.cartes[1].impressions[0].illustrateur = 'Atsuko Nishida';
verifier('une impression changée (illustrateur) : tous les sets de la carte (prudent : l\'impression ne porte qu\'un NOM d\'expansion)', setsTouches({ avant: docs0, apres: lIll }), { sets: ['Set-A', 'Set-B'], catalogue: false, especes: false, setsInfo: false });
const lLigne = copie(etat0); lLigne.cartesProduits.push({ _id: 'p9', idProduct: 300, idExpansion: 12, carteId: 1, slugSet: 'Set-C' });
verifier('une ligne de jointure ajoutée : son set et le catalogue', setsTouches({ avant: docs0, apres: lLigne }), { sets: ['Set-C'], catalogue: true, especes: false, setsInfo: false });
// 🔴 2026-09-26 : le lot des logos a revalidé 156 sets pour 12 changés — le collecteur réécrivait chaque logo (sa date `le`) et
// chaque motif de refus. Un set ne se revalide que pour ce que le SITE lit (PROJECTION_SET de lib/cartes.ts).
const lRefus = copie(etat0); lRefus.sets[0].logoRefus = { motif: 'aucun `setlogo` dans l\'infobox', le: new Date('2026-09-26') };
verifier('un motif de refus de logo réécrit : rien (le site ne le lit pas)', setsTouches({ avant: docs0, apres: lRefus }).sets, []);
const d0l = copie(etat0); d0l.sets[0].logo = { cleR2: 'l/a.png', w: 200, h: 80, le: new Date('2026-09-20'), preuve: 'x' };
const lLogoLe = copie(d0l); lLogoLe.sets[0].logo = { ...lLogoLe.sets[0].logo, le: new Date('2026-09-26') };
verifier('le même logo réécrit (sa date `le` seule) : rien', setsTouches({ avant: d0l, apres: lLogoLe }).sets, []);
// (tour de correction 1, 2026-10-24) le site LIT `logo.preuve` (IMAGE_SET de lireDonnee.ts : cleR2, w, h, set, region, langue, preuve…) : une preuve changée est un logo qui change à l'écran
const lLogoPreuve = copie(d0l); lLogoPreuve.sets[0].logo = { ...lLogoPreuve.sets[0].logo, preuve: 'y' };
verifier('un logo dont la seule `preuve` change : ce set (le site la lit), et sets-info', (r => [r.sets, r.setsInfo])(setsTouches({ avant: d0l, apres: lLogoPreuve })), [['Set-A'], true]);
const lLogo = copie(d0l); lLogo.sets[0].logo = { ...lLogo.sets[0].logo, cleR2: 'l/b.png' };
verifier('un logo changé : ce set, et le catalogue', setsTouches({ avant: d0l, apres: lLogo }), { sets: ['Set-A'], catalogue: true, especes: false, setsInfo: true });
const lMois = copie(etat0); lMois.sets[0].dateSortieMois = { iso: '2014-11', texte: 'November 2014' };
verifier('une date au mois posée : ce set (le site la lira)', setsTouches({ avant: docs0, apres: lMois }).sets, ['Set-A']);
// (2026-10-07) le site lit TROIS logos — logoCompose, logoFr, logo (lib/visuelSet.ts, CHAMPS_LOGO) : la projection ne regardait que `logo`,
// et un logoCompose posé ou retiré seul ne revalidait rien (poser-logos-composes.js le faisait à la main).
const d0c2 = copie(etat0); d0c2.sets[0].logoCompose = { cleR2: 'logos/composes/a.png', w: 480, h: 120, le: new Date('2026-10-04'), preuve: 'x' };
const lSansCompose = copie(d0c2); delete lSansCompose.sets[0].logoCompose;
verifier('un logoCompose retiré : ce set, et le catalogue', setsTouches({ avant: d0c2, apres: lSansCompose }), { sets: ['Set-A'], catalogue: true, especes: false, setsInfo: true });
const lFr = copie(etat0); lFr.sets[0].logoFr = { cleR2: 'logos/fr/a.png', w: 300, h: 90 };
verifier('un logoFr posé : ce set', setsTouches({ avant: docs0, apres: lFr }).sets, ['Set-A']);
// (2026-10-07) le logo d'un set, son nom, sa date vivent dans l'entrée `sets-info` du site (30 jours) : sans `setsInfo`, la page
// régénérée relisait l'ancien logo (188 logos de decks restés composés sur le site après un lot revalidé en HTTP 200)
verifier('un logo changé : setsInfo (le site lit les logos dans sets-info)', setsTouches({ avant: d0c2, apres: lSansCompose }).setsInfo, true);
verifier('une image de carte changée : pas de setsInfo', setsTouches({ avant: docs0, apres: lImg }).setsInfo, false);
verifier('une date posée sur un set : setsInfo', setsTouches({ avant: docs0, apres: lDate }).setsInfo, true);
const lNomFr = copie(etat0); lNomFr.sets[0].nomFr = 'Écarlate et Violet';
verifier('un nom français posé sur un set : ce set et setsInfo (sets-info le lit)', [setsTouches({ avant: docs0, apres: lNomFr }).sets, setsTouches({ avant: docs0, apres: lNomFr }).setsInfo], [['Set-A'], true]);
const lSymb = copie(etat0); lSymb.sets[0].symbolesIdentification = [{ cleR2: 's/a.png', w: 30, h: 17, fichier: 'a/symbol.png', source: 'ptcg-assets', le: new Date() }];
verifier('un symbole d\'identification posé : ce set et setsInfo', setsTouches({ avant: docs0, apres: lSymb }).setsInfo, true);
const d0m = copie(etat0); d0m.sets[0].dateSortieMois = { iso: '2014-11', texte: 'November 2014' };
const lMoisTexte = copie(d0m); lMoisTexte.sets[0].dateSortieMois = { iso: '2014-11', texte: 'Nov. 2014' };
// (tour de correction 1, 2026-10-24) ce test disait « le site ne lit que .iso : rien ». SPEC_SET (lireDonnee.ts) lit `dateSortieMois: { iso, texte }` : le texte aussi
verifier('le seul `texte` de dateSortieMois changé (le site lit iso ET texte) : ce set', setsTouches({ avant: d0m, apres: lMoisTexte }).sets, ['Set-A']);
const lMoisIso = copie(d0m); lMoisIso.sets[0].dateSortieMois = { iso: '2014-12', texte: 'November 2014' };
verifier('le seul `iso` de dateSortieMois changé : ce set', setsTouches({ avant: d0m, apres: lMoisIso }).sets, ['Set-A']);
const lComposeLe = copie(d0c2); lComposeLe.sets[0].logoCompose = { ...lComposeLe.sets[0].logoCompose, le: new Date('2026-10-07') };
verifier('le même logoCompose réécrit (sa date `le` seule) : rien', setsTouches({ avant: d0c2, apres: lComposeLe }).sets, []);
const lComposePreuve = copie(d0c2); lComposePreuve.sets[0].logoCompose = { ...lComposePreuve.sets[0].logoCompose, preuve: 'y' };
verifier('un logoCompose dont la seule preuve change : ce set', setsTouches({ avant: d0c2, apres: lComposePreuve }).sets, ['Set-A']);

// ── BS-STAFF (2026-10-17) : « tampon non séparable » — l'image servie aux paires Black Star V1/V2 porte `partageeTamponNonSepare: true`, `produitsPartages` et `tamponNonRepresente`.
// Un retrait (ou un rejeu qui efface les champs) laisse `images` et les vignettes intacts : seul ce compteur le voit. Le compteur « holo » ne se confond pas avec lui.
const etatT = copie(etat0); Object.assign(etatT.cartes[0].images[0], { partageeTamponNonSepare: true, produitsPartages: [100, 101], tamponNonRepresente: 'Staff' });
const lotTRetire = copie(etatT); for (const k of ['partageeTamponNonSepare', 'produitsPartages', 'tamponNonRepresente']) delete lotTRetire.cartes[0].images[0][k];
verifier('BS-STAFF compteur : une image marquée « tampon non séparable » se compte par set ; une ordinaire ou un `false` non', [compterEtat(etatT).get('images-partagees-tampon set:Set-A'), compterEtat(etat0).get('images-partagees-tampon set:Set-A') ?? 0, compterEtat((() => { const x = copie(etatT); x.cartes[0].images[0].partageeTamponNonSepare = false; return x; })()).get('images-partagees-tampon set:Set-A') ?? 0], [1, 0, 0]);
verifier('BS-STAFF : le retrait des champs (l\'image reste) est une BAISSE qui arrête le lot', comparer(compterEtat(etatT), compterEtat(lotTRetire)).nonAutorisees.map(b => `${b.cle} ${b.avant}→${b.apres}`), ['images-partagees-tampon set:Set-A 1→0']);
verifier('BS-STAFF : la baisse peut s\'annoncer (retrait voulu)', comparer(compterEtat(etatT), compterEtat(lotTRetire), { annonces: { 'images-partagees-tampon set:Set-A': 1 } }).nonAutorisees.length, 0);
verifier('BS-STAFF : la POSE est une hausse visible, aucune baisse, aucun autre groupe ne bouge', (c => [c.nonAutorisees.length, c.hausses])(comparer(compterEtat(etat0), compterEtat(etatT))), [0, { 'images-partagees-tampon': 1 }]);
verifier('BS-STAFF : le compteur « holo » ne compte pas une image « tampon » (et inversement)', [compterEtat(etatT).get('images-partagees-holo set:Set-A') ?? 0, compterEtat((() => { const x = copie(etat0); x.cartes[0].images[0].partageeHoloNonHolo = true; return x; })()).get('images-partagees-tampon set:Set-A') ?? 0], [0, 0]);
{ const { validerAnnonces } = require('./collecte-cartes/garde-lot'); let leve = false; try { validerAnnonces({ 'images-partagees-tampon set:Set-A': 1 }); } catch { leve = true; }
  verifier('BS-STAFF : l\'annonce « images-partagees-tampon » est un compteur connu', leve, false); }
verifier('BS-STAFF (setsTouches) : le marquage change ce que le site lit (mention) : le set de l\'image est touché, pas le catalogue', (r => [r.sets, r.catalogue, r.especes])(setsTouches({ avant: docs0, apres: etatT })), [['Set-A'], false, false]);
verifier('BS-STAFF (setsTouches) : le retrait du marquage touche aussi le set', setsTouches({ avant: etatT, apres: lotTRetire }).sets, ['Set-A']);
// lot-additif.js lit les cartes par une projection : un champ absent de la projection est un compteur qui ne voit rien (§41)
// (correction 2 du lot METAL : la projection est la constante partagée PROJECTION_ETAT, lue par lot-additif.js)
{ const src = require('fs').readFileSync(require('path').join(__dirname, 'lot-additif.js'), 'utf8');
  const proj = require('./collecte-cartes/garde-lot').PROJECTION_ETAT.cartes;
  // (D3.5, 2026-10-24) la projection de l'état « après » est la constante partagée, réunie à celle de l'API quand elle est chargée (une seule lecture) : `projectionCartes` en dérive, jamais une liste recopiée
  verifier('lot-additif.js lit les cartes par la projection partagée', [/\.project\(projectionCartes\)/.test(src), /projectionCartes = api \? \{ \.\.\.api\.projectionsEtat\.cartes \} : \{ \.\.\.PROJECTION_ETAT\.cartes \}/.test(src)], [true, true]);
  verifier('BS-STAFF : la projection de lot-additif.js lit les trois champs du marquage', ['images.partageeTamponNonSepare', 'images.produitsPartages', 'images.tamponNonRepresente'].map(c => proj[c] === 1), [true, true, true]); }

// ── D1 (2026-10-24) : le calcul des sets à revalider voit TOUT champ que le site peut lire, dans les trois collections.
// Constat du 19/10 : deux lots ont modifié des champs existants (la `variante` de 58 lignes, `tamponNonRepresente` de 12 entrées d'image, un champ d'une entrée de Frosmoth) ;
// « 6. sets touchés : 0 », rien n'a été revalidé, il a fallu le faire à la main. La projection comparée ne portait qu'une partie de ce que le site lit.
// ⚠️ un banc qui ne ferait que « voir plus » ne prouverait rien : chaque cas ci-dessous a son contraire (un champ que le site NE lit PAS ne revalide rien — le quota Vercel, §63).
const touches = (a, b) => setsTouches({ avant: a, apres: b });
const modif = (f) => { const e = copie(etat0); f(e); return e; };
const etatTampon = modif(e => Object.assign(e.cartes[1].images[0], { partageeTamponNonSepare: false, tamponNonRepresente: 'Staff' }));
verifier('D1 : SEUL tamponNonRepresente change dans une entrée existante (le drapeau reste false) : le set de l\'entrée est touché',
    touches(etatTampon, modif(e => Object.assign(e.cartes[1].images[0], { partageeTamponNonSepare: false, tamponNonRepresente: 'League' }))).sets, ['Set-B']);
verifier('D1 : tamponNonRepresente POSÉ sur une entrée qui n\'en avait pas (drapeau false) : le set est touché',
    touches(docs0, modif(e => Object.assign(e.cartes[1].images[0], { partageeTamponNonSepare: false, tamponNonRepresente: 'League' }))).sets, ['Set-B']);
verifier('D1 : la seule `variante` d\'une ligne de jointure (posée) : son slugSet est touché, ni catalogue ni espèces',
    (r => [r.sets, r.catalogue, r.especes])(touches(modif(e => { e.cartesProduits[3].slugSet = 'Set-B'; }), modif(e => { e.cartesProduits[3].slugSet = 'Set-B'; e.cartesProduits[3].variante = 'prerelease'; }))), [['Set-B'], false, false]);
verifier('D1 : la seule `variante` d\'une ligne changée (staff -> staff+prerelease) : son slugSet',
    touches(modif(e => { Object.assign(e.cartesProduits[3], { slugSet: 'Set-B', variante: 'staff' }); }), modif(e => { Object.assign(e.cartesProduits[3], { slugSet: 'Set-B', variante: 'staff+prerelease' }); })).sets, ['Set-B']);
for (const [champ, v] of [['mention', 'x'], ['noteVariante', 'n'], ['langue', 'ja'], ['languePreuve', 'p'], ['basseDefinition', true], ['imageEmprunteeTirage', true], ['w', 480], ['h', 670], ['source', 'tcgdex'], ['partageeHoloNonHolo', true], ['produitsPartages', [100, 101]]])
    verifier(`D1 : un champ d'entrée d'image que le site lit (${champ}) : le set de l'entrée seulement`, touches(docs0, modif(e => { e.cartes[1].images[0][champ] = v; })).sets, ['Set-B']);
verifier('D1 : la vignette (w, h) d\'une entrée : le set de l\'entrée', touches(modif(e => { e.cartes[0].images[0].vignette = { cleR2: 'v/a', w: 200, h: 280 }; }), modif(e => { e.cartes[0].images[0].vignette = { cleR2: 'v/a', w: 200, h: 281 }; })).sets, ['Set-A']);
for (const [champ, v] of [['pv', 60], ['type', 'Eau'], ['stade', 'Base'], ['faiblesse', 'Plante'], ['resistance', 'Combat'], ['retraite', 2], ['ndex', 25], ['nomJa', 'ピカチュウ'], ['nomFr', 'Pikachu'], ['illustrateur', 'X'], ['attaques', [{ nom: 'Éclair', degats: '30' }]], ['liens', { idProduct: [101] }]])
    verifier(`D1 : un autre champ de carte que le site lit (${champ}) : TOUS les sets de la carte`, touches(docs0, modif(e => { e.cartes[1][champ] = v; })).sets, ['Set-A', 'Set-B']);
verifier('D1 : une impression — rareté ou total (champs que le site lit) : tous les sets de la carte', [touches(docs0, modif(e => { e.cartes[1].impressions[0].rarete = 'Rare'; })).sets, touches(docs0, modif(e => { e.cartes[1].impressions[0].total = '102'; })).sets], [['Set-A', 'Set-B'], ['Set-A', 'Set-B']]);
verifier('D1 : une ligne — slug, tirage, idExpansion, substitut (cleR2, w, h, mention) : son slugSet', [['slug', 's-1'], ['tirage', 'jp'], ['idExpansion', 99]].map(([k, v]) => touches(modif(e => { e.cartesProduits[3].slugSet = 'Set-B'; }), modif(e => { e.cartesProduits[3].slugSet = 'Set-B'; e.cartesProduits[3][k] = v; })).sets)
    .concat(['cleR2', 'w', 'h', 'mention'].map(k => touches(modif(e => { e.cartesProduits[3].slugSet = 'Set-B'; e.cartesProduits[3].visuelSubstitut = { cleR2: 'o', w: 200, h: 280, mention: 'm' }; }), modif(e => { e.cartesProduits[3].slugSet = 'Set-B'; e.cartesProduits[3].visuelSubstitut = { cleR2: 'o', w: 200, h: 280, mention: 'm', [k]: k === 'cleR2' || k === 'mention' ? 'autre' : 999 }; })).sets)), Array(7).fill(['Set-B']));
verifier('D1 : un document `sets` — le champ `deck` (le site le lit) : ce set, et sets-info', (r => [r.sets, r.setsInfo])(touches(docs0, modif(e => { e.sets[0].deck = 'Pikachu Libre'; }))), [['Set-A'], true]);
// (tour de correction 1, 2026-10-24) `liens.idProduct` : une jointure pose le lien sur la carte ET la ligne cartes_produits. Si une ligne de CETTE carte change dans le même lot, le changement de `liens` est sa
// conséquence : seul le `slugSet` de la ligne est touché (sinon une carte de promo réimprimée dans vingt sets en fait revalider vingt pour une fiche). Un `liens` qui change SANS ligne changée pour cette carte
// n'a pas d'explication : tous les sets de la carte.
{
    const avecLiens = () => modif(e => { e.cartes[1].liens = { idProduct: [101], idMetacards: [7] }; });
    const joint = (e, ligne) => { e.cartes[1].liens = { idProduct: [101, 300], idMetacards: [7, 8] }; if (ligne) e.cartesProduits.push(ligne); return e; };
    const LIGNE_C = { _id: 'p9', idProduct: 300, idExpansion: 12, carteId: 2, slugSet: 'Set-C' };
    const r1 = setsTouches({ avant: avecLiens(), apres: joint(avecLiens(), LIGNE_C) });
    verifier('liens + une ligne ajoutée pour CETTE carte : le slugSet de la ligne seulement (pas les sets de la carte), le catalogue (fiche de plus)', [r1.sets, r1.catalogue, r1.especes], [['Set-C'], true, false]);
    verifier('liens seul, aucune ligne changée : tous les sets de la carte', setsTouches({ avant: avecLiens(), apres: joint(avecLiens(), null) }).sets, ['Set-A', 'Set-B']);
    verifier('liens + une ligne ajoutée pour une AUTRE carte : liens non expliqué -> tous les sets de la carte, plus le slugSet de l\'autre ligne',
        setsTouches({ avant: avecLiens(), apres: joint(avecLiens(), { _id: 'p8', idProduct: 301, idExpansion: 12, carteId: 1, slugSet: 'Set-C' }) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('liens + une ligne RETIRÉE de cette carte (slugSet Set-B) : Set-B seulement, pas les sets de la carte',
        setsTouches({ avant: modif(x => { x.cartesProduits[3].slugSet = 'Set-B'; x.cartes[1].liens = { idProduct: [101, 200] }; }), apres: modif(x => { x.cartes[1].liens = { idProduct: [101] }; x.cartesProduits.splice(3, 1); }) }).sets, ['Set-B']);
    verifier('liens + un AUTRE champ de la carte (pv) + une ligne : le pv change tous les sets de la carte',
        setsTouches({ avant: avecLiens(), apres: (e => { e.cartes[1].pv = 60; return e; })(joint(avecLiens(), LIGNE_C)) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('liens + le NOM de la carte + une ligne : le nom change tous les sets de la carte', setsTouches({ avant: avecLiens(), apres: (e => { e.cartes[1].nomEn = 'Pikachu ex'; return e; })(joint(avecLiens(), LIGNE_C)) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('une ligne changée pour la carte SANS changement de liens : le slugSet de la ligne seulement (inchangé)',
        setsTouches({ avant: docs0, apres: modif(e => { e.cartesProduits[3].variante = 'prerelease'; e.cartesProduits[3].slugSet = 'Set-B'; }) }).sets, ['Set-B']);
}
// le contraire : ce que le site NE lit PAS ne revalide rien (sinon le quota Vercel paie des pages inchangées)
for (const [nom, f] of [
    ['sha256 d\'une entrée d\'image', e => { e.cartes[1].images[0].sha256 = 'ab'; }], ['urlOriginal d\'une entrée', e => { e.cartes[1].images[0].urlOriginal = 'https://x/y'; }], ['preuve d\'une entrée', e => { e.cartes[1].images[0].preuve = 'p'; }],
    ['jointeLe (date d\'audit) d\'une entrée', e => { e.cartes[1].images[0].jointeLe = new Date('2026-10-24'); }], ['collecteLe de la carte', e => { e.cartes[1].collecteLe = new Date(); }], ['version de la carte', e => { e.cartes[1].version = 2; }],
    ['bulba.revid de la carte', e => { e.cartes[1].bulba = { titre: 't', pageid: 5, revid: 123 }; }], ['champsNuls de la carte', e => { e.cartes[1].champsNuls = ['pv']; }], ['liens.idMetacards (pluriel, non lu) de la carte', e => { e.cartes[1].liens = { idMetacards: [7] }; }],
    ['nomFrSource de la carte', e => { e.cartes[1].nomFrSource = 'cardmarket'; }], ['verifieLe d\'une ligne', e => { e.cartesProduits[0].verifieLe = new Date(); }], ['variantePreuve d\'une ligne', e => { e.cartesProduits[0].variantePreuve = 'preuve'; }],
    ['detail d\'une ligne', e => { e.cartesProduits[0].detail = 'd'; }], ['collecteLe d\'un set', e => { e.sets[0].collecteLe = new Date(); }]])
    verifier(`D1 (contraire) : ${nom} — le site ne le lit pas : aucun set touché`, touches(docs0, modif(f)).sets, []);
// la projection relue après le lot : UNE liste (SITE_LIT) pilote la projection Mongo ET la comparaison — rejouée ici avec la projection réelle de l'API (la même fonction `projeter`), le résultat ne change pas
{
    const { projeter } = require('./collecte-cartes/garde-contrat-api');
    const { PROJECTION_ETAT } = require('./collecte-cartes/garde-lot');
    const cas = {
        'tamponNonRepresente seul': [etatTampon, modif(e => Object.assign(e.cartes[1].images[0], { partageeTamponNonSepare: false, tamponNonRepresente: 'League' }))],
        'variante seule d\'une ligne': [modif(e => { e.cartesProduits[3].slugSet = 'Set-B'; }), modif(e => { e.cartesProduits[3].slugSet = 'Set-B'; e.cartesProduits[3].variante = 'prerelease'; })],
        'noteVariante': [docs0, modif(e => { e.cartes[1].images[0].noteVariante = 'n'; })], 'pv': [docs0, modif(e => { e.cartes[1].pv = 60; })], 'substitut.mention': [modif(e => { e.cartesProduits[3].visuelSubstitut = { cleR2: 'o', mention: 'm' }; }), modif(e => { e.cartesProduits[3].visuelSubstitut = { cleR2: 'o', mention: 'm2' }; })],
        'liens.idProduct': [docs0, modif(e => { e.cartes[1].liens = { idProduct: [101] }; })], 'bruit non lu': [docs0, modif(e => { e.cartes[1].images[0].sha256 = 'ab'; e.cartes[1].collecteLe = new Date(); })]
    };
    const proj = e => ({ cartes: projeter(e.cartes, PROJECTION_ETAT.cartes), cartesProduits: projeter(e.cartesProduits, PROJECTION_ETAT.cartesProduits), sets: e.sets });
    for (const [nom, [a, b]] of Object.entries(cas))
        verifier(`D1 : relue par PROJECTION_ETAT (celle de lot-additif.js), la comparaison donne le même verdict que sur les documents entiers — ${nom}`, setsTouches({ avant: proj(a), apres: proj(b) }), setsTouches({ avant: a, apres: b }));
    // asymétrie réelle d'un lot : l'AVANT est la sauvegarde ENTIÈRE, l'APRÈS la base relue par la projection
    verifier('D1 : avant = sauvegarde entière, après = projection de la base (la forme réelle d\'un lot) : même verdict, et jamais de faux set sur un lot sans effet visible',
        [setsTouches({ avant: etatTampon, apres: proj(modif(e => Object.assign(e.cartes[1].images[0], { partageeTamponNonSepare: false, tamponNonRepresente: 'League' }))) }).sets, setsTouches({ avant: docs0, apres: proj(modif(e => { e.cartes[1].images[0].sha256 = 'ab'; e.cartes[1].collecteLe = new Date(); e.cartesProduits[0].verifieLe = new Date(); })) }).sets], [['Set-B'], []]);
    // chaque champ lu par le site est dans la projection de la base : un champ lu et absent de la projection est une comparaison qui ne voit rien (§41)
    const { SITE_LIT } = require('./collecte-cartes/garde-lot');
    verifier('D1 : SITE_LIT est exporté, gelé, et chaque champ qu\'il nomme est dans la projection Mongo de lot-additif.js',
        [Object.isFrozen(SITE_LIT), [...SITE_LIT.cartes.map(c => PROJECTION_ETAT.cartes[c] === 1), ...SITE_LIT.impressions.map(c => PROJECTION_ETAT.cartes[`impressions.${c}`] === 1), ...SITE_LIT.images.map(c => PROJECTION_ETAT.cartes[`images.${c}`] === 1),
            ...SITE_LIT.lignes.map(c => PROJECTION_ETAT.cartesProduits[c] === 1)].every(Boolean)], [true, true]);
}
// (tour de correction 1) la confrontation de SITE_LIT au gabarit du site se fait par IMPORT, dans test-garde-site-lu.js (et par lot-additif.js à chaque lot) : plus de regex sur le texte du site ici.

// ══ TOUR 2 (2026-10-24) ══
// ── D2 : `liens` ne s'explique qu'AU PLUS JUSTE — les idProduct AJOUTÉS ou RETIRÉS que portent des lignes changées (qui ont un slugSet) ; liens.idMetacard ne s'explique jamais
{
    const base = () => modif(e => { e.cartes[1].liens = { idProduct: [101, 200], idMetacard: 5 }; e.cartesProduits[3].slugSet = 'Set-B'; });   // la ligne p3 (carte 2, produit 200) vit dans Set-B
    const LIGNE = { _id: 'p9', idProduct: 300, idExpansion: 12, carteId: 2, slugSet: 'Set-C' };
    const apres = (f) => { const e = base(); f(e); return e; };
    verifier('D2 : l\'idProduct ajouté à liens est celui de la ligne ajoutée : expliqué, Set-C seulement', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct.push(300); e.cartesProduits.push(LIGNE); }) }).sets, ['Set-C']);
    verifier('D2 : liens.idMetacard change avec une ligne changée : JAMAIS expliqué -> tous les sets de la carte + celui de la ligne', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct.push(300); e.cartes[1].liens.idMetacard = 6; e.cartesProduits.push(LIGNE); }) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('D2 : un idProduct RETIRÉ de liens que la ligne changée ne porte pas (101 retiré, la ligne changée est celle du 300) -> tous les sets de la carte', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct = [200]; e.cartesProduits.push(LIGNE); }) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('D2 : l\'ajout de 300 ET le retrait de 101, une seule ligne (300) changée -> le retrait du 101 n\'est pas expliqué -> tous les sets', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct = [200, 300]; e.cartesProduits.push(LIGNE); }) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('D2 : la ligne changée n\'a PAS de slugSet : elle n\'explique rien -> tous les sets de la carte', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct.push(300); e.cartesProduits.push({ _id: 'p9', idProduct: 300, idExpansion: 12, carteId: 2 }); }) }).sets, ['Set-A', 'Set-B']);
    verifier('D2 : deux lignes portent deux idProduct ajoutés : les deux sont expliqués', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct.push(300, 301); e.cartesProduits.push(LIGNE, { _id: 'p10', idProduct: 301, idExpansion: 12, carteId: 2, slugSet: 'Set-D' }); }) }).sets, ['Set-C', 'Set-D']);
    verifier('D2 : les idProduct sont les mêmes mais dans un AUTRE ordre (le site lit le premier) : non expliqué -> tous les sets', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct = [200, 101]; e.cartesProduits.push(LIGNE); }) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('D2 : une ligne changée d\'une AUTRE carte ne l\'explique pas', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct.push(300); e.cartesProduits.push({ ...LIGNE, carteId: 1 }); }) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('D2 : le retrait de 200 avec la ligne p3 (produit 200) retirée : expliqué, Set-B seulement', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct = [101]; e.cartesProduits.splice(3, 1); }) }).sets, ['Set-B']);
    // ── TOUR 3, E4 : le site lit le PREMIER idProduct de `liens.idProduct` — si le premier change, rien ne l'explique : tous les sets de la carte
    verifier('E4 : un idProduct porté par une ligne changée, ajouté EN TÊTE de liste (300 devient le premier) : non expliqué -> tous les sets de la carte', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct = [300, 101, 200]; e.cartesProduits.push(LIGNE); }) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('E4 : le premier idProduct (101) est RETIRÉ, avec ses lignes : le premier change -> non expliqué -> tous les sets', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct = [200]; e.cartesProduits = e.cartesProduits.filter(l => l.idProduct !== 101 || l.carteId !== 2); }) }).sets, ['Set-A', 'Set-B']);
    verifier('E4 : une carte sans lien qui reçoit son premier idProduct avec sa ligne : le premier change (rien -> 300) -> tous les sets', setsTouches({ avant: modif(e => { e.cartes[1].liens = { idProduct: [] }; }), apres: modif(e => { e.cartes[1].liens = { idProduct: [300] }; e.cartesProduits.push(LIGNE); }) }).sets, ['Set-A', 'Set-B', 'Set-C']);
    verifier('E4 (l\'autre sens) : le premier est inchangé, l\'ajout est en queue : toujours expliqué', setsTouches({ avant: base(), apres: apres(e => { e.cartes[1].liens.idProduct = [101, 300, 200]; e.cartesProduits.push(LIGNE); }) }).sets, ['Set-C']);
}

// ── D3 : une forme figée (vignette, symbolesIdentification, dateSortieMois) a ses sous-champs déclarés ; une entrée pointée de SITE_LIT.sets sans forme refuse
{
    const { SITE_LIT, entreesSetsSansForme } = require('./collecte-cartes/garde-lot');
    verifier('D3 : SITE_LIT.formes déclare les sous-champs lus des trois objets à forme figée, et est gelée', [Object.isFrozen(SITE_LIT.formes), SITE_LIT.formes?.['images.vignette'], SITE_LIT.formes?.dateSortieMois, SITE_LIT.formes?.symbolesIdentification],
        [true, ['cleR2', 'w', 'h'], ['iso', 'texte'], ['cleR2', 'w', 'h', 'fichier', 'source']]);
    verifier('D3 : aucune entrée pointée de SITE_LIT.sets n\'est sans forme (rien ne compare null pour toujours)', entreesSetsSansForme(SITE_LIT), []);
    verifier('D3 : une entrée pointée NOUVELLE de SITE_LIT.sets (absente de SETS_A_FORME) est nommée', entreesSetsSansForme({ ...SITE_LIT, sets: [...SITE_LIT.sets, 'periodeDistribution.fin', 'bulba.revid'] }), ['periodeDistribution.fin', 'bulba.revid']);
    verifier('D3 : une entrée simple (sans point) n\'a pas besoin de forme', entreesSetsSansForme({ ...SITE_LIT, sets: [...SITE_LIT.sets, 'nouveauChamp'] }), []);
    // la comparaison lit les sous-champs DÉCLARÉS : un sous-champ non déclaré de la vignette ne revalide rien (c'est la confrontation qui le refuse), un déclaré le fait
    const eV = (v) => modif(e => { e.cartes[0].images[0].vignette = v; });
    verifier('D3 : la vignette se compare sur cleR2, w, h (la forme déclarée) : un sous-champ hors forme ne touche rien, w touche le set',
        [setsTouches({ avant: eV({ cleR2: 'v', w: 1, h: 2 }), apres: eV({ cleR2: 'v', w: 1, h: 2, sha: 'x' }) }).sets, setsTouches({ avant: eV({ cleR2: 'v', w: 1, h: 2 }), apres: eV({ cleR2: 'v', w: 9, h: 2 }) }).sets], [[], ['Set-A']]);
}

// ── D1 : la restauration d'`images` ENTRÉE PAR ENTRÉE (set + cleR2) sur la projection SITE_LIT ; le worker (ses sets de la fenêtre) garde ce qu'il a écrit ; l'indécidable bloque
{
    const { restaurerImages, planRestauration: plan } = require('./collecte-cartes/garde-lot');
    const E = (set, cleR2, extra = {}) => ({ set, cleR2, numero: '1', w: 600, h: 840, source: 'tcgdex', vignette: { cleR2: `v/${cleR2}`, w: 200, h: 280 }, jointeLe: new Date('2026-10-01'), ...extra });
    const W = new Set(['Set-W']);
    const cles = r => r.images.map(m => `${m.set}|${m.cleR2}`);
    let r = restaurerImages([E('S1', 'a')], [E('S1', 'a', { jointeLe: new Date('2026-10-24'), sha256: 'zz' })], { setsDuWorker: W });
    verifier('D1 : rien d\'écrit sur ce que le site lit (jointeLe et sha256 hors projection) : l\'entrée actuelle est gardée telle quelle, aucun rapport', [r.images[0].sha256, r.restaurees.length, r.gardees.length, r.indecidables.length], ['zz', 0, 0, 0]);
    r = restaurerImages([E('S1', 'a')], [E('S1', 'a', { partageeTamponNonSepare: false, tamponNonRepresente: 'Staff' })], { setsDuWorker: W });
    verifier('D1 : un marquage écrit par le lot dans un set sans worker : l\'entrée revient à sa version sauvegardée (le marquage disparaît)', [r.images.length, 'partageeTamponNonSepare' in r.images[0], 'tamponNonRepresente' in r.images[0], r.restaurees.map(x => x.set + '|' + x.cleR2)], [1, false, false, ['S1|a']]);
    r = restaurerImages([E('S1', 'a')], [E('S1', 'a'), E('S1', 'b')], { setsDuWorker: W });
    verifier('D1 : une entrée AJOUTÉE par le lot (set sans worker) est retirée', [cles(r), r.restaurees.length], [['S1|a'], 1]);
    r = restaurerImages([E('S1', 'a')], [E('S1', 'a'), E('Set-W', 'n')], { setsDuWorker: W });
    verifier('D1 : une entrée AJOUTÉE dans un set du worker est gardée, et dite gardée', [cles(r), r.gardees.map(x => x.set + '|' + x.cleR2), r.restaurees.length], [['S1|a', 'Set-W|n'], ['Set-W|n'], 0]);
    r = restaurerImages([E('S1', 'a'), E('S1', 'b')], [E('S1', 'a')], { setsDuWorker: W });
    verifier('D1 : une entrée RETIRÉE par le lot est réinsérée, à sa place', [cles(r), r.restaurees.length], [['S1|a', 'S1|b'], 1]);
    r = restaurerImages([E('S1', 'a'), E('Set-W', 'b')], [E('S1', 'a')], { setsDuWorker: W });
    verifier('D1 : une entrée retirée dans un set du worker (« il retire puis remet ») reste retirée, et dite gardée', [cles(r), r.gardees.length, r.restaurees.length], [['S1|a'], 1, 0]);
    r = restaurerImages([E('Set-W', 'a')], [E('Set-W', 'a', { vignette: { cleR2: 'v/neuve', w: 200, h: 280 } })], { setsDuWorker: W });
    verifier('D1 : dans un set du worker, un champ qu\'il écrit (la vignette) change : l\'entrée du worker reste', [r.images[0].vignette.cleR2, r.gardees.length, r.restaurees.length], ['v/neuve', 1, 0]);
    r = restaurerImages([E('Set-W', 'a')], [E('Set-W', 'a', { vignette: { cleR2: 'v/neuve', w: 200, h: 280 }, partageeTamponNonSepare: false, tamponNonRepresente: 'Staff' })], { setsDuWorker: W });
    verifier('D1 : dans un set du worker, le worker a écrit la vignette ET le lot le marquage : le marquage (que le worker n\'écrit jamais) revient, la vignette du worker reste',
        [r.images[0].vignette.cleR2, 'partageeTamponNonSepare' in r.images[0], 'tamponNonRepresente' in r.images[0], r.restaurees.length, r.gardees.length], ['v/neuve', false, false, 1, 1]);
    // la carte d'une entrée n'est jamais jugée sur ses autres entrées
    r = restaurerImages([E('S1', 'a'), E('S2', 'b')], [E('S1', 'a', { tamponNonRepresente: 'x' }), E('S2', 'b', { tamponNonRepresente: 'y' })], { setsDuWorker: W });
    verifier('D1 : plusieurs entrées modifiées par le lot sur la même carte : toutes reviennent', [r.images.some(m => 'tamponNonRepresente' in m), r.restaurees.length], [false, 2]);
    // indécidable : clé en double, entrée sans clé -> l'actuel est gardé, le cas est NOMMÉ
    r = restaurerImages([E('S1', 'a'), E('S1', 'a', { numero: '2' })], [E('S1', 'a', { tamponNonRepresente: 'x' }), E('S1', 'a', { numero: '2' })], { setsDuWorker: W });
    verifier('D1 : deux entrées de même (set, cleR2) : indécidable, rien n\'est touché, le cas est nommé', [r.images.length, r.images.some(m => m.tamponNonRepresente), r.indecidables.length, r.restaurees.length], [2, true, 2, 0]);   // un cas nommé par côté (sauvegarde, état actuel)
    r = restaurerImages([E('S1', 'a')], [E('S1', 'a'), { set: 'S1', w: 1, h: 1 }], { setsDuWorker: W });
    verifier('D1 : une entrée sans cleR2 : indécidable (jamais retirée en silence)', [r.images.length, r.indecidables.length], [2, 1]);
    // la fonction ne mute pas ses entrées
    const s0 = [E('S1', 'a')], a0 = [E('S1', 'a', { tamponNonRepresente: 'x' })], a0avant = JSON.stringify(a0), s0avant = JSON.stringify(s0);
    restaurerImages(s0, a0, { setsDuWorker: W });
    verifier('D1 : restaurerImages ne modifie ni la sauvegarde ni l\'état actuel', [JSON.stringify(a0) === a0avant, JSON.stringify(s0) === s0avant], [true, true]);
    // le cas « Lot B » : douze cartes, une entrée marquée par le lot sur chacune, une seule fautive — TOUTES reviennent (et pas seulement la fautive)
    const sauvegarde = Array.from({ length: 12 }, (_, i) => ({ _id: 1000 + i, nomEn: `C${i}`, sets: [`S${i}`], images: [E(`S${i}`, `i${i}`)] }));
    const lot = structuredClone(sauvegarde).map((c, i) => { Object.assign(c.images[0], { partageeTamponNonSepare: false, tamponNonRepresente: i === 3 ? 'x'.repeat(78) : 'Staff' }); return c; });
    const sv = new Map(sauvegarde.map(d => [cleDoc(d._id), d])), ac = new Map(lot.map(d => [cleDoc(d._id), d]));
    const p = plan(sv, ac, { garder: () => ['images'], surcharge: (d, a) => ({ images: restaurerImages(d.images, a.images, { setsDuWorker: W }).images }) });
    verifier('D1 « Lot B » (pur) : les 12 cartes sont remplacées, chacune revient à ses images sauvegardées', [p.remplacer.length, p.remplacer.every(c => !('tamponNonRepresente' in c.images[0]))], [12, true]);
    const p2 = plan(sv, ac, { garder: () => ['images'] });
    verifier('D1 « Lot B » (pur, l\'ancienne règle : le tableau actuel gardé pour les cartes non fautives) : rien ne revient — c\'est le défaut corrigé', p2.remplacer.length, 0);
    // planRestauration : la surcharge s'applique APRÈS ce qui est gardé, et elle est optionnelle
    verifier('D1 : planRestauration sans surcharge se comporte comme avant', plan(sv, ac, { garder: () => [] }).remplacer.length, 12);

    // ── TOUR 3, E3 : `basseDefinition` est ÉCRIT PAR LE WORKER aussi (marqueDe / remplacerBasseDefinition des collecteurs tcgdex et bulba). Dans un set du worker, un basseDefinition différent sur une entrée de même clé
    // ne se tranche pas : INDÉCIDABLE nommé, l'entrée reste telle quelle. Hors de ces sets, il revient comme un autre marquage du lot.
    r = restaurerImages([E('Set-W', 'a')], [E('Set-W', 'a', { basseDefinition: true })], { setsDuWorker: W });
    verifier('E3 : set du worker, basseDefinition différent : un indécidable NOMMÉ (basseDefinition), l\'entrée actuelle gardée, rien de « restauré »',
        [r.indecidables.length, /basseDefinition/.test(r.indecidables[0]?.raison || ''), r.indecidables[0]?.set, r.images[0].basseDefinition, r.restaurees.length], [1, true, 'Set-W', true, 0]);
    r = restaurerImages([E('Set-W', 'a', { basseDefinition: false })], [E('Set-W', 'a', { basseDefinition: true, partageeTamponNonSepare: false, tamponNonRepresente: 'Staff' })], { setsDuWorker: W });
    verifier('E3 : set du worker, basseDefinition ET un marquage du lot : l\'entrée entière reste (aucune devinette), un indécidable', [r.indecidables.length, r.images[0].basseDefinition, r.images[0].tamponNonRepresente, r.restaurees.length], [1, true, 'Staff', 0]);
    r = restaurerImages([E('S1', 'a')], [E('S1', 'a', { basseDefinition: true })], { setsDuWorker: W });
    verifier('E3 : hors des sets du worker, basseDefinition revient comme un autre marquage du lot', [r.indecidables.length, 'basseDefinition' in r.images[0], r.restaurees.length], [0, false, 1]);
    r = restaurerImages([E('Set-W', 'a', { basseDefinition: true })], [E('Set-W', 'a', { basseDefinition: true })], { setsDuWorker: W });
    verifier('E3 : set du worker, basseDefinition identique : rien à trancher', [r.indecidables.length, r.gardees.length, r.restaurees.length], [0, 0, 0]);
    verifier('E3 : basseDefinition n\'est plus rangé parmi les marquages du lot', require('./collecte-cartes/garde-lot').MARQUAGES_DU_LOT.includes('basseDefinition'), false);

    // ── TOUR 3, E2 : on ne signale un indécidable que si `images` DIFFÈRE (projection SITE_LIT) entre la sauvegarde et l'état actuel de CETTE carte
    const doublon = [E('S1', 'a'), E('S1', 'a', { numero: '2' })];
    r = restaurerImages(doublon, structuredClone(doublon), { setsDuWorker: W });
    verifier('E2 : un doublon de clé sur une carte NON touchée (sauvegarde = état actuel) : aucun indécidable, rien à restaurer', [r.indecidables.length, r.restaurees.length, r.gardees.length, r.images.length], [0, 0, 0, 2]);
    r = restaurerImages([E('S1', 'a'), { set: 'S1', w: 1, h: 1 }], [E('S1', 'a'), { set: 'S1', w: 1, h: 1 }], { setsDuWorker: W });
    verifier('E2 : une entrée sans cleR2 sur une carte non touchée : aucun indécidable', r.indecidables.length, 0);
    r = restaurerImages(doublon, [E('S1', 'a', { tamponNonRepresente: 'x' }), E('S1', 'a', { numero: '2' })], { setsDuWorker: W });
    verifier('E2 : le même doublon sur une carte que le lot a TOUCHÉE (un marquage de plus) : indécidable', [r.indecidables.length > 0, r.restaurees.length], [true, 0]);
    r = restaurerImages(doublon, doublon.map(m => ({ ...m, jointeLe: new Date('2026-10-24'), sha256: 'zz' })), { setsDuWorker: W });
    verifier('E2 : le doublon, et seuls des champs que le site ne lit pas (jointeLe, sha256) diffèrent : rien ne demande à être restauré, aucun indécidable', r.indecidables.length, 0);
    r = restaurerImages(doublon, [doublon[0]], { setsDuWorker: W });
    verifier('E2 : le doublon, et le lot a retiré une entrée (le nombre d\'entrées diffère) : indécidable', r.indecidables.length > 0, true);
}

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
