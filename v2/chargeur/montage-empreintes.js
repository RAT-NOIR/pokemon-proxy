'use strict';
// MODELE-VISUEL-API — le CHARGEUR de l'index des empreintes : il charge l'index comme le chargeur charge l'archive des visuels (montage.js), avec les MÊMES primitives (objet R2 PRIVÉ lu avec des clés de LECTURE
// dédiées, HMAC V2_VISUELS_HMAC vérifié AVANT toute lecture du contenu, bascule atomique, version précédente gardée), et la même règle de reprise : AUCUN nouvel essai après un échec — le prochain est le
// rechargement quotidien. Éteint (V2_EMPREINTE_EXTENSION=0, le défaut) : ce fichier n'est même pas chargé (identifier/monter.js), aucune lecture, aucune variable relue.
//   · banc (cfg.modeleEmpreinte.fichierBanc, honoré SEULEMENT en mode banc) : un index LOCAL installé tout de suite ; BANC_ISOLE=1 sans fichier : rien, aucun réseau.
//   · production : l'objet R2 privé `cfg.modeleEmpreinte.objet` (V2_EMPREINTES_R2_OBJET) du bucket V2_VISUELS_R2_BUCKET, mêmes clés de lecture que l'archive des visuels. Une variable absente ⇒ « sans index » et
//     un journal qui NOMME les variables, jamais une valeur. Sans index, la règle G se tait (code « indisponible ») et l'identification continue.
// Le modèle attendu est celui de la configuration : un index scellé pour un autre modèle est REFUSÉ à l'ouverture (index-empreintes.js).
// 🔴 La PUBLICATION de l'objet sur R2 n'est PAS faite par ce lot (elle demande l'accord du testeur) : tant que l'objet n'existe pas, le chargement est un « 404 » nommé et G se tait.
const fs = require('fs');
const X = require('../identifier/index-empreintes');
const etat = require('../identifier/etat-empreintes');
const R2 = require('./r2-prive');

const JOUR_MS = 24 * 3600 * 1000, PERTE_MAX = 0.10;
const NOMS = Object.freeze(['V2_VISUELS_R2_COMPTE', 'V2_VISUELS_R2_CLE_ID', 'V2_VISUELS_R2_SECRET', 'V2_VISUELS_R2_BUCKET', 'V2_VISUELS_HMAC']);
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
class RefusIndex extends Error { constructor(motif) { super(motif); this.name = 'RefusIndex'; this.motif = motif; } }
const nom = e => (e && (e.name || e.code)) || 'erreur';

/**
 * UN chargement : lit, ouvre (HMAC, forme, modèle), puis juge contre la version en place (jamais plus ancienne, jamais plus de 10 % de lignes perdues), puis bascule.
 * @returns {Promise<{ok: boolean, motif?: string, n?: number}>} — ne lève jamais ; les messages du pilote ne sont jamais recopiés.
 */
async function charger({ lireFichier, secret, modele, journal = m => console.error(m), maintenant = Date.now }) {
    try {
        const lu = await lireFichier();
        const { index, meta } = X.ouvrir(lu, secret, { modeleAttendu: modele });
        const prev = etat.courante();
        if (prev) {
            if (meta.chargeLe < prev.meta.chargeLe) throw new RefusIndex(`index plus ancien que celui en place (${meta.chargeLe.toISOString()} < ${prev.meta.chargeLe.toISOString()})`);
            if (prev.meta.n > 0 && meta.n < prev.meta.n * (1 - PERTE_MAX)) throw new RefusIndex(`perte de plus de 10 % des lignes (${prev.meta.n} → ${meta.n})`);
        }
        etat.installer(Object.freeze({ index, meta: Object.freeze(meta) }));
        journal(`✅ [v2 empreintes] index chargé : ${meta.n} visuels · ${(index.octetsMatrice / 1048576).toFixed(1)} Mo en fp16 · modèle ${meta.modele.id} · archive du ${meta.chargeLe.toISOString()} (âge ${Math.max(0, Math.round((maintenant() - meta.chargeLe.getTime()) / 3600000))} h)`);
        return { ok: true, n: meta.n };
    } catch (e) {
        const motif = e && (e.name === 'FormatInvalide' || e.name === 'RefusIndex') ? e.motif : `lecture impossible (${nom(e)})`;
        journal(`❌ [v2 empreintes] échec, ${etat.courante() ? 'index précédent gardé' : 'aucun index en place (la règle G se tait)'}, aucun nouvel essai (prochain essai : le rechargement quotidien) : ${motif}`);
        return { ok: false, motif };
    }
}

/** Monte le chargeur pour une configuration. Rend null (rien à tenir) ou { arreter, charger } — un minuteur quotidien unref. Ne lit RIEN avant le premier tour (le serveur écoute avant). */
function demarrerPourConfig(cfg, { env = process.env, client = null, journal: jDonne = null, planifier = fn => setImmediate(fn), minuteurs = { setInterval, clearInterval } } = {}) {
    const journal = jDonne || (m => (/^(✅|ℹ️)/.test(m) ? console.log(m) : console.error(m)));
    if (!cfg || cfg.empreinteExtension !== true) return null;
    const m = cfg.modeleEmpreinte || {};
    if (!m.id || !m.sha256) { journal('ℹ️ [v2 empreintes] sans index : aucune version de modèle configurée (V2_MODELE_EMPREINTE_ID, V2_MODELE_EMPREINTE_SHA256)'); return null; }
    const modele = { id: m.id, sha256: m.sha256 };
    const secret = texte(env.V2_VISUELS_HMAC);
    if (!X.secretValide(secret)) { journal('ℹ️ [v2 empreintes] sans index : V2_VISUELS_HMAC absent ou trop court (32 caractères au moins)'); return null; }
    let lireFichier;
    if (m.fichierBanc) {
        // un index de banc est local et petit : installé TOUT DE SUITE, mêmes contrôles que la voie réelle
        const tour = () => charger({ lireFichier: async () => fs.readFileSync(m.fichierBanc), secret, modele, journal });
        tour();
        return { arreter() { }, charger: tour };
    }
    if (env.BANC_ISOLE === '1') return null;                                              // un banc ne télécharge rien
    const manque = NOMS.filter(n => !texte(env[n]));
    if (manque.length || !m.objet) { journal(`ℹ️ [v2 empreintes] sans index (voie fichier fermée par défaut) : variables absentes : ${[...manque, ...(m.objet ? [] : ['V2_EMPREINTES_R2_OBJET'])].join(', ')}`); return null; }
    const c = { compte: texte(env.V2_VISUELS_R2_COMPTE), cleId: texte(env.V2_VISUELS_R2_CLE_ID), secret: texte(env.V2_VISUELS_R2_SECRET), bucket: texte(env.V2_VISUELS_R2_BUCKET), endpoint: texte(env.V2_VISUELS_R2_ENDPOINT) };
    let cl = client;
    lireFichier = () => { if (!cl) cl = R2.creerClient(c); return R2.lireObjet({ client: cl, bucket: c.bucket, objet: m.objet, max: X.MAX_OCTETS }); };
    let jour = null, vivant = true;
    const tour = () => charger({ lireFichier, secret, modele, journal });
    planifier(() => { if (vivant) tour(); });
    jour = minuteurs.setInterval(() => { if (vivant) tour(); }, JOUR_MS);
    if (jour && jour.unref) jour.unref();
    return { arreter() { vivant = false; if (jour) { minuteurs.clearInterval(jour); jour = null; } }, charger: tour };
}

module.exports = { demarrerPourConfig, charger, NOMS, JOUR_MS, PERTE_MAX };
