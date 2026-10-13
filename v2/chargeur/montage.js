'use strict';
// COTES-VISUELS — le MONTAGE du chargeur (appelé par identifier/monter.js, donc seulement quand la v2 est allumée et sa configuration valide ; interrupteur éteint : ce fichier n'est jamais chargé).
//   · banc (BANC_ISOLE=1) : AUCUN réseau, AUCUNE connexion à cartes. Une archive LOCALE (V2_VISUELS_BANC_FICHIER, honorée seulement en banc) si elle est donnée, sinon rien.
//   · production, source « fichier » (défaut) : l'archive précalculée est un objet R2 PRIVÉ, lu avec des clés de LECTURE dédiées (variables V2_VISUELS_R2_*, fermées par défaut : l'une absente ⇒
//     « sans visuel » et un journal qui les nomme), authentifiée par un HMAC (V2_VISUELS_HMAC) AVANT toute décompression. Jamais l'hôte public. Elle n'attend PAS la base de l'API (elle n'en lit aucune) :
//     le chargement part dès le démarrage. Les RÉPONSES n'attendent jamais le chargement.
//   · source « calcul » : le fil plafonné, depuis `cartes` en lecture seule (attend la base de l'API pour le catalogue).
// Rien n'est lu ici : demarrer() diffère le premier chargement (le serveur écoute avant, et jusqu'au premier chargement réussi l'état est « sans visuel » / cotes {}).
const fs = require('fs');
const I = require('./index');
const { PLAFONDS } = require('./format');

function demarrerPourConfig(cfg, { env = process.env, client = null, journal: journalDonne = null } = {}) {
    const v = cfg.visuels;
    const journal = journalDonne || (m => console.error(m));
    const duChargeur = journalDonne ? { journal: journalDonne } : {};                        // le journal du chargeur lui-même (les bancs le captent) ; sinon le sien (stdout / stderr)
    if (v.fichierBanc) {
        // l'archive de banc est locale et petite : installée TOUT DE SUITE (un banc qui répond avant le chargement ne verrait pas ses visuels). Même format, mêmes plafonds, même validation que la voie réelle.
        try {
            const lu = fs.readFileSync(v.fichierBanc);
            if (lu.length > PLAFONDS.archive) throw Object.assign(new Error('x'), { name: 'ArchiveTropGrande' });
            const version = require('./format').deserialiser(require('zlib').gunzipSync(lu, { maxOutputLength: PLAFONDS.decompresse }));
            if (!require('./version').rejugerEntrees(version).ok) throw Object.assign(new Error('x'), { name: 'EntreeRejetee' });
            I.etat.installer(version);
        } catch (e) { journal(`❌ [v2 chargeur] archive de banc refusée (${(e && (e.name || e.code)) || 'erreur'}) : sans visuel`); }
        return null;
    }
    if (env.BANC_ISOLE === '1') return null;                                              // un banc ne télécharge ni ne lit cartes
    const alerte = require('./alerte-archive').ecrire;                                    // JUMEAU-V2 : l'alerte « archive absente / sans colonne / > 48 h » est écrite en base (collection `alertes` de l'API)
    if (v.source === 'calcul') return I.demarrerChargeur({ env, ...duChargeur, alerte });
    const R2 = require('./r2-prive');
    const c = R2.configLecture(env);
    if (!c.ok) { journal(`ℹ️ [v2 chargeur] sans visuel (voie fichier fermée par défaut) : ${c.raison}`); return null; }
    if (!require('./scellement').secretValide(c.c.hmac)) { journal('ℹ️ [v2 chargeur] sans visuel : V2_VISUELS_HMAC trop court (32 caractères au moins)'); return null; }
    let cl = client;
    const lire = () => { if (!cl) cl = R2.creerClient(c.c); return R2.lireObjet({ client: cl, bucket: c.c.bucket, objet: c.c.objet, max: PLAFONDS.archive + 64 }); };
    return I.demarrerChargeur({ env, ...duChargeur, alerte, catalogue: async () => new Map(), pret: async () => true, executer: I.executerDepuisFichier({ lireFichier: lire, secret: c.c.hmac }) });
}
module.exports = { demarrerPourConfig };
