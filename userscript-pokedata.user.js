// ==UserScript==
// @name         Relevé passif d'une page de set (lot catalogue)
// @namespace    rat-market
// @version      1.0
// @description  Au clic seulement : lit les cartes déjà affichées sur la page de set ouverte par toi (numéro, nom, image pleine taille) et les envoie au récepteur local. Aucune requête, aucune navigation.
// @match        https://www.pokedata.io/set/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==
// PASSIF : ce script ne charge rien, ne navigue pas, ne clique pas, ne défile pas. Tu ouvres la page, tu la fais défiler toi-même jusqu'en bas (pour que toutes les cartes soient affichées),
// puis tu cliques sur le bouton. Il lit ce que la page a DÉJÀ affiché et l'envoie à http://127.0.0.1:8767/releve (recepteur-pokedata.js).
(function () {
    'use strict';
    const RECEPTEUR = 'http://127.0.0.1:8767/releve';
    const ENTETE = 'X-Rat-Market', VALEUR = 'releve-passif';
    const MOTIF_IMAGE = /^https:\/\/pokemoncardimages\.pokedata\.io\/images\/([^/]+)\/([A-Za-z0-9-]+?)(?:_240w)?\.webp$/;

    const nomDuSet = () => { const m = /^\/set\/([^/]+)$/.exec(location.pathname); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; };
    // une vignette « …_240w.webp » devient l'adresse pleine taille « ….webp » (la vignette elle-même n'est jamais demandée par le collecteur)
    const pleine = src => String(src || '').replace(/_240w(?=\.webp)/, '');
    const sources = img => [img.currentSrc, img.src, img.getAttribute('data-src'), ...String(img.getAttribute('srcset') || '').split(',').map(s => s.trim().split(/\s+/)[0])].filter(Boolean);

    function lire() {
        const vus = new Map(), exemples = [];
        let imgs = 0;
        for (const img of document.images) {
            const src = sources(img).map(pleine).find(s => MOTIF_IMAGE.test(s));
            if (!src) continue;
            imgs++;
            if (vus.has(src)) continue;
            const m = MOTIF_IMAGE.exec(src);
            const conteneur = img.closest('a, li, div');
            const nom = (img.alt || img.title || (conteneur && (conteneur.getAttribute('aria-label') || '')) || '').trim().slice(0, 200);
            vus.set(src, { numero: m[2], nom, img: src });
            if (exemples.length < 3 && conteneur) exemples.push(conteneur.outerHTML.slice(0, 1500));
        }
        return { schema: 1, set: nomDuSet(), url: location.origin + location.pathname, cartes: [...vus.values()], diag: { imgs, exemples, complet: false } };
    }

    function envoyer() {
        const releve = lire();
        if (!releve.cartes.length) { dire('Aucune carte affichée : fais défiler la page jusqu\'en bas, puis recommence.'); return; }
        GM_xmlhttpRequest({
            method: 'POST', url: RECEPTEUR, data: JSON.stringify(releve),
            headers: { 'Content-Type': 'application/json', [ENTETE]: VALEUR },
            onload: r => dire(r.status === 200 ? `${releve.cartes.length} carte(s) envoyée(s).` : `Refusé (${r.status}) : ${String(r.responseText).slice(0, 160)}`),
            onerror: () => dire('Le récepteur local ne répond pas (recepteur-pokedata.js est-il lancé ?).')
        });
    }
    function dire(texte) { bouton.textContent = texte; setTimeout(() => { bouton.textContent = 'Relever cette page'; }, 6000); }

    const bouton = document.createElement('button');
    bouton.textContent = 'Relever cette page';
    bouton.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;padding:10px 14px;background:#222;color:#fff;border:0;border-radius:6px;font:14px sans-serif;cursor:pointer';
    bouton.addEventListener('click', envoyer);
    document.body.appendChild(bouton);
})();
