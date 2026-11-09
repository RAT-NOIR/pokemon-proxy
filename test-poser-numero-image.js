// Banc de poser-numero-image.js : doubles en mémoire seulement, aucune connexion, aucun chemin du poste.
const P = require('./poser-numero-image');
let ok = 0, ko = 0;
const file = [];
const t = (nom, f) => file.push([nom, f]);   // exécutés à la fin, en séquence (synchrones ou asynchrones)
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

const CLE = 'prv/Scarlet-Violet-Promos/sn-306527-ja.webp';
const doc = (o = {}) => ({ _id: 'd1', cleR2: CLE, etat: 'ok', numero: null, set: 'Scarlet-Violet-Promos', preuveLue: { lu: { numero: '148', total: 'SV-P' } }, ...o });
const carte = (o = {}) => ({ _id: 77, nomEn: 'X', images: [{ set: 'Scarlet-Violet-Promos', cleR2: CLE, numero: null }], impressions: [{ tirage: 'jp', expansion: 'SV Promos', numero: '148' }, { tirage: 'intl', expansion: 'SV Promos', numero: '12' }], ...o });
const set = { _id: 'Scarlet-Violet-Promos', region: 'jp', bulba: { expansion: 'SV Promos' } };
const monde = (o = {}) => ({ docs: [doc()], cartes: [carte()], set, ...o });
// doubles des règles du site (lib/impressionDuSet.ts, lib/entreesDuSet.ts) : le banc n'importe rien, la vraie injection se fait dans la CLI
const REGLES = {
    tirageDuSet: s => s.tirage ?? s.region,
    expansionsDuSet: s => { const e = s.bulba?.expansion; return typeof e === 'string' ? [e] : (Array.isArray(e) ? e : []); },
    impressionDuSet: (imp, c) => imp.tirage === c.tirage && c.expansions.includes(imp.expansion),
};
const plan = (args = {}, m = monde(), regles = REGLES) => P.planifier({ cle: CLE, numero: '148', ...args }, m, regles);
const refus = (r, motif) => { if (r.ok) throw new Error('devait refuser'); if (!r.refus.some(x => x.includes(motif))) throw new Error(`motif absent « ${motif} » dans ${JSON.stringify(r.refus)}`); if (r.operations.length) throw new Error('des opérations malgré le refus'); };

