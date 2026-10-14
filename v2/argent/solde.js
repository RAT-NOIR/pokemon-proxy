'use strict';
// Le Solde (CONTRAT-2 §3.5) et l'historique. Tout est relu EN BASE (jamais l'instantané du porteur) ; chaque poche annoncée est une poche UTILISABLE :
// un compte non vérifié n'a ni accueil ni hebdo, même si la base porte un nombre (la garde s'écrit par ce qu'elle autorise).
const db = require('../db'); const { semaineISO } = require('../../acces'); const P = require('./poches'); const Of = require('./offre');
const { RAISONS_NON_REMBOURSE } = require('../../sources');
const col = nom => db.col(nom);

const masquer = email => { const i = typeof email === 'string' ? email.indexOf('@') : -1; return i < 1 ? null : `${email[0]}•••${email.slice(i)}`; };
const premierDuMoisSuivant = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

async function solde(porteur, cfg, maintenant = new Date()) {
    const vide = { essai: 0, accueil: 0, hebdo: 0, achete: 0 };
    let p = { ...vide }, hebdoMax = 0, prochainHebdo = null, lie = null, abonnement = null;
    if (porteur.type === 'installation') {
        const i = await col('installations').findOne({ _id: porteur.id });
        if (i) { p.essai = Math.max(0, i.essais ?? 0); p.achete = Math.max(0, i.achete ?? 0); }
    } else if (porteur.type === 'compte') {
        const c = await col('comptes').findOne({ _id: porteur.id });
        if (c) {
            lie = { lie: true, emailMasque: masquer(c.email), verifie: Boolean(c.verifie), administrateur: Of.estAdministrateur(porteur, c) };
            p.achete = Math.max(0, c.solde?.achete ?? 0);
            if (c.verifie) {
                p.accueil = Math.max(0, c.solde?.accueil ?? 0);
                if (cfg.quotas.hebdo > 0) {
                    hebdoMax = cfg.quotas.hebdo; prochainHebdo = P.prochainLundi(maintenant);
                    const h = await col('hebdo').findOne({ compteId: c._id, semaine: semaineISO(maintenant) });
                    p.hebdo = Math.max(0, hebdoMax - (h ? h.count : 0));
                }
            }
            const a = c.abonnement;
            if (a && a.actif && a.jusquAu && a.jusquAu > maintenant) {
                const entier = n => (Number.isInteger(n) ? n : 0);   // OFFRE-QUOTA : un abonnement posé sans les champs de l'ancienne vente (quotaMensuel, restant) ne casse pas le contrat (entiers) : 0, jamais NaN/null
                const restant = a.moisCle === P.moisCle(maintenant) ? a.restant : a.quotaMensuel;   // le mois a changé : le prochain débit recharge, on annonce ce rechargement
                abonnement = { restant: Math.max(0, entier(restant)), quotaMensuel: entier(a.quotaMensuel), renouvelleLe: premierDuMoisSuivant(maintenant) };
            }
        }
    }
    const total = p.essai + p.accueil + p.hebdo + p.achete + (abonnement ? abonnement.restant : 0);
    return { total, ...p, hebdoMax, prochainHebdo, compte: lie || { lie: false, emailMasque: null, verifie: false, administrateur: false }, partage: true, abonnement };
}

// Contrôle SANS DÉBIT : ce porteur a-t-il au moins un crédit UTILISABLE (les mêmes poches que le débit, lues comme `solde` les annonce) ? Un administrateur (relu en base,
// comme le débit) passe. Rien n'est écrit : le débit reste seul juge — ce contrôle ne fait qu'éviter de lire 12 Mo pour un refus d'argent certain.
async function peutPayer(porteur, cfg, maintenant = new Date()) {
    if (porteur.administrateur === true && porteur.type === 'compte' && (await col('comptes').countDocuments({ _id: porteur.id, role: 'administrateur' })) > 0) return { ok: true };
    // OFFRE-QUOTA : « peut-il payer ? » = lui reste-t-il une analyse aujourd'hui (même source que le débit : l'offre relue en base). Les anciens soldes ne comptent plus : ils ne se débitent plus.
    // Pro (restant: null) passe tant que le plafond technique n'est pas atteint (le débit reste seul juge) ; un compte non vérifié se voit demander de confirmer son adresse.
    const e = await Of.etatDe(porteur, cfg, maintenant);
    if (!e) return { ok: false, code: P.codeRefus(porteur) };
    if (e.nonVerifie) return { ok: false, code: 'VERIFICATION' };
    const pris = await Of.prisAuJour(porteur, Of.jourDeParis(maintenant));
    return e.limite > pris ? { ok: true } : { ok: false, code: P.codeRefus(porteur) };
}

