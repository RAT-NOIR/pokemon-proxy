'use strict';
// LOT PERF-SCAN, P1 — la recherche du catalogue par un index de nom, SANS changer l'ensemble des candidats.
// Base EN MÉMOIRE (H.ouvrirBac), aucun réseau. Chaque cas compare l'index à la REQUÊTE D'AUJOURD'HUI (regex insensible à la casse, balayage complet), recopiée de index.js / identification-locale.js :
// le même ensemble de produits, dans le même ordre, ou le test échoue. L'index n'a de droit qu'à la condition que le champ le couvre ENTIÈREMENT ; sinon la recherche rend null et l'appelant retombe sur la requête d'avant.
const H = require('./_harnais'); const db = require('../db');
const CN = require('../identifier/cle-nom'); const IN = require('../identifier/index-nom');
const echapper = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');                                      // la fonction de index.js
const normaliserAvant = nom => nom.toLowerCase().replace(/[\s\-'.&]/g, '');                                    // la fonction de index.js AVANT ce lot
const ids = l => l.map(d => d.idProduct);

(async () => {
    await H.ouvrirBac('test-index-nom.js');
    const cat = db.col('catalogue_produits'), num = db.col('numeros_cartes');

    // ── 1. la clé : UNE fonction, la même qu'avant pour la normalisation
    for (const s of ['M Kangaskhan EX', 'MKangaskhan EX', "Farfetch'd", 'Mr. Mime', 'Jesse & James', 'Ho-Oh', 'Dragonite Lv.61', 'Milotic δ Delta Species', '', '  Pikachu  '])
        H.v(`normaliserNom(« ${s} ») = la règle d'avant`, CN.normaliserNom(s), normaliserAvant(s));
    H.v('clés du produit : le nom avant « [ », puis sans niveau, puis sans δ Delta Species',
        [CN.clesDuProduit('Dragonite Lv.61 [Wing Attack | Hyper Beam]'), CN.clesDuProduit('Milotic δ Delta Species [Hydro Pump]'), CN.clesDuProduit("Farfetch'd"), CN.clesDuProduit('Charizard ex Lv.X')],
        [['dragonitelv61', 'dragonite'], ['miloticδdeltaspecies', 'milotic'], ['farfetchd'], ['charizardexlvx', 'charizardex']]);
    H.v('clés : un nom absent n\'a aucune clé (rien d\'inventé)', [CN.clesDuProduit(null), CN.clesDuProduit(undefined), CN.clesDuProduit(12)], [[], [], []]);
    H.v('clé française : minuscules, accents retirés, sinon intacte', [CN.cleNomFr('Éveil'), CN.cleNomFr('Carabaffe'), CN.cleNomFr('Flabébé'), CN.cleNomFr(null), CN.cleNomFr('')], ['eveil', 'carabaffe', 'flabebe', '', '']);

    // ── le catalogue de banc : des homonymes, des suffixes, des accents, un nom qui ne contient son premier mot que par morceau
    const C = [
        [1, 'Pikachu [Thunder Jolt | Quick Attack]'], [2, 'Pikachu'], [3, 'Pikachu ex'], [4, 'pikachu [Gnaw]'], [5, 'Pikachu V [Thunderbolt]'],
        [6, 'Dragonite Lv.61 [Wing Attack]'], [7, 'Dragonite [Wing Attack]'], [8, 'Dragonite ex'], [9, 'Milotic δ Delta Species [Hydro Pump]'], [10, 'Milotic [Hydro Pump]'],
        [11, "Farfetch'd [Cut]"], [12, 'Mr. Mime [Barrier]'], [13, 'Mr Mime'], [14, 'M Kangaskhan EX [Hammer Arm]'], [15, 'Mega Kangaskhan ex'], [16, 'Kangaskhan [Comet Punch]'],
        [17, 'Ho-Oh [Rainbow Burn]'], [18, 'Ho Oh'], [19, 'HoOh'], [20, 'Jesse & James [Trainer]'], [21, 'Jesse and James'], [22, 'Flabébé [Fairy Wind]'], [23, 'Flabebe'], [24, 'Eevee Online Code Card'],
        [25, 'Raichu'], [26, 'Raichu [Thunderbolt]'], [27, 'Dark Raichu'], [28, 'Lt. Surge\'s Raichu'], [29, 'Mew'], [30, 'Mewtwo [Psychic]'], [31, 'Mew ex'], [32, null], [33, ''], [34, 'Pikachu[Spark]'], [35, 'Mewtwo\tX']
    ];
    await cat.insertMany(C.map(([idProduct, name]) => ({ idProduct, name, idExpansion: 1000 + (idProduct % 7), idMetacard: 50000 + idProduct })));
    await num.insertMany([[1, 'Pikachu'], [2, 'Pikachu'], [3, 'Raichu'], [4, 'Carabaffe'], [5, 'Éveil Pokémon'], [6, 'Flabébé'], [7, 'carabaffe'], [8, null], [9, 'Mew (promo)']].map(([idProduct, nomFr]) => ({ idProduct, nomFr, numero: String(idProduct) })));

    // ── 2. sans le champ ni l'index : la recherche rend null (l'appelant retombe sur la requête d'avant), jamais un ensemble vide
    const dispoC = IN.creerDisponibilite({ col: cat, champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE, dureeMs: 60000 });
    H.v('AUCUN champ, AUCUN index : indisponible', await dispoC.disponible(), false);
    H.v('…donc la présélection rend null (pas []): le repli prend le relais', await IN.preselection({ col: cat, dispo: dispoC, cles: ['pikachu'], regexPremierMot: /pikachu/i }), null);

    // ── 3. le champ posé PARTIELLEMENT + l'index : toujours indisponible (un produit sans clé serait manqué)
    const poserCles = async (filtre = {}) => { for await (const d of cat.find(filtre, { projection: { name: 1 } })) await cat.updateOne({ _id: d._id }, { $set: { [CN.CHAMP_CATALOGUE]: CN.clesDuProduit(d.name) } }); };
    await poserCles({ idProduct: { $lte: 20 } });
    await cat.createIndex({ [CN.CHAMP_CATALOGUE]: 1 }, { name: CN.INDEX_CATALOGUE });
    dispoC.oublier();
    H.v('champ posé sur 20 produits sur 33 : indisponible (la couverture est entière ou rien)', await dispoC.disponible(), false);
    // ── 4. couvert entièrement : disponible
    await poserCles({ idProduct: { $gt: 20 } });
    dispoC.oublier();
    H.v('champ posé sur tous + index : disponible', await dispoC.disponible(), true);

    // ── 5. LE COEUR : la présélection par l'index rend EXACTEMENT ce que rend la requête d'avant, pour des noms lus variés
    const premierMotDe = n => n.replace(/^(M|Mega)[\s-]*/i, '').split(/[\s&-]/)[0];
    const sansVariantes = nom => { const v = new Set([nom.trim()]); return v; };
    let diffs = 0, jugees = 0;
    const lus = ['Pikachu', 'pikachu', 'PIKACHU', 'Pikachu ex', 'Dragonite', 'Dragonite Lv.61', 'Milotic', 'Farfetch\'d', 'Farfetchd', 'Mr. Mime', 'Mr Mime', 'M Kangaskhan EX', 'Mega Kangaskhan ex', 'Kangaskhan',
        'Ho-Oh', 'Ho Oh', 'Jesse & James', 'Flabébé', 'Flabebe', 'Raichu', 'Mew', 'Mewtwo', 'Eevee', 'Carapuce'];
    // le filtre d'index.js::trouverProduitsLocaux, recopié (les trois formes), appliqué des deux côtés : la différence ne peut venir que de la présélection
    const filtrer = (presel, cibles) => presel.filter(p => {
        const nomProduit = p.name.split('[')[0].trim();
        if (cibles.has(CN.normaliserNom(nomProduit))) return true;
        const sn = CN.sansNiveau(nomProduit); if (sn !== nomProduit && cibles.has(CN.normaliserNom(sn))) return true;
        const sd = CN.sansDelta(nomProduit); return sd !== nomProduit && cibles.has(CN.normaliserNom(sd));
    });
    for (const lu of lus) {
        const cibles = new Set([...sansVariantes(lu), lu.replace(/-/g, ' '), lu.replace(/-/g, ''), lu.replace(/^M[\s-]/i, 'Mega '), lu.replace(/^Mega\s/i, 'M ')].map(CN.normaliserNom));
        const pm = premierMotDe(lu); if (!pm || pm.length < 3) continue;
        const rx = new RegExp(echapper(pm), 'i');
        const avant = filtrer(await cat.find({ name: rx }).sort({ _id: 1 }).toArray(), cibles);
        const presel = await IN.preselection({ col: cat, dispo: dispoC, cles: [...cibles], regexPremierMot: rx });
        const apres = presel === null ? null : filtrer(presel, cibles);
        jugees++;
        if (apres === null || JSON.stringify(ids(avant)) !== JSON.stringify(ids(apres))) { diffs++; console.log(`   ↳ DIFFÉRENCE pour « ${lu} » : avant ${JSON.stringify(ids(avant))} · après ${apres && JSON.stringify(ids(apres))}`); }
    }
    H.v(`présélection par l'index : même ensemble, même ordre que la requête d'avant sur ${jugees} noms`, diffs, 0);
    H.vrai('…et aucun champ interne (nomCles) ne sort dans les produits rendus', !Object.keys((await IN.preselection({ col: cat, dispo: dispoC, cles: ['pikachu'], regexPremierMot: /pik/i }))[0]).includes('nomCles'));

    // ── 6. noms courts (moins de trois lettres) : la regex ancrée « ^nom(\s*\[|$) » en i
    const courts = ['Mew', 'mew', 'Ho-Oh', 'Raichu', 'Mr. Mime', 'M', 'Jesse & James', 'Pikachu [Gnaw]', 'Eevee'];
    let dc = 0;
    for (const v of courts) {
        const rx = new RegExp(`^${echapper(v)}(\\s*\\[|$)`, 'i');
        const avant = await cat.find({ name: rx }).sort({ _id: 1 }).toArray();
        const apres = await IN.parNomCourt({ col: cat, dispo: dispoC, variante: v, regex: rx });
        const attendu = v.includes('[') ? null : avant;                                                    // une variante qui contient « [ » n'est pas dans le domaine de l'index : repli
        if (JSON.stringify(ids(attendu || [])) !== JSON.stringify(ids(apres || [])) || (attendu === null) !== (apres === null)) { dc++; console.log(`   ↳ DIFFÉRENCE (nom court) pour « ${v} » : avant ${JSON.stringify(ids(avant))} · après ${apres && JSON.stringify(ids(apres))}`); }
    }
    H.v(`noms courts par l'index : même ensemble que la regex ancrée sur ${courts.length} variantes (« [ » dans la variante : repli)`, dc, 0);

    // ── 7. le nom français (numeros_cartes.nomFr) : « ^nom$ » en i
    const dispoF = IN.creerDisponibilite({ col: num, champ: CN.CHAMP_FR, nomIndex: CN.INDEX_FR, dureeMs: 60000 });
    H.v('nom français : sans champ, indisponible', await dispoF.disponible(), false);
    for await (const d of num.find({}, { projection: { nomFr: 1 } })) await num.updateOne({ _id: d._id }, { $set: { [CN.CHAMP_FR]: CN.cleNomFr(d.nomFr) } });
    await num.createIndex({ [CN.CHAMP_FR]: 1 }, { name: CN.INDEX_FR });
    dispoF.oublier();
    H.v('nom français : champ posé sur tous (« » pour les lignes sans nom) + index : disponible', await dispoF.disponible(), true);
    let df = 0;
    for (const lu of ['Carabaffe', 'carabaffe', 'CARABAFFE', 'Éveil Pokémon', 'Eveil Pokemon', 'Flabébé', 'Flabebe', 'Pikachu', 'Mew', 'Mew (promo)', 'Inconnu', '']) {
        if (!lu) continue;
        const rx = new RegExp(`^${echapper(lu)}$`, 'i');
        const avant = await num.find({ nomFr: rx }, { projection: { idProduct: 1 } }).sort({ _id: 1 }).toArray();
        const apres = await IN.parNomFrancais({ col: num, dispo: dispoF, nomLu: lu, regex: rx });
        if (apres === null || JSON.stringify(ids(avant)) !== JSON.stringify(ids(apres))) { df++; console.log(`   ↳ DIFFÉRENCE (nomFr) pour « ${lu} » : avant ${JSON.stringify(ids(avant))} · après ${apres && JSON.stringify(ids(apres))}`); }
    }
    H.v('nom français par l\'index : même ensemble (accents et casse) que la regex ancrée', df, 0);
    H.v('…et la forme rendue est celle d\'avant : { _id, idProduct } seulement', Object.keys((await IN.parNomFrancais({ col: num, dispo: dispoF, nomLu: 'Carabaffe', regex: /^Carabaffe$/i }))[0]).sort(), ['_id', 'idProduct']);

    // ── 7 bis. « le nom COMMENCE par … » (pont-cartes.js : les homonymes hors couverture) : la regex ancrée « ^nom(\s|\[|$) » en i
    H.v('clé « nom en minuscules » : minuscules, rien d\'autre ; « » sans nom', [CN.cleNomMin('Pikachu [Gnaw]'), CN.cleNomMin('MILOTIC δ'), CN.cleNomMin(null), CN.cleNomMin(12)], ['pikachu [gnaw]', 'milotic δ', '', '']);
    const dispoM = IN.creerDisponibilite({ col: cat, champ: CN.CHAMP_NOM_MIN, nomIndex: CN.INDEX_NOM_MIN, dureeMs: 60000 });
    H.v('nom minuscule : sans champ, indisponible ; la requête rend null (repli)', [await dispoM.disponible(), await IN.debutDeNom({ col: cat, dispo: dispoM, nom: 'Pikachu', regex: /^Pikachu(\s|\[|$)/i })], [false, null]);
    for await (const d of cat.find({}, { projection: { name: 1 } })) await cat.updateOne({ _id: d._id }, { $set: { [CN.CHAMP_NOM_MIN]: CN.cleNomMin(d.name) } });
    await cat.createIndex({ [CN.CHAMP_NOM_MIN]: 1 }, { name: CN.INDEX_NOM_MIN });
    dispoM.oublier();
    H.v('nom minuscule : champ posé sur tous + index : disponible', await dispoM.disponible(), true);
    let dd = 0;
    const debuts = ['Pikachu', 'pikachu', 'PIKACHU', 'Pikachu V', 'Dragonite', 'Milotic', 'Mr', 'Mr. Mime', 'Mew', 'Kangaskhan', 'M Kangaskhan EX', "Farfetch'd", 'Ho', 'Ho-Oh', 'Raichu', 'Flabébé', 'Flabebe', 'Eevee', 'Inconnu', 'Lt. Surge\'s Raichu'];
    for (const n of debuts) {
        const rx = new RegExp('^' + echapper(n) + '(\\s|\\[|$)', 'i');
        const avant = await cat.find({ name: { $in: [rx] } }, { projection: { idProduct: 1, idExpansion: 1 } }).sort({ _id: 1 }).toArray();
        const apres = await IN.debutDeNom({ col: cat, dispo: dispoM, nom: n, regex: rx });
        if (apres === null || JSON.stringify(avant) !== JSON.stringify(apres)) { dd++; console.log(`   ↳ DIFFÉRENCE (commence par) pour « ${n} » : avant ${JSON.stringify(ids(avant))} · après ${apres && JSON.stringify(ids(apres))}`); }
    }
    H.v(`« commence par » par l'index : même ensemble, même forme { _id, idProduct, idExpansion } que la regex ancrée sur ${debuts.length} noms`, dd, 0);
    H.v('…un nom vide : null (repli)', await IN.debutDeNom({ col: cat, dispo: dispoM, nom: '', regex: /^(\s|\[|$)/i }), null);

    // ── 8. la fraîcheur : un produit AJOUTÉ après la migration (import quotidien) sans clé rend l'index indisponible AU PROCHAIN contrôle, jamais un ensemble amputé
    const compte = { n: 0 };
    const espion = new Proxy(cat, { get(c, p) { const v = c[p]; if (p === 'findOne') return (...a) => { compte.n++; return v.apply(c, a); }; return typeof v === 'function' ? v.bind(c) : v; } });
    const dispoE = IN.creerDisponibilite({ col: espion, champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE, dureeMs: 60000 });
    await dispoE.disponible(); await dispoE.disponible(); await dispoE.disponible();
    H.v('le contrôle de couverture est GARDÉ (une lecture pour trois demandes, pas une par scan)', compte.n, 1);
    await cat.insertOne({ idProduct: 900, name: 'Pikachu VMAX', idExpansion: 1, idMetacard: 900 });          // un import quotidien : produit neuf, aucune clé
    H.v('…un produit neuf sans clé n\'est vu qu\'à l\'expiration (borne de la fenêtre : dureeMs)', await dispoE.disponible(), true);
    dispoE.oublier();
    H.v('…puis (contrôle refait) l\'index est refusé : couverture rompue', await dispoE.disponible(), false);
    H.v('…et la présélection rend null : le repli rend le produit neuf (rien d\'amputé)', await IN.preselection({ col: cat, dispo: dispoE, cles: ['pikachuvmax'], regexPremierMot: /pikachu/i }), null);
    await cat.deleteOne({ idProduct: 900 });

    // ── 8 bis. B1 : une clé PÉRIMÉE (produit RENOMMÉ par l'import, qui garde ses anciennes clés) rend l'index indisponible : le témoin de la source (`nomSrc`, écrit à côté des clés) doit égaler `name`
    {
        const cat2 = db.col('catalogue_produits_frais');
        await cat2.insertMany([[1, 'Celebration Fanfare'], [2, 'Pikachu'], [3, null], [4, 'Flabébé']].map(([idProduct, name]) => ({ idProduct, name })));
        for await (const d of cat2.find({})) await cat2.updateOne({ _id: d._id }, { $set: { [CN.CHAMP_CATALOGUE]: CN.clesDuProduit(d.name), [CN.CHAMP_NOM_MIN]: CN.cleNomMin(d.name), [CN.CHAMP_SOURCE_CATALOGUE]: CN.sourceDe(d.name) } });
        await cat2.createIndex({ [CN.CHAMP_CATALOGUE]: 1 }, { name: CN.INDEX_CATALOGUE });
        const src = { champ: 'name', temoin: CN.CHAMP_SOURCE_CATALOGUE };
        const frais = IN.creerDisponibilite({ col: cat2, champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE, source: src });
        H.v('B1 : clés ET témoins à jour : disponible', await frais.disponible(), true);
        await cat2.updateOne({ idProduct: 1 }, { $set: { name: 'Celebratory Fanfare' } });                      // l'import renomme : $set name, rien d'autre
        frais.oublier();
        H.v('B1 : un produit RENOMMÉ (le témoin ne vaut plus le nom) : indisponible — les anciennes clés auraient fait disparaître le candidat', await frais.disponible(), false);
        H.v('B1 : …et la présélection rend null (repli sur la regex d\'avant, qui trouve le produit renommé)', await IN.preselection({ col: cat2, dispo: frais, cles: ['celebratoryfanfare'], regexPremierMot: /celebratory/i }), null);
        await cat2.updateOne({ idProduct: 1 }, { $set: { [CN.CHAMP_CATALOGUE]: CN.clesDuProduit('Celebratory Fanfare'), [CN.CHAMP_SOURCE_CATALOGUE]: CN.sourceDe('Celebratory Fanfare') } });
        frais.oublier();
        H.v('B1 : après la relance de la pose (clés et témoin réécrits) : disponible de nouveau, et le produit renommé est trouvé', [await frais.disponible(), ids(await IN.preselection({ col: cat2, dispo: frais, cles: ['celebratoryfanfare'], regexPremierMot: /celebratory/i }))], [true, [1]]);
        await cat2.updateOne({ idProduct: 2 }, { $unset: { [CN.CHAMP_SOURCE_CATALOGUE]: '' } });
        frais.oublier();
        H.v('B1 : un témoin ABSENT (clés posées avant le témoin) : indisponible', await frais.disponible(), false);
        await cat2.updateOne({ idProduct: 2 }, { $set: { [CN.CHAMP_SOURCE_CATALOGUE]: CN.sourceDe('Pikachu') } });
        frais.oublier();
        H.v('B1 : un nom absent (null) et son témoin « » égalent : disponible ; les accents ne trompent pas le témoin (Flabébé)', await frais.disponible(), true);
        // le coût du contrôle de fraîcheur : UNE requête bornée (limit 1) de plus, à la même cadence ; plan = balayage tant que tout est frais (mesuré au rapport)
        const ex = await cat2.find({ $expr: { $ne: [{ $ifNull: ['$name', ''] }, { $ifNull: ['$' + CN.CHAMP_SOURCE_CATALOGUE, ''] }] } }).limit(1).explain('executionStats');
        H.v('B1 : la requête de fraîcheur est bornée (limit 1) et sa forme est acceptée par le serveur', [ex.executionStats.nReturned, JSON.stringify(ex.queryPlanner.winningPlan).includes('LIMIT')], [0, true]);
    }

    // ── 8 ter. I1 : le repli est DIT à chaque transition (index → repli, repli → index), avec sa cause ; pas à chaque demande
    {
        const cat3 = db.col('catalogue_produits_transitions');
        await cat3.insertMany([{ idProduct: 1, name: 'Mew' }]);
        const lignes = []; const aw = console.warn; console.warn = (...a) => lignes.push(a.join(' '));
        try {
            const d = IN.creerDisponibilite({ col: cat3, champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE, source: { champ: 'name', temoin: CN.CHAMP_SOURCE_CATALOGUE } });
            await d.disponible(); d.oublier(); await d.disponible(); d.oublier(); await d.disponible();
            H.v('I1 : trois contrôles, même verdict (repli, index absent) : UNE seule ligne, qui nomme la cause', [lignes.length, /repli/.test(lignes[0] || ''), /index absent/.test(lignes[0] || '')], [1, true, true]);
            for await (const x of cat3.find({})) await cat3.updateOne({ _id: x._id }, { $set: { [CN.CHAMP_CATALOGUE]: CN.clesDuProduit(x.name), [CN.CHAMP_SOURCE_CATALOGUE]: CN.sourceDe(x.name) } });
            await cat3.createIndex({ [CN.CHAMP_CATALOGUE]: 1 }, { name: CN.INDEX_CATALOGUE });
            d.oublier(); await d.disponible();
            H.v('I1 : le retour à l\'index est dit aussi', [lignes.length, /retour|index utilisé|disponible/i.test(lignes[1] || '')], [2, true]);
            await cat3.insertOne({ idProduct: 2, name: 'Mewtwo' }); d.oublier(); await d.disponible();
            H.v('I1 : un produit neuf sans clé : nouvelle transition, cause « sans clé »', [lignes.length, /sans clé/.test(lignes[2] || '')], [3, true]);
            await cat3.deleteOne({ idProduct: 2 }); d.oublier(); await d.disponible();
            await cat3.updateOne({ idProduct: 1 }, { $set: { name: 'Mew ex' } }); d.oublier(); await d.disponible();
            H.v('I1 : le produit neuf retiré (retour), puis un produit renommé : cause « clé périmée »', [lignes.length, /périmée/.test(lignes[4] || '')], [5, true]);
            process.env.V2_INDEX_NOM = '0'; const avant = lignes.length; await d.disponible(); await d.disponible(); delete process.env.V2_INDEX_NOM;
            H.v('I1 : V2_INDEX_NOM=0 (déjà en repli) : pas de nouvelle ligne', lignes.length - avant, 0);
        } finally { console.warn = aw; }
        // l'indicateur du scan : `catalogueIndex` — vrai si la recherche a été servie par l'index, faux si elle est retombée sur le balayage
        const S = require('../../sources');
        const dBon = IN.creerDisponibilite({ col: cat, champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE });
        const dMauvais = IN.creerDisponibilite({ col: cat3, champ: CN.CHAMP_FR, nomIndex: CN.INDEX_FR });
        const muet = console.warn; console.warn = () => { };
        let dansScan = {};
        try {
            await S.dansUnScan(async () => {
                dansScan.avant = IN.indexDuScan();
                await IN.preselection({ col: cat, dispo: dBon, cles: ['pikachu'], regexPremierMot: /pik/i });
                dansScan.apresIndex = IN.indexDuScan();
                await IN.parNomFrancais({ col: cat3, dispo: dMauvais, nomLu: 'Mew', regex: /^Mew$/i });
                dansScan.apresRepli = IN.indexDuScan();
            });
        } finally { console.warn = muet; }
        H.v('I1 : indicateur du scan — rien tenté : null ; servi par l\'index : true ; une recherche est retombée sur le balayage : false (un repli suffit)', [dansScan.avant, dansScan.apresIndex, dansScan.apresRepli], [null, true, false]);
        H.v('I1 : hors de tout scan, rien ne lève', IN.indexDuScan(), null);
    }

    // ── 9. une panne n'est jamais « disponible » ; l'interrupteur éteint l'index
    const cassee = IN.creerDisponibilite({ col: { indexes: async () => { throw new Error('panne'); }, findOne: async () => null }, champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE, dureeMs: 60000 });
    H.v('une lecture qui échoue : indisponible (jamais « tout va bien »)', await cassee.disponible(), false);
    process.env.V2_INDEX_NOM = '0';
    const eteint = IN.creerDisponibilite({ col: cat, champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE, dureeMs: 60000 });
    H.v('V2_INDEX_NOM=0 : indisponible même si tout est posé', await eteint.disponible(), false);
    delete process.env.V2_INDEX_NOM;

    // ── 10. l'index est bien utilisé (plan IXSCAN, quelques documents examinés) — le but du lot
    const e = await cat.find({ [CN.CHAMP_CATALOGUE]: { $in: ['pikachu'] } }).explain('executionStats');
    H.v('explain : IXSCAN (pas COLLSCAN), documents examinés ≤ documents rendus + 1', [JSON.stringify(e.queryPlanner.winningPlan).includes('IXSCAN'), JSON.stringify(e.queryPlanner.winningPlan).includes('COLLSCAN'), e.executionStats.totalDocsExamined <= e.executionStats.nReturned + 1], [true, false, true]);
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch { } process.exit(1); });
