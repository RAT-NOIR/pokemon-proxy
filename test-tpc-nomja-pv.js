// node test-tpc-nomja-pv.js — LOT PCC-JP : la voie SECONDE « nomJa + PV » de pokemon-card.com, pour les restes « sans-numero ».
// Les fiches et les cartes ci-dessous sont des EXTRAITS du cache `tpc_fiches` et de la base `cartes`, lus en lecture seule le 2026-10-17
// (DP1 « Space-Time-Creation », EP08 « Entry-Pack-08 » : Cardmarket ne numérote aucun de leurs produits). Rien n'y est inventé.
// Ce que le banc garde : la voie ne s'ouvre QUE sur option, QUE sur pokemon-card.com, QUE pour un reste « sans-numero » dans un set dont une part
// notable des produits n'a pas de numéro ; la voie par le numéro reste prioritaire ; et chaque garde dit NON sur un cas fabriqué.
require('./bancs-dossier-arrets');      // les arrêts et pauses durables d'hôtes : un dossier TEMPORAIRE, jamais le vrai (correction 2, M1)
const T = require('./collecte-cartes/tpc');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// fiches réelles (cache tpc_fiches, 2026-10-17)
const fi = (idFiche, nom, pv, numero, marque, image) => ({ idFiche, nom, pv, numero, denominateur: null, marque, image: `/assets/images/card_images/large/${marque}/${image}`, illustrateur: null });
const FICHES_DP1 = [
    fi(1110, 'きずぐすり', null, null, 'DP1', '001110_T_KIZUGUSURI.jpg'),
    fi(1114, 'ポケモンいれかえ', null, null, 'DP1', '001114_T_POKEMONIREKAE.jpg'),
    fi(1075, 'ルカリオ', 90, 'DPBP#506', 'DP1', '001075_P_RUKARIO.gif'),
    fi(1123, 'ルカリオ', 90, 'DPBP#506', 'DP1', '001123_P_RUKARIO.jpg'),
    fi(1024, 'ゴウカザル', 120, null, 'DP1', '001024_P_GOUKAZARU.gif'),
    fi(1023, 'ゴウカザル', 100, 'DPBP#453', 'DP1', '001023_P_GOUKAZARU.gif')
];
const potion = { _id: 12098, nomEn: 'Potion', nomJa: 'きずぐすり', categorie: 'dresseur', pv: null, images: [] };
const switchC = { _id: 15381, nomEn: 'Switch', nomJa: 'ポケモンいれかえ', categorie: 'dresseur', pv: null, images: [] };
const lucario = { _id: 26354, nomEn: 'Lucario', nomJa: 'ルカリオ', categorie: 'pokemon', pv: 90, images: [] };
const infernapeLvx = { _id: 25216, nomEn: 'Infernape LV.X', nomJa: 'ゴウカザル', categorie: 'pokemon', pv: 120, images: [] };
const infernape = { _id: 24722, nomEn: 'Infernape', nomJa: 'ゴウカザル', categorie: 'pokemon', pv: 100, images: [] };
const trou = (carte, idProduct, numeroFiche = null) => ({ carte, numeroFiche, idProduct });
const OPT = (extra = {}) => ({ slug: 'Space-Time-Creation', partSansNumero: 1, numerosPris: new Set(), fichesPrises: new Set(), ...extra });
const plan = (trous, fiches, o = {}) => T.planifierTpc({ trous, fiches, code: 'DP1', site: 'pokemon-card-com', nomJaPv: OPT(), ...o });

