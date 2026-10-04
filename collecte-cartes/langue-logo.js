// LA LANGUE D'UN LOGO DE SET — une définition, pour collecter-logos-sets.js (paramètre `setlogo` de Bulbapedia) et pour
// collecter-logos-demande.js (les fichiers trouvés par l'agent site). Sortie de collecter-logos-sets.js le 2026-09-23 :
// deux collecteurs qui jugent le même objet avec deux copies de la règle finissent par diverger (§21 bis).
//
// LA RÈGLE, par ordre de force, et chaque set écrit LA PREUVE qui l'a fait passer :
//   1. set OCCIDENTAL : le logo lui revient, sauf un fichier suffixé « JP » (0 sur 165 sets occidentaux à logo) ;
//   2. set JAPONAIS, fichier suffixé « JP » : décisif ;
//   3. set JAPONAIS, fichier commençant par le CODE du set (« S10a Dark Phantasma Logo.png ») — un code japonais ne
//      désigne aucun set occidental ;
//   4. set JAPONAIS, fichier portant le nom japonais du set (« Pokémon Card VS Logo.png ») ;
//   5. tout le reste — suffixe « EN », nom du jumeau, rien de reconnaissable — refusé, avec son motif.
//   0. 🔴 (2026-09-26) un tirage ni japonais ni occidental (`sets.tirage` : zh-hans, zh-hant, id, th, idth) est rangé `intl` par
//      sa RÉGION, et la règle 1 lui donnait le logo ANGLAIS du jumeau (30thC, MA6 : « 30th Celebration Logo EN.png », page
//      commune). Il ne reçoit un logo que si le FICHIER nomme son tirage (« … SC », « … Indonesian Thai ») ou si la PAGE est
//      celle de son tirage (suffixe « (ATCG) », « (TCTCG) »…) ; un suffixe EN ou JP est le logo d'un autre tirage.
const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const PAGE_DU_TIRAGE = { 'zh-hans': /\((ATCG|SCTCG)\)$/, 'zh-hant': /\(TCTCG\)$/, id: /\(ITCG\)$/, th: /\(TTCG\)$/, idth: /\((ITCG|TTCG)\)$/ };
const NOM_DU_TIRAGE = { 'zh-hans': /(^|[\s_(-])(SC|Simplified Chinese)([\s_).-]|$)/i, 'zh-hant': /(^|[\s_(-])(TC|Traditional Chinese)([\s_).-]|$)/i, id: /Indonesian/i, th: /Thai/i, idth: /Indonesian|Thai/i };

function deciderLangue(s, logo) {
    const f = cle(logo);
    const suf = String(logo).match(/\s(EN|JP|JA)\.(png|jpg|svg|gif)$/i)?.[1]?.toUpperCase() || null;
    const t = s.tirage;
    if (t && t !== 'jp' && t !== 'intl') {
        if (!PAGE_DU_TIRAGE[t]) return { ok: false, motif: `tirage « ${t} » inconnu de la règle des logos` };
        if (suf) return { ok: false, motif: `tirage ${t}, fichier suffixé « ${suf} » : c'est le logo d'un autre tirage` };
        if (NOM_DU_TIRAGE[t].test(String(logo))) return { ok: true, preuve: `tirage ${t} : le fichier nomme son tirage` };
        if (PAGE_DU_TIRAGE[t].test(String(s.bulba?.titre || ''))) return { ok: true, preuve: `tirage ${t} : la page « ${s.bulba.titre} » est celle de ce tirage` };
        return { ok: false, motif: `tirage ${t} : ni le fichier ni la page (« ${s.bulba?.titre ?? '—'} ») ne désignent ce tirage` };
    }
    if (s.region === 'intl') return suf === 'JP' || suf === 'JA'
        ? { ok: false, motif: `set occidental, fichier suffixé « ${suf} » : c'est le logo japonais` }
        : { ok: true, preuve: `set occidental${suf ? `, fichier suffixé « ${suf} »` : ', aucun suffixe de langue'}` };
    if (suf === 'JP' || suf === 'JA') return { ok: true, preuve: `fichier suffixé « ${suf} »` };
    if (suf === 'EN') return { ok: false, motif: 'fichier suffixé « EN » : c\'est le logo du jumeau international' };
    const oeil = luALOeil(s, logo);
    if (oeil) return oeil;
    const code = cle(s.code);
    if (code && code.length > 1 && f.startsWith(code)) return { ok: true, preuve: `le fichier commence par le code japonais « ${s.code} »` };
    const ja = cle(s.nomJaTraduit || s.nomAffichage);
    if (ja && ja.length > 3 && f.includes(ja)) return { ok: true, preuve: `le fichier porte le nom japonais du set` };
    const jumeau = cle(s.nomEn);
    if (jumeau && jumeau.length > 3 && f.includes(jumeau)) return { ok: false, motif: `le fichier porte le nom du jumeau « ${s.nomEn} »` };
    return { ok: false, motif: 'aucune preuve de langue dans le nom de fichier' };
}

