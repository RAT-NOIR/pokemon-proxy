'use strict';
// BANC-200 (tour 1, relecture 1 C1) — la GARDE DU JUGE pour tous les chemins qui lisent ou écrivent des photos et des vérités de banc HORS des seaux : /api/banc/etiquette, le rédacteur des lignes `banc_lignes`
// (etiquette-ligne.js), l'ancien export (exporter-banc-admin.js) et les outils de mesure qui lisent `analyses.photoBanc`. Un scan du juge n'y entre jamais.
// 🔑 Écrite par ce qu'elle AUTORISE et FERMÉE par défaut : si l'état du juge ne se lit pas (base muette, collection illisible), elle LÈVE `JUGE_ILLISIBLE` et l'appelant REFUSE. « Je ne sais pas » n'est jamais « ce n'est pas le juge ».
// Elle ne lit que les collections des seaux (banc_seaux, banc_seau_scans, banc_seau_photos) et `analyses` (photoBanc, nombre de cartes) : lecture seule.
const crypto = require('crypto');
const mongoose = require('mongoose');

const COL = Object.freeze({ seaux: 'banc_seaux', scans: 'banc_seau_scans', photos: 'banc_seau_photos' });
const illisible = e => Object.assign(new Error('l\'état du juge ne se lit pas'), { code: 'JUGE_ILLISIBLE', cause: e && (e.code || e.name) });

/** Ce scan est-il rangé dans un seau de type juge ? Lève JUGE_ILLISIBLE si la réponse ne se lit pas ; un scan rangé dans un seau introuvable est traité comme du juge (on ne conclut pas). */
async function scanEstDuJuge(colFn, scanId) {
    try {
        const ligne = await colFn(COL.scans).findOne({ scanId: String(scanId) });
        if (!ligne) return false;
        const seau = await colFn(COL.seaux).findOne({ _id: ligne.seauId });
        return !seau || seau.type === 'juge';
    } catch (e) { throw illisible(e); }
}

/**
 * Tout ce qui identifie le juge : ses scans, les sha256 de ses photos d'origine, les clés et sha256 de ses photos `photoBanc` (l'ancien chemin), et les identifiants de ligne `banc_lignes` que ses scans auraient (sel donné).
 * @returns {Promise<{existe:boolean, scanIds:Set<string>, shas:Set<string>, photoBanc:{cles:Set<string>, shas:Set<string>}, idsLigne:Set<string>}>}
 */
async function etatDuJuge(colFn, { sel = null } = {}) {
    const o = { existe: false, scanIds: new Set(), shas: new Set(), photoBanc: { cles: new Set(), shas: new Set() }, idsLigne: new Set(), dhashes: [], sansDhash: 0 };
    try {
        const juges = await colFn(COL.seaux).find({ type: 'juge' }).toArray();
        if (!juges.length) return o;
        o.existe = true;
        const ids = juges.map(s => s._id);
        const scans = await colFn(COL.scans).find({ seauId: { $in: ids } }, { projection: { scanId: 1 } }).toArray();
        for (const s of scans) o.scanIds.add(String(s.scanId));
        for (const p of await colFn(COL.photos).find({ seauId: { $in: ids } }, { projection: { sha256: 1, dhash: 1 } }).toArray()) {
            if (p.sha256) o.shas.add(p.sha256);
            if (typeof p.dhash === 'string' && /^[0-9a-f]{16}$/.test(p.dhash)) o.dhashes.push(p.dhash); else o.sansDhash++;       // un dHash absent : la comparaison de l'appelant est impossible (il refuse)
        }
        if (o.scanIds.size) {
            const oids = [...o.scanIds].filter(i => /^[0-9a-f]{24}$/i.test(i)).map(i => new mongoose.Types.ObjectId(i));
            const ans = oids.length ? await colFn('analyses').find({ _id: { $in: oids } }, { projection: { photoBanc: 1, cartes: 1 } }).toArray() : [];
            for (const a of ans) {
                if (a.photoBanc && typeof a.photoBanc.cle === 'string') o.photoBanc.cles.add(a.photoBanc.cle);
                if (a.photoBanc && typeof a.photoBanc.sha256 === 'string') o.photoBanc.shas.add(a.photoBanc.sha256);
                if (sel) for (let c = 0; c < Math.min(100, Array.isArray(a.cartes) && a.cartes.length ? a.cartes.length : 1); c++) o.idsLigne.add(crypto.createHash('sha256').update(`${String(a._id).toLowerCase()}|${c}|etiquette-admin|${sel}`).digest('hex'));
            }
        }
        return o;
    } catch (e) { throw illisible(e); }
}

/** Retire d'une liste d'analyses (documents `analyses`) celles du juge — pour les outils de mesure. Lève JUGE_ILLISIBLE. */
async function sansJuge(colFn, analyses) {
    const j = await etatDuJuge(colFn);
    return analyses.filter(a => !j.scanIds.has(String(a._id)));
}

module.exports = { scanEstDuJuge, etatDuJuge, sansJuge, COL };
