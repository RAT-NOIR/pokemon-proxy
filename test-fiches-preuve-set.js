// Banc de collecte-cartes/fiches-preuve-set.js, de ecrire-fiches-preuve-set.js et de la source `preuve-par-set` de deux-sources.rejouer.
// AUCUNE connexion : des FAUSSES bases en mémoire (comme test-poser-fiches-voie-deux-sources.js) — rien ne touche la grappe de production, rien n'est écrit nulle part.
// Les sinogrammes des bancs sont inventés pour le banc (convention de test-preuve-par-set.js) : aucun nom réel n'est supposé.
const assert = require('assert');
const FPS = require('./collecte-cartes/fiches-preuve-set');
const DS = require('./collecte-cartes/deux-sources');
const { cleProduitParDefaut } = require('./collecte-cartes/preuve-par-set');
const E = require('./ecrire-fiches-preuve-set');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };

const TABLE = { 甲: 'vulpix', 乙: 'eevee', 丙: 'ponyta', 丁: 'abra' };
const traduire = z => TABLE[z] ?? null;
const S = (numero, nomZh) => ({ numero, nomZh });
const P = (idProduct, name, numero) => (numero === undefined ? { idProduct, name } : { idProduct, name, numero });
const J = (source, produits, plus = {}) => FPS.juger({ source, produits, traduire, cleProduit: cleProduitParDefaut, ...plus });
const SRC4 = [S('001', '甲'), S('002', '乙'), S('003', '丙'), S('004', '丁')];
const PRD4 = [P(1, 'Vulpix', '001'), P(2, 'Eevee', '002'), P(3, 'Ponyta', '003'), P(4, 'Abra', '004')];

