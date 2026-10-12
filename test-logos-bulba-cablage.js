// Banc du CÂBLAGE de la route B (verrou, feu vert relu, pause après robots.txt, arrêt qui écrit DEFI, plafond) et de la sonde --noter (suspension, atomicité, échec).
// Fausse base (un mini-Mongo en mémoire), faux verrou, faux transport, horloge fausse : AUCUNE requête, aucune écriture réelle.   node test-logos-bulba-cablage.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const Bu = require('./collecte-cartes/logos-bulba');
const E = require('./collecte-cartes/bulba-espacement');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// ── un mini-Mongo : egalité, $exists ; findOne / insertOne / findOneAndUpdate / updateOne (matchedCount)
function fauxMongo(init = []) {
    const docs = new Map(init.map(d => [d._id, { ...d }]));
    const ok = (d, f) => Object.entries(f).every(([k, v]) => v && typeof v === 'object' && '$exists' in v ? ((d[k] !== undefined) === v.$exists) : d[k] === v);
    const trouver = f => [...docs.values()].find(d => ok(d, f));
    return {
        docs,
        async findOne(f) { const d = trouver(f); return d ? { ...d } : null; },
        async insertOne(d) { if (docs.has(d._id)) throw new Error('E11000'); docs.set(d._id, { ...d }); return {}; },
        async findOneAndUpdate(f, u) { const d = trouver(f); if (!d) return null; Object.assign(d, u.$set); return { ...d }; },
        async updateOne(f, u, o) { const d = trouver(f); if (!d) { if (o?.upsert) { docs.set(f._id, { _id: f._id, ...u.$set }); return { matchedCount: 0, upsertedCount: 1 }; } return { matchedCount: 0 }; } Object.assign(d, u.$set); return { matchedCount: 1 }; }
    };
}
const T0 = Date.parse('2026-10-15T19:29:00Z');
const MIN = 60e3, H = 3600e3;
const ROBOTS = 'User-agent: *\nDisallow: /wiki/Special:\n';
const rep = (status, texte = ROBOTS, h = {}) => ({ status, texte, headers: { get: k => ({ 'content-type': 'text/plain', ...h })[k.toLowerCase()] ?? null } });
const SERVI = (o = {}) => ({ _id: E.ID_ETAT, active: false, verdict: 'SERVI', constateLe: T0 + MIN, dernierEssai: T0 + MIN, cadenceMs: 60000, ...o });
const SUSP = (o = {}) => ({ _id: E.ID_ETAT, active: true, depuis: T0, dernierEssai: T0, jusqua: T0 + 7 * 24 * H, verdict: 'DEFI', motif: 'défi', constateLe: T0, ...o });

