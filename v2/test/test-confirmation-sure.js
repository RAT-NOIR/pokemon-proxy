'use strict';
// Lot CONFIRMATION-SURE — jamais un candidat d'un Pokémon sans rapport avec le nom lu (observation 5 du banc réel, 0 faux).
// Module PUR : l'adaptateur sur des COPIES ANONYMISÉES de vraies questions du banc (v2/test/fixtures/banc-reel/confirmation-sure.json : noms lus, idProduct, noms de produits, vérité).
const fs = require('fs');
const path = require('path');
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { adapter } = require('../identifier/adaptateur');

const cfg = lireConfig({});
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'banc-reel', 'confirmation-sure.json'), 'utf8'));
const Q = FIXTURE.questions;
const HOTE = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/';
const ligneDe = c => ({ idProduct: c.idProduct, nomCardmarket: c.nomCardmarket, nomFr: c.nom, set: { slug: 's' + c.idProduct, nom: 'Set ' + c.idProduct }, numero: '12', total: '100', langue: 'EN', variante: null,
    rarete: 'Rare', prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `${HOTE}${c.idProduct}.webp`, w: 255, h: 356 } });
const etatH = { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'GD' };
const sansJumeau = () => ({ conclu: true, ids: [] });
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };

// Le corps de la chaîne héritée pour une ligne du banc : une ambiguë (success) qui porte le nom lu dans `carte`, comme index.js:6167-6229.
function corpsDe(q, lu = q.lu) {
    const ids = q.candidats.map(c => c.idProduct);
    return { success: true, scanId: 's', question: null,
        carte: { idProduct: ids[0], ambigu: true, niveauReserve: 'forte', raisonReserve: 'x', concurrent: null, nbExAequo: 1, nom: lu.nom, nomBrut: lu.nomBrut, nomConfiance: lu.nomConfiance },
        etat: etatH, candidats: ids.map(i => ({ idProduct: i })), classement: ids.map(i => ({ idProduct: i, score: 1 })), reverse: { attendue: false, strategie: null }, codeLangue: 2 };
}
function jouer(q, corps = corpsDe(q)) {
    const produits = new Map(q.candidats.map(c => [c.idProduct, ligneDe(c)]));
    return muet(() => adapter({ statutHttp: 200, corps }, { produits, langueInterface: 'fr', cfg, jumeaux: sansJumeau }));
}
const montres = r => (r.issue === 'question' ? r.analyse.cartes[0].candidats.map(c => c.idProduct) : []);
const parCas = cas => Q.filter(q => q.cas === cas);

vrai('la fixture porte les 177 questions et les 11 cas du rapport (2 + 5 + 4)', Q.length === 177 && parCas('sans-rapport-confirmation').length === 2 && parCas('porygon2').length === 5 && parCas('numero-substitue').length === 4);

