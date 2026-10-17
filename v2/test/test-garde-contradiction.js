'use strict';
// Lot GARDE-CONTRADICTION (2026-10-17, « priorité absolue » du testeur) — jamais un verdict SÛR quand un champ LU sur la photo contredit le gagnant ET désigne un autre candidat du vivier.
// Cas fondateur S41 : photo = Magneton Aquapolis 22/147 (code lu « AQU », attaque « Steel Wave », carte TCGdex ecard2-22) ; la chaîne a affirmé EX Legend Maker 22/92 (même numéro 22).
// Module PUR + adaptateur : aucune base, aucun réseau, aucun identifiant de compte. Les valeurs de S41 (idProduct, numéros, totaux, attaques, set TCGdex, scores 80 / 10) sont celles MESURÉES dans rm_essai
// (lecture seule) par la reproduction du lot ; les autres cas sont des lignes FABRIQUÉES, nommées comme telles.
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
const LM = ligne(276899, 'Magneton [Reactive Recharge | Multiple Force | Magnetic Blast]', 'LM', '22', '92', 'ex12');
const AQ = ligne(275094, 'Magneton [Magnetic Flow | Steel Wave]', 'AQ', '22', '147', 'ecard2');
const AQ_HOLO = ligne(275049, 'Magneton [Magnetic Flow | Steel Wave]', 'AQ', 'H16', '147', 'ecard2');        // le jumeau holo : un AUTRE numéro
const LC = ligne(274793, 'Magneton [Sonicboom | Selfdestruct]', 'LC', '28', '110', 'base3');
const S41_VIVIER = [LM, AQ, AQ_HOLO, LC].map(l => l.idProduct);

// La réponse de la chaîne héritée (index.js : res.json) pour une AFFIRMATION, avec le bloc lectureGarde (posé quand la requête vient de v2).
function corpsDe({ gagnant, lecture = {}, vivierIds = S41_VIVIER, sansBloc = false, nom = 'Magneton', nomConfiance = 'haute', ambigu = false, candidats } = {}) {
    const l = { numero: '22', total: '147', setCode: 'AQU', symboleSet: 'e3', attaque: 'Steel Wave', attaqueConfiance: 'haute', carteTcgdexId: 'ecard2-22', totalHorsTailleDeSet: false, vivierIds, ...lecture };
    return { success: true, scanId: 's', question: null,
        carte: { idProduct: gagnant, ambigu, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom, nomBrut: nom, nomConfiance, numero: l.numero, total: l.total, setCode: l.setCode, tcgdexId: l.carteTcgdexId },
        etat: etatH, candidats: (candidats || [gagnant]).map(idProduct => ({ idProduct })), classement: (candidats || [gagnant]).map(idProduct => ({ idProduct, score: 80 })), reverse: { attendue: false, strategie: null }, codeLangue: 1,
        ...(sansBloc ? {} : { lectureGarde: l }) };
}
const jouer = (corps, lignes) => muet(() => adapter({ statutHttp: 200, corps }, { produits: new Map(lignes.map(l => [l.idProduct, l])), langueInterface: 'fr', cfg, jumeaux: sansJumeau }));
const montres = r => (r.issue === 'question' ? r.analyse.cartes[0].candidats.map(c => c.idProduct) : []);
const GC = () => require('../identifier/garde-contradiction');

