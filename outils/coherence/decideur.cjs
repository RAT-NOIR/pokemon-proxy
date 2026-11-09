'use strict';
// LE DECIDEUR du test de coherence : vecteur + carte redressee -> index d'empreintes -> garde des zones (ORB, scans de l'archive LOCALE) -> regle G, par les FONCTIONS DE PRODUCTION du depot
// (voisins-empreinte.js : creerFournisseurEmpreinte ; decision-g.js : decider ; emprunt.js, index-empreintes.js, chargeur/*). Seule difference avec la route : les scans de l'archive se lisent sur le disque (aucun reseau),
// et le delai de la garde des zones est large (un delai de service n'est pas une decision ; il est note). Aucune verite, aucun idProduct attendu, aucune base.
// Le verdict est celui de l'IMAGE SEULE (les photos eBay n'ont ni titre ni lecture) : affirmee | commune | question | muette(code). « probable » et la promotion par la lecture n'existent pas ici : ils demandent un texte.
// Necessite NODE_PATH = node_modules de l'API (sharp, opencv-js) : aucun module n'est installe dans ce worktree.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RACINE = path.join(__dirname, '..', '..');
const API = 'C:\\Users\\Yung\\rat-market-travail\\api';
const rq = m => require(path.join(RACINE, ...m.split('/')));
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
const INDEX = path.join(API, 'index-empreintes-essai', 'sortie', 'index-empreintes-2026-10-24.rmei');
const ARCHIVE = path.join(API, 'archives', 'en-ligne-essai-0711.rmv');
const IMAGES = path.join(API, 'p8000-quant', 'images');
const DELAI_MS = 60000;

function secret() {
    for (const f of ['C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2\\.env']) {
        if (!fs.existsSync(f)) continue;
        const m = /^V2_VISUELS_HMAC=(.*)$/m.exec(fs.readFileSync(f, 'utf8'));
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    throw new Error('V2_VISUELS_HMAC introuvable');
}
const sha256Fichier = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** Ouvre l'index, l'archive et la garde des zones ; rend { decider(emb, carteJpegBase64), gel }. `gel` : les empreintes de tout ce que la decision a lu (a noter dans le rapport). */
async function creerDecideur({ delaiMs = DELAI_MS } = {}) {
    const HMAC = secret();
    const S = rq('v2/chargeur/scellement'), F = rq('v2/chargeur/format'), X = rq('v2/identifier/index-empreintes'), EV = rq('v2/identifier/empreinte-vecteur'), VE = rq('v2/identifier/voisins-empreinte');
    const G = rq('ratmarket/decision-g'), etatVersion = rq('v2/chargeur/etat'), zones = rq('ratmarket/zones');
    const o = X.ouvrir(fs.readFileSync(INDEX), HMAC, { modeleAttendu: MODELE });
    const version = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(ARCHIVE), HMAC)));
    etatVersion.installer(Object.isFrozen(version) ? version : Object.freeze(version));
    const manque = { scans: 0, cles: new Set() }, lus = new Set();
    // les scans : le disque d'abord ; puis, SEULEMENT pour les cles absentes, la copie locale recuperee de NOTRE archive R2 en lecture seule (recuperer-scans.mjs) ; sinon la cle est comptee manquante
    const REPLI = process.env.RM_SCANS_REPLI || null;
    const scan = async cle => {
        const nom = crypto.createHash('sha1').update(cle).digest('hex') + '.webp';
        for (const f of [path.join(IMAGES, nom), REPLI ? path.join(REPLI, nom) : null]) {
            if (!f) continue;
            try { const b = fs.readFileSync(f); lus.add(cle); return b; } catch { /* suivant */ }
        }
        manque.scans++; manque.cles.add(cle); return null;
    };
    const etat = { courante: () => ({ index: o.index, meta: { modele: MODELE } }) };
    // la garde des zones, suivie : une exception d'OpenCV ou une mesure invalide est NOTEE (cause de « muette ») ; le fournisseur de production les avale (catch -> echec 'muette')
    const suivi = { exceptions: [] };
    const zonesSuivies = {};
    for (const nom of ['photoGrise', 'comparerPaire', 'scoresZones']) {
        zonesSuivies[nom] = async (...a) => { try { return await zones[nom](...a); } catch (e) { suivi.exceptions.push(`${nom}:${String((e && (e.message || e.name)) || e).slice(0, 80)}`); throw e; } };
    }
    const RG = rq('v2/identifier/regle-g');
    const fournisseur = VE.creerFournisseurEmpreinte({ cfg: { modeleEmpreinte: MODELE }, etat, zones: zonesSuivies, scan, delaiMs, budget: 10, fileMax: 3 });
    const gel = { index: INDEX, indexSha256: sha256Fichier(INDEX), archive: ARCHIVE, archiveSha256: sha256Fichier(ARCHIVE), modele: MODELE, seuilsG: G.SEUILS_G, delaiZonesMs: delaiMs, budgetMesures: 10, versionDetection: null };
    async function decider(emb, carteJpegBase64) {
        const vecteur = EV.encoderVecteur(Float32Array.from(emb));
        const entree = { empreintes: { modele: MODELE, rejet: null, entrees: [{ photo: 0, vecteur, redressee: true, carte: carteJpegBase64 }] } };
        suivi.exceptions.length = 0; const manquesAvant = manque.cles.size, t0 = Date.now();
        const r = await fournisseur({ entree, scanId: 'coherence' });
        if (!r.ok) {
            // la CAUSE de « muette » : scan manquant (cle nommee), exception (nommee), delai de la garde, ou le code ferme du fournisseur (budget, file, carte invalide)
            const cle = manque.cles.size > manquesAvant ? [...manque.cles].pop() : null;
            const cause = suivi.exceptions.length ? 'exception:' + suivi.exceptions[0] : cle ? 'scan-manquant:' + cle : (r.code === 'indisponible' && Date.now() - t0 >= delaiMs * 0.95) ? 'delai' : `${r.code}${r.raison ? ':' + r.raison : ''}:sans-cause-observee`;
            return { decision: { muette: r.code + (r.raison ? ':' + r.raison : '') }, production: { muette: r.code + (r.raison ? ':' + r.raison : '') }, cause, top: null, nMesures: 0 };
        }
        const d = G.decider(r.contexteG, r.ligne, r.nEssais, r.mesures, r.seuils);          // sortie BRUTE de G (annexe)
        // LA DECISION DE PRODUCTION : decisionRegleG (importee), appelee comme la route (routes.js:323) : produit affirme avec partenaires de reimpression -> question ; plus de 3 candidats -> null (la chaine decide)
        let production; try { production = RG.decisionRegleG({ ligne: r.ligne, nEssais: r.nEssais, mesures: r.mesures, contexteG: r.contexteG }, r.seuils); } catch (e) { production = { muette: 'regle-g-exception:' + String((e && e.message) || e).slice(0, 80) }; }
        return { decision: d, production, cause: null, top: r.ligne.top.slice(0, 3).map(([k, s]) => [k, Math.round(s * 1e4) / 1e4]), nMesures: r.nMesures, meilleurCosinus: r.meilleurCosinus };
    }
    return { decider, gel, manque, lus, G };
}

module.exports = { creerDecideur, MODELE, INDEX, ARCHIVE };
