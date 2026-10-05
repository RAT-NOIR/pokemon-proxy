// node test-artofpkm-gabarit.js — les lecteurs de collecte-cartes/artofpkm.js (lireListe, lirePageCarte) sur les DEUX gabarits du site.
// Les extraits du NOUVEAU gabarit sont copiés de pages réelles (set 552, Terastal Festival ex, lues le 2026-10-05) ; l'ANCIEN est celui
// que décrit l'en-tête du module (relevé du 2026-09-12), avec une clé réelle de la base (artofpkm/102/1). Aucune requête.
// Le cas qui a fait écrire ce banc : sur le nouveau gabarit, l'ancien lecteur rendait ZÉRO entrée pour tous les sets, sans erreur.
const assert = require('assert');
const { lireListe, lirePageCarte, parcourirListe, releveComplet } = require('./collecte-cartes/artofpkm');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`❌ ${nom} : ${e.message}`); } };

const LIEN_NOUVEAU = '<a data-action="click-&gt;lightbox#open" data-lightbox-src="https://cdn.artofpkm.com/sjvzctugv7yewpd2hpfjh6js3xpy" data-lightbox-width="868" data-lightbox-height="1212" data-lightbox-title="Budew, Terastal Festival ex" data-lightbox-url="/sets/552/card/1" data-lightbox-kind="card" data-lightbox-orientation="portrait" class="flex flex-col group bg-gray-700/20 card-ratio card-cut" aria-label="Open Budew, Terastal Festival ex" href="/sets/552/card/1"><img class="w-full card-cut card-ratio group-hover:scale-110 transition duration-200" data-card-image-loader-target="image" src="https://cdn.artofpkm.com/p62hprlzdog4y5j6tnozl8yf1l65" /></a>';
const CADRES = '<turbo-frame loading="lazy" class="contents" data-controller="frame-lookahead" id="card_batch_100" src="/sets/552/card_batches?direction=asc&amp;group=none&amp;offset=100&amp;sort=number" target="_top"></turbo-frame><turbo-frame loading="lazy" class="contents" data-controller="frame-lookahead" id="card_batch_subset_625_0" src="/sets/552/card_batches?direction=asc&amp;group=none&amp;sort=number&amp;subset=625" target="_top"></turbo-frame>';
const LIEN_ANCIEN = '<a data-lightbox-title="Feebas, Gift Box Emerald" data-lightbox-url="/sets/102/card/1" href="https://cdn.artofpkm.com/xjs4vpkczjpkgn4zk1gwnm7hubmv"><img src="https://cdn.artofpkm.com/vignettexjs4"></a>';
const CADRE_ANCIEN = '<turbo-frame id="card_batch_100" src="/sets/506/card_batches?offset=100"></turbo-frame>';

t('nouveau gabarit : une entrée, l\'original lu dans data-lightbox-src, la vignette dans <img>', () => {
    const L = lireListe(LIEN_NOUVEAU);
    assert.deepStrictEqual(L.entrees, [{ titre: 'Budew, Terastal Festival ex', sourceSetId: 552, n: 1, original: 'https://cdn.artofpkm.com/sjvzctugv7yewpd2hpfjh6js3xpy', cleCdn: 'sjvzctugv7yewpd2hpfjh6js3xpy', vignette: 'https://cdn.artofpkm.com/p62hprlzdog4y5j6tnozl8yf1l65' }]);
    assert.strictEqual(L.sansOriginal, 0);
});
t('nouveau gabarit : les DEUX cadres (lot suivant ET sous-section), &amp; décodé', () => assert.deepStrictEqual(lireListe(LIEN_NOUVEAU + CADRES).cadres,
    ['sets/552/card_batches?direction=asc&group=none&offset=100&sort=number', 'sets/552/card_batches?direction=asc&group=none&sort=number&subset=625']));
