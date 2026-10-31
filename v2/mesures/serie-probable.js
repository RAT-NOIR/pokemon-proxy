'use strict';
// SERIE-PROBABLE (31/10, ordre n°12 de l'éditeur) — les pièces PURES du client de série en mode `--g-probable` (serie-essai.js les appelle ; elles n'ouvrent aucune connexion) :
//   · classerCarte / jugerVerdict : le JUGE par verdict, contre la vérité du banc au moment où le verdict arrive : sûr juste / sûr FAUX / probable juste / probable FAUX / question (vérité dans les candidats ou non) ;
//   · declarationDe : ce que le client déclarerait comme l'extension le ferait (confirmation d'un probable juste, la vérité si elle est parmi les candidats, « aucune » sinon) ;
//   · produireMesures : les mesures de la demande du serveur, calculées par les FONCTIONS DE PRODUCTION (ratmarket/zones.js, v2/identifier/carte-redressee.js — celles de extraire-mesures-groupe.js et
//     de mesurer-probable-production.js), puis jugées par le validateur de la PRODUCTION (calcul-client.js::validerResultats) AVANT tout envoi : une règle recopiée ici serait un défaut ;
//   · rapportSerie : les compteurs, la réponse directe juste par famille, p50 / p95 du premier verdict et du total ; le dénominateur est imprimé avec chaque pourcentage ;
//   · codeSortie : 10 = probable FAUX, 11 = sûr FAUX (la série s'arrête avant le scan suivant), 1 = autre arrêt, 0 = rien.
// Écrit par ce qu'il AUTORISE : tout ce que ce module ne reconnaît pas est « inconnu » et ne déclenche ni déclaration ni arrêt.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const VERSION_PROBABLE = '2.0.1';                          // probable.js::VERSION_MIN_PROBABLE : le niveau « probable » n'est servi qu'à partir de cette version de l'extension
const CODE_PROBABLE_FAUX = 10, CODE_SUR_FAUX = 11;
const FAMILLES = Object.freeze(['reglage', 'tamponnee', 'ordinaire']);

/** Une carte de l'analyse servie (ou du second envoi) → { niveau: 'sur'|'probable'|'question'|'introuvable'|'inconnu', produit, candidats: [idProduct], choix: [{id, idProduct}] }. */
function classerCarte(c) {
    const vide = niveau => ({ niveau, produit: null, candidats: [], choix: [] });
    if (!c || typeof c !== 'object') return vide('inconnu');
    if (c.statut === 'identifiee') return c.carte && Number.isInteger(c.carte.idProduct) ? { niveau: 'sur', produit: c.carte.idProduct, candidats: [], choix: [] } : vide('inconnu');
    if (c.statut === 'introuvable') return vide('introuvable');
    if (c.statut !== 'a-trancher') return vide('inconnu');
    const candidats = (Array.isArray(c.candidats) ? c.candidats : []).map(x => x && x.idProduct).filter(Number.isInteger);
    const choix = (c.question && Array.isArray(c.question.choix) ? c.question.choix : []).filter(x => x && typeof x.id === 'string' && Number.isInteger(x.idProduct)).map(x => ({ id: x.id, idProduct: x.idProduct }));
    if (c.niveau === 'probable' && c.probable && Number.isInteger(c.probable.idProduct)) return { niveau: 'probable', produit: c.probable.idProduct, candidats, choix };
    return { niveau: 'question', produit: null, candidats, choix };
}

/** Le verdict de la ligne face à sa vérité. Une vérité absente (null / undefined) ne juge rien : « sans-verite ». Toute autre vérité (même non numérique) est comparée telle quelle, comme serie-essai.js::comparer. */
function jugerVerdict(classe, verite) {
    const base = { niveau: classe.niveau, produit: classe.produit };
    if (verite === null || verite === undefined) return { ...base, verdict: 'sans-verite' };
    if (classe.niveau === 'sur') return { ...base, verdict: classe.produit === verite ? 'sur-juste' : 'sur-faux' };
    if (classe.niveau === 'probable') return { ...base, verdict: classe.produit === verite ? 'probable-juste' : 'probable-faux' };
    if (classe.niveau === 'question') return { ...base, verdict: classe.candidats.includes(verite) ? 'question-dans-candidats' : 'question-hors-candidats' };
    if (classe.niveau === 'introuvable') return { ...base, verdict: 'introuvable' };
    return { ...base, verdict: 'inconnu' };
}
const fautif = verdict => verdict === 'sur-faux' || verdict === 'probable-faux';

