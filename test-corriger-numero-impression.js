// Banc de corriger-numero-impression.js : doubles en mémoire seulement, aucune connexion, aucun chemin du poste.
const C = require('./corriger-numero-impression');
let ok = 0, ko = 0;
const file = [];
const t = (nom, f) => file.push([nom, f]);
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const PREUVE = { motif: 'le numéro 055 est celui du Fossile non identifié, la carte est le 056', sources: [{ nom: 'Serebii', url: 'https://serebii.net/card/ultrasun' }, { nom: 'Pokewiki', url: 'https://pokewiki.de/Ultra_Sun_(TCG)' }] };
const imp = (o = {}) => ({ tirage: 'jp', expansion: 'Ultra Sun', numero: '055', total: '066', ...o });
const carte = (o = {}) => ({ _id: 217135, nomEn: 'Nest Ball', impressions: [imp(), imp({ tirage: 'intl', expansion: 'Ultra Sun', numero: '119' })], ...o });
const A = (o = {}) => ({ carte: 217135, expansion: 'Ultra Sun', tirage: 'jp', avant: '055', apres: '056', attendu: 1, ...o });
const plan = (a = {}, c = carte(), p = PREUVE) => C.planifier(A(a), { carteDoc: c }, p);
const refus = (r, motif) => { if (r.ok) throw new Error('devait refuser'); if (!r.refus.some(x => x.includes(motif))) throw new Error(`motif absent « ${motif} » dans ${JSON.stringify(r.refus)}`); if (r.operations.length) throw new Error('des opérations malgré le refus'); };

t('nominal : un updateOne ciblé, numeroAvant, date et motif sauvegardés', () => {
    const r = plan(); eq(r.ok, true); eq(r.ecritures, 1);
    const o = r.operations[0];
    eq(o.filter, { _id: 217135, impressions: { $elemMatch: { tirage: 'jp', expansion: 'Ultra Sun', numero: '055' } } });
    eq(Object.keys(o.update), ['$set']);
    eq(Object.keys(o.update.$set).sort(), ['impressions.$.numero', 'impressions.$.numeroAvant', 'impressions.$.numeroCorrigeLe', 'impressions.$.numeroCorrigeMotif']);
    eq(o.update.$set['impressions.$.numero'], '056'); eq(o.update.$set['impressions.$.numeroAvant'], '055'); eq(o.update.$set['impressions.$.numeroCorrigeMotif'], PREUVE.motif);
    if (!(o.update.$set['impressions.$.numeroCorrigeLe'] instanceof Date)) throw new Error('date absente');
});
t('nominal : le total et les autres impressions ne sont pas nommés', () => { const s = JSON.stringify(plan().operations[0]); if (/total|intl/.test(s)) throw new Error(s); });
t('nominal : même numéro dans un AUTRE tirage de la même expansion n\'empêche pas', () => eq(plan({}, carte({ impressions: [imp(), imp({ tirage: 'intl', numero: '056' })] })).ok, true));
t('nominal : même numéro dans une AUTRE expansion n\'empêche pas', () => eq(plan({}, carte({ impressions: [imp(), imp({ expansion: 'Autre', numero: '056' })] })).ok, true));
t('refus : carte absente', () => refus(C.planifier(A(), { carteDoc: null }, PREUVE), 'carte'));
t('refus : aucune impression à ce tirage et cette expansion', () => refus(plan({ tirage: 'th' }), 'aucune impression'));
t('refus : avant ne concorde pas', () => refus(plan({ avant: '054' }), 'avant'));
t('refus : avant comparé tel quel (55 n\'est pas 055)', () => refus(plan({ avant: '55' }), 'avant'));
t('refus : impression non unique (deux 055 au même set)', () => refus(plan({}, carte({ impressions: [imp(), imp()] })), 'unique'));
t('refus : apres déjà pris par une autre impression du set', () => refus(plan({}, carte({ impressions: [imp(), imp({ numero: '056' })] })), 'déjà pris'));
t('refus : apres déjà pris sous une autre écriture (56 = 056)', () => refus(plan({}, carte({ impressions: [imp(), imp({ numero: '56' })] })), 'déjà pris'));
t('refus : apres identique à avant', () => refus(plan({ apres: '055' }), 'identique'));
t('refus : apres vide', () => refus(plan({ apres: '' }), 'apres'));
t('refus : impression déjà corrigée (numeroAvant présent)', () => refus(plan({}, carte({ impressions: [imp({ numeroAvant: '054' })] })), 'déjà corrigée'));
t('refus : preuve absente', () => refus(plan({}, carte(), null), 'preuve'));
t('refus : une seule source', () => refus(plan({}, carte(), { ...PREUVE, sources: [PREUVE.sources[0]] }), 'deux sources'));
t('refus : deux fois la même source', () => refus(plan({}, carte(), { ...PREUVE, sources: [PREUVE.sources[0], { nom: 'Copie', url: 'https://serebii.net/card/ultrasun' }] }), 'deux sources'));
t('refus : même hôte, deux pages = une seule source', () => refus(plan({}, carte(), { ...PREUVE, sources: [PREUVE.sources[0], { nom: 'autre page', url: 'https://serebii.net/card/ultrasun/56' }] }), 'deux sources'));
t('refus : source sans url', () => refus(plan({}, carte(), { ...PREUVE, sources: [PREUVE.sources[0], { nom: 'x' }] }), 'deux sources'));
t('refus : source non https', () => refus(plan({}, carte(), { ...PREUVE, sources: [PREUVE.sources[0], { nom: 'x', url: 'ftp://a.b/c' }] }), 'deux sources'));
t('refus : motif absent', () => refus(plan({}, carte(), { ...PREUVE, motif: '' }), 'motif'));
t('refus : attendu différent', () => refus(plan({ attendu: 2 }), 'attendu'));
t('refus : attendu absent', () => refus(plan({ attendu: undefined }), 'attendu'));

