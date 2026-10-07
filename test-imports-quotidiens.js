// BANC — collecte-cartes/imports-quotidiens.js : le worker lance lui-même, une fois par jour (catalogue après 12 h 15 UTC, guide après
// 5 h UTC), l'import du catalogue et celui du guide des prix (ordre du testeur, 2026-10-06 : « sans cron Render payant […] avec une ligne au journal et une alerte en cas
// d'échec »). Aucune base, aucun réseau : une collection en mémoire, un lanceur factice, puis un VRAI processus enfant.
//   node test-imports-quotidiens.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const IQ = require('./collecte-cartes/imports-quotidiens');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`🔴 ${nom} : ${e.message}`); } };
const a = iso => new Date(iso);

// une collection en mémoire qui comprend ce que le module lui demande (findOne par _id, updateOne $set/$push/$setOnInsert + upsert)
function collection() {
    const docs = new Map();
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => k === '_id' ? d._id === v : (v && typeof v === 'object' && '$ne' in v) ? d[k] !== v.$ne : d[k] === v);
    return {
        docs,
        async findOne(f) { return [...docs.values()].find(d => correspond(d, f)) ?? null; },
        async updateOne(f, u, o = {}) {
            let d = [...docs.values()].find(x => correspond(x, f));
            if (!d) { if (!o.upsert) return { matchedCount: 0 }; d = { _id: f._id }; docs.set(d._id, d); Object.assign(d, u.$setOnInsert || {}); }
            Object.assign(d, u.$set || {});
            for (const [k, v] of Object.entries(u.$push || {})) { const l = [...(d[k] || []), ...(v.$each || [v])]; d[k] = v.$slice ? l.slice(v.$slice) : l; }
            return { matchedCount: 1 };
        }
    };
}
const muet = { log() { }, warn() { }, error() { } };