(async () => {
    // ── 1. LA VOIE NE S'OUVRE QUE SUR OPTION ET SEULEMENT SUR pokemon-card.com ─────────────────────────────────────────
    let r = T.planifierTpc({ trous: [trou(potion, 1)], fiches: FICHES_DP1, code: 'DP1', site: 'pokemon-card-com' });
    verifier('sans l\'option, un reste « sans-numero » reste un trou (comportement d\'avant)', [r.plan.length, r.restes[0].motif], [0, 'sans-numero']);
    r = T.planifierTpc({ trous: [trou(potion, 1)], fiches: FICHES_DP1, code: 'DP1', site: 'tpc-asie', nomJaPv: OPT() });
    verifier('l\'option est ignorée sur TPC Asie (le nom japonais ne se compare qu\'à pokemon-card.com)', [r.plan.length, r.restes[0].motif], [0, 'sans-numero']);
    r = plan([trou(potion, 1)], FICHES_DP1, { nomJaPv: OPT({ partSansNumero: 0.1 }) });
    verifier('un set dont moins de 20 % des produits sont sans numéro : la voie reste fermée (le numéro manquant y est l\'exception)', [r.plan.length, r.restes[0].motif], [0, 'sans-numero']);
    r = plan([trou(potion, 1)], FICHES_DP1, { nomJaPv: OPT({ partSansNumero: 0.2 }) });
    verifier('   à 20 % pile, elle s\'ouvre', r.plan.length, 1);

    // ── 2. LE CAS NORMAL : nom japonais égal, PV égaux (ou aucun des deux), fiche unique, marque = code ─────────────────
    r = plan([trou(potion, 699445), trou(switchC, 699446)], FICHES_DP1);
    verifier('DP1 : Potion et Switch (dresseurs, aucun PV) prouvés chacun par SA fiche', r.plan.map(x => `${x.carteId}:${x.fiche.idFiche}:${x.voie}`), ['12098:1110:nomja+pv', '15381:1114:nomja+pv']);
    verifier('   la preuve NOMME la voie, le nom, la fiche et le set', [/nomJa \+ PV/.test(r.plan[0].preuve), /1110/.test(r.plan[0].preuve), /きずぐすり/.test(r.plan[0].preuve), /DP1/.test(r.plan[0].preuve)], [true, true, true, true]);
    verifier('   numero du plan : null (le produit n\'en a pas), nomEn et idProduct reportés', [r.plan[0].numero, r.plan[0].nomEn, r.plan[0].idProduct], [null, 'Potion', 699445]);
    r = plan([trou(infernapeLvx, 1), trou(infernape, 2)], FICHES_DP1);
    verifier('deux fiches de même nom, PV différents : les PV départagent (LV.X 120 → 1024, 100 → 1023)', r.plan.map(x => `${x.carteId}:${x.fiche.idFiche}`).sort(), ['24722:1023', '25216:1024']);

    // ── 3. CHAQUE GARDE DIT NON ───────────────────────────────────────────────────────────────────────────────────────────
    r = plan([trou(lucario, 3)], FICHES_DP1);
    verifier('deux fiches de même nom ET mêmes PV (Lucario 1075 / 1123) → ambigu, aucune image', [r.plan.length, r.restes[0].motif], [0, 'nomja-pv-ambigu']);
    r = plan([trou({ ...lucario, pv: 80 }, 4)], FICHES_DP1);
    verifier('même nom, PV différents (80 chez nous, 90 à la source) → contradiction-pv', [r.plan.length, r.restes[0].motif], [0, 'contradiction-pv']);
    r = plan([trou({ ...potion, pv: 60 }, 5)], FICHES_DP1);
    verifier('un Pokémon à PV face à une fiche sans PV → contradiction-pv', r.restes[0].motif, 'contradiction-pv');
    r = plan([trou({ ...potion, nomJa: 'ピカチュウ' }, 6)], FICHES_DP1);
    verifier('aucune fiche de ce nom japonais dans la liste → trou « nomja-pv-absente » (jamais la fiche voisine)', [r.plan.length, r.restes[0].motif], [0, 'nomja-pv-absente']);
    r = plan([trou(potion, 7)], [{ ...FICHES_DP1[0], marque: 'EP08' }]);
    verifier('la marque imprimée n\'est pas le code de l\'unité → trou « set »', r.restes[0].motif, 'set');
    r = plan([trou(potion, 8)], [{ ...FICHES_DP1[0], image: null }]);
    verifier('une fiche sans image → trou « fiche-sans-image » (rien à télécharger)', r.restes[0].motif, 'fiche-sans-image');
    r = plan([trou(infernape, 9)], FICHES_DP1, { nomJaPv: OPT({ numerosPris: new Set(['DPBP#453']) }) });
    verifier('le numéro de la fiche est PRIS par un produit numéroté ou une image du set → « fiche-prise »', [r.plan.length, r.restes[0].motif], [0, 'fiche-prise']);
    // un numéro RÉPÉTÉ dans la liste (les decks d'un set renumérotent chacun de 1 — la forme de sA ; les numéros ci-dessous sont posés sur des fiches réelles
    // pour reproduire cette forme) ne désigne pas une fiche : il ne la prend que si un produit numéroté de la MÊME carte (même nomJa) le porte
    const rep = FICHES_DP1.map(f => (f.idFiche === 1110 || f.idFiche === 1114) ? { ...f, numero: '013', denominateur: '030' } : f);
    const preneur = (...cles) => new Map([['13', new Set(cles)]]);
    r = plan([trou(potion, 40)], rep, { nomJaPv: OPT({ numerosPris: new Set(['13']), nomsParNumero: preneur(`ja:${T.nomCompare('ポケモンいれかえ')}`, 'en:switch') }) });
    verifier('numéro répété (013 sur deux fiches), pris par un produit d\'une AUTRE carte → la fiche n\'est pas prise, la carte est prouvée', [r.plan.length, r.plan[0]?.fiche.idFiche], [1, 1110]);
    r = plan([trou(potion, 41)], rep, { nomJaPv: OPT({ numerosPris: new Set(['13']), nomsParNumero: preneur(`ja:${T.nomCompare('きずぐすり')}`) }) });
    verifier('   pris par un produit numéroté de la MÊME carte (même nomJa) → « fiche-prise »', [r.plan.length, r.restes[0].motif], [0, 'fiche-prise']);
    r = plan([trou(potion, 43)], rep, { nomJaPv: OPT({ numerosPris: new Set(['13']), nomsParNumero: preneur('en:potion') }) });
    verifier('   pris par une carte qui n\'a que le nomEn de la nôtre → « fiche-prise »', [r.plan.length, r.restes[0].motif], [0, 'fiche-prise']);
    r = plan([trou(potion, 44)], rep, { nomJaPv: OPT({ numerosPris: new Set(['13']), nomsParNumero: preneur('') }) });
    verifier('   pris par une carte SANS aucun nom → inconnu, donc « fiche-prise »', [r.plan.length, r.restes[0].motif], [0, 'fiche-prise']);
    r = plan([trou(potion, 42)], rep, { nomJaPv: OPT({ numerosPris: new Set(['13']) }) });
    verifier('   sans le détail de qui l\'a pris, la garde reste fermée (« je ne sais pas » n\'est pas « tout va bien »)', [r.plan.length, r.restes[0].motif], [0, 'fiche-prise']);
    r = plan([trou(potion, 10)], FICHES_DP1, { nomJaPv: OPT({ fichesPrises: new Set(['1110']) }) });
    verifier('la fiche est déjà celle d\'une image posée dans le set → « fiche-prise »', r.restes[0].motif, 'fiche-prise');
    const doublon = { ...potion, _id: 99999, nomEn: 'Potion (autre carte)' };
    r = plan([trou(potion, 11), trou(doublon, 12)], FICHES_DP1);
    verifier('deux cartes différentes réclament la même fiche (bijection) → AUCUNE des deux', [r.plan.length, r.restes.map(x => x.motif)], [0, ['fiche-revendiquee', 'fiche-revendiquee']]);
    r = plan([trou({ ...potion, images: [{ set: 'Space-Time-Creation', source: 'artofpkm', numero: '012', cleR2: 'x' }] }, 13)], FICHES_DP1);
    verifier('une carte qui a DÉJÀ une image dans ce set (autre source, numérotée) n\'en reçoit pas une seconde', [r.plan.length, r.restes[0].motif], [0, 'sans-numero']);
    r = plan([trou({ ...potion, images: [{ set: 'Autre-Set', source: 'artofpkm', numero: '012', cleR2: 'x' }] }, 14)], FICHES_DP1);
    verifier('   une image dans un AUTRE set ne compte pas', r.plan.length, 1);
    r = plan([trou({ ...potion, nomJa: null }, 15)], FICHES_DP1);
    verifier('une carte sans nomJa → reste « sans-numero » (aucune clé)', [r.plan.length, r.restes[0].motif], [0, 'sans-numero']);
    const dico = T.construireTemoinNomJa([{ _id: 1, nomEn: 'Potion', nomJa: 'きずぐすり' }, { _id: 2, nomEn: 'Potion', nomJa: 'キズぐすり' }]);
    r = plan([trou(potion, 16)], FICHES_DP1, { temoinNomJa: dico });
    verifier('le nomJa de NOTRE carte diverge de celui de nos autres cartes de même nomEn (une faute chez nous ?) → nom-non-comparable', [r.plan.length, r.restes[0].motif], [0, 'nom-non-comparable']);
    const dico2 = T.construireTemoinNomJa([{ _id: 1, nomEn: 'Potion', nomJa: 'きずぐすり' }, { _id: 2, nomEn: 'Potion', nomJa: 'きずぐすり' }]);
    verifier('   un dictionnaire concordant laisse passer', plan([trou(potion, 17)], FICHES_DP1, { temoinNomJa: dico2 }).plan.length, 1);

    // ── 4. LA VOIE PAR LE NUMÉRO RESTE PRIORITAIRE, ET UN PRODUIT NUMÉROTÉ NE PASSE JAMAIS PAR ELLE ─────────────────────────
    const fN = (id, nom, n, pv) => ({ idFiche: id, nom, numero: n, denominateur: '124', pv, marque: 'DP1', image: `/x/${id}.jpg`, illustrateur: null });
    r = plan([trou({ ...infernape, nomJa: 'ゴウカザル' }, 20, '010')], [fN(5010, 'ゴウカザル', '010', 100), fN(5011, 'ゴウカザル', '011', 100)]);
    verifier('un produit AVEC numéro garde sa voie « nom » (numéro + nom), la voie seconde n\'y touche pas', [r.plan[0]?.voie, r.plan[0]?.fiche.idFiche], ['nom', 5010]);
    r = plan([trou(potion, 21, '099')], FICHES_DP1);
    verifier('   un numéro absent de la source reste « absente-de-la-source » même si le nom existe', r.restes[0].motif, 'absente-de-la-source');

    // ── 5. DEUX PRODUITS D'UNE MÊME CARTE : UNE image, le décompte reste juste ──────────────────────────────────────────
    r = plan([trou(potion, 30), trou(potion, 31)], FICHES_DP1);
    verifier('deux produits sans numéro de la même carte → UN visuel au plan, le second compté en reste « meme-carte »', [r.plan.length, r.restes.map(x => x.motif)], [1, ['meme-carte']]);
    verifier('   le décompte : plan + restes = produits', r.plan.length + r.restes.length, 2);

    // ── 6. LE CONTEXTE, calculé depuis la base ────────────────────────────────────────────────────────────────────────────
    const lignes = [{ carteId: 1, idProduct: 1, numeroFiche: null }, { carteId: 2, idProduct: 2, numeroFiche: 'DPBP#453' }, { carteId: 3, idProduct: 3, numeroFiche: '012' }, { carteId: 4, idProduct: 4, numeroFiche: null }];
    const cartes = [{ _id: 5, nomJa: 'きずぐすり', nomEn: 'Potion', images: [{ set: 'S', numero: '077', source: 'artofpkm' }, { set: 'S', numero: null, source: 'pokemon-card-com', urlFiche: 'https://www.pokemon-card.com/card-search/details.php/card/1110/regu/all' }, { set: 'Autre', numero: '099' }] }];
    const ctx = T.contexteNomJaPv({ lignes, cartes, slug: 'S' });
    verifier('contexte : part sans numéro, numéros pris (produits ET images du set), fiches déjà posées', [ctx.partSansNumero, [...ctx.numerosPris].sort(), [...ctx.fichesPrises], ctx.slug], [0.5, ['12', '77', 'DPBP#453'], ['1110'], 'S']);
    verifier('   qui a pris quel numéro : les noms de la carte de l\'image (« 77 »), « » quand la carte du produit est inconnue (« 12 »)', [[...ctx.nomsParNumero.get('77')], [...ctx.nomsParNumero.get('12')]], [[`ja:${T.nomCompare('きずぐすり')}`, 'en:potion'], ['']]);
    verifier('   un set sans produit : part 0, la voie ne s\'ouvrira pas', T.contexteNomJaPv({ lignes: [], cartes: [], slug: 'S' }).partSansNumero, 0);

    // ── 7. LE CÂBLAGE : collecteur-images-tpc.js `planifier` lit la base (fausse, en mémoire) et ouvre la voie seulement chez pokemon-card.com ──
    const { planifier } = require('./collecteur-images-tpc');
    const faussebase = (lignesDb, cartesDb) => ({ collection: n => ({ find: () => ({ toArray: async () => structuredClone(n === 'cartes_produits' ? lignesDb : cartesDb) }) }) });
    const lignesDb = [{ carteId: 12098, idProduct: 699445, numeroFiche: null }, { carteId: 26354, idProduct: 699446, numeroFiche: null }];
    const cartesDb = [{ ...potion }, { ...lucario }];
    let P = await planifier(faussebase(lignesDb, cartesDb), 'Space-Time-Creation', { site: 'pokemon-card-com', code: 'DP1' }, FICHES_DP1);
    verifier('planifier (pokemon-card.com) : Potion prouvée par nomJa + PV, Lucario (2 fiches identiques) refusée', [P.produits, P.trous, P.plan.map(x => x.voie), P.restes.map(x => x.motif)], [2, 2, ['nomja+pv'], ['nomja-pv-ambigu']]);
    P = await planifier(faussebase(lignesDb, cartesDb), 'Space-Time-Creation', { site: 'tpc-asie', code: 'DP1' }, FICHES_DP1);
    verifier('planifier (TPC Asie) : la voie reste fermée', [P.plan.length, P.restes.map(x => x.motif)], [0, ['sans-numero', 'sans-numero']]);
    const lignesNum = [...lignesDb, ...Array.from({ length: 20 }, (_, i) => ({ carteId: 500 + i, idProduct: 800 + i, numeroFiche: String(i + 1) }))];
    P = await planifier(faussebase(lignesNum, [...cartesDb, ...Array.from({ length: 20 }, (_, i) => ({ _id: 500 + i, nomEn: 'X', images: [{ set: 'Space-Time-Creation', numero: String(i + 1), cleR2: 'k' }] }))]), 'Space-Time-Creation', { site: 'pokemon-card-com', code: 'DP1' }, FICHES_DP1);
    verifier('planifier : 2 produits sans numéro sur 22 (9 %) → la voie reste fermée', [P.plan.length, P.restes.map(x => x.motif)], [0, ['sans-numero', 'sans-numero']]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