t('arguments : cas nominal', () => { const r = C.lireArguments(['--carte=217135', '--expansion=Ultra Sun', '--tirage=jp', '--avant=055', '--apres=056', '--preuve=p.json', '--attendu=1']); eq([r.erreur, r.carte, r.expansion, r.tirage, r.avant, r.apres, r.preuve, r.attendu, r.ecrire], [undefined, 217135, 'Ultra Sun', 'jp', '055', '056', 'p.json', 1, false]); });
for (const m of ['carte', 'expansion', 'tirage', 'avant', 'apres', 'preuve', 'attendu']) t(`arguments : --${m} obligatoire`, () => {
    const base = ['--carte=1', '--expansion=E', '--tirage=jp', '--avant=1', '--apres=2', '--preuve=p.json', '--attendu=1'];
    if (!C.lireArguments(base.filter(x => !x.startsWith(`--${m}=`))).erreur) throw new Error('accepté');
});
t('arguments : inconnu refusé', () => { if (!C.lireArguments(['--carte=1', '--expansion=E', '--tirage=jp', '--avant=1', '--apres=2', '--preuve=p.json', '--attendu=1', '--force']).erreur) throw new Error('accepté'); });
t('arguments : répété refusé', () => { if (!C.lireArguments(['--carte=1', '--carte=2', '--expansion=E', '--tirage=jp', '--avant=1', '--apres=2', '--preuve=p.json', '--attendu=1']).erreur) throw new Error('accepté'); });
t('arguments : carte non entière', () => { if (!C.lireArguments(['--carte=x', '--expansion=E', '--tirage=jp', '--avant=1', '--apres=2', '--preuve=p.json', '--attendu=1']).erreur) throw new Error('accepté'); });
t('arguments : --ecrire', () => eq(C.lireArguments(['--carte=1', '--expansion=E', '--tirage=jp', '--avant=1', '--apres=2', '--preuve=p.json', '--attendu=1', '--ecrire']).ecrire, true));

t('hors lot refusé', () => { let m = ''; try { C.garderSousLot({}, 123); } catch (e) { m = e.message; } if (!/hors de lot-additif/.test(m)) throw new Error('non refusé'); });
t('hors lot : mauvais ppid refusé', () => { let m = ''; try { C.garderSousLot({ LOT_ADDITIF_PID: '5' }, 6); } catch (e) { m = e.message; } if (!m) throw new Error('non refusé'); });
t('sous lot accepté', () => { C.garderSousLot({ LOT_ADDITIF_PID: '5' }, 5); });

t('relecture concordante / discordante', () => {
    const corrigee = carte({ impressions: [imp({ numero: '056', numeroAvant: '055' })] });
    eq(C.releve({ carteDoc: corrigee }, A()).ok, true);
    eq(C.releve({ carteDoc: carte() }, A()).ok, false);
    eq(C.releve({ carteDoc: carte({ impressions: [imp({ numero: '056' })] }) }, A()).ok, false);
    eq(C.releve({ carteDoc: null }, A()).ok, false);
});

function fauxDb({ modifie = 1 } = {}) {
    const etat = { carte: carte(), ops: [] };
    const col = { cartes: {
        findOne: async f => (f._id === etat.carte._id ? etat.carte : null),
        updateOne: async (f, u) => {
            etat.ops.push([f, u]); if (!modifie) return { modifiedCount: 0 };
            const i = etat.carte.impressions.find(x => x.tirage === f.impressions.$elemMatch.tirage && x.expansion === f.impressions.$elemMatch.expansion && x.numero === f.impressions.$elemMatch.numero);
            if (!i) return { modifiedCount: 0 };
            for (const [k, v] of Object.entries(u.$set)) i[k.replace('impressions.$.', '')] = v;
            return { modifiedCount: 1 };
        } } };
    return { collection: n => col[n], _etat: etat };
}
const AE = A({ ecrire: true });
t('chaîne : écriture, relecture, succès', async () => {
    const db = fauxDb(); const r = await C.executer(db, AE, PREUVE);
    eq([r.ok, r.code, r.modifiees], [true, 0, 1]);
    eq(db._etat.carte.impressions[0].numero, '056'); eq(db._etat.carte.impressions[0].numeroAvant, '055'); eq(db._etat.carte.impressions[0].total, '066');
    eq(db._etat.carte.impressions[1].numero, '119');
});
t('chaîne : simulation n\'écrit rien', async () => {
    const db = fauxDb(); const r = await C.executer(db, A(), PREUVE);
    eq([r.ok, r.code, r.modifiees], [true, 0, 0]); eq(db._etat.ops.length, 0);
});
t('chaîne : refus du plan, rien d\'écrit', async () => {
    const db = fauxDb(); const r = await C.executer(db, { ...AE, avant: '054' }, PREUVE);
    eq([r.ok, r.code], [false, 1]); eq(db._etat.ops.length, 0);
});
t('chaîne : écriture qui ne modifie rien -> arrêt', async () => {
    const db = fauxDb({ modifie: 0 }); const r = await C.executer(db, AE, PREUVE);
    eq([r.ok, r.code, r.modifiees], [false, 1, 0]);
});

(async () => {
    for (const [nom, f] of file) { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom} : ${e.message}`); } }
    console.log(`${ko ? 'ROUGE' : 'VERT'} : ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
