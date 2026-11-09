'use strict';
// outils/verifier-absence-parcours.js : il dit NON sur des arbres fabriqués où le module est présent ou référencé (et sur ce qu'il ne sait pas lire), OUI sur un arbre sans le module.
// Arbres fabriqués dans un dossier temporaire PROPRE à ce banc, retirés à la fin ; les cas de liens (D3) se jouent sur un FAUX disque en mémoire : ce banc ne crée AUCUN lien. Aucune base, aucun réseau.
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const H = require('./_harnais'); const { verifier, deriver, USAGES_TOLERES } = require('../../outils/verifier-absence-parcours');
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'absence-parcours-'));
const arbre = (nom, fichiers) => { const d = path.join(racine, nom); for (const [rel, texte] of Object.entries(fichiers)) { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, texte); } fs.mkdirSync(path.join(d, 'v2'), { recursive: true }); return d; };
const BASE = { 'v2/config.js': "'use strict'; const mesure = { actif: false };\n", 'v2/comptes/routes.js': "'use strict'; // lit cfg.mesure\n", 'v2/garde-essai.js': "'use strict';\n" };
try {
    const sans = arbre('sans', BASE);
    H.v('arbre SANS le module et sans référence => OUI', verifier(sans), { ok: true, fautes: [] });
    const avecDossier = arbre('dossier', { ...BASE, 'v2/essai-parcours/index.js': "'use strict';\n" });
    H.v('arbre avec le dossier v2/essai-parcours => NON', [verifier(avecDossier).ok, verifier(avecDossier).fautes.some(f => f.includes('v2/essai-parcours porte le nom'))], [false, true]);
    const avecRef = arbre('ref', { ...BASE, 'v2/config.js': "const m = require('./essai-parcours').depuis(env);\n" });
    H.v('arbre sans le dossier mais où config.js fait référence au module => NON (le fichier fautif est nommé)', [verifier(avecRef).ok, verifier(avecRef).fautes], [false, ['v2/config.js porte la signature « essai-parcours »']]);
    const refCommentaire = arbre('commentaire', { ...BASE, 'v2/comptes/monter.js': "// voir v2/essai-parcours/\n" });
    H.v('une référence même en commentaire => NON (lecture stricte)', verifier(refCommentaire).ok, false);
    const refTest = arbre('test', { ...BASE, 'v2/test/test-x.js': "require('../essai-parcours');\n" });
    H.v('une référence sous v2/test seulement => OUI (les bancs ne sont pas du code servi)', verifier(refTest).ok, true);
    const refMjs = arbre('mjs', { ...BASE, 'v2/outil.mjs': "import('./essai-parcours/index.js');\n", 'v2/profond/a/b/c.cjs': "require('../../../essai-parcours');\n" });
    H.v('références en .mjs et .cjs, en profondeur => NON, les deux fichiers nommés', verifier(refMjs).fautes.length, 2);
    H.v('un fichier hors v2 (outils/, docs) qui cite le module ne compte pas', verifier(arbre('hors', { ...BASE, 'outils/x.js': "// essai-parcours\n", 'RAPPORT.md': 'essai-parcours' })).ok, true);
    H.v('arbre sans dossier v2 => NON (non vérifiable : jamais « tout va bien »)', [verifier(path.join(racine, 'inexistant')).ok, verifier('').ok, verifier(undefined).ok, verifier(42).ok], [false, false, false, false]);
    // ---- TOUR 3 ----
    const EXEMPTION = "const e = req.get('x-rat-market-mesure'); router.post('/api/essai/lien-confirmation', h); process.env.V2_ESSAI_ADRESSES_MESURE; process.env.V2_SECRET_MESURE;\n";
    // D1 : un élément nommé essai-parcours est une faute à N'IMPORTE QUELLE profondeur
    const imbrique = arbre('imbrique', { ...BASE, 'v2/comptes/essai-parcours/index.js': EXEMPTION });
    H.v('D1 : dossier essai-parcours IMBRIQUÉ (v2/comptes/essai-parcours) => NON', [verifier(imbrique).ok, verifier(imbrique).fautes.some(f => f.includes('v2/comptes/essai-parcours'))], [false, true]);
    H.v('D1 : fichier nommé essai-parcours (sans extension de dossier) en profondeur => NON', verifier(arbre('imbrique-fichier', { ...BASE, 'v2/a/b/c/essai-parcours': 'x' })).ok, false);
    H.v('D1 : dossier essai-parcours sous node_modules (jamais descendu) : seul node_modules est sauté => OUI', verifier(arbre('nm', { ...BASE, 'v2/node_modules/essai-parcours/index.js': 'x' })).ok, true);
    // D2 : la preuve porte sur le CONTENU : un module copié sous un autre nom donne NON
    const renomme = arbre('renomme', { ...BASE, 'v2/exemption-mesure/index.js': EXEMPTION, 'v2/config.js': "const m = require('./exemption-mesure').depuis(env);\n" });
    H.v('D2 : module copié sous un AUTRE nom (route, en-tête, variables) => NON, fichier nommé', [verifier(renomme).ok, verifier(renomme).fautes.some(f => f.startsWith('v2/exemption-mesure/index.js'))], [false, true]);
    for (const [nom, texte] of [['la route', "router.post('/api/essai/lien-confirmation', h);"], ['l\'en-tête', "req.get('X-Rat-Market-Mesure')"], ['V2_ESSAI_ADRESSES_MESURE', "env.V2_ESSAI_ADRESSES_MESURE"], ['V2_SECRET_MESURE (dispenser d\'un défi)', "if (env.V2_SECRET_MESURE) return next();"]])
        H.v(`D2 : une signature seule dans un fichier servi quelconque (${nom}) => NON`, verifier(arbre(`sig-${nom.length}`, { ...BASE, 'v2/comptes/autre.js': texte })).ok, false);
    H.v('D2 : la table fermée des usages tolérés : deux outils clients, chacun avec sa raison', [USAGES_TOLERES.map(u => u.fichier), USAGES_TOLERES.every(u => typeof u.raison === 'string' && u.raison.length > 20 && Array.isArray(u.signatures) && u.signatures.length > 0)], [['v2/admin/abonnements/parcours-test.js', 'v2/mesures/connexion-essai.js'], true]);
    const outils = arbre('outils', { ...BASE, 'v2/mesures/connexion-essai.js': "const s = env.V2_SECRET_MESURE; h['X-Rat-Market-Mesure'] = s;\n", 'v2/admin/abonnements/parcours-test.js': "// V2_ESSAI_ADRESSES_MESURE\nconst s = env.V2_SECRET_MESURE; h['x-rat-market-mesure'] = s;\n" });
    H.v('D2 : les deux outils clients listés (V2_SECRET_MESURE, en-tête, adresses) => OUI', verifier(outils).ok, true);
    const outilsDehors = arbre('outils-dehors', { ...BASE, 'v2/mesures/connexion-essai.js': "router.post('/api/essai/lien-confirmation', h);\n" });
    H.v('D2 : un outil listé qui porte une signature NON listée pour lui (la route) => NON', verifier(outilsDehors).ok, false);
    H.v('D2 : le même texte d\'outil sous un AUTRE chemin que ceux de la table => NON', verifier(arbre('outil-ailleurs', { ...BASE, 'v2/comptes/connexion-essai.js': "const s = env.V2_SECRET_MESURE;\n" })).ok, false);
    H.v('D2 : un fichier JS racine servi qui porte une signature => NON', verifier(arbre('racine-js', { ...BASE, 'index.js': "req.get('x-rat-market-mesure');\n" })).ok, false);
    H.v('D2 : une signature dans collecte-cartes/ (que v2 charge) => NON ; sans signature => OUI', [verifier(arbre('collecte-sig', { ...BASE, 'collecte-cartes/x.js': "req.get('x-rat-market-mesure');\n" })).ok, verifier(arbre('collecte-ok', { ...BASE, 'collecte-cartes/x.js': "'use strict';\n" })).ok], [false, true]);
    // D3 : un lien symbolique ou une jonction est une FAUTE (jamais un saut silencieux)
    {
        // AUCUN lien réel : aucun banc n'en crée (règle de test-garde-apports.js, qui protège les dossiers d'apports). La détection réelle vit dans l'outil (`classerEntree`, fonction pure sur ce que rendent
        // readdir/lstat : libuv rapporte lien symbolique ET jonction par `isSymbolicLink`) ; ici elle reçoit de FAUSSES entrées, et `verifier` / `deriver` un FAUX disque injecté (`fsx`).
        const R = path.join(path.sep, 'R');
        const faux = spec => {   // spec : { 'v2': 'dir', 'v2/config.js': 'file:texte', 'v2/cache': 'link', 'v2/x': 'autre' } -> un faux `fs` en mémoire
            const T = new Map([[R, { t: 'dir' }]]); for (const [rel, v] of Object.entries(spec)) T.set(path.join(R, rel), v === 'dir' ? { t: 'dir' } : v === 'link' ? { t: 'link' } : v === 'autre' ? { t: 'autre' } : { t: 'file', texte: v.slice(5) });
            const entree = (p, nom) => { const e = T.get(p); return { name: nom, isSymbolicLink: () => e.t === 'link', isDirectory: () => e.t === 'dir', isFile: () => e.t === 'file' }; };
            const ecrit = [];
            return { ecrit, lstatSync: p => { if (!T.has(path.normalize(p))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return entree(path.normalize(p), path.basename(p)); },
                     readdirSync: p => [...T.keys()].filter(k => path.dirname(k) === path.normalize(p) && k !== path.normalize(p)).map(k => entree(k, path.basename(k))),
                     readFileSync: p => { const e = T.get(path.normalize(p)); if (!e || e.t !== 'file') throw new Error('illisible'); return e.texte; },
                     existsSync: p => T.has(path.normalize(p)) || ecrit.some(w => w[1] === path.normalize(p)),
                     mkdirSync: p => { ecrit.push(['mkdir', path.normalize(p)]); }, copyFileSync: (a, b) => { ecrit.push(['copie', path.normalize(b)]); }, writeFileSync: (p, t) => { ecrit.push(['ecrit', path.normalize(p), t]); } };
        };
        const OK = { v2: 'dir', 'v2/config.js': 'file:const mesure = {};' };
        const classer = require('../../outils/verifier-absence-parcours').classerEntree;
        H.v('D3 : classerEntree : un lien passe AVANT le dossier (lien + dossier = lien), puis dossier, fichier ; null, objet vide, entrée sans méthode = autre',
            [{ isSymbolicLink: () => true, isDirectory: () => true, isFile: () => false }, { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }, { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true }, null, {}, { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false }].map(classer), ['lien', 'dossier', 'fichier', 'autre', 'autre', 'autre']);
        H.v('D3 : (contrôle) le faux disque sans lien => OUI', verifier(R, faux(OK)).ok, true);
        const nonLien = (nom, spec, motif) => { const r = verifier(R, faux({ ...OK, ...spec })); H.v(`D3 : ${nom} => NON, nommé, jamais sauté en silence`, [r.ok, r.fautes.some(f => f.includes(motif) && /lien symbolique ou une jonction/.test(f))], [false, true]); };
        nonLien('un lien (ou une jonction) de dossier dans v2', { 'v2/cache': 'link' }, 'v2/cache');
        nonLien('un lien de fichier JS dans v2', { 'v2/lien.js': 'link' }, 'v2/lien.js');
        nonLien('un lien nommé node_modules (le saut de node_modules ne couvre pas un lien)', { 'v2/node_modules': 'link' }, 'v2/node_modules');
        nonLien('un lien profond (v2/a/b/c)', { 'v2/a': 'dir', 'v2/a/b': 'dir', 'v2/a/b/c': 'link' }, 'v2/a/b/c');
        nonLien('un lien sous v2/test (noms et liens y sont contrôlés)', { 'v2/test': 'dir', 'v2/test/x': 'link' }, 'v2/test/x');
        nonLien('collecte-cartes lui-même en lien', { 'collecte-cartes': 'link' }, 'collecte-cartes');
        nonLien('un lien dans ratmarket/', { ratmarket: 'dir', 'ratmarket/a.js': 'link' }, 'ratmarket/a.js');
        H.v('D3 : v2 lui-même en lien => NON', verifier(R, faux({ v2: 'link' })).ok, false);
        H.v('D3 : une entrée ni fichier ni dossier ni lien (non classable) => NON : « je ne sais pas » n\'est pas « tout va bien »', verifier(R, faux({ ...OK, 'v2/bizarre': 'autre' })).ok, false);
        // la DÉRIVATION : un lien dans la source est refusé, et le message le dit (rien n'est suivi)
        const SRC = { ...OK, 'v2/config.js': 'file:// >>> PARCOURS-SITE-DEBUT\nx\n// <<< PARCOURS-SITE-FIN\n' };
        const derive = spec => { const f = faux({ ...SRC, ...spec }); try { deriver(R, path.join(path.sep, 'DEST'), f); return { f, erreur: null }; } catch (e) { return { f, erreur: e.message }; } };
        H.v('D3 : deriver : un lien dans v2 de la source => REFUS nommant le lien, le config.js dérivé n\'est pas écrit', [derive({ 'v2/cache': 'link' }).erreur.includes('lien symbolique ou jonction') && derive({ 'v2/cache': 'link' }).erreur.includes('v2/cache'), derive({ 'v2/cache': 'link' }).f.ecrit.some(w => w[0] === 'ecrit')], [true, false]);
        H.v('D3 : deriver : un lien dans collecte-cartes, et collecte-cartes lui-même en lien => REFUS', [derive({ 'collecte-cartes': 'dir', 'collecte-cartes/a.js': 'link' }).erreur !== null, derive({ 'collecte-cartes': 'link' }).erreur !== null], [true, true]);
        const propre = derive({ 'collecte-cartes': 'dir', 'collecte-cartes/a.js': 'file:x' });
        H.v('D3 : deriver : (contrôle) source sans lien => aucune erreur, config.js dérivé écrit sans le bloc', [propre.erreur, propre.f.ecrit.filter(w => w[0] === 'ecrit').map(w => w[2].includes('PARCOURS-SITE'))], [null, [false]]);
    }
    // D5 : l'arbre de PRODUCTION est DÉRIVÉ par une fonction unique (retrait du dossier, remplacement du bloc balisé de config.js) ; l'outil exige OUI ; la configuration se charge
    {
        const reelRacine = path.join(__dirname, '..', '..'), prod = path.join(racine, 'prod');
        const d = deriver(reelRacine, prod);
        H.v('D5 : l\'arbre de production dérivé de CE worktree : l\'outil dit OUI', verifier(prod), { ok: true, fautes: [] });
        H.v('D5 : le dossier du module est absent de l\'arbre dérivé, config.js ne le nomme plus, garde-essai.js reste', [fs.existsSync(path.join(prod, 'v2', 'essai-parcours')), /essai-parcours/.test(fs.readFileSync(path.join(prod, 'v2', 'config.js'), 'utf8')), fs.existsSync(path.join(prod, 'v2', 'garde-essai.js'))], [false, false, true]);
        H.vrai('D5 : l\'arbre dérivé ne contient ni v2/test ni node_modules, et la dérivation dit ce qu\'elle a retiré', !fs.existsSync(path.join(prod, 'v2', 'test')) && !fs.existsSync(path.join(prod, 'v2', 'node_modules')) && d.retire.includes('v2/essai-parcours') && d.retire.includes('v2/config.js (bloc PARCOURS-SITE)'));
        // le CHARGEMENT RÉEL, dans un processus enfant, de l'arbre dérivé (le dossier n'existe pas : rien n'est simulé), sous l'environnement de PRODUCTION et sous celui de l'essai
        const base = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_PATH: path.join(reelRacine, 'node_modules') };
        const enfant = env => { try { const s = execFileSync(process.execPath, [path.join(__dirname, '_enfant-arbre.js'), prod], { env: { ...base, ...env }, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); return JSON.parse(s.split(/\r?\n/).filter(l => l.startsWith('{"charge"')).pop()); } catch (e) { return { erreur: String(e.status || e.name) }; } };
        const SEC = 'secret-de-bascule-' + 'x'.repeat(20), E = { MONGODB_BASE: 'test', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', V2_CIBLE: 'essai', V2_SECRET_MESURE: SEC, V2_SECRET_EMPREINTE: 'valeur-de-banc-seize' };
        H.v('D5 : l\'arbre de production dérivé se CHARGE sous l\'environnement de production (configuration valide, module non chargé, exemption inerte)', (({ charge, valide, inerte }) => [charge, valide, inerte])(enfant(E)), [false, true, true]);
        H.v('D5 : même avec TOUTES les variables de l\'essai (base rm_essai, service, cible, secret), l\'arbre dérivé reste inerte : aucune exemption n\'existe', (({ charge, valide, inerte }) => [charge, valide, inerte])(enfant({ ...E, MONGODB_BASE: 'rm_essai' })), [false, true, true]);
        // la dérivation SAIT dire non : sans marqueurs, elle refuse (elle ne devine pas) ; et une dérivation incomplète (config.js non transformé) donne NON
        const sansMarqueur = arbre('sans-marqueur', { ...BASE, 'v2/essai-parcours/index.js': 'x' });
        let refus = null; try { deriver(sansMarqueur, path.join(racine, 'prod2')); } catch (e) { refus = e.message; }
        H.vrai('D5 : une source dont config.js n\'a pas ses deux marqueurs => la dérivation REFUSE (rien d\'écrit)', typeof refus === 'string' && refus.includes('marqueur') && !fs.existsSync(path.join(racine, 'prod2')));
        const incomplet = arbre('incomplet', { ...BASE, 'v2/config.js': "// >>> PARCOURS-SITE-DEBUT\nconst mesure = require('./essai-parcours').depuis(env);\n// <<< PARCOURS-SITE-FIN\n", 'v2/essai-parcours/index.js': 'x' });
        fs.rmSync(path.join(incomplet, 'v2', 'essai-parcours'), { recursive: true });
        H.v('D5 : (contrôle de l\'instrument) dossier retiré SANS transformer config.js => NON ; dérivé par la fonction => OUI', [verifier(incomplet).ok, (() => { deriver(incomplet, path.join(racine, 'prod3')); return verifier(path.join(racine, 'prod3')).ok; })()], [false, true]);
    }
    // la ligne de commande : code de sortie 0 / 1
    const cli = d => { try { execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'outils', 'verifier-absence-parcours.js'), d], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
    H.v('ligne de commande : code 0 sur l\'arbre sans module, 1 sur les arbres avec le dossier ou une référence, 1 sans argument', [cli(sans), cli(avecDossier), cli(avecRef), cli('')], [0, 1, 1, 1]);
    // l'arbre RÉEL de ce worktree : NON tant que le module existe (c'est le travail de la bascule de le retirer), et le fautif est bien le dossier
    const reel = verifier(path.join(__dirname, '..', '..'));
    H.v('l\'arbre de ce worktree dit NON (le module est là, le dossier est nommé) : la bascule de production doit le retirer', [reel.ok, reel.fautes.some(f => f.startsWith('v2/essai-parcours porte le nom'))], [false, true]);
    // CONTRÔLE DE L'INSTRUMENT : retirer le dossier ET la référence d'une copie fabriquée de l'arbre fautif => OUI
    fs.rmSync(path.join(avecRef, 'v2', 'config.js')); fs.writeFileSync(path.join(avecRef, 'v2', 'config.js'), BASE['v2/config.js']);
    H.v('contrôle de l\'instrument : la même copie, la référence retirée, redevient OUI', verifier(avecRef).ok, true);
} finally { fs.rmSync(racine, { recursive: true, force: true }); }
H.bilan();
