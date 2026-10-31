// Banc de collecte-cartes/sources-gempack.js : lecteurs des pages de listes (deux sources) sur des EXTRAITS RÉELS en cache (fixtures-gempack/), croisement à trois sources, variantes.
// AUCUN réseau, AUCUNE base. Les cas de refus sont fabriqués (désaccord, orphelin, variantes indiscernables).
const assert = require('assert');
const fs = require('fs'), path = require('path');
const G = require('./collecte-cartes/sources-gempack');
const FIX = path.join(__dirname, 'fixtures-gempack');
const lire = f => fs.readFileSync(path.join(FIX, f), 'utf8');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };

(async () => {
    // ---------- classes ----------
    await t('classeFinition : les sept finitions de Gem Pack, et un inconnu reste null', () => {
        const c = G.classeFinition;
        assert.strictEqual(c('Fire'), 'energie'); assert.strictEqual(c('Colorless'), 'energie'); assert.strictEqual(c('Poké Ball'), 'pokeball');
        assert.strictEqual(c('Star'), 'brillant1'); assert.strictEqual(c('shattered glass'), 'brillant1'); assert.strictEqual(c('Rotary'), 'brillant2'); assert.strictEqual(c('windmill'), 'brillant2');
        assert.strictEqual(c('Master Ball'), 'masterball'); assert.strictEqual(c('Gem Pack stamped'), 'tampon'); assert.strictEqual(c('3-star illustration rare'), 'ir');
        assert.strictEqual(c('quelque chose'), null);
    });
    await t('classeRarete : le vocabulaire des trois sources se ramène à cinq classes', () => {
        const c = G.classeRarete;
        assert.strictEqual(c('common'), 'C'); assert.strictEqual(c('Common'), 'C'); assert.strictEqual(c('uncommon'), 'U'); assert.strictEqual(c('Uncommon'), 'U'); assert.strictEqual(c('rare'), 'R'); assert.strictEqual(c('Rare'), 'R');
        assert.strictEqual(c('double rare'), 'DR'); assert.strictEqual(c('double-rare'), 'DR'); assert.strictEqual(c('Double Rare'), 'DR');
        assert.strictEqual(c('triple rare'), 'TR'); assert.strictEqual(c('Triple Rare'), 'TR'); assert.strictEqual(c('art-rare'), 'TR'); assert.strictEqual(c('exclusive-art-rare'), 'TR');
        assert.strictEqual(c('double'), null);   // le texte tronqué d'une image réelle (« 176 double ») ne se devine pas
        assert.strictEqual(c('mythique'), null);
    });
    await t('rareteDeLaClasse : la finition de la source fixe la rareté attendue (rang 1-2 C, 3-4 U, 5 R, 6 DR, 7 TR)', () => {
        const r = G.rareteDeLaClasse;
        assert.deepStrictEqual(['energie', 'pokeball', 'brillant1', 'brillant2', 'masterball', 'tampon', 'ir'].map(r), ['C', 'C', 'U', 'U', 'R', 'DR', 'TR']);
    });

    // ---------- SC ----------
    await t('SC : le groupe 01 de la liste réelle — 7 cartes, rang et total lus sur la légende, nom, finition et adresse de l\'original', () => {
        const sc = G.lireSimplifiedCollector(lire('sc-vol4-extrait.html'));
        const g1 = sc.cartes.filter(c => c.groupe === '01');
        assert.strictEqual(g1.length, 7);
        assert.deepStrictEqual(g1.map(c => c.rang), [1, 2, 3, 4, 5, 6, 7]);
        assert.ok(g1.every(c => c.nom === 'Ponyta' && c.total === 7 && c.rangDeclare === true));
        assert.deepStrictEqual(g1.map(c => c.classe), ['energie', 'pokeball', 'brillant1', 'brillant2', 'masterball', 'tampon', 'ir']);
        assert.match(g1[0].urlOriginal, /^https:\/\/simplifiedcollector\.com\/wp-content\/uploads\/2026\/08\/01-01-07-1\.png$/);
        assert.match(g1[0].urlMiniature, /-107x150\.png$/);
        assert.strictEqual(g1[0].largeurAnnoncee, 868);
    });
    await t('SC : une légende à tiret (« 03 01-07 ») est lue comme « 03 01/07 »', () => {
        const sc = G.lireSimplifiedCollector(lire('sc-vol4-extrait.html'));
        const g3 = sc.cartes.filter(c => c.groupe === '03');
        assert.deepStrictEqual(g3.map(c => [c.rang, c.total, c.nom, c.classe]), [[1, 7, 'Pinsir', 'energie'], [2, 7, 'Pinsir', 'pokeball']]);
    });
    await t('SC : un groupe SANS légendes (Chatot) est lu par la POSITION, et marqué comme tel (rangDeclare = false)', () => {
        const sc = G.lireSimplifiedCollector(lire('sc-vol4-extrait.html'));
        const g10 = sc.cartes.filter(c => c.groupe === '10');
        assert.strictEqual(g10.length, 7);
        assert.deepStrictEqual(g10.map(c => c.rang), [1, 2, 3, 4, 5, 6, 7]);
        assert.ok(g10.every(c => c.nom === 'Chatot' && c.rangDeclare === false && c.total === 7));
        assert.deepStrictEqual(g10.map(c => c.classe), ['energie', 'pokeball', 'brillant1', 'brillant2', 'masterball', 'tampon', 'ir']);
    });
    await t('SC : la section « Exclusives » répète des cartes de la liste — elle n\'est PAS lue (aucun doublon de groupe/rang)', () => {
        const sc = G.lireSimplifiedCollector(lire('sc-vol4-extrait.html'));
        const cles = sc.cartes.map(c => c.groupe + '/' + c.rang);
        assert.strictEqual(new Set(cles).size, cles.length);
        const sc5 = G.lireSimplifiedCollector(lire('sc-vol5-extrait.html'));
        const cles5 = sc5.cartes.map(c => c.groupe + '/' + c.rang);
        assert.strictEqual(new Set(cles5).size, cles5.length);
        assert.ok(sc5.cartes.every(c => c.groupe === '01'));
    });
    await t('SC : une page sans section « Card List » LÈVE (« lecture vide » n\'est pas « zéro carte »)', () => {
        assert.throws(() => G.lireSimplifiedCollector('<html><h2>Autre chose</h2></html>'), /Card List/);
    });
    await t('SC : un groupe dont le nombre de cartes n\'est pas son total est une ANOMALIE nommée', () => {
        const html = lire('sc-vol4-extrait.html');
        const sc = G.lireSimplifiedCollector(html);
        // le groupe 03 de l'extrait est tronqué à 2 cartes sur 7 : anomalie (lecture incomplète), jamais « 2 cartes »
        assert.ok(sc.anomalies.some(a => a.type === 'groupe-incomplet' && a.groupe === '03'), JSON.stringify(sc.anomalies));
    });

    // ---------- PC ----------
    await t('PC : lecture de l\'ordre réel — les images qui ne sont pas des cartes sont écartées, la rareté est ramenée à sa classe', () => {
        const pc = G.lirePokeCottage(lire('pc-vol4-extrait.html'));
        assert.ok(pc.cartes.length >= 8);
        assert.deepStrictEqual(pc.cartes.slice(0, 7).map(c => c.classe), ['C', 'C', 'U', 'U', 'R', 'DR', 'TR']);
        assert.ok(pc.cartes.every(c => /^https:\/\/images\.squarespace-cdn\.com\//.test(c.src)));
        assert.deepStrictEqual(pc.cartes.slice(0, 2).map(c => c.fichier), ['1:1', '1:2']);
    });
    await t('PC : les fautes réelles du nommage sont NOMMÉES, jamais corrigées (8:8, 12:05, 183a, « double » tronqué)', () => {
        const pc = G.lirePokeCottage(lire('pc-vol4-extrait.html'));
        const types = pc.anomalies.map(a => a.type);
        assert.ok(types.includes('rang-hors-sequence'), JSON.stringify(pc.anomalies));    // 8:8_triple-rare (un groupe de l'extrait ne commence pas à 1)
        assert.ok(pc.cartes.some(c => c.fichier === '12:05'));                              // lu tel quel
        assert.ok(pc.anomalies.some(a => a.type === 'numero-suffixe'));                     // 183a
        assert.ok(pc.anomalies.some(a => a.type === 'rarete-inconnue') || pc.cartes.every(c => c.classe !== undefined));
    });
    await t('PC : le second gabarit (galerie « pc-set-card-gallery-card ») donne en plus le NOM, le groupe, le rang et le total de chaque carte', () => {
        const pc = G.lirePokeCottage(lire('pc-vol6-extrait.html'));
        assert.strictEqual(pc.cartes.length, 9);
        assert.deepStrictEqual(pc.cartes.slice(0, 7).map(c => [c.groupe, c.rang, c.total, c.nom, c.classe]), [['01', 1, 7, 'Alolan Dugtrio', 'C'], ['01', 2, 7, 'Alolan Dugtrio', 'C'], ['01', 3, 7, 'Alolan Dugtrio', 'U'], ['01', 4, 7, 'Alolan Dugtrio', 'U'], ['01', 5, 7, 'Alolan Dugtrio', 'R'], ['01', 6, 7, 'Alolan Dugtrio', 'DR'], ['01', 7, 7, 'Alolan Dugtrio', 'TR']]);
        assert.ok(pc.cartes.every(c => /^https:\/\/pokecottagecdn\.com\/mastersets\/images\/cards\//.test(c.src)));
        assert.strictEqual(pc.cartes[8].groupe, '28');
    });
    await t('PC : une page sans aucune carte LÈVE', () => {
        assert.throws(() => G.lirePokeCottage('<html></html>'), /aucune carte/);
    });

    // ---------- ppr ----------
    await t('ppr : le relevé en cache se ramène à des cartes (groupe, rang, nom, classe de finition, classe de rareté)', () => {
        const j = JSON.parse(lire('ppr-cbb4c-extrait.json'));
        const p = G.lirePpr(j);
        const g1 = p.cartes.filter(c => c.groupe === '01');
        assert.strictEqual(g1.length, 7);
        assert.deepStrictEqual(g1.map(c => c.classe), ['energie', 'pokeball', 'brillant1', 'brillant2', 'masterball', 'tampon', 'ir']);
        assert.deepStrictEqual(g1.map(c => c.rarete), ['C', 'C', 'U', 'U', 'R', 'DR', 'TR']);
    });

    // ---------- croisement ----------
    const FIN = ['energie', 'pokeball', 'brillant1', 'brillant2', 'masterball', 'tampon', 'ir'], RAR = ['C', 'C', 'U', 'U', 'R', 'DR', 'TR'];
    const faux = (noms) => {
        const sc = { cartes: [] }, ppr = { cartes: [] }, pc = { cartes: [] };
        noms.forEach((nom, i) => {
            const groupe = String(i + 1).padStart(2, '0');
            for (let r = 1; r <= 7; r++) {
                sc.cartes.push({ groupe, rang: r, total: 7, nom, classe: FIN[r - 1], rangDeclare: true });
                ppr.cartes.push({ groupe, rang: r, total: 7, nom, classe: FIN[r - 1], rarete: RAR[r - 1] });
                pc.cartes.push({ position: i * 7 + r, classe: RAR[r - 1], src: 'https://images.squarespace-cdn.com/x' });
            }
        });
        return { sc, ppr, pc };
    };
    const X = (s, plus = {}) => G.croiserSources({ sc: s.sc, pc: s.pc, ppr: s.ppr, ...plus });
    await t('croiser : trois sources qui concordent — admis, 0 discordance, couverture de chaque source imprimée', () => {
        const r = X(faux(['Ponyta', 'Lickitung', 'Pinsir']));
        assert.strictEqual(r.ok, true, JSON.stringify(r.discordances));
        assert.strictEqual(r.cartes.length, 21);
        assert.deepStrictEqual(r.couverture, { sc: 21, pc: 21, ppr: 21 });
    });
    await t('croiser : un NOM qui diffère entre SC et ppr refuse (NON)', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.ppr.cartes[3].nom = 'Pinsir';
        const r = X(s); assert.strictEqual(r.ok, false); assert.ok(r.discordances.some(d => d.type === 'nom'));
    });
    await t('croiser : une RARETÉ qui diffère entre PC et SC refuse', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.pc.cartes[4].classe = 'U';
        const r = X(s); assert.strictEqual(r.ok, false); assert.ok(r.discordances.some(d => d.type === 'rarete-pc'));
    });
    await t('croiser : une CARTE de ppr absente de SC (orphelin) refuse', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.sc.cartes = s.sc.cartes.filter(c => !(c.groupe === '02' && c.rang === 7));
        const r = X(s); assert.strictEqual(r.ok, false); assert.ok(r.discordances.some(d => d.type === 'orphelin-ppr'));
    });
    await t('croiser : un nombre de cartes de PC différent de SC refuse', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.pc.cartes.pop();
        const r = X(s); assert.strictEqual(r.ok, false); assert.ok(r.discordances.some(d => d.type === 'effectif-pc'));
    });
    await t('croiser : ppr PARTIEL (une carte illisible) n\'est pas une contradiction — mais sa couverture est imprimée', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.ppr.cartes.splice(5, 1);
        const r = X(s); assert.strictEqual(r.ok, true, JSON.stringify(r.discordances)); assert.strictEqual(r.couverture.ppr, 13);
    });
    await t('croiser : la finition de ppr doit suivre celle de SC rang par rang (bijection) — une finition échangée refuse', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.ppr.cartes[2].classe = 'ir';
        const r = X(s); assert.strictEqual(r.ok, false); assert.ok(r.discordances.some(d => d.type === 'finition'));
    });
    await t('croiser : un total attendu (produits) qui diffère refuse', () => {
        const r = X(faux(['Ponyta', 'Lickitung']), { attendu: 20 });
        assert.strictEqual(r.ok, false); assert.ok(r.discordances.some(d => d.type === 'effectif-attendu'));
    });
    await t('croiser : sans ppr (hors cache), SC et PC suffisent mais la couverture ppr est 0, dite', () => {
        const s = faux(['Ponyta', 'Lickitung']);
        const r = G.croiserSources({ sc: s.sc, pc: s.pc, ppr: null });
        assert.strictEqual(r.ok, true); assert.strictEqual(r.couverture.ppr, 0);
    });

    await t('croiser : un PC qui porte l\'identité des cartes (second gabarit) est confronté au NOM et au rang de SC — un nom différent refuse', () => {
        const s = faux(['Ponyta', 'Lickitung']);
        s.pc.cartes.forEach((c, i) => { c.groupe = String(Math.floor(i / 7) + 1).padStart(2, '0'); c.rang = (i % 7) + 1; c.nom = i < 7 ? 'Ponyta' : 'Lickitung'; });
        assert.strictEqual(X(s).ok, true);
        s.pc.cartes[9].nom = 'Pinsir';
        const r = X(s); assert.strictEqual(r.ok, false); assert.ok(r.discordances.some(d => d.type === 'nom-pc'));
        s.pc.cartes[9].nom = 'Lickitung'; s.pc.cartes[3].rang = 5;
        assert.ok(X(s).discordances.some(d => d.type === 'rang-pc'));
    });

    // ---------- réserves : un désaccord de ppr corroboré par une donnée indépendante ----------
    const PG = (noms, effectif = 7) => ({ '1': { noms: new Set(noms), effectif }, '2': { noms: new Set(['lickitung']), effectif } });
    await t('réserve : un nom de ppr dissident, corroboré par les produits Cardmarket du groupe, est une RÉSERVE écrite — pas un refus ; la carte n\'est pas comptée confirmée par ppr', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.ppr.cartes[0].nom = 'Ponita';
        const r = X(s, { produitsParGroupe: PG(['ponyta']) });
        assert.strictEqual(r.ok, true, JSON.stringify(r.discordances));
        assert.deepStrictEqual(r.reserves.map(x => x.type), ['nom-ppr-dissident']);
        assert.strictEqual(r.couverture.ppr, 13);
    });
    await t('réserve : le même nom dissident NON corroboré (les produits portent le nom de ppr, ou ni l\'un ni l\'autre) refuse', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.ppr.cartes[0].nom = 'Ponita';
        assert.strictEqual(X(s, { produitsParGroupe: PG(['ponita']) }).ok, false);
        assert.strictEqual(X(s, { produitsParGroupe: PG(['autre']) }).ok, false);
        assert.strictEqual(X(s, { produitsParGroupe: PG(['ponyta', 'ponita']) }).ok, false);   // les produits portent AUSSI le nom de ppr : rien ne tranche
        assert.strictEqual(X(s).ok, false);   // sans produits : tout désaccord bloque
    });
    await t('réserve : un nom de PC plus long (« Sunny Form Castform ») est une réserve si les produits portent le nom de SC et pas celui de PC ; sinon refus', () => {
        const s = faux(['Ponyta', 'Lickitung']);
        s.pc.cartes.forEach((c, i) => { c.groupe = String(Math.floor(i / 7) + 1).padStart(2, '0'); c.rang = (i % 7) + 1; c.nom = i < 7 ? 'Sunny Form Ponyta' : 'Lickitung'; });
        assert.strictEqual(X(s).ok, false);
        const r = X(s, { produitsParGroupe: PG(['ponyta']) });
        assert.strictEqual(r.ok, true, JSON.stringify(r.discordances)); assert.strictEqual(r.reserves.filter(x => x.type === 'nom-pc-dissident').length, 7);
        assert.strictEqual(X(s, { produitsParGroupe: PG(['sunny form ponyta']) }).ok, false);
    });
    await t('cleNom : deux noms qui se ramènent à la MÊME clé (clé d\'espèce de la production) ne sont pas un désaccord — « Captain Pikachu » et « Pikachu »', () => {
        const s = faux(['Captain Pikachu', 'Lickitung']); s.ppr.cartes.slice(0, 7).forEach(c => { c.nom = 'Pikachu'; });
        assert.strictEqual(X(s).ok, false);
        const cle = n => (/pikachu/i.test(n) ? 'D25' : n.toLowerCase());
        const r = X(s, { cleNom: cle }); assert.strictEqual(r.ok, true, JSON.stringify(r.discordances)); assert.deepStrictEqual(r.reserves, []);
        assert.strictEqual(r.couverture.ppr, 14);
    });
    await t('réserve : un total de ppr dissident n\'est une réserve que si l\'effectif des produits est celui de SC', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.ppr.cartes[0].total = 6;
        assert.strictEqual(X(s, { produitsParGroupe: PG(['ponyta'], 7) }).ok, true);
        assert.strictEqual(X(s, { produitsParGroupe: PG(['ponyta'], 6) }).ok, false);
    });
    await t('réserve : une FAUTE DE NUMÉROTATION de ppr (« 29 07/07 » pour le groupe 28) est reconnue par UN SEUL emplacement libre — sinon orphelin', () => {
        const s = faux(['Ponyta', 'Lickitung']); const dernier = s.ppr.cartes[13]; dernier.groupe = '29';
        const r = X(s, { produitsParGroupe: PG(['ponyta']) });
        assert.strictEqual(r.ok, true, JSON.stringify(r.discordances));
        assert.strictEqual(r.reserves[0].type, 'ppr-numero-fautif'); assert.strictEqual(r.reserves[0].sc, '02/7');
        assert.strictEqual(X(s).ok, false);                                           // sans produits indépendants : orphelin
        const s2 = faux(['Ponyta', 'Lickitung']); s2.ppr.cartes[13].groupe = '29'; s2.ppr.cartes[13].nom = 'Mystère';
        assert.strictEqual(X(s2, { produitsParGroupe: PG(['ponyta']) }).ok, false);     // aucun emplacement ne porte ce nom : orphelin
    });
    await t('réserve : une finition de ppr dissidente ne devient réserve que si la rareté de ppr ET celle de PC confirment SC', () => {
        const s = faux(['Ponyta', 'Lickitung']); s.ppr.cartes[2].classe = 'brillant2';     // même rareté (U) : échange entre deux finitions de la même classe
        assert.strictEqual(X(s).ok, false);
        assert.strictEqual(X(s, { produitsParGroupe: PG(['ponyta']) }).ok, true);
        const s2 = faux(['Ponyta', 'Lickitung']); s2.ppr.cartes[2].classe = 'ir'; s2.ppr.cartes[2].rarete = 'TR';
        assert.strictEqual(X(s2, { produitsParGroupe: PG(['ponyta']) }).ok, false);        // la rareté de ppr ≠ celle de SC (et de PC) : refus
        const s3 = faux(['Ponyta', 'Lickitung']); s3.ppr.cartes[3].classe = 'pokeball';   // ppr se contredit lui-même : finition « Poké Ball » sur une rareté U (celle de SC et de PC)
        assert.strictEqual(X(s3).ok, false);
        assert.deepStrictEqual(X(s3, { produitsParGroupe: PG(['ponyta']) }).reserves.map(r => r.type), ['finition-ppr-dissidente']);
        const s4 = faux(['Ponyta', 'Lickitung']); s4.ppr.cartes[3].classe = 'pokeball'; s4.pc.cartes[3].classe = 'C';   // PC ne confirme pas : refus
        assert.strictEqual(X(s4, { produitsParGroupe: PG(['ponyta']) }).ok, false);
    });

    // ---------- liste pour la preuve par le set ----------
    await t('croiser : le titre d\'un groupe diffère de la légende d\'une carte (« Eevee » / « Eevee V ») — noté en réserve, pas bloquant ; une AUTRE anomalie de SC bloque', () => {
        const s = faux(['Ponyta', 'Lickitung']);
        const r = G.croiserSources({ sc: { cartes: s.sc.cartes, anomalies: [{ type: 'nom-legende-different', groupe: '01', rang: 1 }] }, pc: s.pc, ppr: s.ppr });
        assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.reserves.map(x => x.type), ['sc-nom-legende']);
        const r2 = G.croiserSources({ sc: { cartes: s.sc.cartes, anomalies: [{ type: 'groupe-incomplet', groupe: '01' }] }, pc: s.pc, ppr: s.ppr });
        assert.strictEqual(r2.ok, false);
    });
    await t('listeDuSet : numéro = groupe+rang ("0101"), nom anglais — le format de la preuve par le set', () => {
        const r = X(faux(['Ponyta', 'Lickitung']));
        const l = G.listeDuSet(r);
        assert.deepStrictEqual(l.slice(0, 2), [{ numero: '0101', nomZh: 'Ponyta' }, { numero: '0102', nomZh: 'Ponyta' }]);
        assert.strictEqual(l.length, 14);
        assert.throws(() => G.listeDuSet({ ok: false, cartes: [] }), /croisement/);
    });

    // ---------- variantes ----------
    const PROD = []; ['Ponyta', 'Lickitung'].forEach((n, g) => { for (let v = 1; v <= 7; v++) PROD.push({ idProduct: 100 + g * 10 + v, name: n + ' [x]', numero: String(g + 1).padStart(2, '0'), variante: 'V' + v }); });
    await t('variantes : SANS témoin du côté Cardmarket, les sept variantes d\'un groupe sont INDISCERNABLES — aucune attribution', () => {
        const v = G.prouverVariantes({ croisement: X(faux(['Ponyta', 'Lickitung'])), produits: PROD });
        assert.strictEqual(v.attributions.length, 0);
        assert.strictEqual(v.indiscernables.length, 14);
        assert.ok(v.indiscernables.every(i => i.motif === 'variantes indiscernables'));
        assert.match(v.resume, /14 produits/);
    });
    await t('variantes : avec un témoin indépendant et complet, la correspondance est prouvée variante par variante', () => {
        const temoin = p => ({ V1: 1, V2: 2, V3: 3, V4: 4, V5: 5, V6: 6, V7: 7 })[p.variante];
        const v = G.prouverVariantes({ croisement: X(faux(['Ponyta', 'Lickitung'])), produits: PROD, temoinVariante: temoin });
        assert.strictEqual(v.attributions.length, 14); assert.strictEqual(v.indiscernables.length, 0);
        assert.deepStrictEqual(v.attributions.slice(0, 2).map(a => [a.idProduct, a.groupe, a.rang]), [[101, '01', 1], [102, '01', 2]]);
    });
    await t('variantes : un témoin INCOMPLET (une variante sans rang) refuse tout le groupe', () => {
        const temoin = p => (p.idProduct === 103 ? null : Number(p.variante.slice(1)));
        const v = G.prouverVariantes({ croisement: X(faux(['Ponyta', 'Lickitung'])), produits: PROD, temoinVariante: temoin });
        assert.strictEqual(v.attributions.filter(a => a.groupe === '01').length, 0);
        assert.strictEqual(v.attributions.filter(a => a.groupe === '02').length, 7);
        assert.ok(v.indiscernables.some(i => i.groupe === '01'));
    });
    await t('variantes : un témoin qui range deux variantes au même rang refuse le groupe (pas de choix au hasard)', () => {
        const temoin = p => (p.variante === 'V7' ? 6 : Number(p.variante.slice(1)));
        const v = G.prouverVariantes({ croisement: X(faux(['Ponyta', 'Lickitung'])), produits: PROD, temoinVariante: temoin });
        assert.strictEqual(v.attributions.length, 0);
    });
    await t('variantes : un nombre de produits par groupe différent de celui de la source refuse', () => {
        const v = G.prouverVariantes({ croisement: X(faux(['Ponyta', 'Lickitung'])), produits: PROD.filter(p => p.idProduct !== 107), temoinVariante: p => Number(p.variante.slice(1)) });
        assert.strictEqual(v.attributions.filter(a => a.groupe === '01').length, 0);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
