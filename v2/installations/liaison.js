'use strict';
// Liaison d'une installation à un compte (PLAN-COMPTES §4.4). Le code est à usage unique, 10 min, 3 vivants au plus par compte.
const { col } = require('../db'); const J = require('../comptes/jetons');

const RE_CODE = /^[A-Z0-9]{6}$/;
const RE_ID = /^[0-9a-f]{32}$/;
const masquer = email => { const [l, d] = String(email).split('@'); return `${Array.from(l)[0] || ''}•••@${d || ''}`; };

async function creerCode(compteId, cfg, maintenant = new Date()) {
    const vivants = () => col('codes_liaison').find({ compteId, utiliseLe: null, expireLe: { $gt: maintenant } }).sort({ expireLe: 1 }).toArray();
    const refus = async () => { const v = await vivants(); return { refus: true, reessayerDans: Math.max(1, Math.ceil((v[0].expireLe.getTime() - maintenant.getTime()) / 1000)) }; };
    if ((await vivants()).length >= cfg.comptes.codesVivants) return refus();
    const expireLe = new Date(maintenant.getTime() + cfg.comptes.codeMinutes * 60e3);
    let code, doc;
    for (let essai = 0; ; essai++) {   // collision sur l'index unique des empreintes : UN réessai, puis l'erreur remonte (503), jamais de boucle
        code = J.genererCode(cfg.comptes.codeLongueur);
        doc = { codeEmpreinte: J.empreinte(code), compteId, creeLe: maintenant, expireLe, utiliseLe: null };
        try { await col('codes_liaison').insertOne(doc); break; }
        catch (e) { if (e.code !== 11000 || essai >= 1) throw e; }
    }
    if ((await vivants()).length > cfg.comptes.codesVivants) {   // deux demandes simultanées : la plus tardive se retire
        const apres = await col('codes_liaison').find({ compteId, utiliseLe: null, expireLe: { $gt: maintenant } }).sort({ creeLe: 1, _id: 1 }).toArray();
        if (apres.slice(cfg.comptes.codesVivants).some(d => d._id.equals(doc._id))) { await col('codes_liaison').deleteOne({ _id: doc._id }); return refus(); }
    }
    return { code, expire: expireLe.toISOString() };
}

/** → { statut, code } en cas de refus ; { ok:true, compte, jeton } sinon. `argent` est vérifié par l'appelant AVANT l'appel. */
async function lier({ installation, code, argent, maintenant = new Date() }) {
    if (installation.compteId) return { statut: 409, code: 'DEJA_LIE' };      // avant de toucher au code : il reste utilisable ailleurs
    const texte = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!RE_CODE.test(texte)) return { statut: 404, code: 'CODE_INVALIDE' };
    const empreinte = J.empreinte(texte);
    const pris = await col('codes_liaison').findOneAndUpdate({ codeEmpreinte: empreinte, utiliseLe: null, expireLe: { $gt: maintenant } }, { $set: { utiliseLe: maintenant } }, { returnDocument: 'after' });
    if (!pris) {
        const vu = await col('codes_liaison').findOne({ codeEmpreinte: empreinte, utiliseLe: null });
        return vu ? { statut: 410, code: 'CODE_EXPIRE' } : { statut: 404, code: 'CODE_INVALIDE' };
    }
    const rendre = () => col('codes_liaison').updateOne({ _id: pris._id }, { $set: { utiliseLe: null } });
    const compte = await col('comptes').findOne({ _id: pris.compteId });
    if (!compte) return { statut: 404, code: 'CODE_INVALIDE' };
    const jeton = J.genererJeton();
    const r = await col('installations').updateOne({ _id: installation._id, compteId: null, revoqueeLe: null, jetonEmpreinte: installation.jetonEmpreinte },
        { $set: { compteId: compte._id, lieeLe: maintenant, jetonEmpreinte: J.empreinte(jeton) } });
    if (r.modifiedCount !== 1) { await rendre(); return { statut: 409, code: 'DEJA_LIE' }; }
    try { await argent.fusionnerALaLiaison({ installation, compteId: compte._id }); }
    catch (e) {   // la liaison n'est annoncée que si la fusion a eu lieu : on défait, le client garde son ancien jeton
        console.error(`❌ [v2 liaison] fusion en échec (${e.message}) — liaison défaite`);
        await col('installations').updateOne({ _id: installation._id }, { $set: { compteId: null, lieeLe: installation.lieeLe ?? null, jetonEmpreinte: installation.jetonEmpreinte } });
        await rendre();
        return { statut: 503, code: 'INDISPONIBLE' };
    }
    return { ok: true, compte, jeton, emailMasque: masquer(compte.email) };
}

async function delier(installation) {
    await col('installations').updateOne({ _id: installation._id, revoqueeLe: null }, { $set: { compteId: null } });   // essais INCHANGÉS : pas de nouvel essai
}

async function revoquer(compteId, id) {
    if (typeof id !== 'string' || !RE_ID.test(id)) return false;
    const r = await col('installations').updateOne({ _id: id, compteId, revoqueeLe: null },
        { $set: { revoqueeLe: new Date(), jetonEmpreinte: J.empreinte(`revoque|${J.genererJeton()}`) } });   // empreinte remplacée par une valeur que personne ne peut présenter
    return r.modifiedCount === 1;
}
module.exports = { creerCode, lier, delier, revoquer, masquer };