t('ancien gabarit : toujours lu (original dans href)', () => {
    const L = lireListe(LIEN_ANCIEN + CADRE_ANCIEN);
    assert.deepStrictEqual([L.entrees.length, L.entrees[0].n, L.entrees[0].cleCdn, L.entrees[0].titre, L.cadres], [1, 1, 'xjs4vpkczjpkgn4zk1gwnm7hubmv', 'Feebas, Gift Box Emerald', ['sets/506/card_batches?offset=100']]);
});
t('un lien de carte sans original reconnaissable : COMPTÉ, jamais une entrée', () => {
    const L = lireListe('<a data-lightbox-title="X, Y" data-lightbox-url="/sets/9/card/3" href="/sets/9/card/3"><img src="https://cdn.artofpkm.com/abc" /></a>');
    assert.deepStrictEqual([L.entrees.length, L.sansOriginal], [0, 1]);
});
t('une page sans lien de carte : zéro entrée, zéro cadre (le vide se voit, il ne se fabrique pas)', () => assert.deepStrictEqual(lireListe('<html><body>rien</body></html>'), { entrees: [], cadres: [], sansOriginal: 0 }));

const PAGE_NOUVELLE = '<html><head><title>001/187 Budew | The Art of Pokémon</title></head><body><a class="link link-muted group inline-flex items-center gap-1" href="/sets/552"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" aria-hidden="true" class="size-4"> <polyline points="11.5 15.25 5.25 9 11.5 2.75" fill="none"/> </svg>Terastal Festival ex</a><h1 class="text-3xl md:text-4xl font-bold leading-tight">Budew</h1><h2 class="ja text-lg md:text-xl text-muted">スボミー</h2><p class="text-xl italic">Illus. <span class="whitespace-nowrap"><a class="link link-bright underline" href="/illustrators/yoriyuki-ikegami">Yoriyuki Ikegami</a></span> </p><img alt="" class="w-full card-ratio card-cut" decoding="async" loading="lazy" src="https://cdn.artofpkm.com/bkdjk8tblqwgk6gwre52aaqcnmzp" /><img alt="" class="size-full object-cover min-h-0 cursor-zoom-in card-cut" data-action="click-&gt;gallery-overlay#open" data-gallery-overlay-index-param="0" src="https://cdn.artofpkm.com/sjvzctugv7yewpd2hpfjh6js3xpy" /></body></html>';
t('nouvelle page de carte : numéro et total lus dans le <title>, nom JA dans le h2, illustrateur, set, original de la galerie, rareté null', () =>
    assert.deepStrictEqual(lirePageCarte(PAGE_NOUVELLE), { numero: '001', total: '187', nomEn: 'Budew', nomJa: 'スボミー', illustrateur: 'Yoriyuki Ikegami', rarete: null, setNomSource: 'Terastal Festival ex', setNomJa: null, original: 'https://cdn.artofpkm.com/sjvzctugv7yewpd2hpfjh6js3xpy' }));
t('nouvelle page sans numéro imprimé (titre sans « / ») : numéro null, jamais un mot du titre', () =>
    assert.deepStrictEqual([lirePageCarte('<title>Basic Grass Energy | The Art of Pokémon</title><h1>Basic Grass Energy</h1>').numero, lirePageCarte('<title>Basic Grass Energy | The Art of Pokémon</title>').total], [null, null]));
