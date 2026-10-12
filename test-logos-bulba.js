// Banc des routes Bulbapedia des logos officiels (collecte-cartes/logos-bulba.js) : AUCUNE requête, base EN MÉMOIRE (base-banc.js), faux R2, faux client.
// Chaque garde doit savoir dire NON (§41) : états FABRIQUÉS.   node test-logos-bulba.js
const crypto = require('crypto');
const sharp = require('sharp');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const r2 = require('./collecte-cartes/r2');
const M = require('./collecter-logos-officiels');
const Bu = require('./collecte-cartes/logos-bulba');
const E = require('./collecte-cartes/bulba-espacement');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const logo = svg => sharp(Buffer.from(svg)).png().toBuffer();
const SVG_A = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="none"/><text x="10" y="60" font-size="60" fill="#d22" font-family="Arial">ABCD</text></svg>';
const SVG_B = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><circle cx="40" cy="40" r="35" fill="#22d"/><rect x="100" y="10" width="190" height="20" fill="#2a2"/></svg>';
const SVG_C = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect x="5" y="5" width="290" height="70" fill="#c80"/></svg>';

const ARCH = 'https://web.archive.org/web/2025im_/https://archives.bulbagarden.net/media/upload/a/a6/XY2_Logo.png';
const DIRECT = 'https://archives.bulbagarden.net/media/upload/a/a6/XY2_Logo.png';
const T0 = Date.parse('2026-10-15T19:29:00Z');
const L = (o = {}) => ({ part: 'JP', fichier: 'Logo JP/XY2.png', verdict: 'OFFICIEL', set: 'Wild-Blaze', setSur: true, cible: 'ja', langue: 'ja', urls: [ARCH], urlChoisie: null, source: 'bulbapedia', bulbapediaSeule: true, cache: { fichier: 'XY2_Logo.png', sha256: 'f'.repeat(64) }, pokecardexSha256: 'p'.repeat(64), ...o });
const SET = (o = {}) => ({ _id: 'Wild-Blaze', tirage: 'jp', region: 'jp', code: 'XY2', nomAffichage: 'Wild Blaze', nomEn: 'Flashfire', ...o });
const carte = (...docs) => new Map(docs.map(d => [d._id, d]));