t('nominal : deux opérations, rien d\'autre', () => {
    const r = plan({ attendu: 2 });
    eq(r.ok, true); eq(r.operations.length, 2); eq(r.ecritures, 2);
    const [a, b] = r.operations;
    eq(a.coll, 'images'); eq(b.coll, 'cartes');
    eq(a.filter, { _id: 'd1', cleR2: CLE, etat: 'ok', numero: null });
    eq(Object.keys(a.update), ['$set']);
    eq(Object.keys(a.update.$set).sort(), ['numero', 'numeroPoseLe', 'numeroPosePreuve']);
    eq(a.update.$set.numero, '148'); eq(a.update.$set.numeroPosePreuve, { numero: '148', total: 'SV-P' });
    eq(b.filter, { _id: 77, images: { $elemMatch: { cleR2: CLE, numero: null } } });
    eq(Object.keys(b.update.$set).sort(), ['images.$.numero', 'images.$.numeroPoseLe', 'images.$.numeroPosePreuve']);
    eq(b.update.$set['images.$.numero'], '148');
});
t('simulation sans attendu : planifie sans exiger', () => eq(plan().ok, true));
t('cle de numero : 148 = 0148 côté impression', () => eq(plan({}, monde({ cartes: [carte({ impressions: [{ tirage: 'jp', expansion: 'SV Promos', numero: '0148' }] })] })).ok, true));
t('refus : document absent', () => refus(plan({}, monde({ docs: [] })), 'document'));
t('refus : documents non uniques', () => refus(plan({}, monde({ docs: [doc(), doc({ _id: 'd2' })] })), 'document'));
t('refus : etat pas ok', () => refus(plan({}, monde({ docs: [doc({ etat: 'retire' })] })), 'etat'));
t('refus : numero déjà posé sur le document', () => refus(plan({}, monde({ docs: [doc({ numero: '5' })] })), 'numero'));
t('refus : preuve sans numero lu', () => refus(plan({}, monde({ docs: [doc({ preuveLue: { lu: {} } })] })), 'preuveLue'));
t('refus : preuveLue absente', () => refus(plan({}, monde({ docs: [doc({ preuveLue: undefined })] })), 'preuveLue'));
t('refus : numero lu différent (comparé tel quel)', () => refus(plan({ numero: '149' }), 'différent'));
t('refus : 0148 n\'est pas 148 tel quel', () => refus(plan({ numero: '0148' }), 'différent'));
t('refus : aucune carte', () => refus(plan({}, monde({ cartes: [] })), 'carte'));
t('refus : deux cartes', () => refus(plan({}, monde({ cartes: [carte(), carte({ _id: 78 })] })), 'carte'));
t('refus : deux entrées à la clé', () => refus(plan({}, monde({ cartes: [carte({ images: [{ set: 's', cleR2: CLE, numero: null }, { set: 's', cleR2: CLE, numero: null }] })] })), 'entrée'));
t('refus : entrée déjà numérotée', () => refus(plan({}, monde({ cartes: [carte({ images: [{ set: 's', cleR2: CLE, numero: '148' }] })] })), 'entrée'));
t('refus : impression au bon numéro mais autre tirage', () => refus(plan({}, monde({ cartes: [carte({ impressions: [{ tirage: 'intl', expansion: 'SV Promos', numero: '148' }] })] })), 'impression'));
t('refus : impression au tirage mais autre numéro', () => refus(plan({}, monde({ cartes: [carte({ impressions: [{ tirage: 'jp', expansion: 'SV Promos', numero: '149' }] })] })), 'impression'));
t('refus : même tirage, même numéro, AUTRE expansion', () => refus(plan({}, monde({ cartes: [carte({ impressions: [{ tirage: 'jp', expansion: 'Autre Set', numero: '148' }] })] })), 'impression'));
t('refus : règle du site non injectée (jamais de repli)', () => { let m = ''; try { P.planifier({ cle: CLE, numero: '148' }, monde(), {}); } catch (e) { m = e.message; } if (!/règle/.test(m)) throw new Error('non refusé'); });
t('refus : set inconnu', () => refus(plan({}, monde({ set: null })), 'set'));
t('tirage du set : tirage prime sur region', () => eq(plan({}, monde({ set: { _id: 's', region: 'intl', tirage: 'jp', bulba: { expansion: 'SV Promos' } } })).ok, true));
t('refus : attendu différent', () => refus(plan({ attendu: 1 }), 'attendu'));
t('refus : attendu absent en écriture', () => refus(plan({ attendu: undefined, ecrire: true }), 'attendu'));

t('arguments : simulation', () => eq(P.lireArguments(['--cle=a', '--numero=148']).erreur, undefined));
t('arguments : inconnu refusé', () => { const r = P.lireArguments(['--cle=a', '--numero=1', '--force']); if (!r.erreur) throw new Error('accepté'); });
t('arguments : deux clés refusées', () => { if (!P.lireArguments(['--cle=a', '--cle=b', '--numero=1']).erreur) throw new Error('accepté'); });
t('arguments : liste de clés refusée', () => { if (!P.lireArguments(['--cle=a,b', '--numero=1']).erreur) throw new Error('accepté'); });
t('arguments : numero manquant', () => { if (!P.lireArguments(['--cle=a']).erreur) throw new Error('accepté'); });
t('arguments : attendu non entier', () => { if (!P.lireArguments(['--cle=a', '--numero=1', '--attendu=x']).erreur) throw new Error('accepté'); });
t('arguments : --ecrire sans --attendu', () => { if (!P.lireArguments(['--cle=a', '--numero=1', '--ecrire']).erreur) throw new Error('accepté'); });
t('arguments : écriture complète', () => { const r = P.lireArguments(['--cle=a', '--numero=1', '--ecrire', '--attendu=1']); eq([r.erreur, r.ecrire, r.attendu, r.cle, r.numero], [undefined, true, 1, 'a', '1']); });

t('hors lot refusé', () => { let m = ''; try { P.garderSousLot({}, 123); } catch (e) { m = e.message; } if (!/hors de lot-additif/.test(m)) throw new Error('non refusé'); });
t('hors lot : mauvais ppid refusé', () => { let m = ''; try { P.garderSousLot({ LOT_ADDITIF_PID: '5' }, 6); } catch (e) { m = e.message; } if (!m) throw new Error('non refusé'); });
t('sous lot accepté', () => { P.garderSousLot({ LOT_ADDITIF_PID: '5' }, 5); });

