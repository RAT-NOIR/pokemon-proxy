// node test-recepteur-images-pikaqian.js — le chemin POST /images du récepteur passif (lot P2, 2026-10-13) : les octets que le navigateur du testeur a lus, reçus par lots bornés.
// Aucun réseau extérieur : un serveur sur un port ÉPHÉMÈRE de 127.0.0.1, des pages et des images fabriquées (sharp), des dossiers temporaires HORS du dépôt.
// PK_RECEPTEUR (rouge-recepteur-pikaqian.js) : un récepteur MUTANT à tester à la place du vrai — chaque garde « image » retirée, seule, doit faire échouer ce banc.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const sharp = require('sharp');
const P = require('./collecte-cartes/pikaqian');
const R = require(process.env.PK_RECEPTEUR ? path.resolve(process.env.PK_RECEPTEUR) : './recepteur-pikaqian');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tuile = (n, code, num, nom) => `<a class="w-full group" data-discover="true" href="/cards/${UUID(n)}"><div class="x"><img alt="${nom}" src="https://images.pikaqian.com/${code}/${UUID(n)}.webp" loading="lazy"/></div><h2 class="t">${nom}</h2><p class="font-mono text-xs">${code}<!-- --> · ${num}</p></a>`;
const page = (...t) => `<!DOCTYPE html><html><head><title>Set</title></head><body>${t.join('')}</body></html>`;
const TROIS = [tuile(1, 'cs1bc', '001', 'Pikachu'), tuile(2, 'cs1bc', '002', 'Raichu'), tuile(3, 'cs1bc', '003', 'Pichu')];
const URL_BONNE = 'https://pikaqian.com/sets/cs1bc';
const SRC = n => `https://images.pikaqian.com/cs1bc/${UUID(n)}.webp`;
const BON = { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE };

function envoyer(port, { methode = 'POST', chemin = '/images', entetes = BON, corps = null, brut = null } = {}) {
    return new Promise(resolve => {
        const donnees = brut ?? (corps == null ? null : JSON.stringify(corps));
        const h = { ...entetes };
        if (donnees != null) h['Content-Length'] = Buffer.byteLength(donnees);
        const req = http.request({ host: '127.0.0.1', port, method: methode, path: chemin, headers: h }, res => {
            const morceaux = [];
            res.on('data', c => morceaux.push(c));
            res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { } resolve({ status: res.statusCode, json: j }); });
        });
        req.on('error', e => resolve({ status: 0, erreur: e.code || e.message }));
        if (donnees != null) req.write(donnees);
        req.end();
    });
}
const couleur = (r, g, b, w = 300, h = 416) => ({ create: { width: w, height: h, channels: 3, background: { r, g, b } } });

