/* Visite guidée : bulles pas à pas posées sur les vrais éléments de l'écran. Pendant la visite, l'application est
   inerte (rien ne peut être touché ni modifié) ; la page reste défilable.
   Visite.demarrer(etapes, { fin, hautFixe }) ; une étape :
     aller()    prépare l'écran (mode, onglet…), facultatif ;
     cible      sélecteur CSS, ou fonction renvoyant l'élément à montrer, ou une liste d'éléments (halo autour de
                l'ensemble) ; absente : bulle au centre, sans halo ;
     assurer()  remet en place ce que la cible exige si l'écran a été redessiné entre-temps (facultatif) ;
     titre, texte (HTML), boutons { suiv, quitter } (libellés facultatifs).
   fin(complete) : appelée à la sortie ; complete = la visite est allée jusqu'au bout. */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const MARGE = 12;   // px entre la bulle, la cible et les bords de l'écran
  let v = null;       // visite en cours : { etapes, i, fin, hautFixe, zone, minuteur }

  const reduit = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visible = (c) => (Array.isArray(c) ? c.length > 0 && c.every(visible) : !!c && c.isConnected && c.getClientRects().length > 0);
  // Rectangle d'un élément, ou rectangle englobant d'une liste d'éléments
  function rectDe(c) {
    if (!Array.isArray(c)) return c.getBoundingClientRect();
    const rs = c.map((x) => x.getBoundingClientRect());
    const left = Math.min(...rs.map((x) => x.left)), top = Math.min(...rs.map((x) => x.top));
    const right = Math.max(...rs.map((x) => x.right)), bottom = Math.max(...rs.map((x) => x.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function cibleDe(e) {
    if (!e.cible) return null;
    let el = typeof e.cible === 'function' ? e.cible() : $(e.cible);
    if (!visible(el) && e.assurer) {
      e.assurer();
      el = typeof e.cible === 'function' ? e.cible() : $(e.cible);
    }
    return visible(el) ? el : null;
  }

  function demarrer(etapes, { fin = () => {}, hautFixe = () => 0 } = {}) {
    if (v) arreter(false);
    const zone = document.createElement('div');
    zone.id = 'visite';
    zone.innerHTML = `<div class="visite-trou" aria-hidden="true"></div>
      <div class="visite-bulle" role="dialog" aria-modal="true" aria-labelledby="visite-titre" aria-describedby="visite-texte"></div>`;
    document.body.append(zone);
    ['#app', '#feuille'].forEach((s) => { const x = $(s); if (x) x.inert = true; });
    v = { etapes, i: -1, fin, hautFixe, zone, minuteur: setInterval(placer, 400) };
    zone.addEventListener('click', clic);
    document.addEventListener('keydown', clavier, true);
    window.addEventListener('resize', placer);
    window.addEventListener('scroll', placer, true);
    aller(0);
  }

  function arreter(complete) {
    if (!v) return;
    const { zone, minuteur, fin } = v;
    clearInterval(minuteur);
    document.removeEventListener('keydown', clavier, true);
    window.removeEventListener('resize', placer);
    window.removeEventListener('scroll', placer, true);
    zone.remove();
    ['#app', '#feuille'].forEach((s) => { const x = $(s); if (x) x.inert = false; });
    v = null;
    fin(complete);
  }

  function aller(i) {
    if (!v || i < 0 || i >= v.etapes.length) return;
    v.i = i;
    const e = v.etapes[i];
    if (e.aller) e.aller();
    const n = v.etapes.length;
    const b = e.boutons || {};
    const bulle = $('.visite-bulle', v.zone);
    bulle.innerHTML = `
      ${i > 0 && i < n - 1 ? `<p class="visite-compte">${i} / ${n - 2}</p>` : ''}
      <h2 id="visite-titre">${e.titre}</h2>
      <div id="visite-texte" class="visite-texte">${e.texte}</div>
      <div class="visite-boutons">
        ${i < n - 1 ? `<button type="button" class="lien" data-visite="quitter">${b.quitter || 'Quitter'}</button>` : '<span></span>'}
        <span class="visite-nav">
          ${i > 0 ? '<button type="button" class="btn" data-visite="prec">‹ Précédent</button>' : ''}
          <button type="button" class="btn btn-primaire" data-visite="suiv">${b.suiv || (i < n - 1 ? 'Suivant ›' : 'Terminer')}</button>
        </span>
      </div>`;
    const el = cibleDe(e);
    if (el) defilerVers(el, bulle);
    else window.scrollTo(0, 0);
    placer();
    $('[data-visite="suiv"]', bulle).focus({ preventScroll: true });
  }

  // Cible et bulle ensemble à l'écran sous l'en-tête fixe ; cible trop haute : son début, juste sous l'en-tête
  function defilerVers(el, bulle) {
    const r = rectDe(el);
    const haut = v.hautFixe();
    const dispo = innerHeight - haut;
    const hb = bulle.offsetHeight + MARGE;
    const voulu = r.height + hb <= dispo - 2 * MARGE ? haut + (dispo - r.height - hb) / 2 : haut + MARGE;
    window.scrollBy({ top: r.top - voulu, behavior: reduit() ? 'auto' : 'smooth' });
  }

  // Halo autour de la cible et bulle dessous, sinon dessus, sinon en bas de l'écran ; sans cible : au centre
  function placer() {
    if (!v) return;
    const e = v.etapes[v.i];
    const trou = $('.visite-trou', v.zone);
    const bulle = $('.visite-bulle', v.zone);
    const el = cibleDe(e);
    const l = Math.min(400, innerWidth - 2 * MARGE);
    bulle.style.width = `${l}px`;
    const hb = bulle.offsetHeight;
    let x = (innerWidth - l) / 2;
    let y = (innerHeight - hb) / 2;
    trou.classList.toggle('sans-cible', !el);
    if (el) {
      const r = rectDe(el);
      const p = 6;
      const t = Math.max(-p, r.top - p), bas = Math.min(innerHeight + p, r.bottom + p);
      Object.assign(trou.style, { left: `${r.left - p}px`, top: `${t}px`, width: `${r.width + 2 * p}px`, height: `${Math.max(0, bas - t)}px` });
      const haut = v.hautFixe();
      if (r.bottom + MARGE + hb <= innerHeight - MARGE) y = r.bottom + MARGE;
      else if (r.top - MARGE - hb >= haut + MARGE) y = r.top - MARGE - hb;
      else y = innerHeight - hb - MARGE;
      x = Math.max(MARGE, Math.min(innerWidth - l - MARGE, r.left + r.width / 2 - l / 2));
    } else {
      Object.assign(trou.style, { left: `${innerWidth / 2}px`, top: `${innerHeight / 2}px`, width: '0px', height: '0px' });
    }
    bulle.style.left = `${Math.round(x)}px`;
    bulle.style.top = `${Math.round(Math.max(MARGE, y))}px`;
  }

  function clic(ev) {
    const b = ev.target.closest('[data-visite]');
    if (!b || !v) return;
    const n = v.etapes.length;
    if (b.dataset.visite === 'quitter') arreter(false);
    else if (b.dataset.visite === 'prec') aller(v.i - 1);
    else if (v.i < n - 1) aller(v.i + 1);
    else arreter(true);
  }

  // ← / → : étape précédente / suivante ; Échap : quitter (Entrée : bouton qui a le focus)
  function clavier(ev) {
    if (!v) return;
    if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); arreter(false); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); if (v.i < v.etapes.length - 1) aller(v.i + 1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); aller(v.i - 1); }
  }

  window.Visite = { demarrer, arreter, enCours: () => !!v };
})();
