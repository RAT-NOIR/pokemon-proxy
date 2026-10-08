'use strict';
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const C = require('../annonce/conservation');
(async () => {
    await H.ouvrirBac('test-annonce-purge.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' }), t0 = new Date('2026-07-01T00:00:00Z');
    await C.conserverAnnonce('s1', { titre: 'Pikachu', description: 'neuve', expurgeeParServeur: false }, cfg, t0);
    const d = await db.col('annonces').findOne({ _id: 's1' });
    H.v('expireLe = création + 90 jours exactement', (d.expireLe - t0) / 86400e3, 90);
    H.v('rien d\'autre que titre/description/drapeau/dates n\'est stocké (pas d\'IP, d\'URL, d\'userId)', Object.keys(d).sort(), ['_id', 'creeLe', 'description', 'expireLe', 'expurgeeParServeur', 'titre']);
    // un champ étranger fourni par l'appelant (IP, userId) ne doit JAMAIS être stocké
    await C.conserverAnnonce('s0', { titre: 'T', description: 'd', expurgeeParServeur: false, ip: '1.2.3.4', userId: 'u', url: 'https://x' }, cfg, t0);
    H.v('champs étrangers ignorés', Object.keys(await db.col('annonces').findOne({ _id: 's0' })).sort(), ['_id', 'creeLe', 'description', 'expireLe', 'expurgeeParServeur', 'titre']);
    await db.col('annonces').deleteOne({ _id: 's0' });
    await C.conserverAnnonce('s2', { titre: 'B', description: 'b', expurgeeParServeur: true }, cfg, new Date('2026-07-31T00:00:00Z'));
    await C.conserverAnnonce('s3', { titre: 'C', description: 'c', expurgeeParServeur: false }, cfg, new Date('2026-09-01T00:00:00Z'));
    // « maintenant » : 2026-09-29 12:00 => s1 (échu le 29/09 à 00:00) est échu, s2 (échu le 29/10) et s3 non
    const r = await C.purgerAnnonces(new Date('2026-09-29T12:00:00Z'));
    H.v('la purge supprime exactement les lignes échues', [r.supprimees, (await db.col('annonces').find().toArray()).map(x => x._id).sort()], [1, ['s2', 's3']]);
    // frontière RÉELLE : 'sb' créée le 02/07 00:00 expire le 30/09 00:00 ; à 89 j + 23 h elle doit SURVIVRE, à l'instant exact elle part ($lte)
    await C.conserverAnnonce('sb', { titre: 'B', description: 'b', expurgeeParServeur: false }, cfg, new Date('2026-07-02T00:00:00Z'));
    H.v('à 89 jours + 23 h : rien d\'échu ET la ligne vit encore', [(await C.purgerAnnonces(new Date('2026-09-29T23:00:00Z'))).supprimees, await db.col('annonces').countDocuments({ _id: 'sb' })], [0, 1]);
    H.v('à l\'instant exact d\'expiration : la ligne part', [(await C.purgerAnnonces(new Date('2026-09-30T00:00:00Z'))).supprimees, await db.col('annonces').countDocuments({ _id: 'sb' })], [1, 0]);
    const r2 = await C.purgerAnnonces(new Date('2027-06-01T00:00:00Z')); H.v('plus tard, tout est parti', [r2.supprimees, await db.col('annonces').countDocuments()], [2, 0]);
    // l'interrupteur de conservation : éteint => RIEN n'est écrit
    await C.conserverAnnonce('s4', { titre: 'D', description: 'd' }, lireConfig({ MONGODB_BASE: 'test_scratch', V2_DESCRIPTION_CONSERVEE: '0' }), t0);
    H.v('V2_DESCRIPTION_CONSERVEE=0 : rien n\'est écrit', await db.col('annonces').countDocuments(), 0);
    // l'index TTL existe en filet de sécurité
    H.vrai('index TTL sur annonces.expireLe', (await db.col('annonces').indexes()).some(i => i.key.expireLe === 1 && i.expireAfterSeconds === 0));
    // une écriture qui échoue ne doit jamais faire échouer l'analyse
    let leve = false; try { await C.conserverAnnonce('s1', { titre: 'x' }, cfg, t0); await C.conserverAnnonce('s1', { titre: 'x' }, cfg, t0); } catch { leve = true; }
    H.v('conserver deux fois le même scan ne lève pas (23000/11000 avalé et journalisé)', leve, false);
    H.v('…et la première écriture est conservée (une seule ligne s1)', await db.col('annonces').countDocuments({ _id: 's1' }), 1);
    // refus : scanId invalide ou annonce absente => rien d'écrit, rien ne lève
    const avant = await db.col('annonces').countDocuments();
    let leve2 = false; try { await C.conserverAnnonce('', { titre: 'x' }, cfg, t0); await C.conserverAnnonce('s9', null, cfg, t0); await C.conserverAnnonce('s9', 'texte', cfg, t0); } catch { leve2 = true; }
    H.v('scanId vide / annonce non objet : rien d\'écrit, ne lève pas', [leve2, await db.col('annonces').countDocuments()], [false, avant]);
    // demarrerPurge : un timer unref, qui lance une passe au démarrage
    const arret = C.demarrerPurge();
    H.vrai('demarrerPurge rend un timer unref (ne retient pas le processus)', arret && typeof arret.hasRef === 'function' && arret.hasRef() === false);
    clearInterval(arret);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