(async () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-img-'));
    const dossier = path.join(racine, 'fiches'), dossierImages = path.join(racine, 'passif');
    const journal = [];
    let nettoyageSur = false, cibleJetable = null, horsRacine = null;
    const srv = await R.demarrer({ racine, port: 0, dossier, dossierImages, attendu: () => null, journal: m => journal.push(m) });
    const port = srv.port;
    try {
        // ── la page d'abord : la fiche ET le fichier de page
        const ap = await envoyer(port, { chemin: '/apprendre', corps: { url: URL_BONNE, html: page(...TROIS) } });
        const fiche = ap.json?.fichier;
        verifier('la page est apprise (200) et nomme sa fiche', [ap.status, /^cs1bc--\d{8}T\d{6}Z\.json$/.test(fiche || '')], [200, true]);
        const pageFichier = path.join(dossierImages, 'cs1bc', `page--${(fiche || '').replace(/\.json$/, '')}.json`);
        const lirePage = () => JSON.parse(fs.readFileSync(pageFichier, 'utf8'));
        verifier('le fichier de PAGE existe dans <dossierImages>/<codePk>/ : code, date, tuiles, rien reçu, rien refusé', [fs.existsSync(pageFichier), lirePage().code, lirePage().tuiles.map(t => t.id), Object.keys(lirePage().recues), Object.keys(lirePage().refusees), typeof lirePage().le], [true, 'cs1bc', [UUID(1), UUID(2), UUID(3)], [], [], 'string']);

        const imWebp = await sharp(couleur(200, 30, 30)).webp().toBuffer();
        const imPng = await sharp(couleur(30, 200, 30)).png().toBuffer();
        const imJpg = await sharp(couleur(30, 30, 200)).jpeg().toBuffer();
        const entree = (n, nom, num, octets, extra = {}) => ({ id: UUID(n), src: SRC(n), nom, numero: num, voie: 'canvas', b64: octets.toString('base64'), ...extra });
        const lot = (images, extra = {}) => ({ fichier: fiche, images, sansImage: 0, ...extra });
        const dansDossier = () => fs.existsSync(path.join(dossierImages, 'cs1bc')) ? fs.readdirSync(path.join(dossierImages, 'cs1bc')).filter(n => !/^page--/.test(n)).sort() : [];

        // ── ce que la garde AUTORISE : trois images valides (webp, png, jpeg), nom et numéro de la page
        let r = await envoyer(port, { corps: lot([entree(1, 'Pikachu', '001', imWebp), entree(2, 'Raichu', '002', imPng, { voie: 'cache' }), entree(3, 'Pichu', '003', imJpg, { voie: 'navigateur' })]) });
        verifier('lot de 3 images valides : 200, 3 reçues, 3 nouvelles, 0 refusée', [r.status, r.json?.ok, r.json?.recues, r.json?.nouvelles, r.json?.deja, r.json?.refusees], [200, true, 3, 3, 0, []]);
        const f1 = dansDossier();
        verifier('chaque image est un fichier <id>--<sha12>.<ext> dans <dossierImages>/cs1bc/ (extension d\'après le format DÉCODÉ)', f1, [
            `${UUID(1)}--${crypto.createHash('sha256').update(imWebp).digest('hex').slice(0, 12)}.webp`,
            `${UUID(2)}--${crypto.createHash('sha256').update(imPng).digest('hex').slice(0, 12)}.png`,
            `${UUID(3)}--${crypto.createHash('sha256').update(imJpg).digest('hex').slice(0, 12)}.jpg`].sort());
        verifier('… et les octets écrits sont ceux reçus', fs.readFileSync(path.join(dossierImages, 'cs1bc', f1.find(n => n.endsWith('.png')))).equals(imPng), true);
        const p1 = lirePage();
        verifier('le fichier de page dit : reçues (empreinte, dimensions, format, voie), sansImage, nombre de lots', [Object.keys(p1.recues).length, p1.recues[UUID(1)][0].sha256 === crypto.createHash('sha256').update(imWebp).digest('hex'), p1.recues[UUID(1)][0].w, p1.recues[UUID(1)][0].h, p1.recues[UUID(1)][0].fmt, p1.recues[UUID(2)][0].voie, p1.sansImageDansLeNavigateur, p1.lots], [3, true, 300, 416, 'webp', 'cache', 0, 1]);

        // ── JAMAIS ÉCRASÉE
        r = await envoyer(port, { corps: lot([entree(1, 'Pikachu', '001', imWebp)]) });
        verifier('la même image une seconde fois : « déjà là », aucun fichier de plus, le fichier de page ne duplique pas', [r.json?.recues, r.json?.nouvelles, r.json?.deja, dansDossier().length, lirePage().recues[UUID(1)].length], [1, 0, 1, 3, 1]);
        const autre = await sharp(couleur(10, 10, 10)).webp().toBuffer();
        r = await envoyer(port, { corps: lot([entree(1, 'Pikachu', '001', autre)]) });
        verifier('d\'AUTRES octets pour la même tuile : un fichier de plus, le premier intact, les deux empreintes au fichier de page', [r.json?.nouvelles, dansDossier().length, fs.readFileSync(path.join(dossierImages, 'cs1bc', f1.find(n => n.endsWith('.webp')))).equals(imWebp), lirePage().recues[UUID(1)].length], [1, 4, true, 2]);

        // ── ce qu'elle REFUSE, image par image : le motif est dit, rien n'est écrit, les AUTRES images du lot passent
        const avant = dansDossier().length;
        const refusImage = async (nom, im, motif) => {
            const x = await envoyer(port, { corps: lot([im]) });
            verifier(`image refusée — ${nom} : 200 avec 0 reçue, 1 refusée (motif ${motif}), rien d'écrit, consignée au fichier de page`, [x.status, x.json?.recues, x.json?.refusees?.length, motif.test(x.json?.refusees?.[0]?.motif || ''), dansDossier().length === avant, !!lirePage().refusees[im.id]], [200, 0, 1, true, true, true]);
        };
        await refusImage('tuile inconnue de la page', { ...entree(1, 'Pikachu', '001', imWebp), id: UUID(9), src: SRC(9) }, /tuile inconnue/);
        await refusImage('adresse d\'une autre tuile', entree(1, 'Pikachu', '001', imWebp, { src: SRC(2) }), /ce n'est pas celle que la page déclare/);
        await refusImage('adresse d\'un autre hôte', entree(1, 'Pikachu', '001', imWebp, { src: `https://exemple.test/cs1bc/${UUID(1)}.webp` }), /ce n'est pas celle que la page déclare/);
        await refusImage('adresse dans le dossier d\'un autre set', entree(1, 'Pikachu', '001', imWebp, { src: `https://images.pikaqian.com/csv10c/${UUID(1)}.webp` }), /ce n'est pas celle que la page déclare/);
        await refusImage('nom du DOM différent du HTML', entree(1, 'Raichu', '001', imWebp), /deux lectures qui se contredisent/);
        await refusImage('numéro du DOM différent du HTML', entree(1, 'Pikachu', '002', imWebp), /deux lectures qui se contredisent/);
        await refusImage('voie inconnue', entree(1, 'Pikachu', '001', imWebp, { voie: 'robot' }), /voie/);
        await refusImage('clé en plus dans l\'image (cookie)', entree(1, 'Pikachu', '001', imWebp, { cookie: 'a=b' }), /mal formée/);
        await refusImage('octets qui ne sont pas du base64', entree(1, 'Pikachu', '001', imWebp, { b64: 'pas du base64 !' }), /illisibles ou au-delà de/);
        const gros = Buffer.alloc(P.IMAGE_MAX_OCTETS + 10, 7);
        await refusImage('au-delà de 2 Mo (déclaration par la longueur)', entree(1, 'Pikachu', '001', gros), /illisibles ou au-delà de/);
        await refusImage('octets qui ne sont pas une image', entree(1, 'Pikachu', '001', Buffer.from('<html>Just a moment</html>')), /ne se décodent pas/);
        await refusImage('image tronquée (l\'en-tête seul se lit)', entree(1, 'Pikachu', '001', imPng.subarray(0, 60)), /ne se décodent pas/);
        const bruitPng = await sharp(crypto.randomBytes(100 * 100 * 3), { raw: { width: 100, height: 100, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
        await refusImage('image tronquée EN PLEIN CORPS (l\'en-tête se lit, les pixels non : seul le décodage complet le voit)', entree(1, 'Pikachu', '001', bruitPng.subarray(0, Math.floor(bruitPng.length / 2))), /ne se décodent pas/);
        // TOUR 2 (relecture X, mineur) : l'EN-TÊTE QUI MENT. Un PNG fabriqué à la main dont l'en-tête (IHDR) déclare une taille et dont les données en portent une autre (CRC recalculés).
        {
            const zlib = require('zlib');
            const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]); };
            const pngMenteur = (largeurEntete, hauteurEntete, largeurDonnees, rangeesDonnees) => {
                const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largeurEntete, 0); ihdr.writeUInt32BE(hauteurEntete, 4); ihdr[8] = 8; ihdr[9] = 2;
                return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(rangeesDonnees * (1 + largeurDonnees * 3)))), chunk('IEND', Buffer.alloc(0))]);
            };
            global.__pngMenteur = pngMenteur;
            // (b) l'en-tête dit 4096 × 4096 (la borne), les données n'ont que 10 rangées : un fichier tronqué, que seul le décodage complet voit
            const gros = pngMenteur(4096, 4096, 4096, 10);
            await refusImage('en-tête qui ment à la borne (4096 × 4096 déclarés, 10 rangées de données)', entree(1, 'Pikachu', '001', gros), /ne se décodent pas/);
        }
        const gif = await sharp(couleur(1, 2, 3, 20, 20)).gif().toBuffer();
        await refusImage('format gif', entree(1, 'Pikachu', '001', gif), /format « gif »/);
        const large = await sharp(couleur(1, 2, 3, 4097, 1)).png().toBuffer();
        await refusImage('dimensions hors bornes (4097 × 1)', entree(1, 'Pikachu', '001', large), /dimensions 4097×1/);
        // TOUR 1 (passe B, important 3) : un PNG de quelques centaines de Ko qui se décoderait en 12000 × 12000 est refusé sur son EN-TÊTE, avant tout décodage de pixels
        const geant = await sharp({ create: { width: 12000, height: 12000, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png({ compressionLevel: 9 }).toBuffer();
        verifier('le PNG géant tient sous le plafond de 2 Mo (donc passe les contrôles de taille)', geant.length < P.IMAGE_MAX_OCTETS, true);
        await refusImage('PNG de moins de 2 Mo qui se décoderait en 12000 × 12000 (refusé sur l\'en-tête)', entree(1, 'Pikachu', '001', geant), /dimensions 12000×12000/);
        {
            // (a) l'en-tête dit 100 × 100, les données portent 100 × 6000 : refusé, ou accepté à la taille de l'EN-TÊTE — jamais plus grand que l'en-tête (en dernier : une acceptation écrit un fichier)
            const petit = global.__pngMenteur(100, 100, 100, 6000);
            const rep1 = await envoyer(port, { corps: lot([entree(1, 'Pikachu', '001', petit)]) });
            const dernier = (lirePage().recues[UUID(1)] ?? []).at(-1);
            verifier('en-tête qui ment (100 × 100 déclaré, 6000 rangées de données) : refusé, OU accepté à la taille de l\'EN-TÊTE — jamais une image plus grande que l\'en-tête', [rep1.status, rep1.json?.recues === 0 ? rep1.json?.refusees?.length === 1 : (dernier?.sha256 === crypto.createHash('sha256').update(petit).digest('hex') && dernier.w === 100 && dernier.h === 100)], [200, true]);
        }
        {
            const src = fs.readFileSync(process.env.PK_RECEPTEUR ? path.resolve(process.env.PK_RECEPTEUR) : path.join(__dirname, 'recepteur-pikaqian.js'), 'utf8');
            const j = src.slice(src.indexOf('async function jugerImages'));
            verifier('ordre dans le code : metadata() et les dimensions AVANT le décodage complet, et le décodage est borné par limitInputPixels', [j.indexOf('.metadata()') < j.indexOf('.raw()'), j.indexOf('GARDE:image-dimensions') < j.indexOf('.raw()'), /limitInputPixels: DIMENSION_MAX \* DIMENSION_MAX/.test(j)], [true, true, true]);
        }
        // un lot qui mêle bonne et mauvaise image : la bonne passe, la mauvaise est refusée avec son motif
        const bonne2 = await sharp(couleur(77, 77, 77)).webp().toBuffer();
        r = await envoyer(port, { corps: lot([entree(2, 'Raichu', '002', bonne2), entree(3, 'Faux', '003', imJpg)]) });
        verifier('lot mixte : une reçue, une refusée (nom), l\'état de l\'autre image est intact', [r.status, r.json?.recues, r.json?.refusees?.length, r.json?.refusees?.[0]?.id], [200, 1, 1, UUID(3)]);

        // ── ce qu'elle refuse EN BLOC
        const avantBloc = dansDossier().length;
        const bloc = async (nom, o, statut, motif) => {
            const x = await envoyer(port, o);
            verifier(`lot refusé — ${nom} : ${statut}, motif ${motif}, rien d'écrit`, [x.status, motif.test(x.json?.motif || ''), dansDossier().length === avantBloc], [statut, true, true]);
        };
        await bloc('clé en plus (url)', { corps: { ...lot([entree(1, 'Pikachu', '001', imWebp)]), url: URL_BONNE } }, 400, /seules fichier, images et sansImage/);
        await bloc('clé manquante (sansImage)', { corps: { fichier: fiche, images: [entree(1, 'Pikachu', '001', imWebp)] } }, 400, /seules fichier, images et sansImage/);
        await bloc('JSON illisible', { brut: '{pas du json' }, 400, /JSON/);
        await bloc('nom de fiche hors forme (traversée de dossier)', { corps: lot([entree(1, 'Pikachu', '001', imWebp)], { fichier: '../../secret.json' }) }, 422, /nom d'une fiche apprise/);
        await bloc('fiche qui n\'existe pas', { corps: lot([entree(1, 'Pikachu', '001', imWebp)], { fichier: 'cs1bc--20200101T000000Z.json' }) }, 404, /n'existe pas/);
        await bloc('sansImage négatif', { corps: lot([entree(1, 'Pikachu', '001', imWebp)], { sansImage: -1 }) }, 400, /sansImage/);
        await bloc('lot vide', { corps: lot([]) }, 413, /de 1 à 25 images/);
        await bloc('26 images', { corps: lot(Array.from({ length: 26 }, () => entree(1, 'Pikachu', '001', imWebp))) }, 413, /de 1 à 25 images/);
        const bruit = async n => sharp(crypto.randomBytes(700 * 700 * 3), { raw: { width: 700, height: 700, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
        const trois = [await bruit(), await bruit(), await bruit()];
        verifier('les trois images de bruit pèsent chacune moins de 2 Mo et ensemble plus de 4 Mo', [trois.every(b => b.length < P.IMAGE_MAX_OCTETS), trois.reduce((s, b) => s + b.length, 0) > R.LOT_OCTETS_MAX], [true, true]);
        await bloc('lot de plus de 4 Mo décodés', { corps: lot(trois.map((b, i) => entree(i + 1, ['Pikachu', 'Raichu', 'Pichu'][i], ['001', '002', '003'][i], b))) }, 413, /au-delà de 4194304/);

        // ── les gardes de /apprendre valent pour /images
        const nBloc = dansDossier().length;
        for (const [nom, o, statut] of [
            ['méthode GET', { methode: 'GET', corps: null }, 405], ['méthode OPTIONS', { methode: 'OPTIONS', corps: null }, 405],
            ['en-tête X-Rat-Market absent', { entetes: { 'Content-Type': 'application/json' }, corps: lot([entree(1, 'Pikachu', '001', imWebp)]) }, 403],
            ['Content-Type text/plain', { entetes: { ...BON, 'Content-Type': 'text/plain' }, corps: lot([entree(1, 'Pikachu', '001', imWebp)]) }, 415],
            ['Origin d\'un autre site', { entetes: { ...BON, Origin: 'https://exemple.test' }, corps: lot([entree(1, 'Pikachu', '001', imWebp)]) }, 403],
            ['Host étranger', { entetes: { ...BON, Host: 'evil.test' }, corps: lot([entree(1, 'Pikachu', '001', imWebp)]) }, 403],
            ['chemin /images?x=1', { chemin: '/images?x=1', corps: lot([entree(1, 'Pikachu', '001', imWebp)]) }, 404],
            ['chemin /images/', { chemin: '/images/', corps: lot([entree(1, 'Pikachu', '001', imWebp)]) }, 404]
        ]) { const x = await envoyer(port, o); verifier(`garde commune — ${nom} : ${statut}, rien d'écrit`, [x.status, dansDossier().length === nBloc], [statut, true]); }
        const okOrigin = await envoyer(port, { entetes: { ...BON, Origin: 'https://pikaqian.com' }, corps: lot([entree(2, 'Raichu', '002', imPng)]) });
        verifier('Origin https://pikaqian.com sur /images : acceptée', okOrigin.status, 200);

        // ── une page apprise une SECONDE fois a son propre fichier de page : les images d'une visite ne se mélangent pas à celles d'une autre
        await new Promise(res => setTimeout(res, 1100));
        const ap2 = await envoyer(port, { chemin: '/apprendre', corps: { url: URL_BONNE, html: page(...TROIS) } });
        const pages = fs.readdirSync(path.join(dossierImages, 'cs1bc')).filter(n => /^page--/.test(n));
        verifier('deux visites = deux fichiers de page', [ap2.status, pages.length], [200, 2]);

        // ── jamais dans le dépôt
        if (!process.env.PK_RECEPTEUR) {
            let leve = null; try { await R.demarrer({ racine, port: 0, dossier, dossierImages: path.join(__dirname, 'images-test'), journal: () => { } }); } catch (e) { leve = e.message; }
            verifier('un dossier d\'images DANS le dépôt : démarrage refusé, rien de créé', [/dépôt/.test(leve || ''), fs.existsSync(path.join(__dirname, 'images-test'))], [true, false]);
            verifier('le dossier par défaut est HORS dépôt et nomme pikaqian-passif', [R.dansLeDepot(R.DOSSIER_PASSIF_DEFAUT), /pikaqian-passif$/.test(R.DOSSIER_PASSIF_DEFAUT)], [false, true]);
        }
        // ── TOUR 2 (relecture X, important 1) : LA GARDE PRINCIPALE EST UNE RACINE AUTORISÉE, pas une liste de refus. Tout dossier hors de la racine est refusé, même s'il n'est pas dans les trois noms connus.
        const refuseDemarrage = async (nom, o, motif) => {
            let l = null; try { const s = await R.demarrer({ racine, port: 0, journal: () => { }, ...o }); await s.fermer(); } catch (e) { l = e.message; }
            verifier(`${nom} : démarrage refusé (${motif})`, new RegExp(motif).test(l || ''), true);
        };
        // Le Bureau réel n'est JAMAIS touché par le banc (un récepteur mutant y créerait des dossiers) : la forme « Desktop\autre » se juge par les fonctions pures ; le démarrage se juge sur un dossier
        // « rempli par le testeur » que le banc crée lui-même sous %TEMP%, HORS de sa racine (et qu'il supprime à la fin, sans jonction dedans).
        const dossierDuTesteur = path.join(os.homedir(), 'Desktop', 'autre-dossier-rempli-par-le-testeur', 'x');   // PAS dans les trois noms connus ; jamais créé
        verifier('« Desktop\\autre » : hors des 3 noms connus (la liste de refus le laisserait passer), mais HORS de la racine autorisée (la garde le refuse)', [R.dansApportsManuels(dossierDuTesteur), R.dansRacineAutorisee(dossierDuTesteur)], [false, false]);
        horsRacine = fs.mkdtempSync(path.join(os.tmpdir(), 'hors-racine-'));
        fs.writeFileSync(path.join(horsRacine, 'rempli-par-le-testeur.txt'), 'à lui');
        await refuseDemarrage('un dossier « rempli par le testeur » hors des 3 noms et hors de la racine', { dossier: path.join(horsRacine, 'autre') }, 'racine autorisée');
        await refuseDemarrage('un dossier d\'IMAGES hors de la racine', { dossier: path.join(racine, 'ok-fiches'), dossierImages: path.join(horsRacine, 'images') }, 'racine autorisée');
        verifier('… rien n\'a été créé chez le testeur', fs.readdirSync(horsRacine), ['rempli-par-le-testeur.txt']);
        verifier('la racine par défaut est celle du chantier ; ses dossiers par défaut y sont, le Bureau, %TEMP% et le dépôt non', [R.RACINE_AUTORISEE, R.dansRacineAutorisee(R.DOSSIER_DEFAUT), R.dansRacineAutorisee(R.DOSSIER_PASSIF_DEFAUT), R.dansRacineAutorisee(dossierDuTesteur), R.dansRacineAutorisee(os.tmpdir()), R.dansRacineAutorisee(path.join(os.homedir(), 'Desktop', 'pokemon-proxy'))],
            ['C:\\Users\\Yung\\rat-market-travail\\catalogue', true, true, false, false, false]);
        let lDefaut = null; try { const s = await R.demarrer({ port: 0, dossier: path.join(racine, 'sans-racine-donnee'), journal: () => { } }); await s.fermer(); } catch (e) { lDefaut = e.message; }
        verifier('SANS `racine` donnée (la voie de production), un dossier de bac est refusé', /racine autorisée/.test(lDefaut || ''), true);
        // second filet : les trois noms d'apports manuels, même SOUS la racine
        for (const nom of ['Logo FR', 'apport-manuel', path.join('Desktop', 'LOGO')]) {
            let l = null; const cible = path.join(racine, nom, 'sous', 'dossier');
            try { await R.demarrer({ racine, port: 0, dossier: cible, dossierImages: path.join(racine, 'ok-images'), journal: () => { } }); } catch (e) { l = e.message; }
            verifier(`second filet : un dossier dans « ${nom} » sous la racine : refusé (apports manuels), rien de créé`, [/apports manuels/.test(l || ''), fs.existsSync(path.join(racine, nom))], [true, false]);
        }
        let l2 = null; try { await R.demarrer({ racine, port: 0, dossier: path.join(racine, 'ok-fiches'), dossierImages: path.join(racine, 'Logo FR'), journal: () => { } }); } catch (e) { l2 = e.message; }
        verifier('second filet : le dossier d\'IMAGES dans un dossier d\'apports manuels : refusé aussi', /apports manuels/.test(l2 || ''), true);
        // ── TOUR 2 (relecture X, important 2) : une JONCTION qui sort de la racine est résolue. La cible est un dossier JETABLE que le banc crée lui-même (jamais le dépôt, jamais un vrai dossier),
        // avec un fichier témoin ; le retrait de la jonction (`rmdir`, sans /s) est VÉRIFIÉ, et sans cette preuve le banc ne fait AUCUN nettoyage récursif.
        cibleJetable = fs.mkdtempSync(path.join(os.tmpdir(), 'jonction-cible-'));
        fs.writeFileSync(path.join(cibleJetable, 'temoin.txt'), 'intact');
        const jonction = path.join(racine, 'jonction-vers-la-cible-jetable');
        fs.symlinkSync(cibleJetable, jonction, 'junction');
        try {
            await refuseDemarrage('une JONCTION (sous la racine) qui mène HORS de la racine est résolue', { dossier: path.join(racine, 'ok-fiches'), dossierImages: path.join(jonction, 'images') }, 'racine autorisée');
            verifier('… rien n\'a été créé derrière la jonction ; dansLeDepot résout la jonction vers un faux dépôt jetable', [fs.readdirSync(cibleJetable), R.dansLeDepot(path.join(jonction, 'x'), cibleJetable), R.dansLeDepot(path.join(jonction, 'x'), path.join(racine, 'ok-fiches'))], [['temoin.txt'], true, false]);
        } finally {
            const rm = require('child_process').spawnSync('cmd', ['/c', 'rmdir', jonction]);   // une jonction se retire par rmdir SANS /s, jamais par une suppression récursive
            nettoyageSur = rm.status === 0 && !fs.existsSync(jonction);
        }
        verifier('la jonction est retirée (rmdir status 0, jonction absente) et la cible témoin est INTACTE', [nettoyageSur, fs.readFileSync(path.join(cibleJetable, 'temoin.txt'), 'utf8')], [true, 'intact']);
    } finally { await srv.fermer(); }
    // aucun nettoyage récursif tant que la jonction n'est pas prouvée retirée ; sinon le banc échoue et laisse les dossiers temporaires en place (ils ne mènent qu'à un dossier jetable)
    if (nettoyageSur) { fs.rmSync(racine, { recursive: true, force: true }); fs.rmSync(cibleJetable, { recursive: true, force: true }); if (horsRacine) fs.rmSync(horsRacine, { recursive: true, force: true }); }
    else { ko++; console.log(`❌ la jonction n'a pas pu être retirée : AUCUN nettoyage récursif ; à retirer à la main (cmd /c rmdir, sans /s) : ${path.join(racine, 'jonction-vers-la-cible-jetable')}`); }
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc interrompu :', e); process.exit(1); });