/** La déclaration du client : { choix, motif } ou null. Jamais une déclaration sans vérité, ni pour un sûr ou un introuvable. */
function declarationDe(classe, verdict, verite) {
    const lettre = id => { const c = classe.choix.find(x => x.idProduct === id); return c ? c.id : null; };
    if (verdict === 'probable-juste') { const l = lettre(classe.produit); return l ? { choix: l, motif: 'confirmation' } : null; }
    if (verdict === 'probable-faux') return { choix: 'aucune', motif: 'probable-faux' };
    if (verdict === 'question-dans-candidats') { const l = lettre(verite); return l ? { choix: l, motif: 'verite' } : null; }
    if (verdict === 'question-hors-candidats') return { choix: 'aucune', motif: 'hors-candidats' };
    return null;
}

/** reglage = le banc de réglage ; tamponnee = une ligne du relevé des tampons ; ordinaire = le reste (la règle d'extraire-mesures-groupe.js, appliquée à toute ligne hors réglage). */
const familleDe = (ligne, releve) => (ligne.banc === 'reglage' ? 'reglage' : releve && releve.has(ligne.cle) ? 'tamponnee' : 'ordinaire');

/** Le lecteur des visuels de référence : <sha1 de la clé>.webp dans les dossiers donnés (l'organisation des dossiers d'archive de extraire-mesures-groupe.js). Lecture seule. null si absent partout. */
function lecteurDeReferences(dossiers) {
    return ref => {
        const nom = crypto.createHash('sha1').update(String(ref)).digest('hex') + '.webp';
        for (const d of dossiers) { const p = path.join(d, nom); if (fs.existsSync(p)) return fs.readFileSync(p); }
        return null;
    };
}

// ── LES RÉFÉRENCES, TÉLÉCHARGÉES COMME L'EXTENSION (extension v2, src/fond/references.js) ──
// Ce que le client AUTORISE, par ce qu'il autorise : GET seulement, https, l'hôte R2 PUBLIC exact, le chemin EXACT de la clé demandée (encodée segment par segment, comme config/urlDe du serveur),
// sans identifiant, sans port, sans requête ni fragment, AUCUN en-tête (l'extension n'en envoie aucun : `credentials: 'omit'`, la permission d'hôte dispense du CORS), redirection non suivie, délai de 8 s,
// type `image/*`, 4 Mio au plus (REFERENCE_OCTETS_MAX de l'extension), en-tête RIFF/WEBP, sha256 vérifié s'il est servi.
const HOTE_REFERENCES = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev';       // extension v2 src/fond/references.js::HOTE_R2_PUBLIC ; serveur v2/config.js images.hotesPublics[0]
const REFERENCE_OCTETS_MAX = 4194304, DELAI_REFERENCE_MS = 8000;

