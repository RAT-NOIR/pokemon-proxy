'use strict';
const crypto = require('crypto'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const { EJSON } = require('mongodb').BSON;
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const F = require('../argent/fusion'); const He = require('../argent/heritage'); const Rej = require('../migrations/rejouer-migration-credits');
const { compte, inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
// emailCle FABRIQUÉ d'après la spécification (B2.1 produira le vrai : v2/comptes/email-cle.js) — injecté, jamais importé de B2
const emailCle = b => { if (typeof b !== 'string') return null; const s = b.trim().toLowerCase(); const i = s.indexOf('@'); if (i < 1 || s.indexOf('@', i + 1) !== -1) return null;
    let l = s.slice(0, i), d = s.slice(i + 1); if (d === 'googlemail.com') d = 'gmail.com'; if (d === 'gmail.com') l = l.replace(/\./g, '').split('+')[0]; return l && d.includes('.') ? `${l}@${d}` : null; };
const sha = u => crypto.createHash('sha256').update(String(u)).digest('hex');
const nMv = () => db.col('mouvements').countDocuments({});
const wallet = async (userId, o = {}) => { await db.col('credits').insertOne({ userId, soldeGratuit: 0, soldeScans: 0, email: null, ...o }); return userId; };
(async () => {
    const prefixe = await H.ouvrirBac('test-argent-fusion.js'); await M.creerIndex();
    // 1. fusion : 160 acquis sur l'installation + 10 sur le compte => 170 sur le compte, 0 sur l'installation ; essais à 0 ; l'accueil hérité n'est JAMAIS ajouté aux 25
    const pc = await compte({ solde: { accueil: 25, achete: 10 } }); const pi = await inst({ essais: 3, achete: 160 });
    const avant = (await lire(pc)).solde.achete + (await lire(pi)).achete;
    const f1 = await F.fusionnerALaLiaison({ compteId: pc.id, installationId: pi.id }, cfg);
    const apres = (await lire(pc)).solde.achete + (await lire(pi)).achete;
    H.v('fusion : compte 170, installation 0, essais 0', [(await lire(pc)).solde.achete, (await lire(pi)).achete, (await lire(pi)).essais, f1.ok], [170, 0, 0, true]);
    H.v(`   la SOMME des achetés avant = après (${avant} = ${apres})`, apres, avant);
    H.v('   l\'accueil du compte est resté à 25 (une seule dotation)', (await lire(pc)).solde.accueil, 25);
    H.v('   le journal : -160 installation, +160 compte, -3 essais', [
        (await db.col('mouvements').aggregate([{ $match: { installationId: pi.id, poche: 'achete' } }, { $group: { _id: null, s: { $sum: '$delta' } } }]).toArray())[0].s,
        (await db.col('mouvements').aggregate([{ $match: { compteId: pc.id, poche: 'achete' } }, { $group: { _id: null, s: { $sum: '$delta' } } }]).toArray())[0].s,
        (await db.col('mouvements').aggregate([{ $match: { installationId: pi.id, poche: 'essai' } }, { $group: { _id: null, s: { $sum: '$delta' } } }]).toArray())[0].s], [-160, 160, -3]);
    // 2. rejouée : rien ne bouge
    const m2 = await nMv(); const f2 = await F.fusionnerALaLiaison({ compteId: pc.id, installationId: pi.id }, cfg);
    H.v('fusion rejouée : rien ne bouge (ni solde ni mouvement)', [(await lire(pc)).solde.achete, await nMv(), f2.transfere], [170, m2, { achete: 0, essais: 0 }]);
    // 3. 20 liaisons simultanées de la même installation : ajoutées UNE fois
    const pc3 = await compte({ solde: { accueil: 25, achete: 5 } }); const pi3 = await inst({ essais: 3, achete: 50 });
    const r3 = await Promise.all(Array.from({ length: 20 }, () => F.fusionnerALaLiaison({ compteId: pc3.id, installationId: pi3.id }, cfg)));
    H.v('20 liaisons simultanées : achetés ajoutés une seule fois (5 + 50)', [(await lire(pc3)).solde.achete, (await lire(pi3)).achete], [55, 0]);
    H.v('   un seul transfert non nul parmi les 20 (dénominateur 20)', r3.filter(r => r.ok && r.transfere.achete === 50).length, 1);
    H.v('   installation inconnue : refusée, rien d\'écrit', [(await F.fusionnerALaLiaison({ compteId: pc3.id, installationId: 'ffffffffffffffffffffffffffffffff' }, cfg)).ok, (await lire(pc3)).solde.achete], [false, 55]);
    // 4. héritage 1.0.x
    await wallet('u17', { soldeGratuit: 17, soldeScans: 5 }); const i4 = await inst({ essais: 3 });
    const h4 = await He.reprendreHeritage({ userId: 'u17', installation: i4.installation }, cfg);
    const c4 = await db.col('credits').findOne({ userId: 'u17' }), ii4 = await lire(i4);
    H.v('héritage : gratuit 17 => essais 3 (plafonné à la dotation d\'essai, HERITAGE-GRATUIT), gratuit déplacé (0), migreVers posé, achetés intacts', [h4.ok, ii4.essais, c4.soldeGratuit, c4.migreVers === i4.id, c4.soldeScans], [true, 3, 0, true, 5]);
    H.v('   empreinte SHA-256 du userId sur l\'installation', ii4.heriteEmpreinte, sha('u17'));
    const i4b = await inst({ essais: 3 }); const h4b = await He.reprendreHeritage({ userId: 'u17', installation: i4b.installation }, cfg);
    H.v('   le même userId repris par une AUTRE installation : refusé, aucune seconde reprise', [h4b.ok, h4b.raison, (await lire(i4b)).essais, (await lire(i4)).essais], [false, 'deja-migre', 3, 3]);
    await wallet('uCourse', { soldeGratuit: 10 }); const ins = []; for (let k = 0; k < 10; k++) ins.push(await inst({ essais: 3 }));
    const rc = await Promise.all(ins.map(p => He.reprendreHeritage({ userId: 'uCourse', installation: p.installation }, cfg)));
    H.v('   10 installations simultanées pour un même userId : UNE seule reprise (dénominateur 10)', [rc.filter(r => r.ok).length, (await db.col('credits').findOne({ userId: 'uCourse' })).soldeGratuit], [1, 0]);
    H.v('   la gratuite n\'existe qu\'une fois : aucun essai ajouté (10 > 3 plafonné), les 10 installations restent à 3, un seul mouvement d\'héritage au plus', [(await Promise.all(ins.map(lire))).map(i => i.essais).filter(e => e === 3).length, await db.col('mouvements').countDocuments({ motif: 'heritage-1.0', cleIdempotence: `heritage|${sha('uCourse')}` })], [10, 0]);
    await wallet('u400', { soldeGratuit: 400 }); const i5 = await inst({ essais: 3 });
    const logs = []; const w = console.warn, l = console.log; console.warn = (...a) => logs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' '));
    const h5 = await He.reprendreHeritage({ userId: 'u400', installation: i5.installation }, cfg); console.warn = w; console.log = l;
    H.v('soldeGratuit 400 => essais 3 (plafond : la dotation d\'essai)', [h5.ok, (await lire(i5)).essais], [true, 3]);
    H.v('   l\'excédent (397) est dit au journal, le userId n\'y figure qu\'en empreinte', [logs.some(x => x.includes('397')), logs.some(x => x.includes('u400')), logs.some(x => x.includes(sha('u400').slice(0, 12)))], [true, false, true]);
    const i6 = await inst({ essais: 3 }); const h6 = await He.reprendreHeritage({ userId: 'inconnuDeCredits', installation: i6.installation }, cfg);
    H.v('userId absent de credits : aucun effet, essais inchangés', [h6.ok, h6.raison, (await lire(i6)).essais], [false, 'inconnu', 3]);
    await wallet('uB', { soldeGratuit: 4 });
    const h7 = await He.reprendreHeritage({ userId: 'uB', installation: i4.installation }, cfg);
    H.v('une installation qui a déjà hérité ne reprend pas un second userId', [h7.ok, h7.raison, (await db.col('credits').findOne({ userId: 'uB' })).soldeGratuit], [false, 'installation-deja-heritee', 4]);
    // 5. rattachement des achats par l'adresse Stripe
    await wallet('uS160', { soldeScans: 160, email: 'Acheteur.Un+stripe@Gmail.com' });
    const pv = await compte({ solde: { accueil: 25, achete: 0 }, email: 'acheteurun@gmail.com', emailCle: 'acheteurun@gmail.com' });
    const a1 = await He.rattacherAchats({ compteId: pv.id }, cfg, { emailCle });
    H.v('compte vérifié, même adresse (après emailCle) : 160 rattachés', [a1.ok, a1.total, (await lire(pv)).solde.achete, (await db.col('credits').findOne({ userId: 'uS160' })).soldeScans], [true, 160, 160, 0]);
    H.v('   achatsMigresVers posé, mouvement migration +160 à clé migration-stripe|<empreinte>', [String((await db.col('credits').findOne({ userId: 'uS160' })).achatsMigresVers) === String(pv.id),
        (await db.col('mouvements').findOne({ cleIdempotence: `migration-stripe|${sha('uS160')}` }))?.delta], [true, 160]);
    const a2 = await He.rattacherAchats({ compteId: pv.id }, cfg, { emailCle });
    H.v('   rejoué : rien (160 reste 160)', [a2.total, (await lire(pv)).solde.achete], [0, 160]);
    await wallet('uNV', { soldeScans: 30, email: 'nonverifie@exemple.fr' });
    const pnv = await compte({ verifie: false, email: 'nonverifie@exemple.fr', emailCle: 'nonverifie@exemple.fr' });
    H.v('compte NON vérifié : rien, le portefeuille ancien intact', [(await He.rattacherAchats({ compteId: pnv.id }, cfg, { emailCle })).total, (await db.col('credits').findOne({ userId: 'uNV' })).soldeScans, (await lire(pnv)).solde.achete], [0, 30, 0]);
    await wallet('uAutre', { soldeScans: 30, email: 'quelquun@exemple.fr' });
    const pau = await compte({ email: 'autre@exemple.fr', emailCle: 'autre@exemple.fr' });
    H.v('adresse différente : rien', [(await He.rattacherAchats({ compteId: pau.id }, cfg, { emailCle })).total, (await db.col('credits').findOne({ userId: 'uAutre' })).soldeScans], [0, 30]);
    await wallet('uNull', { soldeScans: 30, email: null });
    const pnu = await compte({ email: 'null@exemple.fr', emailCle: 'null@exemple.fr' });
    H.v('credits.email null : rien', [(await He.rattacherAchats({ compteId: pnu.id }, cfg, { emailCle })).total, (await db.col('credits').findOne({ userId: 'uNull' })).soldeScans], [0, 30]);
    // 6. la course : 10 rattachements simultanés du même compte
    await wallet('uCourseA', { soldeScans: 40, email: 'course@exemple.fr' });
    const pco = await compte({ email: 'course@exemple.fr', emailCle: 'course@exemple.fr' });
    await Promise.all(Array.from({ length: 10 }, () => He.rattacherAchats({ compteId: pco.id }, cfg, { emailCle })));
    H.v('10 rattachements simultanés : 40 crédités une seule fois', (await lire(pco)).solde.achete, 40);
    // 7. le portefeuille à 160 d'une copie fabriquée : 160 sur le compte, 0 sur l'ancien (c'est (5) ; ici par le script de rejeu sur une SAUVEGARDE)
    const docs = [{ userId: 'bk1', soldeGratuit: 12, soldeScans: 160, email: 'bk.un@exemple.fr' }, { userId: 'bk2', soldeGratuit: 400, soldeScans: 0, email: null }, { userId: 'bk3', soldeGratuit: 0, soldeScans: 20, email: 'sans.compte@exemple.fr' }];
    const fich = path.join(os.tmpdir(), `credits-fabriques-${Date.now()}.json`); fs.writeFileSync(fich, EJSON.stringify(docs, { relaxed: true }));
    const cli = path.join(__dirname, '..', 'migrations', 'rejouer-migration-credits.js');
    const lance = (...a) => H.lancerNode([cli, ...a]);   // asynchrone : voir H.lancerNode (interblocage avec mongod en mémoire sous spawnSync)
    const rj = await lance('--base=test_scratch', `--depuis=${fich}`);
    H.v('script de rejeu sur une sauvegarde : code 0', rj.status, 0);
    H.v('   imprime somme(achetés) avant / après (180 / 180)', /avant\s*:\s*180/.test(rj.stdout) && /après\s*:\s*180/.test(rj.stdout), true);
    H.v('   le script REFUSE --base=test (avec ou sans --confirmer-production)', [(await lance('--base=test', `--depuis=${fich}`)).status, (await lance('--base=test', `--depuis=${fich}`, '--confirmer-production')).status], [1, 1]);
    H.v('   refuse sans --depuis', (await lance('--base=test_scratch')).status, 1);
    // la baisse : code 1 (un rattachement défaillant injecté PERD des crédits)
    const rb = await Rej.rejouer(docs.map(d => ({ ...d, userId: 'perte-' + d.userId })), cfg, { emailCle, rattacher: async () => { await db.col('credits').updateMany({ userId: /^perte-/ }, { $set: { soldeScans: 0 } }); return { ok: true, total: 0 }; } });
    H.v('une perte d\'achetés pendant le rejeu : avant > après, ok false', [rb.avant, rb.apres < rb.avant, rb.ok], [180, true, false]);
    H.v('   codeDeSortie = 1 sur baisse, 0 sinon', [Rej.codeDeSortie({ avant: 180, apres: 100 }), Rej.codeDeSortie({ avant: 180, apres: 180 })], [1, 0]);
    fs.unlinkSync(fich);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
