// Banc du lot LOGOS-NIVEAU : --sets, cible `en`, niveau sur chaque entrée écrite, semi-officiel, export. Faux réseau, base EN MÉMOIRE, faux R2 : aucune requête, aucune écriture réelle.
//   node test-logos-niveau.js
const crypto = require('crypto');
const sharp = require('sharp');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const r2 = require('./collecte-cartes/r2');
const M = require('./collecter-logos-officiels');
const { LOGOS_GENERIQUES } = require('./collecte-cartes/langue-logo');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const URL_FR = 'https://assets.tcgdex.net/fr/swsh/cel25/logo.png', URL_EN = 'https://assets.tcgdex.net/en/swsh/cel25/logo.png';
const URL_B = 'https://billsarchive.com/assets/logos/japanese/jp-undone-seal.webp', URL_BEN = 'https://billsarchive.com/assets/logos/celebrations.webp';
const L = (o = {}) => ({ part: 'JP', fichier: 'Logo JP/ADV5.png', verdict: 'OFFICIEL', set: 'Undone-Seal', setSur: true, cible: 'ja', langue: 'ja', urls: [URL_B], urlChoisie: URL_B, source: 'billsarchive', bulbapediaSeule: false, cache: null, pokecardexSha256: 'p'.repeat(64), ...o });
const sets = new Map([['Undone-Seal', { _id: 'Undone-Seal', tirage: 'jp', region: 'jp' }], ['Celebrations', { _id: 'Celebrations', tirage: 'intl', region: 'intl' }], ['Scarlet-Violet', { _id: 'Scarlet-Violet', tirage: 'intl', region: 'intl' }]]);
const EN = (o = {}) => L({ part: 'AJOUT', fichier: 'AJOUT TCGdex Celebrations en', set: 'Celebrations', cible: 'en', langue: 'en', urls: [URL_EN], urlChoisie: URL_EN, source: 'tcgdex', ajoutDirect: true, pokecardexSha256: null, ...o });
const logoA = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="10" y="60" font-size="60" fill="#d22" font-family="Arial">ABCD</text></svg>')).png().toBuffer();
const logoB = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><circle cx="40" cy="40" r="35" fill="#22d"/><rect x="100" y="10" width="190" height="20" fill="#2a2"/></svg>')).png().toBuffer();
const REPR = 'logo de l\'opération McDonald\'s Match Battle 2022-2023';