/** L'adresse d'une référence est-elle admise ? Pure. L'adresse ATTENDUE est reconstruite depuis la clé : l'adresse servie doit lui être identique (hôte exact + chemin exact). */
function adresseReferenceAdmise(url, ref, hote = HOTE_REFERENCES) {
    if (typeof url !== 'string' || typeof ref !== 'string' || url.length === 0 || url.length > 2048 || /[\\\s\u0000-\u001f\u007f]/.test(url)) return false;
    let u; try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.origin !== hote || u.username || u.password || u.port || u.search || u.hash) return false;
    return u.pathname === '/' + ref.split('/').map(encodeURIComponent).join('/');
}
/** Un fichier WebP lisible ? (RIFF....WEBP, au moins 12 octets, jamais au-delà du plafond) — la règle de references.js::estWebp. */
function estWebp(octets) {
    const b = octets;
    if (!(b instanceof Uint8Array) || b.length < 12 || b.length > REFERENCE_OCTETS_MAX) return false;
    return b.subarray(0, 4).toString() === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString() === 'WEBP';
}
/** Télécharge UNE référence. @returns {{ok: true, octets: Buffer} | {ok: false, raison: 'adresse'|'reseau'|'redirection'|'introuvable'|'http'|'type'|'taille'|'webp'|'sha256'}} ne lève jamais. */
async function telechargerReference({ url, ref, sha256 = null, fetchFn, delaiMs = DELAI_REFERENCE_MS, hote = HOTE_REFERENCES }) {
    if (!adresseReferenceAdmise(url, ref, hote)) return { ok: false, raison: 'adresse' };
    let r;
    try { r = await fetchFn(url, { method: 'GET', headers: {}, redirect: 'manual', signal: AbortSignal.timeout(delaiMs) }); } catch { return { ok: false, raison: 'reseau' }; }
    if (!r) return { ok: false, raison: 'reseau' };
    if (r.status >= 300 && r.status < 400) return { ok: false, raison: 'redirection' };
    if (r.status === 404) return { ok: false, raison: 'introuvable' };
    if (r.status !== 200) return { ok: false, raison: 'http' };
    const ent = n => (r.headers && typeof r.headers.get === 'function' ? r.headers.get(n) : null);
    if (!/^image\//i.test(String(ent('content-type') || ''))) return { ok: false, raison: 'type' };
    const annonce = Number(ent('content-length'));
    if (ent('content-length') !== null && Number.isFinite(annonce) && annonce > REFERENCE_OCTETS_MAX) return { ok: false, raison: 'taille' };
    let octets;
    try {
        if (r.body && typeof r.body.getReader === 'function') {
            const l = r.body.getReader(), morceaux = []; let total = 0;
            for (;;) { const { done, value } = await l.read(); if (done) break; total += value.byteLength; if (total > REFERENCE_OCTETS_MAX) { try { await l.cancel(); } catch { /* fermé */ } return { ok: false, raison: 'taille' }; } morceaux.push(Buffer.from(value)); }
            octets = Buffer.concat(morceaux);
        } else { octets = Buffer.from(await r.arrayBuffer()); }
    } catch { return { ok: false, raison: 'reseau' }; }
    if (octets.length > REFERENCE_OCTETS_MAX) return { ok: false, raison: 'taille' };
    if (sha256 && crypto.createHash('sha256').update(octets).digest('hex') !== sha256) return { ok: false, raison: 'sha256' };
    if (!estWebp(octets)) return { ok: false, raison: 'webp' };
    return { ok: true, octets };
}
/**
 * Le lecteur de références d'un complément : le cache LOCAL d'abord (raccourci facultatif, jamais une condition), puis l'hôte public (adresse donnée par le serveur dans `references`, jugée par adresseReferenceAdmise).
 * `cache` : Map url -> octets, partagée pour la série (une référence n'est téléchargée qu'une fois). Rend des octets, ou { erreur: '<raison>' } (jamais null : « absente en local » n'est pas « introuvable »).
 */
function lecteurDeReferencesComplet({ local = null, references, fetchFn, cache = new Map(), delaiMs = DELAI_REFERENCE_MS }) {
    return async ref => {
        if (local) { const b = await local(ref); if (b) return b; }
        const e = (Array.isArray(references) ? references : []).find(x => x && x.ref === ref);
        if (!e) return { erreur: 'reference-absente' };
        if (typeof e.url === 'string' && cache.has(e.url)) return cache.get(e.url);
        const t = await telechargerReference({ url: e.url, ref, sha256: typeof e.sha256 === 'string' ? e.sha256 : null, fetchFn, delaiMs });
        if (t.ok) { cache.set(e.url, t.octets); return t.octets; }
        return { erreur: t.raison === 'introuvable' ? 'reference-introuvable-hote' : `reference-hote-${t.raison}` };
    };
}

/** Les capacités que le /ping doit lister AVANT le premier scan (la liste servie par l'essai le 31/10) ; deux /ping complets espacés d'au moins 10 s. */
const CAPACITES_ATTENDUES = Object.freeze(['langue-impression', 'marques', 'prix-incertains', 'prix-repli', 'achete-avant-jour', 'empreinte', 'mesures-client', 'probable']);
const pingComplet = p => Boolean(p && p.statut === 200 && p.corps && typeof p.corps.versionMinExtension === 'string' && Array.isArray(p.corps.capacites) && CAPACITES_ATTENDUES.every(c => p.corps.capacites.includes(c)));

/**
 * Les mesures de la demande, par les fonctions de production. `zones` = ratmarket/zones.js, `carteRedressee` = v2/identifier/carte-redressee.js, `validerResultats` = calcul-client.js.
 * @returns {{ok: true, resultats} | {ok: false, raison}} ne lève jamais ; la photo grise est TOUJOURS libérée.
 */
async function produireMesures({ demande, carteB64, lireReference, zones, carteRedressee, validerResultats }) {
    if (!Array.isArray(demande) || demande.length === 0) return { ok: false, raison: 'demande-vide' };
    let photo = null;
    try {
        const cr = await carteRedressee.valider(carteB64);
        if (!cr || !cr.ok) return { ok: false, raison: `carte-${(cr && cr.code) || 'invalide'}` };
        photo = await zones.photoGrise(cr.data, cr.width, cr.height);
        const resultats = [];
        for (const m of demande) {
            if (m.type === 'paire') {
                const sa = await lireReference(m.a), sb = sa && !sa.erreur ? await lireReference(m.b) : null;
                if (sa && sa.erreur) return { ok: false, raison: sa.erreur };
                if (sb && sb.erreur) return { ok: false, raison: sb.erreur };
                if (!sa || !sb) return { ok: false, raison: 'reference-absente' };
                const [ecart, couverture] = await zones.comparerPaire(photo, { cle: m.a, octets: sa }, { cle: m.b, octets: sb });
                resultats.push({ type: 'paire', a: m.a, b: m.b, ecart, couverture });
            } else if (m.type === 'zones') {
                const sa = await lireReference(m.ref);
                if (sa && sa.erreur) return { ok: false, raison: sa.erreur };
                if (!sa) return { ok: false, raison: 'reference-absente' };
                const z = await zones.scoresZones(photo, { cle: m.ref, octets: sa });
                resultats.push({ type: 'zones', ref: m.ref, haut: z.haut, illustration: z.illustration, bandeau: z.bandeau, texte: z.texte, bas: z.bas, inliers: z.inliers });
            } else return { ok: false, raison: 'mesure-inconnue' };
        }
        const v = validerResultats(demande, resultats);
        if (!v.ok) return { ok: false, raison: `invalide-${v.code}` };
        return { ok: true, resultats };
    } catch (e) { return { ok: false, raison: `calcul-${(e && (e.code || e.name)) || 'erreur'}` }; }
    finally { if (photo && typeof photo.delete === 'function') { try { photo.delete(); } catch { /* libérée */ } } }
}

const pct = (n, d) => (d > 0 ? Math.round(n / d * 1000) / 10 : null);
const compteurs = () => ({ lignes: 0, avecVerite: 0, surJuste: 0, surFaux: 0, probableJuste: 0, probableFaux: 0, questionDansCandidats: 0, questionHorsCandidats: 0, introuvable: 0, inconnu: 0, sansVerite: 0, reponseDirecteJuste: null });
const CLE_VERDICT = Object.freeze({ 'sur-juste': 'surJuste', 'sur-faux': 'surFaux', 'probable-juste': 'probableJuste', 'probable-faux': 'probableFaux', 'question-dans-candidats': 'questionDansCandidats', 'question-hors-candidats': 'questionHorsCandidats', introuvable: 'introuvable', 'sans-verite': 'sansVerite', inconnu: 'inconnu' });
/**
 * Le rapport de la série. `lignes` : { famille, verdict, avecVerite, premierMs, ms }. `statistiques` : la fonction de serie-essai.js (n, p50, p95 au rang supérieur) — passée en argument pour ne pas recopier le quantile.
 * « Réponse directe juste » = (sûrs justes + probables justes) / lignes à vérité, en %, avec son dénominateur ; null quand le dénominateur est nul (jamais 0 % inventé).
 */
function rapportSerie(lignes, { statistiques }) {
    const R = { total: compteurs(), reglage: compteurs(), tamponnee: compteurs(), ordinaire: compteurs() };
    for (const l of lignes) {
        for (const c of [R.total, R[FAMILLES.includes(l.famille) ? l.famille : 'ordinaire']]) {
            c.lignes++;
            if (l.avecVerite) c.avecVerite++;
            const k = CLE_VERDICT[l.verdict] || 'inconnu'; c[k]++;
        }
    }
    for (const c of Object.values(R)) c.reponseDirecteJuste = pct(c.surJuste + c.probableJuste, c.avecVerite);
    // l'EXERCICE du choix de groupe : combien de questions, de compléments, de seconds envois faits, de change:true, et pourquoi les autres n'ont pas eu lieu
    const second = { questions: 0, complements: 0, envoyes: 0, changeTrue: 0, nonEnvoyes: { 'reference-introuvable-hote': 0, 'carte-absente': 0, autre: 0 } };
    for (const l of lignes) {
        if (l.premierNiveau !== 'question') continue;
        second.questions++;
        if (l.complementRecu) second.complements++;
        const e = l.secondEnvoi;
        if (e && e.envoye === true) { second.envoyes++; if (e.change === true) second.changeTrue++; }
        else if (e && e.envoye === false) second.nonEnvoyes[e.raison === 'reference-introuvable-hote' || e.raison === 'carte-absente' ? e.raison : 'autre']++;
    }
    return { ...R, second, premierVerdict: statistiques(lignes.filter(l => Number.isFinite(l.premierMs)).map(l => l.premierMs)), dureeTotale: statistiques(lignes.filter(l => Number.isFinite(l.ms)).map(l => l.ms)) };
}

/** Le code de sortie du processus. */
const CODE_SANS_COMPLEMENT = 12;
const codeSortie = r => (r && r.fautif ? (r.fautif.type === 'probable-faux' ? CODE_PROBABLE_FAUX : CODE_SUR_FAUX) : r && r.alerte ? CODE_SANS_COMPLEMENT : r && r.arret ? 1 : 0);

module.exports = { classerCarte, jugerVerdict, fautif, declarationDe, familleDe, lecteurDeReferences, produireMesures, rapportSerie, codeSortie, VERSION_PROBABLE, CODE_PROBABLE_FAUX, CODE_SUR_FAUX, CODE_SANS_COMPLEMENT, FAMILLES, HOTE_REFERENCES, REFERENCE_OCTETS_MAX, DELAI_REFERENCE_MS, adresseReferenceAdmise, estWebp, telechargerReference, lecteurDeReferencesComplet, CAPACITES_ATTENDUES, pingComplet };