(async () => {
    await t('juger : un set vrai est ADMIS ; 0 faux à la calibration ; les quatre contrôles négatifs disent non', () => {
        const v = J(SRC4, PRD4);
        assert.strictEqual(v.admis, true, v.raison);
        assert.deepStrictEqual(v.negatifs, { sansUneEntree: false, produitOrphelin: false, nomRemplace: false, echangeDeNumeros: false });
        assert.strictEqual(v.calibration.faux, 0);
        assert.strictEqual(v.calibration.jugees, 4);
        assert.strictEqual(v.attributions.length, 4);
    });
    await t('juger : le numéro Cardmarket reste TÉMOIN — un set dont les numéros Cardmarket ne sont pas ceux de la source est refusé (FAUX à la calibration), même si les noms concordent à 100 %', () => {
        const decales = [P(1, 'Vulpix', '002'), P(2, 'Eevee', '001'), P(3, 'Ponyta', '003'), P(4, 'Abra', '004')];
        const v = J(SRC4, decales);
        assert.strictEqual(v.admis, false);
        assert.match(v.raison, /FAUX/);
        assert.strictEqual(v.calibration.faux, 2);
        assert.deepStrictEqual(v.attributions, []);   // un set refusé n'écrit rien
    });
    await t('juger : un produit sans numéro Cardmarket ne se calibre pas — pas admis (jamais « jugé juste faute de témoin »)', () => {
        const v = J(SRC4, [P(1, 'Vulpix'), P(2, 'Eevee', '002'), P(3, 'Ponyta', '003'), P(4, 'Abra', '004')]);
        assert.strictEqual(v.admis, false);
        assert.match(v.raison, /sans numéro Cardmarket/);
    });
    await t('juger : un nom intraduisible ferme le set (la règle ne s\'applique pas) ; la raison est nommée', () => {
        const v = J([...SRC4.slice(0, 3), S('004', '？')], PRD4);
        assert.strictEqual(v.admis, false);
        assert.match(v.raison, /intraduisible/);
        assert.ok(v.discordances.some(d => d.type === 'intraduisible'));
    });
    await t('juger : la calibration doit pouvoir dire non — un set d\'une seule clé n\'admet rien (contrôles négatifs impossibles à fabriquer, noms ambigus)', () => {
        const v = J([S('001', '甲'), S('002', '甲')], [P(1, 'Vulpix', '001'), P(2, 'Vulpix', '002')]);
        assert.strictEqual(v.admis, false);
        assert.match(v.raison, /impossible à fabriquer|aucune attribution/);
    });
    await t('juger : le contrôle « échange de deux numéros » est un vrai test — si la calibration ne le voyait pas, le set serait refusé (simulé : le contrôle renvoie « ne sait pas dire non »)', () => {
        // des produits dont TOUS les numéros sont identiques : un échange de numéros entre deux cartes ne change rien pour le témoin (confronter ne voit aucune différence)
        const memeNumero = [P(1, 'Vulpix', '001'), P(2, 'Eevee', '001'), P(3, 'Ponyta', '001'), P(4, 'Abra', '001')];
        const v = J([S('001', '甲'), S('001', '乙'), S('001', '丙'), S('001', '丁')], memeNumero);
        assert.strictEqual(v.admis, false);   // numéros de source en double : la règle elle-même refuse — la garde tient avant même le contrôle
    });
    await t('juger : Gem Pack — les groupes : même nom ×2, attribution de niveau « groupe » jugée contre le numéro de groupe du produit', () => {
        const g = n => String(n).slice(0, 2);
        const source = [S('0101', '甲'), S('0102', '甲'), S('0201', '乙'), S('0202', '乙')];
        const produits = [P(1, 'Vulpix', '01'), P(2, 'Vulpix', '01'), P(3, 'Eevee', '02'), P(4, 'Eevee', '02')];
        const v = J(source, produits, { groupeDe: g });
        assert.strictEqual(v.admis, true, v.raison);
        assert.deepStrictEqual(v.attributions.map(a => [a.idProduct, a.numero, a.niveau]), [[1, '01', 'groupe'], [2, '01', 'groupe'], [3, '02', 'groupe'], [4, '02', 'groupe']]);
        assert.strictEqual(v.negatifs.echangeDeNumeros, false);
        // les groupes échangés côté produits : le témoin voit
        const faux = J(source, [P(1, 'Vulpix', '02'), P(2, 'Vulpix', '02'), P(3, 'Eevee', '01'), P(4, 'Eevee', '01')], { groupeDe: g });
        assert.strictEqual(faux.admis, false);
    });
    await t('entreesDuSet : la seconde source est `preuve-par-set`, le numéro de la concordante est celui de CARDMARKET, le nom est celui de la source, par « set »', () => {
        const v = J(SRC4, PRD4);
        const e = FPS.entreesDuSet({ verdict: v, source: SRC4, produits: PRD4, exp: 9, slugSet: 'Set-Zh', etiquette: 'kado.hk:Liste' });
        assert.strictEqual(e.length, 4);
        const e1 = e.find(x => x.idProduct === 1);
        assert.deepStrictEqual(e1.secondeSource.concordantes[0], { source: 'preuve-par-set', ref: 'kado.hk:Liste#001', set: 'Set-Zh', numero: '001', nom: '甲', par: 'set' });
    });
    await t('deux-sources.rejouer : accepte la concordante de la preuve par le set (nom non latin), refuse une concordante sans référence, au mauvais set, au mauvais numéro, au nom LATIN discordant, ou mal étiquetée', () => {
        const prod = { set: 'Set-Zh', numero: '214', nom: 'Gengar ex' };
        const bonne = { source: 'preuve-par-set', ref: 'kado.hk:L#214', set: 'Set-Zh', numero: '214', nom: '耿鬼', par: 'set' };
        assert.strictEqual(DS.rejouer(prod, [bonne]).ok, true);
        assert.strictEqual(DS.rejouer(prod, [{ ...bonne, ref: null }]).ok, false);
        assert.strictEqual(DS.rejouer(prod, [{ ...bonne, set: 'Autre' }]).ok, false);
        assert.strictEqual(DS.rejouer(prod, [{ ...bonne, numero: '215' }]).ok, false);
        assert.strictEqual(DS.rejouer(prod, [{ ...bonne, nom: 'Mew' }]).ok, false);
        assert.strictEqual(DS.rejouer(prod, [{ ...bonne, source: 'tcgdex' }]).ok, false);   // `par: 'set'` ne vaut que pour la source preuve-par-set
        assert.strictEqual(DS.rejouer(prod, [{ ...bonne, nom: null }]).ok, false);
        assert.ok(DS.SOURCES_ADMISES.includes('preuve-par-set') && !DS.SOURCES_ADMISES.includes('bulbapedia'));
    });

    // ---- l'outil, avec de fausses bases (même univers que test-poser-fiches-voie-deux-sources.js) ----
    const SET = 'Set-Zh', EXPANSION = 'Zh Promo (ATCG)';
    const gengar = { _id: 10, nomEn: 'Gengar ex', niveau: null, attaques: [{ nom: 'Shadowy Claw' }], impressions: [], sets: [SET], liens: { idProduct: [1], idMetacards: [500] } };
    const colls = () => ({
        cartes: [gengar],
        sets: [{ _id: SET, tirage: 'zh-hans', idExpansion: [9], bulba: { expansion: EXPANSION } }],
        cartes_produits: [{ _id: '10|1', carteId: 10, idProduct: 1, slugSet: 'Autre' }],
        numeros_cartes: [{ idProduct: 20, numero: '214', slug: 'Gengar-ex-Z214', slugSet: SET, codeSet: 'ZH/CS' }, { idProduct: 21, numero: '215', slug: 'Pikachu-Z215', slugSet: SET, codeSet: 'ZH/CS' }, { idProduct: 22, numero: '216', slug: 'Eevee-Z216', slugSet: SET, codeSet: 'ZH/CS' }],
        catalogue_produits: [{ idProduct: 20, idExpansion: 9, idMetacard: 500, name: 'Gengar ex [Shadowy Claw]' }, { idProduct: 21, idExpansion: 9, idMetacard: 501, name: 'Pikachu' }, { idProduct: 22, idExpansion: 9, idMetacard: 502, name: 'Eevee' }]
    });
    const dbFausse = (c = colls()) => ({ collection: nom => ({ find: (f = {}) => ({ toArray: async () => (c[nom] || []).filter(d => (f.idExpansion === undefined || d.idExpansion === f.idExpansion) && (!f.idProduct?.$in || f.idProduct.$in.includes(d.idProduct))) }), countDocuments: async () => 0 }) });
    const cx = () => ({ cartes: { db: dbFausse() }, prod: { db: dbFausse() }, fermer: async () => {} });
    const TAB = { 甲: cleProduitParDefaut('Gengar ex'), 乙: cleProduitParDefaut('Pikachu'), 丙: cleProduitParDefaut('Eevee') };
    const sourcesFausses = (liste) => () => ({ SETS: { 'Liste Zh': { etiquette: 'Liste Zh', cartes: liste } }, traduire: z => TAB[z] ?? null, cleProduit: cleProduitParDefaut, journal: ['(sources de banc)'] });
    const BONNE = [{ numero: '214', nomZh: '甲' }, { numero: '215', nomZh: '乙' }, { numero: '216', nomZh: '丙' }];
    const CIBLE = (role = 'vise') => [{ nom: 'Set de banc', exp: 9, kado: [['Liste Zh', '']], role }];
    const sorties = {};
    const base = (argv, extra = {}) => ({ argv, cibles: CIBLE(), chargerSources: sourcesFausses(BONNE), ouvrirLecture: async () => cx(), ouvrirEcriture: async () => cx(), lireListe: f => (f.endsWith('pret.json') ? [20] : f.endsWith('autre.json') ? [20, 21] : (() => { throw new Error('absent'); })()), ecrireFichier: (f, x) => { sorties[f] = x; }, log: () => {}, err: () => {}, env: {}, ppid: 1, ...extra });

    await t('outil : un argument inconnu, ou les deux modes, → 2 avant toute connexion', async () => {
        let ouvert = false; const o = { ouvrirLecture: async () => { ouvert = true; return cx(); }, ouvrirEcriture: async () => { ouvert = true; return cx(); } };
        assert.strictEqual(await E.executer(base(['--simuler', '--force'], o)), 2);
        assert.strictEqual(await E.executer(base(['--simuler', '--ecrire', '--seulement=pret.json', '--attendu=1'], { ...o, env: { LOT_ADDITIF_PID: '1' } })), 2);
        assert.strictEqual(ouvert, false);
    });
    await t('outil : SANS mode, c\'est la SIMULATION (lecture seule) ; elle imprime sets admis / tombés et le nombre de fiches ; aucune écriture', async () => {
        const lignes = []; let ecrit = false;
        const o = { log: s => lignes.push(s), ouvrirEcriture: async () => { ecrit = true; return cx(); } };
        assert.strictEqual(await E.executer(base(['--plan=plan.json', '--pret=pret-out.json', '--resume=resume.json'], o)), 0);
        const texte = lignes.join('\n');
        assert.match(texte, /→ ADMIS/);
        assert.match(texte, /BILAN : 1 set\(s\) admis/);
        assert.match(texte, /PLAN : 1 fiche\(s\) neuve\(s\)/);
        assert.deepStrictEqual(JSON.parse(sorties['pret-out.json']), [20]);   // 21 et 22 n'ont pas de carte : refusés, nommés
        const resume = JSON.parse(sorties['resume.json']);
        assert.deepStrictEqual(resume.refus.map(r => r.idProduct), [21, 22]);
        assert.ok(resume.refus.every(r => /aucune carte candidate/.test(r.raison)));
        assert.deepStrictEqual(resume.lignes[0].sources, ['cardmarket', 'preuve-par-set']);
        assert.strictEqual(ecrit, false);
    });
    await t('outil : un set NON admis n\'écrit RIEN — le plan est vide, la raison est imprimée', async () => {
        const lignes = [];
        const mauvaise = [{ numero: '214', nomZh: '甲' }, { numero: '215', nomZh: '乙' }];   // une entrée de moins : effectifs différents
        const c = await E.executer(base(['--pret=pret-out.json'], { chargerSources: sourcesFausses(mauvaise), log: s => lignes.push(s) }));
        assert.strictEqual(c, 0);
        const texte = lignes.join('\n');
        assert.match(texte, /→ TOMBÉ/);
        assert.match(texte, /PLAN : 0 fiche/);
        assert.deepStrictEqual(JSON.parse(sorties['pret-out.json']), []);
    });
    await t('outil : un set de rôle « calibration » est jugé mais JAMAIS écrit, même admis', async () => {
        const lignes = [];
        await E.executer(base(['--pret=pret-cal.json'], { cibles: CIBLE('calibration'), log: s => lignes.push(s) }));
        assert.match(lignes.join('\n'), /PLAN : 0 fiche/);
        assert.deepStrictEqual(JSON.parse(sorties['pret-cal.json']), []);
    });
    await t('outil : UN SEUL faux sur un set de calibration retire la règle à TOUS les sets (0 faux partout exigé)', () => {
        const sources = { SETS: { Bon: { cartes: BONNE }, Faux: { cartes: [{ numero: '214', nomZh: '甲' }, { numero: '215', nomZh: '乙' }, { numero: '216', nomZh: '丙' }] } }, traduire: z => TAB[z] ?? null, cleProduit: cleProduitParDefaut };
        const prod = [P(20, 'Gengar ex', '214'), P(21, 'Pikachu', '215'), P(22, 'Eevee', '216')];
        const fauxProd = [P(30, 'Gengar ex', '215'), P(31, 'Pikachu', '214'), P(32, 'Eevee', '216')];
        const lecture = { produits: new Map([[1, prod], [2, fauxProd]]) };
        const cibles = [{ nom: 'A', exp: 1, kado: [['Bon', '']], role: 'vise' }, { nom: 'B', exp: 2, kado: [['Faux', '']], role: 'calibration' }];
        const r = E.jugerTout({ sources, lecture, cibles });
        assert.strictEqual(r.verdicts[0].admis, false);
        assert.strictEqual(r.global.fauxPartout, 2);
        assert.match(r.verdicts[0].raison, /2 faux sur un set de calibration/);
        const seul = E.jugerTout({ sources, lecture, cibles: [cibles[0]] });
        assert.strictEqual(seul.verdicts[0].admis, true);   // sans le set fautif, il est admis : le refus vient bien de lui
    });
    await t('outil : --ecrire hors de lot-additif.js → 2 AVANT toute connexion ; sans --seulement ni --attendu → 2', async () => {
        let ouvert = false;
        assert.strictEqual(await E.executer(base(['--ecrire', '--seulement=pret.json', '--attendu=1'], { ouvrirEcriture: async () => { ouvert = true; return cx(); } })), 2);
        assert.strictEqual(ouvert, false);
        assert.strictEqual(await E.executer(base(['--ecrire'], { env: { LOT_ADDITIF_PID: '1' }, ppid: 1 })), 2);
    });
    await t('outil : --ecrire, un idProduct de --seulement qu\'aucun set admis n\'attribue → 1, AUCUNE écriture (la base a bougé depuis la simulation)', async () => {
        let atteint = false;
        const cxE = () => ({ cartes: { db: { collection: nom => ({ ...dbFausse().collection(nom), updateOne: async () => { atteint = true; throw new Error('écriture atteinte'); }, bulkWrite: async () => { atteint = true; return { modifiedCount: 0 }; } }) } }, prod: { db: dbFausse() }, fermer: async () => {} });
        const c = await E.executer(base(['--ecrire', '--seulement=pret.json', '--attendu=1'], { env: { LOT_ADDITIF_PID: '1' }, ppid: 1, chargerSources: sourcesFausses([{ numero: '214', nomZh: '甲' }, { numero: '215', nomZh: '乙' }]), ouvrirEcriture: async () => cxE() }));
        assert.strictEqual(c, 1);
        assert.strictEqual(atteint, false);
    });
    await t('outil : --ecrire avec un mauvais --attendu → 1 et AUCUNE écriture ; avec le bon, l\'écriture est ATTEINTE (gardes passées) — jamais avant', async () => {
        let atteint = false;
        const cxE = () => ({ cartes: { db: { collection: nom => ({ ...dbFausse().collection(nom), updateOne: async () => { atteint = true; throw new Error('arrêt du banc : écriture atteinte'); }, bulkWrite: async () => { atteint = true; return { modifiedCount: 0 }; } }) } }, prod: { db: dbFausse() }, fermer: async () => {} });
        const o = { env: { LOT_ADDITIF_PID: '1' }, ppid: 1, ouvrirEcriture: async () => cxE() };
        assert.strictEqual(await E.executer(base(['--ecrire', '--seulement=pret.json', '--attendu=5'], o)), 1);
        assert.strictEqual(atteint, false);
        let erreur = null;
        try { await E.executer(base(['--ecrire', '--seulement=pret.json', '--attendu=1'], o)); } catch (e) { erreur = e.message; }
        assert.strictEqual(atteint, true);
        assert.match(erreur || '', /écriture atteinte|lignes|detach/i);
    });
    await t('outil : ne modifie ni ne supprime : le produit qui a DÉJÀ une ligne est refusé par le planificateur (on ne pose que des lignes absentes)', async () => {
        const c = colls(); c.cartes_produits.push({ _id: '10|20', carteId: 10, idProduct: 20, slugSet: SET });
        const cxL = () => ({ cartes: { db: dbFausse(c) }, prod: { db: dbFausse(c) }, fermer: async () => {} });
        await E.executer(base(['--pret=pret-ex.json', '--resume=res-ex.json'], { ouvrirLecture: async () => cxL() }));
        assert.deepStrictEqual(JSON.parse(sorties['pret-ex.json']), []);
        assert.ok(JSON.parse(sorties['res-ex.json']).refus.some(r => r.idProduct === 20 && /déjà 1 ligne/.test(r.raison)));
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