// ════ CE QUE LA LANGUE NE VOIT PAS — deux tables LUES À L'ŒIL, une seule définition pour les deux collecteurs ════
// 🔴 LE LOGO DU COUPLE (lu le 2026-09-23 pour SV2/SV4/SV5, le 2026-09-24 pour les cinq autres, sur une planche R2) : le
// fichier NOMME plusieurs sets (« ブラックボルト » au-dessus de « ホワイトフレア »). Sur la page d'un seul set, c'est afficher le
// nom d'un autre produit — refusé, quelle que soit la langue. Trouvés en groupant les logos posés par EMPREINTE : un
// fichier partagé par des sets DISTINCTS se regarde (les X / X-Additionals, la même carte vendue deux fois, sont justes).
const LOGOS_DU_COUPLE = new Map([
    ['SV2 Logo JP.png', 'Snow Hazard + Clay Burst'], ['SV4 Logo JP.png', 'Ancient Roar + Future Flash'], ['SV5 Logo JP.png', 'Wild Force + Cyber Judge'],
    ['SV11 Logo JP.png', 'Black Bolt + White Flare'], ['M1 Logo JP.png', 'Mega Brave + Mega Symphonia'],
    ['Primordial Arts Logo.png', '洪荒演武 激 + 茂'], ['Dynamax Clash Logo.png', '极巨争锋 雷 + 焰'], ['CSM2 Logo.png', '交相辉映 沐 + 魁 + 唤']
]);
// ⚪ LE LOGO GÉNÉRIQUE (2026-09-24) : vrai, mais il ne distingue pas un set d'un autre — le MÊME fichier (empreinte sha1)
// est le logo de plusieurs sets distincts sans en nommer aucun.
// 🔴 REFUSÉ DEPUIS LE 2026-09-28 (décision du testeur : « les logos génériques sont retirés : ils recevront un logo composé ») —
// il était gardé et marqué `logoGenerique`, et le site ne l'affichait déjà pas. Les collecteurs écrivent désormais un `logoRefus`
// à sa place (`refusGenerique`), et `appliquer-logos-lus.js` retire ceux qui sont en base.
const LOGOS_GENERIQUES = new Map([
    ['7ac9fe9c0a8af5830919f0ff6a6d7f1d3d94ee9b', 'l\'étoile « PROMO » de TCGdex, identique sur 8 sets de Black Star Promos'],
    ['7fddb7ca48982f5d551f4bd725e9abba0ac47ed4', '« Pokémon Organized Play » de TCGdex, identique sur les 9 POP Series'],
    ['27ac5482620baf27d98f6fb6396a5e3c28073a7e', '« 横空出世 » (CSM1 Logo A SC.png), le nom de la famille, identique sur ses 3 moitiés'],
    ['8e87ff264e631834e8a44248675c594e6e36252b', 'le logo McDonald\'s du dépôt ptcg-assets, identique sur 6 McDonald\'s Collection en base le 2026-09-28 (la marque, pas le set)'],
    // décision du testeur du 2026-10-03 : « les 2 logos McDonald's Match Battle qui partagent un fichier : retirés, comme les autres
    // génériques » — chaque set reçoit un logo composé (logo commun + étiquette propre au set).
    ['da4e941e5fdcff642bed1c478e7ea59d42fe16fb', '« Match Battle logo.png » de Bulbagarden, identique sur McDonald\'s Collection 2022 et Match Battle 2023']
]);
// 🔴 LES COPIES DE POKÉCARDEX (décision du testeur, 2026-10-04 : « les 22 logos copiés de Pokécardex : retirés » ; règle du
// 2026-10-03 : son gabarit est une INSPIRATION de mise en page, jamais un fichier à copier ni à reprendre). Les fichiers « jap_NNN »
// du dossier « Logo FR » (WCD, Trick or trade) portent le nommage de Pokécardex ; déposés le 2026-09-27, posés à 22:41 UTC. Par
// EMPREINTE : le fichier est refusé où qu'il soit déposé, sous quelque nom que ce soit. Chaque set recevra un logo composé.
const LOGOS_COPIES = new Map([
    ['8d82ee9cf71c706c6dab6466cc2c7a9d11041c04', 'Logo FR/Trick or trade/jap_070.png (Trick-or-Trade)'],
    ['1a8ee8abca3ae95a21f1f1f9c397e1ae4fb5cd04', 'Logo FR/Trick or trade/jap_071.png (Trick-or-Trade-2023)'],
    ['590876d5fc78ac05974bbb39e569e22d2965c750', 'Logo FR/Trick or trade/jap_072.png (Trick-or-Trade-2024, jamais posé)'],
    ['a097312bc56fb04c1594e7c96b3cd637c92f1258', 'Logo FR/WCD/jap_076.png (WCD-2004)'],
    ['9e113b5f95ddb2dd6794bf47d60c9650c40f3c85', 'Logo FR/WCD/jap_077.png (WCD-2005)'],
    ['a4365736208da8d98062701f8f7c58290a967e6b', 'Logo FR/WCD/jap_078.png (WCD-2006)'],
    ['7ce8d960673466e95bd2d6488a92f831e0cecb9e', 'Logo FR/WCD/jap_079.png (WCD-2007)'],
    ['465a45cd181424d867a60ae303e2150245d47720', 'Logo FR/WCD/jap_080.png (WCD-2008)'],
    ['85d5fc763dff94449b6c9d5e6aa63bb786d6c7d7', 'Logo FR/WCD/jap_081.png (WCD-2009)'],
    ['6f45d97c8556860eceebedbe86e47d4af6a3866a', 'Logo FR/WCD/jap_082.png (WCD-2010)'],
    ['682b8dc17fa51102c138f4dd9721bdd821e2f275', 'Logo FR/WCD/jap_083.png (WCD-2011)'],
    ['9120aaf4d8b64685fdf9e8905aef1b1c2e8879e1', 'Logo FR/WCD/jap_084.png (WCD-2012)'],
    ['21a1925420e4c82262bb5c98d8d9a2207a694a7f', 'Logo FR/WCD/jap_085.png (WCD-2013)'],
    ['430ef78e0d1d751bedc6964fc0bf5b9faa01bb9f', 'Logo FR/WCD/jap_086.png (WCD-2014)'],
    ['82f099f283af1b3e1d945e6f46e2abd2b35aa25e', 'Logo FR/WCD/jap_087.png (WCD-2015)'],
    ['b739de1d1b050d101afcec8f27a926679d73b042', 'Logo FR/WCD/jap_088.png (WCD-2016)'],
    ['4d7bba8da890688664e9ecf10878aaaca8e19cb4', 'Logo FR/WCD/jap_089.png (WCD-2017)'],
    ['f7f678d738d5837f985df4557102d108d7a7b91d', 'Logo FR/WCD/jap_090.png (WCD-2018)'],
    ['d70a0e0d8560c92a0c99d29bfc4fbca91d054fdd', 'Logo FR/WCD/jap_091.png (WCD-2019)'],
    ['db5209aa27804f944d034fa5501c7e87ba96fa5e', 'Logo FR/WCD/jap_092.png (WCD-2022)'],
    ['198061a6a8283a55110ed7e89231c82e8c3956d4', 'Logo FR/WCD/jap_093.png (WCD-2023)'],
    ['a687325820e9599e448e32018b78a467d42e8e50', 'Logo FR/WCD/jap_094.png (WCD-2024)'],
    ['abe29418fa4fa1cfa0e172bf22c0ec6f094c49c7', 'Logo FR/WCD/jap_095.png (WCD-2025)']
]);
/** Le motif du refus d'une copie de Pokécardex (écrit dans `logoRefus.motif`), ou null. */
const refusCopie = sha1 => LOGOS_COPIES.has(sha1)
    ? `logo COPIÉ de Pokécardex, retiré (décision du testeur, 2026-10-04 : son gabarit est une inspiration, jamais un fichier à reprendre ; il recevra un logo composé) — ${LOGOS_COPIES.get(sha1)}` : null;