(async () => {
    // ── 1. la décision, pure ──────────────────────────────────────────────────────────────────────────────────────────
    // (testeur, 2026-10-08) l'heure est PAR IMPORT : le catalogue à 12 h 15 UTC (l'export du jour paraît vers 11 h 31 — à 5 h le worker
    // retéléchargeait celui de la veille, ~5 requêtes par jour), le guide à 5 h (il paraît vers 0 h 49)
    const GUI = { heure: 5, minute: 0 }, CAT = { heure: 12, minute: 15 };
    await t('les horaires : catalogue 12 h 15 UTC, guide 5 h UTC', () => assert.deepEqual(IQ.IMPORTS.map(i => [i.nom, i.heure, i.minute]), [['catalogue', 12, 15], ['guide', 5, 0]]));
    await t('guide : avant 5 h UTC rien, à 5 h on lance', () => { assert.equal(IQ.aLancer(null, a('2026-10-07T04:59:00Z'), GUI).lancer, false); assert.equal(IQ.aLancer(null, a('2026-10-07T05:00:00Z'), GUI).lancer, true); });
    await t('catalogue : à 12 h 14 UTC rien, à 12 h 15 on lance', () => { assert.equal(IQ.aLancer(null, a('2026-10-07T12:14:00Z'), CAT).lancer, false); assert.equal(IQ.aLancer(null, a('2026-10-07T12:15:00Z'), CAT).lancer, true); });
    await t('sans horaire : refus de conclure, jamais un lancement', () => assert.throws(() => IQ.aLancer(null, a('2026-10-07T13:00:00Z'))));
    await t('déjà réussi aujourd\'hui : rien', () => assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 1, succesLe: '2026-10-07', dernierEssai: a('2026-10-07T05:01:00Z') }, a('2026-10-07T12:00:00Z'), GUI).lancer, false));
    await t('réussi HIER : on relance aujourd\'hui', () => assert.equal(IQ.aLancer({ jour: '2026-10-06', essais: 1, succesLe: '2026-10-06', dernierEssai: a('2026-10-06T05:01:00Z') }, a('2026-10-07T05:30:00Z'), GUI).lancer, true));
    await t('échec il y a moins d\'une heure : on attend', () => assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 1, dernierEssai: a('2026-10-07T05:10:00Z') }, a('2026-10-07T05:50:00Z'), GUI).lancer, false));
    await t('échec il y a plus d\'une heure : on réessaie', () => assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 1, dernierEssai: a('2026-10-07T05:10:00Z') }, a('2026-10-07T06:20:00Z'), GUI).lancer, true));
    await t('trois essais en échec aujourd\'hui : plus rien jusqu\'à demain', () => {
        assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 3, dernierEssai: a('2026-10-07T07:10:00Z') }, a('2026-10-07T23:00:00Z'), GUI).lancer, false);
        assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 3, dernierEssai: a('2026-10-07T07:10:00Z') }, a('2026-10-08T05:05:00Z'), GUI).lancer, true);
    });
    // (testeur, 2026-10-08) « si l'export du jour a la même date que la veille, aucun téléchargement » : un « rien de neuf » CLÔT le jour
    // — on ne repasse plus (chaque passage était une requête Cardmarket) ; le lendemain, on relance
    await t('« rien de neuf » clôt le jour : plus aucun passage aujourd\'hui ; le lendemain on relance', () => {
        const e = { jour: '2026-10-07', essais: 1, echecs: 0, dernierEssai: a('2026-10-07T12:16:00Z'), dernierResultat: 'rien-de-neuf' };
        assert.equal(IQ.aLancer(e, a('2026-10-07T14:30:00Z'), CAT).lancer, false);
        assert.equal(IQ.aLancer(e, a('2026-10-07T23:59:00Z'), CAT).lancer, false);
        assert.equal(IQ.aLancer(e, a('2026-10-08T12:20:00Z'), CAT).lancer, true);
    });
    await t('aFaire : vrai seulement quand un import doit tourner (le worker ne rend son verrou que dans ce cas)', async () => {
        const E = collection();
        assert.equal(await IQ.aFaire({ E, maintenant: () => a('2026-10-07T04:00:00Z') }), false);
        assert.equal(await IQ.aFaire({ E, maintenant: () => a('2026-10-07T05:10:00Z') }), true, 'le guide est dû');
        await E.updateOne({ _id: 'import-quotidien/guide' }, { $set: { jour: '2026-10-07', essais: 1, succesLe: '2026-10-07' } }, { upsert: true });
        assert.equal(await IQ.aFaire({ E, maintenant: () => a('2026-10-07T11:00:00Z') }), false, 'guide fait, catalogue pas encore dû');
        assert.equal(await IQ.aFaire({ E, maintenant: () => a('2026-10-07T12:20:00Z') }), true, 'le catalogue est dû');
    });
    // la MÉMOIRE du worker sur Render n'est pas mesurable d'ici (l'import seul : 190 Mo de RSS, 61 Mo de tas, insertion non comprise) :
    // la fonction n'est ACTIVE que si la variable le dit, exactement « 1 » — une garde s'écrit par ce qu'elle autorise
    await t('éteint par défaut ; actif seulement avec IMPORTS_QUOTIDIENS=1', () => {
        assert.equal(IQ.actif({}), false); assert.equal(IQ.actif({ IMPORTS_QUOTIDIENS: '0' }), false);
        assert.equal(IQ.actif({ IMPORTS_QUOTIDIENS: 'oui' }), false); assert.equal(IQ.actif({ IMPORTS_QUOTIDIENS: '1' }), true);
    });
    await t('les deux imports, et les commandes de la main (production, confirmée)', () => {
        assert.deepEqual(IQ.IMPORTS.map(i => i.script), ['import-catalogue-quotidien.js', 'import-guide-quotidien.js']);
        for (const i of IQ.IMPORTS) assert.ok(fs.existsSync(path.join(__dirname, i.script)), i.script);
        assert.deepEqual(IQ.ARGS, ['--base=test', '--confirmer-production']);
    });

    // ── 2. le passage, sur une collection en mémoire et un lanceur factice ───────────────────────────────────────────────────
    await t('succès : succesLe posé, une ligne de journal, aucune alerte ; le second passage du jour ne relance rien', async () => {
        const E = collection(), lances = [];
        const lancer = async (script) => { lances.push(script); return { code: 0, dureeS: 12, extrait: '✅ rien de neuf' }; };
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T05:03:00Z'), journal: muet });
        assert.deepEqual(lances, ['import-guide-quotidien.js'], 'à 5 h, le guide seul');
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T12:20:00Z'), journal: muet });
        assert.deepEqual(lances, ['import-guide-quotidien.js', 'import-catalogue-quotidien.js'], 'à 12 h 20, le catalogue');
        const c = await E.findOne({ _id: 'import-quotidien/catalogue' });
        assert.equal(c.succesLe, '2026-10-07'); assert.equal(c.essais, 1); assert.equal(c.journal.length, 1); assert.equal(c.journal[0].code, 0);
        assert.equal(await E.findOne({ _id: 'alerte/import-catalogue', active: true }), null);
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T16:00:00Z'), journal: muet });
        assert.equal(lances.length, 2, 'rien de relancé le même jour');
    });
    await t('échec : alerte ACTIVE avec sa date de début ; un second échec garde la date ; le succès la lève', async () => {
        const E = collection();
        const echec = async () => ({ code: 1, dureeS: 3, extrait: '🔴 fichier tronqué' });
        await IQ.importsQuotidiens({ E, lancerScript: echec, maintenant: () => a('2026-10-07T05:03:00Z'), journal: muet });
        let al = await E.findOne({ _id: 'alerte/import-guide' });
        assert.equal(al.active, true); assert.equal(+al.depuis, +a('2026-10-07T05:03:00Z')); assert.match(al.extrait, /tronqué/);
        await IQ.importsQuotidiens({ E, lancerScript: echec, maintenant: () => a('2026-10-07T06:10:00Z'), journal: muet });
        al = await E.findOne({ _id: 'alerte/import-guide' });
        assert.equal(+al.depuis, +a('2026-10-07T05:03:00Z'), 'la date de début est celle de la panne, pas du dernier constat'); assert.equal(al.essais, 2);
        await IQ.importsQuotidiens({ E, lancerScript: async () => ({ code: 0, dureeS: 9, extrait: 'ok' }), maintenant: () => a('2026-10-07T07:20:00Z'), journal: muet });
        al = await E.findOne({ _id: 'alerte/import-guide' });
        assert.equal(al.active, false); assert.ok(al.resolueLe);
    });
    await t('un lanceur qui LÈVE : l\'essai est compté (posé avant le lancement), l\'alerte écrite, l\'autre import passe quand même', async () => {
        const E = collection(), lances = [];
        const lancer = async (script) => { lances.push(script); if (script.includes('catalogue')) throw new Error('spawn ENOENT'); return { code: 0, dureeS: 1, extrait: 'ok' }; };
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T12:20:00Z'), journal: muet });
        assert.deepEqual(lances, ['import-catalogue-quotidien.js', 'import-guide-quotidien.js']);
        const c = await E.findOne({ _id: 'import-quotidien/catalogue' });
        assert.equal(c.essais, 1); assert.equal(c.enCours, false); assert.notEqual(c.succesLe, '2026-10-07');
        assert.equal((await E.findOne({ _id: 'alerte/import-catalogue' })).active, true);
        assert.equal((await E.findOne({ _id: 'import-quotidien/guide' })).succesLe, '2026-10-07');
    });
    await t('« rien de neuf » (code 0) : pas de succesLe, pas d\'échec, pas d\'alerte, et PLUS AUCUN passage ce jour-là ; le lendemain importe', async () => {
        const E = collection(); const lances = [];
        const lancer = async (s) => { lances.push(s); return lances.filter(x => x === s).length === 1 ? { code: 0, dureeS: 2, extrait: 'ℹ️ rien de neuf : 304, le fichier n\'a pas changé — aucun téléchargement' } : { code: 0, dureeS: 40, extrait: '✅ 12 nouveaux insérés' }; };
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T12:20:00Z'), journal: muet });
        let c = await E.findOne({ _id: 'import-quotidien/catalogue' });
        assert.notEqual(c.succesLe, '2026-10-07'); assert.equal(c.echecs, 0); assert.equal(c.dernierResultat, 'rien-de-neuf');
        assert.equal(await E.findOne({ _id: 'alerte/import-catalogue' }), null);
        const avant = lances.length;
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T18:00:00Z'), journal: muet });
        assert.equal(lances.length, avant, 'aucun passage de plus le même jour');
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-08T12:20:00Z'), journal: muet });
        c = await E.findOne({ _id: 'import-quotidien/catalogue' });
        assert.equal(c.succesLe, '2026-10-08'); assert.equal(c.dernierResultat, 'importe');
    });
    await t('le journal garde les 30 dernières lignes', async () => {
        const E = collection();
        for (let i = 0; i < 35; i++) await IQ.importsQuotidiens({ E, lancerScript: async () => ({ code: 0, dureeS: 1, extrait: `j${i}` }), maintenant: () => new Date(Date.UTC(2026, 9, 7 + i, 13)), journal: muet });
        const c = await E.findOne({ _id: 'import-quotidien/catalogue' });
        assert.equal(c.journal.length, 30); assert.equal(c.journal[29].extrait, 'j34');
    });

    // ── 3. le lanceur RÉEL : un processus enfant, asynchrone (la balise du worker continue de battre), code de sortie et délai ──────
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-'));
    fs.writeFileSync(path.join(dir, 'sort3.js'), 'console.log("ligne 1"); console.error("panne"); process.exit(3);');
    fs.writeFileSync(path.join(dir, 'dort.js'), 'setTimeout(() => {}, 60000);');
    await t('processus enfant : code de sortie et fin de sortie rapportés, la boucle d\'événements n\'est pas bloquée', async () => {
        let tics = 0; const iv = setInterval(() => tics++, 20);
        const r = await IQ.lancerEnfant('sort3.js', ['--x'], { racine: dir });
        clearInterval(iv);
        assert.equal(r.code, 3); assert.match(r.extrait, /ligne 1/); assert.match(r.extrait, /panne/);
        assert.ok(tics >= 1, 'le lancement est asynchrone');
    });
    await t('processus enfant au-delà du délai : tué, rapporté comme un échec', async () => {
        const r = await IQ.lancerEnfant('dort.js', [], { racine: dir, delaiMs: 500 });
        assert.notEqual(r.code, 0); assert.match(r.extrait, /délai/);
    });
    fs.rmSync(dir, { recursive: true, force: true });

    console.log(`\n${ko ? `🔴 ${ko} échec(s)` : '✅ tout passe'} sur ${ok + ko} vérifications`);
    process.exit(ko ? 1 : 0);
})();
