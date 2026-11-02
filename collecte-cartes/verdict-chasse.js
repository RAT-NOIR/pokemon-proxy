'use strict';
// Verdict de chasse : méthode des 8 requêtes rendue obligatoire (testeur, 02/11 nuit).
// Pur, aucune base, aucun réseau. Écrit par ce qu'il AUTORISE : tout ce qui n'est pas
// explicitement accepté est refusé avec un motif nommé.

const LANGUES = ['en', 'ja', 'zh-hans', 'zh-hant', 'id', 'th', 'ko', 'fr', 'de', 'es', 'it', 'pt'];
const MIN_REQUETES = 8;
const MIN_LANGUES = 3;

const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const estObjet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function jugerIntrouvable(e) {
  const motifs = [];
  const requetes = Array.isArray(e.requetes) ? e.requetes : [];
  const textes = new Set();
  const langues = new Set();
  let vides = 0, horsListe = 0, doublons = 0;
  for (const q of requetes) {
    const texte = estObjet(q) && typeof q.texte === 'string' ? norm(q.texte) : '';
    if (!texte) { vides++; continue; }
    if (!estObjet(q) || typeof q.langue !== 'string' || !LANGUES.includes(q.langue)) { horsListe++; continue; }
    if (textes.has(texte)) { doublons++; continue; }
    textes.add(texte);
    langues.add(q.langue);
  }
  if (vides) motifs.push(vides + ' requête vide');
  if (horsListe) motifs.push(horsListe + ' langue hors liste (' + LANGUES.join(', ') + ')');
  if (doublons) motifs.push(doublons + ' requêtes en double');
  if (textes.size < MIN_REQUETES) motifs.push(textes.size + ' requêtes / ' + MIN_REQUETES);
  if (langues.size < MIN_LANGUES) motifs.push(langues.size + ' langues / ' + MIN_LANGUES);
  return motifs;
}

function juger(e) {
  if (!estObjet(e)) return { code: null, accepte: false, motifs: ['extension mal formée'] };
  const motifs = [];
  if (typeof e.code !== 'string' || !e.code.trim()) motifs.push('code manquant');
  if (e.verdict === 'introuvable') motifs.push(...jugerIntrouvable(e));
  else if (e.verdict === 'trouve') {
    const s = Array.isArray(e.sources) ? e.sources.filter((x) => x !== null && x !== undefined && String(typeof x === 'string' ? x : JSON.stringify(x)).trim()) : [];
    if (!s.length) motifs.push('trouvé sans source');
  } else motifs.push('verdict inconnu (' + String(e.verdict) + ')');
  return { code: typeof e.code === 'string' ? e.code : null, accepte: motifs.length === 0, motifs };
}

function jugerFichier(f) {
  if (!estObjet(f) || !Array.isArray(f.extensions) || !f.extensions.length) {
    return { accepte: false, total: 0, acceptes: 0, motifs: ['fichier sans extensions'], resultats: [] };
  }
  const resultats = f.extensions.map(juger);
  const acceptes = resultats.filter((r) => r.accepte).length;
  return { accepte: acceptes === resultats.length, total: resultats.length, acceptes, motifs: [], resultats };
}

module.exports = { juger, jugerFichier, LANGUES, MIN_REQUETES, MIN_LANGUES };
