// ============================================================
// LE BON FICHIER BULBAPEDIA POUR UN TIRAGE — la résolution du piège de `image=` (CLAUDE.md §19)
// ============================================================
// Une page Bulbapedia est une carte TOUS TIRAGES FUSIONNÉS, et `|image=` est le PREMIER tirage. Pour
// un set donné, le visuel se choisit parmi TOUS les fichiers de la page — `image`/`caption`,
// `reprintN`/`recaptionN`, `{{TCGGallery}}` `imageN`/`captionN` — PAR NOM DE SET ET PAR NUMÉRO.
//
// MESURÉ LE 2026-09-13 depuis le wikitext sur R2, zéro requête, 10 sets occidentaux, 1 108 cartes,
// 1 319 impressions : `image=` pris tel quel aurait été FAUX sur 361 (27 %). Par tirage :
//   num          1 218  un fichier du set ET au numéro de l'impression — le seul cas COLLECTÉ
//   set-voisin      38  des fichiers du set, aucun au numéro : le visuel d'un tirage VOISIN
//                       (holo / non-holo de Team Rocket, 15 ; version illustration rare d'ASC, 22)
//   ambigu           1  plusieurs fichiers au même numéro (Pikachu 173 de 151 : carte et Collection)
//   absent          62  AUCUN fichier de ce set — dont 56 d'ASC : une réimpression sans image propre,
//                       la page ne montre que le tirage d'origine (Stellar Crown, Journey Together…)
// 🔴 Seul `num` est un visuel de CE tirage. `set-voisin` montre un autre numéro, `absent` un autre set :
// les collecter reviendrait à afficher un visuel faux avec l'assurance d'un vrai.
//
// COMMENT UN FICHIER EST RATTACHÉ À UN SET, dans cet ordre :
//   1. la légende nomme le set : `{{TCG|Ascended Heroes}}`, filtré sur les expansions de la page
//      (`{{TCG|Illustration rare}}` n'est pas un set) ;
//   2. sinon le NOM DE FICHIER contient le nom du set sans espaces — 1 020 fois sur 1 218 résolues :
//      la plupart des légendes ne portent que « Illus. [[…]] ». Les noms les PLUS LONGS d'abord :
//      « Team Rocket » est contenu dans « Team Rocket Returns ».
// ⚠️ Pas d'attribution implicite « image= appartient à la première expansion » : mesurée à 0 cas utile,
// c'est exactement la supposition du piège.
// Le NUMÉRO est le dernier nombre du nom de fichier UNE FOIS LE NOM DU SET RETIRÉ : le set peut
// contenir des chiffres (« Nidoran32PokémonCard151.jpg » -> 32, pas 151 ; premier passage : 0 sur 177
// résolues pour MEW à cause de ça).
// CONFLIT : la légende et le nom de fichier nomment deux sets différents -> non collecté, compté.

const serre = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
/**
 * Les jetons d'une SÉRIE de promos, tirés du nom d'expansion lui-même — rien n'est deviné :
 * « SWSH Black Star Promos » -> « swshpromo », « Wizards Black Star Promos » -> « wizardspromo »,
 * « McDonald's Collection 2022 » -> « mcdonaldscollection2022promo » (qui ne matche rien, et c'est
 * le bon résultat : ces pages ne portent que le fichier du set d'origine).
 */
const jetonsDeSerie = expansion => {
    const t = String(expansion ?? '').replace(/Black Star Promos?/i, '').replace(/Promotional cards?/i, '').trim();
    const mots = t.split(/\s+/).filter(Boolean);
    const j = new Set();
    if (mots.length) { j.add(serre(`${mots.join('')}promo`)); j.add(serre(`${mots[0]}promo`)); }
    return [...j].filter(x => x.length > 5);   // « promo » nu exclu par construction
};
/** « 044 » -> 44, « TG05 » -> 5 ; rend null si pas de chiffres. */
const numeroEntier = s => { const m = String(s ?? '').match(/(\d+)/); return m ? Number(m[1]) : null; };

