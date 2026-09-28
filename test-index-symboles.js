// Banc de collecte-cartes/index-symboles.js — images FABRIQUÉES (aucune base, aucun réseau).
const sharp = require('sharp');
const { signatureSymbole, normaliser, correlation, chercherSymbole, COTE } = require('./collecte-cartes/index-symboles');

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };
const svg = corps => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">${corps}</svg>`)).png().toBuffer();
const boite = t => svg(`<rect x="4" y="4" width="112" height="72" rx="10" fill="#111"/><text x="60" y="54" font-size="38" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${t}</text>`);
const etoile = () => svg('<polygon points="60,4 72,32 104,32 78,50 88,78 60,60 32,78 42,50 16,32 48,32" fill="#000"/>');
const rond = () => svg('<circle cx="60" cy="40" r="30" fill="none" stroke="#000" stroke-width="12"/>');

(async () => {
    const images = { sv4a: await boite('sv4a'), sv4K: await boite('sv4K'), sv3: await boite('sv3'), s12a: await boite('s12a'), star: await etoile() };
    const sig = {}; for (const [k, b] of Object.entries(images)) sig[k] = await signatureSymbole(b);
    const index = { entrees: [
        { slug: 'Shiny-Treasure-ex', code: 'sv4a', idExpansion: [5519], ...sig.sv4a },
        { slug: 'Ancient-Roar', code: 'sv4K', idExpansion: [5], ...sig.sv4K },
        { slug: 'Ruler-of-the-Black-Flame', code: 'sv3', idExpansion: [1], ...sig.sv3 },
        { slug: 'VSTAR-Universe', code: 's12a', idExpansion: [2], ...sig.s12a },
        { slug: 'SWSH-Black-Star-Promos', code: 'SWSH', idExpansion: [3], sha1: 'etoile', ...sig.star },
        { slug: 'SM-Black-Star-Promos', code: 'SM', idExpansion: [4], sha1: 'etoile', ...sig.star }
    ] };
    verifier(`signature : ${COTE}×${COTE} octets`, Buffer.from(sig.sv4a.vecteur, 'base64').length, COTE * COTE);
    verifier('corrélation à soi : 1', Math.round(correlation(normaliser(sig.sv4a.vecteur), normaliser(sig.sv4a.vecteur)) * 1000) / 1000, 1);
    verifier('elle-même : désignée', chercherSymbole(index, sig.sv3).designe?.slug, 'Ruler-of-the-Black-Flame');
    // des copies DÉGRADÉES (comme un symbole découpé sur une photo : réduit, JPEG de mauvaise qualité, fond gris, contraste réduit)
    const degradees = {
        'réduite 60×40': await sharp(images.sv4a).flatten({ background: '#ffffff' }).resize(60, 40).png().toBuffer(),
        '30×20, JPEG q40, fond gris': await sharp(images.sv4a).flatten({ background: '#d8d8d8' }).resize(30, 20).jpeg({ quality: 40 }).toBuffer(),
        'contraste réduit (gris 60–190)': await sharp(images.sv4a).flatten({ background: '#ffffff' }).linear(0.5, 60).png().toBuffer()
    };
    // les copies légèrement dégradées DOIVENT retrouver sv4a (un banc qui accepte aussi le silence ne verrait pas l'index devenir muet) ;
    // la copie très dégradée peut se taire — jamais désigner un autre set (sv4K ne diffère que d'une lettre)
    for (const [nom, b] of Object.entries(degradees)) {
        const r = chercherSymbole(index, await signatureSymbole(b));
        if (/JPEG/.test(nom)) verifier(`copie ${nom} : sv4a ou silence, jamais un autre set`, r.designe == null || r.designe.slug === 'Shiny-Treasure-ex', true);
        else verifier(`copie ${nom} : sv4a désigné`, r.designe?.slug, 'Shiny-Treasure-ex');
        console.log(`   ${r.raison}`);
    }
    // LA LIMITE MESURÉE (relecture du 2026-09-28) : à la taille RÉELLE des boîtes ptcg-assets (30×17), « sv4a » et « sv6a » ne se
    // séparent pas en 32×32 — l'index doit se taire, et dire que c'est la SIGNATURE qui ne sépare pas (pas « partagé »)
    const petite = t => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="68"><rect x="2" y="2" width="116" height="64" rx="8" fill="#111"/><text x="60" y="48" font-size="40" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${t}</text></svg>`)).resize(30, 17).png().toBuffer();
    const idxPetites = { entrees: [{ slug: 'Shiny-Treasure-ex', code: 'sv4a', idExpansion: [5519], sha1: 'a', ...(await signatureSymbole(await petite('sv4a'))) },
        { slug: 'Night-Wanderer', code: 'sv6a', idExpansion: [6], sha1: 'b', ...(await signatureSymbole(await petite('sv6a'))) }] };
    const rp = chercherSymbole(idxPetites, await signatureSymbole(await petite('sv4a')));
    verifier('boîtes 30×17 « sv4a » / « sv6a » : sv4a ou silence, et le silence dit que la signature ne sépare pas',
        rp.designe ? rp.designe.slug === 'Shiny-Treasure-ex' : /ne sépare pas/.test(rp.raison), true);
    console.log(`   ${rp.raison}`);
    // la raison NOMME son périmètre (tout l'index, ou les sets demandés)
    verifier('la raison nomme son périmètre', [/tout l'index \(6 sets\)/.test(chercherSymbole(index, sig.sv3).raison), /parmi les 2 sets demandés/.test(chercherSymbole(index, sig.star, { parmi: ['SM-Black-Star-Promos', 'Shiny-Treasure-ex'] }).raison)], [true, true]);
    // une entrée GELÉE (lue d'un JSON figé) ne fait pas lever la recherche ; un vecteur changé est relu (le cache n'est pas périmé)
    const gelee = Object.freeze({ slug: 'Gele', code: 'G', idExpansion: [9], ...sig.sv3 });
    verifier('entrée gelée : aucune exception, retrouvée', chercherSymbole({ entrees: [gelee] }, sig.sv3).designe?.slug, 'Gele');
    const mobile = { slug: 'Mobile', code: 'M', idExpansion: [8], ...sig.sv3 };
    chercherSymbole({ entrees: [mobile] }, sig.sv3); mobile.vecteur = sig.s12a.vecteur;
    verifier('vecteur changé : le cache le relit', chercherSymbole({ entrees: [mobile] }, sig.s12a).classement[0].correlation, 1);
    // un symbole PARTAGÉ (l'étoile PROMO de deux séries) ne désigne rien, et le dit
    const rs = chercherSymbole(index, sig.star);
    verifier('symbole partagé : aucune désignation, raison dite', [rs.designe, /partagé/.test(rs.raison), rs.classement.length >= 2], [null, true, true]);
    // … mais restreint aux candidats d'un vivier qui n'en contient qu'un, il désigne
    verifier('partagé, restreint à UN des deux sets (parmi) : désigné', chercherSymbole(index, sig.star, { parmi: ['SM-Black-Star-Promos', 'Shiny-Treasure-ex'] }).designe?.slug, 'SM-Black-Star-Promos');
    // un dessin absent de l'index : ne désigne aucun set, rend son classement
    const ri = chercherSymbole(index, await signatureSymbole(await rond()));
    verifier('dessin inconnu : rien de désigné, classement rendu', [ri.designe, ri.classement.length > 0], [null, true]);
    verifier('index vide pour ces sets : se tait', chercherSymbole(index, sig.sv3, { parmi: ['Inexistant'] }).designe, null);
    const blanc = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer();
    verifier('image uniforme : se tait', chercherSymbole(index, await signatureSymbole(blanc)).designe, null);
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`}`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
