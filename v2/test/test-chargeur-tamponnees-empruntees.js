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
        carte(19, 'Play-Pokemon-Prize-Pack-Series-Seven', '006', []),
        // I1 : l'image empruntée du catalogue (refus « image-empruntee ») dans un set WCD / Battle Academy que (B) / (A) refusent : (D) ne la contourne PAS
        carte(20, 'WCD-2024', '006', [im('WCD-2024', '006', 'w999', { source: 'ctr', imageEmprunteeTirage: true })]),         // source « ctr » : (B) n'accepte que « emprunt » ; le refus rendu est « image-empruntee »
        carte(21, 'Battle-Academy-2020', null, [im('Battle-Academy-2020', null, 'ba99', { source: 'ctr', imageEmprunteeTirage: true })]),
        // I2 : un set d'aucune famille, donc aucun bandeau dérivé : le marqueur concret est imposé
        carte(22, 'Set-A', '001', [im('Set-A', '001', 'a1', { source: 'ctr', imageEmprunteeTirage: true })]),
        carte(23, 'Set-A', '002', [])
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
        ligne(1010, 19, 'Play-Pokemon-Prize-Pack-Series-Seven', '006', 'Ditto-PPS7-006', { visuelSubstitut: subst('orig19') }),          // dans la liste, scan sans langue (null)
        ligne(1011, 20, 'WCD-2024', '006', 'Zapdos-V2-WCD24PGO-006'),                                                                       // I1 : dans la liste, image empruntée dont le numéro ne colle pas à la fiche
        ligne(1012, 21, 'Battle-Academy-2020', null, 'Potion-V3-BA20C37'),                                                                   // I1 : dans la liste, image empruntée
        ligne(1013, 22, 'Set-A', '001', 'Foo-V1-SA-001'),                                                                                   // I2 : dans la liste, aucun bandeau
        ligne(1014, 23, 'Set-A', '002', 'Foo-Staff-SA-002', { visuelSubstitut: subst('orig23') })                                           // staff-prerelease, dans la liste
    ];
    docs[0].images = []; // carte 10 : aucune image propre
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const ids = (...x) => new Set(x);
    const liste = ids(1001, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014);
    // la langue d'un scan de substitut vient de la ligne : on la pose sur 1003 (ja) et 1010 (null)
    lignes.find(l => l.idProduct === 1003).visuelSubstitut.langue = 'ja'; lignes.find(l => l.idProduct === 1010).visuelSubstitut.langue = null;
    const refuses = (par) => ({ entree() { }, lien() { }, refuse: x => par.push([x.ligne.idProduct, x.refus]) });
    const refSans = [], refAvec = [];
    await decider({ sets, docs, lignes, metacarte, regle, sink: refuses(refSans) });
    await decider({ sets, docs, lignes, metacarte, regle, tamponneesEmpruntees: liste, sink: refuses(refAvec) });
    const sansR = await decider({ sets, docs, lignes, metacarte, regle });
    const avec = await decider({ sets, docs, lignes, metacarte, regle, tamponneesEmpruntees: liste });      // les assertions lisent ce résultat SANS sink (entrées rendues)
    const e = (r, id) => r.entrees.find(x => x.idProduct === id);
    const cle = (r, id) => (e(r, id) ? e(r, id).grande?.cle ?? null : undefined);

    H.v('D0. SANS liste : aucune entrée admise par (D), le compteur est à 0', [lignes.map(l => e(sansR, l.idProduct)).filter(x => x && x.mention === MENTION_EDITION_1).length, sansR.denominateurs.admisCatalogue['tamponnee-empruntee'], sansR.denominateurs.tamponneeSansBandeau], [0, 0, 0]);
    H.v('D0b. une liste VIDE ne change rien : mêmes entrées que sans liste, produit par produit', JSON.stringify(sansR.entrees), JSON.stringify((await decider({ sets, docs, lignes, metacarte, regle, tamponneesEmpruntees: new Set() })).entrees));
    H.v('D1. un produit de la liste (Prize Pack, substitut d\'un autre set) : servi EN AUTRE TIRAGE sous la mention existante, avec le scan de la carte d\'origine', [e(avec, 1001)?.visuel, e(avec, 1001)?.mention, cle(avec, 1001)], ['autre-tirage', MENTION_EDITION_1, 'cartes/orig10.webp']);
    H.v('D2. il est MARQUÉ emprunté (les règles d\'image ne le lisent pas)', avec.emprunts.includes(1001), true);
    H.v('D3. un produit PAS dans la liste : refusé comme avant', e(avec, 1002), undefined);
    H.v('D4. un scan que la règle de langue du site refuse (ja sur un set intl) : refusé, même dans la liste', e(avec, 1003), undefined);
    H.v('D4b. un scan sans langue : refusé par la même règle', e(avec, 1010), undefined);
    H.v('D5. un VRAI scan du set existe : il est servi, DU SET, jamais l\'emprunt (le remplacement par le vrai scan est automatique)', [e(avec, 1004)?.visuel, cle(avec, 1004), e(avec, 1004)?.mention, avec.emprunts.includes(1004)], ['du-set', 'cartes/vrai4.webp', null, false]);
    H.v('D6. l\'image empruntée du catalogue, dans le set (imageEmprunteeTirage) : servie en autre tirage sous la mention', [e(avec, 1005)?.visuel, e(avec, 1005)?.mention, cle(avec, 1005), avec.emprunts.includes(1005)], ['autre-tirage', MENTION_EDITION_1, 'cartes/emp5.webp', true]);
    H.v('D7. (relecture I2) Trick or Trade 2024 (bandeau TRICK_OR_TRADE dérivé) : admis ; 30th Celebration (AUCUN bandeau dérivé) : refusé, compté « sans bandeau »', [e(avec, 1007)?.visuel, e(avec, 1006)], ['autre-tirage', undefined]);
    H.v('D8. Battle Academy et WCD ne passent PAS par (D), même dans la liste (leurs règles sont (A) et (B))', [e(avec, 1008), e(avec, 1009)], [undefined, undefined]);
    H.v('D8b. (relecture I1) la même chose quand leur image porte imageEmprunteeTirage (refus « image-empruntee », rendu pour tout set) : WCD 1011 et Battle Academy 1012 restent refusés', [e(avec, 1011), e(avec, 1012)], [undefined, undefined]);
    H.v('D8c. (relecture I2) un set d\'aucune famille, donc sans bandeau (1013, 1014) : refusé ; 1013 (image empruntée) est compté « sans bandeau », 1014 (staff-prerelease) n\'est pas éligible', [e(avec, 1013), e(avec, 1014)], [undefined, undefined]);
    H.v('D9. (relecture M4) les admis par (D) sont IDENTIFIÉS : 1001, 1005, 1007', avec.entrees.filter(x => x.mention === MENTION_EDITION_1 && avec.emprunts.includes(x.idProduct)).map(x => x.idProduct).sort(), [1001, 1005, 1007]);
    H.v('D9b. compteurs : 3 admis ; sans bandeau = 1 (30th 1006) ; 1013, d\'un set d\'aucune famille hors liste, n\'est même pas éligible (tour 2)', [avec.denominateurs.admisCatalogue['tamponnee-empruntee'], avec.denominateurs.tamponneeSansBandeau], [3, 1]);
    const sorti = new Set(refSans.map(x => x[0]).filter(i => !new Set(refAvec.map(y => y[0])).has(i)));
    H.v('D10. (relecture M4) les produits qui QUITTENT le refus sont exactement les admis : 1001, 1005, 1007', [...sorti].sort(), [1001, 1005, 1007]);
    H.v('D11. (relecture M2) le crochet sink.refuse reçoit le produit et SA famille de refus (1008 : tamponnees-nommees ; 1002 : prize-packs) ', [refAvec.find(x => x[0] === 1008)?.[1], refAvec.find(x => x[0] === 1002)?.[1]], ['tamponnees-nommees', 'prize-packs']);
    // (relecture M3) une liste qui n'est pas un Set refuse AVANT tout traitement
    let msg = null; try { await decider({ sets, docs, lignes, metacarte, regle, tamponneesEmpruntees: [1001] }); } catch (x) { msg = x.message; }
    H.vrai('D12. (relecture M3) un tableau (ou des idProduct en chaîne) à la place du Set : erreur explicite', /Set d'idProduct/.test(msg || ''));
    // (relecture, mutations non attrapées) la fonction seule, sur des cas qui ne passent pas par la construction de la liste
    const { admissionTamponneeEmpruntee: adm } = require('../chargeur/decision');
    const L = new Set([1]), imE = { set: 'x', cleR2: 'cartes/x.webp', langue: 'en', imageEmprunteeTirage: true };
    const base = { ligne: { idProduct: 1 }, regle, liste: L, im: imE, typesEcrits: [] };
    const pp = set(  'Play-Pokemon-Prize-Pack-Series-Seven', 1), tot = set('Trick-or-Trade-2024', 2), ba = set('Battle-Academy-2020', 3), a = set('Set-A', 4);
    H.v('D13. mutation « !im retiré » : sans image, aucune admission et aucune exception', [adm({ ...base, set: pp, im: null, refus: 'prize-packs' }), adm({ ...base, set: pp, im: undefined, refus: 'prize-packs' })], [null, null]);
    H.v('D14. mutation « staff-prerelease admis » : ce refus n\'est jamais admis, même dans un set Prize Pack', adm({ ...base, set: pp, refus: 'staff-prerelease' }), null);
    H.v('D15. mutation « famille élargie » : un refus d\'une AUTRE famille que celle du set (wcd dans un set Prize Pack) n\'est pas admis', adm({ ...base, set: pp, refus: 'wcd' }), null);
    H.v('D16. mutation « Trick or Trade assoupli » : un set Battle Academy (famille tamponnees-nommees) n\'est jamais éligible, un set Trick or Trade l\'est', [adm({ ...base, set: ba, refus: 'tamponnees-nommees' }), adm({ ...base, set: tot, refus: 'tamponnees-nommees' })?.nature], [null, 'tamponnee-empruntee']);
    // tour 2 (relecture p8) ── I1 : la garde s'écrit par ce qu'elle AUTORISE ; M2 : le bandeau est un TAMPON de la liste fermée
    const setsInconnus = ['Battle-Academy-2026', 'WCD-2026', 'Set-A', 'Trick-or-Trade-Special', 'Play-Pokemon-Prize-Pack'].map((id, i) => set(id, 50 + i));
    H.v('D17. (I1) un set d\'AUCUNE famille et absent de la liste nommée (Battle-Academy-2026, WCD-2026, Set-A...) est REFUSÉ, même avec un tampon écrit sur la ligne et une image empruntée', setsInconnus.map(s => adm({ ...base, set: s, refus: 'image-empruntee', typesEcrits: ['STAFF'] })), [null, null, null, null, null]);
    const sea = set('Southeast-Asia-Promos', 60);
    H.v('D18. (I1) un set NOMMÉ dans la liste fermée (Southeast-Asia-Promos) passe, mais SEULEMENT avec un tampon écrit : sans, « sans bandeau »', [adm({ ...base, set: sea, refus: 'image-empruntee' }), adm({ ...base, set: sea, refus: 'image-empruntee', typesEcrits: ['STAFF'] })?.nature], [{ sansBandeau: true }, 'tamponnee-empruntee']);
    H.v('D19. (M2) un marqueur écrit qui n\'est pas un TAMPON (JUMBO, EDITION_1, BATTLE_ACADEMY, WCD, NON_LEGAL, FINITION_NON_VISIBLE) n\'est pas un bandeau', adm({ ...base, set: sea, refus: 'image-empruntee', typesEcrits: ['JUMBO', 'EDITION_1', 'BATTLE_ACADEMY', 'WCD', 'NON_LEGAL', 'FINITION_NON_VISIBLE'] }), { sansBandeau: true });
    H.v('D19b. (M2) la liste fermée des tampons est celle de la table des marqueurs : chacun existe, aucun n\'est un type sans libellé', require('../chargeur/decision').TYPES_TAMPON.every(t => require('../identifier/marqueurs').NOMS_TYPES.includes(t)), true);
    H.v('D20. WCD et Battle Academy gardent leurs règles quand (D) reçoit un type écrit : refus de la famille', [adm({ ...base, set: set('WCD-2024', 70), refus: 'image-empruntee', typesEcrits: ['STAFF'] }), adm({ ...base, set: ba, refus: 'image-empruntee', typesEcrits: ['STAFF'] })], [null, null]);
    // M1 : les éléments du Set sont validés
    const refusSet = async x => { try { await decider({ sets, docs, lignes, metacarte, regle, tamponneesEmpruntees: x }); return 'accepté'; } catch (e) { return /Set d'idProduct/.test(e.message) ? 'refusé' : 'autre erreur'; } };
    H.v('D21. (M1) un Set d\'idProduct en chaîne, nul, négatif ou non entier est refusé avant tout traitement ; un Set d\'entiers passe', [await refusSet(new Set(['1001'])), await refusSet(new Set([0])), await refusSet(new Set([-4])), await refusSet(new Set([1.5])), await refusSet(new Set([1001]))], ['refusé', 'refusé', 'refusé', 'refusé', 'accepté']);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
