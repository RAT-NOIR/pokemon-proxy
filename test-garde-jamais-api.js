// node test-garde-jamais-api.js — LA GARDE « JAMAIS D'API » (décision du testeur, 2026-10-17 : « seuls les hôtes d'images sont permis »).
// Elle s'écrit par ce qu'elle AUTORISE : deux hôtes (images.pokemontcg.io, images.scrydex.com), des chemins énumérés, rien d'autre.
//   1. AU MOMENT DE L'EXÉCUTION (collecte-cartes/ptcgio.js) : tout autre hôte LÈVE avant toute requête — l'API de l'un comme de l'autre,
//      tout sous-domaine de scrydex.com hors `images.`, une redirection ; robots.txt est relu POUR CHAQUE HÔTE.
//   2. DANS LE DÉPÔT (collecte-cartes/garde-jamais-api.js) : un banc statique parcourt les fichiers suivis par git et refuse toute adresse d'API.
//      Il sait dire NON : prouvé sur des FAUX fichiers fabriqués ici, jamais en écrivant un vrai fichier.
// ⚠️ Ce fichier ne porte AUCUNE adresse interdite en clair : elles se fabriquent par morceaux (le banc statique le lit lui aussi).
const sharp = require('sharp');
const P = require('./collecte-cartes/ptcgio');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const adresse = (...morceaux) => morceaux.join('');
const API_PTCG = adresse('https', '://', 'api', '.pokemontcg', '.io');
const API_SCRY = adresse('https', '://', 'api', '.scry', 'dex.com');
const IMG_PTCG = adresse('https', '://images.', 'pokemontcg', '.io');
const IMG_SCRY = adresse('https', '://images.', 'scry', 'dex.com');
const urlScry = (n = 11) => `${IMG_SCRY}/pokemon/me55c-${n}/large`;

