// node test-separer-variantes-phase2.js — PHASE 3b, T3 : séparer par variante 5 produits (scénario « jeton ») : le plan sur un état fabriqué, la garde d'état, le refus hors lot, le retrait exact.
// Documents FABRIQUÉS, la VRAIE décision de l'API (decider, chaîne importée par garde-contrat-api.js), une FAUSSE base en mémoire (aucune base, aucun réseau, aucun chemin du testeur ; les manifestes vont dans un
// dossier temporaire). Si l'API est introuvable, le banc ÉCHOUE. NODE_PATH = node_modules du dépôt principal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const V = require(path.join(DIR, 'collecte-cartes', 'phase2-variantes'));
const P = require(path.join(DIR, 'collecte-cartes', 'phase2-visuels'));
const S = require(path.join(DIR, 'collecte-cartes', 'phase3b-separation'));
const GC = require(path.join(DIR, 'collecte-cartes', 'garde-contrat-api'));
const GL = require(path.join(DIR, 'collecte-cartes', 'garde-lot'));
const { executer } = require(path.join(DIR, 'separer-variantes-phase2'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); } };

// ── la fausse base : find / countDocuments / updateOne, avec $exists, $elemMatch et le positionnel images.$ — ce que les filtres de l'outil emploient
const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
function champOk(x, v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('$exists' in v)) return (x !== undefined) === v.$exists;
    if (v === null) return x === null || x === undefined;
    return JSON.stringify(x) === JSON.stringify(v);
}
function correspond(doc, filtre) {
    return Object.entries(filtre).every(([k, v]) => {
        if (v && typeof v === 'object' && '$elemMatch' in v) return (get(doc, k) || []).some(e => Object.entries(v.$elemMatch).every(([a, b]) => champOk(e?.[a], b)));
        return champOk(get(doc, k), v);
    });
}
function fausseBase(init, { mentirSurCartes = false } = {}) {
    const cols = new Map(Object.entries(init).map(([n, docs]) => [n, docs.map(d => structuredClone(d))]));
    const etat = { fermee: false, ecritures: 0 };
    const garde = () => { if (etat.fermee) throw new Error('MongoNotConnectedError: la connexion est fermée'); };
    const col = nom => ({
        async countDocuments(f) { garde(); return cols.get(nom).filter(d => correspond(d, f)).length; },
        async updateOne(f, u) {
            garde();
            const arr = cols.get(nom); const d = arr.find(x => correspond(x, f)); if (!d) return { matchedCount: 0, modifiedCount: 0 };
            if (mentirSurCartes && nom === 'cartes') return { matchedCount: 1, modifiedCount: 1 };   // une écriture qui dit « modifié » sans rien faire : seule la RELECTURE peut le voir
            let modifie = false;
            const idx = () => { const em = Object.entries(f).find(([, v]) => v && v.$elemMatch); return (d.images || []).findIndex(e => Object.entries(em[1].$elemMatch).every(([a, b]) => champOk(e?.[a], b))); };
            for (const [k, v] of Object.entries(u.$set || {})) { if (k.startsWith('images.$.')) { const i = idx(); d.images[i][k.slice(9)] = v; } else d[k] = v; modifie = true; }
            for (const k of Object.keys(u.$unset || {})) { if (k.startsWith('images.$.')) { const i = idx(); delete d.images[i][k.slice(9)]; } else delete d[k]; modifie = true; }
            if (modifie) etat.ecritures++;
            return { matchedCount: 1, modifiedCount: modifie ? 1 : 0 };
        }
    });
    return { collection: col, etat, brut: nom => cols.get(nom).map(d => structuredClone(d)), fermer: async () => { etat.fermee = true; } };
}

