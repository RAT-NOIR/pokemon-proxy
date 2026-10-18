'use strict';
// Banc MODELE-VISUEL-API (7) — le CHARGEUR de l'index des empreintes (v2/chargeur/montage-empreintes.js) : éteint par défaut, index local en banc, objet R2 privé (FAUX client, aucun réseau), HMAC avant tout, modèle de la
// configuration, version précédente gardée, jamais plus ancien, jamais plus de 10 % perdus, aucun nouvel essai après un échec. L'index est celui de _empreinte-aide.js (fabriqué) ; le fichier de banc vit dans le dossier temporaire.
const H = require('./_harnais');
const fs = require('fs'), os = require('os'), path = require('path');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide');
const X = require('../identifier/index-empreintes');
const L = require('../chargeur/montage-empreintes');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'empreintes-banc-'));
const fichier = path.join(dossier, 'index.rmei');
const journal = []; const jr = m => journal.push(m);
const dernier = () => journal[journal.length - 1] || '';
const cfgDe = (over = {}) => lireConfig({ ...A.ENV_EMPREINTE, V2_EMPREINTES_BANC_FICHIER: fichier, ...over });
const ENV = { V2_VISUELS_HMAC: A.SECRET, BANC_ISOLE: '1' };
const R2_ENV = { V2_VISUELS_R2_COMPTE: 'compte-banc', V2_VISUELS_R2_CLE_ID: 'cle-banc', V2_VISUELS_R2_SECRET: 'secret-r2-banc', V2_VISUELS_R2_BUCKET: 'bucket-banc', V2_VISUELS_HMAC: A.SECRET };
// un faux client S3 : send(GetObjectCommand) rend un corps asynchrone ; aucune requête réelle
const fauxClient = (buf, { erreur = null } = {}) => ({ appels: 0, async send(cmd) { this.appels++; if (erreur) throw erreur; return { ContentLength: buf.length, Body: (async function* () { yield buf.subarray(0, 1000); yield buf.subarray(1000); })() }; } });