(async () => {
    const png = await sharp({ create: { width: 734, height: 1024, channels: 3, background: { r: 10, g: 90, b: 200 } } }).png().toBuffer();
    const reseau = repondre => { const appels = []; return { appels, async get(url, o) { appels.push(url); return repondre(url, o); } }; };
    const robotsLibres = '# aucun Disallow\n';
    const normal = (robots = robotsLibres) => url => /\/robots\.txt$/.test(url) ? { status: 200, texte: robots }
        : /\/pokemon\/me55c-\d+[a-z]?\/large$/.test(url) || /_hires\.png$/.test(url) ? { status: 200, type: 'image/png', octets: png } : { status: 404, type: 'image/png' };
    const verrou = { tenu: true, perdu: false };
    const pause = async () => { };
    // Chaque client du banc prend son SUIVI neuf et un dossier d'arrêts temporaire : le registre du processus (reponse-hote.js, c585c19d I3) garde la pause d'un hôte d'un client à l'autre,
    // et la 302 d'une image (1.d) mettait images.scrydex.com en pause avant le scénario suivant : zéro requête au lieu d'une. Le banc n'écrit jamais dans le dossier réel des arrêts.
    const dossierBanc = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'garde-api-'));
    const client = (tr, o = {}) => P.fabriquerClientPtcgio({ transport: tr, verrou, pause, suivi: require('./collecte-cartes/reponse-hote').suiviHote(), dossierPauses: dossierBanc, ...o });
    const lever = async (c, u) => { try { await c.image(u); return null; } catch (e) { return e; } };

    // ── 1. L'EXÉCUTION ─────────────────────────────────────────────────────────────────────────────────────────────────
    // 1.a les deux hôtes d'images passent, chacun avec SON robots.txt lu avant sa première image
    let tr = reseau(normal()), c = client(tr);
    const e0 = await lever(c, urlScry(11));
    verifier('images.scrydex.com : accepté, robots.txt de CET hôte relu avant la première image', [e0 && e0.message, tr.appels], [null, [`${IMG_SCRY}/robots.txt`, urlScry(11)]]);
    await lever(c, `${IMG_PTCG}/cel25/5_hires.png`);
    verifier('images.pokemontcg.io ensuite : SON robots.txt est relu à son tour (un robots.txt par hôte, jamais celui de l\'autre)', tr.appels.slice(2), [`${IMG_PTCG}/robots.txt`, `${IMG_PTCG}/cel25/5_hires.png`]);
    await lever(c, urlScry(5));
    verifier('robots.txt d\'un hôte déjà lu : pas relu', tr.appels.length, 5);
    verifier('les requêtes se comptent PAR HÔTE (la cadence et le verrou restent communs)', c.requetesParHote(), { 'images.scrydex.com': 3, 'images.pokemontcg.io': 2 });
    // 1.b robots.txt de scrydex qui interdit : aucune image
    tr = reseau(normal('User-agent: *\nDisallow: /\n')); c = client(tr);
    const e1 = await lever(c, urlScry(11));
    verifier('images.scrydex.com dont robots.txt interdit : on s\'arrête, aucune image demandée', [!!e1 && e1.robots === true, tr.appels], [true, [`${IMG_SCRY}/robots.txt`]]);
    // 1.c tout le reste lève AVANT toute requête
    const interdites = [
        [API_PTCG + '/v2/cards', 'API pokemontcg.io'], [API_PTCG + '/v2/sets', 'API pokemontcg.io (sets)'], [API_SCRY + '/pokemon/v1/en/cards', 'API scrydex'],
        [adresse('https', '://www.scry', 'dex.com/'), 'site public de Scrydex'], [adresse('https', '://scry', 'dex.com/'), 'domaine nu de Scrydex'], [adresse('https', '://cdn.scry', 'dex.com/x.png'), 'autre sous-domaine'],
        [adresse('https', '://api.images.scry', 'dex.com/pokemon/me55c-1/large'), 'sous-domaine de images.'],
        [adresse('https', '://images.scry', 'dex.com.evil.example/pokemon/me55c-1/large'), 'hôte déguisé'], [adresse('http', '://images.scry', 'dex.com/pokemon/me55c-1/large'), 'http clair'],
        [adresse('https', '://images.scry', 'dex.com/v1/pokemon/cards'), 'chemin d\'API sur l\'hôte d\'images'], [adresse('https', '://images.scry', 'dex.com/pokemon/inconnu-1/large'), 'set non énuméré'],
        [urlScry(11) + '?key=1', 'paramètre'], [adresse('https', '://u:p@images.scry', 'dex.com/pokemon/me55c-1/large'), 'identifiants'], [adresse('https', '://images.scry', 'dex.com:8443/pokemon/me55c-1/large'), 'port'],
        [adresse('http', '://images.', 'pokemontcg', '.io/cel25/5_hires.png'), 'http clair pokemontcg']
    ];
    for (const [u, nom] of interdites) {
        tr = reseau(normal()); c = client(tr);
        const e = await lever(c, u);
        verifier(`refusé AVANT toute requête : ${nom}`, [!!e, tr.appels.length], [true, 0]);
    }
    // 1.d une redirection n'est jamais suivie, et surtout pas vers l'API
    tr = reseau(url => /robots\.txt$/.test(url) ? { status: 200, texte: robotsLibres } : { status: 302, location: API_PTCG + '/v2/cards' });
    c = client(tr);
    const e2 = await lever(c, urlScry(11));
    verifier('redirection d\'une image vers l\'API : refusée, la cible n\'est JAMAIS demandée', [/redirection/.test(e2?.message || ''), tr.appels.some(u => u.startsWith(API_PTCG))], [true, false]);
    tr = reseau(url => /robots\.txt$/.test(url) ? { status: 302, location: API_SCRY + '/robots.txt' } : { status: 200, type: 'image/png', octets: png });
    c = client(tr);
    const e3 = await lever(c, urlScry(11));
    verifier('redirection de robots.txt vers l\'API : on ne conclut pas, aucune image, la cible n\'est jamais demandée', [!!e3, tr.appels.length, tr.appels.some(u => u.startsWith(API_SCRY))], [true, 1, false]);
    // 1.e la garde est AUSSI dans le transport réel (celui qui appelle fetch) : même un appel direct est refusé avant le réseau
    const fetchOrigine = global.fetch, vus = [];
    global.fetch = async u => { vus.push(String(u)); throw new Error('réseau interdit dans le banc'); };
    try {
        const t = P.transportFetch;
        verifier('le transport réel est exporté (sans lui la garde du transport ne se prouve pas)', typeof t?.get, 'function');
        for (const u of [API_PTCG + '/v2/cards', API_SCRY + '/pokemon/v1/en/cards']) { let err = null; try { await t.get(u, {}); } catch (e) { err = e; } verifier(`transport réel : ${u.slice(8, 30)}… refusé avant fetch, par la garde (pas par une panne)`, [/hors de ce que le client autorise/.test(err?.message || ''), !err?.reseau, vus.length], [true, true, 0]); }
    } catch (e) { ko++; console.log('❌ transport réel non exporté ou illisible :', e.message); }
    finally { global.fetch = fetchOrigine; }
    verifier('hoteDeLUrl : seuls les deux hôtes d\'images, en https, sans identifiants ni port', [urlScry(), `${IMG_PTCG}/cel25/5_hires.png`, API_PTCG + '/v2/cards', API_SCRY + '/x', adresse('http', '://images.scry', 'dex.com/x')].map(u => typeof P.hoteDeLUrl === 'function' ? P.hoteDeLUrl(u) : 'ABSENT'), ['images.scrydex.com', 'images.pokemontcg.io', null, null, null]);

    // ── 2. LE DÉPÔT ────────────────────────────────────────────────────────────────────────────────────────────────────
    let G = null;
    try { G = require('./collecte-cartes/garde-jamais-api'); } catch (e) { ko++; console.log('❌ collecte-cartes/garde-jamais-api.js absent :', e.message); }
    if (G) {
        const trouve = (nom, texte) => G.analyserTexte(nom, texte).map(v => [v.fichier, v.ligne]);
        verifier('NON : une adresse d\'API pokemontcg.io, ligne 3, est nommée avec son fichier', trouve('faux/appel.js', `const a = 1;\n// rien\nfetch('${API_PTCG}/v2/cards');\n`), [['faux/appel.js', 3]]);
        verifier('NON : l\'API Scrydex, un sous-domaine quelconque et l\'apex sont refusés', trouve('faux/s.js', [API_SCRY + '/v1', adresse('https', '://www.scry', 'dex.com/'), adresse('https', '://scry', 'dex.com'), adresse('https', '://cdn.scry', 'dex.com/a')].join('\n')), [['faux/s.js', 1], ['faux/s.js', 2], ['faux/s.js', 3], ['faux/s.js', 4]]);
        verifier('NON : l\'hôte d\'API écrit sans schéma (les deux fournisseurs) est refusé aussi', trouve('faux/h.js', adresse("const H = '", 'api', '.pokemontcg', ".io';\nconst K = 'api.scry", "dex.com';")), [['faux/h.js', 1], ['faux/h.js', 2]]);
        verifier('NON : un hôte d\'images déguisé (suffixe ajouté) est refusé', trouve('faux/d.js', `${IMG_SCRY}.evil.example/x\n`), [['faux/d.js', 1]]);
        verifier('NON : pokemontcg.io nu suivi du chemin /v2 (API) est refusé', trouve('faux/v.md', adresse('GET pokemontcg', '.io/v2/cards')), [['faux/v.md', 1]]);
        // ➕ 2026-10-17 (PKMCOM-IMPORT) : pokemon.com — l'hôte d'IMAGES (chemin des cartes) seul ; www (pages vues par un humain) reste permis ; tout autre hôte ou chemin est refusé
        const pk = (...m) => m.join('');
        const PK_IMG = pk('https', '://assets.', 'pokemon', '.com/static-assets/content-assets/cms2/img/cards/web/SM2/SM2_EN_1.png');
        verifier('pokemon.com — NON : un hôte d\'API (api, graphql, sans schéma aussi), un chemin d\'API sur l\'hôte d\'images', trouve('faux/p.js', [pk('https', '://api.', 'pokemon', '.com/v1'), pk('https', '://graphql.', 'pokemon', '.com/'), pk('const h = "gateway.', 'pokemon', '.com";'), pk('https', '://assets.', 'pokemon', '.com/api/cards')].join('\n')), [['faux/p.js', 1], ['faux/p.js', 2], ['faux/p.js', 3], ['faux/p.js', 4]]);
        // 🔑 écrite par ce qu'elle AUTORISE : un hôte hors de la liste fermée est refusé SANS être nommé (cdn, shop, un nom inventé, un suffixe) ; les hôtes cités par le dépôt passent
        verifier('pokemon.com — NON : TOUT hôte hors de la liste fermée (cdn, shop, inconnu, suffixé), un chemin hors des cartes sur l\'hôte d\'images', trouve('faux/q.js', [pk('https', '://cdn.', 'pokemon', '.com/x'), pk('https', '://shop.', 'pokemon', '.com/'), pk('const h = "zzz.', 'pokemon', '.com";'), pk('https', '://www.', 'pokemon', '.com.evil.test/'), pk('https', '://assets.', 'pokemon', '.com/autre/chemin.png')].join('\n')), [['faux/q.js', 1], ['faux/q.js', 2], ['faux/q.js', 3], ['faux/q.js', 4], ['faux/q.js', 5]]);
        verifier('pokemon.com — OUI : la liste fermée (nu, www, press, image….cn, assets + chemin des cartes ou robots.txt)', trouve('faux/r.js', [pk('pokemon', '.com'), pk('https', '://press.', 'pokemon', '.com/x'), pk('https', '://image.', 'pokemon', '.com.cn/x'), PK_IMG, pk('https', '://assets.', 'pokemon', '.com/robots.txt')].join('\n')), []);
        verifier('pokemon.com — les deux fichiers de banc du userscript, NOMMÉS dans la garde, peuvent citer des formes hostiles ; un autre fichier non', [trouve('test-userscript-pokemoncom.js', pk('https', '://assets.', 'pokemon', '.com/x/SM2/SM2_EN_6.png')), trouve('faux/s.js', pk('https', '://assets.', 'pokemon', '.com/x/SM2/SM2_EN_6.png'))], [[], [['faux/s.js', 1]]]);
        verifier('pokemon.com — OUI : l\'adresse d\'une image de carte, robots.txt de l\'hôte d\'images, la page www vue par l\'humain, le nom nu de la source', trouve('faux/pok.js', [PK_IMG, pk('https', '://assets.', 'pokemon', '.com/robots.txt'), pk('https', '://www.', 'pokemon', '.com/us/pokemon-tcg/pokemon-cards'), "const SOURCE = 'pokemon.com';"].join('\n')), []);
        verifier('OUI : les deux hôtes d\'images, le nom de source et la prose ne sont pas des adresses d\'API', trouve('faux/ok.js', [`${IMG_PTCG}/cel25/5_hires.png`, `${IMG_SCRY}/pokemon/me55c-11/large`, "const SOURCE = 'pokemontcg.io';", "// jamais l'API Scrydex, jamais d'API : serveur d'images seulement", 'la source interne est pokemontcg.io (lot ptcgio-2026-10)'].join('\n')), []);
        // ➕ 2026-10-17 (PKMNCARDS) : l'hôte de la source de scans — robots.txt et le répertoire plat /wp-content/uploads/ SEULEMENT ; toute autre adresse du site est refusée, la recherche (?s=) en tête
        const sc = (...m) => m.join('');
        const SC = sc('pkmn', 'cards', '.com');
        verifier('pkmncards — NON : une page de carte, la racine, la recherche (?s=), l\'API WordPress, un sous-domaine, www, un hôte déguisé, une remontée de chemin', trouve('faux/k.js', [sc('https://', SC, '/card/a-b-1/'), sc('https://', SC, '/'), sc('https://', SC, '/?s=pikachu'), sc('https://', SC, '/wp-json/wp/v2/posts'),
            sc('https://api.', SC, '/x'), sc('https://www.', SC, '/wp-content/uploads/a.jpg'), sc('https://', SC, '.evil.example/wp-content/uploads/a.jpg'), sc('https://', SC, '/wp-content/uploads/../a.jpg'), sc('const h = "cdn.', SC, '";')].join('\n')),
            [['faux/k.js', 1], ['faux/k.js', 2], ['faux/k.js', 3], ['faux/k.js', 4], ['faux/k.js', 5], ['faux/k.js', 6], ['faux/k.js', 7], ['faux/k.js', 8], ['faux/k.js', 9]]);
        verifier('pkmncards — OUI : robots.txt, le répertoire plat des images, un fichier image, le nom nu de la source', trouve('faux/k2.js', [sc('https://', SC, '/robots.txt'), sc('https://', SC, '/wp-content/uploads/'), sc('https://', SC, '/wp-content/uploads/m23_en_012_std.png'), sc("const HOTE = '", SC, "';")].join('\n')), []);
        verifier('pkmncards — le nom d\'hôte de la garde est celui du module (une seule définition vérifiée)', require('./collecte-cartes/pkmncards').HOTE, SC);
        const faux = { 'faux/a.js': `x\n${API_PTCG}/v2/cards\n`, 'faux/b.md': 'rien\n', 'node_modules/p/i.js': `${API_PTCG}/v2/cards\n` };
        const r = G.scannerFichiers({ liste: Object.keys(faux), lire: f => faux[f] });
        verifier('le scan d\'une liste fabriquée nomme le fichier et la ligne, ignore node_modules, imprime son dénominateur', [r.violations.map(v => [v.fichier, v.ligne]), r.lus, r.ignores], [[['faux/a.js', 2]], 2, 1]);
        let leve = null; try { G.scannerFichiers({ liste: [], lire: () => '' }); } catch (e) { leve = e.message; }
        verifier('une liste vide LÈVE (un scan qui ne lit rien ne prouve rien)', /aucun fichier/.test(leve || ''), true);
        const reel = G.scannerDepot(__dirname);
        console.log(`   dépôt : ${reel.lus} fichiers suivis lus, ${reel.ignores} ignorés (node_modules, binaires, trop gros)`);
        verifier('LE DÉPÔT : aucune adresse d\'API pokemontcg.io ni scrydex dans les fichiers suivis', [reel.lus > 500, reel.violations.map(v => `${v.fichier}:${v.ligne} ${v.jeton}`)], [true, []]);
    }

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
