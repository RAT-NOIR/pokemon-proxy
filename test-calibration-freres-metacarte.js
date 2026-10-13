// node test-calibration-freres-metacarte.js — LA CALIBRATION de la clé « frères de métacarte » (lot M2), sur un monde fabriqué (objets purs, aucune base).
// Monde (set intl SetX, expansion 7) : quatre cartes Mon1..Mon4 à trois produits joints chacune (vérité connue) ; Mon3 a un HOMONYME dans le set (le danger
// du nom) ; un groupe q1,q2,q3 dont les frères se partagent entre deux cartes (le danger des frères) ; un set japonais (hors périmètre).
// `bDanger` ajoute le groupe qui piège l'épreuve B : retirée la vraie carte, les frères restants désignent la voisine. TOOL_DIR=<dossier> : copie mutée.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const Cal = require(path.join(DIR, 'collecte-cartes', 'calibration-freres-metacarte'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const attaquesDe = i => [`Aa${i}`, `Bb${i}`];
const carte = (i, extra = {}) => ({ _id: 1000 + i, nomEn: `Mon${i}`, attaques: attaquesDe(i).map(nom => ({ nom })), niveau: null, sets: ['SetX'], impressions: [], ...extra });
const SETS = [{ _id: 'SetX', code: 'X', idExpansion: [7], tirage: 'intl' }, { _id: 'SetJ', code: 'J', idExpansion: [8], tirage: 'jp' }];
function monde({ veriteContredite = false, exportDecale = false, exportSansMeta = false } = {}) {
    const cartes = [1, 2, 3, 4].map(i => carte(i)); cartes.push({ ...carte(3), _id: 1503, attaques: [{ nom: 'Cc' }] });
    const produits = [], lignes = [];
    const joint = (id, nom, meta, carteId, { exp = 7, slugSet = 'SetX', numero = '1' } = {}) => { produits.push([id, nom, meta, exp]); lignes.push({ _id: `${carteId}|${id}`, idProduct: id, carteId, slugSet, numeroFiche: numero, preuve: 'set+numero' }); };
    const nomP = i => `Mon${i} [${attaquesDe(i).join(' | ')}]`;
    for (const i of [1, 2, 3, 4]) for (const k of [1, 2, 3]) joint(100 * k + i, nomP(i), 10 + i, veriteContredite && k === 1 && i === 1 ? 1002 : 1000 + i, { numero: String(i) });
    joint(801, nomP(1), 80, 1001); joint(802, nomP(1), 80, 1001); joint(803, nomP(2), 80, 1002);
    for (const k of [1, 2, 3]) joint(900 + k, nomP(1), 90, 1001, { exp: 8, slugSet: 'SetJ' });
    // le groupe qui piège B' : un Dresseur (aucune attaque) à trois frères joints à Mon1. Aucun témoin d'attaque ne peut le contredire : seule l'ÉGALITÉ du nom produit/carte tient.
    joint(951, 'Mon1', 95, 1001); joint(952, 'Mon1', 95, 1001); joint(953, 'Mon1', 95, 1001);
    const decale = exportDecale ? 9000000 : 0;
    const exp = new Map(produits.map(([id, name, meta, ex]) => { const e = { name, idExpansion: ex }; if (!exportSansMeta) e.idMetacard = meta; return [id + decale, e]; }));
    return { lignes, cartes, exp, sets: SETS };
}
const MIN = { A: 1, BP: 1, D_NOM: 1, D_FRERES: 1 };
const calibrer = (w, o = {}) => Cal.calibrer({ lignes: w.lignes, cartes: w.cartes, export: w.exp, sets: w.sets, ecrits: [{ code: 'X', slugSet: 'SetX' }], ...o });