(async () => {
    // ── éteint par défaut : rien n'est lu, rien n'est monté
    A.etat.vider();
    H.v('1a. drapeau éteint : rien (null), aucune variable relue, aucune écriture du journal', [L.demarrerPourConfig(lireConfig({ MONGODB_BASE: 'test_scratch' }), { env: { ...ENV }, journal: jr }), journal.length, A.etat.courante()], [null, 0, null]);
    H.v('1b. allumé sans version de modèle configurée : rien, et le journal NOMME les variables', [L.demarrerPourConfig(lireConfig({ MONGODB_BASE: 'test_scratch', V2_EMPREINTE_EXTENSION: '1' }), { env: { ...ENV }, journal: jr }), /V2_MODELE_EMPREINTE_ID/.test(dernier())], [null, true]);
    H.v('1c. sans secret HMAC : rien (voie fermée par défaut), jamais une archive ouverte sans scellement', [L.demarrerPourConfig(cfgDe(), { env: { BANC_ISOLE: '1' }, journal: jr }), /V2_VISUELS_HMAC/.test(dernier())], [null, true]);
    H.v('1d. secret trop court : rien', L.demarrerPourConfig(cfgDe(), { env: { BANC_ISOLE: '1', V2_VISUELS_HMAC: 'court' }, journal: jr }), null);
    H.vrai('   la valeur du secret n\'est dans aucune ligne du journal', !journal.some(l => l.includes(A.SECRET)));

    // ── l'index de BANC : local, installé tout de suite
    fs.writeFileSync(fichier, A.scelle());
    const banc = L.demarrerPourConfig(cfgDe(), { env: { ...ENV }, journal: jr });
    await new Promise(r => setTimeout(r, 50));
    const c = A.etat.courante();
    H.vrai('2a. fichier de banc : l\'index est installé (n, modèle, date), gelé', c && c.meta.n === A.N && c.meta.modele.id === A.MODELE.id && c.meta.chargeLe.toISOString() === '2026-10-17T14:14:00.000Z' && Object.isFrozen(c));
    H.vrai('2b. … et le journal le dit sans valeur secrète', /index chargé : 200 visuels/.test(dernier()) && !dernier().includes(A.SECRET));
    banc.arreter();
    A.etat.vider();
    // en production le fichier de banc n'est PAS honoré (config.js : seulement en mode banc)
    const prod = lireConfig({ ...A.ENV_EMPREINTE, V2_EMPREINTES_BANC_FICHIER: fichier, MONGODB_BASE: 'prod-fictive', BANC_ISOLE: '0' });
    H.v('2c. hors mode banc, V2_EMPREINTES_BANC_FICHIER est ignorée par la configuration', prod.modeleEmpreinte.fichierBanc, null);

    // ── les refus : l'index en place est GARDÉ
    const sansBanc = lireConfig({ ...A.ENV_EMPREINTE });
    const lireBuf = buf => async () => buf;
    const p0 = await L.charger({ lireFichier: lireBuf(A.scelle()), secret: A.SECRET, modele: A.MODELE, journal: jr });
    H.v('3a. un chargement valide installe l\'index', [p0.ok, A.etat.courante().meta.n], [true, A.N]);
    const avant = A.etat.courante();
    const refus = async (nom, lire, motif, opts = {}) => { const r = await L.charger({ lireFichier: lire, secret: opts.secret || A.SECRET, modele: opts.modele || A.MODELE, journal: jr }); H.vrai(`${nom} -> refusé (${motif}), l'index en place est gardé`, r.ok === false && r.motif.includes(motif) && A.etat.courante() === avant); if (!(r.ok === false && r.motif.includes(motif))) console.log('   obtenu :', r); };
    await refus('3b. HMAC faux', lireBuf(A.scelle()), 'HMAC', { secret: A.SECRET.replace('0123', '9999') });
    await refus('3c. un autre modèle que celui de la configuration', lireBuf(A.scelle()), 'modèle', { modele: { id: A.MODELE.id, sha256: 'e'.repeat(64) } });
    await refus('3d. un index plus ancien que celui en place', lireBuf(A.scelle({ chargeLe: '2026-10-01T00:00:00.000Z' })), 'plus ancien');
    const petit = (() => { const n = 150; return X.sceller({ cles: A.cles.slice(0, n), matrice: A.matrice.slice(0, n * 256), contexte: A.contexte, modele: A.MODELE, chargeLe: '2026-10-18T00:00:00.000Z' }, A.SECRET); })();
    await refus('3e. plus de 10 % de lignes perdues (200 -> 150)', lireBuf(petit), 'perte');
    await refus('3f. une lecture qui échoue (le pilote lève)', async () => { throw Object.assign(new Error('adresse secrète https://x.invalid'), { name: 'Boum' }); }, 'lecture impossible (Boum)');
    H.vrai('3g. le message du pilote n\'est JAMAIS recopié dans le journal', !journal.some(l => l.includes('adresse secrète')));
    const plusRecent = await L.charger({ lireFichier: lireBuf(A.scelle({ chargeLe: '2026-10-18T09:00:00.000Z' })), secret: A.SECRET, modele: A.MODELE, journal: jr });
    H.v('3h. un index plus récent et complet remplace celui en place (bascule)', [plusRecent.ok, A.etat.courante().meta.chargeLe.toISOString()], [true, '2026-10-18T09:00:00.000Z']);
    A.etat.vider();
    const sansIndex = await L.charger({ lireFichier: async () => { throw new Error('x'); }, secret: A.SECRET, modele: A.MODELE, journal: jr });
    H.vrai('3i. sans index en place, un échec le DIT (« aucun index en place, la règle G se tait ») et ne lève pas', sansIndex.ok === false && /aucun index en place/.test(dernier()));

    // ── la voie R2 privée, avec un FAUX client : aucun réseau, jamais l'hôte public
    const cfgR2 = lireConfig({ ...A.ENV_EMPREINTE, V2_EMPREINTES_R2_OBJET: 'empreintes/index-2026-10-17.rmei' });
    const manques = L.demarrerPourConfig(cfgR2, { env: { V2_VISUELS_HMAC: A.SECRET }, journal: jr });
    H.vrai('4a. variables R2 absentes : rien, et le journal les NOMME (jamais une valeur)', manques === null && /V2_VISUELS_R2_COMPTE/.test(dernier()) && /V2_VISUELS_R2_BUCKET/.test(dernier()));
    const sansObjet = L.demarrerPourConfig(cfgDe({ V2_EMPREINTES_BANC_FICHIER: '' }), { env: { ...R2_ENV }, journal: jr });
    H.vrai('4b. le nom de l\'objet (V2_EMPREINTES_R2_OBJET) non configuré : rien, il est nommé', sansObjet === null && /V2_EMPREINTES_R2_OBJET/.test(dernier()));
    const client = fauxClient(A.scelle());
    const planifies = []; const intervalles = [];
    const monte = L.demarrerPourConfig(cfgR2, { env: { ...R2_ENV }, client, journal: jr, planifier: fn => planifies.push(fn), minuteurs: { setInterval: (f, ms) => { intervalles.push(ms); return { unref() { } }; }, clearInterval() { } } });
    H.v('4c. voie R2 : RIEN n\'est lu au montage (le premier chargement est différé), un rechargement quotidien est armé', [client.appels, planifies.length, intervalles], [0, 1, [24 * 3600 * 1000]]);
    planifies[0](); await new Promise(r => setTimeout(r, 120));
    H.v('4d. le premier tour lit l\'objet par le faux client et installe l\'index', [client.appels, A.etat.courante() && A.etat.courante().meta.n], [1, A.N]);
    monte.arreter();
    A.etat.vider();
    const absent = fauxClient(Buffer.alloc(0), { erreur: Object.assign(new Error('x'), { name: 'NoSuchKey' }) });
    const m2 = L.demarrerPourConfig(cfgR2, { env: { ...R2_ENV }, client: absent, journal: jr, planifier: fn => fn(), minuteurs: { setInterval: () => ({ unref() { } }), clearInterval() { } } });
    await new Promise(r => setTimeout(r, 120));
    H.vrai('4e. l\'objet n\'existe pas encore (la publication sur R2 n\'est pas faite) : « 404 » nommé, aucun index, la règle G se tait, rien ne lève, UN seul essai', A.etat.courante() === null && absent.appels === 1 && /objet absent \(404\)/.test(dernier()));
    m2.arreter();
    H.vrai('5. le chargeur n\'écrit RIEN : aucune de ses fonctions n\'appelle PutObject ni ne touche la base (lecture seule)', !/PutObject|insertOne|updateOne|writeFile/.test(fs.readFileSync(path.join(__dirname, '..', 'chargeur', 'montage-empreintes.js'), 'utf8').replace(/\/\/.*$/gm, '')));
    void banc; void sansBanc;
    fs.rmSync(dossier, { recursive: true, force: true });
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