// (a) les 2 confirmations sur un Pokémon sans rapport ne sont plus posées
for (const q of parCas('sans-rapport-confirmation')) {
    const r = jouer(q), c = r.analyse && r.analyse.cartes[0];
    v(`(a) « ${q.lu.nom} » : plus de confirmation, introuvable photo-illisible`, [r.issue, c && c.raison, montres(r)], ['introuvable', 'photo-illisible', []]);
}
// (b) Dark Porygon2 et les candidats sans rapport de `numero-substitue` sont retirés
for (const q of parCas('porygon2')) {
    const r = jouer(q);
    vrai(`(b) « ${q.lu.nom} » : Dark Porygon2 (606889) n'est plus montré`, !montres(r).includes(606889));
    v(`(b)    « ${q.lu.nom} » : la vérité reste montrée (confirmation sur elle seule)`, [r.issue, montres(r)], ['question', [q.verite]]);
}
for (const q of parCas('numero-substitue')) {
    const r = jouer(q), c = r.analyse.cartes[0];
    const SANS_RAPPORT = /^(Oranguru|Misty & Lorelei|Beast Energy|Pok[eé]mon Breeder|Blaine's Last Resort|Training Court|Single Strike Energy|Baltoy|Boss's Orders - Giovanni|Eternatus VMAX)/;
    const vus = montres(r).map(id => q.candidats.find(x => x.idProduct === id).nomCardmarket);
    vrai(`(b) « ${q.lu.nom} » (numero-substitue) : aucun candidat sans rapport n'est montré (montrés : ${JSON.stringify(vus)})`, vus.every(n => !SANS_RAPPORT.test(n)));
    vrai(`(b)    « ${q.lu.nom} » : ${montres(r).length ? 'ce qui reste est un nom en rapport avec la lecture' : 'plus rien à montrer : introuvable'}`, montres(r).length ? vus.every(n => !SANS_RAPPORT.test(n)) : c.statut === 'introuvable');
}
// (c) AUCUNE vérité du fixture n'est retirée : 0 perte sur les 177 questions
{
    let avecVerite = 0, perdues = [];
    for (const q of Q) {
        if (!q.candidats.some(c => c.idProduct === q.verite)) continue;
        avecVerite++;
        if (!montres(jouer(q)).includes(q.verite)) perdues.push(q.n);
    }
    v(`(c) 0 vérité retirée (${avecVerite} questions dont la vérité est parmi les candidats)`, perdues, []);
}
// (d) un nom lu ABSENT ne retire rien (« je ne sais pas » n'est pas une contradiction) ; une confiance non haute non plus (la règle du veto de la production)
{
    let touchees = 0;
    for (const q of parCas('numero-substitue').concat(parCas('porygon2'), parCas('sans-rapport-confirmation'))) {
        const sans = jouer(q, corpsDe(q, { nom: null, nomBrut: null, nomConfiance: 'haute' }));
        const basse = jouer(q, corpsDe(q, { ...q.lu, nomConfiance: 'basse' }));
        const attendu = q.candidats.length;                                          // aucun retrait : tous les candidats (au plus 3) sont montrés
        if (montres(sans).length !== attendu || montres(basse).length !== attendu) touchees++;
    }
    v('(d) nom lu absent ou confiance non haute : aucun candidat retiré sur les 11 cas', touchees, 0);
    const q = parCas('sans-rapport-confirmation')[0];
    v('(d)    sans nom lu, la confirmation sans rapport reste posée (cas mesuré, non changé)', jouer(q, corpsDe(q, { nom: null, nomBrut: null, nomConfiance: 'haute' })).analyse.cartes[0].question.code, 'confirmation');
}
// (e) les refus par égalité passent par la même règle (cardInfo porte le nom lu) ; la règle G (carte.nom) aussi
{
    const q = parCas('porygon2')[0];
    const produits = new Map(q.candidats.map(c => [c.idProduct, ligneDe(c)]));
    const refus = { success: false, natureRefus: 'refus-delibere', motifRefus: 'egalite-parfaite', rembourse: true, candidats: q.candidats.map(c => ({ idProduct: c.idProduct })), cardInfo: { name: q.lu.nom, nomBrut: q.lu.nomBrut, nomConfiance: 'haute' } };
    const r = muet(() => adapter({ statutHttp: 200, corps: refus }, { produits, langueInterface: 'fr', cfg, jumeaux: sansJumeau }));
    v('(e) egalite-parfaite avec cardInfo : Dark Porygon2 retiré, confirmation sur la vérité', [r.issue, montres(r)], ['question', [q.verite]]);
    const tous = muet(() => adapter({ statutHttp: 200, corps: { ...refus, candidats: q.candidats.map(c => ({ idProduct: c.idProduct })).filter(c => c.idProduct === 606889), cardInfo: refus.cardInfo } }, { produits, langueInterface: 'fr', cfg, jumeaux: sansJumeau }));
    v('(e) egalite-parfaite dont tous les candidats sont sans rapport : introuvable photo-illisible', [tous.issue, tous.analyse.cartes[0].raison], ['introuvable', 'photo-illisible']);
}
// (f) la règle sépare les paires du rapport, et ne retire pas les traductions d'une même carte
{
    const { nomCompatible } = require('../identifier/nom-compatible');
    const L = (nom, nomBrut = null) => [nom, nomBrut].filter(Boolean);
    const P = (nomCardmarket, nomFr = null) => ({ nomCardmarket, nomFr });
    v('(f) Dark Porygon2 ≠ Dark Feraligatr', nomCompatible(L('Dark Feraligatr'), P('Dark Porygon2')), false);
    v('(f) Will\'s Jynx ≠ Whitney\'s Clefable', nomCompatible(L('Whitney\'s Clefable'), P('Will\'s Jynx')), false);
    v('(f) Team Magma\'s Baltoy ≠ Alto Mare\'s Latias', nomCompatible(L('Alto Mare\'s Latias'), P('Team Magma\'s Baltoy')), false);
    v('(f) Dark Feraligatr = Dark Feraligatr', nomCompatible(L('Dark Feraligatr'), P('Dark Feraligatr')), true);
    v('(f) Korrina\'s Focus ~ Korrina\'s Motivation (traduction de la même carte)', nomCompatible(L('Korrina\'s Focus'), P('Korrina\'s Motivation')), true);
    v('(f) Palkia LV.X ~ Palkia Lv.67 (même Pokémon)', nomCompatible(L('Palkia LV.X'), P('Palkia Lv.67 [Spacial Rend | Transback]')), true);
    v('(f) Fire Energy ≠ Water Energy (un mot générique ne rapproche pas)', nomCompatible(L('Fire Energy'), P('Water Energy')), false);
    // I1 (relecture r1) : un propriétaire en préfixe partagé ne suffit pas ; on compare les restes par l'espèce (table de Pokédex de la production)
    const paires = [
        ["Imakuni?'s Doduo", "Imakuni?'s Nasty Plot"], ["Whitney's Clefable", "Whitney's Miltank"], ["Sabrina's Alakazam", "Sabrina's Jynx"],
        ["Team Magma's Aron", "Team Magma's Baltoy"], ["Team Aqua's Zubat", "Team Aqua's Mightyena"], ["Professor Oak", "Professor Elm"],
        ["Misty's Starmie", "Misty's Tears"], ["Lt. Surge's Raichu", "Lt. Surge's Strategy"]];
    for (const [lu, cand] of paires) v(`(f) I1 « ${lu} » lu / « ${cand} » : contredit, retiré`, nomCompatible(L(lu), P(cand)), false);
    v('(f) I1 toléré écrit : deux Dresseurs du même propriétaire (Zinnia\'s Resolve / Zinnia\'s Nasty Plot) restent montrés', nomCompatible(L("Zinnia's Resolve"), P("Zinnia's Nasty Plot")), true);
    v('(f) I1 même propriétaire, même espèce : gardé (Whitney\'s Clefable / Whitney\'s Clefable ex)', nomCompatible(L("Whitney's Clefable"), P("Whitney's Clefable ex")), true);
    // M3 : les jetons courts
    v('(f) M3 Ho-Oh / Ho-Oh : compatible (égalité, aucun mot de 3 lettres)', nomCompatible(L('Ho-Oh'), P('Ho-Oh')), true);
    v('(f) M3 Ho-Oh / Lugia : contredit (deux espèces)', nomCompatible(L('Ho-Oh'), P('Lugia')), false);
    v('(f) M3 Mew / Ho-Oh : contredit', nomCompatible(L('Mew'), P('Ho-Oh')), false);
    v('(f) M2 hérité de nomConcorde (préfixe) : Mew / Mewtwo reste compatible, non élargi', nomCompatible(L('Mew'), P('Mewtwo')), true);
    v('(f) nom lu vide : compatible (rien à contredire)', nomCompatible([], P('Dark Porygon2')), true);
    v('(f) candidat sans nom exploitable : compatible (on ne sait pas)', nomCompatible(L('Pikachu'), P(null)), true);
}
bilan();
