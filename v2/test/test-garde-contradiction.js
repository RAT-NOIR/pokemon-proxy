'use strict';
// Lot GARDE-CONTRADICTION (2026-10-17, « priorité absolue » du testeur) — jamais un verdict SÛR quand un champ LU sur la photo contredit le gagnant ET désigne un autre candidat du vivier.
// Cas fondateur S41 : photo = Magneton Aquapolis 22/147 (code lu « AQU », attaque « Steel Wave », carte TCGdex ecard2-22) ; la chaîne a affirmé EX Legend Maker 22/92 (même numéro 22).
// Tour 1 : la langue lue face au tirage (Dark Tyranitar 908322 zh-hans affirmé pour une carte JP), l'attaque n'est plus un veto, numéro/total ôtent toujours le sûr, la variante stricte (constante), les familles de set TCGdex,
// le bloc lectureGarde, le rapprochement des codes lus (scoring.js).
// Module PUR + adaptateur : aucune base, aucun réseau, aucun identifiant de compte. Les valeurs de S41 (idProduct, numéros, totaux, attaques, set TCGdex) sont celles MESURÉES dans rm_essai (lecture seule).
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { adapter } = require('../identifier/adaptateur');

const cfg = lireConfig({});
const HOTE = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/';
const etatH = { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'EX' };
const sansJumeau = () => ({ conclu: true, ids: [] });
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };

const ligne = (idProduct, nomCardmarket, code, numero, total, setTcgdex, extra = {}) => ({ idProduct, nomCardmarket, nomFr: null, set: { slug: 'set-' + code, nom: 'Set ' + code, code }, numero, total, setTcgdex, langue: 'EN', variante: null,
    rarete: 'Rare', prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `${HOTE}${idProduct}.webp`, w: 255, h: 356 }, ...extra });
// S41 : les lignes mesurées (catalogue_produits + numeros_cartes + archive des visuels)
const LM = ligne(276899, 'Magneton [Reactive Recharge | Multiple Force | Magnetic Blast]', 'LM', '22', '92', 'ex12', { tirageSource: 'intl' });
const AQ = ligne(275094, 'Magneton [Magnetic Flow | Steel Wave]', 'AQ', '22', '147', 'ecard2', { tirageSource: 'intl' });
const AQ_HOLO = ligne(275049, 'Magneton [Magnetic Flow | Steel Wave]', 'AQ', 'H16', '147', 'ecard2', { tirageSource: 'intl' });        // le jumeau holo : un AUTRE numéro
const LC = ligne(274793, 'Magneton [Sonicboom | Selfdestruct]', 'LC', '28', '110', 'base3', { tirageSource: 'intl' });
const S41_VIVIER = [LM, AQ, AQ_HOLO, LC].map(l => l.idProduct);

// La réponse de la chaîne héritée (index.js : res.json) pour une AFFIRMATION, avec le bloc lectureGarde (posé quand la requête vient de v2).
function corpsDe({ gagnant, lecture = {}, vivierIds = S41_VIVIER, sansBloc = false, nom = 'Magneton', nomConfiance = 'haute', ambigu = false, candidats } = {}) {
    const l = { numero: '22', total: '147', setCode: 'AQU', symboleSet: 'e3', attaque: 'Steel Wave', attaqueConfiance: 'haute', carteTcgdexId: 'ecard2-22', langue: 'EN', totalHorsTailleDeSet: false, vivierIds, ...lecture };
    return { success: true, scanId: 's', question: null,
        carte: { idProduct: gagnant, ambigu, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom, nomBrut: nom, nomConfiance, numero: l.numero, total: l.total, setCode: l.setCode, tcgdexId: l.carteTcgdexId, langue: l.langue },
        etat: etatH, candidats: (candidats || [gagnant]).map(idProduct => ({ idProduct })), classement: (candidats || [gagnant]).map(idProduct => ({ idProduct, score: 80 })), reverse: { attendue: false, strategie: null }, codeLangue: 1,
        ...(sansBloc ? {} : { lectureGarde: l }) };
}
const jouer = (corps, lignes, jumeaux = sansJumeau) => muet(() => adapter({ statutHttp: 200, corps }, { produits: new Map(lignes.map(l => [l.idProduct, l])), langueInterface: 'fr', cfg, jumeaux }));
const montres = r => (r.issue === 'question' ? r.analyse.cartes[0].candidats.map(c => c.idProduct) : []);
const GC = () => require('../identifier/garde-contradiction');
const mapDe = lignes => new Map(lignes.map(l => [l.idProduct, l]));

