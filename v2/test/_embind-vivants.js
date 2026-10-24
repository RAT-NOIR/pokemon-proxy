'use strict';
// MEMOIRE-G — l'instrument des fuites d'OpenCV.js : il COMPTE les objets C++ (embind : Mat, vecteurs, DMatchVector…) créés et jamais libérés, et la taille de la mémoire WASM.
// OpenCV.js ne libère rien tout seul (ni GC, ni FinalizationRegistry dans cette construction : vérifié) : un objet embind qui n'a pas reçu son `.delete()` reste en mémoire jusqu'à la mort du processus.
// Comment : embind fabrique chaque objet par `Object.create(prototype, { $$: … })` ; on tient la liste de ceux-là et on demande à chacun `isDeleted()`. Un objet VALEUR (KeyPoint, DMatch, Size…) est
// copié en objet JS simple, il n'est pas dans la liste. À armer AVANT de charger opencv (la mémoire WASM se repère à l'instanciation). Module de banc : jamais chargé par le serveur.
const tous = new Set(), memoires = [];
let arme = false;

function armer() {
    if (arme) return module.exports;
    arme = true;
    const creer = Object.create;
    Object.create = function (proto, props) {
        const o = creer.call(Object, proto, props);
        if (props && Object.prototype.hasOwnProperty.call(props, '$$')) tous.add(o);
        return o;
    };
    const instancier = WebAssembly.instantiate;
    WebAssembly.instantiate = async function (...a) {
        const r = await instancier.apply(WebAssembly, a);
        const inst = r && r.instance ? r.instance : r;
        if (inst && inst.exports) for (const v of Object.values(inst.exports)) if (v instanceof WebAssembly.Memory) memoires.push(v);
        return r;
    };
    return module.exports;
}

/** Les objets embind non libérés : { n, par: { Mat: 12, … } }. Les objets libérés sortent de la liste (elle ne grossit pas avec les appels). */
function vivants() {
    const par = {}; let n = 0;
    for (const o of [...tous]) {
        let libere = true;
        try { libere = o.isDeleted(); } catch { libere = true; }
        if (libere) { tous.delete(o); continue; }
        const nom = (o.$$ && o.$$.ptrType && o.$$.ptrType.registeredClass && o.$$.ptrType.registeredClass.name) || (o.constructor && o.constructor.name) || '?';
        par[nom] = (par[nom] || 0) + 1; n++;
    }
    return { n, par };
}

/** La taille de la mémoire linéaire WASM, en octets (elle ne fait que croître : une fuite qui dépasse l'espace libre la fait grandir). null si opencv n'est pas encore instancié. */
const octetsWasm = () => (memoires.length ? memoires[0].buffer.byteLength : null);

/** Libère tout ce qui est encore vivant (un banc le fait après avoir CONSTATÉ une fuite, pour que la suivante ne se recompte pas). */
function purger() { for (const o of [...tous]) { try { if (!o.isDeleted()) o.delete(); } catch { /* déjà libéré */ } tous.delete(o); } }

module.exports = { armer, vivants, octetsWasm, purger };
