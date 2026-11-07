'use strict';
// Banc de collecte-cartes/chasse-nocturne.js : AUCUN réseau, AUCUNE base, AUCUN vrai dossier. Des faux en mémoire (pages, images, horloge, porte).
// Chaque cas doit pouvoir ÉCHOUER (mutants-chasse-nocturne.js le prouve) : une garde jamais vue dire non n'est pas vérifiée.
const CN = require('./collecte-cartes/chasse-nocturne');
const CO = require('./collecte-cartes/comblement');

let ok = 0, ko = 0;
function v(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? 'OK ' : 'KO '} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}
const vrai = (nom, cond) => v(nom, Boolean(cond), true);

(async () => {
    // ───────────── 1. appariement collection <-> set (jamais par inclusion, jamais entre tirages) ─────────────
    const SETS = [
        { set: 'Sword-Shield-Starter-Decks', code: 'sA', nom: 'Sword Shield Starter Decks', tirage: 'jp' },
        { set: 'VSTAR-Universe', code: 's12a', nom: 'VSTAR Universe', tirage: 'jp' },
        { set: 'Scarlet-Violet-Promos', code: 'SV-P', nom: 'Scarlet Violet Promos', tirage: 'jp' },
        { set: 'Scarlet-Violet-Indonesian-Promos', code: 'SV-P/ID', nom: 'Scarlet Violet Indonesian Promos', tirage: 'id' },
        { set: 'Base-Set', code: 'BS', nom: 'Base Set', tirage: 'intl' },
        { set: 'Expansion-Pack', code: 'PMCG1', nom: 'Expansion Pack', tirage: 'jp' }
    ];
    const ap = (coll, tirages = ['jp', 'intl', 'id'], sets = SETS) => CN.apparierCollection(coll, sets, { tirages });
    v('collection : un préfixe de code SEUL ne désigne rien (inclusion, §31)', ap({ slug: 'sa-grass-starter-set-v', titre: 'sA: Grass Starter Set V' }).raison, 'aucun');
    v('collection : code en tête + reste = nom du set désigne le set', ap({ slug: 'sa-sword-shield-starter-decks', titre: 'x' }).set, 'Sword-Shield-Starter-Decks');
    v('collection : le code exact (attribut) désigne le set', ap({ slug: 'vstar-universe-expansion', titre: 'VSTAR Universe Set', code: 'S12A' }, ['jp'], SETS).set, 'VSTAR-Universe');
    v('collection : le nom égal (mots) désigne le set', ap({ slug: 'expansion-pack', titre: 'Expansion Pack' }).set, 'Expansion-Pack');
    v('collection : code+nom choisit SV-P/ID et non SV-P', ap({ slug: 'sv-p-id-scarlet-violet-indonesian-promos', titre: 'x' }).set, 'Scarlet-Violet-Indonesian-Promos');
    v('collection : code+nom : SV-P reste SV-P', ap({ slug: 'sv-p-scarlet-violet-promos', titre: 'x' }).set, 'Scarlet-Violet-Promos');
    v('collection : le slug « sv-p-id-promos » (préfixe seul) ne désigne rien', ap({ slug: 'sv-p-id-promos', titre: 'x' }).raison, 'aucun');
    v('collection : un nom INCLUS dans un autre ne désigne rien (Base dans Base Set Pikachu)', ap({ slug: 'base-set-pikachu', titre: 'Base Set Pikachu' }).ok, false);
    v('collection : aucune correspondance = refus « aucun »', ap({ slug: 'zzz-inconnu', titre: 'Inconnu' }).raison, 'aucun');
    v('collection : tirage non admis par l\'index = refus (jamais un set d\'un autre tirage)', ap({ slug: 'base-set', titre: 'Base Set' }, ['jp']).ok, false);
    v('collection : un code d\'une lettre ne désigne rien (M devant m-p-promos)', CN.apparierCollection({ slug: 'm-p-promotional-cards', titre: 'x' }, [{ set: 'Mega-X', code: 'M', nom: 'P Promotional Cards', tirage: 'jp' }], { tirages: ['jp'] }).raison, 'aucun');
    const DOUBLE =[...SETS, { set: 'Base-Set-JP', code: 'BS2', nom: 'Base Set', tirage: 'jp' }];
    v('collection : deux sets au même nom = ambigu, refus', CN.apparierCollection({ slug: 'base-set', titre: 'Base Set' }, DOUBLE, { tirages: ['jp', 'intl'] }).raison, 'ambigu');
    v('collection : mots retirés côté collection seulement (Pokemon Singles)', CN.apparierCollection({ slug: 'x', titre: 'VSTAR Universe - Pokemon Singles' }, SETS, { tirages: ['jp'], retirerMots: ['pokemon', 'singles'] }).set, 'VSTAR-Universe');
    v('collection : nom et code en désaccord = ambigu', CN.apparierCollection({ slug: 'vstar-universe', titre: 'VSTAR Universe', code: 'sA' }, SETS, { tirages: ['jp'] }).raison, 'ambigu');
    // le jumeau d'un autre tirage, même NON troué, rend le nom ambigu (relecture 07/11, point 1)
    const TROUES = [{ set: 'Base-Set-JP', code: 'BS2', nom: 'Base Set', tirage: 'jp' }], CONNUS = [...TROUES, { set: 'Base-Set', code: 'BS', nom: 'Base Set', tirage: 'intl' }];
    v('collection : jumeau occidental non troué = ambigu', CN.apparierCollection({ slug: 'base-set', titre: 'x' }, TROUES, { tirages: ['jp'], connus: CONNUS }).raison, 'ambigu');
    v('collection : sans jumeau connu, le set troué est retenu', CN.apparierCollection({ slug: 'base-set', titre: 'x' }, TROUES, { tirages: ['jp'], connus: TROUES }).set, 'Base-Set-JP');
    v('collection : un seul set connu mais non troué = refus non-troue', CN.apparierCollection({ slug: 'base-set', titre: 'x' }, [{ set: 'Z', code: 'ZZ', nom: 'Zed', tirage: 'jp' }], { tirages: ['jp', 'intl'], connus: [CONNUS[1]] }).raison, 'non-troue');

    // ───────────── 2. appariement item <-> produit ─────────────
    const PRODUITS = [
        { idProduct: 1, name: 'Switch', numero: '016', nomEn: 'Switch', numeroFiche: '016' },
        { idProduct: 2, name: 'Thwackey', numero: '007', nomEn: 'Thwackey', numeroFiche: '007' },
        { idProduct: 3, name: 'Pikachu V1', numero: '025', nomEn: 'Pikachu', numeroFiche: '025' },
        { idProduct: 4, name: 'Pikachu V2', numero: '025', nomEn: 'Pikachu', numeroFiche: '025' },
        { idProduct: 5, name: 'Morpeko V-UNION', numero: null, nomEn: 'Morpeko V-UNION', numeroFiche: 'SWSH287' },
        { idProduct: 6, name: 'Energie', numero: null, nomEn: 'Fire Energy', numeroFiche: null }
    ];
    v('item : numéro + nom concordants', CN.apparierItem({ nom: 'Switch', numero: '16' }, PRODUITS).produit.idProduct, 1);
    v('item : zéros de tête ignorés (007 = 7)', CN.apparierItem({ nom: 'Thwackey', numero: '7' }, PRODUITS).produit.idProduct, 2);
    v('item : deux produits au même numéro = variantes, refus', CN.apparierItem({ nom: 'Pikachu', numero: '025' }, PRODUITS).raison, 'variantes');
    v('item : numéro sans produit = refus', CN.apparierItem({ nom: 'Switch', numero: '99' }, PRODUITS).raison, 'numero-absent');
    v('item : le nom contredit le numéro (latin) = refus', CN.apparierItem({ nom: 'Pikachu', numero: '016' }, PRODUITS).raison, 'nom-contredit');
    v('item : nom en kana = non comparable, gardé à lire', CN.apparierItem({ nom: 'スイッチ', numero: '016' }, PRODUITS).nomTemoin, 'non-comparable');
    v('item : sans nom = témoin absent', CN.apparierItem({ nom: null, numero: '016' }, PRODUITS).nomTemoin, 'absent');
    v('item : sans numéro, par nom exact unique', CN.apparierItem({ nom: 'Thwackey', numero: null }, PRODUITS).produit.idProduct, 2);
    v('item : sans numéro, nom partagé = variantes', CN.apparierItem({ nom: 'Pikachu', numero: null }, PRODUITS).raison, 'variantes');
    v('item : sans numéro ni nom = refus', CN.apparierItem({ nom: null, numero: null }, PRODUITS).raison, 'item-illisible');
    v('item : le nom n\'est pas inclus (Fire contre Fire Energy)', CN.apparierItem({ nom: 'Fire', numero: null }, PRODUITS).ok, false);
    const doubles = CN.apparierItems([{ nom: 'Switch', numero: '016', n: 1 }, { nom: 'Switch', numero: '016', n: 2 }, { nom: 'Thwackey', numero: '007', n: 3 }], PRODUITS);
    v('items : un produit revendiqué deux fois par la même source est refusé pour les DEUX', doubles.refus.map(r => r.raison), ['partage', 'partage']);
    v('items : l\'item non partagé passe', doubles.retenus.map(r => r.produit.idProduct), [2]);

    // ───────────── 3. images ─────────────
    v('définition : la plus large gagne', CN.meilleureDefinition([{ url: 'a', w: 400, h: 560 }, { url: 'b', w: 868, h: 1212 }, { url: 'c', w: 570, h: 800 }]).choix.url, 'b');
    v('définition : à égalité, la première', CN.meilleureDefinition([{ url: 'a', w: 500, h: 700 }, { url: 'b', w: 500, h: 700 }]).choix.url, 'a');
    v('définition : ≥ 350 n\'est pas basse définition', CN.meilleureDefinition([{ url: 'a', w: 350, h: 490 }]).basseDefinition, false);
    v('définition : 349 est basse définition', CN.meilleureDefinition([{ url: 'a', w: 349, h: 489 }]).basseDefinition, true);
    v('définition : 200 est basse définition gardée', CN.meilleureDefinition([{ url: 'a', w: 200, h: 280 }]).choix.url, 'a');
    v('définition : 199 ne prouve rien, refus trop-petit', CN.meilleureDefinition([{ url: 'a', w: 199, h: 280 }]).refus, 'trop-petit');
    v('définition : aucune image = refus', CN.meilleureDefinition([]).refus, 'aucune-image');
    v('définition : largeur inconnue ignorée', CN.meilleureDefinition([{ url: 'a', w: null }, { url: 'b', w: 400, h: 560 }]).choix.url, 'b');
    v('filigrane : site déclaré = index de l\'API seulement', CN.filigrane({ filigrane: true }), { servi: false, destination: 'index-api-seulement' });
    v('filigrane : site propre = servi', CN.filigrane({ filigrane: false }), { servi: true, destination: 'servi' });
    v('filigrane : non déclaré = propre', CN.filigrane({}).servi, true);

    // ───────────── 4. cadence, fermeture, reprise ─────────────
    v('cadence : grand site 6 s', CN.cadenceDe({}), 6000);
    v('cadence : petit site 10 s', CN.cadenceDe({ petit: true }), 10000);
    v('cadence : jamais sous 5 s même si le registre le demande', CN.cadenceDe({ cadenceMs: 1000 }), 5000);
    for (const s of [401, 403, 410, 429]) v(`fermeture : HTTP ${s} ferme l'hôte`, CN.hoteAFermer({ status: s }), true);
    v('fermeture : HTTP 404 ne ferme pas', CN.hoteAFermer({ status: 404 }), false);
    v('fermeture : HTTP 500 ne ferme pas', CN.hoteAFermer({ status: 500 }), false);
    v('fermeture : un arrêt de la porte ferme', CN.hoteAFermer({ arret: true }), true);
    v('fermeture : un défi ferme', CN.hoteAFermer({ defi: 'cloudflare' }), true);
    const reg = { objets: { 'https://h.test/a.jpg': { sha256: 'x', fichier: 'f' } }, pages: { 'https://h.test/p': { fichier: 'p.html', le: '2026-11-06T00:00:00.000Z', v: CN.VERSION_EXTRACTION } } };
    v('reprise : image déjà obtenue, jamais redemandée', CN.imageDejaObtenue(reg, 'https://h.test/a.jpg'), true);
    v('reprise : image inconnue à demander', CN.imageDejaObtenue(reg, 'https://h.test/b.jpg'), false);
    v('reprise : page récente (1 jour) relue du cache', CN.pageDejaLue(reg, 'https://h.test/p', new Date('2026-11-07T00:00:00Z')), true);
    v('reprise : page de plus de 7 jours à redemander', CN.pageDejaLue(reg, 'https://h.test/p', new Date('2026-11-20T00:00:00Z')), false);

    // ───────────── 5. lecture des pages ─────────────
    const htmlIndex = '<a href="/collections/pokemon/sa-grass-starter-set-v" title="x">sA</a><a href="/collections/pokemon/aquapolis">A</a><a href="/collections/yugioh/zz">Y</a><a href="/collections/pokemon/aquapolis">dup</a>';
    v('index : liens filtrés par motif, dédoublonnés', CN.collectionsDepuis(htmlIndex, { type: 'liens', motifLien: '^/collections/pokemon/[^/?]+$' }, 'https://h.test/collections/pokemon').map(c => c.slug), ['sa-grass-starter-set-v', 'aquapolis']);
    v('index : url absolue résolue', CN.collectionsDepuis(htmlIndex, { type: 'liens', motifLien: '^/collections/pokemon/[^/?]+$' }, 'https://h.test/x')[0].url, 'https://h.test/collections/pokemon/sa-grass-starter-set-v');
    const htmlPk = '<a class="button" name="S12A" href="/VSTAR-Universe-Expansion/" title="VSTAR Universe Set">x</a><a class="button" name="S12" href="/Lost-Abyss-Expansion/" title="Lost Abyss Set">y</a>';
    const pk = CN.collectionsDepuis(htmlPk, { type: 'liens', motifLien: '^/[A-Za-z0-9-]+-Expansion/$', codeAttr: 'name', titreAttr: 'title' }, 'https://jp.h.test/sets');
    v('index : code et titre lus dans les attributs', [pk[0].code, pk[0].titre, pk[0].slug], ['S12A', 'VSTAR Universe Set', 'VSTAR-Universe-Expansion']);
    v('index : sitemap, adresses <loc> filtrées', CN.collectionsDepuis('<urlset><url><loc>https://h.test/collections/pokemon/a</loc></url><url><loc>https://h.test/blog/z</loc></url></urlset>', { type: 'sitemap', motifLien: '/collections/pokemon/[^/]+$' }, 'https://h.test/sitemap.xml').map(c => c.slug), ['a']);
    const ld = JSON.stringify({ itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Thwackey (Mirror Holofoil) (007/023) (sA: Grass Starter Set V)', url: 'https://h.test/p/1', image: '/images/holding/deck-01.svg' },
        { '@type': 'ListItem', position: 2, name: 'Switch (016/023) (sA: Grass Starter Set V)', url: 'https://h.test/p/2', image: 'https://cdn.test/595501.jpg?v=1' }] });
    const htmlLd = `<script>self.__next=\\"${ld.replace(/"/g, '\\"')}\\"</script>`;
    const its = CN.itemsDepuis(`<script type="application/ld+json">${ld}</script>`, { type: 'jsonld-itemlist', placeholder: '/images/holding/' }, 'https://h.test/collections/pokemon/x');
    v('items : JSON-LD, nom nu et numéro lus du titre', its.map(i => [i.nom, i.numero, i.total]), [['Thwackey', '007', '023'], ['Switch', '016', '023']]);
    v('items : le placeholder n\'est pas une image', its.map(i => i.image), [null, 'https://cdn.test/595501.jpg?v=1']);
    v('items : JSON-LD échappé dans un flux (guillemets \\")', CN.itemsDepuis(htmlLd, { type: 'jsonld-itemlist', placeholder: '/images/holding/' }, 'https://h.test/x').length, 2);
    const htmlCartes = '<div class="card "><a href="/Set-Expansion/Arbok-Card-1" title="Arbok - Set #1"><img class="card lazyload" data-src="https://den.test/397/Arbok.VEN3.1.53045.thumb.png"></a><div class="plaque">#1 - Arbok</div></div>';
    const cs = CN.itemsDepuis(htmlCartes, { type: 'vignettes-plaque', pleine: ['.thumb.', '.'] }, 'https://jp.h.test/Set-Expansion/');
    v('items : vignettes à plaque, image pleine définition déduite', [cs[0].nom, cs[0].numero, cs[0].image], ['Arbok', '1', 'https://den.test/397/Arbok.VEN3.1.53045.png']);
    v('numéro du titre : (012/100) et #12', [CN.numeroDuTitre('Foo (012/100) (Set)'), CN.numeroDuTitre('Foo #12')], [{ numero: '012', total: '100' }, { numero: '12', total: null }]);

    // 07/11 : w-tcs, 262 cartes lues et 0 couverte. Extraits RÉELS de la page « BW7: Plasma Gale » et d'Aquapolis (tradingcardplanet) : le flux répète le JSON-LD, la pagination vit dans le flux avec « & » échappé.
    const itemColress = { '@type': 'ListItem', position: 60, name: 'Colress (075/070) (BW7: Plasma Gale)', url: 'https://tradingcardplanet.com/products/colress-075-070-bw7-plasma-gale', image: 'https://cdn.shopify.com/s/files/1/0617/3979/4509/files/601880.jpg?v=1761584080' };
    const itemColress64 = { '@type': 'ListItem', position: 59, name: 'Colress (064/070) (BW7: Plasma Gale)', url: 'https://tradingcardplanet.com/products/colress-064-070-bw7-plasma-gale', image: 'https://cdn.shopify.com/s/files/1/0617/3979/4509/files/601879.jpg?v=1' };
    const flux = lst => `<script type="application/ld+json">${JSON.stringify({ itemListElement: lst })}</script>`;
    const CFG_LD = { type: 'jsonld-itemlist', placeholder: '/images/holding/' };
    const doublon = CN.itemsDepuis(flux([itemColress64, itemColress]) + '<div>flux</div>' + flux([itemColress64, itemColress]), CFG_LD, 'https://t.test/c');
    v('items : le JSON-LD répété par le flux ne double pas les items', doublon.map(i => i.numero), ['064', '075']);
    const homonymes = CN.itemsDepuis(flux([itemColress, { ...itemColress, url: 'https://tradingcardplanet.com/products/colress-075-070-bw7-plasma-gale-2', position: 61 }]), CFG_LD, 'https://t.test/c');
    v('items : deux annonces d\'urls différentes au même numéro restent deux items', homonymes.length, 2);
    const memeUrl = CN.itemsDepuis(flux([itemColress, { ...itemColress, name: 'Colress (076/070) (BW7: Plasma Gale)' }]), CFG_LD, 'https://t.test/c');
    v('items : même url mais numéros différents = deux items gardés (la clé est position|url|nom)', memeUrl.map(i => i.numero), ['075', '076']);
    const prodColress =[{ idProduct: 568364, name: 'Colress', numero: '075', nomEn: 'Colress' }];
    const apCol = CN.apparierItems(doublon, prodColress);
    v('items : Colress 075 (flux doublé) est apparié, pas rangé en partage', [apCol.retenus.map(x => x.produit.idProduct), apCol.refus.map(x => x.raison)], [[568364], ['numero-absent']]);
    const apHom = CN.apparierItems(homonymes, prodColress);
    v('items : deux annonces distinctes au même numéro restent en partage (§34)', [apHom.retenus.length, apHom.refus.map(x => x.raison)], [0, ['partage', 'partage']]);
    const fluxPage = '...\\"currentPage\\":1,\\"totalPages\\":4,\\"prevUrl\\":null,\\"nextUrl\\":\\"/collections/pokemon/aquapolis?stock=all\\u0026page=2\\"...';
    v('pagination : nextUrl du flux avec « & » échappé (\\u0026) est vue', [CN.pageSuivante(fluxPage, 'page', 1), CN.pageSuivante(fluxPage, 'page', 2)], [true, false]);
    v('pagination : « &amp; » dans un lien est vu', CN.pageSuivante('<a href="/c?stock=all&amp;page=2">2</a>', 'page', 1), true);
    v('pagination : page=2 n\'est pas page=20', CN.pageSuivante('?page=20', 'page', 1), false);
    v('numéro du titre : sous-série à total lettré (H28/H32)', CN.numeroDuTitre('Tyranitar (H28) (H28/H32) (Aquapolis)'), { numero: 'H28', total: 'H32' });
    v('numéro du titre : variante (103b/147)', CN.numeroDuTitre('Porygon (103b) (103b/147) (Aquapolis)'), { numero: '103b', total: '147' });
    const regVieux = { pages: { 'https://h.test/p': { le: '2026-11-06T00:00:00.000Z', donnees: {} } } };
    v('reprise : une page cachée par une autre version de l\'extraction est relue', CN.pageDejaLue(regVieux, 'https://h.test/p', new Date('2026-11-07T00:00:00Z')), false);
    v('reprise : une page cachée par la version courante est reprise', CN.pageDejaLue({ pages: { 'https://h.test/p': { le: '2026-11-06T00:00:00.000Z', v: CN.VERSION_EXTRACTION, donnees: {} } } }, 'https://h.test/p', new Date('2026-11-07T00:00:00Z')), true);

    // ───────────── 6. requêtes de carte (protocole des agents, non lancées par un script) ─────────────
    const rq = CN.requetesDeCarte({ idProduct: 1, nomEn: 'Switch', numero: '016' }, { code: 'sA', nom: 'Sword Shield Starter Decks', tirage: 'jp' });
    vrai('requêtes : au moins 8 distinctes', new Set(rq.map(r => r.q)).size >= 8);
    vrai('requêtes : au moins 3 langues', new Set(rq.map(r => r.langue)).size >= 3);
    vrai('requêtes : nom + code + numéro présents', rq.some(r => /Switch/.test(r.q) && /sA/.test(r.q) && /016/.test(r.q)));

    // ───────────── 7. l'exploration d'un site, bout en bout, sur des faux ─────────────
    const FILE_SETS = [
        { set: 'Sword-Shield-Starter-Decks', code: 'sA', nom: 'Sword Shield Starter Decks', tirage: 'jp', produits: [PRODUITS[0], PRODUITS[1], PRODUITS[2], PRODUITS[3]] },
        { set: 'Base-Set', code: 'BS', nom: 'Base Set', tirage: 'intl', produits: [{ idProduct: 9, name: 'Alakazam', numero: '1', nomEn: 'Alakazam', numeroFiche: '1' }] }
    ];
    const SITE = { code: 'w-a', hotes: ['h.test'], hotesImages: ['cdn.test'], petit: false, tirages: ['jp'], filigrane: false,
        index: [{ url: 'https://h.test/collections/pokemon', extracteur: { type: 'liens', motifLien: '^/collections/pokemon/[^/?]+$' }, pages: { param: 'page', max: 3 } }],
        items: { type: 'jsonld-itemlist', placeholder: '/images/holding/' } };
    const pagesFausses = {
        'https://h.test/collections/pokemon': '<a href="/collections/pokemon/sword-shield-starter-decks">a</a><a href="/collections/pokemon/zz-inconnu">b</a><a href="/collections/pokemon/base-set">c</a>',
        'https://h.test/collections/pokemon/sword-shield-starter-decks': `<script type="application/ld+json">${ld}</script>`
    };
    function monde(opt = {}) {
        const requetes = []; const fermes = [];
        let t = opt.debut ?? 0; const t0 = t;
        return { requetes, fermes,
            lirePage: async (url) => { requetes.push(['page', url]); if (opt.panne) { const e = opt.panne === 'reseau' ? new Error('ETIMEDOUT') : Object.assign(new Error('HTTP 503'), { status: 503 }); throw e; }if (opt.statut && url.endsWith(opt.statut.fin)) { const e = new Error('HTTP ' + opt.statut.code); e.status = opt.statut.code; throw e; } if (pagesFausses[url] !== undefined) return pagesFausses[url]; const e = new Error('HTTP 404'); e.status = 404; throw e; },
            lireImage: async (url) => { requetes.push(['image', url]); return { fichier: `C:\\x\\${url.split('/').pop().split('?')[0]}`, sha256: 'sha-' + url, w: opt.largeur ?? 568, h: 800 }; },
            fermerHote: (h, m) => fermes.push([h, m]),
            maintenant: () => new Date(2026, 10, 7, 3, 0, t), pause: async (ms) => { t += Math.ceil(ms / 1000); }, horloge: () => t - t0 };
    }
    const m1 = monde();
    const r1 = await CN.explorerSite({ site: SITE, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m1, budget: 50 });
    v('site : collections énumérées / appariées', [r1.stats.collectionsEnumerees, r1.stats.collectionsAppariees], [3, 1]);
    v('site : refus de collection par raison (zz inconnu ; Base Set d\'un tirage non admis)', Object.fromEntries(Object.entries(r1.stats.refus).filter(([k]) => k.startsWith('collection:'))), { 'collection:aucun': 1, 'collection:tirage-non-admis': 1 });
    v('site : un item prêt à lire (Switch) ; le placeholder (Thwackey) est un refus nommé', [r1.entrees.length, r1.entrees[0].idProduct, r1.stats.refus['item:sans-image']], [1, 1, 1]);
    v('site : produits couverts comptés', r1.stats.produitsCouverts, 1);
    v('site : l\'entrée est à lire, sans lecture inventée', [r1.entrees[0].regle, r1.entrees[0].lu], ['a-lire', null]);
    v('site : l\'entrée dit d\'où elle vient (hôte de l\'image, source)', [r1.entrees[0].hote, r1.entrees[0].sourcesConsultees], ['cdn.test', ['w-a']]);
    v('site : l\'attendu vient du produit', r1.entrees[0].attendu.nom, 'Switch');
    v('site : jamais de requête hors hôtes déclarés', m1.requetes.every(([, u]) => /^https:\/\/(h|cdn)\.test\//.test(u)), true);
    v('site : 3 requêtes de page (index + 1 collection) et 1 image, rien d\'autre', m1.requetes.map(r => r[0]), ['page', 'page', 'image']);
    vrai('site : cadence d\'au moins 6 s entre deux requêtes du même hôte', m1.horloge() >= 6);
    // reprise : le registre rendu, rejoué, ne redemande ni la page ni l'image
    const m2 = monde({ debut: 3600 });
    const r2 =await CN.explorerSite({ site: SITE, sets: FILE_SETS, registre: r1.registre, ...m2, budget: 50 });
    v('reprise : un second passage ne redemande aucune image', m2.requetes.filter(r => r[0] === 'image').length, 0);
    v('reprise : l\'entrée est rendue quand même (depuis le registre)', r2.entrees.length, 1);
    v('reprise : les pages récentes ne sont pas redemandées non plus', m2.requetes.length, 0);
    // budget
    const m3 = monde();
    const r3 = await CN.explorerSite({ site: SITE, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m3, budget: 1 });
    v('budget : jamais plus de requêtes que le plafond', m3.requetes.length, 1);
    v('budget : l\'arrêt est dit', r3.stats.arretBudget, true);
    // fermeture au premier 403
    const m4 = monde({ statut: { fin: '/collections/pokemon/sword-shield-starter-decks', code: 403 } });
    const r4 = await CN.explorerSite({ site: SITE, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m4, budget: 50 });
    v('403 : l\'hôte est fermé', m4.fermes.map(f => f[0]), ['h.test']);
    v('403 : plus aucune requête après', m4.requetes.length, 2);
    v('403 : le site est dit fermé au journal', r4.stats.ferme, 'HTTP 403');
    // basse définition et filigrane
    const m5 = monde({ largeur: 250 });
    const r5 = await CN.explorerSite({ site: SITE, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m5, budget: 50 });
    v('définition : 250 px = basse définition notée', r5.entrees[0].preparation.basseDefinition, true);
    const m6 = monde({ largeur: 150 });
    const r6 = await CN.explorerSite({ site: SITE, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m6, budget: 50 });
    v('définition : 150 px = refus trop-petit, aucune entrée', [r6.entrees.length, r6.stats.refus['image:trop-petit']], [0, 1]);
    const m7 = monde();
    const r7 = await CN.explorerSite({ site: { ...SITE, filigrane: true }, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m7, budget: 50 });
    v('filigrane : l\'entrée va à l\'index de l\'API seulement', [r7.entrees[0].preparation.filigrane, r7.entrees[0].preparation.destination], [true, 'index-api-seulement']);
    // un hôte d'image non déclaré n'est jamais interrogé
    const m8 = monde();
    const r8 = await CN.explorerSite({ site: { ...SITE, hotesImages: [] }, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m8, budget: 50 });
    v('hôte d\'image non déclaré : refus, aucune image demandée', [m8.requetes.filter(r => r[0] === 'image').length, r8.stats.refus['image:hote-non-declare']], [0, 1]);
    // un produit déjà couvert par un autre passage ne se redemande pas
    const m9 = monde();
    const r9 = await CN.explorerSite({ site: SITE, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m9, budget: 50, dejaCouverts: new Set([1]) });
    v('déjà couvert : aucun téléchargement pour un produit déjà préparé', [m9.requetes.filter(r => r[0] === 'image').length, r9.stats.refus['item:deja-couvert']], [0, 1]);

    // point 1 : le jumeau non troué, bout en bout
    const m10 = monde();
    const r10 = await CN.explorerSite({ site: { ...SITE, tirages: ['jp'] }, sets: FILE_SETS, setsConnus: [...FILE_SETS, { set: 'Sword-Shield-Starter-Decks-EN', code: 'SSE', nom: 'Sword Shield Starter Decks', tirage: 'intl' }], registre: { objets: {}, pages: {} }, ...m10, budget: 50 });
    v('jumeau non troué : collection ambiguë, aucune image', [r10.stats.refus['collection:ambigu'], m10.requetes.filter(r => r[0] === 'image').length], [1, 0]);
    // point 4 : cinq erreurs consécutives (5xx / réseau / délai) arrêtent le site SANS fermer l'hôte
    const SITE6 = { ...SITE, index: [1, 2, 3, 4, 5, 6, 7].map(n => ({ url: `https://h.test/i${n}`, extracteur: { type: 'liens' }, pages: { param: 'page', max: 1 } })) };
    for (const panne of ['503', 'reseau']) {
        const m11 = monde({ panne });
        const r11 = await CN.explorerSite({ site: SITE6, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m11, budget: 50 });
        v(`panne ${panne} : arrêt à la 5e erreur de suite`, [m11.requetes.length, r11.stats.arretErreurs, /5 erreurs de suite/.test(r11.stats.ferme)], [5, true, true]);
        v(`panne ${panne} : l'hôte n'est PAS fermé dans la porte`, m11.fermes.length, 0);
    }
    v('panne : quatre erreurs ne suffisent pas', (await (async () => { const m = monde({ panne: '503' }); const r = await CN.explorerSite({ site: { ...SITE6, index: SITE6.index.slice(0, 4) }, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m, budget: 50 }); return [m.requetes.length, r.stats.arretErreurs]; })()), [4, false]);
    // point 6 : apparié sur le seul numéro
    v('numéro seul : compté (nom absent)', (await (async () => {
        const ldSansNom = JSON.stringify({ itemListElement: [{ '@type': 'ListItem', position: 1, name: ' (016/023) (sA)', url: 'https://h.test/p/2', image: 'https://cdn.test/a.jpg' }] });
        const m = monde(); const p = { ...pagesFausses }; p['https://h.test/collections/pokemon/sword-shield-starter-decks'] = `<script type="application/ld+json">${ldSansNom}</script>`;
        const m2b = { ...m, lirePage: async (u) => { m.requetes.push(['page', u]); if (p[u] !== undefined) return p[u]; throw Object.assign(new Error('404'), { status: 404 }); } };
        return (await CN.explorerSite({ site: SITE, sets: FILE_SETS, registre: { objets: {}, pages: {} }, ...m2b, budget: 50 })).stats.surNumeroSeul;
    })()), 1);
    v('numéro seul : 0 quand le nom concorde', r1.stats.surNumeroSeul, 0);
    // relecture 07/11 : le « nom seul » (aucun numéro des deux côtés) est marqué sur l'entrée et compté au journal
    const ldNom = JSON.stringify({ itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Mew (Movie Set)', url: 'https://h.test/p/mew', image: 'https://cdn.test/mew.jpg' }] });
    const pNom = { ...pagesFausses, 'https://h.test/collections/pokemon/sword-shield-starter-decks': `<script type="application/ld+json">${ldNom}</script>` };
    const mNom = monde(); const mondeNom = { ...mNom, lirePage: async (u) => { mNom.requetes.push(['page', u]); if (pNom[u] !== undefined) return pNom[u]; throw Object.assign(new Error('404'), { status: 404 }); } };
    const rNom = await CN.explorerSite({ site: SITE, sets: [{ ...FILE_SETS[0], produits: [{ idProduct: 77, name: 'Mew', numero: null, nomEn: 'Mew' }] }], registre: { objets: {}, pages: {} }, ...mondeNom, budget: 50 });
    v('nom seul : l\'entrée porte la marque', [rNom.entrees.length, rNom.entrees[0]?.preparation.appariement], [1, 'nom-seul']);
    v('nom seul : compté dans les stats', rNom.stats.surNomSeul, 1);
    v('nom seul : l\'entrée appariée par le numéro ne porte pas la marque', [r1.entrees[0].preparation.appariement, r1.stats.surNomSeul], [undefined, 0]);
    vrai('nom seul : le journal le dit', /1 appariées? sur le nom seul/.test(CN.redigerJournal({ date: 'd', sites: [{ code: 'w-a', actif: true, requetes: 1, collectionsEnumerees: 1, collectionsAppariees: 1, collectionsLues: 1, itemsLus: 1, surNomSeul: 1, produitsCouverts: 1, refus: {}, ferme: null }], population: { fichier: 1, encoreManquants: 1 }, entrees: 1, famille: 'F' })));
    // point 8 : plan périmé ; point 3 : gardes
    v('plan : 2 h = frais', CN.planTropVieux({ le: '2026-11-07T01:00:00Z' }, new Date('2026-11-07T03:00:00Z')), false);
    v('plan : 25 h = périmé', CN.planTropVieux({ le: '2026-11-06T02:00:00Z' }, new Date('2026-11-07T03:00:00Z')), true);
    v('plan : date illisible = périmé', CN.planTropVieux({ le: 'x' }, new Date()), true);
    v('plan : sans date = périmé', CN.planTropVieux({}, new Date()), true);
    v('gardes : --chasse passe par les gardes (STOP, file à l\'arrêt)', CO.MODES_AVEC_GARDES.includes('--chasse'), true);
    v('gardes : --plan n\'y est pas (lecture seule)', CO.MODES_AVEC_GARDES.includes('--plan'), false);

    // ───────────── 8. famille PHASE4, regroupement, journal du matin ─────────────
    const fam = CN.construireFamille('NUIT-20261107', [{ idProduct: 1, hote: 'a' , regle: 'a-lire', preparation: { destination: 'servi' } }, { idProduct: 1, hote: 'b', regle: 'a-lire', preparation: { destination: 'servi' } }, { idProduct: 2, hote: 'a', regle: 'a-lire', preparation: { destination: 'servi' } }], new Date('2026-11-07T03:00:00Z'));
    v('famille : format PHASE4', [fam.famille, Object.keys(fam).sort()], ['NUIT-20261107', ['entrees', 'famille', 'le', 'trous']]);
    v('famille : deux hôtes distincts pour un produit = candidat deux-sources', fam.entrees.map(e => e.candidatDeuxSources), [true, true, false]);
    const md = CN.redigerJournal({ date: '2026-11-07', sites: [{ code: 'w-a', actif: true, requetes: 3, collectionsEnumerees: 3, collectionsAppariees: 1, collectionsLues: 1, itemsLus: 2, produitsCouverts: 1, refus: { 'collection:aucun': 1 }, ferme: null }, { code: 'w-b', actif: false, raison: 'extracteur non écrit' }], population: { fichier: 1412, encoreManquants: 1000 }, entrees: 1, famille: 'NUIT-20261107', avertissements: [] });
    vrai('journal : un tableau par site avec les 5 compteurs demandés', /w-a/.test(md) && /énumérées/.test(md) && /appariées/.test(md) && /lues/.test(md) && /couverts/.test(md) && /refus/.test(md));
    vrai('journal : le site non exploré est dit avec sa raison', /w-b[^\n]*extracteur non écrit/.test(md));
    vrai('journal : la limite de la recherche par moteur est écrite noir sur blanc', /recherche par moteur/i.test(md) && /agents/i.test(md));
    vrai('journal : dénominateur imprimé', /1412/.test(md) && /1000/.test(md));
    vrai('journal : aucun nom de site (codes neutres seulement)', !/tcgsync|pokellector|yuyu|pokewiki|pokumon/i.test(md));

    // ───────────── 9. la ligne de commande reste fermée ─────────────
    const ga = (...a) => CO.verifierArguments(a);
    v('grammaire : --chasse seul', ga('--chasse'), null);
    v('grammaire : --chasse --plafond=300', ga('--chasse', '--plafond=300'), null);
    v('grammaire : --nuit inchangé', ga('--nuit'), null);
    for (const [nom, args] of [['--chasse avec --nuit', ['--chasse', '--nuit']], ['--chasse --limite', ['--chasse', '--limite=5']], ['--chasse --attendu', ['--chasse', '--attendu=1']], ['--chasse --a-blanc', ['--chasse', '--a-blanc']], ['--chasse argument inconnu', ['--chasse', '--tout']], ['--chasse --plafond=0', ['--chasse', '--plafond=0']], ['--plafond avec --plan', ['--plan', '--plafond=5']], ['--plafond avec --decider', ['--decider', '--plafond=5']]])
        vrai(`grammaire : refus — ${nom}`, typeof ga(...args) === 'string');

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
