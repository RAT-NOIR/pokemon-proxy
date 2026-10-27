// node test-marqueurs-etiquettes.js — les marqueurs STAFF, WCD (année, joueur), LEAGUE (+ PLACE) posés par DEUX sources concordantes (collecte-cartes/marqueurs-etiquettes.js).
// Fonctions PURES : aucune base, aucun fichier, aucune requête. Les produits du marché sont lus par la fonction de production (tcgcsv-jointure.js::lireTcg / lireWcdTcg).
const M = require('./collecte-cartes/marqueurs-etiquettes');
const JT = require('./collecte-cartes/tcgcsv-jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const raisons = r => r.refus.map(x => x.raison);

// ── fixtures : deux produits Cardmarket d'une même carte (V1 sans étiquette, V2 « Staff Version »), un groupe du marché apparié à l'expansion
const cmP = (idProduct, nom, numero, slug, idExpansion = 10, slugSet = 'SV-Black-Star-Promos') => ({ idProduct, slug, slugSet, idExpansion, name: nom, lu: JT.lireCm({ idProduct, name: nom, numero, slug, slugSet, idExpansion }) });
const cm = { produits: new Map([[1, cmP(1, 'Chi-Yu', '057', 'Chi-Yu-V1-SVP057')], [2, cmP(2, 'Chi-Yu', '057', 'Chi-Yu-V2-SVP057')], [3, cmP(3, 'Xatu', '059', 'Xatu-V2-SVP059', 99)]]) };
const tcg = (productId, name, number) => JT.lireTcg({ productId, name, number, groupId: 500 });
const lusDe = new Map([[500, [tcg(11, 'Chi-Yu - 057 (Prerelease)', '057'), tcg(12, 'Chi-Yu - 057 (Prerelease) [Staff]', '057'), tcg(13, 'Chi-Yu - 057', '057')]]]);
const groupesDeExp = new Map([[10, [500]]]);
const etiq = (idProduct, classe, ocr) => ({ idProduct, classe, ocr });
const baseStaff = () => ({ etiquettes: [etiq(2, 'staff', ['Stai', 'ff', 'ersion'])], cm, groupesDeExp, lusDe, releveLe: '2026-10-17' });

// ── STAFF
let r = M.planStaff(baseStaff());
verifier('STAFF : étiquette « staff » + UN produit du marché marqué Staff pour la même carte → STAFF', r.cibles.map(c => [c.idProduct, c.marqueurs]), [[2, [{ type: 'STAFF', params: {} }]]]);
verifier('STAFF : la preuve ne nomme aucune source (règle « aucun nom de source en public »)', /tcgplayer|tcgcsv|cardmarket|tcgdex/i.test(r.cibles[0].preuve), false);
verifier('STAFF : la preuve cite les deux lectures (étiquette et nom du second marché)', /Stai ff ersion/.test(r.cibles[0].preuve) && /\[Staff\]/.test(r.cibles[0].preuve), true);
const deuxStaff = new Map([[500, [...lusDe.get(500), tcg(14, 'Chi-Yu - 057 [Staff]', '057')]]]);
verifier('STAFF : DEUX produits du marché marqués Staff pour la carte → refus (ambigu)', raisons(M.planStaff({ ...baseStaff(), lusDe: deuxStaff })), ['plusieurs-produits-marche-marques']);
const sansStaff = new Map([[500, [tcg(11, 'Chi-Yu - 057 (Prerelease)', '057')]]]);
verifier('STAFF : aucun produit du marché marqué Staff → refus (une seule source)', raisons(M.planStaff({ ...baseStaff(), lusDe: sansStaff })), ['aucun-produit-marche-marque']);
verifier('STAFF : les DEUX produits Cardmarket de la carte portent l\'étiquette → refus (elle ne départage pas)', raisons(M.planStaff({ ...baseStaff(), etiquettes: [etiq(1, 'staff', ['Staff Version']), etiq(2, 'staff', ['Staff Version'])] })), ['plusieurs-produits-cm-etiquetes', 'plusieurs-produits-cm-etiquetes']);
verifier('STAFF : expansion qu\'aucun groupe du marché n\'apparie → refus', raisons(M.planStaff({ ...baseStaff(), etiquettes: [etiq(3, 'staff', ['Staff Version'])] })), ['expansion-non-appariee']);
verifier('STAFF : une étiquette « autre » sans le mot Staff n\'est pas lue comme Staff', M.planStaff({ ...baseStaff(), etiquettes: [etiq(2, 'autre:Holo Version', ['Holo Version'])] }).cibles.length, 0);
verifier('STAFF : une étiquette « autre » qui porte le MOT Staff (« Staff Stamped ») est lue', M.planStaff({ ...baseStaff(), etiquettes: [etiq(2, 'autre:Staff Stamped', ['Staff', 'Stamped'])] }).cibles.length, 1);
verifier('STAFF : un produit absent du catalogue lu → refus', raisons(M.planStaff({ ...baseStaff(), etiquettes: [etiq(77, 'staff', ['Staff Version'])] })), ['produit-inconnu']);

// ── WCD (année, joueur)
const cmW = { produits: new Map([[20, cmP(20, 'Flutter Mane', null, 'Flutter-Mane-WCD24TEF-078', 30, 'WCD-2024')], [21, cmP(21, 'Earthen Vessel', null, 'Earthen-Vessel-V1-WCD24PAR-163', 30, 'WCD-2024')], [22, cmP(22, 'Earthen Vessel', null, 'Earthen-Vessel-V2-WCD24PAR-163', 30, 'WCD-2024')]]) };
const w = (productId, name, number) => JT.lireWcdTcg({ productId, name, number, groupId: JT.GROUPE_WCD });
const tcgWcd = [w(31, 'Flutter Mane - 2024 (Sakuya O.)', '078/162'), w(32, 'Earthen Vessel - 2024 (Sakuya O.)', '163/182'), w(33, 'Earthen Vessel - 2024 (Fernando Cifuentes)', '163/182')];
const baseW = () => ({ etiquettes: [etiq(20, 'wcd', ['wcD2024Sakuya0ta', 'Not Tournament Legal'])], cm: cmW, tcgWcd, releveLe: '2026-10-17' });
r = M.planWcd(baseW());
verifier('WCD : étiquette « WCD 2024 Sakuya Ota · Not Tournament Legal » + deck du marché (2024, n° 078, nom) du joueur lu → WCD{2024, joueur} + NON_LEGAL', r.cibles.map(c => c.marqueurs), [[{ type: 'WCD', params: { annee: 2024, joueur: 'Sakuya O.' } }, { type: 'NON_LEGAL', params: {} }]]);
verifier('WCD : sans « Not Tournament Legal » lu, pas de NON_LEGAL', M.planWcd({ ...baseW(), etiquettes: [etiq(20, 'wcd', ['WcD2024SakuyaOta'])] }).cibles[0].marqueurs, [{ type: 'WCD', params: { annee: 2024, joueur: 'Sakuya O.' } }]);
verifier('WCD : V1 / V2 d\'une même carte, chaque étiquette nomme SON joueur → chacune le sien', M.planWcd({ ...baseW(), etiquettes: [etiq(21, 'wcd', ['WcD2024Sakuya', '1ota']), etiq(22, 'wcd', ['WCD 2024 Fernando Cifuentes'])] }).cibles.map(c => [c.idProduct, c.marqueurs[0].params.joueur]), [[21, 'Sakuya O.'], [22, 'Fernando Cifuentes']]);
verifier('WCD : le joueur n\'est pas lu sur l\'étiquette → refus', raisons(M.planWcd({ ...baseW(), etiquettes: [etiq(21, 'wcd', ['WcD2024Sakuya', 'Not Tournament Legal'])] })), ['joueur-non-lu']);
verifier('WCD : l\'année lue sur l\'étiquette contredit le set → refus', raisons(M.planWcd({ ...baseW(), etiquettes: [etiq(20, 'wcd', ['WCD 2023 Sakuya Ota'])] })), ['annee-discordante']);
verifier('WCD : deux joueurs lus à la fois → refus', raisons(M.planWcd({ ...baseW(), etiquettes: [etiq(21, 'wcd', ['WCD 2024 Sakuya Ota Fernando Cifuentes'])] })), ['plusieurs-joueurs-lus']);
verifier('WCD : la carte n\'a aucun deck chez le second marché → refus', raisons(M.planWcd({ ...baseW(), tcgWcd: [] })), ['carte-absente-du-marche']);
verifier('WCD : un produit hors set WCD-<aaaa> n\'est pas un WCD', M.planWcd({ ...baseW(), cm: { produits: new Map([[20, cmP(20, 'Flutter Mane', null, 'Flutter-Mane-WCD24TEF-078', 30, 'Temporal-Forces')]]) } }).cibles.length, 0);
const long = [w(31, 'Flutter Mane - 2024 (Abcdefghijklmnopqrstuvwxyz Long)', '078/162')];
verifier('WCD : un joueur hors forme du contrat (plus de 24 caractères) → refus', raisons(M.planWcd({ ...baseW(), tcgWcd: long, etiquettes: [etiq(20, 'wcd', ['WCD 2024 Abcdefghijklmnopqrstuvwxyz Long'])] })), ['joueur-hors-forme']);
verifier('WCD : un joueur trop court (moins de 5 lettres) ne se lit pas par inclusion → refus', raisons(M.planWcd({ ...baseW(), tcgWcd: [w(31, 'Flutter Mane - 2024 (Al B.)', '078/162')], etiquettes: [etiq(20, 'wcd', ['WCD 2024 Alb Smith'])] })), ['joueur-non-lu']);

// ── Yellow A : LEAGUE (+ PLACE)
const tous = [JT.lireTcg({ productId: 41, name: 'Max Potion - 128a/145 (Pokemon League)', number: '128a/145' }), ...[1, 2, 3, 4].map(n => JT.lireTcg({ productId: 50 + n, name: `Acerola - 112a/147 (League Challenge) [${['1st', '2nd', '3rd', '4th'][n - 1]} Place]`, number: '112a/147' })),
    JT.lireTcg({ productId: 61, name: 'Lillie - 125a/156 (Regional Championships)', number: '125a/156' }), JT.lireTcg({ productId: 62, name: 'Cherish Ball - 191a/236 (League Cup)', number: '191a/236' }),
    JT.lireTcg({ productId: 63, name: 'Pokemon Communication - 152a/152 (Oceania Championships) [Staff]', number: '152a/181' }), JT.lireTcg({ productId: 64, name: 'Volkner - 135a/156 (League Challenge) [1st Place]', number: '135a/156' })];
const ya = (idProduct, carte, numero, tamponProduit) => ({ idProduct, carte, numero, tamponProduit });
// relecture du 27/10 : la carte du second marché (groupe fermé des cartes tamponnées) doit porter le TOTAL d'une impression de NOTRE fiche au même numéro (le set), jamais le seul nom + numéro
const fiche = (numero, total) => ({ nomEn: 'x', impressions: [{ numero, total }] });
const cmYA = { produits: new Map([[100, { fiche: fiche('128', 145) }], [101, { fiche: fiche('112', 147) }], [102, { fiche: fiche('125', 156) }], [103, { fiche: fiche('191', 236) }], [104, { fiche: fiche('152', 181) }], [105, { fiche: fiche('135', 156) }], [106, { fiche: fiche('206', 236) }], [107, { fiche: fiche('128', 999) }], [108, { fiche: fiche('128', null) }]]) };
const baseYA = () => ({ produits: [ya(100, 'Max Potion', '128a', 'pokemon-league'), ya(101, 'Acerola', '112a', 'league-challenge-2'), ya(102, 'Lillie', '125a', 'championship-regional'), ya(103, 'Cherish Ball', '191a', 'league-cup'), ya(104, 'Pokemon Communication', '152a', 'championship-latam'), ya(105, 'Volkner', '135a', 'league-challenge-3'), ya(106, 'Reset Stamp', '206a', null)],
    cm: cmYA, lusYellowA: tous, luLe: '2026-10-27' });
r = M.planYellowA(baseYA());
verifier('Yellow A : « Pokémon League » lu + « (Pokemon League) » au second marché → [LEAGUE] ; League Challenge 2e + « [2nd Place] » → [LEAGUE, PLACE{2}]', r.cibles.map(c => [c.idProduct, c.marqueurs]), [[100, [{ type: 'LEAGUE', params: {} }]], [101, [{ type: 'LEAGUE', params: {} }, { type: 'PLACE', params: { rang: 2 } }]]]);
verifier('Yellow A : Regional et League Cup attendent le contrat v2 ; Latin America contredit (« Oceania ») ; 3e place absente du second marché ; sans tampon : hors périmètre', r.refus.map(x => [x.idProduct, x.raison]), [[102, 'type-en-attente-du-contrat'], [103, 'type-en-attente-du-contrat'], [104, 'tampon-discordant'], [105, 'place-absente-du-marche']]);

verifier('Yellow A : même nom, même numéro, mais le TOTAL du second marché (145) n\'est pas celui de notre fiche (999 : un autre set) → refus (relecture)', raisons(M.planYellowA({ ...baseYA(), produits: [ya(107, 'Max Potion', '128a', 'pokemon-league')] })), ['total-discordant']);
verifier('Yellow A : notre fiche ne porte aucun total à ce numéro → refus', raisons(M.planYellowA({ ...baseYA(), produits: [ya(108, 'Max Potion', '128a', 'pokemon-league')] })), ['fiche-sans-total']);
const avecStaff = [JT.lireTcg({ productId: 81, name: 'Max Potion - 128a/145 (Pokemon League) [Staff]', number: '128a/145' })];
verifier('Yellow A : seul un produit « [Staff] » porte le tampon au second marché → refus (la vignette ne montre pas Staff)', raisons(M.planYellowA({ ...baseYA(), produits: [ya(100, 'Max Potion', '128a', 'pokemon-league')], lusYellowA: avecStaff })), ['tampon-discordant']);
const deuxPL = [...tous, JT.lireTcg({ productId: 82, name: 'Max Potion - 128a/145 (Pokemon League)', number: '128a/145' })];
verifier('Yellow A : deux produits du second marché concordent → refus (ambigu)', raisons(M.planYellowA({ ...baseYA(), produits: [ya(100, 'Max Potion', '128a', 'pokemon-league')], lusYellowA: deuxPL })), ['plusieurs-produits-marche']);

// ── LE PLAN D'ÉCRITURE (une ligne, champ absent, jamais écrasé ; un produit dans deux familles est refusé)
const cible = (idProduct, marqueurs, famille = 'STAFF') => ({ idProduct, marqueurs, preuve: 'p', famille });
const lignes = [{ _id: 'a|2', idProduct: 2 }, { _id: 'b|20', idProduct: 20, marqueurs: [{ type: 'WCD', params: { annee: 2024, joueur: 'Sakuya O.' } }, { type: 'NON_LEGAL', params: {} }] }, { _id: 'c|21', idProduct: 21, marqueurs: [{ type: 'JUMBO', params: {} }] }, { _id: 'd|22', idProduct: 22 }, { _id: 'e|22', idProduct: 22 }, { _id: 'f|23', idProduct: 23, variante: 'x' }];
const p = M.planifierEcriture({ cibles: [cible(2, [{ type: 'STAFF', params: {} }]), cible(20, [{ type: 'WCD', params: { annee: 2024, joueur: 'Sakuya O.' } }, { type: 'NON_LEGAL', params: {} }], 'WCD'), cible(21, [{ type: 'WCD', params: { annee: 2024 } }], 'WCD'), cible(22, [{ type: 'STAFF', params: {} }]), cible(24, [{ type: 'STAFF', params: {} }]), cible(25, [{ type: 'STAFF', params: {} }]), cible(25, [{ type: 'LEAGUE', params: {} }], 'YELLOW_A')], lignes, exportIds: new Set([2, 20, 21, 22, 25]) });
verifier('écriture : une ligne sans marqueurs → écrite', p.ecrire.map(c => [c._id, c.marqueursPreuve]), [['a|2', 'p']]);
verifier('écriture : déjà posé à l\'identique → « déjà »', p.deja.map(c => c._id), ['b|20']);
verifier('écriture : refus nommés (déjà présent et différent, deux lignes, absent de l\'export, deux familles)', p.refus.map(x => [x.idProduct, x.raison.split(' ')[0]]), [[21, 'marqueurs'], [22, '2'], [24, 'absent'], [25, 'deux']]);

const lg = [{ _id: 'g|30', idProduct: 30 }, { _id: 'g|31', idProduct: 31 }, { _id: 'g|32', idProduct: 32 }, { _id: 'g|33', idProduct: 33 }];
const p2 = M.planifierEcriture({ cibles: [cible(30, [{ type: 'WCD', params: { annee: 1990 } }], 'WCD'), cible(31, [{ type: 'STAFF', params: {} }, { type: 'STAFF', params: {} }]), cible(32, ['JUMBO', 'WCD', 'NON_LEGAL', 'STAFF', 'LEAGUE'].map(type => ({ type, params: type === 'WCD' ? { annee: 2020 } : {} }))), cible(33, [{ type: 'PLACE', params: { rang: 2 } }, { type: 'LEAGUE', params: {} }], 'YELLOW_A')], lignes: lg, exportIds: new Set([30, 31, 32, 33]) });
verifier('écriture (relecture) : invalide au contrat, type en double, plus de 4 éléments → refus ; l\'ordre du contrat est appliqué à l\'écriture', [p2.refus.map(x => [x.idProduct, x.raison.split(' ')[0]]), p2.ecrire.map(c => [c.idProduct, c.marqueurs.map(m => m.type)])], [[[30, 'marqueurs'], [31, 'marqueurs'], [32, 'marqueurs']], [[33, ['LEAGUE', 'PLACE']]]]);

// ── LA FORME DU CONTRAT : ordre de la table, paramètres
verifier('ordre du contrat : WCD avant NON_LEGAL, LEAGUE avant PLACE (tri appliqué)', M.ordonner([{ type: 'PLACE', params: { rang: 1 } }, { type: 'LEAGUE', params: {} }, { type: 'NON_LEGAL', params: {} }, { type: 'WCD', params: { annee: 2020 } }]).map(m => m.type), ['WCD', 'NON_LEGAL', 'LEAGUE', 'PLACE']);
verifier('contrat : année hors 1996-2099, rang 5, joueur à chiffres, type inconnu → invalides', [M.valide({ type: 'WCD', params: { annee: 1995 } }), M.valide({ type: 'PLACE', params: { rang: 5 } }), M.valide({ type: 'WCD', params: { annee: 2004, joueur: 'R2D2' } }), M.valide({ type: 'LEAGUE_CUP', params: {} }), M.valide({ type: 'STAFF', params: { x: 1 } }), M.valide({ type: 'WCD', params: { annee: 2004, joueur: "Jean-Marc O'Neil Jr." } })], [false, false, false, false, false, true]);

// ── LA LIGNE DE COMMANDE (poser-marqueurs-etiquettes.js) sur une fausse base en mémoire
const CLI = require('./poser-marqueurs-etiquettes');
const fausseBase = docs => { const d = docs.map(x => JSON.parse(JSON.stringify(x))); return { docs: d, collection: () => ({
    find: q => ({ toArray: async () => d.filter(x => (q?._id?.$in ? q._id.$in.includes(x._id) : q?.idProduct?.$in ? q.idProduct.$in.includes(x.idProduct) : true)) }),
    updateOne: async (f, u) => { const x = d.find(y => y._id === f._id && (f.marqueurs?.$exists === false ? !('marqueurs' in y) : true)); if (!x) return { modifiedCount: 0 }; Object.assign(x, u.$set); return { modifiedCount: 1 }; }
}) }; };
(async () => {
    const silence = () => {};
    // produit 2 (STAFF prouvé, une ligne) + produit 20 (WCD prouvé, AUCUNE ligne : refus d'écriture)
    const donnees = { ...baseStaff(), etiquettes: [etiq(2, 'staff', ['Staff Version']), etiq(20, 'wcd', ['WCD 2024 Sakuya Ota', 'Not Tournament Legal'])], cm: { produits: new Map([...cm.produits, ...cmW.produits]) }, tcgWcd, yellowA: [], tcgTous: [], luLe: '2026-10-27', exportIds: new Set([2, 20]) };
    const db = fausseBase([{ _id: 'a|2', idProduct: 2, slugSet: 'SV-Black-Star-Promos' }]);
    let ouvert = 0;
    const o = async () => { ouvert++; return { cartes: { db }, fermer: async () => {} }; };
    const run = (argv, garde = () => {}) => CLI.executer({ argv, ouvrirLecture: o, ouvrirEcriture: o, garde, donnees, log: silence, err: silence });
    verifier('CLI : --ecrire hors lot → levé avant toute connexion', await run(['--ecrire', '--attendu=1'], () => { throw new Error('hors lot'); }).catch(() => 'leve'), 'leve');
    verifier('CLI : --ecrire sans --attendu → 1 ; argument inconnu → 2 ; ni --simuler ni --ecrire → 2 ; aucune connexion', [await run(['--ecrire']), await run(['--simuler', '--x']), await run([]), ouvert], [1, 2, 2, 0]);
    verifier('CLI : simulation → 0, rien écrit', [await run(['--simuler']), db.docs[0].marqueurs], [0, undefined]);
    verifier('CLI : --attendu faux → 1, rien écrit', [await run(['--ecrire', '--attendu=2', '--refus=1']), db.docs[0].marqueurs], [1, undefined]);
    verifier('CLI : refus d\'écriture non annoncé, ou annoncé faux → 1, rien écrit', [await run(['--ecrire', '--attendu=1']), await run(['--ecrire', '--attendu=1', '--refus=0']), db.docs[0].marqueurs], [1, 1, undefined]);
    verifier('CLI : --attendu et --refus justes → 0, STAFF posé avec sa preuve, aucun autre champ touché', [await run(['--ecrire', '--attendu=1', '--refus=1']), db.docs[0].marqueurs, typeof db.docs[0].marqueursPreuve, db.docs[0].slugSet], [0, [{ type: 'STAFF', params: {} }], 'string', 'SV-Black-Star-Promos']);
    verifier('CLI : rejoué → « déjà », plus rien à écrire (attendu 0)', await run(['--ecrire', '--attendu=0', '--refus=1']), 0);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