(async () => {
    let c = await calibrer(monde());
    verifier('A (vérité présente, set intl seulement) : 18 cas, 16 atteints, 12 justes, 0 faux — le set japonais est HORS périmètre', [c.total.A.cas, c.total.A.atteints, c.total.A.justes, c.total.A.fauxCarte], [18, 16, 12, 0]);
    verifier('   la clé se TAIT là où elle doit (Mon3 homonyme, q1/q2 frères partagés, q3 nom contredit) : 6 silences', c.total.A.silences, 6);
    verifier('B\' (frères joints à tort à une carte DÉCOY du set, vraie carte retirée) : 18 cas, 18 atteints (la clé a dû choisir), 0 faux — y compris le Dresseur sans attaque', [c.total.Bp.cas, c.total.Bp.atteints, c.total.Bp.fauxCarte], [18, 18, 0]);
    verifier('D-nom (le set a un homonyme de la vraie carte) : 3 cas, atteints (la clé a dû juger le nom), 0 désignation', [c.danger.nom.cas, c.danger.nom.atteints, c.danger.nom.fauxCarte], [3, 3, 0]);
    verifier('D-frères (les frères se partagent entre deux cartes) : 2 cas, 0 désignation', [c.danger.freres.cas, c.danger.freres.fauxCarte], [2, 0]);
    verifier('par set écrit : le set X porte les mêmes 18 cas A', c.parSet.X.A.cas, 18);
    verifier('le dénominateur est imprimé et exact : lignes de vérité intl, retrouvées dans l\'export', [c.denominateurs.verites, c.denominateurs.retrouvees], [18, 18]);
    verifier('verdict : ce monde passe avec des minimums de 1', Cal.verdict(c, MIN).ok, true);
    verifier('   … et il REFUSE si les minimums de cas atteints ne sont pas là (A: 17 atteints exigés pour 16)', [Cal.verdict(c, { ...MIN, A: 17 }).ok, /A : 16 cas atteints < minimum 17/.test(Cal.verdict(c, { ...MIN, A: 17 }).refus.join())], [false, true]);

    c = await calibrer(monde({ veriteContredite: true }));
    verifier('une ligne de vérité dont la carte est CONTREDITE par les attaques du produit est écartée et COMPTÉE (§67), pas jugée', [c.veriteContredite.total, c.total.A.cas], [1, 17]);

    for (const [nom, opt] of [['un export décalé qui n\'apparie RIEN', { exportDecale: true }], ['un export SANS idMetacard', { exportSansMeta: true }]]) {
        let e = null; try { await calibrer(monde(opt)); } catch (x) { e = x.message; }
        verifier(`${nom} : la calibration LÈVE (§41), elle ne rend pas « tout silence »`, !!e, true);
    }
    let e = null; try { await Cal.calibrer({ lignes: [], cartes: [], export: new Map(), sets: SETS, ecrits: [] }); } catch (x) { e = x.message; }
    verifier('des lignes vides LÈVENT (une base vide n\'est pas un résultat)', !!e, true);

    // ── le verdict, sur des états FABRIQUÉS ──
    const sain = () => ({ total: { A: { fauxCarte: 0, atteints: 400 }, Bp: { fauxCarte: 0, atteints: 400 } }, danger: { nom: { fauxCarte: 0, atteints: 150 }, freres: { fauxCarte: 0, atteints: 150 } } });
    const v = (mod, mins = Cal.MINIMUMS) => { const s = sain(); mod(s); return Cal.verdict(s, mins); };
    verifier('verdict : un état sain passe', v(() => { }).ok, true);
    verifier('   1 faux sur A, B\', D-nom ou D-frères : REFUS (chacun)', [v(s => { s.total.A.fauxCarte = 1; }).ok, v(s => { s.total.Bp.fauxCarte = 1; }).ok, v(s => { s.danger.nom.fauxCarte = 1; }).ok, v(s => { s.danger.freres.fauxCarte = 1; }).ok], [false, false, false, false]);
    verifier('   cas atteints sous le minimum : A, B\', D-nom, D-frères refusent chacun', [v(s => { s.total.A.atteints = Cal.MINIMUMS.A - 1; }).ok, v(s => { s.total.Bp.atteints = Cal.MINIMUMS.BP - 1; }).ok, v(s => { s.danger.nom.atteints = Cal.MINIMUMS.D_NOM - 1; }).ok, v(s => { s.danger.freres.atteints = Cal.MINIMUMS.D_FRERES - 1; }).ok], [false, false, false, false]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