// ── (1) S41 : le faux sûr est rétrogradé en question [gagnant, la vérité] ; le jumeau holo (numéro H16) n'est pas désigné
{
    const r = jouer(corpsDe({ gagnant: 276899 }), [LM, AQ, AQ_HOLO, LC]);
    v('(1) S41 : plus de verdict sûr (issue)', r.issue, 'question');
    v('(1)     la question montre le gagnant puis la vérité (275094), pas le jumeau holo ni Magneton LC', montres(r), [275094, 276899]);
    vrai('(1)     le résultat dit pourquoi (contradiction : total, attaque, désigne 275094)', typeof r.contradiction === 'string' && /total/.test(r.contradiction) && /attaque/.test(r.contradiction) && /désigne 275094/.test(r.contradiction));
    const g = GC().contredire({ corps: corpsDe({ gagnant: 276899 }), gagnant: 276899, produits: mapDe([LM, AQ, AQ_HOLO, LC]) });
    v('(1) la garde est appelable seule : champs qui contredisent le gagnant (le set TCGdex ecard2 face à ex12 est d\'une AUTRE famille : inconnu)', g && g.contredit.map(c => c.champ), ['code', 'total', 'attaque', 'symbole']);
    v('(1)     … et ce qu\'elle désigne, avec ce qui l\'étaye', g && g.designe, [{ idProduct: 275094, soutiens: ['total', 'attaque'] }]);
    v('(1)     … les valeurs lues et celles du gagnant', g && g.contredit.find(c => c.champ === 'total'), { champ: 'total', lu: '147', gagnant: '92' });
    vrai('(1)     … le total contredit : `fort` (le sûr est ôté même sans désigné)', g && g.fort === true);
}
// ── (2) une famille : UN champ à la fois contredit le gagnant et désigne un autre candidat (lignes FABRIQUÉES : même nom, même numéro)
{
    const base = (code, total, tcg, attaques) => ligne(0, `Carte [${attaques}]`, code, '12', total, tcg);
    const W = { ...base('AAA', '100', 'set1', 'Un | Deux'), idProduct: 1001 }, Y = { ...base('BBB', '100', 'set1', 'Un | Deux'), idProduct: 1002 };
    const lu = (champs) => ({ numero: '12', total: null, setCode: null, symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, ...champs });
    const cas = (nom, W2, Y2, champs, attendu) => {
        const r = jouer(corpsDe({ gagnant: 1001, lecture: lu(champs), vivierIds: [1001, 1002], nom: 'Carte' }), [W2, Y2]);
        v(`(2) ${nom}`, [r.issue, montres(r)], attendu);
    };
    cas('code contredit (lu BBB, gagnant AAA, un autre candidat BBB)', W, Y, { setCode: 'BBB' }, ['question', [1001, 1002]]);
    cas('total contredit (lu 150, gagnant /100, un autre candidat /150)', W, { ...Y, total: '150' }, { total: '150' }, ['question', [1001, 1002]]);
    cas('attaque contredite (lue « Trois », gagnant Un|Deux, un autre candidat la porte)', W, { ...Y, nomCardmarket: 'Carte [Trois | Quatre]' }, { attaque: 'Trois', attaqueConfiance: 'haute' }, ['question', [1001, 1002]]);
    cas('set TCGdex contredit (carte set2, gagnant set1, un autre candidat set2 : même famille)', W, { ...Y, setTcgdex: 'set2' }, { carteTcgdexId: 'set2-12' }, ['question', [1001, 1002]]);
    cas('numéro contredit (lu 77, gagnant 12, un autre candidat 77)', W, { ...Y, numero: '77' }, { numero: '77' }, ['question', [1001, 1002]]);
    cas('langue contredite (lue JP, gagnant tirage zh-hans, un autre candidat tirage jp)', { ...W, tirageSource: 'zh-hans' }, { ...Y, tirageSource: 'jp' }, { langue: 'JP' }, ['question', [1001, 1002]]);
    cas('aucune contradiction : le gagnant reste affirmé', W, Y, { setCode: 'AAA', total: '100', attaque: 'Un', attaqueConfiance: 'haute', carteTcgdexId: 'set1-12' }, ['affirmee', []]);
    // champ INCONNU d'un côté : ne contredit rien
    const nu = { ...W, total: null, setTcgdex: null, nomCardmarket: 'Carte', tirageSource: null };
    cas('champ INCONNU du gagnant (ni total, ni set TCGdex, ni attaques, ni tirage) : rien ne contredit', nu, { ...Y, total: '150', setTcgdex: 'set2', nomCardmarket: 'Carte [Trois | Quatre]', tirageSource: 'jp' }, { total: '150', attaque: 'Trois', attaqueConfiance: 'haute', carteTcgdexId: 'set2-12', langue: 'JP' }, ['affirmee', []]);
    // champ NON LU : ne contredit rien
    cas('champ NON LU (rien lu hors le numéro) : rien ne contredit', W, { ...Y, total: '150' }, {}, ['affirmee', []]);
    cas('attaque lue en confiance BASSE : non lue', W, { ...Y, nomCardmarket: 'Carte [Trois | Quatre]' }, { attaque: 'Trois', attaqueConfiance: 'basse' }, ['affirmee', []]);
    cas('total hors taille de set (mauvaise lecture) : non lu', W, { ...Y, total: '150' }, { total: '150', totalHorsTailleDeSet: true }, ['affirmee', []]);
    // contradiction SANS autre candidat compatible, hors numéro et total : la garde se tait (la carte imprime parfois un autre code que Cardmarket, §72)
    cas('code contredit mais personne ne le porte : pas de question fabriquée', W, Y, { setCode: 'ZZZ' }, ['affirmee', []]);
    // un autre candidat que le numéro LU contredit n'est pas désigné — et le total contredit le gagnant : le sûr est ôté (fort), sans désigné => confirmation à UN candidat
    cas('le total contredit le gagnant, l\'autre candidat porte un AUTRE numéro : non désigné, le sûr est ôté (confirmation du gagnant seul)', W, { ...Y, total: '150', numero: '99' }, { total: '150' }, ['question', [1001]]);
    // le nom lu (confiance haute) contredit l'autre candidat : non désigné (CONFIRMATION-SURE)
    {
        const r = jouer(corpsDe({ gagnant: 1001, lecture: lu({ attaque: 'Trois', attaqueConfiance: 'haute' }), vivierIds: [1001, 1002], nom: 'Pikachu' }), [{ ...W, nomCardmarket: 'Pikachu [Un | Deux]' }, { ...Y, nomCardmarket: 'Dracaufeu [Trois | Quatre]' }]);
        v('(2) le nom lu contredit l\'autre candidat : non désigné (attaque seule : le sûr reste)', [r.issue, montres(r)], ['affirmee', []]);
    }
}
// ── (3) l'ordre et la borne : les plus étayés d'abord, 3 choix au plus
{
    const W = ligne(2001, 'Carte [Un | Deux]', 'AAA', '12', '100', 'set1');
    const Ys = [ligne(2002, 'Carte', 'BBB', '12', '150', null), ligne(2003, 'Carte [Trois | Quatre]', 'CCC', '12', '150', 'set2'), ligne(2004, 'Carte [Trois | Quatre]', 'DDD', '12', '150', 'set2'), ligne(2005, 'Carte [Trois | Quatre]', 'EEE', '12', '151', 'set2')];
    const lecture = { numero: '12', total: '150', setCode: null, symboleSet: null, attaque: 'Trois', attaqueConfiance: 'haute', carteTcgdexId: 'set2-12', langue: null };
    const r = jouer(corpsDe({ gagnant: 2001, lecture, vivierIds: [2001, 2002, 2003, 2004, 2005], nom: 'Carte' }), [W, ...Ys]);
    v('(3) 4 candidats : 3 choix au plus, le gagnant puis les plus étayés (2003 et 2004 : total + attaque + set ; 2002 : total seul, coupé ; 2005 : autre total, écarté), rendus par idProduct', montres(r), [2001, 2003, 2004]);
}
// ── (4) sans bloc lectureGarde (route héritée directe, anciennes réponses) : le comportement d'avant
{
    const avant = GC().compteurs().sansBloc;
    const r = jouer(corpsDe({ gagnant: 276899, sansBloc: true }), [LM, AQ, AQ_HOLO, LC]);
    v('(4) sans lectureGarde ni vivier : le total lu (147) contredit encore LM (92) mais personne n\'est désigné : le sûr est ôté (confirmation de LM seul)', [r.issue, montres(r)], ['question', [276899]]);
    vrai('(4)     le bloc absent est COMPTÉ (compteurs().sansBloc)', GC().compteurs().sansBloc === avant + 1);
    const g = GC().contredire({ corps: corpsDe({ gagnant: 276899, sansBloc: true }), gagnant: 276899, produits: mapDe([LM, AQ]) });
    vrai('(4)     la garde appelable seule : fort, personne désigné', g && g.fort === true && g.designe.length === 0);
    v('(4)     idsDeLaGarde ne charge rien sans bloc', GC().idsDeLaGarde(corpsDe({ gagnant: 276899, sansBloc: true })), []);
}
// ── (5) les ids à charger : le vivier, pour une affirmation, un candidat unique, ou une ambiguë à 3 candidats au plus (le filtre de nom peut la réduire à un)
{
    v('(5) idsDeLaGarde d\'une affirmation : le vivier de la chaîne', GC().idsDeLaGarde(corpsDe({ gagnant: 276899 })), S41_VIVIER);
    v('(5)     d\'une ambiguë à deux candidats : le vivier (le filtre de nom peut la réduire à un)', GC().idsDeLaGarde(corpsDe({ gagnant: 276899, ambigu: true, candidats: [276899, 275094] })), S41_VIVIER);
    v('(5)     d\'une ambiguë à UN candidat : le vivier', GC().idsDeLaGarde(corpsDe({ gagnant: 276899, ambigu: true, candidats: [276899] })), S41_VIVIER);
    v('(5)     d\'une ambiguë à plus de 3 candidats : rien', GC().idsDeLaGarde(corpsDe({ gagnant: 276899, ambigu: true, candidats: [1, 2, 3, 4] })), []);
    v('(5)     d\'un refus : rien', GC().idsDeLaGarde({ success: false, natureRefus: 'refus-delibere', motifRefus: 'egalite-parfaite' }), []);
}
// ── (6) UN-CANDIDAT : une ambiguë à un seul candidat que la lecture contredit montre aussi ce que la lecture désigne
{
    const r = jouer(corpsDe({ gagnant: 276899, ambigu: true, candidats: [276899] }), [LM, AQ, AQ_HOLO, LC]);
    v('(6) UN-CANDIDAT contredit : question [candidat, vérité]', [r.issue, montres(r)], ['question', [275094, 276899]]);
    // deux candidats dont le filtre de nom en retire un : le candidat unique qui reste passe par la garde
    const r2 = jouer(corpsDe({ gagnant: 276899, ambigu: true, candidats: [276899, 274793], nom: 'Magneton' }), [LM, AQ, AQ_HOLO, LC]);
    vrai('(6)     ambiguë à deux candidats : la garde voit le vivier (jamais une affirmation de LM)', r2.issue !== 'affirmee');
}
// ── (7) la garde des jumeaux reste le défaut quand la lecture ne contredit rien
{
    const W = ligne(3001, 'Carte [Un | Deux]', 'AAA', '12', '100', 'set1');
    const J = ligne(3002, 'Carte [Un | Deux]', 'BBB', '99', '100', 'set1');
    const corps = corpsDe({ gagnant: 3001, lecture: { numero: '12', total: '100', setCode: 'AAA', attaque: null, attaqueConfiance: null, carteTcgdexId: null, symboleSet: null, langue: null }, vivierIds: [3001, 3002], nom: 'Carte' });
    const r = jouer(corps, [W, J], id => ({ conclu: true, ids: id === 3001 ? [3002] : [3001] }));
    v('(7) sans contradiction, un jumeau fait toujours sa question (garde des jumeaux inchangée)', [r.issue, r.contradiction === undefined], ['question', true]);
}
// ── (8) le catalogue sert le set TCGdex appris, le total et le tirage (la garde en a besoin) ; construireProduit ne les sert pas
const fin8 = (async () => {
    const { creerCatalogue } = require('../identifier/catalogue');
    const db = require('../db');
    const docs = { catalogue_produits: [{ idProduct: 1, name: 'Carte [Un]', idMetacard: 5 }], numeros_cartes: [{ idProduct: 1, slugSet: 'Aquapolis', codeSet: 'AQ', numero: '22', setTcgdex: 'ecard2' }], guide_prix: [] };
    const colReelle = db.col;
    db.col = nom => ({ find: () => ({ toArray: async () => docs[nom] || [] }) });       // un faux accès en LECTURE : aucune base n'est ouverte
    const vis = { entree: () => ({ total: '147' }), tirage: () => 'intl', resoudre: async () => null, impressions: async () => [] };
    let t; try { t = await creerCatalogue({ cfg, visuels: vis }).lire([1]); } finally { db.col = colReelle; }
    vrai('(8) la ligne de catalogue porte setTcgdex, le total de l\'archive et le tirage', t.get(1).setTcgdex === 'ecard2' && t.get(1).total === '147' && t.get(1).tirageSource === 'intl');
    const p = require('../identifier/produit').construireProduit(t.get(1), { langueInterface: 'fr', cfg });
    vrai('(8)     le Produit servi ne porte ni le set TCGdex ni le tirage de source', !('setTcgdex' in p) && !('tirageSource' in p) && !JSON.stringify(p).includes('ecard2'));
    // le tirage vient de la colonne des jumeaux : l'accesseur de la version, puis le lecteur de visuels
    const E = require('../chargeur/etat'), { creerConstructeur } = require('../chargeur/version'), { creerVisuels } = require('../identifier/visuels');
    const b = creerConstructeur(); b.entree(require('./_visuels-banc').doc(7, { idMetacard: 99 }));
    b.jumeau({ idProduct: 7, idMetacard: 99, idExpansion: 5, numero: '1', tirage: 'jp' }); b.jumeau({ idProduct: 8, idMetacard: 99, idExpansion: 5, numero: '2' });
    const ver = b.finir();
    v('(8)     version.tirageJumeaux : jp / inconnu (null) / produit hors colonne (null)', [ver.tirageJumeaux(7), ver.tirageJumeaux(8), ver.tirageJumeaux(12345)], ['jp', null, null]);
    v('(8)     le lecteur de visuels le rend (synchrone) ; sans version : null', [creerVisuels({ cfg, version: () => ver }).tirage(7), creerVisuels({ cfg, version: () => null }).tirage(7)], ['jp', null]);
    void E;
})();
// ── (9) la LANGUE : le cas Dark Tyranitar (908322 tirage zh-hans affirmé pour une carte JP lue ; la vérité 907909 est le tirage jp) — et l'attaque « Crush » mal lue n'écarte pas la vérité
{
    const DT = 'Dark Tyranitar [Grind | Spinning Tail | Bite Off]';
    const CN = ligne(908322, DT, '30thC', '144', null, null, { tirageSource: 'zh-hans' });
    const JP = ligne(907909, DT, 'm6a', '144', null, null, { tirageSource: 'jp' });
    const JP2 = ligne(606871, DT, 'S8a-P', '144', null, null, { tirageSource: 'jp' });
    const corps = (lecture = {}) => corpsDe({ gagnant: 908322, vivierIds: [908322, 907909, 606871], nom: 'Dark Tyranitar', lecture: { numero: '144', total: '103', setCode: 'S8a-P', symboleSet: null, attaque: 'Crush', attaqueConfiance: 'haute', carteTcgdexId: null, langue: 'JP', ...lecture } });
    const r = jouer(corps(), [CN, JP, JP2]);
    v('(9) Dark Tyranitar : plus de verdict sûr, la question montre la vérité (907909), malgré l\'attaque mal lue (« Crush » contredit TOUS les candidats)', [r.issue, montres(r).includes(907909), montres(r).includes(908322)], ['question', true, true]);
    const g = GC().contredire({ corps: corps(), gagnant: 908322, produits: mapDe([CN, JP, JP2]) });
    v('(9)     contredit par code, attaque, langue ; la langue (et pour S8a-P le code) étaye les deux tirages jp', [g && g.contredit.map(c => c.champ), g && g.designe.map(d => d.soutiens.join('+'))], [['code', 'attaque', 'langue'], ['code+langue', 'langue']]);
    v('(9)     langue lue JP et gagnant 907909 (tirage jp) : aucune contradiction de langue, le sûr reste', jouer(corpsDe({ gagnant: 907909, vivierIds: [908322, 907909, 606871], nom: 'Dark Tyranitar', lecture: { numero: '144', total: null, setCode: 'm6a', attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: 'JP', symboleSet: null } }), [CN, JP, JP2]).issue, 'affirmee');
    // la table langue/tirage
    const L = GC().langueCompatible;
    v('(9) langueCompatible : EN/FR/IT -> intl vrai, JP -> intl faux, JP -> jp vrai, ZH -> zh-hans vrai, FR -> jp faux, tirage id/th/idth/absent : inconnu, langue absente : inconnu',
        [L('EN', 'intl'), L('FR', 'intl'), L('IT', 'intl'), L('JP', 'intl'), L('JP', 'jp'), L('ZH', 'zh-hans'), L('FR', 'jp'), L('EN', 'id'), L('EN', 'th'), L('JP', 'idth'), L('JP', null), L(null, 'jp'), L('JA', 'jp')],
        [true, true, true, false, true, true, false, null, null, null, null, null, true]);
}
// ── (10) numéro ou total contredit : TOUJOURS pas de sûr, même sans candidat désigné (confirmation à UN candidat)
{
    const W = ligne(4001, 'Carte [Un]', 'AAA', '12', '100', 'set1', { tirageSource: 'intl' });
    const lecture = { numero: '12', total: '150', setCode: null, symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null };
    const r = jouer(corpsDe({ gagnant: 4001, lecture, vivierIds: [4001], nom: 'Carte' }), [W]);
    v('(10) le total lu (150) contredit le gagnant (/100), aucun autre candidat : question de confirmation à UN candidat', [r.issue, montres(r), r.analyse && r.analyse.cartes[0].question.code], ['question', [4001], 'confirmation']);
    const r2 = jouer(corpsDe({ gagnant: 4001, lecture: { ...lecture, total: null, numero: '99' }, vivierIds: [4001], nom: 'Carte' }), [W]);
    v('(10) le numéro lu (99) contredit le gagnant (12), aucun autre candidat : de même', [r2.issue, montres(r2)], ['question', [4001]]);
    // le gagnant a des jumeaux : leur garde passe d'abord, jamais une affirmation
    const Jm = ligne(4002, 'Carte [Un]', 'BBB', '30', '100', 'set1', { tirageSource: 'intl' });
    const r3 = jouer(corpsDe({ gagnant: 4001, lecture, vivierIds: [4001, 4002], nom: 'Carte' }), [W, Jm], id => ({ conclu: true, ids: id === 4001 ? [4002] : [4001] }));
    vrai('(10) avec un jumeau : la question de départage des jumeaux, jamais une affirmation', r3.issue === 'question' && montres(r3).includes(4001) && montres(r3).includes(4002));
}
// ── (11) la VARIANTE STRICTE (a), derrière UNE constante de module : prête et testée, éteinte par défaut
{
    const W = ligne(5001, 'Carte [Un | Deux]', 'AAA', '12', '100', 'set1', { tirageSource: 'intl' });
    const base = { numero: '12', total: '100', setCode: null, symboleSet: null, attaque: 'Trois', attaqueConfiance: 'haute', carteTcgdexId: null, langue: null };
    const corps = (l = {}) => corpsDe({ gagnant: 5001, lecture: { ...base, ...l }, vivierIds: [5001], nom: 'Carte' });
    const P = mapDe([W]);
    v('(11) la constante livrée : éteinte', GC().VARIANTE_STRICTE, false);
    v('(11) défaut : une attaque contredite sans désigné laisse le sûr', GC().contredire({ corps: corps(), gagnant: 5001, produits: P }), null);
    const s = GC().contredire({ corps: corps(), gagnant: 5001, produits: P, stricte: true });
    vrai('(11) stricte : la même attaque (confiance haute) ôte le sûr même sans désigné', s && s.fort === true && s.designe.length === 0);
    v('(11) stricte : une attaque en confiance MOYENNE ne suffit pas', GC().contredire({ corps: corps({ attaqueConfiance: 'moyenne' }), gagnant: 5001, produits: P, stricte: true }), null);
    vrai('(11) stricte : le set TCGdex de la même famille ôte le sûr', GC().contredire({ corps: corps({ attaque: null, carteTcgdexId: 'set2-12' }), gagnant: 5001, produits: mapDe([{ ...W, setTcgdex: 'set1' }]), stricte: true }));
    v('(11) stricte : le code (variante b) est écarté', GC().contredire({ corps: corps({ attaque: null, setCode: 'ZZZ' }), gagnant: 5001, produits: P, stricte: true }), null);
    v('(11) stricte : la langue ne suffit pas non plus (désigné seulement)', GC().contredire({ corps: corps({ attaque: null, langue: 'JP' }), gagnant: 5001, produits: mapDe([{ ...W, tirageSource: 'intl' }]), stricte: true }), null);
}
// ── (12) les familles de set TCGdex : une série japonaise (E2, PMCG4, E1) face à un set occidental appris (ecard2, base5, ecard1) = inconnu, jamais une contradiction (formes de S11, S14, S32, S39) ; vrais identifiants à point
{
    const M = GC().memeSetTcgdex;
    v('(12) S11 PMCG4 / base5, S14 E2 / ecard2, S32 E1 / ecard1, S39 PMCG4 / base5 : inconnu', [M('PMCG4', 'base5'), M('E2', 'ecard2'), M('E1', 'ecard1'), M('PMCG4', 'base5')], [null, null, null, null]);
    v('(12) identifiants à point : sv03.5 = sv03.5 (vrai), sv03.5 / sv04 (même famille : faux), swsh12.5 = swsh12.5, swsh12.5 / swsh12 (faux)', [M('sv03.5', 'sv03.5'), M('sv03.5', 'sv04'), M('swsh12.5', 'swsh12.5'), M('swsh12.5', 'swsh12')], [true, false, true, false]);
    v('(12) ecard2 / ex12 (autres familles) : inconnu ; E2 / E3 (même famille japonaise) : faux ; E2 / e2 (casse différente) : inconnu ; ids absents : inconnu', [M('ecard2', 'ex12'), M('E2', 'E3'), M('E2', 'e2'), M(null, 'base5'), M('base5', null)], [null, false, null, null, null]);
    // dans le statut d'un champ : l'id de la carte lue ne devient pas une contradiction
    const st = GC().statuts({ numero: '56', tcgdexId: 'E2-056', langue: 'JP' }, ligne(1, 'Carte', 'EC2', '56', null, 'ecard2'));
    v('(12) statuts : E2-056 face à la ligne ecard2 : setTcgdex inconnu (S14 reste sûre)', st.setTcgdex, '?');
}
// ── (13) le bloc lectureGarde : une seule écriture, testée sans serveur ; le branchement de index.js est vérifié dans le source (le vrai index.js ne démarre pas sans .env : test-contrat-reel / test-identifier-v2 à la porte)
{
    const bloc = GC().blocLectureGarde({ cardInfo: { number: '22', total: '147', setCode: 'AQU', symboleSet: 'e3', language: 'EN', attaque: 'Steel Wave', attaqueConfiance: 'haute' }, tcgdexId: 'ecard2-22', totalHorsTailleDeSet: false, produits: [{ idProduct: 5 }, { idProduct: 'x' }, { idProduct: 6 }, null] });
    v('(13) blocLectureGarde : toutes les lectures et le vivier (entiers seulement)', bloc, { numero: '22', total: '147', setCode: 'AQU', symboleSet: 'e3', langue: 'EN', attaque: 'Steel Wave', attaqueConfiance: 'haute', carteTcgdexId: 'ecard2-22', totalHorsTailleDeSet: false, vivierIds: [5, 6] });
    v('(13)     sans rien : des null, un vivier vide, jamais une exception', GC().blocLectureGarde(), { numero: null, total: null, setCode: null, symboleSet: null, langue: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, totalHorsTailleDeSet: false, vivierIds: [] });
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'index.js'), 'utf8');
    vrai('(13) index.js pose le bloc UNIQUEMENT pour une requête v2 (req.scanIdImpose) et par la fonction du module', /\.\.\.\(req\.scanIdImpose \? \{ lectureGarde: blocLectureGarde\(\{ cardInfo, tcgdexId: trouvaille\.id, totalHorsTailleDeSet, produits \}\) \} : \{\}\)/.test(src) && /const \{ blocLectureGarde \} = require\('\.\/v2\/identifier\/garde-contradiction'\)/.test(src));
}
// ── (14) le RAPPROCHEMENT DES CODES LUS (scoring.js) : « AQU » lu, « AQ » au vivier
{
    const S = require('../../scoring');
    const cand = [{ idProduct: 1, idExpansion: 1550, numeroCardmarket: '22', codeSet: 'LM' }, { idProduct: 2, idExpansion: 1537, numeroCardmarket: '22', codeSet: 'AQ' }, { idProduct: 3, idExpansion: 1537, numeroCardmarket: 'H16', codeSet: 'AQ' }, { idProduct: 4, idExpansion: 7, numeroCardmarket: '28', codeSet: 'LC' }];
    const IN = 'inconnu';
    v('(14) AQU lu (code INCONNU de la chaîne) : le seul code du vivier à le satisfaire est AQ', S.codeRapprocheDuVivier('AQU', cand, IN), 'AQ');
    v('(14)     I-A : le code lu est RATTACHÉ à un code connu (exact, convention-x, parente, mot-non-code) ou sa résolution est absente : jamais de rapprochement', ['exact', 'convention-x', 'parente', 'mot-non-code', null, undefined].map(x => S.codeRapprocheDuVivier('AQU', cand, x)), [null, null, null, null, null, null]);
    v('(14)     RAPPROCHEMENT_CODES allumée ; éteinte (paramètre), plus aucun rapprochement', [S.RAPPROCHEMENT_CODES, S.codeRapprocheDuVivier('AQU', cand, IN, false)], [true, null]);
    const connus = ['LM', 'AQ', 'SVP', 'xPRE', 'PRE', 'WC'];
    v('(14)     resolutionDuCodeLu : exact / convention-x / parente / inconnu / mot-non-code / rien / liste illisible', [S.resolutionDuCodeLu('SVP', connus).resolution, S.resolutionDuCodeLu('PRE', ['XPRE']).resolution, S.resolutionDuCodeLu('PRE', ['PRE1X']).resolution, S.resolutionDuCodeLu('AQU', ['LM', 'SVP']).resolution, S.resolutionDuCodeLu('Promo', connus).resolution, S.resolutionDuCodeLu(null, connus).resolution, S.resolutionDuCodeLu('AQU', []).resolution], ['exact', 'convention-x', 'parente', 'inconnu', 'mot-non-code', null, null]);
    v('(14)     … l\'alias e-Reader (e1 lu : EC1 connu) est exact ; la parenté nomme ses cousins', [S.resolutionDuCodeLu('e1', ['EC1']).resolution, S.resolutionDuCodeLu('PRE', ['PRE1X']).parente], ['exact', 'PRE~PRE1X']);
    const lu = { numero: '22', setCode: 'AQU', setCodeResolution: IN, idExpansionsAttendues: [], rarete: null, regionAttendue: null, motif: { vises: [], autresVariantes: [] } };
    const r = S.choisirMeilleur(cand, lu), sc = id => r.scores.find(s => s.candidat.idProduct === id);
    vrai('(14) S41 : AQ (numéro 22) prend le bonus partiel au lieu du malus', /^\+15 .*rapproché/.test(sc(2).detail.set) && /^-40/.test(sc(1).detail.set));
    vrai('(14)     AQ H16 (un AUTRE numéro) : pas de bonus, le code court ne s\'apparente jamais seul', /^-40/.test(sc(3).detail.set));
    v('(14)     deux codes du vivier satisfont le code lu : aucun rapprochement', S.codeRapprocheDuVivier('DP', [{ codeSet: 'DPPR' }, { codeSet: 'DP4m' }], IN), null);
    v('(14)     un code égal existe déjà : aucun rapprochement', S.codeRapprocheDuVivier('LM', cand, IN), null);
    v('(14)     un code apparenté (3 caractères) existe déjà : les règles d\'avant passent', S.codeRapprocheDuVivier('PRE', [{ codeSet: 'xPRE' }, { codeSet: 'PR' }], IN), null);
    v('(14)     « XY » lu pour « XYPR » seul au vivier : rapproché ; un seul caractère (« M » / « MCRP ») : jamais', [S.codeRapprocheDuVivier('XY', [{ codeSet: 'XYPR' }, { codeSet: 'SM' }], IN), S.codeRapprocheDuVivier('M', [{ codeSet: 'MCRP' }], IN)], ['XYPR', null]);
    v('(14)     une sous-suite n\'est pas un préfixe (ADV1 / ADVex1) : aucun rapprochement', S.codeRapprocheDuVivier('ADV1', [{ codeSet: 'ADVex1' }], IN), null);
    v('(14)     sans code lu ou sans vivier : null', [S.codeRapprocheDuVivier(null, cand, IN), S.codeRapprocheDuVivier('AQU', [], IN), S.codeRapprocheDuVivier('AQU', null, IN)], [null, null, null]);
    // SV est un préfixe de SVP sans en être le set : le candidat doit porter le numéro lu
    const c2 = [{ idProduct: 1, idExpansion: 1, numeroCardmarket: '50', codeSet: 'SV' }, { idProduct: 2, idExpansion: 2, numeroCardmarket: '7', codeSet: 'ZZZ' }];
    const r2 = S.choisirMeilleur(c2, { numero: '7', setCode: 'SVP', setCodeResolution: IN, idExpansionsAttendues: [], rarete: null, regionAttendue: null, motif: { vises: [], autresVariantes: [] } });
    vrai('(14)     SVP lu, SV au vivier avec un AUTRE numéro : pas de bonus', /^-40/.test(r2.scores.find(s => s.candidat.idProduct === 1).detail.set));
    // I-A, le stress fabriqué de la relecture : le code lu « WC » est un VRAI code connu (autre set) ; « WCD11 » au vivier porte le numéro lu ; la vraie carte (code sans rapport) a 25 points d'avance (prix bas, carte normale).
    const stress = [{ idProduct: 1, idExpansion: 1, numeroCardmarket: '5', codeSet: 'ZZ1', prix: 1 }, { idProduct: 2, idExpansion: 2, numeroCardmarket: '5', codeSet: 'WCD11', prix: 10 }];
    const luS = (resolution) => ({ numero: '5', setCode: 'WC', setCodeResolution: resolution, idExpansionsAttendues: [], rarete: 'normale', rareteElevee: false, regionAttendue: null, motif: { vises: [], autresVariantes: [] } });
    v('(14) I-A stress : « WC » est un code connu (résolution exact) : la vraie carte reste en tête, aucun bonus à WCD11', [S.choisirMeilleur(stress, luS('exact')).scores[0].candidat.idProduct, S.choisirMeilleur(stress, luS('exact')).scores.map(s => s.score)], [1, [35, 10]]);
    v('(14)     … sans résolution du tout (appelant qui ne la sait pas) : de même, jamais de rapprochement', S.choisirMeilleur(stress, luS(undefined)).scores[0].candidat.idProduct, 1);
    v('(14)     … résolution « inconnu » (aucun code connu ne s\'y rattache) : le rapprochement joue, la limite écrite', S.choisirMeilleur(stress, luS('inconnu')).scores[0].candidat.idProduct, 2);
}
// ── (15) I-B : le VETO DE LANGUE est tenu — le cas 7a (Dark Tyranitar 908322 zh-hans affirmé, vérité 907909 jp m6a 144/103, langue lue JP) ; un candidat dont le tirage contredit la langue lue n'est jamais désigné, même s'il porte le code lu
{
    const DT = 'Dark Tyranitar [Grind | Spinning Tail | Bite Off]';
    const CN = ligne(908322, DT, '30thC', '144', '103', null, { tirageSource: 'zh-hans' });
    const JP = ligne(907909, DT, 'm6a', '144', '103', null, { tirageSource: 'jp' });
    const CN2 = ligne(777001, DT, 'S8a-P', '144', '103', null, { tirageSource: 'zh-hans' });        // porte le CODE lu, mais son tirage contredit la langue lue
    const corps = corpsDe({ gagnant: 908322, vivierIds: [908322, 907909, 777001], nom: 'Dark Tyranitar', lecture: { numero: '144', total: '103', setCode: 'S8a-P', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: 'JP' } });
    const g = GC().contredire({ corps, gagnant: 908322, produits: mapDe([CN, JP, CN2]) });
    v('(15) 7a : le candidat zh-hans qui porte le code lu n\'est PAS désigné (veto de langue) ; la vérité jp l\'est', g && g.designe.map(d => d.idProduct), [907909]);
    vrai('(15)     VETO_LANGUE allumée et dans VETOS', GC().VETO_LANGUE === true && GC().VETOS.includes('langue'));
    const r = jouer(corps, [CN, JP, CN2]);
    v('(15)     le sûr 908322 devient une question [gagnant, vérité]', [r.issue, montres(r)], ['question', [907909, 908322]]);
}
// ── (16) I-C : l'attaque trie et écarte AVEC REPLI parmi les désignés
{
    const W = ligne(6001, 'Carte [Un | Deux]', 'AAA', '12', '100', null, { tirageSource: 'intl' });
    const Y = (id, nom) => ligne(id, nom, 'BBB', '12', '150', null, { tirageSource: 'intl' });
    const lecture = { numero: '12', total: '150', setCode: null, symboleSet: null, attaque: 'Trois', attaqueConfiance: 'haute', carteTcgdexId: null, langue: null };
    const dec = (ys) => { const g = GC().contredire({ corps: corpsDe({ gagnant: 6001, lecture, vivierIds: [6001, ...ys.map(y => y.idProduct)], nom: 'Carte' }), gagnant: 6001, produits: mapDe([W, ...ys]) }); return g && g.designe.map(d => d.idProduct); };
    v('(16) un désigné que l\'attaque CONTREDIT est retiré s\'il en reste un autre (6002 : Quatre/Cinq contredit ; 6003 : Trois concorde)', dec([Y(6002, 'Carte [Quatre | Cinq]'), Y(6003, 'Carte [Trois | Six]')]), [6003]);
    v('(16)     tous contredits par l\'attaque (la lecture est fausse, cas Dark Tyranitar) : on les garde tous', dec([Y(6002, 'Carte [Quatre | Cinq]'), Y(6004, 'Carte [Sept | Huit]')]), [6002, 6004]);
    v('(16)     attaque concorde avant attaque inconnue (6005 sans crochets), à soutiens égaux', dec([Y(6005, 'Carte'), Y(6003, 'Carte [Trois | Six]')]), [6003, 6005]);
    v('(16)     un inconnu et un contredit : le contredit est retiré', dec([Y(6002, 'Carte [Quatre | Cinq]'), Y(6005, 'Carte')]), [6005]);
}
// ── (17) M-A : les désignés ne passent pas par la garde des jumeaux — ce que la question rend quand un désigné a des variantes du MÊME créneau (même numéro, même total) qui ne tiennent pas dans les 3 places
{
    const W = ligne(7001, 'Carte [Un | Deux]', 'AAA', '12', '100', null, { tirageSource: 'intl' });
    const Vs = [7002, 7003, 7004].map(id => ligne(id, 'Carte [Un | Deux]', 'BBB', '12', '150', null, { tirageSource: 'intl' }));       // trois variantes d'un même produit désigné (même créneau)
    const corps = corpsDe({ gagnant: 7001, lecture: { numero: '12', total: '150', setCode: null, symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null }, vivierIds: [7001, 7002, 7003, 7004], nom: 'Carte' });
    const r = jouer(corps, [W, ...Vs]);
    v('(17) 3 variantes désignées + le gagnant : la question rend 3 choix (le gagnant puis les 2 premiers par soutiens puis idProduct), la 3e variante n\'est pas montrée ; jamais une affirmation', [r.issue, montres(r)], ['question', [7001, 7002, 7003]]);
}
fin8.then(() => bilan());
