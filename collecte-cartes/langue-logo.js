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
const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function deciderLangue(s, logo) {
    const f = cle(logo);
    const suf = String(logo).match(/\s(EN|JP|JA)\.(png|jpg|svg|gif)$/i)?.[1]?.toUpperCase() || null;
    if (s.region === 'intl') return suf === 'JP' || suf === 'JA'
        ? { ok: false, motif: `set occidental, fichier suffixé « ${suf} » : c'est le logo japonais` }
        : { ok: true, preuve: `set occidental${suf ? `, fichier suffixé « ${suf} »` : ', aucun suffixe de langue'}` };
    if (suf === 'JP' || suf === 'JA') return { ok: true, preuve: `fichier suffixé « ${suf} »` };
    if (suf === 'EN') return { ok: false, motif: 'fichier suffixé « EN » : c\'est le logo du jumeau international' };
    const code = cle(s.code);
    if (code && code.length > 1 && f.startsWith(code)) return { ok: true, preuve: `le fichier commence par le code japonais « ${s.code} »` };
    const ja = cle(s.nomJaTraduit || s.nomAffichage);
    if (ja && ja.length > 3 && f.includes(ja)) return { ok: true, preuve: `le fichier porte le nom japonais du set` };
    const jumeau = cle(s.nomEn);
    if (jumeau && jumeau.length > 3 && f.includes(jumeau)) return { ok: false, motif: `le fichier porte le nom du jumeau « ${s.nomEn} »` };
    return { ok: false, motif: 'aucune preuve de langue dans le nom de fichier' };
}

module.exports = { deciderLangue, cle };
