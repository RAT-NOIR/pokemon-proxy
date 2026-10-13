'use strict';
// ETIQUETAGE-B — l'export LECTURE SEULE du banc de l'administrateur vers l'outil de mesure, et la lecture de cet export par `mesurer-identification.js` (base « Gemini seul »).
// Base : la base EN MÉMOIRE du banc. Stockage : la mémoire. Dossiers : UN dossier temporaire du système, par test. Aucun réseau, aucune base réelle.
const H = require('./_harnais');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db'); const M = require('../modeles');
const S = require('../banc/stockage');
const { reponseDOrigine } = require('../banc/etiquette-ligne');
const X = require('../mesures/exporter-banc-admin');
const MI = require('../mesures/mesurer-identification');

const cle = () => S.nouvelleCle(false);
const code = async f => { try { await f(); return null; } catch (e) { return e && e.code ? e.code : String(e && e.message).slice(0, 60); } };

(async () => {
    await H.ouvrirBac('test-exporter-banc-admin.js'); await M.creerIndex();
    const mem = S.creerStockageMemoire();
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'export-banc-'));
    const sortie = n => path.join(racine, n);
    const ligne = (id, o) => ({ _id: id.padEnd(64, '0'), source: 'etiquette-admin', etat: 'confirmee', rev: 1, versionModele: 'gemini-x', versionChaine: 'abc123def456', le: new Date(Date.UTC(2026, 9, 13)), expireLe: new Date(Date.UTC(2028, 9, 13)), ...o });
    const rep = (statut, idProduct = null, choix = [], code = null) => reponseDOrigine({ statut, idProduct, question: choix.length ? { code, choix: choix.map(i => ({ id: 'x', idProduct: i })) } : null });
    const photos = {};
    const nouvelle = async (nom, couleur) => { const c = cle(); const b = await require('sharp')({ create: { width: 40, height: 60, channels: 3, background: couleur } }).webp().toBuffer(); await mem.ecrire(c, b); photos[nom] = { c, b }; return c; };
    const cA = await nouvelle('A', { r: 255, g: 0, b: 0 }), cB = await nouvelle('B', { r: 0, g: 255, b: 0 }), cC = await nouvelle('C', { r: 0, g: 0, b: 255 });
    const orpheline = cle();                                                       // une clé dont l'objet n'existe pas
    const L = [
        ligne('a1', { cleR2: cA, verite: 100, sha256: 'ab'.repeat(32), reponse: rep('identifiee', 100) }),    // affirmée juste
        ligne('a2', { cleR2: cA, verite: 101, reponse: rep('identifiee', 100) }),                              // affirmée FAUSSE (autre produit), même photo
        ligne('a3', { cleR2: cB, verite: null, aucune: 'pas-une-carte', reponse: rep('identifiee', 100) }),   // affirmée FAUSSE (la vérité est « aucune »)
        ligne('a4', { cleR2: cB, verite: 7, reponse: rep('identifiee', 7) }),                                  // affirmée juste
        ligne('q1', { cleR2: cC, verite: 200, reponse: rep('a-trancher', null, [200, 201], 'departage') }),   // question qui contient la vérité
        ligne('q2', { cleR2: cC, verite: 300, reponse: rep('a-trancher', null, [200, 201], 'departage') }),   // question qui ne la contient pas
        ligne('i1', { cleR2: cC, verite: null, aucune: 'hors-catalogue', reponse: rep('introuvable') }),       // introuvable, vérité « aucune »
        ligne('i2', { cleR2: cC, verite: 400, reponse: rep('introuvable') }),                                  // introuvable alors qu'une vérité existe
        ligne('z1', { cleR2: orpheline, verite: 1, reponse: rep('identifiee', 1) }),                           // l'objet a disparu
        ligne('n1', { cleR2: cA, verite: 100, source: 'affirme', versionTexte: 'v1', jetonEmpreinte: 'x'.repeat(64) }),   // PAS une ligne d'étiquette : jamais exportée
        { _id: 'e'.repeat(64), source: 'etiquette-admin', etat: 'attente', cleR2: cA, verite: null },                       // pas confirmée : jamais exportée
        { ...ligne('m1', { cleR2: cB, verite: 7, reponse: rep('identifiee', 7) }), _id: 'f'.repeat(32), anonyme: true, le: undefined }   // copie anonyme : exportée
    ];
    delete L[L.length - 1].le;
    await db.col('banc_lignes').insertMany(L);
    const colLecture = n => db.col(n);

    // ═══ 1. l'export : les fichiers attendus, rien d'autre ═══
    {
        const dossier = sortie('ok');
        const bilan = await X.exporterBancAdmin({ dossier, colFn: colLecture, stockage: { lire: c => mem.lire(c) }, base: 'essai_lecture' });
        const man = JSON.parse(fs.readFileSync(path.join(dossier, 'manifeste.json'), 'utf8'));
        const lignes = JSON.parse(fs.readFileSync(path.join(dossier, 'lignes.json'), 'utf8'));
        H.v('1. bilan : 10 lignes d\'étiquette confirmées (dont la copie anonyme), 3 photos distinctes, 1 ligne sans photo', [bilan.lignes, bilan.photos, bilan.sansPhoto], [10, 3, 1]);
        H.v('1. manifeste : format, base, dénominateurs', [man.format, man.base, man.lignes, man.sansPhoto], ['banc-admin-v1', 'essai_lecture', 10, 1]);
        H.v('1. tour 1 : l\'empreinte de la photo (sha256) est exportée avec la ligne ; aucune étiquette en attente dans cette base', [lignes.find(l => l.verite === 100 && l.photo).sha256, man.etiquettesEnAttente], ['ab'.repeat(32), 0]);
        H.v('1. le dossier ne contient que manifeste.json, lignes.json et photos/', fs.readdirSync(dossier).sort(), ['lignes.json', 'manifeste.json', 'photos']);
        H.v('1. trois photos distinctes, nommées par la clé de l\'objet, octets identiques à ceux du bucket', fs.readdirSync(path.join(dossier, 'photos')).sort(), Object.values(photos).map(p => path.basename(p.c)).sort());
        H.vrai('1. les octets exportés sont ceux du bucket', Object.values(photos).every(p => Buffer.compare(fs.readFileSync(path.join(dossier, 'photos', path.basename(p.c))), p.b) === 0));
        const a2 = lignes.find(l => l.verite === 101);
        H.v('1. une ligne exportée : vérité, statut affirmé, réponse d\'origine, photo relative', [a2.verite, a2.statut, a2.reponse.idProduct, a2.photo === `photos/${path.basename(cA)}`], [101, 'affirmee', 100, true]);
        H.v('1. statuts : 6 affirmées, 2 questions, 2 introuvables', [lignes.filter(l => l.statut === 'affirmee').length, lignes.filter(l => l.statut === 'question').length, lignes.filter(l => l.statut === 'introuvable').length], [6, 2, 2]);
        H.v('1. la ligne dont l\'objet a disparu est exportée SANS photo (null) et comptée', [lignes.find(l => l.verite === 1).photo, man.sansPhoto], [null, 1]);
        H.vrai('1. aucune donnée de compte : ni scanId, ni jeton, ni URL dans les fichiers', !/jetonEmpreinte|scanId|http|compte/.test(JSON.stringify(lignes)));
        H.vrai('1. la copie anonyme est exportée (anonyme: true) ; la ligne « affirme » et la ligne en attente ne le sont pas', lignes.some(l => l.anonyme === true) && !lignes.some(l => l.id === 'n1'.padEnd(64, '0')) && lignes.length === 10);
    }

    // ═══ 2. la mesure lit l'export : la base « Gemini seul » ═══
    {
        const e = MI.lireExportBancAdmin(sortie('ok'));
        const m = MI.mesurerGeminiSeul(e.lignes);
        H.v('2. lecture : 10 lignes', e.lignes.length, 10);
        H.v('2. affirmées : 6 dont 4 justes et 2 fausses (la vérité « aucune » compte faux)', [m.affirmees.n, m.affirmees.justes, m.affirmees.fausses], [6, 4, 2]);
        H.v('2. questions : 2, dont 1 contient la vérité', [m.questions.n, m.questions.contiennentLaVerite], [2, 1]);
        H.v('2. introuvables : 2, dont 1 à bon droit (vérité « aucune »), 1 manqué', [m.introuvables.n, m.introuvables.aBonDroit, m.introuvables.manques], [2, 1, 1]);
        H.v('2. dénominateur imprimé : 10 lignes ; affirmée juste ou question qui contient la vérité : 5/10', [m.n, m.justesOuQuestionJuste], [10, 5]);
        const w = (k, n) => MI.wilson(k, n);
        H.v('2. Wilson sur les affirmées justes (4/6) et sur les faux affirmés (2/10)', [m.affirmees.wilsonJustes, m.fauxAffirmes.wilson], [w(4, 6), w(2, 10)]);
        H.v('2. faux affirmés : 2 sur 10 lignes', [m.fauxAffirmes.n, m.fauxAffirmes.sur], [2, 10]);
        H.v('2. Wilson sur les questions qui contiennent la vérité (1/2) et sur « juste ou question juste » (5/10)', [m.questions.wilsonContiennent, m.wilsonJustesOuQuestionJuste], [w(1, 2), w(5, 10)]);
        // un export mal formé est refusé
        const mauvais = sortie('mauvais'); fs.mkdirSync(mauvais); fs.writeFileSync(path.join(mauvais, 'manifeste.json'), JSON.stringify({ format: 'autre' }));
        H.v('2. un export d\'un autre format est refusé', await code(async () => MI.lireExportBancAdmin(mauvais)), 'FORMAT');
        H.v('2. un dossier sans export est refusé', await code(async () => MI.lireExportBancAdmin(sortie('inexistant'))), 'FORMAT');
        // une ligne dont la photo manque dans le dossier : refusée (l'outil de mesure ne devine pas)
        const cass = sortie('cass'); fs.cpSync(sortie('ok'), cass, { recursive: true }); fs.unlinkSync(path.join(cass, 'photos', path.basename(cA)));
        H.v('2. une photo nommée par une ligne mais absente du dossier : refusée', await code(async () => MI.lireExportBancAdmin(cass)), 'EXPORT-INCOMPLET');
    }

    // ═══ 3. LECTURE SEULE : aucune écriture en base, aucune écriture au bucket ═══
    {
        const avant = JSON.stringify(await db.col('banc_lignes').find({}).sort({ _id: 1 }).toArray());
        const ecritures = [];
        const espion = n => new Proxy(db.col(n), { get(c, p) { const v = c[p]; if (typeof v !== 'function') return v; if (/^(insert|update|delete|replace|drop|create|bulk|findOneAnd|rename|remove|save)/i.test(String(p))) return () => { ecritures.push(`${n}.${String(p)}`); throw new Error('ÉCRITURE INTERDITE'); }; return v.bind(c); } });
        const bucket = { lire: c => mem.lire(c), ecrire: () => { ecritures.push('bucket.ecrire'); throw new Error('ÉCRITURE INTERDITE'); }, supprimer: () => { ecritures.push('bucket.supprimer'); throw new Error('ÉCRITURE INTERDITE'); } };
        await X.exporterBancAdmin({ dossier: sortie('lecture'), colFn: espion, stockage: bucket, base: 'essai_lecture' });
        H.v('3. l\'export n\'appelle aucune méthode d\'écriture (base, bucket) et la collection est inchangée', [ecritures, JSON.stringify(await db.col('banc_lignes').find({}).sort({ _id: 1 }).toArray()) === avant], [[], true]);
        // le stockage reçu n'est lu que par `lire` : un objet sans `ecrire` suffit
        H.v('3. un stockage qui n\'a QUE `lire` suffit', await code(() => X.exporterBancAdmin({ dossier: sortie('lecture2'), colFn: colLecture, stockage: { lire: c => mem.lire(c) }, base: 'essai_lecture' })), null);
    }

    // ═══ 4. les refus : la base de production, les dossiers d'apports, tout dossier qui n'est pas le sien ═══
    {
        const base = { colFn: colLecture, stockage: { lire: c => mem.lire(c) }, base: 'essai_lecture' };
        H.v('4. la base de production `test` est refusée', await code(() => X.exporterBancAdmin({ ...base, base: 'test', dossier: sortie('p1') })), 'BASE-REFUSEE');
        H.v('4. une base absente, vide ou non textuelle est refusée', [await code(() => X.exporterBancAdmin({ ...base, base: '', dossier: sortie('p2') })), await code(() => X.exporterBancAdmin({ ...base, base: undefined, dossier: sortie('p3') }))], ['BASE-REFUSEE', 'BASE-REFUSEE']);
        // 🔴 JAMAIS un vrai dossier d'apports : les chemins ci-dessous sont des DOUBLES sous le dossier temporaire de ce banc (la garde juge des SEGMENTS de chemin, pas l'existence du dossier), et leurs noms
        // sont assemblés à l'exécution. Un défaut de la garde ne peut donc écrire que dans le dossier temporaire du système (jamais chez le testeur).
        const LF = ['Logo', 'FR'].join(' '), AM = ['apport', 'manuel'].join('-'), LG = 'LO' + 'GO', JP = ['Logo', 'JP'].join(' '), ZH = ['Logo', 'ZH'].join(' ');
        const faux = (...s) => path.join(racine, 'faux-bureau', ...s);
        for (const [nom, d] of [[LF, faux('pokemon-proxy', LF, 'export')], [AM, faux('pokemon-proxy', AM)], [LG, faux('Desktop', LG, 'x')], [`${LF} en minuscules`, faux(LF.toLowerCase(), 'x')], [JP, faux('z', JP)], [ZH, faux('z', ZH, 'a')], [['verrou', 'photos'].join(' + '), faux('api', 'verrou', 'photos', 'x')]])
            H.v(`4. dossier d'apports « ${nom} » refusé, rien créé`, [await code(() => X.exporterBancAdmin({ ...base, dossier: d })), fs.existsSync(d)], ['DOSSIER-REFUSE', false]);
        H.vrai('4. et le dossier temporaire des doubles n\'a rien reçu', !fs.existsSync(faux()));
        H.v('4. dossier relatif, vide, non textuel : refusés', [await code(() => X.exporterBancAdmin({ ...base, dossier: 'export' })), await code(() => X.exporterBancAdmin({ ...base, dossier: '' })), await code(() => X.exporterBancAdmin({ ...base, dossier: null }))], ['DOSSIER-REFUSE', 'DOSSIER-REFUSE', 'DOSSIER-REFUSE']);
        // M3 : la racine d'un disque est jugée par la fonction PURE sur une lettre fabriquée (aucun accès au disque), jamais par la vraie racine du poste
        H.v('4. la racine d\'un disque (lettre fabriquée) est refusée par la garde elle-même', [X.refusDeDossier('Z:\\'), X.refusDeDossier('Z:\\x') === null], ['racine d\'un disque', true]);
        // I1 : le chemin RÉEL est jugé. AUCUN lien n'est créé : la résolution `realpath` et `lstat` sont INJECTÉES (un lien réel, lui, ne se prouve que par ces deux appels).
        {
            const cible = faux('sortie-lien');
            const reel = r => ({ realpath: () => r });
            for (const [nom, r] of [[LF, faux('ailleurs', LF, 'x')], [AM, faux('ailleurs', AM)], [LG, faux('ailleurs', LG, 'y')], [['verrou', 'photos'].join(' + '), faux('ailleurs', 'verrou', 'photos', 'x')], ['racine d\'un disque', 'Z:\\']])
                H.v(`I1. chemin RÉEL dans un dossier d'apports (${nom}) alors que le chemin donné est innocent : refusé, rien écrit`, [await code(() => X.exporterBancAdmin({ ...base, dossier: cible, ...reel(r) })), fs.existsSync(cible)], ['DOSSIER-REFUSE', false]);
            H.v('I1. une cible qui est elle-même un lien (lstat injecté) est refusée, rien écrit', [await code(() => X.exporterBancAdmin({ ...base, dossier: cible, lstat: () => ({ isSymbolicLink: () => true }) })), fs.existsSync(cible)], ['DOSSIER-REFUSE', false]);
            H.v('I1. un chemin réel qui reste ailleurs et innocent est admis (témoin : la garde ne refuse pas tout)', await code(() => X.exporterBancAdmin({ ...base, dossier: sortie('reel-ok'), realpath: p => p })), null);
        }
        // un dossier déjà rempli de choses qui ne sont pas un export : refusé, rien n'y est écrit
        const occupe = sortie('occupe'); fs.mkdirSync(occupe); fs.writeFileSync(path.join(occupe, 'important.txt'), 'x');
        H.v('4. un dossier non vide qui n\'est pas un export précédent est refusé, son contenu est intact', [await code(() => X.exporterBancAdmin({ ...base, dossier: occupe })), fs.readdirSync(occupe)], ['DOSSIER-REFUSE', ['important.txt']]);
        // M5 : un dossier non vide est refusé, MÊME si c'est un export précédent (jamais de photos anciennes qui survivent à une purge)
        const avantOk = fs.readdirSync(path.join(sortie('ok'), 'photos')).sort();
        H.v('4. un dossier qui est déjà un export est REFUSÉ aussi (dossier vide ou inexistant seulement), son contenu est intact', [await code(() => X.exporterBancAdmin({ ...base, dossier: sortie('ok') })), fs.readdirSync(path.join(sortie('ok'), 'photos')).sort()], ['DOSSIER-REFUSE', avantOk]);
        // M4 : le contrôle de la base peut ÉCHOUER : la base nommée doit porter une collection `banc_lignes`
        {
            const faux = (liste) => ({ connect: async () => { }, close: async () => { }, db: nom => ({ databaseName: nom, listCollections: () => ({ toArray: async () => liste }), collection: () => ({}) }) });
            const env = { MONGODB_ESSAI_LECTURE_URI: 'mongodb://127.0.0.1:1/x' };
            H.v('4. M4 : une base qui n\'a pas de collection `banc_lignes` (autre base, autre grappe) est refusée', await code(() => X.connecterLecture(env, 'cartes', { MongoClient: function () { return faux([]); } })), 'BASE-REFUSEE');
            H.v('4. M4 : une base qui porte `banc_lignes` est admise', await code(() => X.connecterLecture(env, 'essai_lecture', { MongoClient: function () { return faux([{ name: 'banc_lignes' }]); } })), null);
        }
        // écrire hors du dossier donné : le chemin résolu doit y rester
        const ev = `evasion-${process.pid}-${Date.now()}.txt`;      // un nom NEUF à chaque exécution : un reste d'une exécution précédente ne peut pas fausser la preuve
        H.v('4. ecrireDans refuse « .. », un chemin absolu et un nom étranger', [await code(async () => X.ecrireDans(racine, `../${ev}`, 'x')), await code(async () => X.ecrireDans(racine, path.join(os.tmpdir(), ev), 'x')), await code(async () => X.ecrireDans(racine, `photos/../../${ev}`, 'x'))], ['HORS-DOSSIER', 'HORS-DOSSIER', 'HORS-DOSSIER']);
        H.vrai('4. aucun fichier d\'évasion n\'a été créé à côté', !fs.existsSync(path.join(path.dirname(racine), ev)) && !fs.existsSync(path.join(os.tmpdir(), ev)));
        // une clé d'objet qui n'a pas la forme du banc ne devient jamais un nom de fichier
        await db.col('banc_lignes').insertOne(ligne('k1', { cleR2: '../../etc/passwd', verite: 1, reponse: rep('identifiee', 1) }));
        const k = sortie('cle'); const b = await X.exporterBancAdmin({ ...base, dossier: k });
        H.v('4. une cleR2 hors forme est exportée sans photo, et rien n\'est lu ni écrit pour elle', [b.sansPhoto, fs.readdirSync(path.join(k, 'photos')).length], [2, 3]);
        await db.col('banc_lignes').deleteOne({ _id: 'k1'.padEnd(64, '0') });
    }

    // ═══ 4 bis. M1 : la garde de dossier s'écrit par ce qu'elle AUTORISE — une racine permise (le temporaire du système, ou la racine NOMMÉE par V2_EXPORT_RACINE), tout le reste est refusé ═══
    // Chemins FABRIQUÉS et résolution `realpath` INJECTÉE : aucun accès hors du temporaire, aucun lien. `Z:\` est une lettre fabriquée (jamais écrite : rien n'existe là).
    {
        const base = { colFn: colLecture, stockage: { lire: c => mem.lire(c) }, base: 'essai_lecture' };
        const identite = { realpath: p => p, lstat: () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } };
        const LF = ['Logo', 'FR'].join(' ');
        const T = path.join(racine, 'perm');                        // un faux « temporaire du système » : sert de racine permise injectée
        fs.mkdirSync(T, { recursive: true });
        const permis = { ...identite, tmpdir: () => T, env: {} };
        H.v('M1. hors de toute racine permise (nom innocent, dossier inexistant) : REFUSÉ', await code(() => X.exporterBancAdmin({ ...base, ...permis, dossier: 'Z:\\quelconque\\export' })), 'DOSSIER-REFUSE');
        H.v('M1. hors de toute racine permise, un dossier au nom inconnu (« Mes photos Vinted », rempli à la main) : REFUSÉ — la liste de refus ne suffit pas', await code(() => X.exporterBancAdmin({ ...base, ...permis, dossier: 'Z:\\Mes photos Vinted\\export' })), 'DOSSIER-REFUSE');
        H.v('M1. sous la racine permise (le temporaire injecté) : admis', await code(() => X.exporterBancAdmin({ ...base, ...permis, dossier: path.join(T, 'ok-1') })), null);
        // seconde couche : les noms d'apports, normalisés
        for (const [nom, seg] of [['point final', `${LF}.`], ['espace final', `${LF} `], ['points et espaces finaux', `${LF}. .`], ['nom court 8.3', 'LOGOFR~1']])
            H.v(`M1. seconde couche : un segment d'apports avec ${nom} est refusé même sous la racine permise`, [await code(() => X.exporterBancAdmin({ ...base, ...permis, dossier: path.join(T, 'x', seg, 'export') })), fs.existsSync(path.join(T, 'x'))], ['DOSSIER-REFUSE', false]);
        H.v('M1. seconde couche : un nom court 8.3 que la résolution RÉELLE développe en dossier d\'apports est refusé', await code(() => X.exporterBancAdmin({ ...base, ...permis, tmpdir: () => T, realpath: p => (p.includes('COURT~9') ? p.replace('COURT~9', LF) : p), lstat: identite.lstat, dossier: path.join(T, 'COURT~9', 'export') })), 'DOSSIER-REFUSE');
        H.v('M1. la fonction pure normalise point/espace finaux', [X.refusDeDossier(`Z:\\a\\${LF}.\\e`) !== null, X.refusDeDossier(`Z:\\a\\${LF} \\e`) !== null, X.refusDeDossier('Z:\\a\\LOGOFR~1\\e') !== null, X.refusDeDossier('Z:\\a\\autre\\e') === null], [true, true, true, true]);
        // la racine NOMMÉE
        const N = path.join(racine, 'racine-nommee'); fs.mkdirSync(N, { recursive: true });
        const autreTmp = { tmpdir: () => path.join(racine, 'un-autre-temporaire'), lstat: identite.lstat, realpath: p => p };       // le temporaire injecté n'est PAS N : seule la racine nommée peut admettre
        H.v('M1. racine nommée valide : un dossier sous elle est admis (le temporaire n\'y est pour rien)', await code(() => X.exporterBancAdmin({ ...base, ...autreTmp, env: { V2_EXPORT_RACINE: N }, dossier: path.join(N, 'export-n') })), null);
        H.v('M1. racine nommée valide : un dossier HORS d\'elle (et hors du temporaire injecté) est refusé', await code(() => X.exporterBancAdmin({ ...base, ...autreTmp, env: { V2_EXPORT_RACINE: N }, dossier: path.join(racine, 'ailleurs', 'export') })), 'DOSSIER-REFUSE');
        for (const [nom, v] of [['relative', 'export'], ['racine de disque', 'Z:\\'], ['contenant un dossier d\'apports', path.join(racine, LF, 'r')], ['sous un Bureau', path.join(racine, 'Desktop', 'r')], ['sous `verrou/photos`', path.join(racine, 'verrou', 'photos', 'r')], ['inexistante', path.join(racine, 'nexiste-pas')], ['vide', ' ']]) {
            const realpathNommee = nom === 'inexistante' ? (p => { if (p === v) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return p; }) : (p => p);
            H.v(`M1. racine nommée ${nom} : l'export est refusé (aucune écriture, même sous le temporaire permis)`, [await code(() => X.exporterBancAdmin({ ...base, ...permis, realpath: realpathNommee, env: { V2_EXPORT_RACINE: v }, dossier: path.join(T, `nommee-${nom.length}`) })), fs.existsSync(path.join(T, `nommee-${nom.length}`))], ['DOSSIER-REFUSE', false]);
        }
        // la course : le chemin réel est rejugé JUSTE AVANT chaque écriture
        {
            const cible = path.join(T, 'course'); const etat = { bascule: false }; let lues = 0;
            const realpath = p => (etat.bascule && p.startsWith(cible) ? path.join(T, LF, 'export') : p);
            const stockage = { lire: async c => { lues++; if (lues === 1) etat.bascule = false; if (lues === 2) etat.bascule = true; return mem.lire(c); } };
            const r = await code(() => X.exporterBancAdmin({ ...base, ...permis, realpath, stockage, dossier: cible }));
            const ecrits = fs.existsSync(path.join(cible, 'photos')) ? fs.readdirSync(path.join(cible, 'photos')).length : 0;
            H.v('M1. course : le dossier devient (à ses yeux) un dossier d\'apports PENDANT l\'export — refusé avant l\'écriture suivante (une seule photo écrite, pas toutes)', [r, ecrits], ['DOSSIER-REFUSE', 1]);
        }
    }

    // ═══ 5. la ligne de commande : écrite par ce qu'elle AUTORISE ═══
    {
        const sorties = []; const journal = l => sorties.push(String(l));
        const env = { MONGODB_ESSAI_LECTURE_URI: 'mongodb://127.0.0.1:1/x', V2_BANC_BUCKET: 'bucket-banc-test' };
        const connecter = async nom => ({ colFn: colLecture, base: nom, fermer: async () => { } });
        const stockage = { lire: c => mem.lire(c) };
        const lancer = (argv, o = {}) => X.lancerCLI(argv, { env, connecter, stockage, journal, ...o });
        const dossier = sortie('cli');
        const ok = await lancer([`--base=essai_lecture`, `--sortie=${dossier}`]);
        H.v('5. arguments justes : code 0, l\'export existe', [ok, fs.existsSync(path.join(dossier, 'manifeste.json'))], [0, true]);
        H.v('5. --base=test refusé (code 1) avant toute connexion', await lancer(['--base=test', `--sortie=${sortie('c1')}`], { connecter: async () => { throw new Error('connexion'); } }), 1);
        H.v('5. sans --base, sans --sortie, argument inconnu, --base donné deux fois : code 1', [await lancer([`--sortie=${sortie('c2')}`]), await lancer(['--base=essai_lecture']), await lancer(['--base=essai_lecture', `--sortie=${sortie('c3')}`, '--force']), await lancer(['--base=a', '--base=b', `--sortie=${sortie('c4')}`])], [1, 1, 1, 1]);
        H.v('5. sans MONGODB_ESSAI_LECTURE_URI : code 1 (l\'URI de lecture est la seule admise)', await lancer(['--base=essai_lecture', `--sortie=${sortie('c5')}`], { env: { V2_BANC_BUCKET: 'bucket-banc-test', MONGODB_URI: 'mongodb://prod' } }), 1);
        const dApports = path.join(racine, 'faux-bureau-cli', 'LO' + 'GO', 'sortie');   // un double (voir section 4), jamais le vrai dossier
        H.v('5. dossier d\'apports : code 1, rien créé', [await lancer(['--base=essai_lecture', `--sortie=${dApports}`]), fs.existsSync(dApports)], [1, false]);
        H.vrai('5. aucune valeur d\'URI ni de variable dans le journal', !sorties.join('\n').includes('mongodb://'));
    }

    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exitCode = 1; });