// faux cx en mémoire : find/findOne/updateOne, avec un plafond optionnel d'écritures qui réussissent (modifiedCount 0 ensuite)
function fauxDb({ reussites = Infinity } = {}) {
    const imgs = [doc()], cartes = [carte()], sets = [set]; let n = 0;
    const col = {
        images: { find: () => ({ toArray: async () => imgs.filter(d => d.cleR2 === CLE) }), updateOne: async (f, u) => { if (n++ >= reussites) return { modifiedCount: 0 }; const d = imgs.find(x => x._id === f._id && x.cleR2 === f.cleR2 && x.etat === f.etat && x.numero === f.numero); if (!d) return { modifiedCount: 0 }; Object.assign(d, u.$set); return { modifiedCount: 1 }; } },
        cartes: { find: () => ({ toArray: async () => cartes.filter(c => c.images.some(i => i.cleR2 === CLE)) }), updateOne: async (f, u) => { if (n++ >= reussites) return { modifiedCount: 0 }; const c = cartes.find(x => x._id === f._id); const e = c && c.images.find(i => i.cleR2 === CLE && i.numero === null); if (!e) return { modifiedCount: 0 }; for (const [k, v] of Object.entries(u.$set)) e[k.replace('images.$.', '')] = v; return { modifiedCount: 1 }; } },
        sets: { findOne: async f => sets.find(s => s._id === f._id) ?? null },
    };
    return { collection: nom => col[nom], _etat: { imgs, cartes } };
}
t('relecture concordante', () => {
    eq(P.releve({ docs: [doc({ numero: '148' })], cartes: [carte({ images: [{ cleR2: CLE, numero: '148' }] })] }, { cle: CLE, numero: '148' }).ok, true);
});
t('relecture discordante', () => {
    eq(P.releve({ docs: [doc({ numero: '148' })], cartes: [carte()] }, { cle: CLE, numero: '148' }).ok, false);
    eq(P.releve({ docs: [doc()], cartes: [carte({ images: [{ cleR2: CLE, numero: '148' }] })] }, { cle: CLE, numero: '148' }).ok, false);
    eq(P.releve({ docs: [], cartes: [] }, { cle: CLE, numero: '148' }).ok, false);
});
const A = { cle: CLE, numero: '148', ecrire: true, attendu: 2 };
t('chaîne réelle lire -> planifier -> écrire -> relire : succès', async () => {
    const db = fauxDb();
    const r = await P.executer(db, A, REGLES);
    eq([r.ok, r.code, r.modifiees], [true, 0, 2]);
    eq(db._etat.imgs[0].numero, '148'); eq(db._etat.cartes[0].images[0].numero, '148');
});
t('chaîne réelle : lireMonde rend la forme que releve consomme', async () => {
    const db = fauxDb(); await P.executer(db, A, REGLES);
    eq(P.releve(await P.lireMonde(db, CLE), A).ok, true);
});
t('écriture partielle : la première ne modifie rien -> arrêt, rien d\'écrit', async () => {
    const db = fauxDb({ reussites: 0 });
    const r = await P.executer(db, A, REGLES);
    eq([r.ok, r.code, r.modifiees], [false, 1, 0]);
    if (!/Aucune écriture faite/.test(r.message)) throw new Error(r.message);
    eq(db._etat.imgs[0].numero, null);
});
t('écriture partielle : la seconde ne modifie rien -> arrêt, message dit écrit/non écrit', async () => {
    const db = fauxDb({ reussites: 1 });
    const r = await P.executer(db, A, REGLES);
    eq([r.ok, r.code, r.modifiees], [false, 1, 1]);
    if (!/images.*écrit/.test(r.message) || !/cartes.*NON écrit/.test(r.message)) throw new Error(r.message);
    eq(db._etat.imgs[0].numero, '148'); eq(db._etat.cartes[0].images[0].numero, null);
});
t('simulation : n\'écrit rien', async () => {
    const db = fauxDb(); const r = await P.executer(db, { cle: CLE, numero: '148', ecrire: false }, REGLES);
    eq([r.ok, r.code, r.modifiees], [true, 0, 0]); eq(db._etat.imgs[0].numero, null);
});
t('refus du plan : code 1, rien d\'écrit', async () => {
    const db = fauxDb(); const r = await P.executer(db, { ...A, numero: '149' }, REGLES);
    eq([r.ok, r.code], [false, 1]); eq(db._etat.imgs[0].numero, null);
});

(async () => {
    for (const [nom, f] of file) { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom} : ${e.message}`); } }
    console.log(`${ko ? 'ROUGE' : 'VERT'} : ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
