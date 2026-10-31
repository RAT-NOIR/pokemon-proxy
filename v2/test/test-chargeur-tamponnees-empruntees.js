'use strict';
// TAMPONNÉES-EMPRUNTÉES (décision de l'utilisateur, 01/11) — (D) : une réimpression tamponnée (Prize Pack, 30th Celebration, Trick or Trade 2024, image empruntée du catalogue) que le repli refusait est servie EMPRUNTÉE,
// sous la mention existante « Visuel d'un autre tirage » et le bandeau dérivé du set, SEULEMENT pour un produit de la liste fermée `tamponneesEmpruntees` (la PREUVE À L'IMAGE est faite en amont, par la règle de
// e14-classes-orb.js, et nommée sur chaque ligne de la liste). Sans liste : le refus d'avant, octet pour octet. Pas de base, pas de réseau : decider reçoit des tableaux fabriqués.
const H = require('./_harnais');
const { decider } = require('../chargeur/decision');
const { regleEmbarquee } = require('../chargeur/regle-site');
const { MENTION_EDITION_1 } = require('../identifier/emprunt');

(async () => {
    const regle = await regleEmbarquee();
    const set = (id, exp) => ({ _id: id, idExpansion: exp, code: id.slice(0, 4), nomAffichage: id.replace(/-/g, ' '), tirage: 'intl', region: 'intl', bulba: { expansion: id.replace(/-/g, ' ') } });
    const exps = { 'Play-Pokemon-Prize-Pack-Series-Seven': 100, '30th-Celebration': 200, 'Trick-or-Trade-2024': 300, 'Battle-Academy-2020': 400, 'WCD-2024': 500, 'Set-B': 600, 'Set-A': 700 };
    const sets = Object.entries(exps).map(([id, e]) => set(id, e));
    const imp = (setId, numero) => ({ tirage: 'intl', expansion: setId.replace(/-/g, ' '), numero, total: '100', rarete: 'Rare' });
    const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
    const im = (setId, numero, n, o = {}) => ({ set: setId, numero, cleR2: `cartes/${n}.webp`, w: 700, h: 980, vignette: vig(n), langue: 'en', source: 'tcgdex', ...o });
    const carte = (id, setId, numero, images) => ({ _id: id, nomEn: `Carte ${id}`, sets: [setId], impressions: [imp(setId, numero)], images });
    const subst = (n, o = {}) => ({ cleR2: `cartes/${n}.webp`, w: 600, h: 838, set: 'Set-B', langue: 'en', mention: 'Visuel de la carte d\'origine (Set B)', ...o });
    const docs = [
        carte(10, 'Play-Pokemon-Prize-Pack-Series-Seven', '001', []),
        carte(11, 'Play-Pokemon-Prize-Pack-Series-Seven', '002', []),
        carte(12, 'Play-Pokemon-Prize-Pack-Series-Seven', '003', []),
        carte(13, 'Play-Pokemon-Prize-Pack-Series-Seven', '004', [im('Play-Pokemon-Prize-Pack-Series-Seven', '004', 'vrai4')]),          // un VRAI scan du set existe
        carte(14, 'Play-Pokemon-Prize-Pack-Series-Seven', '005', [im('Play-Pokemon-Prize-Pack-Series-Seven', '005', 'emp5', { source: 'ctr', imageEmprunteeTirage: true })]),     // l'image empruntée du catalogue, dans le set
        carte(15, '30th-Celebration', '001', []),
        carte(16, 'Trick-or-Trade-2024', '001', []),
        carte(17, 'Battle-Academy-2020', null, []),
        carte(18, 'WCD-2024', '006', []),
        carte(19, 'Play-Pokemon-Prize-Pack-Series-Seven', '006', [])
    ];
    const ligne = (id, carteId, setId, numeroFiche, slug, o = {}) => ({ idProduct: id, carteId, idExpansion: exps[setId], numeroFiche, slug, slugSet: setId, ...o });
    const lignes = [
        ligne(1001, 10, 'Play-Pokemon-Prize-Pack-Series-Seven', '001', 'Pikachu-PPS7-001', { visuelSubstitut: subst('orig10') }),     // dans la liste
        ligne(1002, 11, 'Play-Pokemon-Prize-Pack-Series-Seven', '002', 'Eevee-PPS7-002', { visuelSubstitut: subst('orig11') }),          // PAS dans la liste
        ligne(1003, 12, 'Play-Pokemon-Prize-Pack-Series-Seven', '003', 'Mew-PPS7-003', { visuelSubstitut: subst('orig12', { set: 'Set-B' }) }),   // dans la liste, mais le scan est japonais
        ligne(1004, 13, 'Play-Pokemon-Prize-Pack-Series-Seven', '004', 'Snorlax-PPS7-004', { visuelSubstitut: subst('orig13') }),         // dans la liste, un vrai scan existe : il l'emporte
        ligne(1005, 14, 'Play-Pokemon-Prize-Pack-Series-Seven', '005', 'Lugia-PPS7-005'),                                                // dans la liste : image empruntée du catalogue, dans le set
        ligne(1006, 15, '30th-Celebration', '001', 'Pikachu-30C-001', { visuelSubstitut: subst('orig15') }),                           // dans la liste
        ligne(1007, 16, 'Trick-or-Trade-2024', '001', 'Pumpkaboo-ToT24-001', { visuelSubstitut: subst('orig16') }),                       // dans la liste
        ligne(1008, 17, 'Battle-Academy-2020', null, 'Potion-V1-SUM001', { visuelSubstitut: subst('orig17') }),                          // dans la liste, mais Battle Academy a sa règle (A)
        ligne(1009, 18, 'WCD-2024', '006', 'Zapdos-WCD24PGO-006', { visuelSubstitut: subst('orig18') }),                                  // dans la liste, mais WCD a sa règle (B)
        ligne(1010, 19, 'Play-Pokemon-Prize-Pack-Series-Seven', '006', 'Ditto-PPS7-006', { visuelSubstitut: subst('orig19') })           // dans la liste, scan sans langue (null)
    ];
    docs[0].images = []; // carte 10 : aucune image propre
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const ids = (...x) => new Set(x);
    const sans = await decider({ sets, docs, lignes, metacarte, regle });
    const liste = ids(1001, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010);
    // la langue d'un scan de substitut vient de la ligne : on la pose sur 1003 (ja) et 1010 (null)
    lignes.find(l => l.idProduct === 1003).visuelSubstitut.langue = 'ja'; lignes.find(l => l.idProduct === 1010).visuelSubstitut.langue = null;
    const sansListeJa = await decider({ sets, docs, lignes, metacarte, regle });
    const avec = await decider({ sets, docs, lignes, metacarte, regle, tamponneesEmpruntees: liste });
    const e = (r, id) => r.entrees.find(x => x.idProduct === id);
    const cle = (r, id) => (e(r, id) ? e(r, id).grande?.cle ?? null : undefined);

    H.v('D0. SANS liste : le refus d\'avant, aucune des dix lignes n\'a d\'entrée admise par (D)', [lignes.map(l => e(sans, l.idProduct)).filter(x => x && x.mention === MENTION_EDITION_1).length, sans.denominateurs.admisCatalogue['tamponnee-empruntee']], [0, 0]);
    H.v('D0b. sans liste, le résultat est celui d\'avant (même liste d\'entrées avec ou sans la clé absente)', JSON.stringify(sansListeJa.entrees.map(x => x.idProduct)), JSON.stringify((await decider({ sets, docs, lignes, metacarte, regle, tamponneesEmpruntees: null })).entrees.map(x => x.idProduct)));
    H.v('D1. un produit de la liste (Prize Pack, substitut d\'un autre set) : servi EN AUTRE TIRAGE sous la mention existante, avec le scan de la carte d\'origine', [e(avec, 1001)?.visuel, e(avec, 1001)?.mention, cle(avec, 1001)], ['autre-tirage', MENTION_EDITION_1, 'cartes/orig10.webp']);
    H.v('D2. il est MARQUÉ emprunté (les règles d\'image ne le lisent pas)', avec.emprunts.includes(1001), true);
    H.v('D3. un produit PAS dans la liste : refusé comme avant', e(avec, 1002), undefined);
    H.v('D4. un scan que la règle de langue du site refuse (ja sur un set intl) : refusé, même dans la liste', e(avec, 1003), undefined);
    H.v('D4b. un scan sans langue : refusé par la même règle', e(avec, 1010), undefined);
    H.v('D5. un VRAI scan du set existe : il est servi, DU SET, jamais l\'emprunt (le remplacement par le vrai scan est automatique)', [e(avec, 1004)?.visuel, cle(avec, 1004), e(avec, 1004)?.mention, avec.emprunts.includes(1004)], ['du-set', 'cartes/vrai4.webp', null, false]);
    H.v('D6. l\'image empruntée du catalogue, dans le set (imageEmprunteeTirage) : servie en autre tirage sous la mention', [e(avec, 1005)?.visuel, e(avec, 1005)?.mention, cle(avec, 1005), avec.emprunts.includes(1005)], ['autre-tirage', MENTION_EDITION_1, 'cartes/emp5.webp', true]);
    H.v('D7. 30th Celebration et Trick or Trade 2024 : admis', [e(avec, 1006)?.visuel, e(avec, 1007)?.visuel], ['autre-tirage', 'autre-tirage']);
    H.v('D8. Battle Academy et WCD ne passent PAS par (D), même dans la liste (leurs règles sont (A) et (B))', [e(avec, 1008), e(avec, 1009)], [undefined, undefined]);
    H.v('D9. compteur nommé : 4 admis par (D) (1001, 1005, 1006, 1007)', avec.denominateurs.admisCatalogue['tamponnee-empruntee'], 4);
    H.v('D10. la somme tient : les refusés de moins qu\'avec la liste = les admis', sansListeJa.denominateurs.repliRefuse.total - avec.denominateurs.repliRefuse.total, 4);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
