// ============================================================
// LE CHOIX DU MOTEUR D'INFERENCE (lot W) : WebGPU avec repli WASM, auto-verification, verdict note — logique pure, injectable, sans DOM
// ============================================================
// Decision de l'editeur (27/10) : WebGPU OUI, avec repli WASM automatique ; auto-verification au premier chargement sur chaque machine ; si elle s'ecarte : WASM, et on le note.
// Regles (rulings du coordinateur) :
//   · WebGPU si `navigator.gpu` donne un adaptateur ET que l'auto-verification passe ; sinon WASM (4 fils, lot E2). Toute attente WebGPU est BORNEE : adaptateur 2 s,
//     creation de session 20 s (E2 a vu un blocage de 280 s sans adaptateur), puis WASM.
//   · Le premier verdict n'attend JAMAIS l'auto-verification : `session()` rend la session WASM tant qu'aucun verdict a jour ne dit « WebGPU » ; `verifier()` tourne ensuite, en tache de fond.
//   · « Vecteur attendu » = le vecteur WASM de la MEME image de reference sur la MEME machine : l'auto-verification vaut ainsi pour tout modele annonce. Tolerance du contrat : cosinus >= 0,998.
//   · Le verdict { moteur, adaptateur (vendor / architecture seulement), modeleSha, version, cosinus, le, raison } est RENDU par `surVerdict` ; le rangement (storage.local) est l'affaire du fond.
//     Refait si l'adaptateur, le modele ou la version de l'extension change. Rien n'est envoye au serveur.
export const COSINUS_MIN = 0.998;
export const ADAPTATEUR_MS = 2000;
export const SESSION_GPU_MS = 20000;
export const VERDICT_VIE_MS = 30 * 24 * 3600 * 1000; // un verdict de plus de 30 jours est refait (un echec transitoire ne fige pas une machine sur WASM)

const FORME_SHA = /^[0-9a-f]{64}$/;
const MOTEURS = ['wasm', 'webgpu'];
const propre = (x) => String(x ?? '').replace(/[^\w .:-]/g, '').slice(0, 64);

