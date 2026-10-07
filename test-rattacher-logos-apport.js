// Banc de la garde de rattacher-logos-apport.js : elle doit savoir dire NON (§41) — états FABRIQUÉS, aucune base, règle du site importée.
//   node test-rattacher-logos-apport.js
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { planifier } = require('./rattacher-logos-apport');
const SITE = process.env.RAT_MARKET_SITE || path.join(__dirname, '..', 'rat-market-site');
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const b = JSON.stringify(obtenu) === JSON.stringify(attendu); b ? ok++ : ko++; console.log(`${b ? '✅' : '❌'} ${nom}${b ? '' : `\n   obtenu  ${JSON.stringify(obtenu)}\n   attendu ${JSON.stringify(attendu)}`}`); };

(async () => {
    const site = await import(pathToFileURL(path.join(SITE, 'lib', 'visuelSet.ts')).href);
    const A = Buffer.from('fichier A'), B = Buffer.from('fichier B'), Z = Buffer.from('fichier Z');
    const ligne = (fichier, buf, slug, extra = {}) => ({ dossier: 'Deck JP', fichier, sha1: sha1(buf), w: 400, h: 100, decision: 'rattache', slug, langue: 'ja', lu: 'x', parQuoi: 'test', ...extra });
    const parFichier = new Map([['Deck JP/A.png', { buf: A }], ['Deck JP/B.png', { buf: B }], ['DECK ZH/Z.png', { buf: Z }]]);
    const compose = { cleR2: 'logos/composes/x.png', w: 480, h: 120, sha1: 'c0', region: 'jp' };
    const setJp = (id, extra = {}) => ({ _id: id, region: 'jp', tirage: 'jp', logoCompose: { ...compose, sha1: `c-${id}` }, ...extra });
    const actions = (lignes, sets, pf = parFichier) => planifier({ lu: '2026-10-07', lignes }, { parFichier: pf, sets, site }).map(p => p.action);

    verifier('le cas qui passe : un fichier, un set jp à logo composé', actions([ligne('A.png', A, 'S1')], [setJp('S1')]), ['ecrire']);
    verifier('le fichier a changé depuis la lecture : refus', actions([{ ...ligne('A.png', A, 'S1'), sha1: 'f'.repeat(40) }], [setJp('S1')]), ['refus']);
    verifier('set absent : refus', actions([ligne('A.png', A, 'S9')], [setJp('S1')]), ['refus']);
    verifier('set d\'un autre tirage que le dossier (intl sous Deck JP) : refus', actions([ligne('A.png', A, 'S1')], [{ ...setJp('S1'), region: 'intl', tirage: 'intl' }]), ['refus']);
    verifier('deux fichiers pour un même set : le second refuse', actions([ligne('A.png', A, 'S1'), ligne('B.png', B, 'S1')], [setJp('S1')]), ['ecrire', 'refus']);
    verifier('le set a déjà un logo PROPRE : refus (la table doit dire garde-logo-propre)', actions([ligne('A.png', A, 'S1')], [setJp('S1', { logo: { cleR2: 'l/p.png', w: 1, h: 1, sha1: 'p1', langue: 'ja' } })]), ['refus']);
    verifier('le set a un logo GÉNÉRIQUE : il est remplacé', actions([ligne('A.png', A, 'S1')], [setJp('S1', { logo: { cleR2: 'l/g.png', w: 1, h: 1, sha1: 'g1' }, logoGenerique: true })]), ['ecrire']);
    verifier('le même fichier posé sur deux sets de pages différentes : le site le dirait générique — refus des deux',
        actions([ligne('A.png', A, 'S1'), { ...ligne('A.png', A, 'S2') }], [setJp('S1', { bulba: { pageid: 1 } }), setJp('S2', { bulba: { pageid: 2 } })]), ['refus', 'refus']);
    verifier('un fichier déjà porté par un AUTRE set d\'une autre page : refus', actions([ligne('A.png', A, 'S1')], [setJp('S1', { bulba: { pageid: 1 } }), setJp('S2', { bulba: { pageid: 2 }, logo: { cleR2: 'l/a.png', w: 1, h: 1, sha1: sha1(A), langue: 'ja' }, logoCompose: undefined })]), ['refus', 'refus']);   // + l'effet de bord sur S2, dont le fichier deviendrait générique
    verifier('langue non admise pour le tirage (zh-hans sur un set jp) : refus', actions([ligne('A.png', A, 'S1', { langue: 'zh-hans' })], [setJp('S1')]), ['refus']);
    verifier('un logoFr que le site afficherait avant : refus (le nouveau logo ne serait pas vu)',
        actions([ligne('A.png', A, 'S1')], [setJp('S1', { logoFr: { cleR2: 'l/fr.png', w: 1, h: 1, sha1: 'fr1', langue: 'ja' } })]), ['refus']);
    verifier('dossier ZH sur un set zh-hans, langue zh-hans : passe', actions([{ ...ligne('Z.png', Z, 'C1'), dossier: 'DECK ZH', langue: 'zh-hans' }], [{ _id: 'C1', region: 'intl', tirage: 'zh-hans', logoCompose: compose }]), ['ecrire']);
    verifier('« garde-logo-propre » sur un set SANS logo propre : refus (table périmée)', actions([{ ...ligne('A.png', A, 'S1'), decision: 'garde-logo-propre' }], [setJp('S1')]), ['refus']);
    verifier('une décision inconnue : refus', actions([{ ...ligne('A.png', A, 'S1'), decision: 'peut-etre' }], [setJp('S1')]), ['refus']);
    // ── relecture du 2026-10-07 ──
    verifier('reprise d\'un lot interrompu : le fichier déjà posé (apport-manuel, composé retiré) → deja, pas un refus',
        actions([ligne('A.png', A, 'S1')], [{ _id: 'S1', region: 'jp', tirage: 'jp', logo: { cleR2: 'l/a.png', w: 1, h: 1, sha1: sha1(A), source: 'apport-manuel', langue: 'ja' } }]), ['deja']);
    verifier('effet de bord : un générique partagé par S1 et S2 ; remplacer S1 ferait afficher le générique sur S2 → refus',
        actions([ligne('A.png', A, 'S1')], [setJp('S1', { bulba: { pageid: 1 }, logo: { cleR2: 'l/g.png', w: 1, h: 1, sha1: 'g1', langue: 'ja' } }), { _id: 'S2', region: 'jp', tirage: 'jp', bulba: { pageid: 2 }, logo: { cleR2: 'l/g.png', w: 1, h: 1, sha1: 'g1', langue: 'ja' } }]), ['ecrire', 'refus']);   // la ligne d'effet de bord bloque tout le lot
    verifier('un doublon dont la jumelle n\'est pas posée : refus', actions([ligne('A.png', A, 'S1'), { ...ligne('B.png', A, null), fichier: 'B.png', sha1: sha1(B), decision: 'doublon', meme: 'A.png' }], [setJp('S1')]), ['ecrire', 'refus']);
    verifier('un doublon de la même empreinte qu\'une ligne posée : passe', actions([ligne('A.png', A, 'S1'), { dossier: 'Deck JP', fichier: 'A.png', sha1: sha1(A), decision: 'doublon', meme: 'A.png' }], [setJp('S1')]), ['ecrire', 'doublon']);
    verifier('une variante d\'un set dont le logo principal n\'est pas posé : refus', actions([{ dossier: 'Deck JP', fichier: 'B.png', sha1: sha1(B), decision: 'variante', setDuLogoPrincipal: 'S9' }], [setJp('S1')]), ['refus']);
    verifier('garde-logo-propre sur un set qui porte encore un logoCompose : refus', actions([{ ...ligne('A.png', A, 'S1'), decision: 'garde-logo-propre' }], [setJp('S1', { logo: { cleR2: 'l/p.png', w: 1, h: 1, sha1: 'p1', langue: 'ja' } })]), ['refus']);
    const vg = new Map([['Deck JP/A.png', { cleR2: 'vignettes/a.webp', w: 400, h: 100 }]]);
    verifier('la simulation lit la vignette que l\'écriture posera', planifier({ lu: 'x', lignes: [ligne('A.png', A, 'S1')] }, { parFichier, sets: [setJp('S1')], site, vignettes: vg }).map(p => p.action), ['ecrire']);
    // une copie de Pokécardex ne se fabrique pas (il faudrait son empreinte) : on vérifie la fonction que `planifier` appelle
    verifier('une copie de Pokécardex (empreinte) : refusCopie la nomme', !!require('./collecte-cartes/langue-logo').refusCopie('8d82ee9cf71c706c6dab6466cc2c7a9d11041c04', null), true);
    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