// 👁️ LES FICHIERS « SANS PREUVE DE LANGUE », LUS À L'ŒIL le 2026-09-26 (téléchargés dans le bac, jamais sur R2 avant verdict) :
// le nom du fichier ne disait rien, l'image le dit. Valable pour un set JAPONAIS seulement — c'est la question qui était posée.
const LOGOS_LUS_A_L_OEIL = new Map([
    ['SV8a Terastal Fest ex Logo.png', { ok: true, texte: '« テラスタルフェスex » en katakana : le logo japonais (xsv8a, Additionals de sv8a)' }],
    ['SouthernIslandsLogo.png', { ok: false, texte: '« Southern Islands Collection » en anglais : le logo de l\'édition occidentale' }],
    ['Pokémon TCG logo old.png', { ok: false, texte: 'le logo générique « Pokémon Trading Card Game » : il ne nomme aucun set' }],
    ['DP4 Boosters.png', { ok: false, texte: 'une photo de boosters, pas un logo' }],
    ['Movie 11 Commemoration.jpg', { ok: false, texte: 'une planche de neuf cartes, pas un logo' }],
    ['SM Pikachu New Friends.jpg', { ok: false, texte: 'la photo du blister, pas un logo' }]
]);
const luALOeil = (s, fichier) => {
    const l = s.region === 'jp' && (!s.tirage || s.tirage === 'jp') ? LOGOS_LUS_A_L_OEIL.get(fichier) : null;
    return !l ? null : l.ok ? { ok: true, preuve: `lu à l'œil le 2026-09-26 : ${l.texte}` } : { ok: false, motif: `lu à l'œil le 2026-09-26 : ${l.texte}` };
};
const refusDuCouple = fichier => LOGOS_DU_COUPLE.has(fichier)
    ? `logo du COUPLE « ${LOGOS_DU_COUPLE.get(fichier)} » : le fichier nomme plusieurs sets (lu à l'œil)` : null;
const logoGenerique = sha1 => LOGOS_GENERIQUES.get(sha1) || null;
/** Le motif du refus d'un logo générique (écrit dans `logoRefus.motif`), ou null. */
const refusGenerique = sha1 => LOGOS_GENERIQUES.has(sha1)
    ? `logo GÉNÉRIQUE refusé (décision du testeur, 2026-09-28 : il recevra un logo composé) — ${LOGOS_GENERIQUES.get(sha1)}` : null;

module.exports = { deciderLangue, cle, LOGOS_DU_COUPLE, LOGOS_GENERIQUES, LOGOS_COPIES, LOGOS_LUS_A_L_OEIL, refusDuCouple, logoGenerique, refusGenerique, refusCopie };
