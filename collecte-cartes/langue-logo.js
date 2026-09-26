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
// est le logo de plusieurs sets distincts sans en nommer aucun. Gardé, et marqué `logoGenerique`, pour que le site le
// traite autrement qu'un logo de set.
const LOGOS_GENERIQUES = new Map([
    ['7ac9fe9c0a8af5830919f0ff6a6d7f1d3d94ee9b', 'l\'étoile « PROMO » de TCGdex, identique sur 8 sets de Black Star Promos'],
    ['7fddb7ca48982f5d551f4bd725e9abba0ac47ed4', '« Pokémon Organized Play » de TCGdex, identique sur les 8 POP Series'],
    ['27ac5482620baf27d98f6fb6396a5e3c28073a7e', '« 横空出世 » (CSM1 Logo A SC.png), le nom de la famille, identique sur ses 3 moitiés']
]);
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

module.exports = { deciderLangue, cle, LOGOS_DU_COUPLE, LOGOS_GENERIQUES, LOGOS_LUS_A_L_OEIL, refusDuCouple, logoGenerique };
