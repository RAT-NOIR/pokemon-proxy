'use strict';
// GALERIE L10 — la bibliothèque d'ILLUSTRATIONS PRIVÉES de l'Atelier, sur la collection `arts` de la base dédiée (le dépôt en deux temps est dans depot.js). Un art a CINQ états :
//   prive → en-attente → public | refuse ; public → retire (par la modération) ; l'auteur ramène en-attente ET public à « prive » (dépublier).
//   · « prive » et « en-attente » gardent leurs deux objets sous `galerie/attente/<id>` (bucket PRIVÉ, lus par URL signée GET d'une heure, pour l'AUTEUR seul) ; « public » n'a plus que sa copie `galerie/pub/<id>` ;
//     « refuse » et « retire » n'ont aucun objet (la modération les a effacés) — leur `image` se lit null.
//   · une illustration d'autrui, absente ou mal nommée répond le même `introuvable` (jamais « interdit ») : `trouver` ne cherche QUE dans les illustrations de l'auteur.
//   · supprimer = le document, les votes, le dépôt, et les objets R2 (privé ET public) ; un objet qui ne part pas entre dans la file de reprise (service.supprimerOuFile) ; les zones d'un classeur qui la citent se lisent
//     `null` (classeurs.js, resoudre) — aucune écriture dans les classeurs.
const G = require('./base');
const F = require('./forme');
const svc = require('./service');

const AMBIANCES = Object.freeze(['douce', 'sombre', 'lumineuse', 'nature', 'ville', 'nuit', 'mer', 'espace', 'retro', 'pixel', 'aquarelle', 'abstraite']);
const FORMATS_POCHETTES = Object.freeze(['2x2', '3x2', '2x3', '3x3', '4x3', '4x4', 'double-page']);
const EXPIRE_LECTURE_S = 3600, LISTE_MAX = 200;
const iso = d => (d instanceof Date ? d.toISOString() : null);

/** L'illustration de CET auteur, ou null (absente, mal formée, ou d'un autre : le même résultat). */
const trouver = (id, mien) => (F.idValide(id) ? G.col('arts').findOne({ _id: id, auteurId: mien }) : Promise.resolve(null));

/** L'Illustration rendue à l'auteur. `image` et `vignette` : URL signée GET 1 h (privé, en attente), adresse publique (public), null (refusé, retiré, ou pas de stockage). */
function vue(d, stockage = null) {
    let image = null, vignette = null;
    if (stockage) {
        const signe = cle => { try { return stockage.presignerLecture({ cle, expire: EXPIRE_LECTURE_S }); } catch { return null; } };
        if (d.etat === 'public') { image = `${stockage.urlPublique}/${d.clePublique}.webp`; vignette = `${stockage.urlPublique}/${d.clePublique}-480.webp`; }
        else if (d.etat === 'prive' || d.etat === 'en-attente') { image = signe(`${d.cle}.webp`); vignette = signe(`${d.cle}-480.webp`); }
    }
    return { id: d._id, titre: d.nom, format: d.fmt, largeur: d.largeur, hauteur: d.hauteur, couleur: d.couleur, image, vignette, artisteDeclare: d.artisteDeclare || d.pseudo, ambiances: d.ambiances || [], formats: d.formats || [],
        visibilite: d.etat, motif: d.motif || null, creeLe: iso(d.creeLe || d.recuLe) };
}

async function lister({ compteId, stockage = null }) {
    const docs = await G.col('arts').find({ auteurId: String(compteId) }).limit(LISTE_MAX).toArray();
    docs.sort((a, b) => ((b.creeLe || b.recuLe || 0) - (a.creeLe || a.recuLe || 0)) || (a._id < b._id ? -1 : 1));
    return docs.map(d => vue(d, stockage));
}

// ═══ le corps : liste fermée de clés, chaque champ borné ═══
const listeFermee = (v, permises) => Array.isArray(v) && v.length <= permises.length && v.every(x => permises.includes(x)) && new Set(v).size === v.length;
/** Les métadonnées d'un corps. { meta } | { detail }. `publication` ajoute `certifieAuteur` et `cgu` (exigés). */
function lireMeta(b, { publication }) {
    const permises = ['artisteDeclare', 'ambiances', 'formats', ...(publication ? ['certifieAuteur', 'cgu'] : ['titre'])];
    if (!F.objet(b) || !F.cles(b, permises)) return { detail: 'corps' };
    const meta = {};
    if (publication) {
        if (b.certifieAuteur !== true) return { detail: 'auteur-non-certifie' };
        if (typeof b.cgu !== 'string' || F.problemeTexte(b.cgu, { min: 1, max: 40 })) return { detail: 'cgu' };
        meta.cgu = b.cgu.normalize('NFKC').trim();
    } else if (Object.keys(b).length === 0) return { detail: 'corps' };
    if (b.titre !== undefined) { const p = F.problemeTexte(b.titre, { min: 1, max: 80 }); if (p || !b.titre.normalize('NFKC').trim()) return { detail: p === 'donnee-binaire' ? 'donnee-binaire' : 'titre' }; meta.titre = b.titre.normalize('NFKC').trim(); }
    if (b.artisteDeclare !== undefined) {
        if (b.artisteDeclare === null) meta.artisteDeclare = null;
        else { const p = typeof b.artisteDeclare === 'string' ? F.problemeTexte(b.artisteDeclare, { min: 1, max: 80 }) : 'type'; if (p || !b.artisteDeclare.trim()) return { detail: p === 'donnee-binaire' ? 'donnee-binaire' : 'artiste-declare' }; meta.artisteDeclare = b.artisteDeclare.normalize('NFKC').trim(); }
    }
    if (b.ambiances !== undefined) { if (!listeFermee(b.ambiances, AMBIANCES)) return { detail: 'ambiances' }; meta.ambiances = b.ambiances; }
    if (b.formats !== undefined) { if (!listeFermee(b.formats, FORMATS_POCHETTES)) return { detail: 'formats' }; meta.formats = b.formats; }
    return { meta };
}