(async () => {
    // ───── 1. LA GARDE DE LA SONDE : écrite par ce qu'elle autorise
    const now = T0 + 3600e3;
    const SERVI = (o = {}) => ({ _id: E.ID_ETAT, active: false, verdict: 'SERVI', constateLe: T0 + 60e3, dernierEssai: T0 + 60e3, ...o });
    verifier('sonde SERVI, après le 15/10 19:29, fraîche : feu vert', Bu.feuVertSonde(SERVI(), now).ok, true);
    for (const [nom, doc, n] of [
        ['aucun état (la sonde n\'a jamais rendu SERVI)', null, now],
        ['état non objet', 'SERVI', now],
        ['verdict DEFI', SERVI({ verdict: 'DEFI' }), now],
        ['verdict AUTRE', SERVI({ verdict: 'AUTRE' }), now],
        ['suspension active', SERVI({ active: true, jusqua: now + 1e9 }), now],
        ['active absent', (({ active, ...r }) => r)(SERVI()), now],
        ['SERVI constaté AVANT le 15/10 19:29 UTC', SERVI({ constateLe: T0 - 1 }), now],
        ['constateLe absent', (({ constateLe, ...r }) => r)(SERVI()), now],
        ['constateLe illisible (chaîne)', SERVI({ constateLe: '2026-10-15T20:00:00Z' }), now],
        ['constateLe dans le futur', SERVI({ constateLe: now + 5000 }), now],
        ['SERVI vieux de plus de 24 h', SERVI(), T0 + 60e3 + 24 * 3600e3 + 1],
        ['autre identifiant d\'état', SERVI({ _id: 'alerte/source-bloquee/pikaqian' }), now]
    ]) verifier(`feu vert REFUSÉ : ${nom}`, Bu.feuVertSonde(doc, n).ok, false);
    verifier('une date Mongo (Date) est lue comme un instant', Bu.feuVertSonde(SERVI({ constateLe: new Date(T0 + 60e3) }), now).ok, true);

    // ───── 2. L'ADRESSE et le NOM du fichier
    verifier('copie archive.org → adresse directe Bulbagarden', Bu.urlDirecte(ARCH), DIRECT);
    verifier('adresse directe Bulbagarden : elle-même', Bu.urlDirecte(DIRECT), DIRECT);
    for (const u of ['http://archives.bulbagarden.net/media/upload/a/a6/XY2_Logo.png', 'https://exemple.org/media/upload/a/a6/XY2_Logo.png', 'https://archives.bulbagarden.net/w/api.php', 'https://archives.bulbagarden.net/media/upload/a/a6/XY2_Logo.png?x=1', 'https://u:p@archives.bulbagarden.net/media/upload/a/a6/XY2_Logo.png', 'https://web.archive.org/web/2025im_/https://exemple.org/media/upload/a/a6/X.png', 'https://bulbapedia.bulbagarden.net/media/upload/a/a6/X.png', null, 42])
        verifier(`adresse REFUSÉE : ${u}`, Bu.urlDirecte(u), null);
    verifier('le nom de fichier : tirets bas → espaces, pourcents décodés (le titre MediaWiki)', [Bu.nomFichier(DIRECT), Bu.nomFichier('https://archives.bulbagarden.net/media/upload/0/03/2019_Pok%C3%A9mon_World_Championships_logo.png')], ['XY2 Logo.png', '2019 Pokémon World Championships logo.png']);

    // ───── 3. LE PLAN D'UNE LIGNE (langue-logo.js, jamais l'adresse)
    const plan = (l, s = [SET()]) => Bu.planifierBulba(l, carte(...s));
    const p0 = plan(L());
    verifier('ligne sûre, set jp, fichier au code du set : éligible, adresse directe, preuve de langue écrite', [p0.action, p0.url, p0.nom, /code japonais/.test(p0.preuve)], ['eligible', DIRECT, 'XY2 Logo.png', true]);
    verifier('ligne cible fr : écartée (Bulbapedia ne prouve pas le français)', plan(L({ cible: 'fr', langue: 'fr' })).action, 'ecartee');
    verifier('verdict À REGARDER : refus (la promotion se fait avant)', plan(L({ verdict: 'À REGARDER' })).action, 'refus');
    verifier('ligne non Bulbapedia : refus', plan(L({ source: 'billsarchive', bulbapediaSeule: false })).action, 'refus');
    verifier('set « ? » (setSur false) : écartée', plan(L({ setSur: false })).action, 'ecartee');
    verifier('set non identifié : écartée', plan(L({ set: null, setSur: false })).action, 'ecartee');
    verifier('set absent de la base : écartée', plan(L({ set: 'Fantome' })).action, 'ecartee');
    verifier('set de tirage intl pour un logo ja : écartée', plan(L(), [SET({ tirage: 'intl', region: 'intl' })]).action, 'ecartee');
    verifier('le nom du fichier ne prouve pas la langue (ni code, ni suffixe) : écartée par langue-logo', (({ action, raison }) => [action, /preuve de langue/.test(raison)])(plan(L({ urls: ['https://archives.bulbagarden.net/media/upload/a/a6/Machin.png'] }))), ['ecartee', true]);
    verifier('suffixe EN sur un set jp : écartée (logo du jumeau)', plan(L({ urls: ['https://archives.bulbagarden.net/media/upload/a/a6/XY2_Logo_EN.png'] })).action, 'ecartee');
    verifier('logo du COUPLE (SV2 Logo JP.png) : écartée', plan(L({ set: 'Snow-Hazard', urls: ['https://archives.bulbagarden.net/media/upload/a/a6/SV2_Logo_JP.png'] }), [SET({ _id: 'Snow-Hazard', code: 'SV2a' })]).action, 'ecartee');
    verifier('plusieurs adresses sur la ligne : refus (on ne devine pas laquelle)', plan(L({ urls: [ARCH, DIRECT] })).action, 'refus');
    verifier('adresse non Bulbagarden : refus', plan(L({ urls: ['https://exemple.org/a/XY2_Logo.png'] })).action, 'refus');
    verifier('set tirage zh-hans sans preuve de tirage : écartée (langue-logo, règle 0)', plan(L(), [SET({ tirage: 'zh-hans' })]).action, 'ecartee');

    // ───── 4. ROUTE A : base en mémoire, faux R2
    const banc = await ouvrirBanc(); banc.appliquer();
    const cx = await mongoose.createConnection(process.env.MONGODB_CARTES_URI, { dbName: 'cartes' }).asPromise();
    const S = cx.db.collection('sets');
    const magasin = new Map();
    let lectures = 0, copies = 0;
    Object.assign(r2, {
        verifierBucket: async () => 'faux', existe: async (b, k) => magasin.has(k),
        lireBinaire: async (b, k) => { lectures++; if (!magasin.has(k)) throw new Error(`absent ${k}`); return magasin.get(k); },
        deposerBinaire: async (b, k, buf) => { if (magasin.has(k)) return { ecrit: false, cle: k }; magasin.set(k, buf); copies++; return { ecrit: true, cle: k }; },
        supprimer: async (b, ks) => { ks.forEach(k => magasin.delete(k)); return ks.length; }
    });
    try {
        const A = await logo(SVG_A), B = await logo(SVG_B), C = await logo(SVG_C);
        const leLogo = (buf, o = {}) => ({ cleR2: 'bulbapedia/logos/xy2logopng.png', w: 300, h: 80, urlOriginal: DIRECT, sha1: 'a'.repeat(40), fichier: 'XY2 Logo.png', source: 'bulbapedia:setlogo', preuve: 'set japonais : le fichier commence par le code', le: new Date('2026-09-26'), ...o });
        magasin.set('bulbapedia/logos/xy2logopng.png', A);
        const doc = SET({ logo: leLogo(A), logoFr: { cleR2: 'logos/fr.png' }, logoCompose: { cleR2: 'logos/c.png' } });
        await S.insertOne({ ...doc });
        const lignes = [L({ cache: { fichier: 'XY2_Logo.png', sha256: sha256(A) } })];
        const lire = cle => r2.lireBinaire('b', cle);
        const sets = () => S.find({}).toArray().then(d => carte(...d));
        const avant = await S.findOne({ _id: 'Wild-Blaze' });

        // simulation : rien n'est écrit
        const sim = await Bu.collecterA({ lignes, setsParId: await sets(), lireOctets: lire, S, r2, bucket: 'b', ecrire: false });
        verifier('A, simulation : 1 éligible par route A, 0 requête réseau par construction, rien d\'écrit', [sim.parRoute.A.length, sim.ecrits.length, await S.countDocuments({ 'logoOfficiel.ja': { $exists: true } }), copies], [1, 0, 0, 0]);
        verifier('A, simulation : le sha256 de l\'objet R2 est celui du candidat (liste calculée, pas recopiée)', sim.parRoute.A[0].fichier.sha256, sha256(A));

        // écriture
        const eA = await Bu.collecterA({ lignes, setsParId: await sets(), lireOctets: lire, S, r2, bucket: 'b', ecrire: true, le: new Date('2026-10-12') });
        const apres = await S.findOne({ _id: 'Wild-Blaze' });
        const lo = apres.logoOfficiel?.ja;
        verifier('A, écriture : logoOfficiel.ja posé, lot Bulbapedia, source bulbapedia, mêmes octets', [eA.ecrits.length, lo?.lot, lo?.source, lo?.sha256, lo?.langue], [1, Bu.LOT_BULBA, 'bulbapedia', sha256(A), 'ja']);
        verifier('A : provenance de la collecte d\'origine (adresse Bulbagarden, date, objet source, fichier) et preuve de langue d\'AUJOURD\'HUI', [lo?.urlSource, lo?.origine?.fichier, lo?.origine?.cleR2Source, new Date(lo?.origine?.collecteLe).toISOString().slice(0, 10), /code japonais/.test(lo?.preuve?.langueLogo ?? ''), lo?.preuve?.route], [DIRECT, 'XY2 Logo.png', 'bulbapedia/logos/xy2logopng.png', '2026-09-26', true, 'A']);
        verifier('A : une copie R2→R2 sous logos-officiels/ (jamais l\'objet de sets.logo lui-même), vignette sous vignettes/logos-officiels/, comptées', [/^logos-officiels\/ja\/Wild-Blaze-[0-9a-f]{10}\.png$/.test(lo?.cleR2), /^vignettes\/logos-officiels\/ja\//.test(lo?.vignette?.cleR2), lo?.cleR2 !== avant.logo.cleR2, copies, eA.copiesR2], [true, true, true, 2, 2]);
        verifier('A : l\'objet R2 source est intact (même octets)', sha256(magasin.get('bulbapedia/logos/xy2logopng.png')), sha256(A));
        const { logoOfficiel, ...reste } = apres, { logoOfficiel: _, ...resteAvant } = avant;
        verifier('A : aucun champ existant n\'est changé (logo, logoFr, logoCompose, nom…)', reste, resteAvant);
        const lecturesAvant = lectures, copiesAvant = copies;
        const eA2 = await Bu.collecterA({ lignes, setsParId: await sets(), lireOctets: lire, S, r2, bucket: 'b', ecrire: true });
        verifier('A, rejeu : « deja », 0 réécrit, 0 copie', [eA2.ecrits.length, eA2.deja.length, copies - copiesAvant, JSON.stringify((await S.findOne({ _id: 'Wild-Blaze' })).logoOfficiel) === JSON.stringify(apres.logoOfficiel)], [0, 1, 0, true]);

        // les NON
        const tente = async (nom, docSet, ligne, attendu, extra = {}) => {
            await S.deleteMany({}); magasin.clear(); magasin.set('bulbapedia/logos/xy2logopng.png', extra.octets ?? A);
            await S.insertOne({ ...docSet });
            const n0 = copies;
            const r = await Bu.collecterA({ lignes: [ligne], setsParId: await sets(), lireOctets: lire, S, r2, bucket: 'b', ecrire: true });
            const w = await S.findOne({ _id: docSet._id });
            verifier(`A REFUSÉE : ${nom}`, [r.ecrits.length, r.parRoute.A.length, !!w.logoOfficiel?.ja?.cleR2 && !extra.garde, copies - n0, r.parRoute[attendu]?.length ?? r.refus.length], [0, 0, false, 0, 1]);
        };
        const bonne = L({ cache: { fichier: 'XY2_Logo.png', sha256: sha256(A) } });
        await tente('l\'octet de sets.logo diffère du candidat (→ route B)', SET({ logo: leLogo(B) }), bonne, 'B', { octets: B });
        await tente('set sans sets.logo (→ route B)', SET(), bonne, 'B');
        await tente('sets.logo d\'une autre source (déposé à la main), mêmes octets : pas de provenance Bulbagarden (→ route B)', SET({ logo: leLogo(A, { source: 'manuel' }) }), bonne, 'B');
        await tente('sets.logo d\'une source Bulbagarden inconnue de la liste fermée (→ route B)', SET({ logo: leLogo(A, { source: 'tcgdex:en' }) }), bonne, 'B');
        await tente('la règle de langue d\'AUJOURD\'HUI refuse (set passé en tirage id)', SET({ tirage: 'id', logo: leLogo(A) }), bonne, 'refus');
        await tente('le fichier de sets.logo ne prouve plus sa langue (suffixe EN)', SET({ logo: leLogo(A, { fichier: 'XY2 Logo EN.png' }) }), bonne, 'refus');
        await tente('logo générique connu (sha1 de LOGOS_GENERIQUES)', SET({ logo: leLogo(A, { sha1: [...require('./collecte-cartes/langue-logo').LOGOS_GENERIQUES.keys()][0] }) }), bonne, 'refus');
        await tente('set « ? » (setSur false)', SET({ logo: leLogo(A) }), L({ setSur: false, cache: bonne.cache }), 'refus');
        await tente('un logoOfficiel.ja DIFFÉRENT est déjà posé : rien n\'est remplacé', SET({ logo: leLogo(A), logoOfficiel: { ja: { cleR2: 'logos-officiels/ja/x.png', sha256: sha256(B), lot: 'autre' } } }), bonne, 'refus', { garde: true });
        {
            // l'état de la base garde le logoOfficiel d'avant
            const w = await S.findOne({ _id: 'Wild-Blaze' });
            verifier('A : le logoOfficiel d\'un autre lot est resté tel quel', [w.logoOfficiel.ja.lot, w.logoOfficiel.ja.sha256], ['autre', sha256(B)]);
        }
        {
            // deux lignes pour un même set, deux fichiers différents : refus des deux
            await S.deleteMany({}); magasin.clear(); magasin.set('bulbapedia/logos/xy2logopng.png', A);
            await S.insertOne({ ...SET({ logo: leLogo(A) }) });
            const r = await Bu.collecterA({ lignes: [bonne, L({ fichier: 'Logo JP/XY2bis.png', cache: { fichier: 'x', sha256: sha256(A) } })], setsParId: await sets(), lireOctets: lire, S, r2, bucket: 'b', ecrire: true });
            verifier('A : deux lignes pour un même (langue, set), même fichier : une seule écriture, un doublon', [r.ecrits.length, r.doublons.length], [1, 1]);
        }

        {
            await S.deleteMany({}); magasin.clear(); magasin.set('bulbapedia/logos/xy2logopng.png', A);
            await S.insertOne({ ...SET({ logo: leLogo(A, { source: 'bulbagarden:demande-site' }) }) });
            const r = await Bu.collecterA({ lignes: [bonne], setsParId: await sets(), lireOctets: lire, S, r2, bucket: 'b', ecrire: false });
            verifier('A : un sets.logo posé par collecter-logos-demande.js (source Bulbagarden, liste fermée) est une provenance valable', r.parRoute.A.length, 1);
        }

        // ───── 4 bis. LA SECONDE PREUVE DU SET (route A seulement) : la page archivée du set nomme le fichier
        {
            const nonSur = L({ setSur: false, cache: bonne.cache });
            const pages = new Map([['p/xy2', '{{TCGExpansionInfobox\n|setname=Wild Blaze\n|setlogo=XY2 Logo.png\n}}'], ['p/autre', '{{TCGExpansionInfobox\n|setname=Autre\n|setlogo=Autre Logo.png\n}}'], ['p/sanslogo', '{{TCGExpansionInfobox\n|setname=Wild Blaze\n}}']]);
            const lirePage = async cle => { if (!pages.has(cle)) throw new Error('absent'); return pages.get(cle); };
            const essai = async (nom, docSet, ligne, attendu, opts = {}, octets = A) => {
                await S.deleteMany({}); magasin.clear(); magasin.set('bulbapedia/logos/xy2logopng.png', octets);
                await S.insertOne({ ...docSet });
                const n0 = copies;
                const r = await Bu.collecterA({ lignes: [ligne], setsParId: await sets(), lireOctets: lire, S, r2, bucket: 'b', ecrire: true, lirePage: 'lirePage' in opts ? opts.lirePage : lirePage });
                const w = await S.findOne({ _id: docSet._id });
                verifier(nom, [r.parRoute.A.length, r.ecrits.length, !!w.logoOfficiel?.ja, copies - n0, r.parRoute.B.length], attendu);
                return { r, w };
            };
            const avecPage = (cle, o = {}) => SET({ bulba: { cleR2: cle, titre: 'Wild Blaze (TCG)' }, logo: leLogo(A), ...o });
            const ok1 = await essai('SECONDE PREUVE : la page archivée du set nomme le fichier de sets.logo, octets égaux : écrite par la route A', avecPage('p/xy2'), nonSur, [1, 1, true, 2, 0]);
            verifier('… la preuve est écrite sur le logo (page, fichier) et la ligne garde son set d\'origine', [/setlogo/.test(ok1.w.logoOfficiel.ja.preuve.setConfirmeParPage ?? ''), ok1.w.logoOfficiel.ja.preuve.setDeLaLigne], [true, 'Wild-Blaze']);
            await essai('sans lirePage (aucun accès à l\'archive) : NON', avecPage('p/xy2'), nonSur, [0, 0, false, 0, 0], { lirePage: undefined });
            await essai('la page nomme un AUTRE fichier : NON', avecPage('p/xy2', { logo: leLogo(A, { fichier: 'XY2 Logo bis.png' }) }), nonSur, [0, 0, false, 0, 0]);
            await essai('la page du set est celle d\'un autre set (autre setlogo) : NON', avecPage('p/autre'), nonSur, [0, 0, false, 0, 0]);
            await essai('la page n\'a pas de setlogo : NON', avecPage('p/sanslogo'), nonSur, [0, 0, false, 0, 0]);
            await essai('archive absente (le set n\'a pas de bulba.cleR2) : NON', SET({ logo: leLogo(A) }), nonSur, [0, 0, false, 0, 0]);
            await essai('archive illisible (objet absent) : NON', avecPage('p/inconnu'), nonSur, [0, 0, false, 0, 0]);
            await essai('octets différents du candidat : NON, et pas de route B pour un set non sûr', avecPage('p/xy2', { logo: leLogo(B) }), nonSur, [0, 0, false, 0, 0], {}, B);
            await essai('provenance de sets.logo inconnue (manuel) : NON, pas de route B pour un set non sûr', avecPage('p/xy2', { logo: leLogo(A, { source: 'manuel' }) }), nonSur, [0, 0, false, 0, 0]);
            await essai('la langue d\'aujourd\'hui refuse (suffixe EN) malgré la page : NON', avecPage('p/xy2', { logo: leLogo(A, { fichier: 'XY2 Logo EN.png' }) }), nonSur, [0, 0, false, 0, 0]);
            await essai('set non identifié du tout (set null) : NON', avecPage('p/xy2'), L({ set: null, setSur: false, cache: bonne.cache }), [0, 0, false, 0, 0]);
            verifier('route B : un set « ? » reste écarté par le plan (la seconde preuve ne vaut que pour A)', Bu.planifierBulba(nonSur, carte(avecPage('p/xy2'))).action, 'ecartee');
        }

        // ───── 5. ROUTE B : faux client, aucune requête réelle
        const ROBOTS_OK = { status: 200, texte: 'User-agent: *\nDisallow: /w/\n' };
        const mkPlan = async (n = 3) => {
            const ls = Array.from({ length: n }, (_, i) => L({ fichier: `Logo JP/F${i}.png`, set: `Set-${i}`, urls: [`https://web.archive.org/web/2025im_/https://archives.bulbagarden.net/media/upload/${i}/${i}a/F${i}_Logo.png`], cache: { fichier: `F${i}_Logo.png`, sha256: sha256(A) } }));
            const ss = ls.map((l, i) => SET({ _id: `Set-${i}`, code: `F${i}` }));
            const plans = ls.map(l => Bu.planifierBulba(l, carte(...ss)));
            verifier(`B : ${n} lignes éligibles au plan`, plans.every(p => p.action === 'eligible'), true);
            return plans.map((p, i) => ({ ligne: ls[i], set: ss[i]._id, url: p.url, nom: p.nom }));
        };
        const client = (table) => { const appels = []; return { appels, telecharger: async url => { appels.push(url); const r = table(url, appels.length); if (r instanceof Error) throw r; return r; }, lireRobots: async () => { appels.push('robots'); return ROBOTS_OK; } }; };
        const FV = Bu.feuVertSonde(SERVI(), now);
        {
            const plans = await mkPlan(3);
            const c = client(() => ({ buffer: A, type: 'image/png' }));
            const r = await Bu.executerB({ plan: plans, feuVert: FV, lireRobots: c.lireRobots, telecharger: c.telecharger });
            verifier('B, tout va bien : robots lu une fois, 3 fichiers demandés dans l\'ordre, jugés (identique à la phase 1)', [c.appels.length, c.appels[0], r.fichiers.length, r.fichiers[0].via, r.arret], [4, 'robots', 3, 'identique-phase-1', null]);
        }
        {
            const plans = await mkPlan(2);
            const c = client(() => ({ buffer: A, type: 'image/png' }));
            const r = await Bu.executerB({ plan: plans, feuVert: Bu.feuVertSonde(SERVI({ verdict: 'DEFI' }), now), lireRobots: c.lireRobots, telecharger: c.telecharger });
            verifier('B, sonde non SERVI : AUCUNE requête (pas même robots.txt), arrêt dit', [c.appels.length, r.requetes, r.fichiers.length, /feu vert/i.test(r.arret ?? '')], [0, 0, 0, true]);
            const r0 = await Bu.executerB({ plan: plans, feuVert: Bu.feuVertSonde(null, now), lireRobots: c.lireRobots, telecharger: c.telecharger });
            const r1 = await Bu.executerB({ plan: plans, feuVert: undefined, lireRobots: c.lireRobots, telecharger: c.telecharger });
            verifier('B, état de sonde absent ou feu vert non fourni : AUCUNE requête', [c.appels.length, r0.requetes, r1.requetes], [0, 0, 0]);
        }
        {
            const plans = await mkPlan(3);
            const c = client((url, n) => n === 3 ? new Error('Bulbagarden 403 sur ' + url + ' (après 1 essai(s))') : { buffer: A, type: 'image/png' });
            const noter = [];
            const r = await Bu.executerB({ plan: plans, feuVert: FV, lireRobots: c.lireRobots, telecharger: c.telecharger, noterArret: async m => noter.push(m) });
            verifier('B, 403 au 2e fichier : ARRÊT, le 3e n\'est jamais demandé, 1 fichier gardé, arrêt noté', [c.appels.length, r.fichiers.length, /403/.test(r.arret ?? ''), noter.length], [3, 1, true, 1]);
        }
        {
            const plans = await mkPlan(3);
            const c = client((url, n) => n === 2 ? new Error('Bulbagarden 404 sur ' + url + ' (après 1 essai(s))') : { buffer: A, type: 'image/png' });
            const r = await Bu.executerB({ plan: plans, feuVert: FV, lireRobots: c.lireRobots, telecharger: c.telecharger });
            verifier('B, 404 sur un fichier : ce fichier est refusé, les autres continuent', [c.appels.length, r.fichiers.length, r.refus.length, r.arret], [4, 2, 1, null]);
        }
        for (const [nom, err] of [['429', 'Bulbagarden 429 sur x'], ['500', 'Bulbagarden 500 sur x (après 2 essai(s))'], ['réseau', 'Bulbagarden ECONNRESET sur x (après 2 essai(s))'], ['texte inconnu', 'quelque chose']]) {
            const plans = await mkPlan(3);
            const c = client(() => new Error(err));
            const r = await Bu.executerB({ plan: plans, feuVert: FV, lireRobots: c.lireRobots, telecharger: c.telecharger });
            verifier(`B, erreur ${nom} : ARRÊT dès le premier fichier (robots + 1 requête)`, [c.appels.length, r.fichiers.length, typeof r.arret], [2, 0, 'string']);
        }
        {
            const plans = await mkPlan(2);
            for (const [nom, rob] of [['robots.txt interdit /media/upload/', { status: 200, texte: 'User-agent: *\nDisallow: /media/upload/\n' }], ['robots.txt 403 (défi)', { status: 403, texte: '<html>Just a moment</html>' }], ['robots.txt 500', { status: 500, texte: '' }], ['robots.txt 200 vide', { status: 200, texte: '' }], ['Crawl-delay: 30 (plus lent que notre file)', { status: 200, texte: 'User-agent: *\nCrawl-delay: 30\n' }], ['robots.txt illisible (erreur)', null]]) {
                const c = client(() => ({ buffer: A, type: 'image/png' }));
                const r = await Bu.executerB({ plan: plans, feuVert: FV, lireRobots: async () => { c.appels.push('robots'); if (!rob) throw new Error('ECONNRESET'); return rob; }, telecharger: c.telecharger });
                verifier(`B, ${nom} : ARRÊT, aucun fichier demandé`, [c.appels.filter(a => a !== 'robots').length, r.fichiers.length, typeof r.arret], [0, 0, 'string']);
            }
        }
        {
            const plans = await mkPlan(2);
            const c = client(() => ({ buffer: Buffer.from('<html>Just a moment</html>'), type: 'text/html' }));
            const r = await Bu.executerB({ plan: plans, feuVert: FV, lireRobots: c.lireRobots, telecharger: c.telecharger });
            verifier('B, une page HTML (défi servi en 200) au lieu d\'une image : refusée, ARRÊT (jamais deux fois)', [c.appels.length, r.fichiers.length, typeof r.arret], [2, 0, 'string']);
        }
        {
            const plans = await mkPlan(1);
            const c = client(() => ({ buffer: C, type: 'image/png' }));
            const r = await Bu.executerB({ plan: plans, feuVert: FV, lireRobots: c.lireRobots, telecharger: c.telecharger });
            verifier('B, octets différents de ceux de la phase 1 et pas de fichier Pokécardex : refus (je ne sais pas)', [r.fichiers.length, r.refus.length], [0, 1]);
        }
        {
            const { LOGOS_GENERIQUES } = require('./collecte-cartes/langue-logo');
            const plans = await mkPlan(1);
            const c = client(() => ({ buffer: A, type: 'image/png' }));
            const r = await Bu.executerB({ plan: plans, feuVert: FV, lireRobots: c.lireRobots, telecharger: c.telecharger, juger: async (l, buf) => ({ ok: true, via: 'identique-phase-1', sha256: sha256(buf), sha1: [...LOGOS_GENERIQUES.keys()][0], format: 'png' }) });
            verifier('B, le fichier reçu est un logo générique connu : refusé', [r.fichiers.length, r.refus.length], [0, 1]);
        }
        {
            // l'écriture d'un fichier de la route B : langue par la règle des noms de fichier, jamais l'adresse
            await S.deleteMany({}); magasin.clear();
            await S.insertOne({ ...SET() });
            const plans = await mkPlan(0); // aucune
            const c = client(() => ({ buffer: A, type: 'image/png' }));
            const l = L({ cache: { fichier: 'XY2_Logo.png', sha256: sha256(A) } });
            const p = Bu.planifierBulba(l, await sets());
            const r = await Bu.executerB({ plan: [{ ligne: l, set: 'Wild-Blaze', url: p.url, nom: p.nom }], feuVert: FV, lireRobots: c.lireRobots, telecharger: c.telecharger });
            const e = await Bu.ecrireB({ S, r2, bucket: 'b', item: r.fichiers[0], setDoc: await S.findOne({ _id: 'Wild-Blaze' }), le: new Date('2026-10-16') });
            const w = (await S.findOne({ _id: 'Wild-Blaze' })).logoOfficiel?.ja;
            verifier('B, écriture : logoOfficiel.ja, source bulbapedia, URL directe, preuve de langue par fichier, route B, lot Bulbapedia', [e.action, w?.source, w?.urlSource, /code japonais/.test(w?.preuve?.langueLogo ?? ''), w?.preuve?.route, w?.lot], ['ecrit', 'bulbapedia', DIRECT, true, 'B', Bu.LOT_BULBA]);
            const e2 = await Bu.ecrireB({ S, r2, bucket: 'b', item: r.fichiers[0], setDoc: await S.findOne({ _id: 'Wild-Blaze' }) });
            verifier('B, rejeu : « deja », rien réécrit', e2.action, 'deja');
            await S.deleteMany({}); await S.insertOne({ ...SET({ tirage: 'id' }) });
            const e3 = await Bu.ecrireB({ S, r2, bucket: 'b', item: r.fichiers[0], setDoc: await S.findOne({ _id: 'Wild-Blaze' }) });
            verifier('B, la règle de langue refuse AU MOMENT d\'écrire (set devenu tirage id) : refus, rien d\'écrit', [e3.action, !!(await S.findOne({ _id: 'Wild-Blaze' })).logoOfficiel], ['refus', false]);
        }

        // ───── 6. LES CANDIDATS : liste fermée calculée, promotion des « À REGARDER »
        {
            const table = { lignes: [L({ fichier: 'Logo JP/A.png' }), L({ fichier: 'Logo JP/B.png', source: 'billsarchive', bulbapediaSeule: false }), L({ fichier: 'Logo JP/C.png', verdict: 'DIFFÉRENT' }), L({ fichier: 'Logo JP/D.png', verdict: 'À REGARDER', source: 'bulbapedia', bulbapediaSeule: false }), L({ fichier: 'Logo JP/E.png', source: 'bulbapedia', bulbapediaSeule: false })] };
            const c = Bu.candidats(table, carte(SET()), {});
            verifier('candidats : OFFICIEL Bulbapedia seulement (bulbapediaSeule OU source) ; l\'À REGARDER non promu est nommé, pas écrit', [c.lignes.map(l => l.fichier), c.nonPromues.map(x => x.ligne.fichier)], [['Logo JP/A.png', 'Logo JP/E.png'], ['Logo JP/D.png']]);
        }

        // ───── 7. NOTER LE VERDICT DE LA SONDE (l'état que la garde lit)
        {
            const docs = new Map();
            const col = { findOne: async f => docs.get(f._id) ?? null, updateOne: async (f, u, o) => { docs.set(f._id, { ...(docs.get(f._id) ?? { _id: f._id }), ...u.$set }); return {}; } };
            await Bu.noterVerdict(col, { verdict: 'SERVI', motif: '200 sans défi' }, T0 + 120e3);
            verifier('noterVerdict SERVI : l\'état écrit est celui que la garde accepte', Bu.feuVertSonde(docs.get(E.ID_ETAT), T0 + 3600e3).ok, true);
            await Bu.noterVerdict(col, { verdict: 'DEFI', motif: 'défi' }, T0 + 7200e3);
            verifier('noterVerdict DEFI : suspension active, la garde refuse ensuite', [docs.get(E.ID_ETAT).active, Bu.feuVertSonde(docs.get(E.ID_ETAT), T0 + 7300e3).ok], [true, false]);
        }
    } finally { await cx.close(); await banc.arreter?.(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