t('ancienne page de carte : div.italic, h3.ja, illustrateur et rareté de l\'ancien gabarit', () => {
    const p = lirePageCarte('<div class="font-bold">Gift Box Emerald</div><div class="ja text-sm">ギフトボックス</div><div class="italic">001/019</div><h1>Feebas</h1><h3 class="ja">ヒンバス</h3><span>Illus. </span><a href="/illustrators/kagemaru-himeno"><span>Kagemaru Himeno</span></a><a href="/rarities/3"><span class="font-bold">Common</span></a><img class="w-full card-cut card-ratio x" src="https://cdn.artofpkm.com/xjs4vpkczjpkgn4zk1gwnm7hubmv">');
    assert.deepStrictEqual([p.numero, p.total, p.nomJa, p.illustrateur, p.rarete, p.setNomSource, p.setNomJa, p.original], ['001', '019', 'ヒンバス', 'Kagemaru Himeno', 'Common', 'Gift Box Emerald', 'ギフトボックス', 'https://cdn.artofpkm.com/xjs4vpkczjpkgn4zk1gwnm7hubmv']);
});
// 🔴 LA RELECTURE DU 2026-10-06 : une page de carte peut porter des TUILES d'autres cartes (même composant que la liste, ancien ordre de
// classes) ; l'original est l'image de la GALERIE quand elle existe — jamais la première tuile venue.
t('nouvelle page de carte : la galerie passe devant une tuile d\'une autre carte', () => {
    const tuile = '<img class="w-full card-cut card-ratio group-hover:scale-110" src="https://cdn.artofpkm.com/autrecarte0000000000000000000" />';
    assert.strictEqual(lirePageCarte(tuile + PAGE_NOUVELLE).original, 'https://cdn.artofpkm.com/sjvzctugv7yewpd2hpfjh6js3xpy');
});
t('un <title> dont le NOM porte un « / » ne donne pas de numéro (« Pikachu/Raichu LEGEND »)', () =>
    assert.deepStrictEqual(['numero', 'total'].map(k => lirePageCarte('<title>Pikachu/Raichu LEGEND | The Art of Pokémon</title>')[k]), [null, null]));
t('un numéro de promo « 045/SV-P » se lit (numéro à chiffres, total libre)', () =>
    assert.deepStrictEqual(['numero', 'total'].map(k => lirePageCarte('<title>045/SV-P Pikachu | The Art of Pokémon</title>')[k]), ['045', 'SV-P']));

// LE PARCOURS DE LISTE (pur : la lecture d'une page est injectée). 🔴 Un kit à deux decks (set 206, Leafeon vs Metagross Expert Deck)
// n'a AUCUNE carte à la racine, et ses deux sous-sections sont des SETS À PART (/sets/642/card/1 et /sets/643/card/1) : les mêmes n,
// deux cartes. Dédoublonner par n seul jetait le second deck ; demander la page sous l'id du parent rendait 404.
const lien = (sid, n, cle) => `<a data-lightbox-src="https://cdn.artofpkm.com/${cle}" data-lightbox-title="Carte ${sid}/${n}" data-lightbox-url="/sets/${sid}/card/${n}" href="/sets/${sid}/card/${n}"><img src="https://cdn.artofpkm.com/v${cle}" /></a>`;
const PAGES_206 = {
    'sets/206/cards': '<turbo-frame id="card_batch_subset_642_0" src="/sets/206/card_batches?subset=642"></turbo-frame><turbo-frame id="card_batch_subset_643_0" src="/sets/206/card_batches?subset=643"></turbo-frame>',
    'sets/206/card_batches?subset=642': lien(642, 1, 'aaaaaaaa') + lien(642, 2, 'bbbbbbbb'),
    // lien RÉEL du lot enregistré le 2026-10-05 (artofpkm-lot-206-643.html)
    'sets/206/card_batches?subset=643': '<a data-action="click-&gt;lightbox#open" data-lightbox-src="https://cdn.artofpkm.com/97mqmcyzwrc67h11e1av698nkvuv" data-lightbox-width="500" data-lightbox-height="698" data-lightbox-title="Misdreavus, Leafeon vs Metagross Expert Deck +Online · Metagross Deck" data-lightbox-url="/sets/643/card/1" data-lightbox-kind="card" data-lightbox-orientation="portrait" class="flex flex-col group bg-gray-700/20 card-ratio card-cut" aria-label="Open Misdreavus" href="/sets/643/card/1"><img class="w-full card-cut card-ratio group-hover:scale-110 group-hover:shadow-sm transition duration-200" data-card-image-loader-target="image" src="https://cdn.artofpkm.com/tt04hzxbq7hieqctko6u6eg81w4b" /></a>' + lien(643, 2, 'cccccccc')
};
const lire = pages => async chemin => { if (!(chemin in pages)) throw new Error(`page inattendue ${chemin}`); return pages[chemin]; };
const taches = [];
const ta = (nom, f) => taches.push(async () => { try { await f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`❌ ${nom} : ${e.message}`); } });
ta('kit à deux decks : les DEUX sous-sections, même n, deux cartes, chacune sous SON set', async () => {
    const e = await parcourirListe(206, lire(PAGES_206), { journal: () => { } });
    assert.deepStrictEqual(e.map(x => `${x.sourceSetId}/${x.n}`), ['642/1', '642/2', '643/1', '643/2']);
    assert.strictEqual(e.cadresNonLus, 0);
});
ta('un lot qui ne rapporte rien de nouveau n\'ouvre pas ses cadres (la racine, si)', async () => {
    const pages = { 'sets/7/cards': lien(7, 1, 'x1') + '<turbo-frame src="/sets/7/card_batches?offset=100"></turbo-frame>', 'sets/7/card_batches?offset=100': lien(7, 1, 'x1') + '<turbo-frame src="/sets/7/card_batches?offset=200"></turbo-frame>' };
    const e = await parcourirListe(7, lire(pages), { journal: () => { } });
    assert.deepStrictEqual([e.length, e.pages.length, e.cadresNonLus], [1, 2, 0]);
    // … et la liste n'est PAS complète : un lot suivant qui répète la page 1 est un serveur qui a ignoré le paramètre (relecture du 2026-10-06)
    assert.strictEqual(releveComplet(e.pages), false);
});
ta('le plafond de lots atteint : les cadres non lus sont COMPTÉS sur la liste (une liste tronquée ne se vérifie pas)', async () => {
    const pages = {}; for (let i = 0; i < 5; i++) pages[i ? `sets/8/card_batches?offset=${i}` : 'sets/8/cards'] = lien(8, i + 1, `y${i}`) + `<turbo-frame src="/sets/8/card_batches?offset=${i + 1}"></turbo-frame>`;
    const e = await parcourirListe(8, lire(pages), { maxLots: 3, journal: () => { } });
    assert.deepStrictEqual([e.length, e.cadresNonLus], [3, 1]);
});