/**
 * Les blocs `{{PokémoncardInfobox/Expansion}}` : chacun apparie un tirage occidental et son jumeau
 * japonais. Rend Map « serre(jpexpansion)#jpnum » -> { expansion, numero } (occidental).
 */
function pairesJaponaisOccidental(wt) {
    const paires = new Map();
    paires.jumeaux = new Map();   // serre(jpexpansion) -> Set(expansion occidentale appariée sur la page)
    const tcg = (bloc, champ) => (bloc.match(new RegExp(`^\\|${champ}=\\{\\{TCG\\|([^}|]+)`, 'm')) || [])[1]?.trim() ?? null;
    const val = (bloc, champ) => (bloc.match(new RegExp(`^\\|${champ}=([^\\n]*)`, 'm')) || [])[1]?.trim() ?? null;
    // ⚠️ TOUS les types de carte, et la CASSE varie : `PokémoncardInfobox/Expansion`,
    // `TCGTrainerCardInfobox/Expansion` (C majuscule). Premier jet sur le seul `PokémoncardInfobox` :
    // 19 impressions de MEW « absentes », toutes des Dresseurs ; second jet sensible à la casse : pareil.
    for (const bloc of wt.split(/\{\{[^|}\n]*card ?infobox\/Expansion/i).slice(1)) {
        const e = tcg(bloc, 'expansion'), j = tcg(bloc, 'jpexpansion');
        const n = numeroEntier(val(bloc, 'cardno')), jn = numeroEntier(val(bloc, 'jpcardno'));
        if (e && j) { if (!paires.jumeaux.has(serre(j))) paires.jumeaux.set(serre(j), new Set()); paires.jumeaux.get(serre(j)).add(e); }
        if (e && j && n != null && jn != null) paires.set(`${serre(j)}#${jn}`, { expansion: e, numero: n });
    }
    return paires;
}

/**
 * Tous les fichiers d'une page, avec le(s) TIRAGE(S) OCCIDENTAL(AUX) — (set, numéro) — qu'on peut leur attribuer.
 *
 * 🔴 LE NOM DE FICHIER PEUT ÊTRE JAPONAIS ET LE CONTENU ANGLAIS. Mesuré le 2026-09-13 sur deux témoins
 * téléchargés et regardés : `Charmander4PokémonCard151.jpg` est le scan « MEW EN 004/165 » ;
 * `SwitchInfernoX102.jpg` est « PFL EN 123/094 » — et 102 est le numéro JAPONAIS. Bulbapedia garde le
 * nom du premier envoi (souvent le scan japonais d'avant la sortie) et remplace le contenu. Donc :
 *   - la LÉGENDE fait autorité sur le set ;
 *   - un nom de fichier qui porte une expansion JAPONAISE se TRADUIT par le bloc d'infobox qui l'apparie
 *     (jpexpansion + jpcardno -> expansion + cardno), jamais en lisant son numéro tel quel ;
 *   - un nom de fichier qui porte l'expansion occidentale donne son numéro directement.
 * ⚠️ Deux témoins, pas une preuve générale : un scan réellement japonais sous une légende occidentale
 * ne se voit pas dans le wikitext.
 *
 * @param {string} wt
 * @param {Array<{tirage,expansion}>} impressions  toutes les impressions de la carte
 */
function fichiersDeLaPage(wt, impressions) {
    const intl = new Set(impressions.filter(i => i.tirage === 'intl').map(i => i.expansion).filter(Boolean));
    const paires = pairesJaponaisOccidental(wt);
    const exps = [...new Set(impressions.map(i => i.expansion))].filter(Boolean).sort((a, b) => serre(b).length - serre(a).length);
    const champ = re => { const m = wt.match(re); return m ? m[1].trim() : null; };
    const F = new Map();
    const ajouter = (fichier, legende, origine) => {
        if (!fichier) return;
        fichier = fichier.replace(/^(File|Image):/i, '').trim();
        const f = F.get(fichier) || { fichier, legendes: [], origines: [] };
        if (legende) f.legendes.push(legende);
        f.origines.push(origine);
        F.set(fichier, f);
    };
    ajouter(champ(/^\|image=([^\n|]+)/m), champ(/^\|caption=([^\n]+)/m), 'image');
    for (const m of wt.matchAll(/^\|reprint(\d+)=([^\n|]+)/gm)) ajouter(m[2], champ(new RegExp(`^\\|recaption${m[1]}=([^\\n]+)`, 'm')), `reprint${m[1]}`);
    for (let g = wt.indexOf('{{TCGGallery'); g >= 0; g = wt.indexOf('{{TCGGallery', g + 1)) {
        const fin = wt.indexOf('\n}}', g);
        const bloc = wt.slice(g, fin > 0 ? fin : undefined);
        for (const m of bloc.matchAll(/^\|image(\d+)=([^\n|]+)/gm)) ajouter(m[2], (bloc.match(new RegExp(`^\\|caption${m[1]}=([^\\n]+)`, 'm')) || [])[1], `galerie${m[1]}`);
    }
    for (const f of F.values()) {
        const tcg = new Set(f.legendes.flatMap(l => [...l.matchAll(/\{\{TCG\|([^}|]+)/g)].map(x => x[1].trim())));
        f.setsLegende = exps.filter(e => tcg.has(e));
        // nom de fichier : on RETIRE chaque nom de set trouvé, du plus long au plus court
        let base = serre(f.fichier.replace(/\.(?:jpe?g|png|gif|webp)$/i, ''));
        f.setsFichier = [];
        for (const e of exps) {
            const k = serre(e);
            if (k.length < 3) continue;
            const i = base.lastIndexOf(k);
            if (i >= 0) { f.setsFichier.push(e); base = base.slice(0, i) + '|' + base.slice(i + k.length); }
        }
        const ns = base.match(/\d+/g);
        const numFichier = ns ? Number(ns[ns.length - 1]) : null;
        // Ce que le NOM DE FICHIER dit, traduit en tirages occidentaux
        const parNom = [];
        for (const s of f.setsFichier) {
            if (intl.has(s)) { if (numFichier != null) parNom.push({ expansion: s, numero: numFichier, preuve: 'nom-de-fichier' }); continue; }
            if (numFichier == null) continue;
            // DEUX LECTURES d'un nom japonais, et les deux existent chez Bulbapedia :
            //   (a) numéro JAPONAIS : `SwitchInfernoX102.jpg` = Phantasmal Flames 123 (jp 102) ;
            //   (b) numéro OCCIDENTAL sous le nom du jumeau : le set « 151 » est nommé « PokémonCard151 »
            //       dans TOUS ses fichiers, avec le numéro anglais — `Grabber162PokémonCard151.jpg` = 151
            //       n°162, alors que le japonais est 153.
            // Si les deux lectures désignent deux tirages DIFFÉRENTS de la page, c'est un conflit.
            const a = paires.get(`${serre(s)}#${numFichier}`);
            const b = [...(paires.jumeaux.get(serre(s)) || [])].filter(e => impressions.some(i => i.tirage === 'intl' && i.expansion === e && numeroEntier(i.numero) === numFichier));
            const lectures = [];
            if (a) lectures.push({ ...a, preuve: `nom-de-fichier japonais « ${s} » ${numFichier} apparié par l'infobox` });
            for (const e of b) if (!lectures.some(t => t.expansion === e && t.numero === numFichier)) lectures.push({ expansion: e, numero: numFichier, preuve: `nom-de-fichier du jumeau japonais « ${s} », numéro occidental` });
            if (lectures.length > 1) { f.conflit = true; continue; }
            parNom.push(...lectures);
        }
        const legIntl = f.setsLegende.filter(e => intl.has(e));
        if (legIntl.length) {
            const accord = parNom.filter(t => legIntl.includes(t.expansion));
            if (accord.length) f.tirages = accord.map(t => ({ ...t, preuve: `légende + ${t.preuve}` }));
            else if (!f.setsFichier.length && legIntl.length === 1 && numFichier != null) f.tirages = [{ expansion: legIntl[0], numero: numFichier, preuve: 'légende + numéro du nom de fichier' }];
            else { f.tirages = []; f.conflit = true; }
        } else f.tirages = f.conflit ? [] : parNom;
        f.conflit = !!f.conflit;
    }

    // 🔑 LA CONVENTION DE NOM DES SÉRIES DE PROMOS — 2026-09-19.
    // Bulbapedia nomme « ScorbunnySWSHPromo71.jpg » le n°SWSH071 des *SWSH Black Star Promos*, et
    // « PikachuWizardsPromo27.jpg » le n°27 des *Wizards Black Star Promos*. La règle 2 ci-dessus
    // cherche le nom d'expansion ENTIER dans le fichier (« swshblackstarpromos ») : elle ne trouve
    // rien et la carte tombe en « absent » alors que le fichier la NOMME. C'est le §30 — un
    // instrument muet lu comme un monde vide.
    // MESURÉ AVANT D'ÉCRIRE, 8 sets de promos, 319 impressions tirées au sort : num 159 (50 %),
    // absent 151, dont 130 récupérées par cette convention et 0 ambiguë → 91 %.
    // ⚠️ Elle est STRICTEMENT ADDITIVE : elle ne s'exécute que sur un fichier qu'aucune règle n'a
    // attribué (`tirages` vide, pas de conflit), donc elle ne peut déplacer aucune résolution qui
    // marche. Et le jeton porte la SÉRIE (« swshpromo »), jamais « promo » nu : une carte tirée dans
    // deux séries porterait deux fichiers au même numéro, et le numéro seul ne les sépare pas.
    for (const f of F.values()) {
        if (f.tirages.length || f.conflit) continue;
        const base = serre(f.fichier.replace(/\.(?:jpe?g|png|gif|webp)$/i, ''));
        const trouves = new Map();
        for (const i of impressions) {
            if (!/promo/i.test(i.expansion || '')) continue;
            const n = numeroEntier(i.numero);
            if (n == null) continue;
            for (const j of jetonsDeSerie(i.expansion)) {
                if (!new RegExp(`${j}0*${n}$`).test(base)) continue;
                trouves.set(`${i.expansion}#${n}`, { expansion: i.expansion, numero: n, preuve: `convention de nom « ${j}<numéro> »` });
            }
        }
        const uniques = [...trouves.values()];
        if (uniques.length === 1) f.tirages = uniques;
        else if (uniques.length > 1) f.conflit = true;
    }
    return [...F.values()];
}

/**
 * Le fichier de chaque impression d'une carte dans une expansion.
 * @returns {Array<{impression, classe:'num'|'set-voisin'|'ambigu'|'absent'|'conflit', fichier:string|null, candidats:string[], preuve:string|null}>}
 */
function resoudreTirages(wt, carte, expansion, { tirage = 'intl' } = {}) {
    const imps = (carte.impressions || []).filter(i => i.tirage === tirage && i.expansion === expansion);
    const fs = fichiersDeLaPage(wt, carte.impressions || []);
    const duSet = fs.filter(f => f.tirages.some(t => t.expansion === expansion));
    const conflits = fs.filter(f => f.conflit && (f.setsLegende.includes(expansion) || f.setsFichier.includes(expansion)));
    return imps.map(impression => {
        const n = numeroEntier(impression.numero);
        const auNumero = duSet.filter(f => n != null && f.tirages.some(t => t.expansion === expansion && t.numero === n));
        const candidats = duSet.map(f => f.fichier);
        if (auNumero.length === 1) {
            const t = auNumero[0].tirages.find(x => x.expansion === expansion && x.numero === n);
            return { impression, classe: 'num', fichier: auNumero[0].fichier, candidats, preuve: t.preuve };
        }
        if (auNumero.length > 1) return { impression, classe: 'ambigu', fichier: null, candidats: auNumero.map(f => f.fichier), preuve: null };
        if (!duSet.length && conflits.length) return { impression, classe: 'conflit', fichier: null, candidats: conflits.map(f => f.fichier), preuve: null };
        return { impression, classe: duSet.length ? 'set-voisin' : 'absent', fichier: null, candidats, preuve: null };
    });
}

module.exports = { fichiersDeLaPage, resoudreTirages, pairesJaponaisOccidental, serre, numeroEntier };