/** { introuvable } | { detail } | { conflit: 'etat' } | { illustration }. */
async function modifier({ compteId, id, corps, stockage = null }) {
    const mien = String(compteId);
    const d = await trouver(id, mien);
    if (!d) return { introuvable: true };
    const l = lireMeta(corps, { publication: false });
    if (l.detail) return { detail: l.detail };
    const m = l.meta;
    // un art PUBLIC a été jugé avec son texte : son titre et son artiste ne se changent plus (dépublier d'abord) ; les listes fermées, si
    if (d.etat === 'public' && (m.titre !== undefined || m.artisteDeclare !== undefined)) return { conflit: 'etat' };
    const maj = {};
    if (m.titre !== undefined) { maj.nom = m.titre; maj.mots = svc.motsDe(m.titre, d.pseudo); }
    if (m.artisteDeclare !== undefined) maj.artisteDeclare = m.artisteDeclare === null ? d.pseudo : m.artisteDeclare;
    if (m.ambiances !== undefined) maj.ambiances = m.ambiances;
    if (m.formats !== undefined) maj.formats = m.formats;
    const apres = await G.col('arts').findOneAndUpdate({ _id: id }, { $set: maj }, { returnDocument: 'after' });
    return { illustration: vue(apres || { ...d, ...maj }, stockage) };
}

/** { introuvable } | { ok: true }. Le document part d'abord (l'autorité), puis les objets R2 : un objet qui ne part pas entre dans la file de reprise. */
async function supprimer({ compteId, id, stockage }) {
    const mien = String(compteId);
    const d = await trouver(id, mien);
    if (!d) return { introuvable: true };
    await G.col('arts').deleteOne({ _id: id });
    await G.col('votes').deleteMany({ type: 'banque', cible: id });
    await G.col('depots').deleteMany({ artId: id });
    for (const k of [...svc.clesDe(d.cle), ...svc.clesDe(d.clePublique)]) await svc.supprimerOuFile(stockage, k, 'suppression-illustration');
    return { ok: true };
}

/** { introuvable } | { detail } | { conflit: 'etat' } | { ok: true, illustration }. « prive » passe « en-attente » (certification des droits, version des CGU) ; en attente et public : rien ne change ; refusé ou retiré : conflit (les objets sont partis). */
async function publier({ compteId, pseudo, id, corps, stockage = null, maintenant = new Date() }) {
    const mien = String(compteId);
    const d = await trouver(id, mien);
    if (!d) return { introuvable: true };
    const l = lireMeta(corps, { publication: true });
    if (l.detail) return { detail: l.detail };
    if (d.etat === 'en-attente' || d.etat === 'public') return { ok: true, illustration: vue(d, stockage) };
    if (d.etat !== 'prive') return { conflit: 'etat' };
    const m = l.meta;
    const maj = { etat: 'en-attente', recuLe: maintenant, motif: null, certification: { droits: true, nonOfficielle: true, cgu: m.cgu, le: maintenant },
        artisteDeclare: m.artisteDeclare === undefined || m.artisteDeclare === null ? (d.artisteDeclare || pseudo) : m.artisteDeclare, ambiances: m.ambiances === undefined ? (d.ambiances || []) : m.ambiances, formats: m.formats === undefined ? (d.formats || []) : m.formats };
    const apres = await G.col('arts').findOneAndUpdate({ _id: id, etat: 'prive' }, { $set: maj }, { returnDocument: 'after' });
    return { ok: true, illustration: vue(apres || (await G.col('arts').findOne({ _id: id })) || d, stockage) };
}

/** { introuvable } | { indispo: true } | { ok: true, illustration }. En attente → privé : rien à déplacer. Public → privé : la copie PRIVÉE est refaite AVANT le changement d'état (elle échoue : rien n'a changé), puis la copie publique et les votes partent. */
async function depublier({ compteId, id, stockage, maintenant = new Date() }) {
    const mien = String(compteId);
    const d = await trouver(id, mien);
    if (!d) return { introuvable: true };
    if (d.etat === 'en-attente') await G.col('arts').updateOne({ _id: id, etat: 'en-attente' }, { $set: { etat: 'prive', motif: null } });
    else if (d.etat === 'public') {
        try { for (const s of ['.webp', '-480.webp']) { await stockage.copier(`${d.clePublique}${s}`, `${d.cle}${s}`); } }
        catch (e) { console.error(`❌ [galerie] copie privée en échec (${(e && (e.name || e.code)) || 'erreur'}) : l'illustration reste publique`); return { indispo: true }; }
        const r = await G.col('arts').updateOne({ _id: id, etat: 'public' }, { $set: { etat: 'prive', publieLe: null, nbJaime: 0, nbEnregistre: 0, motif: null, depublieLe: maintenant } });
        if (r.modifiedCount === 1) {
            await G.col('votes').deleteMany({ type: 'banque', cible: id });
            for (const k of svc.clesDe(d.clePublique)) await svc.supprimerOuFile(stockage, k, 'depublication');
        }
    }
    const apres = await G.col('arts').findOne({ _id: id });
    return { ok: true, illustration: vue(apres || d, stockage) };
}

module.exports = { AMBIANCES, FORMATS_POCHETTES, EXPIRE_LECTURE_S, trouver, vue, lister, lireMeta, modifier, supprimer, publier, depublier };