// ── historique : une ligne « analyse » par scan, une ligne « credits » par octroi / achat / migration ; la suite est opaque ─────────────────────
const NATURES = ['octroi', 'achat', 'migration'];
// La forme servie est celle du CONTRAT (LigneAnalyse / LigneCredits, CONTRAT-API-V2.md §1.6 ; ruling A du 2026-10-10). La clé de pagination vit à côté de la ligne servie (jamais dedans).
// Une ligne que le contrat ne sait pas dire est OMISE, jamais inventée, et COMPTÉE (`omises`) :
//   · analyse sans surface connue, sans statut du contrat, ou sans facturation complète (ligne ancienne) ;
//   · crédit dont la poche n'a pas de motif au contrat (abonnement, essai…) : le contrat ne connaît que accueil · hebdo · achat.
const MOTIF_DE_POCHE = Object.freeze({ accueil: 'accueil', hebdo: 'hebdo', achete: 'achat' });
const STATUTS = ['identifiee', 'a-trancher', 'introuvable', 'lot'];
function facturationServie(f) {
    const { MOTIFS } = require('./facturation');
    if (!f || typeof f !== 'object') return null;
    const entier = x => Number.isInteger(x) && x >= 0;
    if (!entier(f.debite) || !entier(f.reserve) || !MOTIFS.includes(f.motif)) return null;
    // la raison n'est servie que si elle appartient à la liste fermée (le schéma la ferme par enum) : sinon la ligne est omise et comptée, jamais servie hors contrat
    if (f.raisonNonRembourse !== null && f.raisonNonRembourse !== undefined && !RAISONS_NON_REMBOURSE.includes(f.raisonNonRembourse)) return null;
    // `rembourse` est un booléen au contrat ; une ligne ancienne le portait en 0 / 1 : même valeur, autre écriture (aucune valeur n'est créée)
    return { debite: f.debite, reserve: f.reserve, rembourse: Boolean(f.rembourse), motif: f.motif, raisonNonRembourse: f.raisonNonRembourse ?? null };
}
function ligneAnalyse(a) {
    const facturation = facturationServie(a.facturation);
    if (!facturation || !['extension', 'scanner'].includes(a.surface) || !STATUTS.includes(a.statut) || !(a.creeLe instanceof Date)) return null;
    const cartes = Array.isArray(a.cartes) ? a.cartes : [];
    let carte = null;
    if (a.statut === 'identifiee' && cartes[0]) {
        const p = (a.produits || []).find(x => x && x.idProduct === cartes[0].idProduct);
        if (p && typeof p.nom === 'string' && p.set && typeof p.set.nom === 'string') carte = { nom: p.nom, set: p.set.nom, numero: typeof p.numero === 'string' ? p.numero : null };
    }
    return { genre: 'analyse', le: a.creeLe.toISOString(), surface: a.surface, statut: a.statut, carte, cartesVues: cartes.length, facturation };
}
function ligneCredits(m) {
    const motif = MOTIF_DE_POCHE[m.poche];                      // une migration prend le motif de sa poche d'origine
    if (!motif || !Number.isInteger(m.delta) || !(m.le instanceof Date)) return null;
    return { genre: 'credits', le: m.le.toISOString(), motif, credits: m.delta };
}
const cleDe = x => x.k;
function lireSuite(suite) {
    if (suite == null) return null;
    try { const o = JSON.parse(Buffer.from(String(suite), 'base64url').toString('utf8')); if (Number.isFinite(o.ms) && typeof o.k === 'string') return o; } catch (_) { /* refusé plus bas */ }
    throw Object.assign(new Error('historique : suite invalide'), { code: 'SUITE_INVALIDE' });     // une faute du CLIENT : la route la rend en 400 ENTREE
}
const ecrireSuite = l => Buffer.from(JSON.stringify({ ms: new Date(l.le).getTime(), k: cleDe(l) }), 'utf8').toString('base64url');
// Un lot de lecture : au plus `limite` lignes de CHAQUE source, fusionnées. Une source qui rend exactement `limite` lignes est PLEINE (il peut en rester, plus anciennes) : seules sont
// alors « sûres » (jamais précédées d'une ligne non lue) les lignes plus récentes que la dernière ligne lue de chaque source pleine. Les lignes à la même milliseconde que cette frontière
// sont relues au lot suivant (jamais servies avant). `suivant` : où reprendre ; null = les deux sources sont épuisées.
const FIN = '￿';
const ordre = (a, b) => (new Date(b.le) - new Date(a.le)) || (cleDe(a) < cleDe(b) ? 1 : -1);
const apres = (x, c) => { const ms = new Date(x.le).getTime(); return ms < c.ms || (ms === c.ms && cleDe(x) < c.k); };
async function lireLot(porteur, cur, limite) {
    const porteurCle = `${porteur.type}:${porteur.id}`, borne = cur ? new Date(cur.ms) : null;
    const A = await col('analyses').find({ porteur: porteurCle, ...(borne ? { creeLe: { $lte: borne } } : {}) }).sort({ creeLe: -1 }).limit(limite).toArray();
    const B = await col('mouvements').find({ ...(porteur.type === 'compte' ? { compteId: porteur.id } : { installationId: porteur.id }), type: { $in: NATURES }, ...(borne ? { le: { $lte: borne } } : {}) }).sort({ le: -1 }).limit(limite).toArray();
    // chaque élément : { ligne (la forme du contrat, ou null = omise), le (date), k (clé de pagination) }
    const ia = A.map(a => ({ le: a.creeLe, k: `analyse:${String(a._id)}`, ligne: ligneAnalyse(a) })).sort(ordre);
    const ib = B.map(m => ({ le: m.le, k: `credits:${m.cleIdempotence ?? String(m._id)}`, ligne: ligneCredits(m) })).sort(ordre);
    let tous = [...ia, ...ib];
    if (cur) tous = tous.filter(x => apres(x, cur));
    tous.sort(ordre);
    const pleines = [];
    if (A.length === limite && ia.length) pleines.push(ia[ia.length - 1]);
    if (B.length === limite && ib.length) pleines.push(ib[ib.length - 1]);
    if (!pleines.length) return { items: tous, suivant: null };
    const msFrontiere = Math.max(...pleines.map(x => new Date(x.le).getTime()));       // la frontière la plus RÉCENTE est la plus stricte
    return { items: tous.filter(x => new Date(x.le).getTime() > msFrontiere), suivant: { ms: msFrontiere, k: FIN } };
}
async function historique(porteur, { suite = null, limite = 20 } = {}, cfg) {
    let cur = lireSuite(suite);
    const taille = Math.min(Math.max(1, limite), 50);
    let marge = taille + 25, nOmis = 0, epuise = false;
    const servies = [];                                                              // { x, omisesAvant } : les lignes SERVIES, dans l'ordre, chacune avec le nombre d'omises lues avant elle
    // La page se remplit de lignes SERVIES, en relisant plus loin tant qu'elle n'est pas pleine et que les sources ne sont pas épuisées (une série d'omises ne l'arrête jamais).
    // On lit UNE ligne servie de plus que la page : c'est elle qui dit s'il y a une suite. Les omises rencontrées sont comptées (une absence se compte).
    for (let tours = 0; servies.length <= taille && !epuise; tours++) {
        const lot = await lireLot(porteur, cur, marge);
        if (lot.suivant && !lot.items.length && cur && lot.suivant.ms === cur.ms) { marge *= 2; if (marge > 1e6) throw new Error('historique : lecture bloquée'); continue; }     // plus de `marge` lignes à la même milliseconde : on élargit
        for (const x of lot.items) {
            if (x.ligne) servies.push({ x, omisesAvant: nOmis }); else nOmis++;
            if (servies.length > taille) break;
        }
        if (servies.length > taille) break;
        if (!lot.suivant) epuise = true; else cur = lot.suivant;
    }
    const page = servies.slice(0, taille), plus = servies.length > taille;
    // `suite` est nul SEULEMENT si les deux sources sont épuisées sans autre ligne servie ; sinon elle pointe sur la dernière ligne de la page
    return { lignes: page.map(s => s.x.ligne), suite: plus ? ecrireSuite(page[page.length - 1].x) : null, omises: plus ? servies[taille - 1].omisesAvant : nOmis };
}
module.exports = { solde, peutPayer, historique, masquer };
