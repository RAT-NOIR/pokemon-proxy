// Les données des bancs de pokumon.js et du collecteur : le titre, l'image et les identifiants viennent de l'index RÉEL lu le 2026-10-17 (S7/MESURE-OCC/pk-index.json) —
// une valeur est recopiée, jamais inventée. `wp` refait la forme d'une entrée brute de l'API WordPress.
const CDN = 'https://cdn6966.templcdn.com/wp-content/uploads';
const wp = (id, titre, img, w, h, ev, lang = [1260]) => ({ id, link: `https://pokumon.com/card/x-${id}/`, title: { rendered: titre }, release_event: ev, language: lang, promo_set: [2346], _embedded: { 'wp:featuredmedia': [{ source_url: img, media_details: { width: w, height: h } }] } });
const S12 = 'Play Pokemon Prize Pack Series 1,Play Pokemon Prize Pack Series 2 Special Print';
const RAW = {
    kricketune: wp(75661, `Holofoil Play Pokemon Kricketune V (006/163 ${S12})`, `${CDN}/2024/11/EN_S1080Holofoil-Play-PokemonSpecial-Print.png`, 947, 1325, [7720, 7721]),
    cherrim: wp(75662, `Play Pokemon Cherrim (008/163 ${S12})`, `${CDN}/2024/11/EN_S1081Play-PokemonSpecial-Print.jpg`, 576, 804, [7720, 7721]),
    drizzileHolo: wp(75587, 'Holofoil Play Pokemon Drizzile (056/202 Play Pokemon Prize Pack Series 1 Special Print)', `${CDN}/2024/11/EN_S1006Holofoil-Play-PokemonSpecial-Print.png`, 770, 1078, [7720]),
    drizzile: wp(75588, 'Play Pokemon Drizzile (056/202 Play Pokemon Prize Pack Series 1 Special Print)', `${CDN}/2024/11/EN_S1007Play-PokemonSpecial-Print.png`, 785, 1099, [7720]),
    escapeHolo: wp(75682, `Holofoil Play Pokemon Escape Rope (125/163 ${S12})`, `${CDN}/2024/11/EN_S1101Holofoil-Play-PokemonSpecial-Print.png`, 720, 1008, [7720, 7721]),
    escape: wp(75683, `Play Pokemon Escape Rope (125/163 ${S12})`, `${CDN}/2024/11/EN_S1102Play-PokemonSpecial-Print.jpg`, 576, 804, [7720, 7721]),
    cheren: wp(75856, 'Play Pokemon Cheren\'s Care (134/172 Play Pokemon Prize Pack Series 2,Play Pokemon Prize Pack Series 3 Special Print)', `${CDN}/2024/11/EN_S1275Play-PokemonSpecial-Print.jpg`, 500, 698, [7721, 7838]),
    grotle: wp(75820, 'Play Pokemon Grotle (007/172 Play Pokemon Prize Pack Series 2,Play Pokemon Prize Pack Series 3 Special Print)', `${CDN}/2024/11/EN_S1239Play-PokemonSpecial-Print.jpg`, 500, 698, [7721, 7838]),
    ludicolo: wp(75792, 'Play Pokemon Ludicolo (034/203 Play Pokemon Prize Pack Series 2 Special Print)', `${CDN}/2024/11/EN_S1211Play-PokemonSpecial-Print.jpg`, 500, 698, [7721]),
    regieleki: wp(75976, 'Holofoil Play Pokemon Regieleki VMAX (058/195 Play Pokemon Prize Pack Series 3,Play Pokemon Prize Pack Series 4 Special Print)', `${CDN}/2024/11/EN_S1394Holofoil-Play-PokemonSpecial-Print.png`, 738, 1033, [7838, 8187]),
    gengar22: wp(76001, 'Trick or Trade Gengar (057/198 Line Holo Pikachu jack-o’-lantern stamp Trick or Trade BOOster Bundle exclusive Special Print)', `${CDN}/2026/07/EN_S1695Trick-or-TradeSpecial-Print.png`, 740, 1036, [8001]),
    placeholder: wp(107729, 'Kilowattrel (8/15 McDonald\'s McDonalds Collection)', `${CDN}/2021/03/PlaceholderCard.jpg`, 474, 659, [777])
};
module.exports = { CDN, wp, RAW };