(async () => {
    // ───── I2. sonde --noter : sonderEtNoter
    {
        const col = fauxMongo([SUSP()]); let n = 0;
        const r = await Bu.sonderEtNoter({ collection: col, client: async () => { n++; return rep(200); }, maintenant: () => T0 + 2 * 24 * H });
        verifier('sonde, suspension active non échue : AUCUNE requête, rien d\'écrit, la raison est dite', [n, r.envoye, /suspendu jusqu/.test(r.raison ?? ''), JSON.stringify(col.docs.get(E.ID_ETAT)) === JSON.stringify(SUSP())], [0, false, true, true]);
    }
    {
        const col = fauxMongo([SUSP()]); let n = 0;
        const now = T0 + 8 * 24 * H;
        const r = await Bu.sonderEtNoter({ collection: col, client: async () => { n++; return rep(200); }, maintenant: () => now });
        const d = col.docs.get(E.ID_ETAT);
        verifier('sonde, suspension ÉCHUE + 200 lisible : une requête, SERVI écrit, la garde l\'accepte', [n, r.verdict, d.active, d.verdict, Bu.feuVertSonde(d, now + MIN).ok], [1, 'SERVI', false, 'SERVI', true]);
    }
    {
        const col = fauxMongo(); let n = 0;
        const r = await Bu.sonderEtNoter({ collection: col, client: async () => { n++; return rep(200); }, maintenant: () => T0 + 5 * MIN });
        verifier('sonde, aucun état : permise, SERVI écrit', [n, r.verdict, col.docs.get(E.ID_ETAT).verdict], [1, 'SERVI', 'SERVI']);
    }
    {
        const col = fauxMongo([SUSP({ jusqua: T0 + MIN })]);
        const r = await Bu.sonderEtNoter({ collection: col, client: async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); }, maintenant: () => T0 + 10 * MIN });
        const d = col.docs.get(E.ID_ETAT);
        verifier('sonde, échec réseau : le verdict d\'ÉCHEC est écrit (AUTRE, suspension), jamais SERVI', [r.verdict, d.verdict, d.active, Bu.feuVertSonde(d, T0 + 11 * MIN).ok], ['AUTRE', 'AUTRE', true, false]);
    }
    {
        const col = fauxMongo([SUSP({ jusqua: T0 + MIN })]);
        const r = await Bu.sonderEtNoter({ collection: col, client: async () => rep(403, '<html>Just a moment</html>', { 'cf-mitigated': 'challenge' }), maintenant: () => T0 + 10 * MIN });
        verifier('sonde, défi Cloudflare : DEFI écrit, suspension 7 jours', [r.verdict, col.docs.get(E.ID_ETAT).active, col.docs.get(E.ID_ETAT).jusqua > T0 + 6 * 24 * H], ['DEFI', true, true]);
    }
    {
        const col = fauxMongo([SERVI({ constateLe: T0 + MIN, dernierEssai: T0 + MIN })]); let n = 0;
        const r = await Bu.sonderEtNoter({ collection: col, client: async () => { n++; return rep(200); }, maintenant: () => T0 + MIN + 5000 });
        verifier('sonde, cadence d\'essai non écoulée (5 s après le précédent) : aucune requête', [n, r.envoye], [0, false]);
    }
    {
        // L'ÉCRITURE EST ATOMIQUE : pendant la requête de la sonde, la route B écrit un DEFI ; le SERVI de la sonde ne doit PAS l'écraser
        const col = fauxMongo([SERVI({ constateLe: T0 - H, dernierEssai: T0 - H })]);
        let leve = null;
        const now = T0 + 30 * MIN;
        try {
            await Bu.sonderEtNoter({ collection: col, maintenant: () => now, client: async () => { await Bu.noterVerdict(col, { verdict: 'DEFI', motif: 'route B : 403' }, now + 1500); return rep(200); } });
        } catch (e) { leve = e; }
        const d = col.docs.get(E.ID_ETAT);
        verifier('sonde, un DEFI écrit PENDANT sa requête n\'est pas écrasé : la sonde lève, l\'état reste DEFI actif', [!!leve, /non écrit|plus la nôtre/.test(leve?.message ?? ''), d.verdict, d.active], [true, true, 'DEFI', true]);
    }

    // ───── I1 bis. executerB : relecture du feu vert, plafond, refus de redirection
    const A = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="10" y="60" font-size="60" fill="#d22" font-family="Arial">ABCD</text></svg>')).png().toBuffer();
    const mkPlan = n => Array.from({ length: n }, (_, i) => ({ ligne: { part: 'JP', fichier: `Logo JP/F${i}.png`, cible: 'ja', set: `Set-${i}`, cache: { sha256: sha256(A) }, pokecardexSha256: 'p'.repeat(64) }, set: `Set-${i}`, url: `https://archives.bulbagarden.net/media/upload/${i}/${i}a/F${i}_Logo.png`, nom: `F${i} Logo.png` }));
    {
        const appels = [];
        let relues = 0;
        const r = await Bu.executerB({ plan: mkPlan(4), feuVert: { ok: true }, lireRobots: async () => { appels.push('robots'); return rep(200); }, telecharger: async u => { appels.push(u); return { buffer: A, type: 'image/png' }; }, relireFeuVert: async () => { relues++; return relues <= 3 ? { ok: true } : { ok: false, raison: 'DEFI écrit entre-temps' }; } });
        verifier('B : le feu vert est relu avant robots.txt ET avant chaque fichier ; perdu en route → arrêt, plus aucune requête', [appels.length, r.fichiers.length, /feu vert/.test(r.arret ?? '')], [3, 2, true]);
    }
    {
        const appels = [];
        const r = await Bu.executerB({ plan: mkPlan(5), feuVert: { ok: true }, plafond: 3, lireRobots: async () => { appels.push('robots'); return rep(200); }, telecharger: async u => { appels.push(u); return { buffer: A, type: 'image/png' }; } });
        verifier('B : plafond explicite de requêtes (3 = robots + 2 fichiers) : arrêt au plafond, dit', [appels.length, r.requetes, /plafond/.test(r.arret ?? '')], [3, 3, true]);
        const r40 = await Bu.executerB({ plan: mkPlan(45), feuVert: { ok: true }, lireRobots: async () => rep(200), telecharger: async () => ({ buffer: A, type: 'image/png' }) });
        verifier('B : plafond par défaut 40 (robots + 39 fichiers)', [Bu.PLAFOND_REQUETES, r40.requetes, /plafond/.test(r40.arret ?? '')], [40, 40, true]);
    }
    {
        let n = 0;
        const r = await Bu.executerB({ plan: mkPlan(3), feuVert: { ok: true }, lireRobots: async () => rep(200), telecharger: async u => { n++; if (n === 2) throw Object.assign(new Error('Bulbagarden redirection refusée sur x : vers https://exemple.org'), { refusRedirection: true }); return { buffer: A, type: 'image/png' }; } });
        verifier('B : une redirection refusée est un REFUS nommé de ce fichier (pas un défi, pas un arrêt) ; les autres continuent', [n, r.fichiers.length, r.refus.length, r.arret], [3, 2, 1, null]);
    }

    // ───── I3/I4. lancerRouteB : le câblage de la CLI
    const cacheDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'l2-cache-'));
    const fauxVerrou = (script = []) => { const j = { prises: 0, rendus: 0, essais: 0 }; return { j, prendre: async () => { j.essais++; const s = script.shift(); if (s) { await s(); return { pid: 1, hote: 'autre', ageS: 3 }; } j.prises++; return null; }, rendre: async () => { j.rendus++; } }; };
    const monde = (over = {}) => {
        const col = fauxMongo([SERVI()]);
        const v = { appels: [], attendus: [], ordre: [] };
        let t = T0 + 10 * MIN;
        const o = {
            plan: mkPlan(2), etatCol: col, verrou: fauxVerrou(), cache: cacheDir(), maintenant: () => t,
            lireRobotsBrut: async () => { v.ordre.push('robots'); return rep(200); },
            telecharger: async u => { v.ordre.push('fichier'); v.appels.push(u); return { buffer: A, type: 'image/png' }; },
            attendre: async ms => { v.attendus.push(ms); if (ms === 5000) v.ordre.push('pause5000'); t += ms; },   // seule la pause de la cadence entre dans l'ordre des requêtes
            ...over
        };
        return { col, v, o, avancer: ms => { t += ms; } };
    };
    {
        const { col, v, o } = monde();
        const r = await Bu.lancerRouteB(o);
        verifier('CLI B, tout va bien : verrou global pris UNE fois et rendu, robots.txt puis PAUSE de 5 s avant le premier fichier, 2 fichiers jugés', [o.verrou.j.prises, o.verrou.j.rendus, v.ordre.slice(0, 3), r.fichiers.length, r.arret], [1, 1, ['robots', 'pause5000', 'fichier'], 2, null]);
        const m2 = monde({ cache: o.cache });
        const r2 = await Bu.lancerRouteB(m2.o);
        verifier('CLI B, rejeu avec le même cache : aucun fichier redemandé (la reprise), mêmes 2 fichiers', [m2.v.appels.length, r2.fichiers.length], [0, 2]);
    }
    {
        const { col, v, o } = monde({ telecharger: async u => { throw new Error(`Bulbagarden 403 sur ${u} (après 1 essai(s))`); } });
        const r = await Bu.lancerRouteB(o);
        const d = col.docs.get(E.ID_ETAT);
        verifier('CLI B, 403 : noterArret ÉCRIT un DEFI actif (7 jours) ; la garde refuse ensuite ; le verrou est rendu', [/403/.test(r.arret ?? ''), d.verdict, d.active, Bu.feuVertSonde(d, T0 + 11 * MIN).ok, o.verrou.j.rendus], [true, 'DEFI', true, false, 1]);
    }
    {
        // un DEFI écrit pendant le téléchargement du 1er fichier (par un autre processus) arrête le 2e
        const m = monde(); let n = 0;
        m.o.telecharger = async u => { n++; if (n === 1) await Bu.noterVerdict(m.col, { verdict: 'DEFI', motif: 'ailleurs' }, T0 + 11 * MIN); return { buffer: A, type: 'image/png' }; };
        const r = await Bu.lancerRouteB(m.o);
        verifier('CLI B, une suspension écrite en cours de route arrête la suivante (feu vert relu avant chaque requête)', [n, r.fichiers.length, /feu vert/.test(r.arret ?? '')], [1, 1, true]);
    }
    {
        // le feu vert est relu APRÈS la prise du verrou : un DEFI écrit pendant l'attente arrête tout, 0 requête
        const m = monde();
        m.o.verrou = fauxVerrou([async () => { await Bu.noterVerdict(m.col, { verdict: 'DEFI', motif: 'pendant l\'attente' }, T0 + 11 * MIN); }]);
        const r = await Bu.lancerRouteB(m.o);
        verifier('CLI B, DEFI écrit PENDANT l\'attente du verrou : feu vert relu après la prise → aucune requête, verrou rendu', [m.v.ordre.length, r.requetes, /feu vert/.test(r.arret ?? ''), m.o.verrou.j.rendus], [0, 0, true, 1]);
    }
    {
        // …et un SERVI qui dépasse 24 h pendant l'attente
        const m = monde();
        m.o.verrou = fauxVerrou([async () => { m.avancer(25 * H); }]);
        const r = await Bu.lancerRouteB(m.o);
        verifier('CLI B, SERVI devenu trop vieux pendant l\'attente du verrou : aucune requête', [m.v.ordre.length, /24 h/.test(r.arret ?? '')], [0, true]);
    }
    {
        // l'attente du verrou est BORNÉE
        const m = monde();
        const toujours = Array.from({ length: 1000 }, () => async () => { });
        m.o.verrou = fauxVerrou(toujours); m.o.attenteVerrouMs = 10000; m.o.pauseVerrouMs = 2000;
        const r = await Bu.lancerRouteB(m.o);
        verifier('CLI B, verrou jamais obtenu : l\'attente est bornée (≤ 6 essais pour 10 s à 2 s), arrêt dit, aucune requête, rien à rendre', [m.o.verrou.j.essais <= 6, m.v.appels.length, /verrou/.test(r.arret ?? ''), m.o.verrou.j.rendus], [true, 0, true, 0]);
    }
    {
        const m = monde({ plan: mkPlan(41) });
        const r = await Bu.lancerRouteB(m.o);
        verifier('CLI B, plan trop grand pour le plafond (41 + robots > 40) : refusé avant le verrou, 0 requête', [m.o.verrou.j.essais, m.v.ordre.length, /plafond/.test(r.arret ?? '')], [0, 0, true]);
    }
    {
        const m = monde(); m.o.estPerdu = () => m.v.appels.length >= 1;
        const r = await Bu.lancerRouteB(m.o);
        verifier('CLI B, verrou global PERDU en route : arrêt après le fichier en cours', [m.v.appels.length, r.fichiers.length, /verrou/.test(r.arret ?? '')], [1, 1, true]);
    }
    {
        const m = monde(); m.o.etatCol = fauxMongo([SERVI({ verdict: 'DEFI' })]);
        const r = await Bu.lancerRouteB(m.o);
        verifier('CLI B, sonde non SERVI dans l\'état : rien ne part, le verrou n\'est même pas pris', [m.o.verrou.j.essais, m.v.ordre.length, /feu vert/.test(r.arret ?? '')], [0, 0, true]);
    }

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
