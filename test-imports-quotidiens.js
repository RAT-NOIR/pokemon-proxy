// BANC — collecte-cartes/imports-quotidiens.js : le worker lance lui-même, une fois par jour après 5 h UTC, l'import du catalogue et
// celui du guide des prix (ordre du testeur, 2026-10-06 : « sans cron Render payant […] avec une ligne au journal et une alerte en cas
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
    await t('avant 5 h UTC : rien', () => assert.equal(IQ.aLancer(null, a('2026-10-07T04:59:00Z')).lancer, false));
    await t('après 5 h UTC, jamais lancé : on lance', () => assert.equal(IQ.aLancer(null, a('2026-10-07T05:00:00Z')).lancer, true));
    await t('déjà réussi aujourd\'hui : rien', () => assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 1, succesLe: '2026-10-07', dernierEssai: a('2026-10-07T05:01:00Z') }, a('2026-10-07T12:00:00Z')).lancer, false));
    await t('réussi HIER : on relance aujourd\'hui', () => assert.equal(IQ.aLancer({ jour: '2026-10-06', essais: 1, succesLe: '2026-10-06', dernierEssai: a('2026-10-06T05:01:00Z') }, a('2026-10-07T05:30:00Z')).lancer, true));
    await t('échec il y a moins d\'une heure : on attend', () => assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 1, dernierEssai: a('2026-10-07T05:10:00Z') }, a('2026-10-07T05:50:00Z')).lancer, false));
    await t('échec il y a plus d\'une heure : on réessaie', () => assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 1, dernierEssai: a('2026-10-07T05:10:00Z') }, a('2026-10-07T06:20:00Z')).lancer, true));
    await t('trois essais en échec aujourd\'hui : plus rien jusqu\'à demain', () => {
        assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 3, dernierEssai: a('2026-10-07T07:10:00Z') }, a('2026-10-07T23:00:00Z')).lancer, false);
        assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 3, dernierEssai: a('2026-10-07T07:10:00Z') }, a('2026-10-08T05:05:00Z')).lancer, true);
    });
    // (relecture) « rien de neuf » n'est PAS la réussite du jour : le fichier Cardmarket du jour paraît vers 11 h 30 UTC (createdAt de
    // l'export du 06/10 : 13:31 +02:00) — à 5 h, le script dit « rien de neuf » ; on repasse deux heures plus tard, sans compter d'échec
    await t('« rien de neuf » il y a moins de deux heures : on attend ; plus de deux heures : on repasse', () => {
        const e = { jour: '2026-10-07', essais: 1, echecs: 0, dernierEssai: a('2026-10-07T05:01:00Z'), dernierResultat: 'rien-de-neuf' };
        assert.equal(IQ.aLancer(e, a('2026-10-07T06:30:00Z')).lancer, false);
        assert.equal(IQ.aLancer(e, a('2026-10-07T07:05:00Z')).lancer, true);
    });
    await t('des « rien de neuf » ne consomment pas les trois essais d\'échec ; douze passages au plus par jour', () => {
        assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 5, echecs: 0, dernierEssai: a('2026-10-07T13:00:00Z'), dernierResultat: 'rien-de-neuf' }, a('2026-10-07T15:30:00Z')).lancer, true);
        assert.equal(IQ.aLancer({ jour: '2026-10-07', essais: 12, echecs: 0, dernierEssai: a('2026-10-07T20:00:00Z'), dernierResultat: 'rien-de-neuf' }, a('2026-10-07T23:00:00Z')).lancer, false);
    });
    await t('aFaire : vrai seulement quand un import doit tourner (le worker ne rend son verrou que dans ce cas)', async () => {
        const E = collection();
        assert.equal(await IQ.aFaire({ E, maintenant: () => a('2026-10-07T04:00:00Z') }), false);
        assert.equal(await IQ.aFaire({ E, maintenant: () => a('2026-10-07T05:10:00Z') }), true);
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
        assert.deepEqual(lances, ['import-catalogue-quotidien.js', 'import-guide-quotidien.js']);
        const c = await E.findOne({ _id: 'import-quotidien/catalogue' });
        assert.equal(c.succesLe, '2026-10-07'); assert.equal(c.essais, 1); assert.equal(c.journal.length, 1); assert.equal(c.journal[0].code, 0);
        assert.equal(await E.findOne({ _id: 'alerte/import-catalogue', active: true }), null);
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T09:00:00Z'), journal: muet });
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
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T05:03:00Z'), journal: muet });
        assert.deepEqual(lances, ['import-catalogue-quotidien.js', 'import-guide-quotidien.js']);
        const c = await E.findOne({ _id: 'import-quotidien/catalogue' });
        assert.equal(c.essais, 1); assert.equal(c.enCours, false); assert.notEqual(c.succesLe, '2026-10-07');
        assert.equal((await E.findOne({ _id: 'alerte/import-catalogue' })).active, true);
        assert.equal((await E.findOne({ _id: 'import-quotidien/guide' })).succesLe, '2026-10-07');
    });
    await t('« rien de neuf » (code 0) : pas de succesLe, pas d\'échec compté, pas d\'alerte ; le passage suivant importe et clôt le jour', async () => {
        const E = collection(); let n = 0;
        const lancer = async () => (++n === 1 ? { code: 0, dureeS: 2, extrait: 'ℹ️ rien de neuf : le fichier est du 2026-10-06T11:31:01.000Z' } : { code: 0, dureeS: 40, extrait: '✅ 12 nouveaux insérés' });
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T05:03:00Z'), journal: muet });
        let c = await E.findOne({ _id: 'import-quotidien/catalogue' });
        assert.notEqual(c.succesLe, '2026-10-07'); assert.equal(c.echecs, 0); assert.equal(c.dernierResultat, 'rien-de-neuf');
        assert.equal(await E.findOne({ _id: 'alerte/import-catalogue' }), null);
        await IQ.importsQuotidiens({ E, lancerScript: lancer, maintenant: () => a('2026-10-07T12:00:00Z'), journal: muet });
        c = await E.findOne({ _id: 'import-quotidien/catalogue' });
        assert.equal(c.succesLe, '2026-10-07'); assert.equal(c.dernierResultat, 'importe');
    });
    await t('le journal garde les 30 dernières lignes', async () => {
        const E = collection();
        for (let i = 0; i < 35; i++) await IQ.importsQuotidiens({ E, lancerScript: async () => ({ code: 0, dureeS: 1, extrait: `j${i}` }), maintenant: () => new Date(Date.UTC(2026, 9, 7 + i, 6)), journal: muet });
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