(async () => {
    // ───── 1. --sets : sans l'option, rien ne change ; avec, la collecte se borne aux sets nommés
    const tab = [L(), L({ set: 'Scarlet-Violet', cible: 'fr', langue: 'fr', urls: [URL_FR], urlChoisie: URL_FR, source: 'tcgdex' })];
    const sansSets = M.choisirLignes({ officiels: tab, ajouts: M.AJOUTS, setsDemandes: null, setsParId: sets });
    verifier('sans --sets : EXACTEMENT les lignes de la table, aucun ajout, aucune erreur', [sansSets.officiels === tab || JSON.stringify(sansSets.officiels) === JSON.stringify(tab), sansSets.erreurs], [true, []]);
    const avecSets = M.choisirLignes({ officiels: tab, ajouts: M.AJOUTS, setsDemandes: ['Celebrations'], setsParId: sets });
    verifier('--sets=Celebrations : les ajouts de Celebrations (fr et en), aucune ligne de la table', [avecSets.officiels.map(l => `${l.set}:${l.cible}`), avecSets.erreurs], [['Celebrations:fr', 'Celebrations:en'], []]);
    const deuxSets = M.choisirLignes({ officiels: tab, ajouts: M.AJOUTS, setsDemandes: ['Undone-Seal', 'Celebrations'], setsParId: sets });
    verifier('--sets=A,B : les lignes de la table de A, plus les ajouts de B', deuxSets.officiels.map(l => `${l.set}:${l.cible}`), ['Undone-Seal:ja', 'Celebrations:fr', 'Celebrations:en']);
    verifier('--sets=<set absent de la base> : erreur nommée, aucune ligne', [M.choisirLignes({ officiels: tab, ajouts: M.AJOUTS, setsDemandes: ['Fantome'], setsParId: sets }).erreurs.length, M.choisirLignes({ officiels: tab, ajouts: M.AJOUTS, setsDemandes: ['Fantome'], setsParId: sets }).officiels], [1, []]);
    verifier('--sets=<set de la base sans aucune ligne> : erreur nommée (rien à faire n\'est pas un succès)', M.choisirLignes({ officiels: tab, ajouts: M.AJOUTS, setsDemandes: ['Scarlet-Violet-X'], setsParId: new Map([...sets, ['Scarlet-Violet-X', { _id: 'Scarlet-Violet-X', tirage: 'intl' }]]) }).erreurs.length, 1);
    const ar = M.argumentsInconnus;
    verifier('arguments : --sets=A,B accepté ; --sets nu, --sets=, --set=A, --sets=A;B refusés', [ar(['--sets=A,B', '--cache=x']), ar(['--sets']), ar(['--sets=']), ar(['--set=A']), ar(['--sets=A;B'])], [[], ['--sets'], ['--sets='], ['--set=A'], ['--sets=A;B']]);
    verifier('arguments : l\'option du semi-officiel existe, un fichier .json', [ar(['--semi-officiel=semis.json']), ar(['--semi-officiel=semis.txt'])], [[], ['--semi-officiel=semis.txt']]);

    // ───── 1 bis. TOUR 1 : la simulation ne retombe JAMAIS en silence sur la connexion d'écriture
    {
        const O = require('./collecte-cartes/ouvrir-lecture');
        const sorties = []; let ouvertures = 0;
        const ecriture = async () => { ouvertures++; return { cartes: { db: {} }, fermer: async () => { } }; };
        let erreur = null;
        try { await O.ouvrirSimulation({ env: {}, ouvrirConnexions: ecriture, journal: m => sorties.push(m) }); } catch (e) { erreur = e.message; }
        verifier('sans variable de lecture : REFUS nommé, aucune connexion d\'écriture ouverte', [/MONGODB_CARTES_LECTURE_URI/.test(erreur ?? ''), ouvertures, sorties.length], [true, 0, 0]);
        const cx = await O.ouvrirSimulation({ env: {}, viaEcriture: true, ouvrirConnexions: ecriture, journal: m => sorties.push(m) });
        verifier('option explicite : la connexion d\'écriture sert, et le bandeau est imprimé', [!!cx.cartes, ouvertures, sorties], [true, 1, ['⚠️ LECTURE VIA LA CONNEXION D\'ÉCRITURE']]);
        verifier('--lecture-via-ecriture est dans la liste fermée (sans valeur)', [M.argumentsInconnus(['--lecture-via-ecriture']), M.argumentsInconnus(['--lecture-via-ecriture=1'])], [[], ['--lecture-via-ecriture=1']]);
    }

    // ───── 2. la cible `en`
    verifier('langueProuvee : TCGdex /en/ prouve en ; Bill\'s sans préfixe ne prouve rien', [M.langueProuvee(URL_EN), M.langueProuvee(URL_BEN)], ['en', null]);
    verifier('en, TCGdex /en/, set intl : collecter', M.planifier(EN(), sets).action, 'collecter');
    verifier('en, Bill\'s sans préfixe : écartée (aucune règle de nom ne prouve l\'anglais chez Bill\'s)', [M.planifier(EN({ urls: [URL_BEN], urlChoisie: URL_BEN, source: 'billsarchive' }), sets).action, /prouve/.test(M.planifier(EN({ urls: [URL_BEN], urlChoisie: URL_BEN, source: 'billsarchive' }), sets).raison)], ['ecartee', true]);
    verifier('en sur un set japonais : écartée (tirage)', M.planifier(EN({ set: 'Undone-Seal' }), sets).action, 'ecartee');
    verifier('ligne dite en dont l\'adresse TCGdex est /fr/ : écartée', M.planifier(EN({ urls: [URL_FR], urlChoisie: URL_FR }), sets).action, 'ecartee');
    verifier('ligne dite fr dont l\'adresse TCGdex est /en/ : écartée (la règle fr/ja n\'a pas bougé)', M.planifier(L({ set: 'Celebrations', cible: 'fr', langue: 'fr', urls: [URL_EN], urlChoisie: URL_EN, source: 'tcgdex' }), sets).action, 'ecartee');
    verifier('cible inconnue (es) : écartée', M.planifier(EN({ cible: 'es', langue: 'es' }), sets).action, 'ecartee');
    verifier('les ajouts fermés : Celebrations fr (/fr/) et en (/en/), TCGdex, rien d\'autre', M.AJOUTS.map(a => [a.set, a.cible, a.langue, a.urlChoisie, a.source]), [['Celebrations', 'fr', 'fr', URL_FR, 'tcgdex'], ['Celebrations', 'en', 'en', URL_EN, 'tcgdex']]);
    verifier('chaque ajout passe le plan sur la base (collecter)', M.AJOUTS.map(a => M.planifier(a, sets).action), ['collecter', 'collecter']);
    const A = await logoA(), B = await logoB();
    verifier('fr identique à en (TCGdex sert l\'anglais sous /fr/) : le fr est refusé, l\'en gardé', M.refusFrIdentiqueEn([{ ligne: EN({ cible: 'fr', langue: 'fr' }), sha256: 'x' }, { ligne: EN(), sha256: 'x' }]).map(r => !!r), [true, false]);
    verifier('fr différent de en : aucun refus', M.refusFrIdentiqueEn([{ ligne: EN({ cible: 'fr', langue: 'fr' }), sha256: 'x' }, { ligne: EN(), sha256: 'y' }]).map(r => !!r), [false, false]);

    // ───── 3. juger : une ligne d'ajout (adresse prouvée) n'a pas de Pokécardex ; la table, elle, garde sa règle
    verifier('ajout : image lisible, adresse prouvée : accepté (via adresse-seule)', (({ ok, via }) => ({ ok, via }))(await M.juger(EN(), A)), { ok: true, via: 'adresse-seule' });
    verifier('ajout : une empreinte générique : refus', (await M.juger(EN(), A, { sha1Force: [...LOGOS_GENERIQUES.keys()][0] })).ok, false);
    verifier('ajout : image trop petite : refus', (await M.juger(EN(), await sharp({ create: { width: 50, height: 10, channels: 3, background: '#fff' } }).png().toBuffer())).ok, false);
    verifier('ajout : pas une image : refus', (await M.juger(EN(), Buffer.from('<html>défi</html>'))).ok, false);
    verifier('ligne de TABLE sans cache ni Pokécardex : refus comme avant (je ne sais pas)', (await M.juger(L(), A, { pokecardexBuf: null })).ok, false);

    // ───── 4. le semi-officiel : une ligne, sa phrase, sa source légale
    const SEMI = (o = {}) => ({ set: 'Celebrations', cible: 'en', langue: 'en', url: URL_EN, fichier: 'cel25 logo', represente: REPR, ...o });
    verifier('semi : phrase + source légale + set de la base : collecter', [M.planifierSemi(SEMI(), sets).action, M.planifierSemi(SEMI(), sets).ligne?.niveau], ['collecter', 'semi-officiel']);
    verifier('semi sans phrase : refus', [M.planifierSemi(SEMI({ represente: undefined }), sets).action, M.planifierSemi(SEMI({ represente: '   ' }), sets).action, M.planifierSemi(SEMI({ represente: 'logo' }), sets).action], ['refus', 'refus', 'refus']);
    verifier('semi hors liste fermée d\'hôtes : refus', M.planifierSemi(SEMI({ url: 'https://exemple.org/x.png' }), sets).action, 'refus');
    verifier('semi sur un set absent : écartée', M.planifierSemi(SEMI({ set: 'Fantome' }), sets).action, 'ecartee');
    verifier('semi : langue non prouvée par l\'adresse (Bill\'s sans préfixe) : écartée', M.planifierSemi(SEMI({ url: URL_BEN }), sets).action, 'ecartee');
    const lSemi = M.planifierSemi(SEMI(), sets).ligne;
    verifier('semi : l\'exception à la garde générique, SEULEMENT avec la phrase', [(await M.juger(lSemi, A, { sha1Force: [...LOGOS_GENERIQUES.keys()][0] })).ok, (await M.juger({ ...lSemi, represente: '' }, A, { sha1Force: [...LOGOS_GENERIQUES.keys()][0] })).ok], [true, false]);
    verifier('semi : une copie de Pokécardex reste refusée même avec la phrase', (await M.juger(lSemi, A, { sha1Force: [...require('./collecte-cartes/langue-logo').LOGOS_COPIES.keys()][0] })).ok, false);

    // ───── 5. l'export
    {
        const X = require('./exporter-donnees-logos-site');
        const e = (langue, extra = {}) => ({ cleR2: `logos-officiels/${langue}/X.png`, vignette: { cleR2: `vignettes/logos-officiels/${langue}/X.webp`, w: 400, h: 100 }, w: 800, h: 200, sha256: 'a', langue, source: 'tcgdex', urlSource: 'https://assets.tcgdex.net/x', mention: M.MENTION, lot: 'l', ...extra });
        const o = X.logosOfficielsDesSets([{ _id: 'S', logoOfficiel: { fr: e('fr'), en: e('en', { niveau: 'officiel' }), ja: e('ja', { niveau: 'officiel' }) } }]);
        verifier('export : `en` est exporté à côté de fr et ja', Object.keys(o.S), ['fr', 'ja', 'en']);
        verifier('export : `niveau` — celui de l\'entrée, `officiel` par défaut', [o.S.fr.niveau, o.S.en.niveau, o.S.ja.niveau], ['officiel', 'officiel', 'officiel']);
        verifier('export : une entrée qui dit autre chose que officiel n\'est PAS reclassée en silence (la table est officielle par construction, le niveau écrit est celui qui sort)', X.logosOfficielsDesSets([{ _id: 'S', logoOfficiel: { fr: e('fr', { niveau: 'semi-officiel' }) } }]).S.fr.niveau, 'semi-officiel');
        const s = X.logosSemiOfficielsDesSets([{ _id: 'S', logoSemiOfficiel: { en: e('en', { niveau: 'semi-officiel', represente: REPR }) } }, { _id: 'T', logoSemiOfficiel: { en: e('en', { niveau: 'semi-officiel' }) } }, { _id: 'U', logoOfficiel: { fr: e('fr') } }]);
        verifier('export semi : la phrase `represente` et `niveau` sortent ; sans phrase, l\'entrée n\'est pas exportée ; un set sans champ n\'y est pas', [Object.keys(s), s.S?.en?.niveau, s.S?.en?.represente], [['S'], 'semi-officiel', REPR]);
    }

    verifier('export (tour 1) : le compte imprime à part les entrées `en`, non lues par le site', require('./exporter-donnees-logos-site').resumeLogosOfficiels({ A: { fr: {}, en: {} }, B: { ja: {} }, C: { en: {} } }), '3 sets (4 logos, dont 2 en, non lus par le site aujourd\'hui)');

    // ───── 6. l'écriture : niveau, en, semi, retrait — base EN MÉMOIRE, faux R2
    const banc = await ouvrirBanc(); banc.appliquer();
    const cx = await mongoose.createConnection(process.env.MONGODB_CARTES_URI, { dbName: 'cartes' }).asPromise();
    const S = cx.db.collection('sets');
    const magasin = new Map();
    Object.assign(r2, {
        verifierBucket: async () => 'faux', existe: async (b, k) => magasin.has(k),
        deposerBinaire: async (b, k, buf) => { if (magasin.has(k)) return { ecrit: false, cle: k }; magasin.set(k, buf); return { ecrit: true, cle: k }; },
        supprimer: async (b, ks) => { ks.forEach(k => magasin.delete(k)); return ks.length; }
    });
    try {
        const existant = { _id: 'Celebrations', tirage: 'intl', region: 'intl', code: 'CEL', nomAffichage: 'Celebrations', logoCompose: { cleR2: 'logos/composes/C.png', source: 'compose' }, logoOfficiel: { fr: { cleR2: 'logos-officiels/fr/autre.png', lot: 'autre-lot' } } };
        await S.insertOne({ ...existant });
        await S.insertOne({ _id: 'Undone-Seal', tirage: 'jp', region: 'jp' });
        const fichier = { buf: A, sha256: sha256(A), ext: 'png', url: URL_EN, via: 'adresse-seule', corr: null };
        const e = await M.ecrireLigne({ S, r2, bucket: 'b', ligne: EN(), set: 'Celebrations', fichier, le: new Date('2026-10-13') });
        const d = await S.findOne({ _id: 'Celebrations' });
        verifier('écriture de la cible en : logoOfficiel.en posé, niveau officiel, langue en, clé sous logos-officiels/en/', [e.action, d.logoOfficiel.en?.niveau, d.logoOfficiel.en?.langue, d.logoOfficiel.en?.cleR2, d.logoOfficiel.en?.lot], ['ecrit', 'officiel', 'en', `logos-officiels/en/Celebrations-${sha256(A).slice(0, 10)}.png`, M.LOT]);
        verifier('… le logoOfficiel.fr d\'un autre lot et logoCompose restent intacts', [d.logoOfficiel.fr, d.logoCompose], [existant.logoOfficiel.fr, existant.logoCompose]);
        const eJa = await M.ecrireLigne({ S, r2, bucket: 'b', ligne: L(), set: 'Undone-Seal', fichier: { buf: B, sha256: sha256(B), ext: 'png', url: URL_B, via: 'identique-phase-1' }, le: new Date() });
        verifier('une écriture fr/ja porte AUSSI niveau officiel (chaque entrée écrite)', [eJa.action, (await S.findOne({ _id: 'Undone-Seal' })).logoOfficiel.ja.niveau], ['ecrit', 'officiel']);
        const avant = magasin.size;
        const eFrSurEn = await M.ecrireLigne({ S, r2, bucket: 'b', ligne: EN({ cible: 'fr', langue: 'fr' }), set: 'Celebrations', fichier, le: new Date() });
        verifier('ecrireLigne : cible fr avec une adresse /en/ : refus, rien dans R2', [eFrSurEn.action, magasin.size], ['refus', avant]);
        // semi
        const lS = M.planifierSemi(SEMI(), sets).ligne;
        const eSemiSansPhrase = await M.ecrireLigne({ S, r2, bucket: 'b', ligne: { ...lS, represente: '' }, set: 'Celebrations', fichier, le: new Date() });
        verifier('semi : écriture sans phrase `represente` : refus, rien dans R2', [eSemiSansPhrase.action, magasin.size], ['refus', avant]);
        const eSemi = await M.ecrireLigne({ S, r2, bucket: 'b', ligne: lS, set: 'Celebrations', fichier, le: new Date('2026-10-13') });
        const d2 = await S.findOne({ _id: 'Celebrations' });
        verifier('semi : logoSemiOfficiel.en posé (niveau, phrase, lot semi, clé semi), logoOfficiel.en NON touché', [eSemi.action, d2.logoSemiOfficiel?.en?.niveau, d2.logoSemiOfficiel?.en?.represente, d2.logoSemiOfficiel?.en?.lot, d2.logoSemiOfficiel?.en?.cleR2.startsWith('logos-semi-officiels/en/Celebrations-'), d2.logoOfficiel.en.cleR2], ['ecrit', 'semi-officiel', REPR, M.LOT_SEMI, true, d.logoOfficiel.en.cleR2]);
        const eSemi2 = await M.ecrireLigne({ S, r2, bucket: 'b', ligne: lS, set: 'Celebrations', fichier: { ...fichier, buf: B, sha256: sha256(B) }, le: new Date() });
        verifier('semi : un autre fichier sur un logoSemiOfficiel déjà posé : refus', eSemi2.action, 'refus');
        // retrait : exactement le lot semi, puis le lot officiel (qui porte maintenant aussi `en`)
        const simSemi = await M.retirerLot({ S, r2, bucket: 'b', lot: M.LOT_SEMI, racine: 'logoSemiOfficiel', ecrire: false });
        verifier('retrait du lot semi (simulation) : le set et ses 2 objets R2', [simSemi.sets, simSemi.cles.length], [['Celebrations'], 2]);
        await M.retirerLot({ S, r2, bucket: 'b', lot: M.LOT_SEMI, racine: 'logoSemiOfficiel', ecrire: true });
        const d3 = await S.findOne({ _id: 'Celebrations' });
        verifier('retrait du lot semi : logoSemiOfficiel disparu, logoOfficiel.en gardé', [d3.logoSemiOfficiel, !!d3.logoOfficiel.en], [undefined, true]);
        await M.retirerLot({ S, r2, bucket: 'b', lot: M.LOT, ecrire: true });
        const d4 = await S.findOne({ _id: 'Celebrations' });
        verifier('retrait du lot officiel : retire aussi la cible en ; l\'autre lot (fr) reste', [d4.logoOfficiel, magasin.size], [{ fr: existant.logoOfficiel.fr }, 0]);
    } finally { await cx.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
