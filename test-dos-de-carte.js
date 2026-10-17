// node test-dos-de-carte.js — le serveur d'images répond « introuvable » par le DOS d'une carte Pokémon (HTTP 200, image, 640×892), pas par un 404 : il faut le REFUSER par son empreinte.
// Le vrai fichier (copie lue le 2026-10-17 sous clk-10, clf-17, cll-7, mfb-1, mfba-1, mfbb-1 : six adresses, un seul fichier) est dans fixtures/. Liste FERMÉE d'empreintes sha256.
// Garde : le client ptcgio rend null (comme un 404, le trou reste), la sonde note « dos-de-carte », jamais « repond ».
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const P = require('./collecte-cartes/ptcgio');
const H = require('./collecte-cartes/hotes-images-ptcgio');
const S = require('./sonde-scrydex-decks');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
(async () => {
    const dos = fs.readFileSync(__dirname + '/fixtures/dos-de-carte-serveur-images.png');
    const sha = crypto.createHash('sha256').update(dos).digest('hex');
    verifier('le fichier de banc est le vrai dos (186 316 octets, 640×892)', [dos.length, (await sharp(dos).metadata()).width, (await sharp(dos).metadata()).height], [186316, 640, 892]);
    verifier('la liste fermée contient exactement son empreinte sha256', [...H.EMPREINTES_DOS_DE_CARTE], [sha]);
    verifier('estDosDeCarte : le vrai dos oui', H.estDosDeCarte(dos), true);
    const vraie = await sharp({ create: { width: 596, height: 834, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
    verifier('estDosDeCarte : une autre image non, un tampon vide non, null non', [H.estDosDeCarte(vraie), H.estDosDeCarte(Buffer.alloc(0)), H.estDosDeCarte(null)], [false, false, false]);
    verifier('un octet modifié n\'est plus l\'empreinte (la liste est exacte, pas floue)', H.estDosDeCarte(Buffer.concat([dos, Buffer.from([0])])), false);

    // le client gardé : transport factice qui sert le dos en HTTP 200 → null, comme un 404
    const adresse = P.urlScrydex('me55c-4');
    const fabrique = octets => P.fabriquerClientPtcgio({ cadenceMs: 0, reessaiMs: 0, pause: () => Promise.resolve(), verrou: { tenu: true, perdu: false },
        transport: { async get(url) { return url.endsWith('/robots.txt') ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nAllow: /\n' } : { status: 200, type: 'image/png', octets }; } } });
    verifier('client ptcgio : le dos de carte (200) est rendu null — le trou reste un trou', await fabrique(dos).image(adresse), null);
    const b = await fabrique(vraie).image(adresse);
    verifier('client ptcgio : une vraie image passe', Buffer.isBuffer(b) && b.length === vraie.length, true);

    // la sonde
    const plan = S.construirePlan();
    const t = { vus: [], async get(url) { this.vus.push(url); return url.endsWith('/robots.txt') ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nAllow: /\n' } : { status: 200, type: 'image/png', octets: dos }; } };
    let h = 1e6;
    const r = await S.sonder({ plan, transport: t, pause: ms => { h += ms; return Promise.resolve(); }, maintenant: () => h });
    verifier('sonde : le dos est noté « dos-de-carte » (jamais « repond »), la sonde continue', [r.resultats.every(x => x.etat === 'dos-de-carte'), r.resultats.length, t.vus.length], [true, plan.sondes.length, 1 + plan.sondes.length]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
