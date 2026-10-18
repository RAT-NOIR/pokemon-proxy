// node test-recepteur-pokedata.js — le relevé PASSIF au clic (userscript-pokedata.user.js + recepteur-pokedata.js) et la liste des pages à ouvrir.
// Aucune requête vers la source ; le récepteur écoute 127.0.0.1 sur un port éphémère, dossier TEMPORAIRE.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const P = require('./collecte-cartes/pokedata');
const R = require('./recepteur-pokedata');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const IMG = (set, f) => `https://pokemoncardimages.pokedata.io/images/${set}/${f}`;
const bon = () => ({ schema: 1, set: 'Trick or Trade 2024', url: 'https://www.pokedata.io/set/Trick+or+Trade+2024', cartes: [{ numero: '037a', nom: 'Mimikyu', img: IMG('Trick+or+Trade+2024', '037a.webp') }, { numero: '057a', nom: 'Gengar', img: IMG('Trick+or+Trade+2024', '057a.webp') }], diag: { imgs: 2, structure: ['DIV.MuiGrid-root / A / DIV.MuiCard-root / IMG[src,alt]'], complet: false } });

(async () => {
    // ── la liste des pages à ouvrir : ≤ 10, toutes valables ───────────────────────────────────────────────────────────────
    verifier('pages à ouvrir : au plus 10, toutes des pages de set de la table, adresses valables et distinctes', [P.PAGES_A_OUVRIR.length <= 10, P.PAGES_A_OUVRIR.length, P.PAGES_A_OUVRIR.every(u => P.urlPageValide(u)), new Set(P.PAGES_A_OUVRIR).size === P.PAGES_A_OUVRIR.length], [true, 10, true, true]);
    verifier('pages à ouvrir : Trick or Trade 2024 et McDonald\'s Promos 2019 (le plus gros trou) en font partie', [P.PAGES_A_OUVRIR.includes(P.urlPageDuSet('Trick or Trade 2024')), P.PAGES_A_OUVRIR.includes(P.urlPageDuSet("McDonald's Promos 2019"))], [true, true]);

    // ── le schéma du relevé ──────────────────────────────────────────────────────────────────────────────────────────────
    verifier('schéma : un relevé conforme est accepté', R.validerReleve(bon()).ok, true);
    const cas = {
        'schéma inconnu': o => { o.schema = 2; }, 'set hors de la table': o => { o.set = 'Nope Set'; }, 'adresse de page d\'un autre hôte': o => { o.url = 'https://autre.example/set/x'; },
        'adresse de page d\'API': o => { o.url = 'https://www.pokedata.io/api/set/x'; }, 'image _240w': o => { o.cartes[0].img = IMG('Trick+or+Trade+2024', '037a_240w.webp'); }, 'image d\'un autre hôte': o => { o.cartes[0].img = 'https://autre.example/x.webp'; },
        'image d\'un autre set que celui de la page': o => { o.cartes[0].img = IMG('Pitch+Black', '037a.webp'); }, 'clé en trop': o => { o.cartes[0].prix = '3 €'; }, 'clé de relevé en trop': o => { o.cookie = 'x'; },
        'numéro non conforme': o => { o.cartes[0].numero = '../x'; }, 'nom trop long': o => { o.cartes[0].nom = 'x'.repeat(400); }, 'trop de cartes': o => { o.cartes = Array.from({ length: 1001 }, () => o.cartes[0]); }, 'corps non objet': o => { throw 0; }
    };
    for (const [nom, f] of Object.entries(cas)) { const o = bon(); let v; try { f(o); v = R.validerReleve(o); } catch { v = R.validerReleve('x'); } verifier(`schéma refusé : ${nom}`, v.ok, false); }

    // ── le serveur : gardes d'entrée et écriture ─────────────────────────────────────────────────────────────────────────
    const dos = fs.mkdtempSync(path.join(os.tmpdir(), 'pdt-rec-'));
    // ── CORRECTION 2 : les gardes de chemin du dossier (liste blanche, résolution complète) ──────────────────────────────────
    verifier('--dossier : dans le dépôt => refusé', /dépôt/.test((() => { try { R.creerServeur({ dossier: path.join(__dirname, 'sortie'), racine: __dirname }); return ''; } catch (e) { return e.message; } })()), true);
    verifier('--dossier : hors de la racine autorisée => refusé', /racine autorisée/.test((() => { try { R.creerServeur({ dossier: path.join(os.tmpdir(), 'ailleurs'), racine: path.join(os.tmpdir(), 'racine-autre') }); return ''; } catch (e) { return e.message; } })()), true);
    verifier('--dossier : un dossier d\'apports manuels (même sous la racine) => refusé', /apports manuels/.test((() => { try { R.creerServeur({ dossier: path.join(os.tmpdir(), 'apport-manuel', 'x'), racine: os.tmpdir() }); return ''; } catch (e) { return e.message; } })()), true);
    verifier('--dossier : une traversée (..) qui sort de la racine => refusée (chemin résolu)', /racine autorisée/.test((() => { try { R.creerServeur({ dossier: path.join(dos, '..', '..', 'evade'), racine: dos }); return ''; } catch (e) { return e.message; } })()), true);
    verifier('--dossier : un dossier sous la racine, hors dépôt, hors apports => accepté', typeof R.creerServeur({ dossier: dos, racine: os.tmpdir() }).listen, 'function');
    verifier('--dossier : CLI avec un dossier hors racine => refus, code non nul, rien n\'écoute', await (async () => { const x = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'recepteur-pokedata.js'), `--dossier=${path.join(os.tmpdir(), 'hors-racine')}`, '--port=18767'], { encoding: 'utf8', timeout: 20000 }); return [x.status, /racine autorisée/.test(x.stderr || '')]; })(), [1, true]);
    const srv = R.creerServeur({ dossier: dos, racine: os.tmpdir() });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const poster = (corps, { chemin = '/releve', methode = 'POST', entetes = {} } = {}) => new Promise(res => {
        const data = typeof corps === 'string' ? corps : JSON.stringify(corps);
        const rq = http.request({ host: '127.0.0.1', port, path: chemin, method: methode, headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Content-Length': Buffer.byteLength(data), ...entetes } }, rs => { let t = ''; rs.on('data', c => t += c); rs.on('end', () => res({ statut: rs.statusCode, corps: t })); });
        rq.on('error', e => res({ erreur: e.code })); rq.end(data);
    });
    let r = await poster(bon());
    verifier('POST conforme : 200, un fichier releve--*.json (schéma 1) et un diag--*.json écrits', [r.statut, fs.readdirSync(dos).filter(f => /^releve--.*\.json$/.test(f)).length, fs.readdirSync(dos).filter(f => /^diag--.*\.json$/.test(f)).length], [200, 1, 1]);
    const lu = P.lireReleves(dos);
    verifier('le relevé écrit est relu par lireReleves (le plan le consomme) : 2 cartes, set de la table', [lu.cartes.length, lu.cartes[0].set, lu.ignores.length], [2, 'Trick or Trade 2024', 0]);
    verifier('le plan retrouve « 037a » depuis ce relevé (Mimikyu, slug …-037)', P.apparier({ trous: [{ idProduct: 1, carteId: 1, slugSet: 'Trick-or-Trade-2024', numeroFiche: null, slugProduit: 'Mimikyu-BOO24PAF-037', carte: { _id: 1, nomEn: 'Mimikyu', images: [] } }], cartes: lu.cartes, noms: new Map([['Trick-or-Trade-2024', new Map([['mimikyu', new Set([1])]])]]) }).plan.map(u => u.url), [IMG('Trick+or+Trade+2024', '037a.webp')]);
    verifier('GET : 405', (await poster('', { methode: 'GET' })).statut, 405);
    verifier('mauvais chemin : 404', (await poster(bon(), { chemin: '/autre' })).statut, 404);
    verifier('sans l\'en-tête de marque : refusé (403)', (await poster(bon(), { entetes: { 'X-Rat-Market': 'non' } })).statut, 403);
    verifier('Origin d\'un autre site : refusée (403)', (await poster(bon(), { entetes: { Origin: 'https://autre.example' } })).statut, 403);
    verifier('Origin https://www.pokedata.io : acceptée', (await poster(bon(), { entetes: { Origin: 'https://www.pokedata.io' } })).statut, 200);
    verifier('Host étranger : refusé', (await poster(bon(), { entetes: { Host: 'evil.example' } })).statut, 403);
    verifier('Content-Type autre que JSON : 415', (await poster(bon(), { entetes: { 'Content-Type': 'text/plain' } })).statut, 415);
    verifier('JSON illisible : 400', (await poster('{pas du json')).statut, 400);
    verifier('corps trop gros : 413', (await poster(JSON.stringify({ x: 'y'.repeat(1.2 * 1024 * 1024) }))).statut, 413);
    verifier('relevé non conforme : 400/422 et RIEN d\'écrit en plus', await (async () => { const avant = fs.readdirSync(dos).length; const o = bon(); o.cartes[0].img = IMG('Trick+or+Trade+2024', '037a_240w.webp'); const x = await poster(o); return [[400, 422].includes(x.statut), fs.readdirSync(dos).length === avant]; })(), [true, true]);
    // ── CORRECTION 2 : le diag n'est qu'un résumé STRUCTUREL ; le numéro est recoupé ; un relevé partiel n'écrase pas un plus complet ──
    { const x = bon(); x.diag = { imgs: 2, exemples: ['<div>texte</div>'], complet: false }; verifier('diag : l\'ancien champ « exemples » (HTML) est REFUSÉ', R.validerReleve(x).ok, false); }
    for (const [nom, st] of [['du texte', ['DIV / A / Pikachu 12,50 €']], ['un attribut autre que src/alt', ['DIV.x / IMG[src,alt,onclick=1]']], ['une chaîne trop longue', ['DIV.' + 'a'.repeat(400) + ' / IMG[src,alt]']], ['plus de 5 entrées', Array(6).fill('DIV / IMG[src,alt]')], ['une balise HTML', ['<div>']], ['un chemin qui ne finit pas par l\'image', ['DIV / A']]]) { const x = bon(); x.diag.structure = st; verifier(`diag : une structure avec ${nom} est refusée`, R.validerReleve(x).ok, false); }
    { const x = bon(); x.diag.structure = ['DIV.MuiBox-root / A / DIV.card-1 / IMG[src,alt]', 'UL / LI / IMG[src,alt]', 'IMG[src,alt]']; verifier('diag : chemins de balises et noms de classes, bornés => accepté', R.validerReleve(x).ok, true); }
    { const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'pdt-rec3-')); const s3 = R.creerServeur({ dossier: d3, racine: os.tmpdir() }); await new Promise(r => s3.listen(0, '127.0.0.1', r)); const p3 = s3.address().port;
      const po = corps => new Promise(res => { const data = JSON.stringify(corps); const rq = http.request({ host: '127.0.0.1', port: p3, path: '/releve', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Content-Length': Buffer.byteLength(data) } }, rs => { rs.resume(); rs.on('end', () => res(rs.statusCode)); }); rq.end(data); });
      const complet = bon(); complet.diag.complet = true;
      await po(complet);
      const partiel = bon(); partiel.cartes = [partiel.cartes[0]]; partiel.diag.complet = false;
      verifier('relevé partiel après un relevé complet : accepté (200)', await po(partiel), 200);
      const fich = JSON.parse(fs.readFileSync(path.join(d3, 'releve--Trick-or-Trade-2024.json'), 'utf8'));
      verifier('   mais le fichier garde TOUT : 2 cartes, « complet » vrai (fusion sans perte)', [fich.cartes.length, fich.complet], [2, true]);
      const autre = bon(); autre.cartes = [{ numero: '099a', nom: 'Darkrai', img: IMG('Trick+or+Trade+2024', '099a.webp') }];
      await po(autre);
      verifier('   un relevé avec une carte NEUVE s\'ajoute (3 cartes), sans doublon d\'adresse', JSON.parse(fs.readFileSync(path.join(d3, 'releve--Trick-or-Trade-2024.json'), 'utf8')).cartes.map(c => c.numero).sort(), ['037a', '057a', '099a']);
      const faux = bon(); faux.cartes = [{ numero: '999', nom: 'Mimikyu', img: IMG('Trick+or+Trade+2024', '037b.webp') }];
      await po(faux);
      const ff = JSON.parse(fs.readFileSync(path.join(d3, 'releve--Trick-or-Trade-2024.json'), 'utf8')).cartes.find(c => c.img.endsWith('037b.webp'));
      verifier('numéro qui contredit le nom de fichier de l\'image : la carte est gardée MARQUÉE « numeroDoute » (numéro = celui du fichier) et le plan l\'ignore', [ff?.numero, ff?.numeroDoute, P.lireReleves(d3).cartes.some(c => c.img.endsWith('037b.webp')), P.lireReleves(d3).douteuses], ['037b', true, false, 1]);
      s3.close(); }
    // ── POKEDATA-SUITE : le récepteur DIT ce qu'il fait (le testeur ne savait pas si un relevé était arrivé) ──
    { const d5 = fs.mkdtempSync(path.join(os.tmpdir(), 'pdt-rec5-')); const lignes = [];
      const s5 = R.creerServeur({ dossier: d5, racine: os.tmpdir(), journal: l => lignes.push(l) }); await new Promise(r => s5.listen(0, '127.0.0.1', r)); const p5 = s5.address().port;
      const po = (corps, { chemin = '/releve', entetes = {} } = {}) => new Promise(res => { const data = typeof corps === 'string' ? corps : JSON.stringify(corps); const rq = http.request({ host: '127.0.0.1', port: p5, path: chemin, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Content-Length': Buffer.byteLength(data), ...entetes } }, rs => { rs.resume(); rs.on('end', () => res(rs.statusCode)); }); rq.on('error', e => res(e.code)); rq.end(data); });
      await po(bon());
      verifier('console : un relevé ACCEPTÉ => « reçu : <set> — 2 cartes (total du set dans le fichier : 2) »', lignes, ['reçu : Trick or Trade 2024 — 2 cartes (total du set dans le fichier : 2)']);
      lignes.length = 0; const neuf = bon(); neuf.cartes = [{ numero: '099a', nom: 'Darkrai', img: IMG('Trick+or+Trade+2024', '099a.webp') }]; await po(neuf);
      verifier('console : un second relevé du même set => 1 carte reçue, total du set dans le fichier : 3 (fusion sans perte)', lignes, ['reçu : Trick or Trade 2024 — 1 cartes (total du set dans le fichier : 3)']);
      lignes.length = 0; const mauvais = bon(); mauvais.cartes[0].img = IMG('Trick+or+Trade+2024', '037a_240w.webp'); mauvais.cartes[0].nom = 'SECRET-DU-CORPS'; mauvais.set = 'SET-INVENTE-SECRET';
      const st1 = await po(mauvais);
      verifier('console : un relevé REFUSÉ => « refusé : <motif> » sans contenu du corps (ni nom de carte, ni valeur envoyée)', [st1, lignes.length, /^refusé : /.test(lignes[0] || ''), /SECRET/.test(lignes.join('')), /hors de la table/.test(lignes[0] || '')], [422, 1, true, false, false]);
      verifier('console : le refus s\'écrit « refusé : HTTP <statut> — <catégorie fixe> »', lignes[0], 'refusé : HTTP 422 — set');
      lignes.length = 0;
      { const a = bon(); a.schema = 'SECRET-XYZ'; const b = bon(); b.set = 'SECRET-SET'; const c = bon(); c['SECRET-CLE'] = 1; const e = bon(); e.cartes[0]['SECRET-CLE'] = 2; const f = bon(); f.cartes[0].numero = 'SECRET/NUM'; const g = bon(); g.url = 'https://SECRET.example/x'; const h = bon(); h.diag = { SECRET: 1 };
        for (const o of [a, b, c, e, f, g, h]) await po(o);
        verifier('console : schéma « SECRET-XYZ », set « SECRET-SET », clés « SECRET-CLE », numéro, adresse, diag => AUCUNE de ces chaînes dans la console', [lignes.length, /SECRET/i.test(lignes.join('\n'))], [7, false]);
        verifier('console : chaque refus porte une catégorie fixe', lignes.every(l => /^refusé : HTTP \d{3} — [a-zéêè ]+$/.test(l)), true);
        verifier('console : catégories (schéma, set, clés, carte, adresse de page, diag)', lignes.map(l => l.split(' — ')[1]), ['schéma', 'set', 'clés', 'carte', 'carte', 'adresse de page', 'diag']); }
      lignes.length = 0;
      lignes.length = 0; await po('{pas du json'); await po(bon(), { entetes: { 'X-Rat-Market': 'non' } }); await po(bon(), { chemin: '/autre' });
      verifier('console : JSON illisible, marque absente, mauvais chemin => une ligne « refusé : … » chacun', [lignes.length, lignes.every(l => /^refusé : /.test(l))], [3, true]);
      lignes.length = 0; { const o = bon(); o.cle = 1; await po(o); }
      verifier('console : le motif d\'un schéma refusé ne recopie pas les clés reçues', [/refusé : /.test(lignes[0] || ''), /cle/.test(lignes[0] || '')], [true, false]);
      s5.close();
      const vu = []; const lg = console.log; console.log = (...a) => vu.push(a.join(' '));
      let d6, s6, p6; try { d6 = fs.mkdtempSync(path.join(os.tmpdir(), 'pdt-rec6-')); s6 = R.creerServeur({ dossier: d6, racine: os.tmpdir() }); await new Promise(r => s6.listen(0, '127.0.0.1', r)); p6 = s6.address().port;
        await new Promise(res => { const data = JSON.stringify(bon()); const rq = http.request({ host: '127.0.0.1', port: p6, path: '/releve', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Content-Length': Buffer.byteLength(data) } }, rs => { rs.resume(); rs.on('end', res); }); rq.end(data); }); }
      finally { console.log = lg; if (s6) s6.close(); }
      verifier('console : sans réglage, la sortie est la console du processus (capturée ici)', vu.some(l => /^reçu : Trick or Trade 2024 — 2 cartes/.test(l)), true);
      verifier('console : au démarrage, une ligne « écoute sur http://127.0.0.1:<port>/releve — dossier <chemin> »', R.ligneDeDemarrage(8767, 'C:\\x\\releves'), 'écoute sur http://127.0.0.1:8767/releve — dossier C:\\x\\releves');
      verifier('console : le CLI imprime cette ligne (et plus l\'ancienne « récepteur sur »)', [/ligneDeDemarrage\(/.test(fs.readFileSync(path.join(__dirname, 'recepteur-pokedata.js'), 'utf8').split('require.main !== module')[1] || ''), /récepteur sur http/.test(fs.readFileSync(path.join(__dirname, 'recepteur-pokedata.js'), 'utf8'))], [true, false]);
    }
    // 🔴 CORRECTION 3 (B2) : un fichier de relevé corrompu (JSON valide mais de forme inattendue) ne fait pas planter le récepteur
    { const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'pdt-rec4-')); const s4 = R.creerServeur({ dossier: d4, racine: os.tmpdir() }); await new Promise(r => s4.listen(0, '127.0.0.1', r)); const p4 = s4.address().port;
      const po = corps => new Promise(res => { const data = JSON.stringify(corps); const rq = http.request({ host: '127.0.0.1', port: p4, path: '/releve', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Content-Length': Buffer.byteLength(data) } }, rs => { let t = ''; rs.on('data', c => t += c); rs.on('end', () => res(rs.statusCode)); }); rq.on('error', e => res(e.code)); rq.end(data); });
      fs.writeFileSync(path.join(d4, 'releve--Trick-or-Trade-2024.json'), JSON.stringify({ schema: 1, set: 'Trick or Trade 2024', complet: true, cartes: 5 }));
      const lu = console.error, journal = []; console.error = (...a) => journal.push(a.join(' '));
      let r1; try { r1 = await po(bon()); } finally { console.error = lu; }
      verifier('relevé existant corrompu (cartes: 5) : réponse 500 propre, le processus ne plante pas, l\'erreur est journalisée', [r1, journal.some(l => /relevé|corrompu|erreur/i.test(l))], [500, true]);
      fs.unlinkSync(path.join(d4, 'releve--Trick-or-Trade-2024.json'));
      verifier('   et le récepteur répond encore ensuite (200 sur un relevé conforme)', await po(bon()), 200);
      s4.close(); }
    // un flux SANS Content-Length déclaré : la borne se compte sur le flux
    verifier('corps de 1,2 Mo sans Content-Length (flux) : 413, la borne se compte aussi sur le flux', await new Promise(res => {
        const rq = http.request({ host: '127.0.0.1', port, path: '/releve', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Transfer-Encoding': 'chunked' } }, rs => { rs.resume(); rs.on('end', () => res(rs.statusCode)); });
        rq.on('error', e => res(e.code)); rq.write('{"x":"'); rq.write('y'.repeat(1.2 * 1024 * 1024)); rq.end('"}');
    }), 413);
    srv.close();
    verifier('le récepteur écoute 127.0.0.1 seulement (l\'hôte n\'est pas réglable)', [R.HOTE, /listen\([^)]*0\.0\.0\.0/.test(fs.readFileSync(path.join(__dirname, 'recepteur-pokedata.js'), 'utf8'))], ['127.0.0.1', false]);

    // ── le userscript : passif ───────────────────────────────────────────────────────────────────────────────────────────
    const us = fs.readFileSync(path.join(__dirname, 'userscript-pokedata.user.js'), 'utf8');
    const matchs = (us.match(/^\/\/ @match\s+(\S+)$/gm) || []).map(l => l.replace(/^\/\/ @match\s+/, ''));
    verifier('userscript : @match = LISTE FERMÉE des 10 pages à ouvrir (adresses exactes, apostrophe brute ou %27 : 17 écritures, jamais /set/*), ne parle qu\'à 127.0.0.1, @noframes', [matchs.slice().sort().join('|') === [...new Set(P.PAGES_A_OUVRIR.flatMap(u => [u, u.replace(/%27/g, "'")]))].sort().join('|'), matchs.length, matchs.some(m => /\*/.test(m)), /@connect\s+127\.0\.0\.1/.test(us), /@connect\s+(?!127\.0\.0\.1)\S+/.test(us), /^\/\/ @noframes$/m.test(us)], [true, 17, false, true, false, true]);
    // la GARDE STATIQUE commune (profil pokedata) : AUCUNE violation sur le fichier ; un script modifié échoue
    const G = require('./collecte-cartes/garde-userscript-passif');
    verifier('garde statique (profil pokedata) : 0 violation sur userscript-pokedata.user.js', G.violations(us, 'pokedata'), []);
    verifier('garde statique : le profil pokedata n\'ouvre pas les autres (le script, jugé par le profil par défaut ou par cardmarket-fiche, est refusé)', [G.violations(us).length > 0, G.violations(us, 'cardmarket-fiche').length > 0], [true, true]);
    verifier('garde statique : le profil pokedata refuse un script d\'un autre profil (celui de pokemon.com n\'existe pas ici : le script de Collectorviper est refusé)', fs.existsSync(path.join(__dirname, 'userscript-collectorviper.user.js')) ? G.violations(fs.readFileSync(path.join(__dirname, 'userscript-collectorviper.user.js'), 'utf8'), 'pokedata').length > 0 : true, true);
    for (const [nom, f] of Object.entries({ 'outerHTML ajouté': s => s.replace('(function () {', '(function () { var x = document.body.outerHTML;'), 'une @match de plus (hors liste)': s => s.replace('// @noframes', '// @match https://www.pokedata.io/set/Pitch+Black\n// @noframes'), 'une @match de la liste en moins': s => s.replace(/\/\/ @match .*\n/, ''), '@noframes retirée': s => s.replace('// @noframes\n', ''), 'un gabarit à backticks': s => s.replace("'use strict';", "'use strict'; var t = `x`;"), 'un setTimeout': s => s.replace("'use strict';", "'use strict'; setTimeout(function () { }, 10);"), 'une lecture de la propriété setTimeout': s => s.replace("'use strict';", "'use strict'; document.setTimeout;"), 'une lecture de la propriété outerHTML': s => s.replace("'use strict';", "'use strict'; document.outerHTML;"), 'un second GM_xmlhttpRequest': s => s.replace("'use strict';", "'use strict'; GM_xmlhttpRequest({});"), 'un autre hôte dans une chaîne': s => s.replace("'use strict';", "'use strict'; var h = 'https://autre.example/x';"), 'une directive @require': s => s.replace('// @noframes', '// @require https://x.example/a.js\n// @noframes'), 'une méthode hors liste (getAttribute)': s => s.replace("'use strict';", "'use strict'; document.body.getAttribute('x');") })) verifier(`garde statique : ${nom} => violation`, G.violations(f(us), 'pokedata').length > 0, true);
    verifier('userscript : aucune navigation, aucun clic automatique, aucun fetch/XHR vers la source (GM_xmlhttpRequest vers 127.0.0.1 seul)', [/location\.(href|assign|replace)\s*=|window\.open|\.click\(\)|\bfetch\(|new XMLHttpRequest|\.submit\(\)/.test(us), /GM_xmlhttpRequest/.test(us), /http:\/\/127\.0\.0\.1:8767\/releve/.test(us)], [false, true, true]);
    verifier('userscript : transforme les vignettes _240w en adresse pleine taille et ne lit aucun cookie ni stockage', [/_240w/.test(us) && /replace\(/.test(us), /document\.cookie|localStorage|sessionStorage|GM_getValue|GM_setValue/.test(us)], [true, false]);
    // le userscript EXÉCUTÉ dans un DOM simulé : une vignette _240w ressort en pleine taille, un clic envoie UN POST à 127.0.0.1, rien d'autre
    { const vm = require('vm'); const posts = []; let clic = null;
      const parent = { tagName: 'A', className: 'lien', textContent: 'SECRET 12,50 €', outerHTML: '<a>SECRET</a>', parentElement: { tagName: 'DIV', className: 'MuiGrid-root item', textContent: 'AUTRE TEXTE', parentElement: null } };
      const img = (src, alt) => ({ currentSrc: src, src, alt, title: 'TITRE SECRET', tagName: 'IMG', className: '', parentElement: parent });
      const bouton = { style: {}, addEventListener: (e, f) => { clic = f; }, set textContent(v) { } };
      const ctx = { document: { images: [img(IMG('Trick+or+Trade+2024', '037a_240w.webp'), 'Mimikyu'), img(IMG('Trick+or+Trade+2024', '037a_240w.webp'), 'Mimikyu'), img('https://autre.example/x.webp', 'X'), img(IMG('Trick+or+Trade+2024', '057a.webp'), 'Gengar')], createElement: () => bouton, body: { appendChild() { } } },
          location: { pathname: '/set/Trick+or+Trade+2024', origin: 'https://www.pokedata.io' }, GM_xmlhttpRequest: o => posts.push(o) };
      vm.runInNewContext(us, ctx); clic();
      const env = posts[0] && JSON.parse(posts[0].data);
      verifier('userscript exécuté : un clic = UN POST vers 127.0.0.1, la vignette _240w ressort en pleine taille, doublons et autres hôtes écartés', [posts.length, posts[0]?.url, env?.cartes.map(c => [c.numero, c.nom, c.img]), R.validerReleve(env).ok],
          [1, 'http://127.0.0.1:8767/releve', [['037a', 'Mimikyu', IMG('Trick+or+Trade+2024', '037a.webp')], ['057a', 'Gengar', IMG('Trick+or+Trade+2024', '057a.webp')]], true]); }
    { const vm = require('vm'); const posts = []; let clic = null;
      const parent = { tagName: 'A', className: 'lien', textContent: 'SECRET 12,50 €', parentElement: null };
      const img = { currentSrc: IMG("McDonald's+Promos+2019", '039.webp'), src: '', alt: 'Kangaskhan', title: 'TITRE SECRET', tagName: 'IMG', className: '', parentElement: parent };
      const ctx = { document: { images: [img], createElement: () => ({ style: {}, addEventListener: (e, f) => { clic = f; } }), body: { appendChild() { } } }, location: { pathname: "/set/McDonald's+Promos+2019", origin: 'https://www.pokedata.io' }, GM_xmlhttpRequest: o => posts.push(o) };
      vm.runInNewContext(us, ctx); clic();
      const env = JSON.parse(posts[0].data);
      verifier('userscript exécuté : nom de set avec apostrophe lu dans l\'adresse de la page ; AUCUN texte de la page ni outerHTML envoyé (ni « SECRET »), diag = chemin de balises et classes', [env.set, env.cartes.length, /SECRET|<|outerHTML/.test(posts[0].data), env.diag.structure, R.validerReleve(env).ok], ["McDonald's Promos 2019", 1, false, ['A.lien / IMG[src,alt]'], true]); }
    verifier('userscript : la marque et la valeur du récepteur sont les mêmes que celles du récepteur', us.includes(R.ENTETE_MARQUE) && us.includes(R.VALEUR_MARQUE), true);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error('❌', e.stack || e.message); process.exitCode = 1; });