// ── (1) S41 : le faux sûr est rétrogradé en question [gagnant, la vérité] ; le jumeau holo (numéro H16) n'est pas désigné
{
    const r = jouer(corpsDe({ gagnant: 276899 }), [LM, AQ, AQ_HOLO, LC]);
    v('(1) S41 : plus de verdict sûr (issue)', r.issue, 'question');
    v('(1)     la question montre le gagnant puis la vérité (275094), pas le jumeau holo ni Magneton LC', montres(r), [275094, 276899]);
    vrai('(1)     le résultat dit pourquoi (contradiction : total, attaque, set TCGdex)', typeof r.contradiction === 'string' && /total/.test(r.contradiction) && /attaque/.test(r.contradiction) && /setTcgdex/.test(r.contradiction) && /désigne 275094/.test(r.contradiction));
    const g = GC().contredire({ corps: corpsDe({ gagnant: 276899 }), gagnant: 276899, produits: new Map([LM, AQ, AQ_HOLO, LC].map(l => [l.idProduct, l])) });
    v('(1) la garde est appelable seule : champs qui contredisent le gagnant', g && g.contredit.map(c => c.champ), ['code', 'total', 'attaque', 'setTcgdex', 'symbole']);
    v('(1)     … et ce qu\'elle désigne, avec ce qui l\'étaye', g && g.designe, [{ idProduct: 275094, soutiens: ['total', 'attaque', 'setTcgdex'] }]);
    v('(1)     … les valeurs lues et celles du gagnant', g && g.contredit.find(c => c.champ === 'total'), { champ: 'total', lu: '147', gagnant: '92' });
}
// ── (2) une famille : UN champ à la fois contredit le gagnant et désigne un autre candidat (lignes FABRIQUÉES : même nom, même numéro)
{
    const base = (code, total, tcg, attaques) => ligne(0, `Carte [${attaques}]`, code, '12', total, tcg);
    const W = { ...base('AAA', '100', 'set1', 'Un | Deux'), idProduct: 1001 }, Y = { ...base('BBB', '100', 'set1', 'Un | Deux'), idProduct: 1002 };
    const lu = (champs) => ({ numero: '12', total: null, setCode: null, symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, ...champs });
    const cas = (nom, W2, Y2, champs, attendu) => {
        const r = jouer(corpsDe({ gagnant: 1001, lecture: lu(champs), vivierIds: [1001, 1002], nom: 'Carte' }), [W2, Y2]);
        v(`(2) ${nom}`, [r.issue, montres(r)], attendu);
    };
    cas('code contredit (lu BBB, gagnant AAA, un autre candidat BBB)', W, Y, { setCode: 'BBB' }, ['question', [1001, 1002]]);
    cas('total contredit (lu 150, gagnant /100, un autre candidat /150)', W, { ...Y, total: '150' }, { total: '150' }, ['question', [1001, 1002]]);
    cas('attaque contredite (lue « Trois », gagnant Un|Deux, un autre candidat la porte)', W, { ...Y, nomCardmarket: 'Carte [Trois | Quatre]' }, { attaque: 'Trois', attaqueConfiance: 'haute' }, ['question', [1001, 1002]]);
    cas('set TCGdex contredit (carte set2, gagnant set1, un autre candidat set2)', W, { ...Y, setTcgdex: 'set2' }, { carteTcgdexId: 'set2-12' }, ['question', [1001, 1002]]);
    cas('numéro contredit (lu 77, gagnant 12, un autre candidat 77)', W, { ...Y, numero: '77' }, { numero: '77' }, ['question', [1001, 1002]]);
    // le groupe : la garde ne rétrograde RIEN quand aucun champ ne contredit
    cas('aucune contradiction : le gagnant reste affirmé', W, Y, { setCode: 'AAA', total: '100', attaque: 'Un', attaqueConfiance: 'haute', carteTcgdexId: 'set1-12' }, ['affirmee', []]);
    // champ INCONNU d'un côté : ne contredit rien
    const nu = { ...W, total: null, setTcgdex: null, nomCardmarket: 'Carte' };
    cas('champ INCONNU du gagnant (ni total, ni set TCGdex, ni attaques) : rien ne contredit', nu, { ...Y, total: '150', setTcgdex: 'set2', nomCardmarket: 'Carte [Trois | Quatre]' }, { total: '150', attaque: 'Trois', attaqueConfiance: 'haute', carteTcgdexId: 'set2-12' }, ['affirmee', []]);
    // champ NON LU : ne contredit rien
    cas('champ NON LU (rien lu hors le numéro) : rien ne contredit', W, { ...Y, total: '150' }, {}, ['affirmee', []]);
    cas('attaque lue en confiance BASSE : non lue', W, { ...Y, nomCardmarket: 'Carte [Trois | Quatre]' }, { attaque: 'Trois', attaqueConfiance: 'basse' }, ['affirmee', []]);
    cas('total hors taille de set (mauvaise lecture) : non lu', W, { ...Y, total: '150' }, { total: '150', totalHorsTailleDeSet: true }, ['affirmee', []]);
    // contradiction SANS autre candidat compatible : la garde se tait (la carte imprime parfois un autre code que Cardmarket, §72)
    cas('code contredit mais personne ne le porte : pas de question fabriquée', W, Y, { setCode: 'ZZZ' }, ['affirmee', []]);
    // un autre candidat que le numéro LU contredit n'est pas désigné
    cas('l\'autre candidat porte le total lu mais un AUTRE numéro : non désigné', W, { ...Y, total: '150', numero: '99' }, { total: '150' }, ['affirmee', []]);
    // le nom lu (confiance haute) contredit l'autre candidat : non désigné (CONFIRMATION-SURE)
    {
        const r = jouer(corpsDe({ gagnant: 1001, lecture: lu({ total: '150' }), vivierIds: [1001, 1002], nom: 'Pikachu' }), [{ ...W, nomCardmarket: 'Pikachu [Un | Deux]' }, { ...Y, total: '150', nomCardmarket: 'Dracaufeu [Un | Deux]' }]);
        v('(2) le nom lu contredit l\'autre candidat : non désigné', [r.issue, montres(r)], ['affirmee', []]);
    }
}
// ── (3) l'ordre et la borne : les plus étayés d'abord, 3 choix au plus
{
    const W = ligne(2001, 'Carte [Un | Deux]', 'AAA', '12', '100', 'set1');
    const Ys = [ligne(2002, 'Carte', 'BBB', '12', '150', null), ligne(2003, 'Carte [Trois | Quatre]', 'CCC', '12', '150', 'set2'), ligne(2004, 'Carte [Trois | Quatre]', 'DDD', '12', '150', 'set2'), ligne(2005, 'Carte [Trois | Quatre]', 'EEE', '12', '151', 'set2')];
    const lecture = { numero: '12', total: '150', setCode: null, symboleSet: null, attaque: 'Trois', attaqueConfiance: 'haute', carteTcgdexId: 'set2-12' };
    const r = jouer(corpsDe({ gagnant: 2001, lecture, vivierIds: [2001, 2002, 2003, 2004, 2005], nom: 'Carte' }), [W, ...Ys]);
    v('(3) 4 candidats : 3 choix au plus, le gagnant puis les plus étayés (2003 et 2004 : total + attaque + set ; 2002 : total seul, coupé ; 2005 : autre total, écarté), rendus par idProduct', montres(r), [2001, 2003, 2004]);
}
// ── (4) sans bloc lectureGarde (route héritée directe, anciennes réponses) : le comportement d'avant, octet pour octet
{
    const r = jouer(corpsDe({ gagnant: 276899, sansBloc: true }), [LM, AQ, AQ_HOLO, LC]);
    v('(4) sans lectureGarde ni vivier : la chaîne héritée garde son défaut (affirmation)', r.issue, 'affirmee');
    const g = GC().contredire({ corps: corpsDe({ gagnant: 276899, sansBloc: true }), gagnant: 276899, produits: new Map([LM, AQ].map(l => [l.idProduct, l])) });
    v('(4)     la garde appelable seule se tait sans vivier', g, null);
    v('(4)     idsDeLaGarde ne charge rien sans bloc', GC().idsDeLaGarde(corpsDe({ gagnant: 276899, sansBloc: true })), []);
}
// ── (5) les ids à charger : le vivier, seulement pour une affirmation ou un candidat unique
{
    v('(5) idsDeLaGarde d\'une affirmation : le vivier de la chaîne', GC().idsDeLaGarde(corpsDe({ gagnant: 276899 })), S41_VIVIER);
    v('(5)     d\'une ambiguë à deux candidats : rien (pas une affirmation)', GC().idsDeLaGarde(corpsDe({ gagnant: 276899, ambigu: true, candidats: [276899, 275094] })), []);
    v('(5)     d\'une ambiguë à UN candidat : le vivier (UN-CANDIDAT passe par la garde)', GC().idsDeLaGarde(corpsDe({ gagnant: 276899, ambigu: true, candidats: [276899] })), S41_VIVIER);
    v('(5)     d\'un refus : rien', GC().idsDeLaGarde({ success: false, natureRefus: 'refus-delibere', motifRefus: 'egalite-parfaite' }), []);
}
// ── (6) UN-CANDIDAT : une ambiguë à un seul candidat que la lecture contredit montre aussi ce que la lecture désigne
{
    const r = jouer(corpsDe({ gagnant: 276899, ambigu: true, candidats: [276899] }), [LM, AQ, AQ_HOLO, LC]);
    v('(6) UN-CANDIDAT contredit : question [candidat, vérité]', [r.issue, montres(r)], ['question', [275094, 276899]]);
}
// ── (7) la garde des jumeaux reste le défaut quand la lecture ne contredit rien (ni gagnant désigné, ni nouveau chemin)
{
    const W = ligne(3001, 'Carte [Un | Deux]', 'AAA', '12', '100', 'set1');
    const J = ligne(3002, 'Carte [Un | Deux]', 'BBB', '99', '100', 'set1');
    const corps = corpsDe({ gagnant: 3001, lecture: { numero: '12', total: '100', setCode: 'AAA', attaque: null, attaqueConfiance: null, carteTcgdexId: null, symboleSet: null }, vivierIds: [3001, 3002], nom: 'Carte' });
    const r = muet(() => adapter({ statutHttp: 200, corps }, { produits: new Map([W, J].map(l => [l.idProduct, l])), langueInterface: 'fr', cfg, jumeaux: id => ({ conclu: true, ids: id === 3001 ? [3002] : [3001] }) }));
    v('(7) sans contradiction, un jumeau fait toujours sa question (garde des jumeaux inchangée)', [r.issue, r.contradiction === undefined], ['question', true]);
}
// ── (8) le catalogue sert le set TCGdex appris (la garde en a besoin) ; construireProduit ne le sert pas
{
    const { creerCatalogue } = require('../identifier/catalogue');
    const db = require('../db');
    const docs = { catalogue_produits: [{ idProduct: 1, name: 'Carte [Un]', idMetacard: 5 }], numeros_cartes: [{ idProduct: 1, slugSet: 'Aquapolis', codeSet: 'AQ', numero: '22', setTcgdex: 'ecard2' }], guide_prix: [] };
    const colReelle = db.col;
    db.col = nom => ({ find: () => ({ toArray: async () => docs[nom] || [] }) });       // un faux accès en LECTURE : aucune base n'est ouverte
    const vis = { entree: () => ({ total: '147' }), resoudre: async () => null, impressions: async () => [] };
    creerCatalogue({ cfg, visuels: vis }).lire([1]).finally(() => { db.col = colReelle; }).then(t => {
        vrai('(8) la ligne de catalogue porte setTcgdex et le total de l\'archive', t.get(1).setTcgdex === 'ecard2' && t.get(1).total === '147');
        const p = require('../identifier/produit').construireProduit(t.get(1), { langueInterface: 'fr', cfg });
        vrai('(8)     le Produit servi ne le porte pas', !('setTcgdex' in p) && !JSON.stringify(p).includes('ecard2'));
        bilan();
    }).catch(e => { console.log('❌ (8)', e && e.message); process.exitCode = 1; bilan(); });
}
