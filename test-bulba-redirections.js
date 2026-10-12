// Banc de collecte-cartes/bulba.js : telecharger ne suit une redirection QUE vers l'hôte de départ ou la liste fermée Bulbagarden (§75), 3 sauts au plus.
// Faux transport, aucune requête.   node test-bulba-redirections.js
const bulba = require('./collecte-cartes/bulba');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const DEPART = 'https://archives.bulbagarden.net/media/upload/a/a6/XY2_Logo.png';
const R = (status, location, data = Buffer.from('IMG')) => ({ status, headers: { ...(location ? { location } : {}), 'content-type': 'image/png' }, data });
// un faux transport : une file de réponses, les appels sont enregistrés
const transport = reponses => { const appels = []; const f = async url => { appels.push(url); const r = reponses.shift(); if (r instanceof Error) throw r; return r; }; f.appels = appels; return f; };
const essayer = async (reponses, url = DEPART) => { const t = transport(reponses); let res = null, err = null; try { res = await bulba.telecharger(url, { transport: t, delaiMs: 0, attendre: async () => { } }); } catch (e) { err = e; } return { t, res, err }; };

(async () => {
    {
        const { t, res, err } = await essayer([R(200)]);
        verifier('une réponse 200 directe : se comporte comme avant ({ buffer, type }), un seul appel', [err, res?.buffer.toString(), res?.type, t.appels.length], [null, 'IMG', 'image/png', 1]);
    }
    {
        const { t, res, err } = await essayer([R(301, 'https://exemple.org/x.png'), R(200)]);
        verifier('301 vers un AUTRE hôte : REFUS nommé (refusRedirection, l\'hôte dit), jamais suivi', [res, err?.refusRedirection === true, /exemple\.org/.test(err?.message ?? ''), t.appels.length], [null, true, true, 1]);
    }
    {
        const { t, res, err } = await essayer([R(302, 'https://web.archive.org/web/2025/x.png'), R(200)]);
        verifier('302 vers web.archive.org : refus (hors liste)', [res, err?.refusRedirection === true, t.appels.length], [null, true, 1]);
    }
    {
        const { t, res, err } = await essayer([R(301, '/media/upload/b/b2/Autre.png'), R(200)]);
        verifier('301 relative vers le même hôte : suivie, 2 appels, l\'adresse est résolue', [err, res?.buffer.toString(), t.appels], [null, 'IMG', [DEPART, 'https://archives.bulbagarden.net/media/upload/b/b2/Autre.png']]);
    }
    {
        const { res, err, t } = await essayer([R(301, 'https://bulbapedia.bulbagarden.net/media/upload/c/c3/Y.png'), R(200)]);
        verifier('301 vers la liste fermée Bulbagarden (bulbapedia.bulbagarden.net) : suivie', [err, res?.buffer.toString(), t.appels.length], [null, 'IMG', 2]);
    }
    {
        const { err, t } = await essayer([R(301, '/a'), R(301, '/b'), R(301, '/c'), R(301, '/d'), R(200)]);
        verifier('une boucle de 4 redirections (même hôte) : refus au 4e saut, 4 appels exactement', [err?.refusRedirection === true, /sauts/.test(err?.message ?? ''), t.appels.length], [true, true, 4]);
    }
    {
        const { err, t, res } = await essayer([R(301, '/a'), R(301, '/b'), R(301, '/c'), R(200)]);
        verifier('3 sauts : permis', [err, res?.buffer.toString(), t.appels.length], [null, 'IMG', 4]);
    }
    {
        const { err } = await essayer([R(301, 'http://archives.bulbagarden.net/x.png')]);
        verifier('301 vers http (même hôte, protocole non sûr) : refus', err?.refusRedirection === true, true);
    }
    {
        const { err } = await essayer([R(301)]);
        verifier('301 sans destination : refus', err?.refusRedirection === true, true);
    }
    {
        const { err } = await essayer([R(301, 'https://')]);
        verifier('301 vers une adresse illisible : refus', err?.refusRedirection === true, true);
    }
    {
        const e404 = Object.assign(new Error('Request failed'), { response: { status: 404 } });
        const { err, t } = await essayer([e404]);
        verifier('404 : l\'erreur garde la forme « Bulbagarden 404 sur … » (lue par la route B), sans réessai', [/^Bulbagarden 404 sur /.test(err?.message ?? ''), err?.refusRedirection, t.appels.length], [true, undefined, 1]);
    }
    {
        const e403 = Object.assign(new Error('Request failed'), { response: { status: 403 } });
        const { err, t } = await essayer([e403, R(200)]);
        verifier('403 : pas de réessai, erreur « Bulbagarden 403 »', [/^Bulbagarden 403 sur /.test(err?.message ?? ''), t.appels.length], [true, 1]);
    }
    {
        const e503 = Object.assign(new Error('x'), { response: { status: 503 } });
        const t = transport([e503, R(200)]); let attendus = [];
        const res = await bulba.telecharger(DEPART, { transport: t, delaiMs: 0, attendre: async ms => { attendus.push(ms); } });
        verifier('5xx : UN réessai après 60 s (comportement conservé)', [res.buffer.toString(), t.appels.length, attendus.includes(60000)], ['IMG', 2, true]);
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