(async () => {
    let api;
    try { api = await GC.chargerApi(); } catch (e) { console.log(`❌ chargerApi : ${e.message}`); process.exit(1); }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sep-var-'));

    // ── le monde fabriqué ──
    const im = (set, numero, n) => ({ set, numero, cleR2: `g/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `v/${n}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex' });
    const carte = (id, numero, n) => ({ _id: id, nomEn: `Carte ${id}`, sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' }], images: [im('Set-A', numero, n)] });
    const ligne = (carteId, idProduct, numeroFiche, o = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, idExpansion: 100, numeroFiche, slug: `P${idProduct}`, slugSet: 'Set-A', ...o });
    const monde = (o = {}) => ({
        sets: [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } }],
        cartes: [carte(1, '001', 'trio'), carte(2, '002', 'seule'), carte(3, '003', 'duo')],
        cartes_produits: [ligne(1, 10, '001'), ligne(1, 11, '001'), ligne(1, 12, '001'), ligne(2, 20, '002'), ligne(3, 30, '003'), ligne(3, 31, '003')]
    });
    // la table fermée fabriquée : 11 sans jeton (finition), 12 « jumbo », 31 « toys-r-us » ; justes 10 et 30
    const CIBLES = [
        { idProduct: 11, carteId: 1, set: 'Set-A', numero: '001', cleR2: 'g/trio.webp', partageAvec: [10] },
        { idProduct: 12, carteId: 1, set: 'Set-A', numero: '001', cleR2: 'g/trio.webp', partageAvec: [10] },
        { idProduct: 31, carteId: 3, set: 'Set-A', numero: '003', cleR2: 'g/duo.webp', partageAvec: [30] }
    ];
    const LU = new Map([[11, { quoi: 'version « Non-Holo » (finition)', marque: null }], [12, { quoi: 'carte Oversized (« Attention: Oversized Card »)', marque: 'jumbo' }], [31, { quoi: 'tampon Toys R Us présent chez Cardmarket, absent de notre scan', marque: 'toys-r-us' }]]);
    const TABLE = { entrees: 2, justes: 2, jetons: 2, sansJeton: 1 };

    const lancer = async (db, argv, { env = {}, ppid = 4242, mondeLu = null, lectures = null } = {}) => {
        const sorties = [], erreurs = [], fichiers = new Map(); let ouvertures = 0, nLectures = 0;
        const code = await executer({
            argv: [...argv, `--sortie=${tmp}`], env, ppid, cibles: CIBLES, lu: LU, attenduTable: TABLE, minEntrees: 3,
            chargerApi: async () => api,
            lireEtat: async () => { nLectures++; if (lectures) lectures.push(db.etat.fermee); return { sets: (mondeLu || monde()).sets, cartes: db.brut('cartes'), cartesProduits: db.brut('cartes_produits') }; },
            ouvrirEcriture: async () => { ouvertures++; return { db, fermer: db.fermer }; },
            ecrireFichier: (p, c) => { fs.writeFileSync(p, c); fichiers.set(p, c); }, lireFichier: p => fs.readFileSync(p, 'utf8'),
            contrat: GC, garde: GL, log: s => sorties.push(s), err: s => erreurs.push(s)
        }).catch(e => { erreurs.push(`EXCEPTION ${e.message}`); return 99; });
        return { code, sorties: sorties.join('\n'), erreurs: erreurs.join('\n'), fichiers, ouvertures, nLectures };
    };
    const base = () => { const m = monde(); return fausseBase({ cartes: m.cartes, cartes_produits: m.cartes_produits }); };
    const instantane = db => JSON.stringify([db.brut('cartes'), db.brut('cartes_produits')]);
    const variantes = db => Object.fromEntries(db.brut('cartes_produits').filter(l => l.variante !== undefined).map(l => [l.idProduct, l.variante]));
    const entreesFausses = db => db.brut('cartes').flatMap(c => c.images.filter(m => m.partageeTamponNonSepare === false).map(m => `${c._id}:${m.cleR2}`));
    const sousLot = { LOT_ADDITIF_PID: '4242' };

    console.log('1. la TABLE FERMÉE réelle (aucune base) : 9 entrées, 9 justes, 5 jetons, 8 cibles sans jeton');
    const reelles = P.ECARTES.filter(x => x.geste === 'emprunt');
    const gr = V.construireGroupes({ cibles: reelles, servisParCle: null, api, verifierServis: false });
    const jetons = gr.flatMap(g => g.cibles.filter(c => c.jeton).map(c => `${c.idProduct}:${c.jeton}`)).sort();
    verifier('9 groupes (une entrée chacun)', gr.length, 9);
    verifier('9 produits justes', gr.flatMap(g => g.justes).length, 9);
    verifier('5 jetons : toys-r-us 752306 et 873081, jumbo 362871, 362872, 362873', jetons, ['362871:jumbo', '362872:jumbo', '362873:jumbo', '752306:toys-r-us', '873081:toys-r-us']);
    verifier('8 cibles SANS jeton, jamais écrites', gr.flatMap(g => g.cibles.filter(c => !c.jeton).map(c => c.idProduct)).sort((a, b) => a - b), [280583, 538823, 576708, 722696, 855023, 858713, 901315, 901316]);
    verifier('ATTENDU_TABLE du module = ces comptes', S.ATTENDU_TABLE, { entrees: 9, justes: 9, jetons: 5, sansJeton: 8 });
    const tr = S.tableDesEcritures(gr, V.LU);
    verifier('la table écrit 14 lignes (9 + 5) et 9 entrées ; chaque preuve est lisible : ce qui a été vu, par qui, quand', [tr.lignes.length, tr.entrees.length, tr.lignes.every(l => l.preuve.length > 120 && /2026-10-24/.test(l.preuve) && /oeil/.test(l.preuve) && /coordinateur/.test(l.preuve) && /testeur/.test(l.preuve))], [14, 9, true]);
    verifier('la preuve de 752306 dit le tampon Toys R Us lu chez Cardmarket et absent du scan', /Toys R Us présent chez Cardmarket, absent de notre scan/.test(tr.lignes.find(l => l.idProduct === 752306).preuve), true);
    verifier('la preuve d\'un juste nomme ses voisins marqués', /362873 \(carte Oversized/.test(tr.lignes.find(l => l.idProduct === 274772 && l.role === 'juste').preuve), true);

    console.log('2. SIMULATION (défaut) sur l\'état fabriqué : la VRAIE decider, rien d\'écrit');
    let db = base(); let avant = instantane(db);
    let r = await lancer(db, []);
    verifier('exit 0, rien d\'écrit, la base d\'écriture n\'est jamais ouverte', [r.code, instantane(db) === avant, r.ouvertures], [0, true, 0]);
    verifier('le plan : 2 groupes, 2 entrées, 4 lignes (2 justes + 2 jetons), 1 cible sans jeton, 0 refus', /2 groupes \(une entrée chacun\) · 2 entrées à marquer \(déjà : 0\) · 4 lignes à écrire = 2 justes « normale » \+ 2 cibles à jeton \(déjà : 0\) · 1 cibles SANS jeton : rien d'écrit · refus 0/.test(r.sorties), true);
    verifier('l\'API après : cibles à jeton servies 2/2 (12 jumbo, 31 toys-r-us), justes perdus 0, cible sans jeton non servie 1/1, autres produits perdus 0', [/cibles à jeton servies 2\/2/.test(r.sorties), /"12":"jumbo"/.test(r.sorties), /"31":"toys-r-us"/.test(r.sorties), /justes perdus 0/.test(r.sorties), /cibles SANS jeton non servies 1\/1/.test(r.sorties), /AUTRES produits perdus 0/.test(r.sorties)], [true, true, true, true, true, true]);
    verifier('VERDICT ✅ et contrat de l\'API : zéro refus nouveau', [/VERDICT : ✅/.test(r.sorties), /CONTRAT : ✅ zéro refus nouveau/.test(r.sorties)], [true, true]);
    verifier('avec --manifeste en simulation : le manifeste PRÉVU est écrit (dossier de sortie), la base reste intacte', await (async () => { const rr = await lancer(db, ['--manifeste=prevu.json']); return [rr.code, fs.existsSync(path.join(tmp, 'prevu.json')), instantane(db) === avant]; })(), [0, true, true]);

    console.log('3. LE REFUS HORS DE lot-additif.js (avant toute lecture)');
    db = base(); avant = instantane(db);
    r = await lancer(db, ['--ecrire', '--attendu=4', '--manifeste=m.json']);
    verifier('--ecrire sans LOT_ADDITIF_PID : exit 2, message « lot-additif », AUCUNE lecture, rien d\'écrit', [r.code, /lot-additif/.test(r.erreurs), r.nLectures, instantane(db) === avant], [2, true, 0, true]);
    r = await lancer(db, ['--ecrire', '--attendu=4', '--manifeste=m.json'], { env: { LOT_ADDITIF_PID: '1' }, ppid: 4242 });
    verifier('--ecrire avec le pid d\'un AUTRE processus : refusé', [r.code, r.nLectures], [2, 0]);
    r = await lancer(db, ['--retirer', '--ecrire', '--attendu=4', '--manifeste=m.json']);
    verifier('--retirer --ecrire hors lot : refusé aussi', [r.code, r.nLectures], [2, 0]);
    r = await lancer(db, ['--ecrire', '--manifeste=m.json'], { env: sousLot });
    verifier('--ecrire sans --attendu : exit 2', [r.code, r.nLectures], [2, 0]);
    r = await lancer(db, ['--ecrire', '--attendu=4'], { env: sousLot });
    verifier('--ecrire sans --manifeste : exit 2', [r.code, r.nLectures], [2, 0]);
    r = await lancer(db, ['--zzz'], { env: sousLot });
    verifier('argument inconnu : exit 2', r.code, 2);

    console.log('4. LES GARDES D\'ÉTAT : rien ne s\'écrit si UN SEUL groupe n\'est pas dans l\'état attendu (écrit par ce qui est autorisé)');
    const refus = async (nom, modifier, motif) => {
        const d = base(); const cs = d.brut('cartes'), ls = d.brut('cartes_produits');
        const m = { cartes: cs, cartes_produits: ls }; modifier(m);
        const d2 = fausseBase(m); const av = instantane(d2);
        const rr = await lancer(d2, ['--ecrire', '--attendu=4', '--manifeste=garde.json'], { env: sousLot });
        // le refus se dit de deux façons : par le plan (motif nommé) ou, plus tôt, par la table qui n'est plus celle qui a été mesurée (l'API ne sert plus par cette clé ce que la mesure avait vu)
        verifier(`${nom} : exit 1, motif « ${motif} » (ou l'API ne sert plus ce que la mesure avait vu), RIEN d'écrit, base d'écriture jamais ouverte`, [rr.code, new RegExp(`${motif}|n'est plus celle qui a été mesurée`).test(rr.sorties + rr.erreurs), instantane(d2) === av, rr.ouvertures], [1, true, true, 0]);
    };
    await refus('une entrée déjà marquée partageeTamponNonSepare: TRUE (autre décision)', m => { m.cartes[0].images[0].partageeTamponNonSepare = true; }, 'entree-tampon-non-separable');
    await refus('une entrée avec une liste produitsPartages', m => { m.cartes[0].images[0].produitsPartages = [10, 11]; }, 'entree-avec-liste');
    await refus('une entrée holo/non-holo', m => { m.cartes[0].images[0].partageeHoloNonHolo = true; }, 'entree-holo-non-holo');
    await refus('une entrée à partageeTamponNonSepare: null (ni absent ni false)', m => { m.cartes[0].images[0].partageeTamponNonSepare = null; }, 'entree-etat-inattendu');
    await refus('une ligne qui porte DÉJÀ une autre variante (staff)', m => { m.cartes_produits.find(l => l.idProduct === 10).variante = 'staff'; m.cartes_produits.find(l => l.idProduct === 10).variantePreuve = 'x'; }, 'variante-contraire');
    await refus('une variante SANS preuve sur une ligne à écrire', m => { m.cartes_produits.find(l => l.idProduct === 12).variante = 'jumbo'; }, 'variante-contraire');
    await refus('la cible SANS jeton porte déjà une variante (le fail-closed ne tiendrait plus)', m => { m.cartes_produits.find(l => l.idProduct === 11).variante = 'staff'; m.cartes_produits.find(l => l.idProduct === 11).variantePreuve = 'x'; }, 'cible-sans-jeton-avec-variante');
    await refus('un produit juste SANS ligne sur la carte', m => { m.cartes_produits = m.cartes_produits.filter(l => l.idProduct !== 30); }, 'produit-sans-ligne');
    await refus('la clé d\'une entrée portée par une AUTRE carte', m => { m.cartes[1].images.push({ ...m.cartes[0].images[0] }); }, 'cle-partagee');
    await refus('l\'API sert un produit de plus par la clé (un intrus)', m => { m.cartes_produits.push({ _id: '1|13', carteId: 1, idProduct: 13, idExpansion: 100, numeroFiche: '001', slug: 'P13', slugSet: 'Set-A' }); }, 'servis-inattendus');

    console.log('4 bis. planifier(), seul : chaque garde d\'état dit SON motif (la décision de l\'API est celle de l\'état sain, pour que seule la garde testée puisse refuser)');
    const sain = monde();
    const entreesSaines = (await api.decider({ sets: sain.sets, docs: sain.cartes, lignes: sain.cartes_produits, metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false })).entrees;
    const groupesSains = V.construireGroupes({ cibles: CIBLES, servisParCle: P.produitsServisParCle(entreesSaines), api, lu: LU });
    const motifDe = modifier => { const m = monde(); modifier(m); const p = S.planifier({ cartes: m.cartes, cartesProduits: m.cartes_produits, entreesApi: entreesSaines, groupes: groupesSains, lu: LU }); return [p.refus.map(r => r.motif), p.comptes.entrees]; };
    verifier('état sain : 0 refus, 2 entrées', motifDe(() => { }), [[], 2]);
    verifier('entrée à true -> entree-tampon-non-separable (le groupe entier est refusé, l\'autre passe)', motifDe(m => { m.cartes[0].images[0].partageeTamponNonSepare = true; }), [['entree-tampon-non-separable'], 1]);
    verifier('entrée à null -> entree-etat-inattendu', motifDe(m => { m.cartes[0].images[0].partageeTamponNonSepare = null; }), [['entree-etat-inattendu'], 1]);
    verifier('entrée avec liste produitsPartages -> entree-avec-liste', motifDe(m => { m.cartes[0].images[0].produitsPartages = [10, 11]; }), [['entree-avec-liste'], 1]);
    verifier('entrée avec une liste VIDE: elle est admise (pas de liste)', motifDe(m => { m.cartes[0].images[0].produitsPartages = []; }), [[], 2]);
    verifier('entrée holo/non-holo -> entree-holo-non-holo', motifDe(m => { m.cartes[0].images[0].partageeHoloNonHolo = true; }), [['entree-holo-non-holo'], 1]);
    verifier('produit juste sans ligne -> produit-sans-ligne', motifDe(m => { m.cartes_produits = m.cartes_produits.filter(l => l.idProduct !== 30); }), [['produit-sans-ligne'], 1]);
    verifier('deux lignes pour un même produit -> ligne-ambigue', motifDe(m => { m.cartes_produits.push({ ...m.cartes_produits.find(l => l.idProduct === 30), _id: 'bis' }); }), [['ligne-ambigue'], 1]);
    verifier('variante déjà posée à une autre valeur -> variante-contraire', motifDe(m => { const l = m.cartes_produits.find(x => x.idProduct === 10); l.variante = 'staff'; l.variantePreuve = 'x'; }), [['variante-contraire'], 1]);
    verifier('variantePreuve seule (sans variante) -> variante-contraire', motifDe(m => { m.cartes_produits.find(x => x.idProduct === 30).variantePreuve = 'x'; }), [['variante-contraire'], 1]);
    verifier('variante égale mais preuve DIFFÉRENTE de celle de ce lot -> variante-contraire (jamais « déjà »)', motifDe(m => { const l = m.cartes_produits.find(x => x.idProduct === 12); l.variante = 'jumbo'; l.variantePreuve = 'une autre preuve'; }), [['variante-contraire'], 1]);
    verifier('cible sans jeton qui porte une variante -> cible-sans-jeton-avec-variante', motifDe(m => { m.cartes_produits.find(x => x.idProduct === 11).variante = 'jumbo'; }), [['cible-sans-jeton-avec-variante'], 1]);
    verifier('clé portée par une autre carte -> cle-partagee', motifDe(m => { m.cartes[1].images.push({ ...m.cartes[0].images[0] }); }), [['cle-partagee'], 1]);
    verifier('deux entrées de même (set, clé, numéro) sur la carte -> entree-ambigue', motifDe(m => { m.cartes[2].images.push({ ...m.cartes[2].images[0] }); }), [['entree-ambigue', 'entree-ambigue'].slice(0, 1), 1]);
    verifier('carte absente -> carte-absente', motifDe(m => { m.cartes = m.cartes.filter(c => c._id !== 3); }), [['carte-absente'], 1]);
    verifier('une base vide LÈVE (un vide parfait n\'est pas « rien à faire »)', (() => { try { S.planifier({ cartes: [], cartesProduits: [], entreesApi: [], groupes: groupesSains, lu: LU }); return 'ne lève pas'; } catch (e) { return /base fausse/.test(e.message) ? 'lève' : e.message; } })(), 'lève');
    verifier('l\'API sert un produit de plus par la clé -> servis-inattendus', (() => { const p = S.planifier({ cartes: sain.cartes, cartesProduits: sain.cartes_produits, entreesApi: [...entreesSaines, { idProduct: 13, grande: { cle: 'g/trio.webp' } }], groupes: groupesSains, lu: LU }); return p.refus.map(r => r.motif); })(), ['servis-inattendus']);
    verifier('motifDArret : attendu absent, faux, ou un plan qui n\'est pas la table -> un motif ; le bon plan -> null', (() => { const p = S.planifier({ cartes: sain.cartes, cartesProduits: sain.cartes_produits, entreesApi: entreesSaines, groupes: groupesSains, lu: LU }); return [S.motifDArret(p, { attendu: undefined, attenduTable: TABLE }) !== null, S.motifDArret(p, { attendu: 5, attenduTable: TABLE }) !== null, S.motifDArret(p, { attendu: 4, attenduTable: { ...TABLE, entrees: 3 } }) !== null, S.motifDArret(p, { attendu: 4, attenduTable: TABLE })]; })(), [true, true, true, null]);

    console.log('5. --attendu et la table : un compte faux n\'écrit rien');
    db = base(); avant = instantane(db);
    r = await lancer(db, ['--ecrire', '--attendu=3', '--manifeste=m.json'], { env: sousLot });
    verifier('--attendu=3 pour 4 lignes : exit 1, rien d\'écrit', [r.code, /--attendu=3 mais 4 ligne/.test(r.erreurs), instantane(db) === avant, r.ouvertures], [1, true, true, 0]);
    r = await lancer(db, ['--ecrire', '--attendu=4', '--manifeste=m.json'], { env: sousLot, lectures: null });
    const dbT = base(); avant = instantane(dbT);
    const rT = await (async () => { const sorties = [], erreurs = []; const c = await executer({ argv: ['--ecrire', '--attendu=4', '--manifeste=m.json', `--sortie=${tmp}`], env: sousLot, ppid: 4242, cibles: CIBLES, lu: LU, attenduTable: { ...TABLE, jetons: 3 }, minEntrees: 3, chargerApi: async () => api, lireEtat: async () => ({ sets: monde().sets, cartes: dbT.brut('cartes'), cartesProduits: dbT.brut('cartes_produits') }), ouvrirEcriture: async () => ({ db: dbT, fermer: dbT.fermer }), ecrireFichier: (p, c) => fs.writeFileSync(p, c), lireFichier: p => fs.readFileSync(p, 'utf8'), contrat: GC, garde: GL, log: s => sorties.push(s), err: s => erreurs.push(s) }); return { c, erreurs: erreurs.join('\n') }; })();
    verifier('une table qui n\'est plus celle accordée (3 jetons attendus pour 2) : exit 1, « la table n\'est plus celle », rien d\'écrit', [rT.c, /table n'est plus celle qui a été accordée/.test(rT.erreurs), instantane(dbT) === avant], [1, true, true]);

    console.log('6. L\'ÉCRITURE (sous lot-additif) : lignes d\'abord, entrées ensuite, manifeste AVANT, relecture par un client OUVERT');
    db = base(); const lecturesFermees = [];
    r = await lancer(db, ['--ecrire', '--attendu=4', '--manifeste=ecrit.json'], { env: sousLot, lectures: lecturesFermees });
    verifier('exit 0, base d\'écriture ouverte une fois', [r.code, r.ouvertures], [0, 1]);
    verifier('variantes posées : 10 et 30 « normale », 12 « jumbo », 31 « toys-r-us » ; 11 (aucun jeton) INTOUCHÉE ; 20 intouchée', variantes(db), { 10: 'normale', 12: 'jumbo', 30: 'normale', 31: 'toys-r-us' });
    verifier('chaque ligne écrite porte sa variantePreuve lisible (≥ 120 caractères, la date, « oeil »)', db.brut('cartes_produits').filter(l => l.variante).every(l => l.variantePreuve.length > 120 && /2026-10-24/.test(l.variantePreuve) && /oeil/.test(l.variantePreuve)), true);
    verifier('les 2 entrées concernées portent partageeTamponNonSepare: false, l\'entrée de la carte 2 non', entreesFausses(db).sort(), ['1:g/trio.webp', '3:g/duo.webp']);
    verifier('rien d\'autre n\'a bougé : les documents hors variante / partageeTamponNonSepare sont identiques', (() => { const nettoie = d => { const c = structuredClone(d); for (const x of c.cartes) for (const m of x.images) delete m.partageeTamponNonSepare; for (const l of c.cartes_produits) { delete l.variante; delete l.variantePreuve; } return JSON.stringify(c); }; return nettoie({ cartes: db.brut('cartes'), cartes_produits: db.brut('cartes_produits') }) === nettoie({ cartes: base().brut('cartes'), cartes_produits: base().brut('cartes_produits') }); })(), true);
    verifier('le manifeste existe, liste 2 entrées et 4 lignes, chacune avec son « avant » (absent) et ce qui est écrit', (() => { const m = JSON.parse(fs.readFileSync(path.join(tmp, 'ecrit.json'), 'utf8')); return [m.lot, m.entrees.length, m.lignes.length, m.lignes.every(l => l.avant === 'absent' && l.ecrit.variante && l.ecrit.variantePreuve)]; })(), [S.LOT, 2, 4, true]);
    verifier('RELECTURE par un client OUVERT : exit 0, « RELECTURE : ✅ 2/2 entrées et 4/4 lignes », aucune lecture n\'a touché la connexion d\'écriture fermée', [/RELECTURE : ✅ 2\/2 entrées et 4\/4 lignes/.test(r.sorties), r.nLectures, db.etat.fermee], [true, 2, true]);
    verifier('le compte écrit : 4 lignes + 2 entrées = 6 écritures', db.etat.ecritures, 6);

    // le manifeste est écrit AVANT la première écriture en base
    db = base(); const momentManifeste = [];
    {
        const sorties = []; const cc = await executer({ argv: ['--ecrire', '--attendu=4', '--manifeste=avant.json', `--sortie=${tmp}`], env: sousLot, ppid: 4242, cibles: CIBLES, lu: LU, attenduTable: TABLE, minEntrees: 3, chargerApi: async () => api,
            lireEtat: async () => ({ sets: monde().sets, cartes: db.brut('cartes'), cartesProduits: db.brut('cartes_produits') }), ouvrirEcriture: async () => ({ db, fermer: db.fermer }),
            ecrireFichier: (p, c) => { momentManifeste.push(db.etat.ecritures); fs.writeFileSync(p, c); }, lireFichier: p => fs.readFileSync(p, 'utf8'), contrat: GC, garde: GL, log: s => sorties.push(s), err: s => sorties.push(s) });
        verifier('le manifeste est écrit AVANT la première écriture en base (0 écriture au moment où il est déposé)', [cc, momentManifeste], [0, [0]]);
    }
    // une écriture qui ment (« modifiée » sans rien faire) : la relecture le voit
    {
        const m = monde(); db = fausseBase({ cartes: m.cartes, cartes_produits: m.cartes_produits }, { mentirSurCartes: true });
        r = await lancer(db, ['--ecrire', '--attendu=4', '--manifeste=ment.json'], { env: sousLot });
        verifier('une écriture d\'entrées qui ment : la RELECTURE dit 🔴 0/2 entrées et le code de sortie est 1', [r.code, /RELECTURE : 🔴 0\/2 entrées et 4\/4 lignes/.test(r.sorties)], [1, true]);
    }

    console.log('7. IDEMPOTENCE : relancée sur l\'état écrit, rien à écrire, tout est relu');
    db = base(); await lancer(db, ['--ecrire', '--attendu=4', '--manifeste=ecrit2.json'], { env: sousLot });
    const apresEcriture = instantane(db); db.etat.fermee = false; db.etat.ecritures = 0;
    r = await lancer(db, ['--ecrire', '--attendu=4', '--manifeste=ecrit.json'], { env: sousLot });
    verifier('exit 0, « rien à écrire », base inchangée, zéro écriture, la base d\'écriture n\'est pas ouverte', [r.code, /rien à écrire/.test(r.sorties), instantane(db) === apresEcriture, db.etat.ecritures, r.ouvertures], [0, true, true, 0, 0]);
    verifier('le plan voit tout « déjà » (2 entrées, 4 lignes)', /2 entrées à marquer \(déjà : 2\) · 4 lignes à écrire = 2 justes « normale » \+ 2 cibles à jeton \(déjà : 4\)/.test(r.sorties), true);

    console.log('8. REPRISE après une écriture interrompue entre les lignes et les entrées (les lignes d\'abord)');
    db = base(); const m0 = { cartes: db.brut('cartes'), cartes_produits: db.brut('cartes_produits') };
    // état simulé d'un arrêt : les 4 lignes écrites, aucune entrée
    const cible = { 10: 'normale', 30: 'normale', 12: 'jumbo', 31: 'toys-r-us' };
    const tt = S.tableDesEcritures(V.construireGroupes({ cibles: CIBLES, servisParCle: null, api, lu: LU, verifierServis: false }), LU);
    for (const l of m0.cartes_produits) { const w = tt.lignes.find(x => x.idProduct === l.idProduct && x.carteId === l.carteId); if (w) { l.variante = w.cible; l.variantePreuve = w.preuve; } }
    db = fausseBase(m0);
    r = await lancer(db, ['--ecrire', '--attendu=4', '--manifeste=reprise.json'], { env: sousLot });
    verifier('reprise : exit 0, seules les 2 entrées sont écrites (2 écritures), les lignes ne sont pas réécrites', [r.code, db.etat.ecritures, entreesFausses(db).sort(), /RELECTURE : ✅/.test(r.sorties)], [0, 2, ['1:g/trio.webp', '3:g/duo.webp'], true]);
    verifier('   et l\'état final est identique à celui d\'une écriture complète', JSON.stringify(variantes(db)), JSON.stringify(cible));

    console.log('9. LE MANIFESTE ET LE RETRAIT EXACT');
    // état écrit complet
    const ecrit = async () => { const d = base(); const rr = await lancer(d, ['--ecrire', '--attendu=4', '--manifeste=man.json'], { env: sousLot }); d.etat.fermee = false; d.etat.ecritures = 0; return { d, rr }; };
    let { d: dr } = await ecrit(); const avantRetrait = instantane(dr);
    r = await lancer(dr, ['--retirer', '--manifeste=man.json']);
    verifier('--retirer SANS --ecrire = simulation : exit 0, « 6 opérations », rien d\'écrit', [r.code, /simulation du retrait — 6 opérations/.test(r.sorties), instantane(dr) === avantRetrait, r.ouvertures], [0, true, true, 0]);
    r = await lancer(dr, ['--retirer', '--ecrire', '--attendu=3', '--manifeste=man.json'], { env: sousLot });
    verifier('--retirer --ecrire avec un --attendu faux (3 pour 4 lignes du manifeste) : exit 1, rien retiré', [r.code, instantane(dr) === avantRetrait], [1, true]);
    r = await lancer(dr, ['--retirer', '--ecrire', '--attendu=4', '--manifeste=man.json'], { env: sousLot });
    verifier('--retirer --ecrire --attendu=4 : exit 0, « retiré : 6/6 »', [r.code, /retiré : 6\/6/.test(r.sorties)], [0, true]);
    verifier('   la base est REVENUE à l\'état d\'avant, à l\'octet près (aucune variante, aucune entrée marquée)', [JSON.stringify(dr.brut('cartes')) === JSON.stringify(base().brut('cartes')), JSON.stringify(dr.brut('cartes_produits')) === JSON.stringify(base().brut('cartes_produits'))], [true, true]);
    verifier('   RELECTURE du retrait : ✅ 0 entrée et 0 ligne portent encore l\'état écrit', /RELECTURE : ✅ 0 entrée\(s\) et 0 ligne\(s\) portent encore l'état écrit/.test(r.sorties), true);
    // le retrait n'efface pas ce qu'il n'a pas écrit
    ({ d: dr } = await ecrit());
    dr.brut; const cs = dr.brut('cartes'), ls = dr.brut('cartes_produits');
    ls.find(l => l.idProduct === 12).variantePreuve = 'preuve REMPLACÉE par un autre outil';
    const dm = fausseBase({ cartes: cs, cartes_produits: ls }); const avM = instantane(dm);
    r = await lancer(dm, ['--retirer', '--ecrire', '--attendu=4', '--manifeste=man.json'], { env: sousLot });
    verifier('une ligne dont la preuve a été remplacée depuis : le retrait REFUSE (exit 1, rien retiré) et nomme la ligne', [r.code, /ligne 1\|12 : n'est pas dans l'état écrit par ce lot/.test(r.sorties), instantane(dm) === avM], [1, true, true]);
    ({ d: dr } = await ecrit());
    const cs2 = dr.brut('cartes'); cs2[1].images[0].partageeTamponNonSepare = false;   // la carte 2 (hors lot) est « séparée » par un autre : le retrait ne la touche pas
    const d2 = fausseBase({ cartes: cs2, cartes_produits: dr.brut('cartes_produits') });
    r = await lancer(d2, ['--retirer', '--ecrire', '--attendu=4', '--manifeste=man.json'], { env: sousLot });
    verifier('une entrée HORS lot marquée par un autre outil n\'est PAS retirée (retrait exact)', [r.code, d2.brut('cartes')[1].images[0].partageeTamponNonSepare], [0, false]);
    // un manifeste falsifié
    ({ d: dr } = await ecrit());
    const mf = JSON.parse(fs.readFileSync(path.join(tmp, 'man.json'), 'utf8'));
    fs.writeFileSync(path.join(tmp, 'faux.json'), JSON.stringify({ ...mf, lignes: [...mf.lignes, { _id: '2|20', carteId: 2, idProduct: 20, role: 'juste', avant: 'absent', ecrit: { variante: 'normale', variantePreuve: 'x' } }] }));
    fs.writeFileSync(path.join(tmp, 'faux2.json'), JSON.stringify({ ...mf, lignes: mf.lignes.map(l => (l.idProduct === 12 ? { ...l, ecrit: { ...l.ecrit, variantePreuve: 'autre texte' } } : l)) }));
    fs.writeFileSync(path.join(tmp, 'faux3.json'), JSON.stringify({ ...mf, lot: 'autre-lot' }));
    for (const f of ['faux', 'faux2', 'faux3']) {
        const av = instantane(dr);
        r = await lancer(dr, ['--retirer', '--ecrire', '--attendu=4', `--manifeste=${f}.json`], { env: sousLot });
        verifier(`manifeste falsifié (${f}) : refusé (exception « manifeste »), rien retiré`, [r.code, /manifeste/.test(r.erreurs), instantane(dr) === av], [99, true, true]);
    }

    console.log('10. LES FILTRES D\'ÉCRITURE portent l\'état d\'avant (une cible déjà modifiée par un autre ne correspond plus)');
    const planA = S.planifier({ cartes: monde().cartes, cartesProduits: monde().cartes_produits, entreesApi: (await api.decider({ sets: monde().sets, docs: monde().cartes, lignes: monde().cartes_produits, metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false })).entrees, groupes: V.construireGroupes({ cibles: CIBLES, servisParCle: null, api, lu: LU, verifierServis: false }), lu: LU });
    const ops = S.operationsEcriture(planA);
    verifier('6 opérations : 4 lignes d\'abord, 2 entrées ensuite', ops.map(o => o.coll), ['cartes_produits', 'cartes_produits', 'cartes_produits', 'cartes_produits', 'cartes', 'cartes']);
    verifier('chaque ligne exige variante ET variantePreuve ABSENTES ; chaque entrée exige partageeTamponNonSepare et produitsPartages ABSENTS', [ops.slice(0, 4).every(o => o.filter.variante.$exists === false && o.filter.variantePreuve.$exists === false), ops.slice(4).every(o => o.filter.images.$elemMatch.partageeTamponNonSepare.$exists === false && o.filter.images.$elemMatch.produitsPartages.$exists === false)], [true, true]);
    verifier('executerOperations : un --attendu qui n\'est pas le nombre d\'opérations lève avant toute écriture', await (async () => { const d = base(); try { await S.executerOperations(d, ops, { attendu: 5, quoi: 'x' }); return 'ne lève pas'; } catch (e) { return [/attendu 5/.test(e.message), d.etat.ecritures]; } })(), [true, 0]);
    verifier('executerOperations : une cible déjà modifiée par un autre (variante posée) lève AVANT la première écriture', await (async () => { const m = monde(); m.cartes_produits.find(l => l.idProduct === 31).variante = 'staff'; const d = fausseBase({ cartes: m.cartes, cartes_produits: m.cartes_produits }); try { await S.executerOperations(d, ops, { attendu: 6, quoi: 'x' }); return 'ne lève pas'; } catch (e) { return [/0 document\(s\) correspondent/.test(e.message), d.etat.ecritures]; } })(), [true, 0]);

    console.log('10 bis. les arrêts de la simulation : un verdict ou un contrat qui crie n\'écrit RIEN');
    {
        db = base(); avant = instantane(db);
        let appels = 0;
        const apiTronquee = { ...api, decider: async a => { const rr = await api.decider(a); appels++; if (appels === 2) rr.entrees = rr.entrees.filter(e => e.idProduct !== 10); return rr; } };   // la 2e décision (la simulation) perd le juste 10
        const sorties = [], erreurs = [];
        const cc = await executer({ argv: ['--ecrire', '--attendu=4', '--manifeste=v.json', `--sortie=${tmp}`], env: sousLot, ppid: 4242, cibles: CIBLES, lu: LU, attenduTable: TABLE, minEntrees: 3, chargerApi: async () => apiTronquee, lireEtat: async () => ({ sets: monde().sets, cartes: db.brut('cartes'), cartesProduits: db.brut('cartes_produits') }),
            ouvrirEcriture: async () => { throw new Error('ne doit pas être ouverte'); }, ecrireFichier: (p, c) => fs.writeFileSync(p, c), lireFichier: p => fs.readFileSync(p, 'utf8'), contrat: GC, garde: GL, log: s => sorties.push(s), err: s => erreurs.push(s) });
        verifier('un juste perdu dans la simulation de l\'API : VERDICT 🔴, exit 1, la base d\'écriture n\'est pas ouverte, rien d\'écrit', [cc, /VERDICT : 🔴 ÉCART : justes perdus 10/.test(sorties.join('\n')), instantane(db) === avant], [1, true, true]);
        const contratQuiCrie = { verifierContrat: async () => ({ nouveaux: [{ idProduct: 12, motif: 'refus simulé' }], persistants: [], slugs: [] }), ligneContrat: () => 'contrat (stub)' };
        const s2 = [], e2 = [];
        const c2 = await executer({ argv: ['--ecrire', '--attendu=4', '--manifeste=v.json', `--sortie=${tmp}`], env: sousLot, ppid: 4242, cibles: CIBLES, lu: LU, attenduTable: TABLE, minEntrees: 3, chargerApi: async () => api, lireEtat: async () => ({ sets: monde().sets, cartes: db.brut('cartes'), cartesProduits: db.brut('cartes_produits') }),
            ouvrirEcriture: async () => { throw new Error('ne doit pas être ouverte'); }, ecrireFichier: (p, c) => fs.writeFileSync(p, c), lireFichier: p => fs.readFileSync(p, 'utf8'), contrat: contratQuiCrie, garde: GL, log: s => s2.push(s), err: s => e2.push(s) });
        verifier('un refus NOUVEAU du contrat de l\'API : exit 1, rien d\'écrit, la base d\'écriture n\'est pas ouverte', [c2, /1 refus nouveau/.test(s2.join('\n')), instantane(db) === avant], [1, true, true]);
    }
    verifier('motifDArret : un plan qui porte un refus s\'arrête même si les autres comptes sont ceux de la table', (() => { const p = { comptes: { refus: 1, entrees: 2, justes: 2, jetons: 2, sansJeton: 1, lignes: 4 } }; return /1 groupe\(s\) refusé/.test(S.motifDArret(p, { attendu: 4, attenduTable: TABLE }) ?? ''); })(), true);
    verifier('executerOperations : une écriture qui dit « 0 modifié » est une écriture PARTIELLE (lève, nommée)', await (async () => { const stub = { collection: () => ({ countDocuments: async () => 1, updateOne: async () => ({ modifiedCount: 0 }) }) }; try { await S.executerOperations(stub, [{ coll: 'cartes', filter: {}, update: {} }], { attendu: 1, quoi: 'x' }); return 'ne lève pas'; } catch (e) { return /PARTIELLE/.test(e.message) ? 'lève' : e.message; } })(), 'lève');
    verifier('V.construireGroupes : une cible non lue à l\'oeil (absente de la table LU) LÈVE', (() => { try { V.construireGroupes({ cibles: CIBLES, servisParCle: null, api, lu: new Map([[12, LU.get(12)]]), verifierServis: false }); return 'ne lève pas'; } catch (e) { return /n'a pas été lue à l'oeil/.test(e.message) ? 'lève' : e.message; } })(), 'lève');
    {   // les filtres du RETRAIT portent l'état ÉCRIT : une ligne dont la preuve a changé, une entrée repassée à autre chose, ne correspondent plus (la fenêtre entre la vérification et l'écriture)
        const grp = V.construireGroupes({ cibles: CIBLES, servisParCle: null, api, lu: LU, verifierServis: false });
        const mf2 = S.manifeste({ entrees: S.tableDesEcritures(grp, LU).entrees.map(x => ({ ...x, deja: false })), lignes: S.tableDesEcritures(grp, LU).lignes.map(l => ({ ...l, _id: `${l.carteId}|${l.idProduct}`, deja: false })), comptes: {} });
        const ecritM = base(); const mm = { cartes: ecritM.brut('cartes'), cartes_produits: ecritM.brut('cartes_produits') };
        for (const l of mm.cartes_produits) { const w = mf2.lignes.find(x => x._id === l._id); if (w) { l.variante = w.ecrit.variante; l.variantePreuve = w.ecrit.variantePreuve; } }
        for (const e of mf2.entrees) mm.cartes.find(c => c._id === e.carteId).images.find(i => i.cleR2 === e.cleR2).partageeTamponNonSepare = false;
        const opsR = S.operationsRetrait(mf2);
        verifier('retrait : sur l\'état écrit, chaque opération correspond à UN document', await (async () => { const d = fausseBase(mm); const n = []; for (const o of opsR) n.push(await d.collection(o.coll).countDocuments(o.filter)); return n; })(), [1, 1, 1, 1, 1, 1]);
        const mm2 = structuredClone(mm); mm2.cartes_produits.find(l => l.idProduct === 12).variantePreuve = 'autre';
        verifier('retrait : la preuve d\'une ligne a changé -> l\'opération de CETTE ligne ne correspond plus (0)', await (async () => { const d = fausseBase(mm2); const n = []; for (const o of opsR.filter(o => o.coll === 'cartes_produits')) n.push(await d.collection(o.coll).countDocuments(o.filter)); return n; })(), [1, 0, 1, 1]);
        const mm3 = structuredClone(mm); delete mm3.cartes[0].images[0].partageeTamponNonSepare;
        verifier('retrait : une entrée qui n\'est plus à false -> l\'opération de CETTE entrée ne correspond plus (0)', await (async () => { const d = fausseBase(mm3); const n = []; for (const o of opsR.filter(o => o.coll === 'cartes')) n.push(await d.collection(o.coll).countDocuments(o.filter)); return n; })(), [0, 1]);
    }

    console.log('11. verdictApi, seul : jugé contre CE QUI A ÉTÉ ACCORDÉ');
    const { verdictApi } = require(path.join(DIR, 'separer-variantes-phase2'));
    const gv = [{ carteId: 1, justes: [10], cibles: [{ idProduct: 11, jeton: null }, { idProduct: 12, jeton: 'jumbo' }] }];
    const ent = (id, o = {}) => ({ idProduct: id, grande: { cle: 'g/trio.webp' }, vignette: { cle: 'v/trio.webp' }, visuel: 'v', variante: null, ...o });
    const AV = { entrees: [ent(10), ent(11), ent(12)] };
    verifier('accordé : 10 normale, 12 jumbo servis, 11 sorti -> ok', verdictApi({ avant: AV, apres: { entrees: [ent(10, { variante: 'normale' }), ent(12, { variante: 'jumbo' })] }, groupes: gv }).ok, true);
    verifier('la cible SANS jeton (11) encore servie -> pas ok, nommée', (() => { const v = verdictApi({ avant: AV, apres: { entrees: [ent(10, { variante: 'normale' }), ent(11), ent(12, { variante: 'jumbo' })] }, groupes: gv }); return [v.ok, v.raisons.some(x => /sans jeton encore servies : 11/.test(x))]; })(), [false, true]);
    verifier('un juste perdu -> pas ok', verdictApi({ avant: AV, apres: { entrees: [ent(12, { variante: 'jumbo' })] }, groupes: gv }).ok, false);
    verifier('la cible à jeton non servie -> pas ok', verdictApi({ avant: AV, apres: { entrees: [ent(10, { variante: 'normale' })] }, groupes: gv }).ok, false);
    verifier('la cible à jeton servie avec une autre variante -> pas ok', verdictApi({ avant: AV, apres: { entrees: [ent(10, { variante: 'normale' }), ent(12, { variante: 'staff' })] }, groupes: gv }).ok, false);
    verifier('un AUTRE produit perdu (99) -> pas ok', verdictApi({ avant: { entrees: [...AV.entrees, ent(99, { grande: { cle: 'g/x.webp' } })] }, apres: { entrees: [ent(10, { variante: 'normale' }), ent(12, { variante: 'jumbo' })] }, groupes: gv }).ok, false);
    verifier('un produit GAGNÉ (98) -> pas ok', verdictApi({ avant: AV, apres: { entrees: [ent(10, { variante: 'normale' }), ent(12, { variante: 'jumbo' }), ent(98, { grande: { cle: 'g/y.webp' } })] }, groupes: gv }).ok, false);
    verifier('le juste change de FICHIER -> pas ok', verdictApi({ avant: AV, apres: { entrees: [ent(10, { variante: 'normale', grande: { cle: 'g/autre.webp' } }), ent(12, { variante: 'jumbo' })] }, groupes: gv }).ok, false);

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