// releveComplet : la complétude se relit dans le RELEVÉ écrit en base (la propriété `cadresNonLus` ne survit pas à Mongo) — relecture du
// 2026-10-06 : remplir-file-images.js lisait `suite` (l'ancienne forme) et aurait pris toute liste neuve de 100 pour tronquée.
ta('releveComplet : kit à deux decks lu en entier → complet', async () => assert.strictEqual(releveComplet((await parcourirListe(206, lire(PAGES_206), { journal: () => { } })).pages), true));
ta('releveComplet : plafond atteint → incomplet', async () => {
    const pages = {}; for (let i = 0; i < 5; i++) pages[i ? `sets/8/card_batches?offset=${i}` : 'sets/8/cards'] = lien(8, i + 1, `y${i}`) + `<turbo-frame src="/sets/8/card_batches?offset=${i + 1}"></turbo-frame>`;
    assert.strictEqual(releveComplet((await parcourirListe(8, lire(pages), { maxLots: 3, journal: () => { } })).pages), false);
});
ta('releveComplet : un lot suivant VIDE (page vide, anti-robot) → incomplet', async () => {
    const pages = { 'sets/9/cards': lien(9, 1, 'z1') + '<turbo-frame src="/sets/9/card_batches?offset=100"></turbo-frame>', 'sets/9/card_batches?offset=100': '<html></html>' };
    assert.strictEqual(releveComplet((await parcourirListe(9, lire(pages), { journal: () => { } })).pages), false);
});
t('releveComplet : forme du 2026-09-15 (`suite`), dernier lot sans suite → complet ; sans relevé → inconnu (null)', () =>
    assert.deepStrictEqual([releveComplet([{ lot: 1, lues: 100, nouvelles: 100, suite: 'x' }, { lot: 2, lues: 20, nouvelles: 20, suite: null }]), releveComplet(null), releveComplet([{ page: 1 }])], [true, null, null]));

(async () => {
    for (const f of taches) await f();
    console.log(`\n${ko ? `⚠️ ${ko}/${ok + ko} en échec` : `🎉 ${ok}/${ok + ko} passés`} (aucune requête)`);
    process.exit(ko ? 1 : 0);
})();