/** Le cosinus de deux vecteurs ; 0 pour des longueurs differentes ou une norme nulle. */
export function cosinus(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let p = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { p += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x > 0 && y > 0 ? p / Math.sqrt(x * y) : 0;
}

const horlogeParDefaut = { armer: (f, ms) => setTimeout(f, ms), couper: (h) => clearTimeout(h) };
/** Une course contre la montre : { ok, valeur } | { erreur } | { depasse: true }. Ne rejette jamais. */
export function course(promesse, ms, { armer, couper } = horlogeParDefaut) {
  return new Promise((resoudre) => {
    const h = armer(() => resoudre({ depasse: true }), ms);
    Promise.resolve(promesse).then((valeur) => { couper(h); resoudre({ ok: true, valeur }); }, (erreur) => { couper(h); resoudre({ erreur }); });
  });
}

/** L'adaptateur WebGPU, borne a 2 s : { ok: true, adaptateur: { vendor, architecture } } | { ok: false, raison }. Rien d'autre de l'adaptateur n'est lu ni garde. */
export async function sonderAdaptateur(gpu, { armer, couper, ms = ADAPTATEUR_MS } = horlogeParDefaut) {
  if (!gpu || typeof gpu.requestAdapter !== 'function') return { ok: false, raison: 'sans-gpu' };
  let demande;
  try { demande = gpu.requestAdapter(); } catch { return { ok: false, raison: 'erreur' }; }
  const r = await course(demande, ms, { armer, couper });
  if (r.depasse) return { ok: false, raison: 'adaptateur-muet' };
  if (!r.ok) return { ok: false, raison: 'erreur' };
  const a = r.valeur;
  if (!a) return { ok: false, raison: 'sans-adaptateur' };
  let info = a.info;
  if (!info && typeof a.requestAdapterInfo === 'function') { const i = await course(a.requestAdapterInfo(), ms, { armer, couper }); info = i.ok ? i.valeur : null; }
  return { ok: true, adaptateur: { vendor: propre(info && info.vendor), architecture: propre(info && info.architecture) } };
}

/** Une session WebGPU (avec repli des noeuds non pris en charge sur WASM), creation bornee a 20 s : { ok: true, session } | { ok: false, raison: 'session-gpu' }. Une session qui arrive apres le delai est liberee. */
export async function creerSessionGpu({ ort, tampon, ms = SESSION_GPU_MS }, { armer, couper } = horlogeParDefaut) {
  let creation;
  try { creation = Promise.resolve().then(async () => ort.InferenceSession.create(new Uint8Array(await tampon()), { executionProviders: ['webgpu', 'wasm'], graphOptimizationLevel: 'all' })); } catch { return { ok: false, raison: 'session-gpu' }; }
  const r = await course(creation, ms, { armer, couper });
  if (r.ok && r.valeur) return { ok: true, session: r.valeur };
  if (r.depasse) creation.then((s) => { try { if (s && s.release) Promise.resolve(s.release()).catch(() => {}); } catch { /* deja liberee */ } }, () => {});
  return { ok: false, raison: 'session-gpu' };
}

const memeAdaptateur = (a, b) => (!a && !b) || (a && b && a.vendor === b.vendor && a.architecture === b.architecture);

/** Le verdict nettoye (les seuls champs prevus), ou null. */
export function formeVerdict(v) {
  if (!v || typeof v !== 'object' || !MOTEURS.includes(v.moteur) || typeof v.modeleSha !== 'string' || !FORME_SHA.test(v.modeleSha)) return null;
  if (typeof v.version !== 'string' || v.version.length < 1 || v.version.length > 32) return null;
  if (!Number.isFinite(v.le)) return null;
  if (v.cosinus !== null && v.cosinus !== undefined && !Number.isFinite(v.cosinus)) return null;
  let adaptateur = null;
  if (v.adaptateur) { if (typeof v.adaptateur !== 'object') return null; adaptateur = { vendor: propre(v.adaptateur.vendor), architecture: propre(v.adaptateur.architecture) }; }
  return { moteur: v.moteur, adaptateur, modeleSha: v.modeleSha, version: v.version, cosinus: v.cosinus ?? null, le: v.le, raison: propre(v.raison || 'ok').replace(/ /g, '') || 'ok' };
}

/** Le verdict tient-il encore ? Meme adaptateur (ou aucun), meme modele, meme version de l'extension, et pas trop vieux (si `maintenant` est donne). */
export function verdictAJour(verdict, { adaptateur, modeleSha, version, maintenant = null }) {
  const v = formeVerdict(verdict);
  if (!v) return false;
  if (v.modeleSha !== modeleSha || v.version !== version || !memeAdaptateur(v.adaptateur, adaptateur || null)) return false;
  if (maintenant !== null && Math.abs(maintenant - v.le) > VERDICT_VIE_MS) return false;
  return true;
}

/**
 * Le gestionnaire des sessions d'un Worker. Dependances (toutes injectables) :
 *   gpu          : navigator.gpu ou absent ; ort : onnxruntime-web ; tampon() : (async) les octets du modele (verifies par l'appelant) ; modeleSha, version : ce que le verdict doit nommer ;
 *   tenseurRef   : le tenseur de l'image de reference ; executer(session, tenseur) -> les 256 composantes brutes ; verdictConnu : le dernier verdict range (ou null) ;
 *   surVerdict   : appele a chaque NOUVEAU verdict ; verrou(f) : serialise l'usage des sessions avec les demandes (defaut : aucun) ; apresCreation(session) : controle d'une session WASM neuve.
 * session() : { session, moteur } — jamais en attente de l'auto-verification. verifier() : l'auto-verification, en tache de fond (a appeler apres la premiere reponse).
 */
export function creerMoteurs({ gpu, ort, tampon, modeleSha, version, tenseurRef, verdictConnu = null, ortGpu = null, surSession = () => {}, referenceEmbarquee = null, surEcartReference = () => {}, executer, surVerdict = () => {}, verrou = (f) => f(), apresCreation = null, maintenant = () => Date.now(), armer, couper }) {
  const horloge = { armer: armer || horlogeParDefaut.armer, couper: couper || horlogeParDefaut.couper };
  const laRef = () => (typeof tenseurRef === 'function' ? tenseurRef() : tenseurRef); // le tenseur de la reference n'est calcule que si l'auto-verification en a besoin (mesure : ~30 ms de CPU au depart d'un document froid)
  let actif = null;
  let creation = null;
  let courant = formeVerdict(verdictConnu); // le dernier verdict connu (range ou emis ici)
  let verifie = false;
  let clos = false;   // fermer() a ete appele (le modele a change) : une verification en cours ne bascule ni n'emet plus rien
  let sondeAdaptateur = null; // la sonde du dernier passage (une seule par Worker)

  const liberer = (s) => { try { if (s && s.release) Promise.resolve(s.release()).catch(() => {}); } catch { /* deja liberee */ } };
  const emettre = (moteur, adaptateur, raison, cos = null) => {
    courant = formeVerdict({ moteur, adaptateur, modeleSha, version, cosinus: cos, le: maintenant(), raison });
    try { surVerdict(courant); } catch { /* le rangement est l'affaire de l'appelant */ }
  };
  const sonder = () => (sondeAdaptateur ??= sonderAdaptateur(gpu, horloge));
  const creerWasm = async () => {
    const s = await ort.InferenceSession.create(new Uint8Array(await tampon()), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    try { surSession(s, 'wasm'); } catch { /* sans effet */ }
    if (apresCreation) await apresCreation(s);
    return s;
  };

  // WASM d'abord, TOUJOURS : le premier verdict n'attend ni la sonde de l'adaptateur, ni la creation d'une session WebGPU, ni l'auto-verification (mesure : un document froid a chaque scan paie +300 ms a +3 s
  // s'il attend le GPU). WebGPU prend le relais en tache de fond (verifier), sur un verdict a jour ou une auto-verification reussie.
  async function demarrer() {
    actif = { session: await creerWasm(), moteur: 'wasm' };
    return actif;
  }
  const session = () => {
    if (actif) return Promise.resolve(actif);
    if (!creation) creation = demarrer().finally(() => { creation = null; });
    return creation;
  };
  // Une session WebGPU (module WebGPU charge a la demande : ortGpu) ; { ok, session } | { ok: false, raison }
  const sessionGpu = async () => {
    let module;
    try { module = ortGpu ? await ortGpu() : ort; } catch { return { ok: false, raison: 'session-gpu' }; }
    const g = await creerSessionGpu({ ort: module, tampon }, horloge);
    if (g.ok) { try { surSession(g.session, 'webgpu'); } catch { /* sans effet */ } }
    return g;
  };
  const basculer = (s) => verrou(async () => { const ancien = actif; actif = { session: s, moteur: 'webgpu' }; if (ancien) liberer(ancien.session); });

  async function verifier() {
    if (verifie) return;
    verifie = true;
    await session();
    const sonde = await sonder();
    const adaptateur = sonde.ok ? sonde.adaptateur : null;
    if (courant && verdictAJour(courant, { adaptateur, modeleSha, version, maintenant: maintenant() })) {
      if (courant.moteur !== 'webgpu') return;
      // un verdict a jour dit « WebGPU » : bascule sans refaire l'auto-verification (adaptateur, modele et version sont ceux qui l'ont passee) ; un echec corrige le verdict
      const g = await sessionGpu();
      if (clos) { if (g.ok) liberer(g.session); return; }
      if (!g.ok) { emettre('wasm', adaptateur, g.raison); return; }
      await basculer(g.session);
      return;
    }
    if (!sonde.ok) { emettre('wasm', null, sonde.raison); return; }
    const g = await sessionGpu();
    if (clos) { if (g.ok) liberer(g.session); return; }
    if (!g.ok) { emettre('wasm', adaptateur, g.raison); return; }
    try {
      const rG = await course(executer(g.session, laRef()), SESSION_GPU_MS, horloge); // la 1re inference WebGPU (shaders compris) est BORNEE comme la session
      if (!rG.ok) throw new Error('inference WebGPU');
      const vG = rG.valeur;                                     // la session WebGPU est a part : pas de verrou (la compilation des shaders ne bloque pas un scan)
      const vW = await verrou(() => executer(actif.session, laRef()));                    // la session WASM sert aux scans : serialisee avec eux
      if (referenceEmbarquee) { // le WASM lui-meme contre le vecteur embarque (p8000, chaine de l'API) : un ecart = ni WASM ni WebGPU ne sont dignes de confiance, aucun vecteur
        const cr = cosinus(vW, referenceEmbarquee);
        if (cr < COSINUS_MIN) { liberer(g.session); emettre('wasm', adaptateur, 'wasm-ecart', cr); try { surEcartReference(cr); } catch { /* sans effet */ } return; }
      }
      if (clos) { liberer(g.session); return; }
      const cos = cosinus(vW, vG);
      if (cos >= COSINUS_MIN) { await basculer(g.session); emettre('webgpu', adaptateur, 'ok', cos); }
      else { liberer(g.session); emettre('wasm', adaptateur, 'ecart', cos); }
    } catch { liberer(g.session); emettre('wasm', adaptateur, 'session-gpu'); }
  }
  // fermer() : le modele change, les sessions sont liberees (le gestionnaire est jete par l'appelant)
  const fermer = () => { clos = true; if (actif) liberer(actif.session); actif = null; creation = null; };
  return { session, verifier, fermer, moteur: () => (actif ? actif.moteur : null), verdict: () => courant };
}
