// node test-tpc.js — les sources officielles The Pokémon Company (décision de l'éditeur, 2026-10-07, soir) : TPC Asie
// (asia.pokemon-card.com : id, th, tw) et pokemon-card.com (japonais). Les fixtures sont des EXTRAITS MOT POUR MOT de pages servies
// le 2026-10-07 (collecte-cartes/tpc-fixtures/, sonde à 10 s) — rien n'y est inventé.
// Ce que le banc garde : la LECTURE des pages (le parseur lit ce que la page porte), la PREUVE de correspondance (numéro + nom + set ;
// un doute est un trou), le PLAN (jamais l'illustration d'une autre impression), le CLIENT (verrou, cadence, robots.txt, ARRÊT au
// premier blocage) et le RETRAIT en un seul lot.
const fs = require('fs');
const path = require('path');
const T = require('./collecte-cartes/tpc');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const F = f => fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'tpc-fixtures', f), 'utf8');

(async () => {
    // ── 1. LA LECTURE DES PAGES ──────────────────────────────────────────────────────────────────────────────────
    const id = T.lireFicheAsie(F('asie-id-fiche-7125.html'));
    verifier('TPC Asie id 7125 : nom, numéro, set, Pokédex, PV, image', [id.nom, id.numero, id.denominateur, id.dex, id.pv, id.image],
        ['Spidops', '001', 'SV-P', 918, 120, 'https://asia.pokemon-card.com/id/card-img/id00007125.png']);
    verifier('   catégorie déduite des PV, dégâts des attaques, marque de régulation', [id.categorie, id.degats, id.regulation], ['pokemon', ['30', '100'], 'G']);
    const th = T.lireFicheAsie(F('asie-th-fiche-5209.html'));
    verifier('TPC Asie th 5209 : le nom thaï, et les mêmes champs sans langue', [th.nom, th.numero, th.denominateur, th.dex, th.pv], ['วาไนเดอร์', '001', 'SV-P', 918, 120]);
    const tw = T.lireFicheAsie(F('asie-tw-fiche-14091.html'));
    verifier('TPC Asie tw 14091 : chinois traditionnel', [tw.nom, tw.numero, tw.denominateur, tw.dex, tw.pv, tw.image], ['妙蛙種子', '001', 'M-P', 1, 80, 'https://asia.pokemon-card.com/tw/card-img/tw00014091.png']);
    const liste = T.lireListeAsie(F('asie-id-liste-SV-P-page1.html'));
    verifier('liste filtrée SV-P (id) : total, pages, 20 fiches dans l\'ordre', [liste.total, liste.pages, liste.ids.length, liste.ids[0], liste.ids[19]], [251, 13, 20, 7125, 7144]);
    const pcc = T.lireFichePcc(F('pcc-fiche-38273.html'));
    verifier('pokemon-card.com 38273 : nom, numéro, marque, PV, image, illustrateur', [pcc.nom, pcc.numero, pcc.denominateur, pcc.marque, pcc.pv, pcc.image, pcc.illustrateur],
        ['フシギバナV', '001', '127', 'SD', 220, '/assets/images/card_images/large/SD/038273_P_FUSHIGIBANAV.jpg', 'PLANETA Mochizuki']);
    const api = T.lireApiPcc(JSON.parse(F('pcc-api-sD-page1.json')));
    verifier('pokemon-card.com resultAPI : total, pages, cartes', [api.total, api.pages, api.cartes.map(c => c.id)], [127, 4, ['38273', '38274', '38275']]);
    verifier('une page qui n\'est pas une fiche (aucun numéro, aucun nom) se lit vide, elle ne lève pas', [T.lireFicheAsie('<html><body>maintenance</body></html>').numero, T.lireFicheAsie('<html></html>').nom], [null, null]);

    // ── 2. LA PREUVE DE CORRESPONDANCE : numéro + nom + set ; un doute est un trou ─────────────────────────────────
    const spidops = { _id: 1, nomEn: 'Spidops', categorie: 'pokemon', ndex: 918, pv: 120 };
    const P = (fiche, carte, numeroFiche, code = 'SV-P', site = 'tpc-asie') => T.preuveDeCorrespondance({ fiche, carte, numeroFiche, code, site });
    let p = P(id, spidops, '001');
    verifier('id : même nom, même numéro, même set → prouvé par le NOM', [p.ok, p.voie], [true, 'nom']);
    verifier('   la preuve dit ce qu\'elle a comparé', /001\/SV-P/.test(p.preuve) && /Spidops/.test(p.preuve), true);
    verifier('id : un autre numéro → trou', [P(id, spidops, '002').ok, P(id, spidops, '002').motif], [false, 'numero']);
    verifier('id : un autre set (M-P) → trou', [P(id, spidops, '001', 'M-P').ok, P(id, spidops, '001', 'M-P').motif], [false, 'set']);
    verifier('id : le nom concorde mais le Pokédex le contredit → trou', P(id, { ...spidops, ndex: 917 }, '001').motif, 'contradiction-pokedex');
    verifier('id : le nom concorde mais les PV le contredisent → trou', P(id, { ...spidops, pv: 260 }, '001').motif, 'contradiction-pv');
    p = P(th, spidops, '001');
    verifier('th : nom traduit, Pokédex 918 ET PV 120 concordants → prouvé par Pokédex + PV', [p.ok, p.voie], [true, 'pokedex+pv']);
    verifier('th : même Pokédex, PV différents → trou', P(th, { ...spidops, pv: 130 }, '001').ok, false);
    // notre carte sans `ndex` (fiche simple, page sans infobox complète) : le Pokédex se lit dans NOTRE nom anglais, par la table versionnée
    // pokedex-dexids.json (TCGdex, nom complet → numéro) — calibration du 2026-10-07 : « Reshiram ex » (tw 039/M-P) restait un trou
    p = P(th, { _id: -5, nomEn: 'Spidops', ficheSimple: {} }, '001');
    verifier('th : une fiche simple « Spidops » : le Pokédex de son nom (918) = celui de la fiche → prouvé', [p.ok, p.voie], [true, 'pokedex-du-nom']);
    verifier('th : une fiche simple au nom absent de la table → trou', P(th, { _id: -5, nomEn: 'Zzz Inconnu', ficheSimple: {} }, '001').motif, 'nom-non-comparable');
    const reshiram = { ...tw, nom: '萊希拉姆ex', numero: '039', dex: 643, pv: 230 };
    verifier('tw : « 萊希拉姆ex » 039/M-P et notre « Reshiram ex » sans ndex ni PV → prouvé par le Pokédex du nom', P(reshiram, { _id: 6, nomEn: 'Reshiram ex', categorie: 'pokemon' }, '039', 'M-P').voie, 'pokedex-du-nom');
    verifier('tw : notre nom désigne une AUTRE espèce (Zekrom ex, 644) → contradiction', P(reshiram, { _id: 7, nomEn: 'Zekrom ex', categorie: 'pokemon' }, '039', 'M-P').motif, 'contradiction-pokedex');
    verifier('tw : Méga-Dracaufeu X contre Y → trou (la lettre de la forme est une règle)', P({ ...tw, nom: '超級噴火龍Yex', dex: 6, pv: 360, numero: '029' }, { _id: 8, nomEn: 'Mega Charizard X ex', categorie: 'pokemon' }, '029', 'M-P').motif, 'suffixe');
    verifier('tw : Méga-Dracaufeu X contre X → prouvé', P({ ...tw, nom: '超級噴火龍Xex', dex: 6, pv: 360, numero: '029' }, { _id: 8, nomEn: 'Mega Charizard X ex', categorie: 'pokemon' }, '029', 'M-P').ok, true);
    // les énergies de base chinoises : « 基本【火】能量 » — le caractère entre crochets EST le type (calibration : 032, 033, 034/M-P)
    const energie = nom => ({ ...tw, nom, dex: null, pv: null, categorie: null, numero: '032' });
    verifier('tw : « 基本【火】能量 » = Basic Fire Energy → prouvé', P(energie('基本【火】能量'), { _id: 9, nomEn: 'Basic Fire Energy', categorie: 'energie' }, '032', 'M-P').voie, 'energie-de-base');
    verifier('tw : « 基本【水】能量 » contre Basic Fire Energy → trou', P(energie('基本【水】能量'), { _id: 9, nomEn: 'Basic Fire Energy', categorie: 'energie' }, '032', 'M-P').ok, false);
    verifier('th : un dresseur au nom traduit → trou', P({ ...th, nom: 'สวิตช์', dex: null, pv: null, categorie: null }, { _id: 2, nomEn: 'Switch', categorie: 'dresseur' }, '001').motif, 'nom-non-comparable');
    verifier('tw : Bulbasaur 001/M-P par Pokédex 1 + PV 80', P(tw, { _id: 3, nomEn: 'Bulbasaur', categorie: 'pokemon', ndex: 1, pv: '80' }, '001', 'M-P').ok, true);
    // la règle (ex, V, VMAX…) : même Pokédex et mêmes PV ne suffisent pas si l'une porte ex et l'autre non
    verifier('th : « ex » d\'un côté seulement → trou', P({ ...th, nom: 'วาไนเดอร์ex' }, spidops, '001').motif, 'suffixe');
    verifier('tw : « 超級 » (Méga) d\'un côté seulement → trou', P({ ...tw, nom: '超級妙蛙種子ex' }, { _id: 3, nomEn: 'Bulbasaur ex', categorie: 'pokemon', ndex: 1, pv: 80 }, '001', 'M-P').motif, 'suffixe');
    verifier('tw : « 超級…ex » contre « Mega … ex » → la règle concorde', P({ ...tw, nom: '超級妙蛙種子ex' }, { _id: 3, nomEn: 'Mega Bulbasaur ex', categorie: 'pokemon', ndex: 1, pv: 80 }, '001', 'M-P').ok, true);
    verifier('id : un nom latin différent, un Pokédex absent de notre carte → trou', P(id, { _id: 4, nomEn: 'Tarountula', categorie: 'pokemon' }, '001').ok, false);
    verifier('une fiche sans numéro → trou', P({ ...id, numero: null }, spidops, '001').motif, 'numero');
    verifier('pokemon-card.com : nomJa identique, numéro, marque SD pour le code sD → prouvé', P(pcc, { _id: 5, nomEn: 'Venusaur V', nomJa: 'フシギバナV', categorie: 'pokemon', pv: 220 }, '001', 'sD', 'pokemon-card-com').ok, true);
    verifier('   nomJa en pleine chasse (« Ｖ ») : NFKC → prouvé', P(pcc, { _id: 5, nomJa: 'フシギバナＶ', categorie: 'pokemon' }, '001', 'sD', 'pokemon-card-com').ok, true);
    verifier('   marque SD pour le code sA → trou (set)', P(pcc, { _id: 5, nomJa: 'フシギバナV' }, '001', 'sA', 'pokemon-card-com').motif, 'set');
    verifier('   aucun nomJa chez nous → trou', P(pcc, { _id: 5, nomEn: 'Venusaur V', categorie: 'pokemon', pv: 220 }, '001', 'sD', 'pokemon-card-com').motif, 'nom-non-comparable');
    verifier('un site inconnu → trou, jamais une preuve', P(id, spidops, '001', 'SV-P', 'pokecardex').ok, false);

    // ── 3. LE PLAN : un trou reçoit la fiche de SON numéro, ou rien ─────────────────────────────────────────────────
    const fiche = (n, nom, extra = {}) => ({ idFiche: 1000 + Number(n), nom, numero: n, denominateur: 'SV-P', image: `https://asia.pokemon-card.com/id/card-img/id${n}.png`, ...extra });
    const trous = [
        { carte: { _id: 10, nomEn: 'Super Rod', categorie: 'dresseur' }, numeroFiche: '035', idProduct: 1 },
        { carte: { _id: 10, nomEn: 'Super Rod', categorie: 'dresseur' }, numeroFiche: '169', idProduct: 2 },
        { carte: { _id: 11, nomEn: 'Pikachu', categorie: 'pokemon', ndex: 25, pv: 60 }, numeroFiche: '050', idProduct: 3 },
        { carte: { _id: 12, nomEn: 'Eevee', categorie: 'pokemon' }, numeroFiche: '060', idProduct: 4 },
        { carte: { _id: 13, nomEn: 'Mew', categorie: 'pokemon' }, numeroFiche: null, idProduct: 5 },
        { carte: { _id: 14, nomEn: 'Snorlax', categorie: 'pokemon' }, numeroFiche: '070', idProduct: 6 },
        { carte: { _id: 14, nomEn: 'Snorlax', categorie: 'pokemon' }, numeroFiche: '070', idProduct: 7 }
    ];
    const fiches = [fiche('035', 'Super Rod'), fiche('169', 'Super Rod'), fiche('050', 'Pikachu', { dex: 25, pv: 60 }), fiche('060', 'Eevee'), fiche('060', 'Eevee'), fiche('070', 'Snorlax')];
    const plan = T.planifierTpc({ trous, fiches, code: 'SV-P', site: 'tpc-asie' });
    verifier('Super Rod 035 et 169 : chacun SA fiche, jamais l\'illustration de l\'autre', plan.plan.filter(x => x.carteId === 10).map(x => `${x.numero}:${x.fiche.idFiche}`), ['035:1035', '169:1169']);
    verifier('deux fiches au même numéro à la source → trou « numero-ambigu-a-la-source »', plan.restes.find(r => r.carteId === 12)?.motif, 'numero-ambigu-a-la-source');
    verifier('un produit sans numéro → trou « sans-numero »', plan.restes.find(r => r.carteId === 13)?.motif, 'sans-numero');
    verifier('deux produits au même (carte, numéro) → UN visuel', plan.plan.filter(x => x.carteId === 14).length, 1);
    verifier('le décompte : plan + restes = (carte, numéro) distincts', plan.plan.length + plan.restes.length, 6);
    const absente = T.planifierTpc({ trous: [{ carte: { _id: 20, nomEn: 'Zorua' }, numeroFiche: '099', idProduct: 9 }], fiches, code: 'SV-P', site: 'tpc-asie' });
    verifier('un numéro absent de la source → trou « absente-de-la-source »', absente.restes[0].motif, 'absente-de-la-source');
    // 🔴 relecture du 2026-10-07 : un dénominateur NUMÉRIQUE (« 165/164 ») ne dit pas le set — si la source ignorait le filtre, une fiche
    // d'un autre set au même numéro passerait. Le set se lit alors sur la LISTE ENTIÈRE : le dénominateur et le symbole d'extension de la
    // majorité de ses fiches ; une fiche qui s'en écarte est un trou.
    const fm = (n, nom, den, sym) => ({ idFiche: 2000 + Number(n), nom, numero: n, denominateur: den, symbole: sym, image: `https://asia.pokemon-card.com/id/card-img/x${n}.png` });
    const S1 = 'https://asia.pokemon-card.com/id/card-img/mark/MA5.png', S2 = 'https://asia.pokemon-card.com/id/card-img/mark/SV1.png';
    const fichesM = [fm('165', 'Chespin', '164', S1), fm('166', 'Fomantis', '164', S1), fm('167', 'Fennekin', '164', S1), fm('168', 'Armarouge', '198', S1), fm('169', 'Goldeen', '164', S2)];
    const tm = n => ({ carte: { _id: Number(n), nomEn: fichesM.find(f => f.numero === n).nom }, numeroFiche: n, idProduct: Number(n) });
    const PM = T.planifierTpc({ trous: ['165', '166', '167', '168', '169'].map(tm), fiches: fichesM, code: 'MA5', site: 'tpc-asie' });
    verifier('dénominateur numérique : la majorité de la liste (164) passe', PM.plan.map(x => x.numero), ['165', '166', '167']);
    verifier('   une fiche au dénominateur 198 dans une liste à 164 → trou « set »', PM.restes.find(r => r.numero === '168')?.motif, 'set');
    verifier('   une fiche au symbole d\'un autre set → trou « set »', PM.restes.find(r => r.numero === '169')?.motif, 'set');

    // ── 4. ADDITIF SEULEMENT : un (carte, set, numéro) déjà servi n'est jamais touché ─────────────────────────────
    const carte = { images: [{ set: 'S', numero: '035', source: 'tcgdex', cleR2: 'x' }, { set: 'S', source: 'bulbapedia', cleR2: 'y' }, { set: 'T', numero: '169', cleR2: 'z' }] };
    verifier('déjà un visuel à ce numéro → on n\'ajoute rien', T.dejaServi(carte, 'S', '35'), true);
    verifier('un visuel SANS numéro dans le set → on n\'ajoute rien (il peut être servi)', T.dejaServi({ images: [{ set: 'S', cleR2: 'y' }] }, 'S', '169'), true);
    verifier('un visuel au même numéro dans un AUTRE set → on ajoute', T.dejaServi({ images: [{ set: 'T', numero: '169', cleR2: 'z' }] }, 'S', '169'), false);

    // ── 5. ROBOTS.TXT RESPECTÉ ────────────────────────────────────────────────────────────────────────────────────
    verifier('robots vide (TPC Asie, 2026-10-07) → autorisé', T.autoriseParRobots('', '/id/card-search/list/'), true);
    verifier('robots absent (pokemon-card.com : 404) → autorisé', T.autoriseParRobots(null, '/card-search/resultAPI.php'), true);
    verifier('Disallow: /id/ pour * → refusé', T.autoriseParRobots('User-agent: *\nDisallow: /id/\n', '/id/card-search/list/'), false);
    verifier('Disallow: /id/ pour un AUTRE robot seulement → autorisé', T.autoriseParRobots('User-agent: Googlebot\nDisallow: /id/\n', '/id/card-search/list/'), true);
    verifier('Disallow: / pour * → refusé partout', T.autoriseParRobots('User-agent: *\nDisallow: /\n', '/card-search/details.php/card/1/regu/all'), false);
    verifier('Disallow vide → autorisé', T.autoriseParRobots('User-agent: *\nDisallow:\n', '/x'), true);

    // ── 6. LE CLIENT : verrou, cadence, robots, ARRÊT au premier blocage ────────────────────────────────────────────
    const verrou = { tenu: true, perdu: false };
    const transport = reponses => { const appels = []; return { appels, async get(url) { appels.push(url); const r = reponses(url, appels.length); if (r instanceof Error) throw r; return r; } }; };
    const ok200 = (texte, type = 'text/html') => ({ status: 200, texte, type });
    let tr = transport(u => u.endsWith('/robots.txt') ? ok200('') : ok200('<p>page</p>'));
    let C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0 });
    let e = null; try { await C.page('/id/card-search/list/'); } catch (x) { e = x.message; }
    verifier('sans verrou lié : aucune requête, et ça le dit', [/verrou/.test(e), tr.appels.length], [true, 0]);
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    await C.page('/id/card-search/list/'); await C.page('/id/card-search/detail/7125/');
    verifier('robots.txt lu UNE fois, avant la première page', tr.appels, ['https://asia.pokemon-card.com/robots.txt', 'https://asia.pokemon-card.com/id/card-search/list/', 'https://asia.pokemon-card.com/id/card-search/detail/7125/']);
    tr = transport(u => u.endsWith('/robots.txt') ? ok200('User-agent: *\nDisallow: /id/\n') : ok200('x'));
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    e = null; try { await C.page('/id/card-search/list/'); } catch (x) { e = x; }
    verifier('un chemin interdit par robots.txt : aucune requête, erreur « robots »', [e?.robots === true, tr.appels.length], [true, 1]);
    for (const [cas, rep] of [['403', { status: 403, texte: 'Forbidden' }], ['429', { status: 429, texte: '' }], ['défi Cloudflare', ok200('<title>Just a moment...</title>')], ['captcha', ok200('<div class="g-recaptcha">')]]) {
        tr = transport(u => u.endsWith('/robots.txt') ? ok200('') : rep);
        C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
        e = null; try { await C.page('/id/card-search/list/'); } catch (x) { e = x; }
        let e2 = null; try { await C.page('/id/card-search/detail/1/'); } catch (x) { e2 = x; }
        verifier(`${cas} → BLOQUÉ, et plus aucune requête ensuite (« si une source bloque, on s'arrête »)`, [e?.bloque === true, e2?.bloque === true, tr.appels.length], [true, true, 2]);
    }
    tr = transport(u => u.endsWith('/robots.txt') ? ok200('') : { status: 404, texte: 'non' });
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    verifier('404 → null, sans réessai', [await C.page('/id/card-search/detail/9/'), tr.appels.length], [null, 2]);
    let n5 = 0;
    tr = transport(u => u.endsWith('/robots.txt') ? ok200('') : (++n5 === 1 ? { status: 503, texte: '' } : ok200('enfin')));
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    verifier('503 puis 200 → un réessai, le texte', [await C.page('/id/x/'), tr.appels.length], ['enfin', 3]);
    tr = transport(u => u.endsWith('/robots.txt') ? ok200('') : { status: 503, texte: '' });
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    e = null; try { await C.page('/id/x/'); } catch (x) { e = x; }
    verifier('503 deux fois → lève (une panne reste une panne), sans boucle', [e?.status, tr.appels.length], [503, 3]);
    tr = transport(u => u.endsWith('/robots.txt') ? { status: 500, texte: '' } : ok200('x'));
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    e = null; try { await C.page('/id/x/'); } catch (x) { e = x; }
    verifier('robots.txt illisible (500) : on ne peut pas conclure → aucune page', [e?.robots === true, tr.appels.filter(u => !u.endsWith('robots.txt')).length], [true, 0]);
    // seconde relecture : une panne de robots.txt n'est pas un BLOCAGE de la source (l'alerte ne se lève qu'à la main) — une erreur passagère
    verifier('   … mais pas un blocage durable : erreur passagère (5xx), le client n\'est pas bloqué', [e?.bloque === true, C.bloque(), e?.status], [false, null, 500]);
    tr = transport(u => u.endsWith('/robots.txt') && !u.includes('www2') ? { status: 301, location: 'https://asia.pokemon-card.com/www2/robots.txt' } : u.endsWith('/robots.txt') ? ok200('User-agent: *\nDisallow: /id/\n') : ok200('x'));
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    e = null; try { await C.page('/id/x/'); } catch (x) { e = x; }
    verifier('robots.txt redirigé sur le même site → suivi, et ses règles s\'appliquent', [e?.robots === true, tr.appels.filter(u => !u.endsWith('robots.txt')).length], [true, 0]);
    tr = transport(u => u.endsWith('/robots.txt') ? ok200('User-agent: *\nCrawl-delay: 3600\n') : ok200('x'));
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    e = null; try { await C.page('/id/x/'); } catch (x) { e = x; }
    verifier('Crawl-delay au-delà de 60 s : le site demande qu\'on n\'y vienne pas → on s\'arrête (bloqué), aucune page', [e?.bloque === true, tr.appels.length], [true, 1]);
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: transport(() => ok200('')), cadenceMs: 0, reessaiMs: 0, verrou: { tenu: true, perdu: true } });
    e = null; try { await C.page('/id/x/'); } catch (x) { e = x.message; }
    verifier('verrou PERDU → aucune requête', /PERDU/.test(e), true);
    e = null; try { T.fabriquerClientTpc({ site: 'pokecardex', transport: tr, verrou }); } catch (x) { e = x.message; }
    verifier('un site hors de la liste (Pokécardex) : refusé à la construction', /site/.test(e || ''), true);
    // 🔴 relecture : une REDIRECTION n'est suivie que sur le même site, robots.txt relu pour le chemin d'arrivée, trois sauts au plus
    tr = transport(u => u.endsWith('/robots.txt') ? ok200('User-agent: *\nDisallow: /interdit/\n') : u.endsWith('/a/') ? { status: 301, location: '/b/' } : u.endsWith('/b/') ? ok200('arrivé') : u.endsWith('/c/') ? { status: 302, location: 'https://ailleurs.example/x' } : u.endsWith('/d/') ? { status: 302, location: '/interdit/x' } : u.endsWith('/e/') ? { status: 302, location: '/e/' } : ok200('?'));
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    verifier('301 vers le même site → suivie', await C.page('/a/'), 'arrivé');
    e = null; try { await C.page('/c/'); } catch (x) { e = x.message; }
    verifier('302 vers un AUTRE hôte → refusée, jamais suivie', [/hors du site/.test(e || ''), tr.appels.some(u => u.includes('ailleurs.example'))], [true, false]);
    e = null; try { await C.page('/d/'); } catch (x) { e = x; }
    verifier('302 vers un chemin interdit par robots.txt → refusée', [e?.robots === true, tr.appels.some(u => u.includes('/interdit/'))], [true, false]);
    e = null; try { await C.page('/e/'); } catch (x) { e = x.message; }
    verifier('une boucle de redirections → s\'arrête au 3e saut', [/redirection/.test(e || ''), tr.appels.filter(u => u.endsWith('/e/')).length], [true, 4]);
    // Crawl-delay : la cadence du site s'il en demande une plus lente
    tr = transport(u => u.endsWith('/robots.txt') ? ok200('User-agent: *\nCrawl-delay: 25\n') : ok200('x'));
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
    await C.page('/x/');
    verifier('Crawl-delay: 25 → la cadence passe à 25 s', C.cadence(), 25000);
    verifier('Crawl-delay lu dans robots.txt (pur)', [T.delaiDesRobots('User-agent: *\nCrawl-delay: 25\n'), T.delaiDesRobots(''), T.delaiDesRobots(null)], [25, null, null]);
    // la cadence : deux pages se suivent d'au moins cadenceMs
    const t0 = []; tr = { appels: [], async get(u) { t0.push(Date.now()); return ok200(''); } };
    C = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 120, reessaiMs: 0, verrou });
    await Promise.all([C.page('/a/'), C.page('/b/')]);
    verifier('cadence tenue dans la FILE : deux appels concurrents espacés d\'au moins 120 ms', t0.length === 3 && t0[2] - t0[1] >= 115 && t0[1] - t0[0] >= 115, true);

    // ── 7. L'IDENTIFIANT ET LA MENTION — retirables en UN lot ─────────────────────────────────────────────────────
    verifier('identifiant du document `images` : source, set, carte, numéro, langue', T.idImageTpc('tpc-asie', 'Scarlet-Violet-Indonesian-Promos', 15381, '111', 'id'), 'tpc-asie/Scarlet-Violet-Indonesian-Promos/15381/111/id');
    verifier('la mention et le lot', [T.MENTION, T.LOT], ['© Pokémon / The Pokémon Company', 'tpc-2026-10']);
    const R = T.planRetrait([{ _id: 1, images: [{ set: 'S', source: 'tpc-asie', cleR2: 'a' }, { set: 'S', source: 'tcgdex', cleR2: 'b' }] }, { _id: 2, images: [{ set: 'T', source: 'pokemon-card-com', cleR2: 'c' }] }, { _id: 3, images: [{ set: 'U', source: 'artofpkm', cleR2: 'd' }] }]);
    verifier('retrait en un lot : les seules entrées TPC, carte par carte', [R.cartes, R.entrees, R.cles], [[1, 2], 2, ['a', 'c']]);
    const Rv = T.planRetrait([{ _id: 1, images: [{ set: 'S', source: 'tpc-asie', cleR2: 'a', vignette: { cleR2: 'vignettes/a.webp', w: 200, h: 279 } }] }]);
    verifier('retrait : la VIGNETTE de l\'entrée part avec elle (relecture)', Rv.cles, ['a', 'vignettes/a.webp']);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
