/* Interface de l'application : verrou, saisie des appels, chronomètre, semaine, statistiques, paramètres. */
(function () {
  'use strict';

  const S = window.Store;
  const VERSION = '1.34.1';
  const $ = (sel, racine = document) => racine.querySelector(sel);
  const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

  // iPhone / iPad : pas d'agrandissement automatique de la page quand on touche une case (texte < 16 px) ;
  // le zoom à deux doigts reste possible (Safari ignore maximum-scale pour le geste)
  if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    $('meta[name=viewport]').content += ', maximum-scale=1';
  }

  /* ---------- Formats ---------- */
  const fmtHeure = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDate = (ts) => { const d = new Date(ts); return `${JOURS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const memeJour = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const fmtQuand = (ts) => (memeJour(ts, Date.now()) ? fmtHeure(ts) : `${fmtDate(ts)} ${fmtHeure(ts)}`);
  const fmtDuree = (ms) => {
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)}` : `${m} min`;
  };
  const fmtChrono = (ms) => {
    const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };
  const valDate = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const iconeType = (t) => (window.TYPES_SEGMENT.find((x) => x.id === t) || { icone: '•' }).icone;
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

  /* ---------- État de l'interface ---------- */
  const ui = {
    mode: '',                 // '' : écran d'ouverture (2 cercles) ; 'simple' : chronomètre seul ; 'standard' : tout
    blocCumul: false,         // bandeau bleu : bloc « Cumul » déplié
    blocPlages: false,        // bandeau bleu : bloc « Plage W continu » déplié
    onglet: 'accueil',
    semaine: Rules.cleSemaine(Date.now()),
    decalAppels: 0,           // onglet Appels : semaine affichée, en semaines avant la semaine en cours (0 = en cours)
    periode: 'semaine',
    cibleHeat: '',
    pile: [],                 // feuilles ouvertes (la dernière est visible)
    effectifsReportes: false,
    apresCoup: new Set(),     // dossiers créés en saisie après coup (heure modifiable en tête)
    ordreBarres: [],          // ordre des barres figé au dernier clic sur ▲ / ▼ (NOM, Date) (ids)
    triLe: 0,                 // heure de ce clic : un dossier renseigné depuis repasse en haut
    brouillons: {},           // horaires modifiés pas encore validés, par intervention : { date, debut, fin, duree }
    forcer: new Set(),        // interventions dont la validation malgré un chevauchement a été demandée
    deplies: new Set(),       // barres dont les interventions antérieures sont affichées (double clic)
    tri: '',                  // dernier tri choisi : 'nom-asc', 'nom-desc', 'date-asc' ou 'date-desc'
    ouverture: '',            // bloc du bandeau (cumul, plages) qu'on vient d'ouvrir : déplié en douceur une fois
  };

  // Mode PC : menu à gauche + jusqu'à 4 fenêtres de dossiers. En dessous : écrans plein écran (smartphone, tablette).
  // Mis de côté depuis la v1.9.0 : l'accueil affiche les dossiers en barres horizontales sur tous les écrans.
  const mqPC = window.matchMedia('(min-width: 1100px)');
  const estPC = () => false;
  // Version « fichier unique » (Tasks/outils/fichier_unique.py) ouverte par double clic, sans serveur
  const FICHIER = location.protocol === 'file:';
  const MAX_FENETRES = 4;


  // Zones de texte auto-extensibles : la hauteur suit le contenu, sauf hauteur réglée à la main (data-h, en px)
  function ajusterHauteur(el) {
    el.classList.toggle('h-fixe', !!el.dataset.h);
    if (el.dataset.h) { el.style.height = `${el.dataset.h}px`; return; }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }
  const ajusterTout = (racine = document) => $$('textarea', racine).forEach(ajusterHauteur);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(toast.m);
    toast.m = setTimeout(() => t.classList.remove('visible'), 2600);
  }

  const dossier = (id) => S.state.dossiers.find((d) => d.id === id);
  // Couleur d'un HAD (SSV bleus, NICE verts, SSBDR gris ; style.css « Couleurs des HAD ») : classe had-<nom>
  const classeHad = (etab) => (etab ? `had-${etab.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '');
  const incomplet = (d) => !d.etab || !d.antenne || !d.nom3;

  /* =====================================================================
     VERROU (code personnel)
     ===================================================================== */
  function rendreVerrou(erreur = '') {
    const nouveau = !S.existe();
    $('#app').hidden = true;
    $('#verrou').hidden = false;
    $('#verrou').innerHTML = `
      <form class="verrou" data-form="${nouveau ? 'creer' : 'ouvrir'}" autocomplete="off">
        <div class="logo" aria-hidden="true">⏱</div>
        <h1>Astreinte Minuteur</h1>
        ${nouveau ? `
          <p class="aide">Choisissez un code personnel (6 caractères minimum). Il chiffre les données sur cet appareil.
          <strong>Sans ce code, les données sont perdues.</strong></p>
          ${FICHIER ? `<p class="aide">Fichier unique : les données restent dans ce navigateur, sur ce PC. Ouvrez toujours ce
          fichier avec le même navigateur (Edge ou Chrome) et rangez-le à un endroit fixe (ex. Documents).</p>` : ''}
          <input type="password" name="code" placeholder="Nouveau code" minlength="6" required autocomplete="new-password">
          <input type="password" name="code2" placeholder="Confirmer le code" minlength="6" required autocomplete="new-password">
          <button class="btn btn-primaire" type="submit">Créer mon espace</button>`
        : `
          <input type="password" name="code" placeholder="Code personnel" required autocomplete="current-password" autofocus>
          <button class="btn btn-primaire" type="submit">Déverrouiller</button>
          <button class="lien" type="button" data-a="reinitialiser">Code oublié ? Tout réinitialiser</button>`}
        <p class="erreur" role="alert">${esc(erreur)}</p>
      </form>`;
    const champ = $('#verrou input');
    if (champ) champ.focus();
  }

  async function apresDeverrouillage() {
    $('#verrou').hidden = true;
    $('#verrou').innerHTML = '';
    $('#app').hidden = false;
    ui.semaine = Rules.cleSemaine(Date.now());
    ui.decalAppels = 0;
    ui.mode = '';   // à chaque ouverture : choix Simplifié / Standard
    rendre();
    if (!S.state.medecinCourant) ouvrirFeuille({ type: 'medecin', accueil: true });   // la visite est proposée après
    else if (!S.state.visiteVue) lancerVisite();
    else demanderEffectifs();
  }

  // Patients présents de la semaine : demandés en mode Standard seulement
  function demanderEffectifs() {
    if (ui.mode !== 'standard') return;
    const cle = Rules.cleSemaine(Date.now());
    if (!S.effectifsSaisis(cle) && !ui.effectifsReportes) ouvrirFeuille({ type: 'effectifs', semaine: cle });
  }

  /* =====================================================================
     RENDU PRINCIPAL
     ===================================================================== */
  function rendre() {
    if (!S.state) return;
    cacherInfo();
    $('#btn-medecin').innerHTML = `👤 ${esc(S.state.medecinCourant || 'Médecin ?')}`;
    const b = Rules.bornesSemaine(Rules.cleSemaine(Date.now()));
    $('#entete-semaine').textContent = `Semaine du ${fmtDate(b.debut)}`;
    rendreChrono();
    $('#barre-chrono').hidden = ui.onglet === 'accueil' || ui.mode !== 'standard';   // à l'accueil, le chronomètre est dans la barre du dossier
    document.body.classList.toggle('ecran-choix', ui.mode === '');
    document.body.classList.toggle('ecran-simple', ui.mode === 'simple');
    const pc = estPC();
    document.body.classList.toggle('mode-pc', pc);
    // On garde la position de défilement de chaque fenêtre de dossier
    const defilements = {};
    $$('.fenetre').forEach((f) => { defilements[f.dataset.fenetre] = $('.fenetre-corps', f).scrollTop; });
    const vues = { accueil: pc ? vueFenetres : vueAccueil, semaine: vueSemaine, stats: vueStats, plus: vuePlus };
    $('#menu').hidden = !pc;
    if (pc) majMenu();
    $('#vue').innerHTML = ui.mode === 'standard' ? vues[ui.onglet]() : ui.mode === 'simple' ? vueSimple() : vueChoix();
    $$('.fenetre').forEach((f) => { $('.fenetre-corps', f).scrollTop = defilements[f.dataset.fenetre] || 0; });
    $$('.onglets button, .menu-nav button').forEach((x) => x.classList.toggle('actif', x.dataset.v === ui.onglet));
    ajusterTout($('#vue'));
    majConflits();
    rendreFeuille();
    tic();
  }

  // Ouvre un dossier : fenêtre sur PC, feuille plein écran sinon
  function afficherDossier(id, { focus = false } = {}) {
    if (estPC()) {
      const d = dossier(id);
      if (d.clos) { d.clos = false; S.toucher(d); }          // rechoisi dans la liste : il revient « en cours »
      const chasse = S.ouvrirFenetre(id, MAX_FENETRES);
      ui.pile = ui.pile.filter((x) => x.type !== 'dossier');
      ui.onglet = 'accueil';
      rendre();
      if (chasse) toast(`${S.codePatient(chasse) || 'Un dossier'} est rangé dans la liste à gauche (4 fenêtres au maximum)`);
      const cible = $(`.fenetre[data-fenetre="${id}"]`);
      if (cible) {
        cible.classList.add('fenetre-flash');
        if (focus) { const champ = $(ui.apresCoup.has(id) ? '[data-heure-appel] [name=heure]' : '[data-f=nom3]', cible); if (champ) champ.focus(); }
      }
    } else {
      ui.pile = ui.pile.filter((x) => x.type !== 'dossier');
      ouvrirFeuille({ type: 'dossier', id });
      rendre();
    }
  }

  // Met à jour le menu de gauche (mode PC) sans toucher aux fenêtres
  function majMenu() {
    if (!estPC() || !S.state) return;
    const menu = $('#menu');
    const y = menu.scrollTop;
    menu.innerHTML = menuPC();
    $$('.menu-nav button', menu).forEach((x) => x.classList.toggle('actif', x.dataset.v === ui.onglet));
    menu.scrollTop = y;
    tic();
  }

  // Ré-affiche un seul dossier (sans toucher aux autres fenêtres ni perdre la saisie en cours ailleurs)
  function rafraichirDossier(id) {
    const f = ui.pile[ui.pile.length - 1];
    if (f && f.type === 'dossier' && f.id === id) rendreFeuille();
    const fen = $(`.fenetre[data-fenetre="${id}"]`);
    if (fen) {
      const corps = $('.fenetre-corps', fen);
      const y = corps.scrollTop;
      fen.innerHTML = interieurFenetre(dossier(id));
      $('.fenetre-corps', fen).scrollTop = y;
      ajusterTout(fen);
      tic();
    }
  }

  mqPC.addEventListener('change', () => {
    if (!S.state) return;
    // Passage en mode PC : les dossiers ouverts en feuille deviennent des fenêtres
    if (estPC()) ui.pile.filter((x) => x.type === 'dossier').forEach((x) => S.ouvrirFenetre(x.id, MAX_FENETRES));
    ui.pile = ui.pile.filter((x) => !estPC() || x.type !== 'dossier');
    rendre();
  });

  function rendreChrono() {
    const a = S.segmentActif();
    $('#barre-chrono').innerHTML = a ? `
      <div class="chrono">
        <span class="pulse" aria-hidden="true"></span>
        <button class="chrono-info" data-a="ouvrir-dossier" data-id="${a.dossier.id}">
          <b>${esc(S.codePatient(a.dossier) || 'Nouveau dossier')}</b>
          <span>${iconeType(a.seg.type)} ${esc(a.seg.type)}</span>
        </button>
        <span class="chrono-temps" data-chrono="${a.seg.debut}">00:00</span>
        <button class="btn-stop" data-a="stop" aria-label="Terminer ce temps">■</button>
      </div>` : '';
  }

  // Mise à jour chaque seconde des chronomètres affichés
  function tic() {
    const maintenant = Date.now();
    $$('[data-chrono]').forEach((el) => { el.textContent = fmtChrono(Math.max(0, maintenant - Number(el.dataset.chrono))); });
    majCumuls();
    $$('[data-total-dossier]').forEach((el) => {
      const d = dossier(el.dataset.totalDossier);
      if (d) el.textContent = fmtDuree(S.dureeDossier(d));
    });
  }

  /* ---------- Écran d'ouverture et mode Simplifié ---------- */
  // Après le code : deux cercles, côte à côte (ordinateur, tablette) ou l'un sous l'autre (écran étroit)
  function vueChoix() {
    return `
      <section class="choix-mode" aria-label="Choisir le mode">
        <button class="cercle cercle-simple" data-a="mode" data-v="simple"><span class="cercle-titre">Simplifié</span></button>
        <button class="cercle cercle-standard" data-a="mode" data-v="standard"><span class="cercle-titre">Standard</span></button>
      </section>`;
  }

  const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const fmtJourHeure = (ts) => `${JOURS_COURTS[new Date(ts).getDay()]} ${jjmm(ts)} ${fmtHeure(ts)}`;   // « Jeu 29/10 09:30 »

  /* Mode Simplifié : un seul cercle-chronomètre. Un toucher démarre une intervention (vert « En cours… », temps écoulé
     depuis ce toucher), un autre l'interrompt (terracotta « 00:00 » puis « À l'arrêt » en grand, clignotement lent, puis
     « Cliquer pour Démarrer » en plus petit sur 3 lignes).
     Chaque intervention est un dossier sans nom, à compléter plus tard en mode Standard. Dessous, une ligne par
     intervention terminée de la semaine d'astreinte (la plus récente en haut) : Début, Fin et Durée se modifient
     comme dans les barres du mode Standard (brouillon, « ✓ Valider / Annuler », chevauchements en rouge). */
  function vueSimple() {
    const a = S.segmentActif();
    const cle = Rules.cleSemaine(Date.now());
    const lignes = S.dossiersActifs().flatMap((d) => d.segments.map((s) => ({ d, s })))
      .filter(({ s }) => s.fin != null && Rules.cleSemaine(s.debut) === cle).sort((x, y) => y.s.debut - x.s.debut);
    const etat = a ? 'en-cours' : lignes.length ? 'suspendu' : 'pret';
    const contenu = {
      'en-cours': `<span class="cercle-temps" data-chrono="${a && a.seg.debut}">${a ? fmtChrono(Date.now() - a.seg.debut) : ''}</span>
          <span class="cercle-etat">En cours<span class="points" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span>`,
      suspendu: `<span class="cercle-temps">00:00</span>
          <span class="cercle-etat cercle-arret clignote">À l'arrêt</span>
          <span class="cercle-consigne">Cliquer<br>pour<br>Démarrer</span>`,
      pret: '<span class="cercle-etat">Démarrer</span>',
    }[etat];
    return `
      <section class="mode-simple">
        <button class="cercle cercle-chrono ${etat}" data-a="chrono-simple" aria-label="${a ? 'Interrompre' : 'Démarrer'} le chronomètre">
          ${contenu}
        </button>
        <button class="vers-standard" data-a="mode" data-v="standard">↩ Passer en mode Standard</button>
        ${alerteAntennesSimple(lignes)}
        ${lignes.length ? `
        <div class="simple-lignes">
          <div class="simple-entete"><span class="col-debut">Début</span><span class="col-fin">Fin</span><span class="col-duree" title="Durée en minutes">Durée</span><span class="col-ant">Antenne</span></div>
          ${lignes.map(({ d, s }) => `
          <div class="simple-ligne">
            <div class="b-horaire simple-horaire" data-horaire-seg data-id="${d.id}" data-seg="${s.id}">${casesHoraire(d, s, true)}
              ${selectAntenne(d, 'simple-ant')}
              <button class="b-suppr simple-suppr" data-a="supprimer-interv" data-id="${d.id}" data-seg="${s.id}" aria-label="Supprimer cette intervention" title="Supprimer cette intervention">✕</button>
            </div>
            ${ligneValidation(d, s)}
          </div>`).join('')}
        </div>` : '<p class="vide">Aucune intervention terminée cette semaine d\'astreinte.</p>'}
      </section>`;
  }

  // Page Simplifiée : interventions de la semaine dont le dossier n'a pas d'antenne (alerte au-dessus du tableau)
  function alerteAntennesSimple(lignes) {
    const n = lignes.filter(({ d }) => !d.antenne).length;
    return n ? `<p class="alerte-antenne" data-alerte-antenne>⚠ Antenne à renseigner pour ${pluriel(n, 'intervention')}</p>` : '';
  }
  // Après un choix d'antenne sur la page Simplifiée : alerte recalculée d'après les listes encore vides
  function majAlerteAntennesSimple() {
    const n = $$('.simple-ligne select.manque').length;
    const alerte = $('[data-alerte-antenne]');
    if (alerte) alerte.remove();
    const tableau = $('.simple-lignes');
    if (n && tableau) tableau.insertAdjacentHTML('beforebegin', `<p class="alerte-antenne" data-alerte-antenne>⚠ Antenne à renseigner pour ${pluriel(n, 'intervention')}</p>`);
  }

  /* ---------- Onglet Appels ---------- */
  // En cours = non clos ; traités = clos cette semaine ou dans les dernières 24 h
  function listesDossiers() {
    const actif = S.segmentActif();
    const tri = (a, b) => {
      if (actif && a === actif.dossier) return -1;
      if (actif && b === actif.dossier) return 1;
      return S.derniereActivite(b) - S.derniereActivite(a);
    };
    const semaine = new Set(S.dossiersDeSemaine(Rules.cleSemaine(Date.now())));
    const hier = Date.now() - 864e5;
    const tous = S.dossiersActifs().filter((d) => d.segments.length);
    return {
      enCours: tous.filter((d) => !d.clos).sort(tri),
      traites: tous.filter((d) => d.clos && (semaine.has(d) || S.derniereActivite(d) > hier)).sort(tri),
    };
  }

  function bandeauxAlerte() {
    const cle = Rules.cleSemaine(Date.now());
    const aPurger = S.aPurger().length;
    const bandeaux = [];
    if (!S.effectifsSaisis(cle)) bandeaux.push(`<button class="bandeau" data-a="feuille-effectifs">📋 Saisir les patients présents de la semaine</button>`);
    if (aPurger) bandeaux.push(`<button class="bandeau bandeau-gris" data-a="onglet" data-v="plus">🗂 ${pluriel(aPurger, 'dossier')} de plus d'un mois : exporter puis purger</button>`);
    return bandeaux.join('');
  }

  const boutonsAppel = () => `
    <section class="actions">
      <button class="btn-appel" data-a="nouvel-appel">
        <span class="btn-appel-icone">📞</span>
        <span>Nouvel appel reçu<small>Le chronomètre démarre tout de suite</small></span>
      </button>
      <div class="actions-sec">
        <button class="btn" data-a="nouvelle-tache">↗️ Appel passé / tâche</button>
        <button class="btn" data-a="apres-coup">🕘 Saisie après coup</button>
      </div>
    </section>`;

  /* ---------- Mode PC : menu de gauche ---------- */
  function elementMenu(d, ouverts) {
    const actif = d.segments.some((s) => s.fin == null);
    return `
      <button class="menu-dossier ${ouverts.includes(d.id) ? 'affiche' : ''} ${actif ? 'chrono-actif' : ''} ${d.clos ? 'clos' : ''}"
        data-a="ouvrir-dossier" data-id="${d.id}">
        <span class="md-l1"><b data-titre-dossier="${d.id}">${esc(S.codePatient(d) || 'Patient à préciser')}</b>
          <span data-total-dossier="${d.id}">${fmtDuree(S.dureeDossier(d))}</span></span>
        <span class="md-l2">${esc(d.antenne || 'Antenne ?')}</span>
        <span class="md-l3">${actif ? '⏱ en cours · ' : ''}${fmtQuand(S.derniereActivite(d))}${ouverts.includes(d.id) ? ' · affiché' : ''}</span>
      </button>`;
  }

  function menuPC() {
    const { enCours, traites } = listesDossiers();
    const ouverts = S.fenetres();
    const nav = [['accueil', '🗂', 'Dossiers'], ['semaine', '📅', 'Semaine'], ['stats', '📊', 'Stats'], ['plus', '⚙️', 'Plus']];
    return `
      ${boutonsAppel()}
      ${bandeauxAlerte()}
      <h2 class="titre-section">En cours <span class="compteur">${enCours.length}</span></h2>
      <div class="menu-liste">${enCours.map((d) => elementMenu(d, ouverts)).join('') || '<p class="vide">Aucun dossier en cours.</p>'}</div>
      <h2 class="titre-section">Traités <span class="compteur">${traites.length}</span></h2>
      <div class="menu-liste">${traites.map((d) => elementMenu(d, ouverts)).join('') || '<p class="vide">Aucun dossier clos récemment.</p>'}</div>
      <nav class="menu-nav">${nav.map(([v, i, l]) => `<button data-a="onglet" data-v="${v}"><span aria-hidden="true">${i}</span>${l}</button>`).join('')}</nav>`;
  }

  /* ---------- Mode PC : 1 à 4 fenêtres de dossiers ---------- */
  function interieurFenetre(d) {
    return `
      <div class="fenetre-entete">
        <span class="fe-identite" data-bande="${d.id}">${identite(d)}</span>
        <span class="total" data-total-dossier="${d.id}"></span>
        <button class="btn-mini" data-a="masquer" data-id="${d.id}" title="Masquer la fenêtre (le dossier reste en cours)">–</button>
        <button class="btn-mini btn-clore" data-a="clore" data-id="${d.id}" title="Clore le dossier">✓ Clore</button>
      </div>
      <div class="fenetre-corps">${corpsDossier(d)}</div>`;
  }

  function vueFenetres() {
    const ids = S.fenetres();
    if (!ids.length) {
      return `<div class="fenetres-vide">
        <p class="vide">Aucun dossier affiché.<br>Démarrez un appel, ou choisissez un patient dans la liste à gauche.</p>
        <button class="btn-appel" data-a="nouvel-appel"><span class="btn-appel-icone">📞</span><span>Nouvel appel reçu<small>Le chronomètre démarre tout de suite</small></span></button>
      </div>`;
    }
    const actif = S.segmentActif();
    return `<div class="fenetres n${ids.length}">${ids.map((id) => `
      <section class="fenetre ${actif && actif.dossier.id === id ? 'fenetre-active' : ''}" data-fenetre="${id}">
        ${interieurFenetre(dossier(id))}
      </section>`).join('')}</div>`;
  }

  function carteDossier(d) {
    const actif = d.segments.some((s) => s.fin == null);
    const appels = d.segments.filter((s) => s.type === 'Appel reçu').length;
    return `
      <article class="carte ${actif ? 'carte-active' : ''}">
        <button class="carte-corps" data-a="ouvrir-dossier" data-id="${d.id}">
          <div class="carte-l1"><b>${esc(S.codePatient(d) || 'Patient à préciser')}</b>
            ${incomplet(d) ? '<span class="pastille">à compléter</span>' : ''}</div>
          <div class="carte-l2">${esc(d.antenne || d.etab || 'Antenne ?')}</div>
          <div class="carte-l3">${pluriel(appels, 'appel')} · <span data-total-dossier="${d.id}">${fmtDuree(S.dureeDossier(d))}</span> · ${fmtQuand(S.derniereActivite(d))}</div>
        </button>
        ${actif
          ? `<button class="carte-btn carte-stop" data-a="stop" aria-label="Terminer">■</button>`
          : `<button class="carte-btn" data-a="reprendre" data-id="${d.id}" aria-label="Reprendre ce dossier">▶</button>`}
      </article>`;
  }

  /* ---------- Accueil simplifié : un bouton, puis un dossier = une barre horizontale ---------- */
  // Semaine d'astreinte affichée dans l'onglet Appels (‹ / › au-dessus des barres) ; suit le lundi 9 h si décalage 0
  const semaineAppels = () => Rules.decalerSemaine(Rules.cleSemaine(Date.now()), ui.decalAppels);

  /* Dossiers de la semaine + ceux saisis cette semaine (un appel saisi après coup peut dater de la semaine
     précédente : il reste affiché). Semaine passée : ses dossiers seulement.
     Ordre : du plus récemment traité au plus ancien (dernière saisie ou action sur le dossier). ▲ / ▼ (NOM, Date)
     fige un autre ordre ; dès qu'un dossier est de nouveau renseigné, il repasse en haut sans déplacer les autres. */
  function dossiersBarres() {
    const a = S.segmentActif();
    const cle = semaineAppels();
    const debutSemaine = Rules.bornesSemaine(cle).debut;
    const liste = new Set(S.dossiersDeSemaine(cle));
    if (!ui.decalAppels) {
      S.dossiersActifs().filter((d) => d.segments.length && d.creeLe >= debutSemaine).forEach((d) => liste.add(d));
      if (a) liste.add(a.dossier);
    }
    const rang = new Map(ui.ordreBarres.map((id, i) => [id, i]));
    const traite = (d) => d.traiteLe || d.majLe || 0;
    const r = (d) => (traite(d) <= ui.triLe && rang.has(d.id) ? rang.get(d.id) : -1);   // -1 : traité depuis le tri
    return [...liste].sort((x, y) => {
      if (r(x) < 0 || r(y) < 0) return (r(y) < 0) - (r(x) < 0) || traite(y) - traite(x);
      return r(x) - r(y);
    });
  }

  // Après une saisie : la barre repasse en haut tout de suite, sans déplacer les autres ni perdre le curseur
  function remonterBarre(id) {
    const el = $(`[data-barre="${id}"]`);
    if (!el || el.parentElement.firstElementChild === el) return;
    const actif = document.activeElement;
    el.parentElement.prepend(el);
    if (actif && actif !== document.body) actif.focus({ preventScroll: !el.contains(actif) });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');   // repère visuel : la ligne a changé de place
  }

  /* Tris proposés : ▲ / ▼ à droite des intitulés NOM et Date, et boutons du bandeau bleu.
     La date d'un dossier est celle de son intervention la plus récente (celle affichée sur la barre) ;
     les interventions d'un même dossier ne sont jamais triées (la plus récente en haut). */
  const TRIS = {
    'nom-asc': 'nom (A → Z)', 'nom-desc': 'nom (Z → A)',
    'date-asc': 'date (la plus ancienne en haut)', 'date-desc': 'date (la plus récente en haut)',
  };
  const flechesTri = (v, libelle) => `<span class="tri-fleches" role="group" aria-label="Trier par ${libelle}">${[['asc', '▲'], ['desc', '▼']].map(([sens, f]) =>
            `<button type="button" class="${ui.tri === `${v}-${sens}` ? 'actif' : ''}" data-a="trier" data-v="${v}" data-sens="${sens}" title="Trier par ${TRIS[`${v}-${sens}`]}" aria-label="Trier par ${TRIS[`${v}-${sens}`]}">${f}</button>`).join('')}</span>`;

  /* Bandeau bleu (mode Standard) : 3 blocs contigus. À gauche, la déclaration des plages continues ; au milieu, les
     cumuls (repliés sous « Cumul ») ; à droite, « Nouveau dossier » / « Dossier existant », centré sur la colonne
     Reprise des barres. Le tri se fait par ▲ / ▼ à côté de NOM et de Date.
     Cumuls sur les dernières 24 h et sur une période choisie « du … au … » (par défaut la semaine d'astreinte, du
     lundi 9 h 00 au lundi suivant 9 h 00 ; modifiable, mémorisée dans S.state.cumulDepuis / cumulJusqua) : durée et
     nombre d'interventions, ventilés par tranche horaire.
     Une intervention en cours compte jusqu'à maintenant ; à cheval sur deux tranches, sa durée est répartie et elle
     est comptée dans la tranche où elle commence (ou du début de la période, si elle a commencé avant).
     Dénominations patients : NOM + PREN distincts ; chaque dossier encore sans nom compte pour une. */
  const TRANCHES = [['jour', '09h00 - 20h00', 9, 20], ['soir', '20h00 - 24h00', 20, 24], ['nuit', '00h00 - 09h00', 0, 9]];
  const debutCumul = () => S.state.cumulDepuis || Rules.bornesSemaine(Rules.cleSemaine(Date.now())).debut;
  const finCumul = () => S.state.cumulJusqua || Rules.bornesSemaine(Rules.cleSemaine(Date.now())).fin;
  const trancheDe = (ts) => { const h = new Date(ts).getHours(); return TRANCHES.find(([, , h1, h2]) => h >= h1 && h < h2)[0]; };
  /* Une intervention ne compte que le temps déjà écoulé : jusqu'à sa fin, ou jusqu'à maintenant si elle est en cours
     ou si sa fin saisie est après l'heure actuelle (à 15 h 23, 15 h 19 → 15 h 29 compte 4 min) ; une intervention qui
     n'a pas encore commencé ne compte pas. Les plages déclarées, elles, comptent en entier (voir majCumuls).
     Le tout est borné à la période [depuis, jusqua] (jusqua = Infinity : pas de borne de fin). */
  function cumuls(depuis, jusqua, maintenant) {
    const res = { total: { ms: 0, n: 0 } };
    const comptes = new Set();   // dossiers ayant au moins une intervention comptée (patients : Rules.patients)
    TRANCHES.forEach(([k]) => { res[k] = { ms: 0, n: 0 }; });
    const limite = Math.min(maintenant, jusqua);
    S.dossiersActifs().forEach((d) => d.segments.forEach((s) => {
      if (s.debut > limite) return;
      const a = Math.max(s.debut, depuis);
      const b = Math.min(s.fin == null ? maintenant : s.fin, limite);
      if (!(b > a || s.debut >= depuis)) return;
      res.total.n++;
      res[trancheDe(a)].n++;
      comptes.add(d);
      if (b <= a) return;
      res.total.ms += b - a;
      // Répartition jour par jour, en dates locales (juste aussi les jours de changement d'heure)
      for (const j = new Date(new Date(a).setHours(0, 0, 0, 0)); j.getTime() < b; j.setDate(j.getDate() + 1)) {
        TRANCHES.forEach(([k, , h1, h2]) => {
          const x = Math.max(a, new Date(j.getFullYear(), j.getMonth(), j.getDate(), h1).getTime());
          const y = Math.min(b, new Date(j.getFullYear(), j.getMonth(), j.getDate(), h2).getTime());
          if (y > x) res[k].ms += y - x;
        });
      }
    }));
    res.patients = new Set(Rules.patients([...comptes], (d) => S.debutDossier(d)).values());
    return res;
  }
  // « 1h25 » ; « 1h25 - 4 instances »
  const fmtTemps = (ms) => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}h${pad(m % 60)}`; };
  const fmtCumul = ({ ms, n }) => `${fmtTemps(ms)} - ${n} instance${n > 1 ? 's' : ''}`;
  // Interventions : temps déjà écoulé seulement (même règle que cumuls)
  const intervallesInterventions = (maintenant) => S.dossiersActifs()
    .flatMap((d) => d.segments.map((s) => [s.debut, Math.min(s.fin == null ? maintenant : s.fin, maintenant)]));
  const intervallesPlages = () => (S.state.plages || []).map((p) => [p.debut, p.fin]);

  // Valeurs des cumuls mises à jour sans redessiner (chaque seconde : une intervention en cours fait monter les totaux)
  function majCumuls() {
    const zones = $$('[data-cumul]');
    const plagesAffichees = $$('[data-plage-transversal]');
    if (!zones.length && !plagesAffichees.length) return;
    const maintenant = Date.now();
    const inter = intervallesInterventions(maintenant);
    const plages = intervallesPlages();
    if (zones.length) {
      const depuis = debutCumul();
      const jusqua = finCumul();
      const r24 = cumuls(maintenant - 864e5, Infinity, maintenant);
      const r = cumuls(depuis, jusqua, maintenant);
      // Plages déclarées comptées en entier, y compris après l'heure actuelle (interventions : temps écoulé seulement)
      const t24 = Rules.tempsPlages(inter, plages, maintenant - 864e5, Infinity);
      const t = Rules.tempsPlages(inter, plages, depuis, jusqua);
      const n = r.patients.size;
      const valeurs = {
        h24: fmtCumul(r24.total), tr24: fmtTemps(t24.transversal), co24: fmtTemps(t24.combine),
        total: `${fmtCumul(r.total)} - ${n} dénomination${n > 1 ? 's' : ''} patient${n > 1 ? 's' : ''}`,
        tr: fmtTemps(t.transversal), co: fmtTemps(t.combine),
      };
      TRANCHES.forEach(([k]) => { valeurs[k] = fmtCumul(r[k]); });
      zones.forEach((el) => { const v = valeurs[el.dataset.cumul]; if (el.textContent !== v) el.textContent = v; });
    }
    // Plages W continu : temps de chaque plage non couvert par une intervention (infobulle de sa ligne)
    plagesAffichees.forEach((el) => {
      const p = (S.state.plages || []).find((x) => x.id === el.dataset.plageTransversal);
      if (p) el.title = `Plages W continu : ${fmtTemps(Rules.tempsPlages(inter, [[p.debut, p.fin]], p.debut, p.fin).transversal)}`;
    });
  }

  // Période du cumul saisie dans le bandeau (jj/mm et hh:mm) : borne « du » (debut) ou « au » (fin) modifiée
  function choisirPeriodeCumul(borne) {
    const attr = borne === 'debut' ? 'cumul-depuis' : 'cumul-jusqua';
    const iso = isoDepuisJJMM($(`[data-${attr}=date]`).value);
    if (!iso) { toast('Date du cumul : format jj/mm'); return; }
    const ts = new Date(`${iso}T${$(`[data-${attr}=heure]`).value || '00:00'}`).getTime();
    if (borne === 'debut' ? ts >= finCumul() : ts <= debutCumul()) { toast('Période du cumul : la fin doit être après le début'); return; }
    S.state[borne === 'debut' ? 'cumulDepuis' : 'cumulJusqua'] = ts;
    S.planifier();
    majCumuls();
  }

  /* ---------- Plages continues ----------
     Périodes déclarées « sans interruption » (date et heure de début → date et heure de fin). Le temps qu'aucune
     intervention ne couvre est du travail transversal : ni patient, ni instance, compté à part dans les cumuls
     (Rules.tempsPlages). Une ligne vide reste en haut pour la saisie suivante ; une ligne est enregistrée quand on la
     quitte (pas à chaque chiffre : une case heure change dès que l'heure est complète). */
  function lignePlage(p) {
    const id = p ? p.id : 'nouvelle';
    const aujourdhui = jjmm(Date.now());
    return `
            <div class="plage ${p ? '' : 'plage-nouvelle'}" data-plage="${id}" ${p ? `data-plage-transversal="${id}"` : ''}>
              <input class="plage-date" name="date-debut" value="${p ? jjmm(p.debut) : aujourdhui}" inputmode="numeric" maxlength="5" placeholder="jj/mm" autocomplete="off" aria-label="Date de début (jj/mm)">
              <input class="plage-heure" type="time" name="heure-debut" value="${p ? fmtHeure(p.debut) : ''}" aria-label="Heure de début">
              <span class="plage-fleche" aria-hidden="true">→</span>
              <input class="plage-date" name="date-fin" value="${p ? jjmm(p.fin) : aujourdhui}" inputmode="numeric" maxlength="5" placeholder="jj/mm" autocomplete="off" aria-label="Date de fin (jj/mm)">
              <input class="plage-heure" type="time" name="heure-fin" value="${p ? fmtHeure(p.fin) : ''}" aria-label="Heure de fin">
              ${p ? `<button class="plage-suppr" data-a="supprimer-plage" data-id="${id}" aria-label="Supprimer cette plage" title="Supprimer cette plage">✕</button>` : '<span></span>'}
            </div>
            <div class="plage-alerte" data-plage-alerte="${id}" role="alert" hidden>
              <span class="plage-alerte-texte"></span>
              <button class="btn-valider" data-a="plage-forcer" data-id="${id}">✓ Enregistrer quand même</button>
              <button class="btn-annuler" data-a="plage-annuler" data-id="${id}">Annuler</button>
            </div>`;
  }

  // Valeurs d'une ligne : { debut, fin } ou null si incomplète ; une fin plus tôt que le début le même jour tombe le lendemain
  function lirePlage(zone) {
    const v = (n) => $(`[name=${n}]`, zone).value;
    const iso1 = isoDepuisJJMM(v('date-debut'));
    const iso2 = isoDepuisJJMM(v('date-fin') || v('date-debut'));
    if (!iso1 || !iso2 || !v('heure-debut') || !v('heure-fin')) return null;
    const debut = new Date(`${iso1}T${v('heure-debut')}`).getTime();
    let fin = new Date(`${iso2}T${v('heure-fin')}`).getTime();
    if (fin <= debut && iso1 === iso2) fin = lendemain(fin);
    return fin > debut ? { debut, fin } : null;
  }

  /* Chevauchement de plages : comme pour les interventions, la ligne saisie et les plages qu'elle chevauche passent
     en rouge (début et/ou fin concernés), un avertissement s'affiche, et l'enregistrement est bloqué tant que l'on ne
     corrige pas ou que l'on ne choisit pas « Enregistrer quand même ». Mis à jour pendant la saisie. */
  function plagesChevauchees(zone) {
    const v = lirePlage(zone);
    if (!v) return { v, avec: [] };
    return { v, avec: (S.state.plages || []).filter((p) => p.id !== zone.dataset.plage && v.debut < p.fin && p.debut < v.fin) };
  }
  function verifierPlage(zone) {
    $$('.plages input.conflit').forEach((x) => x.classList.remove('conflit'));
    $$('[data-plage-alerte]').forEach((x) => { if (x.dataset.plageAlerte !== zone.dataset.plage) x.hidden = true; });
    const { v, avec } = plagesChevauchees(zone);
    const alerte = $(`[data-plage-alerte="${zone.dataset.plage}"]`);
    if (alerte) alerte.hidden = !avec.length;
    if (!avec.length) return avec;
    const rouge = (z, noms) => noms.forEach((n) => { const x = $(`[name=${n}]`, z); if (x) x.classList.add('conflit'); });
    let debut = false, fin = false;
    avec.forEach((p) => {
      const d = p.debut <= v.debut && v.debut < p.fin;
      const f = p.debut < v.fin && v.fin <= p.fin;
      debut = debut || d || !(d || f);
      fin = fin || f || !(d || f);   // la plage saisie englobe l'autre : début et fin en rouge
      const autre = $(`[data-plage="${p.id}"]`);
      if (autre) rouge(autre, ['date-debut', 'heure-debut', 'date-fin', 'heure-fin']);
    });
    if (debut) rouge(zone, ['date-debut', 'heure-debut']);
    if (fin) rouge(zone, ['date-fin', 'heure-fin']);
    $('.plage-alerte-texte', alerte).textContent = `⚠ Chevauche ${avec.map((p) => `la plage du ${jjmm(p.debut)} ${fmtHeure(p.debut)} → ${fmtHeure(p.fin)}`).join(' et ')}`;
    return avec;
  }

  // Ligne quittée : nouvelle plage ajoutée (et une ligne vide revient en haut) ou plage existante mise à jour.
  // forcer : enregistrée malgré un chevauchement (« Enregistrer quand même »).
  function enregistrerPlage(zone, forcer = false) {
    if (!S.state.plages) S.state.plages = [];
    const v = lirePlage(zone);
    if (v && !forcer && verifierPlage(zone).length) {
      toast('Chevauchement de plages (en rouge) : corrigez, ou « Enregistrer quand même »');
      return;
    }
    if (zone.dataset.plage === 'nouvelle') {
      if (!v) return;   // ligne laissée incomplète : rien n'est enregistré
      S.state.plages.push({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...v, majLe: Date.now() });
      S.planifier();
      rendre();
      const x = $('.plage-nouvelle [name=heure-debut]');
      if (x) x.focus();
      toast(`Plage enregistrée : ${fmtHeure(v.debut)} → ${fmtHeure(v.fin)}`);
      return;
    }
    const p = S.state.plages.find((x) => x.id === zone.dataset.plage);
    if (!p) return;
    if (!v) { toast('Plage incomplète ou fin avant le début : non modifiée'); return; }
    if (p.debut === v.debut && p.fin === v.fin) return;
    Object.assign(p, v, { majLe: Date.now() });
    $('[name=date-fin]', zone).value = jjmm(v.fin);   // « lendemain » appliqué
    S.planifier();
    if (forcer) rendre(); else majCumuls();
    toast(`Plage modifiée : ${fmtHeure(v.debut)} → ${fmtHeure(v.fin)}`);
  }

  // Bloc de droite : téléphone, ▲, « Nouveau dossier », « Dossier existant », ▼ (le ▼ désigne les boutons Reprise)
  function blocActions() {
    return `
        <div class="bandeau-actions">
          <button class="btn-nouveau" data-a="nouveau-dossier" title="Le chronomètre démarre (et arrête le dossier en cours)">
            <span class="btn-appel-icone" aria-hidden="true">📞</span>
            <span class="triangle" aria-hidden="true">▲</span>
            <span class="action-texte">Nouveau dossier</span>
          </button>
          <span class="action-texte" title="Pour un dossier existant : bouton « ▶ Reprise » de sa barre">Dossier existant</span>
          <span class="triangle" aria-hidden="true">▼</span>
        </div>`;
  }

  function blocCumul() {
    const depuis = debutCumul();
    const jusqua = finCumul();
    return `
        <div class="bloc-bandeau bloc-cumul ${ui.ouverture === 'cumul' ? 'ouverture' : ''}">
          <button class="bloc-titre" data-a="bloc" data-v="cumul" aria-expanded="${ui.blocCumul}">Cumul <span aria-hidden="true">${ui.blocCumul ? '▾' : '▸'}</span></button>
          ${ui.blocCumul ? `
          <div class="cumul-titre">Cumul dernières 24h :</div>
          <ul class="cumul-liste">
            <li><b data-cumul="h24"></b></li>
            <li>Plages W continu = <b data-cumul="tr24"></b></li>
            <li>Total W : Instances et Plages = <b data-cumul="co24"></b></li>
          </ul>
          <div class="cumul-titre">Cumul du
            <input class="cumul-date" data-cumul-depuis="date" value="${jjmm(depuis)}" inputmode="numeric" maxlength="5" placeholder="jj/mm" autocomplete="off" aria-label="Date de début du cumul (jj/mm)">
            <input class="cumul-heure" type="time" data-cumul-depuis="heure" value="${fmtHeure(depuis)}" aria-label="Heure de début du cumul">
            au
            <input class="cumul-date" data-cumul-jusqua="date" value="${jjmm(jusqua)}" inputmode="numeric" maxlength="5" placeholder="jj/mm" autocomplete="off" aria-label="Date de fin du cumul (jj/mm)">
            <input class="cumul-heure" type="time" data-cumul-jusqua="heure" value="${fmtHeure(jusqua)}" aria-label="Heure de fin du cumul"> :</div>
          <ul class="cumul-liste">
            <li>Total <b data-cumul="total"></b></li>
            ${TRANCHES.map(([k, libelle], i) => `<li class="${i ? '' : 'espace'}">${libelle} = <b data-cumul="${k}"></b></li>`).join('')}
            <li class="espace">Plages W continu = <b data-cumul="tr"></b></li>
            <li>Total W : Instances et Plages = <b data-cumul="co"></b></li>
          </ul>` : ''}
        </div>`;
  }

  function blocPlages() {
    const plages = [...(S.state.plages || [])].sort((a, b) => b.debut - a.debut);
    return `
        <div class="bloc-bandeau bloc-plages ${ui.ouverture === 'plages' ? 'ouverture' : ''}">
          <button class="bloc-titre" data-a="bloc" data-v="plages" aria-expanded="${ui.blocPlages}">Plage W continu${plages.length ? ` (${plages.length})` : ''} <span aria-hidden="true">${ui.blocPlages ? '▾' : '▸'}</span></button>
          ${ui.blocPlages ? `
          <div class="plages">
            <div class="plage plage-entete" aria-hidden="true"><span class="col-debut">Début</span><span class="col-fin">Fin</span></div>
            ${lignePlage(null)}
            ${plages.map(lignePlage).join('')}
          </div>` : ''}
        </div>`;
  }

  /* Blocs « Plage W continu » et « Cumul » : repliés d'eux-mêmes 5 minutes après avoir été dépliés (reporté de 30 s
     tant que le curseur est dans le bloc, pour ne pas couper une saisie). Seul le bandeau est redessiné : une saisie
     en cours dans une barre n'est pas interrompue. */
  const DELAI_REPLI = 5 * 60000;
  const minuteursRepli = {};
  function programmerRepli(v) {
    const cle = v === 'cumul' ? 'blocCumul' : 'blocPlages';
    clearTimeout(minuteursRepli[v]);
    if (!ui[cle]) return;
    const replier = () => {
      const bloc = $(v === 'cumul' ? '.bloc-cumul' : '.bloc-plages');
      if (bloc && bloc.contains(document.activeElement)) { minuteursRepli[v] = setTimeout(replier, 30000); return; }
      ui[cle] = false;
      const bandeau = $('.bandeau-nouveau');
      if (bandeau) { bandeau.outerHTML = bandeauNouveau(); majCumuls(); }
    };
    minuteursRepli[v] = setTimeout(replier, DELAI_REPLI);
  }

  function bandeauNouveau() {
    return `
      <div class="bandeau-nouveau">
        <h2 class="bandeau-titre"><span>APPELS</span></h2>
        ${blocPlages()}
        ${blocCumul()}
        ${blocActions()}
      </div>`;
  }

  /* Liste Antenne (pas de case HAD : le HAD se déduit de l'antenne et reste enregistré avec le dossier).
     Abréviations ; par HAD (ordre des paramètres) puis ordre alphabétique ; « Autre » en dernier. */
  const abrevAntenne = (a) => window.ABREVIATIONS_ANTENNES[a] || a;
  const selectAntenne = (d, classe) => `<select class="${classe} ${d.antenne ? '' : 'manque'}" data-sel="antenne" data-id="${d.id}" aria-label="Antenne"${
    d.antenne ? '' : ' title="Antenne à renseigner : elle fait partie de l\'identité du patient"'}>${optionsAntenne(d)}</select>`;
  function optionsAntenne(d) {
    const parHad = S.state.config.etablissements.flatMap((e) => [...Rules.antennesDe(e)]
      .sort((a, b) => abrevAntenne(a).localeCompare(abrevAntenne(b), 'fr')));
    const liste = [...parHad.filter((a) => a !== 'Autre'), ...parHad.filter((a) => a === 'Autre')];
    if (d.antenne && !liste.includes(d.antenne)) liste.push(d.antenne);
    return `<option value="">${d.antenne ? '—' : 'Antenne ?'}</option>${liste.map((a) => `<option value="${esc(a)}" title="${esc(a)}" ${a === d.antenne ? 'selected' : ''}>${esc(abrevAntenne(a))}</option>`).join('')}`;
  }

  /* Date affichée « jj/mm ». L'année enregistrée est l'année en cours — ou la précédente si la date tomberait
     à plus d'un mois dans le futur (ex. « 31/12 » saisi le 1er janvier). */
  const jjmm = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  function isoDepuisJJMM(texte) {
    const t = String(texte || '').trim();
    const m = t.match(/^(\d{1,2})\s*[/.\- ]\s*(\d{1,2})$/) || t.match(/^(\d{2})(\d{2})$/);
    if (!m) return '';
    const j = Number(m[1]), mois = Number(m[2]);
    const maintenant = new Date();
    let d = new Date(maintenant.getFullYear(), mois - 1, j);
    if (d.getMonth() !== mois - 1 || d.getDate() !== j) return '';   // 31/02, 00/10…
    if (d - maintenant > 31 * 864e5) d = new Date(maintenant.getFullYear() - 1, mois - 1, j);
    return valDate(d.getTime());
  }

  // Appel d'une autre semaine d'astreinte (lundi 9 h → lundi 9 h) que celle affichée : il est compté dans cette semaine-là
  function tagDate(ts) {
    const ref = ui.mode === 'simple' ? Rules.cleSemaine(Date.now()) : semaineAppels();
    const ecart = Rules.cleSemaine(ts).localeCompare(ref);
    return ecart ? (ecart < 0 ? 'sem. préc.' : 'sem. suiv.') : '';
  }

  // Fin un autre jour que le début (appel après minuit) : « lendemain », ou « +2 j »
  function tagFin(debut, fin) {
    const jours = Math.round((new Date(fin).setHours(0, 0, 0, 0) - new Date(debut).setHours(0, 0, 0, 0)) / 864e5);
    return jours > 0 ? (jours === 1 ? 'lendemain' : `+${jours} j`) : '';
  }

  /* ---------- Modification des heures : brouillon, puis « Valider » ----------
     Taper dans Date / Début / Fin / Durée ne modifie rien d'enregistré : les valeurs restent un brouillon
     (ui.brouillons, par intervention), la case liée se recalcule à l'écran et les chevauchements avec les
     autres interventions sont signalés en rouge. « ✓ Valider » enregistre, « Annuler » revient en arrière. */
  const lendemain = (ts) => { const x = new Date(ts); x.setDate(x.getDate() + 1); return x.getTime(); };

  // Valeurs affichées d'une intervention : brouillon en cours, sinon valeurs enregistrées
  function valeursHoraire(s) {
    const b = ui.brouillons[s.id];
    const v = {
      date: b ? b.date : jjmm(s.debut),
      debut: b ? b.debut : fmtHeure(s.debut),
      fin: b && b.fin != null ? b.fin : s.fin == null ? '' : fmtHeure(s.fin),
      duree: b && b.duree != null ? b.duree : s.fin == null ? '' : String(Math.round((s.fin - s.debut) / 60000)),
    };
    const iso = isoDepuisJJMM(v.date);
    v.tsDebut = iso ? new Date(`${iso}T${v.debut}`).getTime() : NaN;
    v.tsFin = s.fin == null ? null : iso ? new Date(`${iso}T${v.fin}`).getTime() : NaN;
    if (v.tsFin != null && v.tsFin < v.tsDebut) v.tsFin = lendemain(v.tsFin);
    return v;
  }

  /* Date | Début | Fin | Durée d'une intervention ; en cours : Fin = bouton Stop, Durée = chronomètre.
     Pas d'intitulé dans la barre (ils sont au-dessus de la première) ; petites étiquettes « sem. préc. » / « lendemain ».
     jours (mode Simplifié) : jour de la semaine devant la date, et jour + date devant la Fin (« Jeu 29/10 »). */
  const jourCourt = (ts) => JOURS_COURTS[new Date(ts).getDay()];
  const jourFin = (ts) => `${jourCourt(ts)}<span class="jour-date"> ${jjmm(ts)}</span>`;
  function casesHoraire(d, s, jours = false) {
    const enCours = s.fin == null;
    const v = valeursHoraire(s);
    const ok = !Number.isNaN(v.tsDebut);
    const okFin = ok && v.tsFin != null && !Number.isNaN(v.tsFin);
    return `${jours ? `
          <span class="b-jour" data-jour-debut>${ok ? jourCourt(v.tsDebut) : ''}</span>` : ''}
          <span class="b-champ"><input type="text" name="date" value="${esc(v.date)}" inputmode="numeric" placeholder="jj/mm" maxlength="5" autocomplete="off" aria-label="Date (jj/mm)"><span class="b-tag" data-tag-date>${ok ? tagDate(v.tsDebut) : ''}</span></span>
          <span class="b-champ"><input type="time" name="debut" value="${v.debut}" aria-label="Début"></span>
          ${enCours ? `
          <button class="btn-barre-stop" data-a="stop" aria-label="Arrêter le chronomètre">■ Stop</button>
          <b class="b-chrono" data-chrono="${s.debut}">00:00</b>` : `
          ${jours ? `<span class="b-jour" data-jour-fin>${okFin ? jourFin(v.tsFin) : ''}</span>` : ''}
          <span class="b-champ"><input type="time" name="fin" value="${v.fin}" aria-label="Fin"><span class="b-tag" data-tag-fin>${ok && !Number.isNaN(v.tsFin) ? tagFin(v.tsDebut, v.tsFin) : ''}</span></span>
          <span class="b-champ"><input type="number" name="duree" min="0" step="1" inputmode="numeric" value="${v.duree}" aria-label="Durée en minutes"></span>`}`;
  }

  // Intitulés des colonnes, une seule fois au-dessus de la première barre (même grille que les barres), centrés ;
  // ▲ / ▼ à droite de NOM et de Date pour trier les dossiers dans un sens ou dans l'autre
  function enteteBarres() {
    return `
      <div class="ligne-dossier entete-barres">
        <span class="b-nom th-tri"><span><span data-info="nom" tabindex="0">NOM</span>${flechesTri('nom', 'nom')}</span></span><span class="b-pr">PREN</span><span class="b-rpss">RPSS</span><span class="b-ant">Antenne</span><span class="b-memo">Mémo</span>
        <div class="b-horaire"><span class="th-tri"><span>Date${flechesTri('date', 'date')}</span></span><span>Début</span><span>Fin</span><span title="Durée en minutes">Durée</span></div>
        <span class="b-comm">Commentaire</span>
      </div>`;
  }

  // Ligne « ✓ Valider / Annuler » d'une intervention, visible dès qu'un horaire est modifié :
  // boutons sous Début, Fin et Durée de la barre, message de chevauchement dessous
  function ligneValidation(d, s) {
    return `
        <div class="b-validation" data-validation="${s.id}" ${ui.brouillons[s.id] ? '' : 'hidden'}>
          <span class="b-valider-btns">
            <button class="btn-valider" data-a="valider-horaire" data-id="${d.id}" data-seg="${s.id}">✓ Valider</button>
            <button class="btn-annuler" data-a="annuler-horaire" data-id="${d.id}" data-seg="${s.id}">Annuler</button>
          </span>
          <span class="b-conflit" role="alert"></span>
        </div>`;
  }

  /* Chevauchements : chaque intervention en brouillon est comparée à toutes les autres (tous patients ; un seul
     médecin ne peut pas être sur deux interventions à la fois). Renvoie, par intervention, les cases à mettre en
     rouge (« debut », « fin ») et, pour celle en brouillon, la liste des interventions chevauchées. */
  function calculerConflits() {
    const tous = S.dossiersActifs().flatMap((d) => d.segments.map((s) => {
      const v = valeursHoraire(s);
      return { d, s, debut: v.tsDebut, fin: v.tsFin == null ? Date.now() : v.tsFin };
    })).filter((x) => !Number.isNaN(x.debut) && !Number.isNaN(x.fin));
    const res = new Map();
    const entree = (id) => res.get(id) || res.set(id, { champs: new Set(), avec: [] }).get(id);
    Object.keys(ui.brouillons).forEach((id) => {
      const a = tous.find((x) => x.s.id === id);
      if (!a) return;
      tous.forEach((b) => {
        if (b === a || !(a.debut < b.fin && b.debut < a.fin)) return;
        const c = entree(a.s.id);
        const debutDedans = b.debut <= a.debut && a.debut < b.fin;
        const finDedans = b.debut < a.fin && a.fin <= b.fin;
        if (debutDedans) c.champs.add('debut');
        if (finDedans) c.champs.add('fin');
        if (!debutDedans && !finDedans) { c.champs.add('debut'); c.champs.add('fin'); }   // l'englobe entièrement
        c.avec.push(b);
        const autre = entree(b.s.id);
        autre.champs.add('debut'); autre.champs.add('fin');
      });
    });
    return res;
  }

  // Met à jour les marques rouges et les messages sans redessiner (le curseur reste où il est)
  function majConflits() {
    if (ui.mode !== 'simple' && ui.onglet !== 'accueil') return new Map();
    const conf = calculerConflits();
    $$('[data-horaire-seg]').forEach((z) => {
      const c = conf.get(z.dataset.seg);
      ['debut', 'fin'].forEach((k) => { const x = $(`[name=${k}]`, z); if (x) x.classList.toggle('conflit', !!c && c.champs.has(k)); });
    });
    $$('[data-validation]').forEach((v) => {
      const c = conf.get(v.dataset.validation);
      $('.b-conflit', v).textContent = c && c.avec.length
        ? `⚠ Chevauche ${c.avec.map((x) => `${S.codePatient(x.d) || 'patient sans nom'} ${fmtHeure(x.debut)} → ${x.s.fin == null ? 'en cours' : fmtHeure(x.fin)}`).join(' ; ')}`
        : '';
    });
    return conf;
  }

  /* Mémo / Commentaire d'une intervention : texte sur plusieurs lignes (Entrée = retour à la ligne), la case grandit
     avec le texte. Case active : petits boutons − / + (une ligne de moins / de plus), ⤢ (ajustée au texte, suit la
     saisie), ↺ (hauteur d'origine, une ligne). Une hauteur réglée à la main est mémorisée sur l'intervention. */
  const NOTES = { memo: ['b-memo', 'Mémo', 'hMemo'], commentaire: ['b-comm', 'Commentaire', 'hComm'] };
  const BOUTONS_HAUTEUR = [['moins', '−', 'Réduire la hauteur'], ['plus', '+', 'Agrandir la hauteur'],
    ['texte', '⤢', 'Ajuster au texte (la case suit le texte)'], ['defaut', '↺', 'Hauteur d\'origine (une ligne)']];
  const HAUTEUR_LIGNE = 40;   // hauteur d'une case d'une ligne (px), comme les autres cases de la barre
  function caseNote(d, s, champ) {
    const [classe, libelle, cleH] = NOTES[champ];
    return `
        <div class="b-note ${classe}">
          <textarea class="b-texte" data-note="${champ}" data-id="${d.id}" data-seg="${s.id}" ${s[cleH] ? `data-h="${s[cleH]}"` : ''} rows="1" placeholder="${libelle}" aria-label="${libelle}" autocomplete="off">${esc(s[champ] || '')}</textarea>
          <div class="b-hauteur" role="group" aria-label="Hauteur de la case ${libelle}">${BOUTONS_HAUTEUR.map(([sens, icone, titre]) =>
            `<button type="button" data-a="hauteur" data-sens="${sens}" title="${titre}" aria-label="${titre}">${icone}</button>`).join('')}</div>
        </div>`;
  }

  // Interventions antérieures de la semaine d'astreinte (double clic sur la barre), de la plus récente à la plus ancienne
  function interventionsAnterieures(d, autres) {
    return `
        <div class="b-interventions">
          ${autres.map((s) => `
          <div class="b-interv">
            <span class="b-type">${iconeType(s.type)} ${esc(s.type)}</span>
            ${caseNote(d, s, 'memo')}
            <div class="b-horaire" data-horaire-seg data-id="${d.id}" data-seg="${s.id}">${casesHoraire(d, s)}</div>
            ${caseNote(d, s, 'commentaire')}
            <button class="b-suppr" data-a="supprimer-interv" data-id="${d.id}" data-seg="${s.id}" aria-label="Supprimer cette intervention" title="Supprimer cette intervention">✕</button>
            ${ligneValidation(d, s)}
          </div>`).join('')}
        </div>`;
  }

  /* Une barre = un dossier = un patient sur une semaine d'astreinte (lundi 9 h → lundi suivant 8 h 59).
     Elle affiche la dernière intervention ; les précédentes s'affichent au double clic (ou via « +N »). */
  function barreDossier(d) {
    const segs = [...d.segments].sort((a, b) => b.debut - a.debut);
    const actif = segs.find((s) => s.fin == null);
    const montre = actif || segs[0];
    const autres = segs.filter((s) => s !== montre);
    const deplie = autres.length && ui.deplies.has(d.id);
    const histo = autres.length ? `<button class="b-histo ${deplie ? 'actif' : ''}" data-a="historique" data-id="${d.id}"
      title="${pluriel(autres.length, 'intervention')} plus tôt dans la semaine d'astreinte (double clic sur la barre)">+${autres.length} ${deplie ? '▴' : '▾'}</button>` : '';
    return `
      <article class="ligne-dossier ${actif ? 'ligne-active' : ''} ${classeHad(d.etab)}" data-barre="${d.id}">
        <div class="b-champ b-nom">
          <input data-f="nom3" data-id="${d.id}" value="${esc(d.nom3)}" placeholder="Nom" aria-label="Nom" autocapitalize="characters" autocomplete="off" spellcheck="false">
          ${histo}
        </div>
        <input class="b-pr" data-f="prenom2" data-id="${d.id}" value="${esc(d.prenom2)}" placeholder="Prénom" aria-label="Prénom" autocapitalize="characters" autocomplete="off" spellcheck="false">
        <input class="b-rpss" data-f="rpss" data-id="${d.id}" value="${esc(d.rpss || '')}" placeholder="RPSS" aria-label="RPSS" inputmode="numeric" autocomplete="off" spellcheck="false">
        ${selectAntenne(d, 'b-ant')}
        ${caseNote(d, montre, 'memo')}
        <div class="b-horaire" data-horaire-seg data-id="${d.id}" data-seg="${montre.id}">${casesHoraire(d, montre)}
        </div>
        ${actif
          ? `<button class="b-rep btn-barre-encours" data-a="stop" title="Chronomètre en cours : toucher pour l'arrêter"><span class="pulse" aria-hidden="true"></span> En cours</button>`
          : `<button class="b-rep btn-barre-reprise" data-a="reprise" data-id="${d.id}" title="Nouvelle intervention pour ce patient : le chronomètre repart (celui du dossier en cours s'arrête)">▶ Reprise</button>`}
        ${caseNote(d, montre, 'commentaire')}
        ${autres.length
          ? `<button class="b-suppr" data-a="supprimer-interv" data-id="${d.id}" data-seg="${montre.id}" aria-label="Supprimer cette intervention" title="Supprimer cette intervention (les précédentes sont conservées)">✕</button>`
          : `<button class="b-suppr" data-a="supprimer-barre" data-id="${d.id}" aria-label="Supprimer ce dossier" title="Supprimer ce dossier">✕</button>`}
        ${ligneValidation(d, montre)}
        ${ligneProposition(d)}
        ${deplie ? interventionsAnterieures(d, autres) : ''}
      </article>`;
  }

  /* « Même patient ? » : une barre plus ancienne de la même semaine d'astreinte, même antenne, NOM et initiale
     compatibles (Rules.patientsCompatibles) mais pas identiques (sinon déjà réunies d'office). Proposé sur la plus
     récente des deux : « Réunir » la verse dans l'ancienne, « Non » la marque comme homonyme (comptée à part). */
  function patientProche(d) {
    if (!d.antenne || !d.segments.length) return null;
    const semaine = Rules.cleSemaine(S.debutDossier(d));
    return S.dossiersActifs().filter((x) => x !== d && x.antenne === d.antenne && x.segments.length && x.creeLe < d.creeLe
      && Rules.cleSemaine(S.debutDossier(x)) === semaine && Rules.patientsCompatibles(x, d))
      .sort((a, b) => b.creeLe - a.creeLe)[0] || null;
  }
  const nomCourt = (d) => [d.nom3, d.prenom2].filter(Boolean).join('-').toUpperCase();   // « DUP », « DUPONT-JE »
  function ligneProposition(d) {
    const x = patientProche(d);
    if (!x) return '';
    return `
        <div class="b-proposition" role="alert">
          <span>Même patient que <b>${esc(nomCourt(x))}</b> (${esc(x.antenne)}, ${jjmm(S.debutDossier(x))}) ?</span>
          <button class="btn-mini" data-a="reunir-patient" data-id="${d.id}" data-avec="${x.id}">Réunir</button>
          <button class="btn-mini" data-a="patient-distinct" data-id="${d.id}">Non, homonyme</button>
        </div>`;
  }

  // Flèches des boutons ronds ‹ / › de changement de semaine (chevron épais, à la couleur du texte du bouton)
  const fleche = (d) => `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="${d}"/></svg>`;
  const FLECHE = { g: fleche('M15 4.5 7.5 12l7.5 7.5'), d: fleche('M9 4.5 16.5 12 9 19.5') };

  // Titre des barres avec ‹ / › : revoir (et corriger) les dossiers d'une semaine d'astreinte passée
  function navAppels(n) {
    const b = Rules.bornesSemaine(semaineAppels());
    const courante = !ui.decalAppels;
    return `
      <div class="nav-semaine nav-appels">
        <button class="btn-rond" data-a="sem-appels" data-n="-1" aria-label="Semaine précédente" title="Semaine précédente">${FLECHE.g}</button>
        <div>
          <h2 class="titre-section">${courante ? 'Dossiers de la semaine' : `Semaine du ${fmtDate(b.debut)}`} <span class="compteur">${n}</span></h2>
          <small>${fmtDate(b.debut)} 9h → ${fmtDate(b.fin)} 9h${courante ? ' (en cours)' : ''}</small>
          ${courante ? '' : '<button class="lien" data-a="sem-appels" data-n="0">↩ Revenir à la semaine en cours</button>'}
        </div>
        <button class="btn-rond" data-a="sem-appels" data-n="1" aria-label="Semaine suivante" title="Semaine suivante" ${courante ? 'disabled' : ''}>${FLECHE.d}</button>
      </div>`;
  }

  function vueAccueil() {
    const liste = dossiersBarres();
    return `
      <button class="lien changer-mode" data-a="mode" data-v="simple">⏱ Passer en mode Simplifié</button>
      ${bandeauNouveau()}
      ${bandeauxAlerte()}
      ${navAppels(liste.length)}
      ${liste.length ? `${enteteBarres()}<div class="lignes-dossiers">${liste.map(barreDossier).join('')}</div>`
        : ui.decalAppels ? '<p class="vide">Aucun dossier cette semaine-là.</p>'
        : `<p class="vide">Aucun dossier cette semaine.<br>Touchez « Nouveau dossier » dès qu'un appel arrive.</p>`}`;
  }

  // Redessine une barre en gardant le curseur dans la même case (saisie au clavier sans interruption)
  function rafraichirBarre(id) {
    const el = $(`[data-barre="${id}"]`);
    const d = dossier(id);
    if (!el || !d) return;
    const f = el.contains(document.activeElement) ? document.activeElement : null;
    const cible = f && (f.dataset.sel ? `[data-sel=${f.dataset.sel}]` : f.dataset.f ? `[data-f=${f.dataset.f}]`
      : f.dataset.note ? `[data-note=${f.dataset.note}][data-seg="${f.dataset.seg}"]` : f.name ? `[name=${f.name}]` : '');
    el.outerHTML = barreDossier(d);
    ajusterTout($(`[data-barre="${id}"]`));
    if (cible) { const x = $(`[data-barre="${id}"] ${cible}`); if (x) x.focus(); }
    majConflits();
    tic();
  }

  /* Horaire d'une intervention (barre ou intervention antérieure) : Date, Début, Fin, Durée. Règles fixes :
       - Début (ou Date) modifié → la Fin s'adapte (Durée gardée) ;
       - Durée modifiée → la Fin s'adapte ;
       - Fin modifiée → la Durée s'adapte (Durée = Fin − Début).
     Une fin plus tôt que le début tombe le lendemain (appel à cheval sur minuit).
     Rien n'est enregistré ici : les valeurs vont dans le brouillon, à valider. */
  function majHoraireSeg(el) {
    const zone = el.closest('[data-horaire-seg]');
    const d = dossier(zone.dataset.id);
    const s = d && d.segments.find((x) => x.id === zone.dataset.seg);
    if (!s) return;
    const champ = (k) => $(`[name=${k}]`, zone);
    // Calcul en dates locales (et non en 24 h fixes) : juste aussi les jours de changement d'heure
    const date = champ('date').value;
    const iso = isoDepuisJJMM(date);
    const a = (k) => (iso ? new Date(`${iso}T${champ(k).value}`).getTime() : NaN);
    const debut = a('debut');
    $('[data-tag-date]', zone).textContent = Number.isNaN(debut) ? '' : tagDate(debut);
    const jd = $('[data-jour-debut]', zone);
    if (jd) jd.textContent = Number.isNaN(debut) ? '' : jourCourt(debut);
    if (!Number.isNaN(debut)) {
      if (s.fin != null) {
        let fin;
        if (el.name === 'fin') {
          fin = a('fin');
          if (!Number.isNaN(fin)) {
            if (fin < debut) fin = lendemain(fin);
            champ('duree').value = Math.round((fin - debut) / 60000);
          }
        } else {
          fin = debut + Math.max(0, Math.round(Number(champ('duree').value) || 0)) * 60000;
          champ('fin').value = fmtHeure(fin);
        }
        $('[data-tag-fin]', zone).textContent = Number.isNaN(fin) ? '' : tagFin(debut, fin);
        const jf = $('[data-jour-fin]', zone);
        if (jf) jf.innerHTML = Number.isNaN(fin) ? '' : jourFin(fin);
      }
    }
    ui.brouillons[s.id] = s.fin == null
      ? { date, debut: champ('debut').value }
      : { date, debut: champ('debut').value, fin: champ('fin').value, duree: champ('duree').value };
    ui.forcer.delete(s.id);
    const v = $(`[data-validation="${s.id}"]`);
    if (v) v.hidden = false;
    majConflits();
  }

  // Après validation : la ligne reste visible (défilement jusqu'à elle) et clignote brièvement
  function montrerBarre(id) {
    const el = $(`[data-barre="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  /* Saisie terminée dans une barre (champ quitté) : la règle « un dossier = un patient sur une semaine »
     est réappliquée (doublon réuni, intervention de la semaine suivante séparée), puis la barre repasse en haut. */
  function apresSaisieBarre(el) {
    const barre = el.closest('[data-barre]');
    if (!barre) return;
    const r = S.regrouper();
    if (!r.fusions.length && !r.scindes.length) {
      const d = dossier(barre.dataset.barre);
      if (d && (barre.querySelector('.b-proposition') || patientProche(d))) rafraichirBarre(d.id);
      remonterBarre(barre.dataset.barre);
      return;
    }
    const f = r.fusions.find((x) => x.verse.id === barre.dataset.barre) || r.fusions[0];
    const cible = f ? f.garde.id : barre.dataset.barre;
    // Le curseur reprend la case où il allait (Tab) si elle est dans la même barre, sinon la case quittée
    const vers = barre.contains(document.activeElement) ? document.activeElement : el;
    const champ = vers.dataset.f ? `[data-f=${vers.dataset.f}]` : vers.dataset.sel ? `[data-sel=${vers.dataset.sel}]`
      : vers.dataset.note ? `[data-note=${vers.dataset.note}][data-seg="${vers.dataset.seg}"]` : '';
    rendre();
    const x = champ && $(`[data-barre="${cible}"] ${champ}`);
    if (x) x.focus();
    toast(f ? `${S.codePatient(f.garde)} : dossier déjà ouvert cette semaine d'astreinte, intervention ajoutée`
      : 'Intervention de la semaine d\'astreinte suivante : nouveau dossier');
  }

  // Choisir l'antenne renseigne aussi, en arrière-plan, le HAD auquel elle appartient
  function choisirEtabAntenne(el) {
    const d = dossier(el.dataset.id);
    d.antenne = el.value;
    const e = S.state.config.etablissements.find((x) => Rules.antennesDe(x).includes(d.antenne));
    d.etab = e ? e.nom : '';
    S.toucher(d);
    rafraichirBarre(d.id);
    // L'antenne fait partie de l'identité du patient : la barre peut rejoindre un dossier déjà ouvert cette semaine
    const sel = $(`[data-barre="${d.id}"] [data-sel=antenne]`);
    if (sel) apresSaisieBarre(sel); else remonterBarre(d.id);
    if (el.closest('.simple-ligne')) {
      $$(`.simple-ligne [data-sel=antenne][data-id="${d.id}"]`).forEach((x) => { x.outerHTML = selectAntenne(d, 'simple-ant'); });
      majAlerteAntennesSimple();
    }
  }

  /* ---------- Onglet Semaine ---------- */
  function blocEffectifs(cle) {
    const sem = S.state.semaines[cle] || { effectifs: {} };
    return `<div class="eff-grille">${S.state.config.etablissements.map((e) => {
      const total = Rules.antennesDe(e).reduce((t, a) => t + (Number(sem.effectifs[`${e.nom}|${a}`]) || 0), 0);
      return `
        <div class="eff-etab ${classeHad(e.nom)}">
          <div class="eff-titre"><b>${esc(e.nom)}</b><span data-eff-total="${esc(e.nom)}">${total} patients</span></div>
          ${Rules.antennesDe(e).map((a) => {
            const k = `${e.nom}|${a}`;
            return `<label class="eff-ligne"><span>${e.antennes.length ? esc(a) : 'Établissement (sans antenne)'}</span>
              <input type="number" min="0" step="1" inputmode="numeric" placeholder="0"
                data-eff="${esc(k)}" data-sem="${cle}" value="${sem.effectifs[k] != null ? sem.effectifs[k] : ''}"></label>`;
          }).join('')}
        </div>`;
    }).join('')}</div>`;
  }

  function navSemaine() {
    const b = Rules.bornesSemaine(ui.semaine);
    const courante = ui.semaine === Rules.cleSemaine(Date.now());
    return `
      <div class="nav-semaine">
        <button class="btn-rond" data-a="sem" data-n="-1" aria-label="Semaine précédente" title="Semaine précédente">${FLECHE.g}</button>
        <div><b>Semaine du ${fmtDate(b.debut)}${courante ? ' (en cours)' : ''}</b>
          <small>${fmtDate(b.debut)} 9h → ${fmtDate(b.fin)} 9h</small></div>
        <button class="btn-rond" data-a="sem" data-n="1" aria-label="Semaine suivante" title="Semaine suivante">${FLECHE.d}</button>
      </div>`;
  }

  function vueSemaine() {
    const cle = ui.semaine;
    const { debut, fin } = Rules.bornesSemaine(cle);
    const feries = Rules.feriesDeLaSemaine(cle);
    const sem = S.state.semaines[cle] || { note: '' };
    const lignes = [];
    S.dossiersActifs().forEach((d) => d.segments.forEach((s) => {
      if (s.debut >= debut && s.debut < fin) lignes.push({ d, s });
    }));
    lignes.sort((a, b) => a.s.debut - b.s.debut);
    return `
      ${navSemaine()}
      ${feries.length ? `<p class="info">🎌 Férié (compté comme week-end) : ${feries.map((f) => `${fmtDate(f.date)} ${esc(f.nom)}`).join(', ')}</p>` : ''}
      <section class="bloc">
        <h3>Patients présents</h3>
        <p class="aide">À saisir le lundi, par antenne. Modifiable à tout moment.</p>
        ${blocEffectifs(cle)}
      </section>
      <section class="bloc">
        <h3>Note de couverture / remplacement</h3>
        <textarea data-semnote="${cle}" rows="2" placeholder="Ex. : j'ai couvert du mardi 17h30 au jeudi 9h, remplacé par Dr X">${esc(sem.note)}</textarea>
      </section>
      <section class="bloc">
        <h3>Chronologie <span class="compteur">${lignes.length}</span></h3>
        ${lignes.length ? `<ul class="chrono-liste">${lignes.map(({ d, s }) => `
          <li class="${classeHad(d.etab)}"><button data-a="ouvrir-dossier" data-id="${d.id}">
            <span class="cl-heure">${fmtDate(s.debut)}<b>${fmtHeure(s.debut)}</b></span>
            <span class="cl-corps">${iconeType(s.type)} ${esc(s.type)} · <b>${esc(S.codePatient(d) || '?')}</b> ${esc(d.antenne)}
              <small>${fmtDuree(S.dureeSegment(s))}${s.medecin ? ' · ' + esc(s.medecin) : ''}</small></span>
          </button></li>`).join('')}</ul>` : '<p class="vide">Aucune activité enregistrée.</p>'}
      </section>`;
  }

  /* ---------- Onglet Statistiques ---------- */
  function periode() {
    if (ui.periode === '30j') {
      const fin = Date.now() + 60000;
      return { debut: fin - 30 * 864e5, fin, libelle: `30j_${valDate(Date.now())}`, titre: '30 derniers jours' };
    }
    if (ui.periode === 'tout') return { debut: 0, fin: Date.now() + 60000, libelle: `tout_${valDate(Date.now())}`, titre: 'Toutes les données' };
    const b = Rules.bornesSemaine(ui.semaine);
    return { ...b, libelle: `semaine_${ui.semaine}`, titre: `Semaine du ${fmtDate(b.debut)}` };
  }

  function choixPeriode() {
    const opt = [['semaine', 'Semaine'], ['30j', '30 jours'], ['tout', 'Tout']];
    return `<div class="segmente">${opt.map(([v, l]) => `<button class="${ui.periode === v ? 'actif' : ''}" data-a="periode" data-v="${v}">${l}</button>`).join('')}</div>
      ${ui.periode === 'semaine' ? navSemaine() : ''}`;
  }

  /* extra : 2e colonne de chiffres après la valeur ; entete : intitulés des colonnes de chiffres, au-dessus des barres
     (les colonnes sont alors alignées d'une barre à l'autre) */
  function barres(items, { valeur = (x) => x.n, libelle = (x) => x.nom, format = (v) => v, classe = () => '', extra = null, entete = null } = {}) {
    if (!items.length) return '<p class="vide">Aucune donnée.</p>';
    const max = Math.max(...items.map(valeur), 1);
    const ligneEntete = entete ? `<div class="barre barre-entete" aria-hidden="true"><span></span><span></span>
      ${entete.map((t) => `<span class="barre-n">${t}</span>`).join('')}</div>` : '';
    return `<div class="barres${entete ? ' a-entete' : ''}${extra ? ' a-extra' : ''}">${ligneEntete}${items.map((x) => `
      <div class="barre ${classe(x)}"><span class="barre-nom">${esc(libelle(x))}</span>
        <span class="barre-piste"><span class="barre-val" style="width:${(valeur(x) / max) * 100}%"></span></span>
        <span class="barre-n">${format(valeur(x))}</span>${extra ? `<span class="barre-n barre-extra">${extra(x)}</span>` : ''}</div>`).join('')}</div>`;
  }

  const fmt1 = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toLocaleString('fr-FR'));

  /* Tableau « Par établissement et antenne ».
     Effectif J1 : patients présents de l'antenne (somme pour l'établissement et le total), saisis pour la semaine
     du 1er jour de la période.
     Durée : temps des interventions, sans doublon ; ligne « Plages W continu » à part ; Total = les deux, sans doublon.
     Minutes/jour % patients : Durée (min) ÷ effectif × 100 ÷ jours écoulés de la période
     (ex. 87 min ÷ 120 patients × 100 ÷ 3,3 jours ≈ 22).
     9h-20h % / 20h-24h % / 0h-9h % (formule A) : même calcul avec le temps passé dans la tranche ; la somme des trois
     égale « Minutes/jour % patients ». Infobulle (formule B) : ÷ la durée de la tranche en heures.
     Sam 9h-9h, Dim/Fer 9h-9h : charge d'une de ces journées par rapport à l'effectif = minutes de travail de ces
     journées ÷ effectif × 100 ÷ nombre de ces journées dans la période (1 samedi, 60 min, 113 patients → 53,1 ;
     un dimanche + un férié → ÷ 2 ; un mois avec 4 dimanches → ÷ 4). */
  /* Infobulles des intitulés (tableau Stats, NOM des barres) : affichées au survol (ou au clavier) d'un intitulé [data-info].
     Une seule bulle flottante (position fixe : elle n'est pas rognée par le défilement horizontal du tableau),
     dimensionnée pour rester proche d'un carré plutôt qu'en longue bande. */
  const INFOS = {
    nom: `<p><b>Un patient = ANTENNE + NOM (3&nbsp;premières lettres) + initiale du PRÉNOM.</b></p>
      <ul>
        <li><b>NOM</b>&nbsp;: accents, espaces, tirets ignorés. Dupont, DUPOND, Du&nbsp;Pont → DUP.</li>
        <li><b>PRÉNOM</b>&nbsp;: initiale seule, facultative. JEAN, JE, J → J. Sans prénom&nbsp;: rattaché au patient
          de même NOM et même antenne (le plus proche dans le temps).</li>
        <li><b>ANTENNE</b>&nbsp;: obligatoire. DUPONT-JEAN à Brignoles et à Menton = 2&nbsp;patients.</li>
        <li><b>Sans NOM</b>&nbsp;: le dossier compte seul.</li>
      </ul>
      <p>Même semaine&nbsp;: barres identiques → réunies d'office&nbsp;; proches (DUP / DUPONT-JEAN) → «&nbsp;Même
        patient&nbsp;?&nbsp;» Réunir, ou Non (homonyme, compté à part).</p>
      <p>Limite&nbsp;: PHILIPPE / FILIPPE → PHI ≠ FIL = 2&nbsp;patients.</p>`,
    effectif: `<p>Patients présents le 1<sup>er</sup> jour de la période d'astreinte.</p>`,
    duree: `<p>Cumul du temps d'intervention de la période d'astreinte. Cela inclut&nbsp;:</p>
      <ul><li>la somme des durées de chaque instance de chaque dossier&nbsp;;</li><li>les Plages de Travail continu.</li></ul>
      <p>L'utilisateur qui travaille de façon continue, sans interruption, peut déclarer un début de plage et une fin
        de plage. Cela permet de comptabiliser les moments travaillés qui n'auraient pas été enregistrés
        («&nbsp;Clics&nbsp;» non déclenchés).</p>
      <p>La comptabilisation prendra en compte les instances et les intermèdes travaillés non identifiés
        (mais en évitant tout doublon de temps de W).</p>`,
    minutes: `<p>Permet de comparer les «&nbsp;Temps de W&nbsp;» au bénéfice des différentes structures, puisque rapportés à une file
        active de 100 patients et à 1 journée.</p>`,
    tranche: `<p>Idem à Minutes/jour % patients, mais par tranche horaire.</p>`,
  };

  function montrerInfo(th) {
    let bulle = $('#infobulle');
    if (!bulle) {
      bulle = document.createElement('div');
      bulle.id = 'infobulle';
      bulle.setAttribute('role', 'tooltip');
      document.body.append(bulle);
    }
    bulle.innerHTML = INFOS[th.dataset.info];
    th.setAttribute('aria-describedby', 'infobulle');
    // Largeur visée ≈ côté d'un carré de même surface que le texte, puis élargie si la bulle reste trop haute
    const max = Math.min(420, innerWidth - 16);
    let l = Math.min(max, Math.max(160, Math.round(Math.sqrt(bulle.textContent.length * 150))));
    bulle.style.width = `${l}px`;
    bulle.hidden = false;
    if (bulle.offsetHeight > l * 1.1 && l < max) bulle.style.width = `${l = Math.min(max, Math.round(Math.sqrt(l * bulle.offsetHeight)))}px`;
    const r = th.getBoundingClientRect();
    const h = bulle.offsetHeight;
    bulle.style.left = `${Math.max(8, Math.min(innerWidth - l - 8, r.left + r.width / 2 - l / 2))}px`;
    bulle.style.top = `${r.bottom + 8 + h <= innerHeight - 8 || r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8}px`;
  }
  function cacherInfo() {
    const bulle = $('#infobulle');
    if (bulle) bulle.hidden = true;
  }

  function tableStats(st) {
    const effectif = (c, temps) => (c.npatients && st.nbJours > 0 ? (temps / 60000 / c.npatients) * 100 / st.nbJours : null);
    // Une case par tranche : formule A affichée, formule B (par heure de tranche) en infobulle
    const casesTranches = (c, tranches) => st.TRANCHES.map(([k, h1, h2]) => {
      const a = effectif(c, tranches[k]);
      return `<td${a == null ? '' : ` title="Intensité : ${fmt1(a / (h2 - h1))} min pour 100 patients par heure de tranche (${h2 - h1} h)"`}>${fmt1(a)}</td>`;
    }).join('');
    // Samedi, dimanche / férié : minutes de ces journées ÷ effectif × 100 ÷ nombre de ces journées dans la période
    const casesJours = (c, jours) => [['samedi', 'samedi'], ['dimFerie', 'dimanche / férié']].map(([k, nom]) => {
      const n = st.nbJoursType[k];
      const r = c.npatients && n > 0 ? (jours[k] / 60000 / c.npatients) * 100 / n : null;
      return `<td title="${n} journée${n > 1 ? 's' : ''} de ${nom} dans la période">${fmt1(r)}</td>`;
    }).join('');
    const ligne = (c, classe, nom, temps = c.tempsInstances, jours = c.jours, tranches = c.tranches) => `
      <tr class="${classe} ${classeHad(c.etab || (classe === 'ligne-etab' ? c.nom : ''))}"><th>${esc(nom)}</th><td>${c.npatients == null ? '—' : c.npatients}</td>
        <td>${fmtDuree(temps)}</td><td>${fmt1(effectif(c, temps))}</td>${casesTranches(c, tranches)}${casesJours(c, jours)}</tr>`;
    const corps = st.etabs.map((e) => ligne(e, 'ligne-etab', e.nom)
      // Établissement sans antenne : pas de sous-ligne qui répéterait la ligne de l'établissement
      + st.antennes.filter((a) => a.etab === e.nom && a.nom !== e.nom).map((a) => ligne(a, '', a.nom)).join('')).join('');
    const tr = st.transversal;
    const ligneTransversal = tr.temps > 0 ? `
      <tr class="ligne-etab"><th>Plages W continu</th><td>—</td>
        <td>${fmtDuree(tr.temps)}</td><td>${fmt1(effectif(st.total, tr.temps))}</td>${casesTranches(st.total, tr.tranches)}${casesJours(st.total, tr.jours)}</tr>` : '';
    const intitule = (info, nom) => `<th data-info="${info}" tabindex="0">${nom}</th>`;
    return `
      <div class="table-defile"><table class="stats">
        <thead><tr><th>Établissement / antenne</th>${intitule('effectif', 'Effectif J1')}
          ${intitule('duree', 'Durée')}
          ${intitule('minutes', 'Minutes/jour % patients')}
          ${intitule('tranche', '9h-20h %')}${intitule('tranche', '20h-24h %')}${intitule('tranche', '0h-9h %')}
          ${intitule('tranche', 'Sam 9h-9h %')}${intitule('tranche', 'Dim/Fer 9h-9h %')}</tr></thead>
        <tbody>${corps}${ligneTransversal}${ligne(st.total, 'ligne-total', 'Total', st.total.tempsTotal, st.total.joursTotal, st.total.tranchesTotal)}</tbody>
      </table></div>`;
  }

  /* Graphiques « Recours à l'astreinte » (sous le tableau) : une barre par HAD et par antenne (les lignes du
     tableau), rangées ensemble par recours décroissant, de haut en bas. Couleur par HAD (classe had-<nom>) :
     SSV en bleus, NICE en verts, SSBDR (Arles) en gris ; foncé pour le HAD, plus clair pour ses antennes. Un HAD à une seule antenne n'a qu'une barre
     (« SSBDR Arles »). Valeur = minutes ÷ Effectif J1 × 100 ÷ nombre de jours ; pas d'Effectif J1 : pas de barre.
     1) toute la période ; 2) nuit 0h-9h, tous jours confondus ; 3) samedis, dimanches et fériés réunis en une
     moyenne commune : leurs minutes additionnées ÷ leur nombre de journées (et non la somme de deux moyennes).
     Écart à la moyenne globale : valeur de la barre ÷ même calcul pour le Total (tous les HAD), ex. 1,5 x
     (1,5 fois la moyenne de toutes les antennes/HAD). */
  function unitesRecours(st) {
    return st.etabs.flatMap((e) => {
      const conf = S.state.config.etablissements.find((x) => x.nom === e.nom);
      const seule = conf && Rules.antennesDe(conf).length === 1 ? Rules.antennesDe(conf)[0] : null;
      if (seule) return [{ c: e, nom: seule === e.nom ? e.nom : `${e.nom} ${seule}`, etab: e.nom, had: true }];
      return [{ c: e, nom: e.nom, etab: e.nom, had: true },
        ...st.antennes.filter((a) => a.etab === e.nom && a.nom !== e.nom).map((a) => ({ c: a, nom: a.nom, etab: e.nom }))];
    });
  }

  /* Effectif J1 manquant : antenne (ou HAD sans antenne) qui a du temps d'intervention dans la période, mais aucun
     patient présent saisi pour la semaine de J1. Pas de correction : son temps reste dans la barre de son HAD, sans ses
     patients au dénominateur (recours surestimé), et elle n'a pas de barre. On le signale, avec le moyen de le saisir.
     Les dossiers sans antenne ont leur propre alerte. */
  function alerteEffectifsJ1(st) {
    const manquants = st.antennes.filter((a) => a.etab !== 'Non renseigné' && a.nom !== 'Non renseigné'
      && a.tempsInstances > 0 && a.npatients == null);
    if (!manquants.length) return '';
    const noms = manquants.map((a) => esc(a.nom === a.etab ? a.etab : `${a.etab} ${a.nom}`)).join(', ');
    const semaine = fmtDate(Rules.bornesSemaine(st.semaineJ1).debut);
    return `<p class="alerte-antenne">⚠ Effectif J1 manquant : <b>${noms}</b>. Sans ces patients présents, le recours à
      l'astreinte est absent ou surestimé. À saisir dans l'onglet Semaine, semaine du ${semaine} (1<sup>er</sup> jour
      de la période), « Patients présents ».
      <button class="btn-texte" data-a="feuille-effectifs" data-v="${st.semaineJ1}">Saisir maintenant</button></p>`;
  }

  function graphiquesRecours(st) {
    const parJour = (c, temps, n) => (c.npatients && n > 0 ? (temps / 60000 / c.npatients) * 100 / n : null);
    const unites = unitesRecours(st);
    const sansEffectif = '<p class="vide">Saisissez le nombre de patients présents par antenne (onglet Semaine) pour obtenir ce graphique.</p>';
    const fois = (x) => `${x.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}&nbsp;x`;
    const graphique = (titre, sousTitre, valeur, vide = sansEffectif) => {
      const items = unites.map((u) => ({ ...u, v: valeur(u.c) })).filter((u) => u.v != null).sort((a, b) => b.v - a.v);
      const moyenne = valeur(st.total);
      return `<section class="bloc recours"><h3>${titre}</h3><p class="aide">${sousTitre}</p>
        ${items.length ? barres(items, {
          valeur: (x) => x.v, format: fmt1, classe: (x) => `${classeHad(x.etab)} ${x.had ? 'barre-had' : ''}`,
          extra: (x) => (moyenne > 0 ? fois(x.v / moyenne) : '—'),
          entete: ['Minutes/<wbr>jour pour 100 patients', 'Écart à la moyenne globale'],
        }) : vide}</section>`;
    };
    const nWe = st.nbJoursType.samedi + st.nbJoursType.dimFerie;
    return graphique('Recours à l\'astreinte', 'Minutes/jour % patients',
      (c) => parJour(c, c.tempsInstances, st.nbJours))
      + graphique('Recours à l\'astreinte : nuit 0h-9h', 'Minutes/jour % patients, de 0 h à 9 h, tous jours confondus',
        (c) => parJour(c, c.tranches.nuit, st.nbJours))
      + graphique('Recours à l\'astreinte : samedis, dimanches et fériés',
        'Minutes/jour % patients, moyenne commune de ces journées (9 h → 9 h le lendemain)',
        (c) => parJour(c, c.jours.samedi + c.jours.dimFerie, nWe),
        nWe ? sansEffectif : '<p class="vide">Aucun samedi, dimanche ni jour férié dans la période.</p>');
  }

  /* Carte « Horaires d'interventions » : une case par jour de la semaine et par heure. Pavé bleu = 30 min ou plus
     d'interventions dans l'heure (cumul de la période, Reprises comprises) ; rond bleu = moins de 30 min ; vide = rien.
     Fond des cases selon la tranche (9h-20h pâle, 20h-24h moyen, 0h-9h foncé), le même pour tous les jours ;
     samedi et dimanche détachés de la semaine par un interstice plus large.
     En fin de ligne : temps d'intervention et patients distincts de ce jour ; si la période compte plus d'un de ces
     jours (astreinte de 2 semaines : 2 lundis), moyenne par jour, notée « /j ». Ligne Total : temps et patients
     distincts de toute la période (jamais en moyenne).
     Sous la carte : bandeau de chaque tranche sous ses colonnes, puis soleils (9h-19h) et lunes (20h-8h) qui
     grandissent jusqu'au milieu de leur plage (14h, 2h) puis rapetissent. */
  const SEUIL_HORAIRE = 30;   // minutes (arrondies comme dans l'infobulle de la case)
  const trancheCase = (h) => (h < 9 ? 'nuit' : h >= 20 ? 'soir' : 'jour');
  function astre(h) {
    const soleil = h >= 9 && h <= 19;
    const k = soleil ? h - 9 : (h + 4) % 24;   // rang dans la plage : 0 → 10 (soleil), 0 → 12 (lune)
    const milieu = soleil ? 5 : 6;
    const taille = Math.round(8 + 12 * (1 - Math.abs(k - milieu) / (milieu + 1)));
    return soleil
      ? `<svg class="soleil" width="${taille}" height="${taille}" viewBox="-10 -10 20 20"><circle r="4.5"/>${
        Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="-6.5" x2="0" y2="-9.5" transform="rotate(${i * 45})"/>`).join('')}</svg>`
      : `<svg class="lune" width="${taille}" height="${taille}" viewBox="-10 -10 20 20"><path d="M4 -6.93A8 8 0 1 0 4 6.93A7 7 0 0 1 4 -6.93Z" transform="rotate(-25)"/></svg>`;
  }
  function finLigneChaleur(st, i) {
    const n = st.joursSemaine.nb[i];
    const ms = st.tempsHoraires[i].reduce((t, x) => t + x, 0);
    const p = st.joursSemaine.patients[i];
    const moyenne = n > 1.01;
    const parJ = moyenne ? '<small>/j</small>' : '';
    const titre = moyenne ? ` title="Moyenne sur ${fmt1(n)} journées"` : '';
    return `<td class="fin-ligne"${titre}>${ms > 0 ? fmtDuree(moyenne ? ms / n : ms) + parJ : '—'}</td>
      <td class="fin-ligne"${titre}>${p > 0 ? fmt1(moyenne ? p / n : p) + parJ : '—'}</td>`;
  }
  function carteChaleur(st) {
    const jours = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const tempsTotal = st.tempsHoraires.flat().reduce((t, x) => t + x, 0);
    // Période d'une semaine (lundi 9h → lundi 9h) : sur la ligne du lundi, 0h-9h est le lundi suivant (renvoi *)
    const uneSemaine = ui.periode === 'semaine';
    const options = ['<option value="">Tous établissements</option>'];
    S.state.config.etablissements.forEach((e) => {
      options.push(`<option value="${esc(e.nom)}" ${ui.cibleHeat === e.nom ? 'selected' : ''}>${esc(e.nom)}</option>`);
      e.antennes.forEach((a) => {
        const k = `${e.nom}|${a}`;
        options.push(`<option value="${esc(k)}" ${ui.cibleHeat === k ? 'selected' : ''}>&nbsp;&nbsp;${esc(a)}</option>`);
      });
    });
    return `
      <div class="entete-chaleur">
        <select data-heat>${options.join('')}</select>
        <p class="aide legende-chaleur"><span class="plein"></span> 30 min ou plus dans l'heure
          <span class="point"></span> moins de 30 min</p>
      </div>
      <div class="table-defile"><table class="chaleur">
        <thead><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h}</th>`).join('')}
          <th class="fin-ligne">Durée</th><th class="fin-ligne">Patients</th></tr></thead>
        <tbody>${st.tempsHoraires.map((l, i) => `${i === 5 ? '<tr class="sep-we" aria-hidden="true"><td colspan="27"></td></tr>' : ''}
          <tr class="${i >= 5 ? 'we' : ''}"><th>${jours[i]}${i === 0 && uneSemaine ? '<sup class="renvoi">*</sup>' : ''}</th>${l.map((ms, h) => `
          <td class="${trancheCase(h)} ${Math.round(ms / 60000) >= SEUIL_HORAIRE ? 'plein' : ms > 0 ? 'point' : ''}${i === 0 && h < 9 && uneSemaine ? ' renvoi-case' : ''}"
            title="${jours[i]} ${h}h-${h + 1}h${i === 0 && h < 9 && uneSemaine ? ' (lundi suivant)' : ''} : ${ms > 0 ? fmtDuree(ms) : 'aucune intervention'}"></td>`).join('')}${finLigneChaleur(st, i)}</tr>`).join('')}
          <tr class="sep-we" aria-hidden="true"><td colspan="27"></td></tr>
          <tr class="total-chaleur"><th>Total</th><td colspan="24" class="libelle-total">toute la période</td>
            <td class="fin-ligne">${tempsTotal > 0 ? fmtDuree(tempsTotal) : '—'}</td><td class="fin-ligne">${st.patientsCible || '—'}</td></tr></tbody>
        <tfoot>
          <tr class="tranches"><th></th><td colspan="9" class="nuit">0h-9h</td><td colspan="11" class="jour">9h-20h</td>
            <td colspan="4" class="soir">20h-24h</td><td colspan="2"></td></tr>
          <tr class="astres" aria-hidden="true"><th></th>${Array.from({ length: 24 }, (_, h) => `<td>${astre(h)}</td>`).join('')}<td colspan="2"></td></tr>
        </tfoot>
      </table></div>
      ${uneSemaine ? `<p class="aide note-chaleur">* La partie du lundi de 0h à 9h rapporte celle du lundi de fin de
        semaine d'astreinte</p>` : ''}`;
  }

  function vueStats() {
    const p = periode();
    const st = window.Stats.calculer({ debut: p.debut, fin: p.fin, cible: ui.cibleHeat });
    const t = st.total;
    const kpi = (v, l, icone) => `<div class="kpi"><i aria-hidden="true">${icone}</i><b>${v}</b><span>${l}</span></div>`;
    return `
      ${choixPeriode()}
      <div class="kpis">
        ${kpi(st.nbDenominations, st.nbDenominations > 1 ? 'patients' : 'patient', '👥')}${kpi(fmtDuree(t.tempsTotal), 'temps total', '⏱')}
        ${kpi(st.nbDenominations ? fmtDuree(t.tempsInstances / st.nbDenominations) : '—', 'par patient', '⌀')}
      </div>
      ${st.nbSansAntenne ? `<p class="alerte-antenne">⚠ ${pluriel(st.nbSansAntenne, 'dossier')} sans antenne dans la période : à compléter (onglet Appels)</p>` : ''}
      ${alerteEffectifsJ1(st)}
      <section class="bloc"><h3>Par établissement et antenne</h3>${tableStats(st)}</section>
      ${graphiquesRecours(st)}
      <section class="bloc"><h3>Horaires d'interventions</h3>${carteChaleur(st)}</section>`;
  }

  /* ---------- Visite guidée (moteur : js/visite.js) ----------
     Proposée une fois après le déverrouillage (S.state.visiteVue), relançable depuis Plus › Aide. Chaque étape met
     l'écran voulu (mode, onglet) sans rien enregistrer ; l'interface est remise comme avant à la fin. Onglet Appels
     sans dossier : une barre d'exemple (inerte, jamais enregistrée) le temps de la visite. */
  function ecranVisite(mode, onglet) {
    if (ui.mode === mode && (!onglet || ui.onglet === onglet)) return;
    ui.mode = mode;
    if (onglet) ui.onglet = onglet;
    rendre();
    window.scrollTo(0, 0);
  }
  function barreExemple() {
    const nav = $('#vue .nav-appels');
    if (!nav || $('#vue .lignes-dossiers .ligne-dossier')) return;
    const e = S.state.config.etablissements[0];
    const t = Date.now() - 40 * 60000;
    const d = {
      id: 'visite-exemple', nom3: 'DUP', prenom2: 'JE', rpss: '', etab: e ? e.nom : '', antenne: e ? Rules.antennesDe(e)[0] : '',
      creeLe: t, segments: [{ id: 'visite-exemple-1', type: 'Appel reçu', debut: t, fin: t + 12 * 60000, memo: 'Douleur : bolus PCA', commentaire: 'Rappeler l\'IDE à 22h' }],
    };
    const html = `${enteteBarres()}<div class="lignes-dossiers visite-exemple">${barreDossier(d)}</div>`;
    const vide = $('#vue > p.vide');
    if (vide) vide.outerHTML = html; else nav.insertAdjacentHTML('afterend', html);
  }
  const premiereBarre = (sel = '') => $(`#vue .lignes-dossiers .ligne-dossier ${sel}`.trim());

  function etapesVisite() {
    const appels = () => ecranVisite('standard', 'accueil');
    const exemple = !dossiersBarres().length;   // pas de barre cette semaine : barre d'exemple
    return [
      { titre: 'Bienvenue dans Astreinte Minuteur',
        texte: `<p>En 2 minutes, cette visite montre les écrans et les boutons utiles. Rien n'est modifié pendant la visite.</p>
          <p class="aide">Au clavier : ← → pour changer d'étape, Échap pour quitter.</p>`,
        boutons: { suiv: 'Commencer la visite', quitter: 'Plus tard' } },
      { aller: () => ecranVisite(''), cible: () => [...document.querySelectorAll('.choix-mode .cercle')], titre: 'Deux modes',
        texte: `<p><b>Simplifié</b> : un seul gros bouton chronomètre, pour aller vite.<br><b>Standard</b> : toute l'application.</p>
          <p>Le choix est proposé à chaque ouverture, et l'on passe de l'un à l'autre à tout moment : les données sont les mêmes.</p>` },
      { aller: () => ecranVisite('simple'), cible: '.cercle-chrono', titre: 'Mode Simplifié',
        texte: `<p>Un toucher : l'intervention démarre (cercle vert). Un autre toucher : elle s'arrête.</p>
          <p>Les interventions s'affichent dessous : choisissez l'antenne, le nom se complète plus tard en mode Standard.</p>` },
      { aller: appels, cible: '.btn-nouveau', titre: 'Un appel arrive',
        texte: `<p>Touchez <b>« Nouveau dossier »</b> : le chronomètre démarre tout de suite.
          Un seul chronomètre tourne à la fois : si celui d'un autre patient tournait encore, il s'arrête tout seul.</p>
          <p>Une barre apparaît pour ce patient.</p>` },
      { aller: appels, cible: () => premiereBarre(), assurer: barreExemple, titre: 'Une barre = un patient sur la semaine',
        texte: `<p><b>NOM</b> (3 lettres suffisent), prénom, RPSS et <b>antenne, obligatoire</b> (case orange tant qu'elle est vide).
          Mémo et Commentaire sont libres.</p><p>Remplissez-la pendant ou après l'appel.</p>
          ${exemple ? '<p class="aide">Barre d\'exemple, non enregistrée.</p>' : ''}` },
      { aller: appels, cible: () => premiereBarre('.b-horaire'), assurer: barreExemple, titre: 'Date et heures',
        texte: `<p>Pendant l'appel, Fin est un bouton <b>■ Stop</b> et la durée défile.</p>
          <p>Pour corriger une heure ou une durée (en minutes) : tapez, puis <b>« ✓ Valider »</b>. En rouge : chevauchement avec un autre appel.</p>` },
      { aller: appels, cible: () => premiereBarre('.b-rep'), assurer: barreExemple, titre: '▶ Reprise',
        texte: `<p>Nouvelle intervention pour le <b>même patient</b> (rappel, rédaction, mail…) : le chronomètre repart sur sa barre.</p>
          <p>« +N » à côté du nom affiche ses interventions précédentes de la semaine.</p>` },
      { aller: appels, cible: '.bloc-plages', titre: 'Plage W continu',
        texte: `<p>Vous avez travaillé en continu sans lancer le chronomètre ? Déclarez la plage (début, fin) :
          elle est comptée, sans double compte avec les appels.</p>` },
      { aller: appels, cible: '.bloc-cumul', titre: 'Cumul',
        texte: '<p>Votre temps des dernières 24 h et de la semaine, par tranche horaire.</p>' },
      { aller: appels, cible: '.nav-appels', titre: 'Semaines passées',
        texte: `<p>‹ et › affichent les barres d'une semaine précédente, toujours modifiables.</p>
          <p>La semaine d'astreinte va du <b>lundi 9h au lundi 9h</b>.</p>` },
      { aller: () => { ui.semaine = Rules.cleSemaine(Date.now()); ecranVisite('standard', 'semaine'); },
        cible: () => $(innerWidth < 600 ? '.eff-grille .eff-etab' : '.eff-grille'),   // téléphone : le 1er HAD seulement
        titre: 'Patients présents',
        texte: `<p>Le <b>nombre</b> de patients suivis par chaque antenne cette semaine (tous, pas seulement ceux qui ont appelé).
          À saisir <b>le lundi</b>, ici ou par le bandeau « Saisir les patients présents » de l'onglet Appels.</p>
          <p>Ce nombre sert à tous les calculs « pour 100 patients » des Stats : sans lui, pas de comparaison possible.</p>` },
      { aller: () => ecranVisite('standard', 'semaine'), cible: () => $('#vue .bloc:last-of-type'), titre: 'Chronologie',
        texte: '<p>Toutes les interventions de la semaine, dans l\'ordre. Juste au-dessus : la note de couverture ou de remplacement.</p>' },
      { aller: () => ecranVisite('standard', 'stats'), cible: '.kpis', titre: 'Stats',
        texte: `<p>En haut, la période : Semaine (‹ › pour en changer), 30 jours ou Tout.</p>
          <p>Ici : nombre de patients, temps total et temps moyen par patient.</p>` },
      { aller: () => ecranVisite('standard', 'stats'), cible: () => { const t = $('table.stats'); return t && t.closest('.bloc'); },
        titre: 'Par établissement et antenne',
        texte: `<p>Minutes par jour <b>pour 100 patients</b> : on compare des antennes de tailles différentes.</p>
          <p>Survolez un intitulé de colonne pour son explication.</p>` },
      { aller: () => ecranVisite('standard', 'stats'), cible: '.recours', titre: 'Recours à l\'astreinte',
        texte: `<p>HAD et antennes classés, puis la nuit et les week-ends et fériés.</p>
          <p>À droite, l'écart à la moyenne globale : <b>1,5 x</b> = 1,5 fois la moyenne de toutes les antennes/HAD.</p>` },
      { aller: () => ecranVisite('standard', 'stats'), cible: 'table.chaleur',
        titre: 'Horaires d\'interventions',
        texte: `<p>Quand tombent les appels : une case par jour et par heure
          (pavé = 30 min ou plus dans l'heure, rond = moins de 30 min).</p>
          <p>En fin de ligne : durée et patients du jour.</p>` },
      { aller: () => ecranVisite('standard', 'plus'), cible: () => { const b = $('[data-a="export"]'); return b && b.closest('.bloc'); },
        titre: 'Exports Excel',
        texte: '<p>Par patient (noms abrégés) ou <b>par anonyme</b> (P1, P2…) : c\'est celui-ci qu\'on partage.</p>' },
      { aller: () => ecranVisite('standard', 'plus'), cible: () => { const b = $('[data-a="sauvegarde"]'); return b && b.closest('.bloc'); },
        titre: 'Sauvegarde',
        texte: `<p>Les données restent sur cet appareil, chiffrées par votre code. <b>Créez un fichier de sauvegarde chaque semaine.</b></p>
          <p>Il sert aussi à passer sur un autre appareil : « Importer et fusionner ».</p>` },
      { aller: () => ecranVisite('standard', 'plus'), cible: '#btn-medecin', titre: 'Médecin d\'astreinte',
        texte: '<p>Votre nom est inscrit sur chaque appel. Touchez-le pour changer de médecin (relève, remplacement).</p>' },
      { titre: 'Bonne astreinte !',
        texte: '<p>Pour revoir cette visite : onglet <b>Plus</b> › « 🎓 Visite guidée ».</p>' },
    ];
  }

  function lancerVisite() {
    const avant = { mode: ui.mode, onglet: ui.onglet, semaine: ui.semaine, periode: ui.periode, decalAppels: ui.decalAppels };
    ui.pile = [];
    ui.decalAppels = 0;
    rendre();
    window.Visite.demarrer(etapesVisite(), {
      hautFixe: () => { const h = $('.entete'); return h ? Math.max(0, h.getBoundingClientRect().bottom) : 0; },
      fin: () => {
        Object.assign(ui, avant);
        if (!S.state.visiteVue) { S.state.visiteVue = true; S.planifier(); }
        rendre();
        window.scrollTo(0, 0);
      },
    });
  }

  /* ---------- Onglet Plus ---------- */
  function vuePlus() {
    const p = periode();
    const c = S.state.config;
    const aPurger = S.aPurger().length;
    return `
      <section class="bloc">
        <h3>Aide</h3>
        <p class="aide">Les écrans et les boutons utiles, en 2 minutes. Rien n'est modifié pendant la visite.</p>
        <button class="btn btn-primaire" data-a="visite">🎓 Visite guidée</button>
      </section>
      <section class="bloc">
        <h3>Export tableur (Excel)</h3>
        ${choixPeriode()}
        <p class="aide">Période exportée : <b>${esc(p.titre)}</b>. L'export par patient désigne chaque patient par NOM-PRÉNOM abrégés (3 lettres au plus chacun, ex. DUP-JEA) ; l'export par anonyme retire le RPSS, le Mémo et le Commentaire et remplace le patient par P1, P2…</p>
        <div class="rangee">
          <button class="btn btn-primaire" data-a="export" data-anonyme="0">⬇ Export par patient</button>
          <button class="btn" data-a="export" data-anonyme="1">⬇ Export par anonyme</button>
        </div>
      </section>
      <section class="bloc">
        <h3>Fichier CSV (toutes les données)</h3>
        <p class="aide">L'export contient tout : dossiers, temps, effectifs, notes de semaine. Il s'ouvre dans Excel et se
          réimporte ici. <strong>Attention : NOM, PR et RPSS y sont en clair</strong> (fichier non chiffré).</p>
        <div class="rangee">
          <button class="btn btn-primaire" data-a="export-csv">⬇ Export détaillé (CSV)</button>
          <button class="btn" data-a="feuille-import-csv">📥 Importer un CSV</button>
        </div>
      </section>
      <section class="bloc">
        <h3>Synchroniser un autre appareil</h3>
        <p class="aide">Par QR code : prévu dans la prochaine version. En attendant, transférez un fichier de sauvegarde
          chiffré (AirDrop, câble, clé USB). Les données sont fusionnées sans doublon.</p>
        <div class="rangee">
          <button class="btn" data-a="sauvegarde">💾 Créer un fichier de sauvegarde</button>
          <button class="btn" data-a="feuille-import">📥 Importer et fusionner</button>
        </div>
      </section>
      <section class="bloc">
        <h3>Paramètres des listes</h3>
        <form data-form="parametres" class="formulaire">
          <label>Médecins d'astreinte <small>(un par ligne)</small>
            <textarea name="medecins" rows="3">${esc(c.medecins.join('\n'))}</textarea></label>
          <label>Établissements et antennes <small>(une ligne par établissement : « Nom : antenne, antenne… »)</small>
            <textarea name="etablissements" rows="3">${esc(c.etablissements.map((e) => `${e.nom} : ${e.antennes.join(', ')}`).join('\n'))}</textarea></label>
          <button class="btn btn-primaire" type="submit">Enregistrer les listes</button>
        </form>
      </section>
      <section class="bloc">
        <h3>Conservation (1 mois)</h3>
        <p class="aide">${aPurger ? `${pluriel(aPurger, 'dossier')} de plus de ${window.DUREE_CONSERVATION_JOURS} jours.
          Exportez-les (période « Tout ») avant de les purger.` : 'Aucune donnée de plus d\'un mois.'}</p>
        <button class="btn" data-a="purger" ${aPurger ? '' : 'disabled'}>🗑 Purger les données de plus d'un mois</button>
      </section>
      <section class="bloc">
        <h3>Sécurité</h3>
        <div class="rangee">
          <button class="btn" data-a="verrouiller">🔒 Verrouiller</button>
          <button class="btn" data-a="feuille-code">🔑 Changer le code</button>
          <button class="btn btn-danger" data-a="effacer-tout">Effacer toutes les données</button>
        </div>
      </section>
      <p class="aide centre">Astreinte Minuteur v${VERSION}${FICHIER ? ' (fichier unique)' : ''} · données stockées uniquement sur cet appareil, chiffrées.</p>`;
  }

  /* =====================================================================
     FEUILLES (fenêtres par-dessus l'écran)
     ===================================================================== */
  function ouvrirFeuille(f) { ui.pile.push(f); rendreFeuille(); }
  function fermerFeuille() {
    const f = ui.pile.pop();
    if (f && f.type === 'effectifs') ui.effectifsReportes = true;
    rendre();
    if (f && f.type === 'medecin' && f.accueil) {
      if (!S.state.visiteVue) lancerVisite(); else demanderEffectifs();
    }
  }

  function rendreFeuille() {
    const zone = $('#feuille');
    const f = ui.pile[ui.pile.length - 1];
    if (!f) { zone.innerHTML = ''; zone.hidden = true; document.body.classList.remove('feuille-ouverte'); return; }
    const ancien = $('.feuille-corps', zone);
    const memeFeuille = zone.dataset.cle === cleFeuille(f);
    const defilement = ancien && memeFeuille ? ancien.scrollTop : 0;
    const rendus = { dossier: feuilleDossier, segment: feuilleSegment, medecin: feuilleMedecin, type: feuilleType,
      effectifs: feuilleEffectifs, import: feuilleImport, 'import-csv': feuilleImportCsv, code: feuilleCode };
    zone.hidden = false;
    zone.dataset.cle = cleFeuille(f);
    zone.innerHTML = `<div class="voile" data-a="fermer"></div><div class="feuille" role="dialog" aria-modal="true">${rendus[f.type](f)}</div>`;
    document.body.classList.add('feuille-ouverte');
    ajusterTout(zone);
    const corps = $('.feuille-corps', zone);
    if (corps) corps.scrollTop = defilement;
    tic();
  }
  const cleFeuille = (f) => `${f.type}:${f.id || ''}:${f.seg || ''}`;

  const entete = (titre, droite = '', attrTitre = '') => `
    <div class="feuille-entete">
      <button class="btn-texte" data-a="fermer">✓ OK</button><h2 ${attrTitre}>${titre}</h2><span>${droite}</span>
    </div>`;

  const puces = (liste, actifs, action, extra = '') => `<div class="puces">${liste.map((v) => `
    <button type="button" class="puce ${actifs.includes(v) ? 'actif' : ''}" data-a="${action}" data-v="${esc(v)}" ${extra}>${esc(v)}</button>`).join('')}</div>`;

  /* ---------- Feuille Dossier ---------- */
  /* Suggestion d'un patient déjà saisi — règles strictes :
     - RPSS : identique en entier (jamais sur un début de numéro) ;
     - nom : les 3 lettres identiques, et le prénom identique s'il est tapé ;
     - deux RPSS renseignés et différents = deux séjours différents → pas de suggestion.
     Un RPSS déjà attribué à un autre code patient déclenche une alerte au lieu d'une suggestion. */
  function suggestionsPatient(d) {
    const maj = (s) => (s || '').toUpperCase().trim();
    const n = maj(d.nom3), p = maj(d.prenom2), r = (d.rpss || '').trim();
    if (n.length < 3 && r.length < 4) return '';
    const vus = new Set();
    const res = [];
    const alertes = [];
    S.dossiersActifs().forEach((x) => {
      if (x === d || !x.nom3) return;
      const memeRpss = r.length >= 4 && x.rpss === r;
      const memeNom = n.length === 3 && maj(x.nom3) === n && (!p || maj(x.prenom2).startsWith(p));
      const rpssDifferents = r && x.rpss && x.rpss !== r;
      const cle = `${x.rpss}|${S.codePatient(x)}`;
      if (vus.has(cle)) return;
      vus.add(cle);
      if (memeRpss && n && p.length === 2 && S.codePatient(x) !== S.codePatient(d)) alertes.push(x);
      else if ((memeRpss || (memeNom && !rpssDifferents))
        && !(x.rpss === d.rpss && S.codePatient(x) === S.codePatient(d) && x.antenne === d.antenne)) res.push(x);
    });
    const libelle = (x) => `${esc(S.codePatient(x))}${x.rpss ? ' · ' + esc(x.rpss) : ''} · ${esc(x.antenne)}`;
    return `
      ${alertes.map((x) => `<p class="alerte">⚠ Le RPSS ${esc(r)} est déjà enregistré pour ${libelle(x)}. Vérifiez le numéro.</p>`).join('')}
      ${res.length ? `<div class="suggestions"><small>Même patient ? Touchez pour compléter :</small>
        ${res.slice(0, 4).map((x) => `<button class="puce" data-a="remplir-patient" data-id="${d.id}" data-src="${x.id}">${libelle(x)}</button>`).join('')}</div>` : ''}`;
  }

  /* Horaire en 4 cases égales : Date | Début | Fin | Durée.
     Chronomètre en cours : Fin = bouton Stop, Durée = chronomètre. */
  function champsHoraire(s, attrs) {
    const enCours = s.fin == null;
    return `
      <div class="grille-4" data-horaire ${attrs}>
        <label>Date<input type="date" name="date" value="${valDate(s.debut)}" required></label>
        <label>Début<input type="time" name="heure" value="${fmtHeure(s.debut)}" required></label>
        ${enCours ? `
        <div class="case-horaire"><span>Fin</span><button type="button" class="btn btn-stop-large" data-a="stop" aria-label="Terminer ce temps">■ Stop</button></div>
        <div class="case-horaire"><span>Durée</span><b data-chrono="${s.debut}"></b></div>` : `
        <label>Fin<input type="time" name="fin" value="${fmtHeure(s.fin)}" required></label>
        <label><span>Durée <small>min</small></span><input type="number" name="duree" min="0" step="1" inputmode="numeric" value="${Math.round((s.fin - s.debut) / 60000)}" required></label>`}
      </div>`;
  }

  /* Lit Date / Début / Fin / Durée ; Fin et Durée se recalculent l'une l'autre selon la case modifiée.
     Une fin plus tôt que le début tombe le lendemain (appel à cheval sur minuit). */
  function lireHoraire(zone, champ) {
    const v = (k) => { const x = $(`[name=${k}]`, zone); return x ? x.value : null; };
    const debut = new Date(`${v('date')}T${v('heure')}`).getTime();
    if (Number.isNaN(debut)) return null;
    if (v('fin') == null) return { debut, fin: null };
    let fin;
    if (champ === 'fin') {
      if (!v('fin')) return null;
      fin = new Date(`${v('date')}T${v('fin')}`).getTime();
      if (fin < debut) fin += 86400000;
      $('[name=duree]', zone).value = Math.round((fin - debut) / 60000);
    } else {
      fin = debut + Math.max(0, Number(v('duree')) || 0) * 60000;
      $('[name=fin]', zone).value = fmtHeure(fin);
    }
    return { debut, fin };
  }

  /* Cadre du haut, identique pour un nouvel appel et une saisie après coup :
     horaire (automatique, ou prérempli et modifiable après coup), puis nom, prénom, RPSS. */
  function cadreAppel(d) {
    const segs = [...d.segments].sort((a, b) => a.debut - b.debut);
    const premier = segs[0];
    const actif = d.segments.find((s) => s.fin == null);
    const apresCoup = ui.apresCoup.has(d.id);
    const horaire = apresCoup && premier ? `
      ${champsHoraire(premier, `data-heure-appel data-id="${d.id}" data-seg="${premier.id}"`)}
      <button type="button" class="btn btn-stop-large" data-a="fin-maintenant" data-id="${d.id}" data-seg="${premier.id}">■ Stop : fin de l'appel maintenant</button>`
      : `<p class="horaire-auto">🕘 ${segs.length > 1 ? 'Début du dossier' : 'Appel'} : <b>${fmtDate(premier.debut)} à ${fmtHeure(premier.debut)}</b> <small>(auto)</small>
          ${actif && actif !== premier ? `<br>⏱ En cours : ${iconeType(actif.type)} ${esc(actif.type)} depuis ${fmtHeure(actif.debut)}` : ''}</p>`;
    return `
      <fieldset class="cadre-appel ${apresCoup ? 'a-saisir' : ''}"><legend>📞 Appel et patient</legend>
        ${horaire}
        <div class="grille-patient">
          <label>Nom <small>3 lettres</small><input data-f="nom3" data-id="${d.id}" value="${esc(d.nom3)}" maxlength="3" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>
          <label>Prénom <small>2 lettres</small><input data-f="prenom2" data-id="${d.id}" value="${esc(d.prenom2)}" maxlength="2" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>
          <label>RPSS <small>séjour</small><input data-f="rpss" data-id="${d.id}" value="${esc(d.rpss)}" inputmode="text" autocomplete="off" spellcheck="false"></label>
        </div>
        <div data-suggestions="${d.id}">${suggestionsPatient(d)}</div>
      </fieldset>`;
  }

  // Rappel (lecture seule) du patient en haut des fenêtres qui ajoutent du temps à un dossier existant
  function rappelPatient(d) {
    const debut = S.debutDossier(d);
    return `
      <div class="rappel">
        <div class="rappel-grille">
          <span><small>Nom</small><b>${esc((d.nom3 || '—').toUpperCase())}</b></span>
          <span><small>Prénom</small><b>${esc((d.prenom2 || '—').toUpperCase())}</b></span>
          <span><small>RPSS</small><b>${esc(d.rpss || '—')}</b></span>
        </div>
        <small>${esc(d.antenne || 'Antenne ?')} · début ${fmtDate(debut)} ${fmtHeure(debut)}</small>
      </div>`;
  }

  // Antennes rangées en colonnes, un cadre par établissement. Un établissement sans antenne (SSBDR)
  // est placé juste après le premier cadre pour tenir sur la même ligne que lui sur smartphone.
  function choixAntenne(d) {
    return `<div class="cadres-antennes">${S.state.config.etablissements.map((e, i) => {
      const antennes = Rules.antennesDe(e);
      const choisi = d.etab === e.nom;
      const ordre = i === 0 ? 0 : (e.antennes.length ? 2 : 1);
      return `
        <div class="cadre-etab ${choisi ? 'cadre-actif' : ''}" style="order:${ordre};--cols:${Math.ceil(antennes.length / 3)};--lignes:${Math.min(3, antennes.length)}">
          <div class="cadre-titre">${esc(e.nom)}</div>
          <div class="tuiles">${antennes.map((a) => `
            <button type="button" class="tuile ${choisi && d.antenne === a ? 'actif' : ''}" data-a="set-antenne"
              data-id="${d.id}" data-etab="${esc(e.nom)}" data-v="${esc(a)}">${esc(a)}</button>`).join('')}</div>
        </div>`;
    }).join('')}</div>`;
  }

  // Feuille plein écran (smartphone, tablette)
  function feuilleDossier(f) {
    const d = dossier(f.id);
    if (!d || d.supprime) { ui.pile.pop(); return ''; }
    return `
      ${entete(esc(S.codePatient(d) || 'Dossier'), `<span class="total" data-total-dossier="${d.id}"></span>`, `data-titre-dossier="${d.id}"`)}
      <div class="feuille-corps">${bandePatient(d)}${corpsDossier(d)}</div>`;
  }

  // Identité du patient, toujours visible (bandeau flottant en tête du dossier)
  const identite = (d) => `NOM <b>${esc((d.nom3 || '···').toUpperCase())}</b> · PR <b>${esc((d.prenom2 || '··').toUpperCase())}</b>`
    + `${d.rpss ? ` · RPSS <b>${esc(d.rpss)}</b>` : ''}${d.antenne ? ` · ${esc(d.antenne)}` : ''}`;
  const bandePatient = (d) => `<div class="bande-patient" data-bande="${d.id}">${identite(d)}</div>`;

  // Contenu d'un dossier, commun à la feuille (smartphone) et à la fenêtre (PC)
  function corpsDossier(d) {
    const actif = d.segments.find((s) => s.fin == null);
    const segs = [...d.segments].sort((a, b) => a.debut - b.debut);
    return `
        ${cadreAppel(d)}

        <fieldset><legend>Antenne</legend>${choixAntenne(d)}</fieldset>

        <fieldset><legend>Temps passé <span class="total" data-total-dossier="${d.id}"></span></legend>
          <ul class="segments">${segs.map((s) => `
            <li><button class="segment ${s.fin == null ? 'segment-actif' : ''}" data-a="editer-seg" data-id="${d.id}" data-seg="${s.id}">
              <span>${iconeType(s.type)} <b>${esc(s.type)}</b><small>${fmtDate(s.debut)} ${fmtHeure(s.debut)}${s.fin != null ? ' → ' + fmtHeure(s.fin) : ''}${s.medecin ? ' · ' + esc(s.medecin) : ''}</small></span>
              <span class="segment-duree">${s.fin == null ? `<span data-chrono="${s.debut}"></span>` : fmtDuree(S.dureeSegment(s))}</span>
            </button></li>`).join('')}</ul>
          ${actif ? `<button class="btn btn-stop-large" data-a="stop">■ Terminer « ${esc(actif.type)} »</button>` : ''}
          <p class="aide">Démarrer un nouveau temps pour ce dossier (le chronomètre en cours s'arrête) :</p>
          <div class="puces">${window.TYPES_SEGMENT.map((t) => `
            <button class="puce puce-type" data-a="demarrer" data-id="${d.id}" data-type="${esc(t.id)}">${t.icone} ${esc(t.id)}</button>`).join('')}</div>
          <button class="btn" data-a="ajouter-seg" data-id="${d.id}">🕘 Ajouter un temps après coup</button>
        </fieldset>

        ${d.clos
          ? `<button class="btn btn-grand-centre" data-a="rouvrir" data-id="${d.id}">↺ Rouvrir le dossier</button>`
          : `<button class="btn btn-primaire btn-grand-centre" data-a="clore" data-id="${d.id}">✓ Clore le dossier</button>`}
        <button class="btn btn-danger btn-bas" data-a="supprimer-dossier" data-id="${d.id}">Supprimer ce dossier</button>`;
  }

  /* ---------- Feuille Temps (segment) ---------- */
  function feuilleSegment(f) {
    const d = dossier(f.id);
    const s = d && d.segments.find((x) => x.id === f.seg);
    if (!s) { ui.pile.pop(); return ''; }
    const medecins = [...new Set([...S.state.config.medecins, s.medecin, S.state.medecinCourant].filter(Boolean))];
    return `
      ${entete('Temps passé')}
      <form class="feuille-corps formulaire" data-form="segment" data-id="${d.id}" data-seg="${s.id}">
        ${rappelPatient(d)}
        <fieldset class="${s.fin == null ? '' : 'a-saisir'}"><legend>🕘 Heure et durée</legend>
          ${champsHoraire(s, '')}
        </fieldset>
        <fieldset><legend>Type</legend>
          <div class="puces">${window.TYPES_SEGMENT.map((t) => `
            <label class="puce ${s.type === t.id ? 'actif' : ''}"><input type="radio" name="type" value="${esc(t.id)}" ${s.type === t.id ? 'checked' : ''}>${t.icone} ${esc(t.id)}</label>`).join('')}</div>
        </fieldset>
        <label>Médecin
          <select name="medecin"><option value="">—</option>${medecins.map((m) => `<option ${m === s.medecin ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label>Note <small>(facultatif)</small><input name="note" value="${esc(s.note)}" placeholder="Ex. : rappel IDE, mail au médecin traitant"></label>
        <button class="btn btn-primaire" type="submit">Enregistrer</button>
        <button class="btn btn-danger" type="button" data-a="supprimer-seg" data-id="${d.id}" data-seg="${s.id}">Supprimer ce temps</button>
      </form>`;
  }

  /* ---------- Autres feuilles ---------- */
  function feuilleMedecin(f) {
    const liste = S.state.config.medecins;
    return `
      ${entete("Médecin d'astreinte")}
      <div class="feuille-corps">
        <p class="aide">Ce médecin est inscrit par défaut sur chaque nouvel appel, jusqu'au prochain changement
          (remplacement ponctuel, relève du lundi…).</p>
        ${liste.length ? puces(liste, [S.state.medecinCourant], 'set-medecin') : ''}
        <form data-form="ajout-medecin" class="rangee">
          <input name="nom" placeholder="Ajouter : Dr Nom" required autocomplete="off">
          <button class="btn btn-primaire" type="submit">Ajouter</button>
        </form>
        ${f.accueil ? '<p class="aide">Vous pourrez modifier la liste dans « Plus › Paramètres ».</p>' : ''}
      </div>`;
  }

  function feuilleType(f) {
    const d = f.id && dossier(f.id);
    return `
      ${entete(d ? `Reprendre ${esc(S.codePatient(d) || 'le dossier')}` : 'Nouvelle tâche')}
      <div class="feuille-corps">
        ${d ? rappelPatient(d) : ''}
        <p class="aide">Que faites-vous ? Le chronomètre démarre ${S.segmentActif() ? 'et le temps en cours s\'arrête' : 'tout de suite'}.</p>
        <div class="choix-types">${window.TYPES_SEGMENT.map((t) => `
          <button class="btn btn-grand" data-a="lancer-type" data-id="${f.id || ''}" data-type="${esc(t.id)}">${t.icone} ${esc(t.id)}</button>`).join('')}</div>
      </div>`;
  }

  function feuilleEffectifs(f) {
    const b = Rules.bornesSemaine(f.semaine);
    return `
      ${entete('Patients présents')}
      <div class="feuille-corps">
        <p class="aide">Semaine du ${fmtDate(b.debut)} 9h au ${fmtDate(b.fin)} 9h. Nombre de patients présents par antenne
          (sert à calculer les sollicitations pour 10 patients).</p>
        ${blocEffectifs(f.semaine)}
        <div class="rangee">
          <button class="btn btn-primaire" data-a="fermer">Enregistrer</button>
          <button class="btn" data-a="fermer">Plus tard</button>
        </div>
      </div>`;
  }

  function feuilleImport() {
    return `
      ${entete('Importer une sauvegarde')}
      <form class="feuille-corps formulaire" data-form="import">
        <label>Fichier de sauvegarde (.json)<input type="file" name="fichier" accept=".json,application/json" required></label>
        <label>Code de l'appareil d'origine<input type="password" name="code" required autocomplete="off"></label>
        <button class="btn btn-primaire" type="submit">Importer et fusionner</button>
        <p class="erreur" role="alert"></p>
      </form>`;
  }

  function feuilleImportCsv() {
    const n = S.dossiersActifs().length;
    return `
      ${entete('Importer un CSV')}
      <form class="feuille-corps formulaire" data-form="import-csv">
        <label>Fichier CSV <small>(exporté par Astreinte Minuteur, éventuellement retouché dans Excel)</small>
          <input type="file" name="fichier" accept=".csv,text/csv" required></label>
        <fieldset><legend>Que faire des ${pluriel(n, 'dossier')} déjà présents ?</legend>
          <div class="puces">
            <label class="puce actif"><input type="radio" name="mode" value="completer" checked>➕ Compléter</label>
            <label class="puce"><input type="radio" name="mode" value="ecraser">🗑 Supprimer / Écraser</label>
          </div>
          <p class="aide"><b>Compléter</b> : ajoute les dossiers absents et met à jour ceux du fichier s'ils sont plus récents.
            <br><b>Supprimer / Écraser</b> : efface tous les dossiers et effectifs actuels, puis les remplace par le fichier.</p>
        </fieldset>
        <button class="btn btn-primaire" type="submit">Importer</button>
        <p class="erreur" role="alert"></p>
      </form>`;
  }

  // Fichier texte en UTF-8, ou en Windows-1252 s'il a été réenregistré par Excel
  async function lireTexte(fichier) {
    const octets = await fichier.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(octets); }
    catch (e) { return new TextDecoder('windows-1252').decode(octets); }
  }

  function feuilleCode() {
    return `
      ${entete('Changer le code')}
      <form class="feuille-corps formulaire" data-form="code">
        <label>Nouveau code<input type="password" name="code" minlength="6" required autocomplete="new-password"></label>
        <label>Confirmer<input type="password" name="code2" minlength="6" required autocomplete="new-password"></label>
        <button class="btn btn-primaire" type="submit">Changer le code</button>
        <p class="erreur" role="alert"></p>
      </form>`;
  }

  /* =====================================================================
     ACTIONS
     ===================================================================== */

  function telecharger(nom, contenu, type) {
    const url = URL.createObjectURL(new Blob([contenu], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nom });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // SheetJS (~1 Mo) n'est chargé qu'au premier export
  function chargerXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, ko) => {
      const s = Object.assign(document.createElement('script'), { src: 'vendor/xlsx.full.min.js', onload: ok, onerror: ko });
      document.head.appendChild(s);
    });
  }

  const actions = {
    onglet: ({ v }) => { ui.onglet = v; rendre(); window.scrollTo(0, 0); },
    fermer: () => fermerFeuille(),

    'nouvel-appel': () => {
      const d = S.nouveauDossier('Appel reçu');
      toast('⏱ Chronomètre démarré');
      afficherDossier(d.id, { focus: true });   // son message (fenêtre rangée) passe en priorité
    },
    // Un clic : le chronomètre démarre ; le dossier précédent encore en cours est arrêté
    'nouveau-dossier': () => {
      const avant = S.segmentActif();
      const d = S.nouveauDossier('Appel reçu');
      ui.onglet = 'accueil';
      ui.decalAppels = 0;   // le nouveau dossier est dans la semaine en cours
      rendre();
      window.scrollTo(0, 0);
      const champ = $(`[data-barre="${d.id}"] [data-f=nom3]`);
      if (champ) champ.focus();
      toast(avant ? `■ ${S.codePatient(avant.dossier) || 'Dossier précédent'} arrêté · ⏱ nouveau chronomètre` : '⏱ Chronomètre démarré');
    },
    // Trie les lignes une fois ; ensuite l'ordre reste figé (les nouveaux dossiers arrivent en haut).
    // Sans nom : toujours en dernier ; à nom égal, le plus récent d'abord.
    trier: ({ v, sens }) => {
      const nom = (d) => S.codePatient(d);
      const date = (d) => Math.max(...d.segments.map((s) => s.debut));
      const k = sens === 'desc' ? -1 : 1;
      const comparer = v === 'nom'
        ? (x, y) => (!nom(x) - !nom(y)) || k * nom(x).localeCompare(nom(y), 'fr') || date(y) - date(x)
        : (x, y) => k * (date(x) - date(y));
      ui.ordreBarres = dossiersBarres().sort(comparer).map((d) => d.id);
      ui.triLe = Date.now();
      ui.tri = `${v}-${sens}`;
      rendre();
      toast(`Trié par ${TRIS[ui.tri]}`);
    },
    /* Même patient : nouvelle intervention, le chronomètre repart (celui d'un autre dossier s'arrête).
       La barre affiche cette intervention ; les précédentes restent accessibles au double clic.
       À partir du lundi 9 h suivant, l'intervention ouvre un nouveau dossier (nouvelle semaine d'astreinte). */
    reprise: ({ id }) => {
      const d = dossier(id);
      const avant = S.segmentActif();
      S.nouveauSegment(d, 'Reprise');
      const r = S.regrouper();
      ui.decalAppels = 0;   // la reprise démarre maintenant : retour à la semaine en cours
      rendre();
      toast(r.scindes.length ? '▶ Nouvelle semaine d\'astreinte : nouveau dossier pour ce patient'
        : avant ? `■ ${S.codePatient(avant.dossier) || 'Dossier précédent'} arrêté · ▶ reprise` : `▶ Reprise ${S.codePatient(d) || ''}`);
    },
    /* Enregistre les horaires modifiés d'une intervention. En cas de chevauchement : 1er clic = cases en rouge
       + message (les interventions concernées sont affichées) ; 2e clic = enregistrement quand même. */
    'valider-horaire': ({ id, seg }) => {
      const d = dossier(id);
      const s = d && d.segments.find((x) => x.id === seg);
      if (!s || !ui.brouillons[seg]) return;
      const v = valeursHoraire(s);
      if (Number.isNaN(v.tsDebut) || (s.fin != null && Number.isNaN(v.tsFin))) { toast('Date ou heure incomplète'); return; }
      const c = calculerConflits().get(seg);
      if (c && c.avec.length && !ui.forcer.has(seg)) {
        ui.forcer.add(seg);
        // Les interventions chevauchées repliées sous leur barre sont affichées pour voir les cases en rouge
        c.avec.forEach((x) => { if (x.d.segments.length > 1) ui.deplies.add(x.d.id); });
        rendre();
        montrerBarre(id);
        toast('Chevauchement horaire (en rouge) : corrigez, ou validez à nouveau pour enregistrer quand même');
        return;
      }
      s.debut = v.tsDebut;
      if (s.fin != null) s.fin = Math.max(v.tsDebut, v.tsFin);
      delete ui.brouillons[seg];
      ui.forcer.delete(seg);
      S.toucher(d);
      S.regrouper();
      rendre();
      const ici = S.dossiersActifs().find((x) => x.segments.some((y) => y.id === seg));
      montrerBarre(ici ? ici.id : id);
      toast(`✓ Horaire enregistré : ${fmtHeure(s.debut)}${s.fin == null ? '' : ` → ${fmtHeure(s.fin)} (${fmtDuree(s.fin - s.debut)})`}`);
    },
    'annuler-horaire': ({ id, seg }) => {
      delete ui.brouillons[seg];
      ui.forcer.delete(seg);
      if ($(`[data-barre="${id}"]`)) rafraichirBarre(id); else rendre();
    },
    // Boutons de hauteur d'une case Mémo / Commentaire (voir caseNote)
    hauteur: ({ sens }, el) => {
      const zone = $('textarea', el.closest('.b-note'));
      const d = dossier(zone.dataset.id);
      const s = d && d.segments.find((x) => x.id === zone.dataset.seg);
      if (!s) return;
      const ligne = parseFloat(getComputedStyle(zone).lineHeight) || 20;
      const h = { moins: Math.max(HAUTEUR_LIGNE, zone.offsetHeight - ligne), plus: zone.offsetHeight + ligne, texte: null, defaut: HAUTEUR_LIGNE }[sens];
      const cleH = NOTES[zone.dataset.note][2];
      if (h == null) { delete s[cleH]; delete zone.dataset.h; } else { s[cleH] = Math.round(h); zone.dataset.h = s[cleH]; }
      ajusterHauteur(zone);
      S.toucher(d, { traite: false });
      zone.focus({ preventScroll: true });
    },
    // « Même patient ? » → Réunir : la barre récente est versée dans l'ancienne (comme une réunion d'office)
    'reunir-patient': ({ id, avec }) => {
      const d = dossier(id), garde = dossier(avec);
      if (!d || !garde) return;
      Rules.fusionner(garde, d);
      S.supprimerDossier(d);
      S.toucher(garde);
      S.regrouper();
      rendre();
      montrerBarre(garde.id);
      toast(`✓ Réuni dans ${nomCourt(garde) || 'le dossier existant'}`);
    },
    // « Même patient ? » → Non : homonyme, compté comme un autre patient (la marque suit le dossier les semaines suivantes)
    'patient-distinct': ({ id }) => {
      const d = dossier(id);
      if (!d) return;
      d.homonyme = d.id;
      S.toucher(d);
      rafraichirBarre(d.id);
      toast('Homonyme : compté comme un autre patient');
    },
    // Double clic sur une barre (ou bouton « +N ») : affiche / masque les interventions antérieures
    historique: ({ id }) => {
      if (ui.deplies.has(id)) ui.deplies.delete(id); else ui.deplies.add(id);
      rafraichirBarre(id);
    },
    /* Supprime une seule intervention (une des lignes du dessous, ou la plus récente affichée sur la barre) ;
       les autres interventions du dossier sont conservées, la barre affiche alors la plus récente restante. */
    'supprimer-interv': ({ id, seg }) => {
      const d = dossier(id);
      const s = d.segments.find((x) => x.id === seg);
      const seule = d.segments.length === 1;
      if (!s || !confirm(`Supprimer l'intervention du ${jjmm(s.debut)} à ${fmtHeure(s.debut)} ?${seule ? '' : ' Les autres interventions du dossier sont conservées.'}`)) return;
      d.segments = d.segments.filter((x) => x.id !== seg);
      delete ui.brouillons[seg];
      ui.forcer.delete(seg);
      if (d.segments.length < 2) ui.deplies.delete(d.id);
      if (seule) S.supprimerDossier(d);   // mode Simplifié : un dossier sans intervention n'a plus lieu d'être
      else S.toucher(d);
      rendre();
      toast('Intervention supprimée');
    },
    'supprimer-barre': ({ id }) => {
      const d = dossier(id);
      if (!confirm(`Supprimer le dossier ${S.codePatient(d) || 'sans nom'} ?`)) return;
      S.supprimerDossier(d);
      rendre();
      toast('Dossier supprimé');
    },
    'nouvelle-tache': () => ouvrirFeuille({ type: 'type' }),
    'apres-coup': () => {
      const fin = Date.now();
      const d = S.nouveauDossier('Appel reçu', fin - 5 * 60000, fin);
      ui.apresCoup.add(d.id);
      afficherDossier(d.id, { focus: true });
    },
    reprendre: ({ id }) => ouvrirFeuille({ type: 'type', id }),
    'lancer-type': ({ id, type }) => {
      ui.pile.pop();
      let d = id && dossier(id);
      if (d) S.nouveauSegment(d, type); else d = S.nouveauDossier(type);
      // On affiche le dossier : patient rappelé en haut, détails de la nouvelle intervention à compléter
      toast(`⏱ ${type} : chronomètre démarré`);
      afficherDossier(d.id);
    },
    clore: ({ id }) => {
      const d = dossier(id);
      S.clore(d);
      ui.pile = ui.pile.filter((x) => !(x.type === 'dossier' && x.id === id));
      rendre();
      toast(`✓ ${S.codePatient(d) || 'Dossier'} clos`);
    },
    rouvrir: ({ id }) => { const d = dossier(id); d.clos = false; S.toucher(d); rafraichirDossier(id); rendre(); },
    masquer: ({ id }) => { S.retirerFenetre(id); rendre(); },
    stop: () => { const a = S.arreterActif(); rendre(); if (a) toast(`■ ${a.seg.type} : ${fmtDuree(S.dureeSegment(a.seg))}`); },
    'fin-maintenant': ({ id, seg }) => {
      const d = dossier(id);
      const s = d.segments.find((x) => x.id === seg);
      s.fin = Math.max(Date.now(), s.debut);
      S.toucher(d);
      rafraichirDossier(id);
      toast(`■ Fin à ${fmtHeure(s.fin)} · ${fmtDuree(s.fin - s.debut)}`);
    },
    demarrer: ({ id, type }) => { S.nouveauSegment(dossier(id), type); rendre(); toast(`⏱ ${type} : chronomètre démarré`); },
    'ajouter-seg': ({ id }) => {
      const d = dossier(id);
      const fin = Date.now();
      const s = S.nouveauSegment(d, 'Rédaction', fin - 5 * 60000, fin);
      ouvrirFeuille({ type: 'segment', id, seg: s.id });
    },
    'editer-seg': ({ id, seg }) => ouvrirFeuille({ type: 'segment', id, seg }),
    'supprimer-seg': ({ id, seg }) => {
      const d = dossier(id);
      if (d.segments.length === 1) { toast('Dernier temps du dossier : supprimez plutôt le dossier'); return; }
      if (!confirm('Supprimer ce temps ?')) return;
      d.segments = d.segments.filter((s) => s.id !== seg);
      S.toucher(d);
      fermerFeuille();
    },
    'ouvrir-dossier': ({ id }) => afficherDossier(id),
    'supprimer-dossier': ({ id }) => {
      if (!confirm('Supprimer définitivement ce dossier et tous ses temps ?')) return;
      S.supprimerDossier(dossier(id));
      fermerFeuille();
      toast('Dossier supprimé');
    },

    // Choisir l'antenne renseigne aussi l'établissement
    'set-antenne': ({ id, v, etab }) => {
      const d = dossier(id);
      const deja = d.antenne === v && d.etab === etab;
      d.antenne = deja ? '' : v;
      d.etab = deja ? '' : etab;
      S.toucher(d); rafraichirDossier(id); majMenu();
    },
    'remplir-patient': ({ id, src }) => {
      const d = dossier(id), x = dossier(src);
      Object.assign(d, { etab: x.etab, antenne: x.antenne, rpss: x.rpss, nom3: x.nom3, prenom2: x.prenom2 });
      S.toucher(d); rafraichirDossier(id); majMenu();
    },
    // Écran d'ouverture : Simplifié (le cercle Standard s'efface, Simplifié se recentre) ou Standard ;
    // Liens « Passer en mode Simplifié / Standard » : d'un mode à l'autre sans repasser par les 2 cercles
    mode: ({ v }) => {
      const choix = $('.choix-mode');
      if (v === 'simple' && choix && !choix.classList.contains('vers-simple')
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        choix.classList.add('vers-simple');
        setTimeout(() => { ui.mode = 'simple'; rendre(); }, 380);
        return;
      }
      ui.mode = v;
      if (v === 'standard') ui.onglet = 'accueil';
      rendre();
      window.scrollTo(0, 0);
      demanderEffectifs();
    },
    // Cercle du mode Simplifié : démarre une intervention (nouveau dossier sans nom) ou interrompt celle en cours
    'chrono-simple': () => {
      if (S.segmentActif()) S.arreterActif(); else S.nouveauDossier();
      rendre();
    },
    // Bandeau bleu : déplier / replier « Cumul » ou « Plage W continu » (repli automatique après 5 minutes)
    bloc: ({ v }) => {
      const cle = v === 'cumul' ? 'blocCumul' : 'blocPlages';
      ui[cle] = !ui[cle];
      programmerRepli(v);
      ui.ouverture = ui[cle] ? v : '';
      rendre();
      ui.ouverture = '';
      if (v === 'plages' && ui.blocPlages) { const x = $('.plage-nouvelle [name=heure-debut]'); if (x) x.focus(); }
    },
    'plage-forcer': ({ id }) => {
      const zone = $(`[data-plage="${id}"]`);
      if (zone) enregistrerPlage(zone, true);
    },
    'plage-annuler': () => rendre(),   // valeurs enregistrées réaffichées (ligne vide remise à zéro)
    'supprimer-plage': ({ id }) => {
      const p = (S.state.plages || []).find((x) => x.id === id);
      if (!p || !confirm(`Supprimer la plage du ${jjmm(p.debut)} ${fmtHeure(p.debut)} → ${fmtHeure(p.fin)} ?`)) return;
      S.state.plages = S.state.plages.filter((x) => x !== p);
      S.planifier();
      rendre();
      toast('Plage supprimée');
    },
    'choisir-medecin': () => ouvrirFeuille({ type: 'medecin' }),
    visite: () => lancerVisite(),
    'set-medecin': ({ v }) => {
      S.state.medecinCourant = v;
      const a = S.segmentActif();
      if (a && !a.seg.medecin) a.seg.medecin = v;
      S.planifier();
      fermerFeuille();
      toast(`👤 ${v} inscrit par défaut`);
    },

    // data-v : semaine à saisir (alerte « Effectif J1 manquant » des Stats) ; sinon la semaine en cours
    'feuille-effectifs': ({ v }) => { ui.effectifsReportes = false; ouvrirFeuille({ type: 'effectifs', semaine: v || Rules.cleSemaine(Date.now()) }); },
    sem: ({ n }) => { ui.semaine = Rules.decalerSemaine(ui.semaine, Number(n)); rendre(); },
    // Onglet Appels : ‹ / › d'une semaine (pas au-delà de la semaine en cours), 0 = retour à la semaine en cours
    'sem-appels': ({ n }) => {
      ui.decalAppels = Number(n) ? Math.min(0, ui.decalAppels + Number(n)) : 0;
      ui.deplies.clear();
      rendre();
    },
    periode: ({ v }) => { ui.periode = v; rendre(); },

    export: async ({ anonyme }) => {
      try {
        await chargerXLSX();
        const nom = window.Export.exporterExcel({ ...periode(), anonyme: anonyme === '1' });
        toast(`⬇ ${nom}`);
      } catch (e) { console.error(e); alert("L'export a échoué : " + e.message); }
    },
    sauvegarde: async () => {
      telecharger(`astreinte_sauvegarde_${valDate(Date.now())}.json`, await S.exporterSauvegarde(), 'application/json');
      toast('💾 Sauvegarde chiffrée créée');
    },
    'feuille-import': () => ouvrirFeuille({ type: 'import' }),
    'export-csv': () => {
      if (!confirm('Le fichier CSV contient les identifiants patients (NOM, PR, RPSS) en clair. Le conserver uniquement sur un support sûr. Continuer ?')) return;
      const nom = `astreinte_tout_${valDate(Date.now())}.csv`;
      telecharger(nom, window.Csv.exporter(S.state), 'text/csv;charset=utf-8');
      toast(`⬇ ${nom}`);
    },
    'feuille-import-csv': () => ouvrirFeuille({ type: 'import-csv' }),
    'feuille-code': () => ouvrirFeuille({ type: 'code' }),
    purger: () => {
      if (!confirm('Avez-vous exporté les données (période « Tout ») ? La purge est définitive.')) return;
      const n = S.purger();
      rendre(); toast(`🗑 ${pluriel(n, 'dossier')} purgé${n > 1 ? 's' : ''}`);
    },
    verrouiller: async () => { await S.sauver(); S.verrouiller(); ui.pile = []; rendreFeuille(); rendreVerrou(); },
    'effacer-tout': () => {
      if (prompt('Pour effacer TOUTES les données de cet appareil, tapez EFFACER') !== 'EFFACER') return;
      S.effacerTout(); ui.pile = []; rendreFeuille(); rendreVerrou();
    },
    reinitialiser: () => {
      if (prompt('Sans le code, les données ne peuvent pas être lues. Pour tout effacer et recommencer, tapez EFFACER') !== 'EFFACER') return;
      S.effacerTout(); rendreVerrou();
    },
  };

  /* ---------- Formulaires ---------- */
  const formulaires = {
    async creer(f) {
      const code = f.code.value, code2 = f.code2.value;
      if (code !== code2) return rendreVerrou('Les deux codes sont différents.');
      await S.creer(code);
      apresDeverrouillage();
    },
    async ouvrir(f) {
      const btn = $('button[type=submit]', f);
      btn.disabled = true; btn.textContent = 'Ouverture…';
      try { await S.ouvrir(f.code.value); apresDeverrouillage(); }
      catch (e) { rendreVerrou('Code incorrect.'); }
    },
    segment(f) {
      const d = dossier(f.dataset.id);
      const s = d.segments.find((x) => x.id === f.dataset.seg);
      const h = lireHoraire($('[data-horaire]', f));
      if (!h) return toast('Date ou heure invalide');
      s.type = f.querySelector('input[name=type]:checked').value;
      s.debut = h.debut;
      if (s.fin != null && h.fin != null) s.fin = h.fin;
      s.note = f.note.value.trim();
      if (f.medecin.value && f.medecin.value !== s.medecin) S.state.medecinCourant = f.medecin.value;
      s.medecin = f.medecin.value;
      S.toucher(d);
      fermerFeuille();
    },
    'ajout-medecin'(f) {
      const nom = f.nom.value.trim();
      if (!nom) return;
      const c = S.state.config;
      if (!c.medecins.includes(nom)) c.medecins.push(nom);
      c.majLe = Date.now();
      actions['set-medecin']({ v: nom });
    },
    parametres(f) {
      const lignes = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);
      const c = S.state.config;
      c.medecins = lignes(f.medecins.value);
      c.etablissements = lignes(f.etablissements.value).map((l) => {
        const [nom, reste = ''] = l.split(':');
        return { nom: nom.trim(), antennes: reste.split(',').map((x) => x.trim()).filter(Boolean) };
      }).filter((e) => e.nom);
      c.majLe = Date.now();
      S.planifier(); rendre(); toast('✓ Listes enregistrées');
    },
    async import(f) {
      const err = $('.erreur', f);
      try {
        const texte = await f.fichier.files[0].text();
        const donnees = await S.lireSauvegarde(texte, f.code.value);
        const r = S.fusionner(donnees);
        fermerFeuille();
        toast(`📥 ${r.ajoutes} dossier(s) ajouté(s), ${r.maj} mis à jour`);
      } catch (e) { err.textContent = 'Fichier ou code incorrect.'; }
    },
    async 'import-csv'(f) {
      const err = $('.erreur', f);
      let res;
      try { res = window.Csv.lire(await lireTexte(f.fichier.files[0])); }
      catch (e) { err.textContent = `Fichier non reconnu : ${e.message}`; return; }
      S.renommerEtablissements(res);
      const s = S.state;
      let bilan;
      if (f.mode.value === 'ecraser') {
        const avant = S.dossiersActifs().length;
        if (!confirm(`Supprimer les ${avant} dossier(s) actuels et les remplacer par les ${res.dossiers.length} du fichier ?`)) return;
        s.dossiers = res.dossiers;
        s.semaines = res.semaines;
        s.plages = res.plages;
        s.fenetres = [];
        bilan = `🗑 Données remplacées : ${pluriel(res.dossiers.length, 'dossier')}`;
      } else {
        const r = S.fusionner({ dossiers: res.dossiers, semaines: res.semaines, plages: res.plages });
        bilan = `➕ ${r.ajoutes} dossier(s) ajouté(s), ${r.maj} mis à jour`;
      }
      // Un seul chronomètre à la fois : les autres temps « en cours » du fichier sont arrêtés à leur début
      const enCours = s.dossiers.flatMap((d) => (d.segments || []).filter((x) => x.fin == null)).sort((a, b) => b.debut - a.debut);
      enCours.slice(1).forEach((x) => { x.fin = x.debut; });
      const medecins = res.dossiers.flatMap((d) => d.segments.map((x) => x.medecin)).filter(Boolean);
      s.config.medecins = [...new Set([...s.config.medecins, ...medecins])];
      ui.ordreBarres = [];
      S.planifier();
      fermerFeuille();
      rendre();
      toast(`${bilan}${res.ignorees.length ? ` · ${res.ignorees.length} ligne(s) ignorée(s)` : ''}`);
    },
    async code(f) {
      if (f.code.value !== f.code2.value) { $('.erreur', f).textContent = 'Les deux codes sont différents.'; return; }
      await S.changerCode(f.code.value);
      fermerFeuille(); toast('🔑 Code modifié');
    },
  };

  /* ---------- Saisie au clavier (sans re-rendu pour garder le focus) ---------- */
  function majChamp(el) {
    const d = dossier(el.dataset.id);
    let v = el.value;
    if (el.dataset.f === 'nom3' || el.dataset.f === 'prenom2') {
      v = v.toUpperCase().replace(/[^A-ZÀ-ÖØ-Ý' -]/g, '');
      if (v !== el.value) el.value = v;
    }
    d[el.dataset.f] = v;
    S.toucher(d);
    if (['nom3', 'prenom2', 'rpss'].includes(el.dataset.f)) {
      $$(`[data-suggestions="${d.id}"]`).forEach((x) => { x.innerHTML = suggestionsPatient(d); });
      $$(`[data-titre-dossier="${d.id}"]`).forEach((x) => { x.textContent = S.codePatient(d) || 'Dossier'; });
      $$(`[data-bande="${d.id}"]`).forEach((x) => { x.innerHTML = identite(d); });
    }
  }

  // Mémo / Commentaire propres à une intervention
  function majNote(el) {
    const d = dossier(el.dataset.id);
    const s = d && d.segments.find((x) => x.id === el.dataset.seg);
    if (!s) return;
    s[el.dataset.note] = el.value;
    S.toucher(d);
  }

  // Heure de l'appel saisie en tête du dossier (saisie après coup)
  function majHeureAppel(el) {
    const zone = el.closest('[data-horaire]');
    if (!zone.hasAttribute('data-heure-appel')) { lireHoraire(zone, el.name); return; }   // feuille : enregistré au clic
    const d = dossier(zone.dataset.id);
    const s = d && d.segments.find((x) => x.id === zone.dataset.seg);
    const h = s && lireHoraire(zone, el.name);
    if (!h) return;
    s.debut = h.debut;
    if (h.fin != null) s.fin = h.fin;
    S.toucher(d);
  }

  function majEffectif(el) {
    const sem = S.semaine(el.dataset.sem);
    const v = el.value === '' ? null : Math.max(0, Math.round(Number(el.value) || 0));
    if (v == null) delete sem.effectifs[el.dataset.eff]; else sem.effectifs[el.dataset.eff] = v;
    sem.majLe = Date.now();
    S.planifier();
    const etab = el.dataset.eff.split('|')[0];
    const total = Object.entries(sem.effectifs).filter(([k]) => k.split('|')[0] === etab).reduce((t, [, n]) => t + n, 0);
    $$(`[data-eff-total]`).filter((x) => x.dataset.effTotal === etab).forEach((x) => { x.textContent = `${total} patients`; });
  }

  /* Erreur inattendue (un clic qui ne fait rien, par exemple) : cadre rouge en haut de l'écran avec le message, à
     recopier pour le signaler. Il reste affiché jusqu'à « Fermer » ; les erreurs suivantes s'y ajoutent. */
  function afficherErreur(err) {
    const pile = (err && err.stack ? String(err.stack) : '').split('\n').slice(0, 4).map((l) => l.trim()).join('\n');
    const texte = `${err && err.message ? err.message : String(err)}${pile ? `\n${pile}` : ''}`;
    let cadre = $('#erreur');
    if (!cadre) {
      cadre = Object.assign(document.createElement('div'), { id: 'erreur', role: 'alert' });
      cadre.innerHTML = `<b>⚠ Erreur — v${VERSION} (onglet ${esc(ui.onglet)})</b><pre></pre>
        <div><button type="button" data-erreur="copier">Copier</button> <button type="button" data-erreur="fermer">Fermer</button></div>`;
      cadre.addEventListener('click', (e) => {
        const b = e.target.closest('[data-erreur]');
        if (!b) return;
        e.stopPropagation();
        if (b.dataset.erreur === 'fermer') { cadre.remove(); return; }
        const pre = $('pre', cadre);
        Promise.resolve().then(() => navigator.clipboard.writeText(pre.textContent))
          .then(() => toast('Erreur copiée'))
          .catch(() => { getSelection().selectAllChildren(pre); toast('Texte sélectionné : copiez-le (Ctrl+C)'); });
      });
      document.body.append(cadre);
    }
    const pre = $('pre', cadre);
    pre.textContent += `${pre.textContent ? '\n\n' : ''}${new Date().toLocaleTimeString('fr-FR')} · ${texte}`;
  }
  window.addEventListener('error', (e) => afficherErreur(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => afficherErreur(e.reason));

  /* ---------- Écouteurs ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.a];
    if (!fn) return;
    e.preventDefault();
    fn(el.dataset, el);
  });

  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    formulaires[f.dataset.form](f);
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.tagName === 'TEXTAREA') ajusterHauteur(el);
    if (el.dataset.f) majChamp(el);
    else if (el.dataset.note) majNote(el);
    else if (el.closest('[data-horaire-seg]') && !el.dataset.sel) majHoraireSeg(el);   // l'antenne (page Simplifiée) n'est pas un horaire
    else if (el.closest('[data-horaire]')) majHeureAppel(el);
    else if (el.closest('[data-plage]')) verifierPlage(el.closest('[data-plage]'));
    else if (el.dataset.eff) majEffectif(el);
    else if (el.dataset.semnote) {
      const sem = S.semaine(el.dataset.semnote);
      sem.note = el.value; sem.majLe = Date.now(); S.planifier();
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-heat]')) { ui.cibleHeat = el.value; rendre(); }
    if (el.dataset.sel) choisirEtabAntenne(el);
    if (el.dataset.cumulDepuis) choisirPeriodeCumul('debut');
    if (el.dataset.cumulJusqua) choisirPeriodeCumul('fin');
    if (el.matches('.puce input[type=radio]')) {
      $$('.puce', el.closest('.puces')).forEach((p) => p.classList.toggle('actif', p.contains(el)));
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.pile.length) fermerFeuille(); });

  /* NOM / PR saisis = case quittée avec une valeur changée : doublon réuni, barre remontée en haut.
     (Les horaires, eux, ne bougent rien avant « Valider ».) */
  const valeursAuFocus = new WeakMap();
  document.addEventListener('focusin', (e) => {
    if (!e.target.closest || !e.target.closest('[data-barre]')) return;
    valeursAuFocus.set(e.target, e.target.value);
    // Boutons de hauteur visibles au-dessus de la case Mémo / Commentaire active
    const note = e.target.closest('.b-note');
    $$('.b-note.ouvert').forEach((x) => { if (x !== note) x.classList.remove('ouvert'); });
    if (note) note.classList.add('ouvert');
  });
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    const plage = el.closest && el.closest('[data-plage]');
    if (plage) setTimeout(() => { if (plage.isConnected && !plage.contains(document.activeElement)) enregistrerPlage(plage); }, 0);
    const note = el.closest && el.closest('.b-note');
    // Masqués un instant après la sortie (toucher un bouton sur téléphone peut retirer le curseur de la case)
    if (note) setTimeout(() => { if (!note.contains(document.activeElement)) note.classList.remove('ouvert'); }, 300);
    if (!el.closest || !el.closest('[data-barre]') || !(el.dataset.f || el.dataset.note)) return;
    if (valeursAuFocus.get(el) === el.value) return;
    setTimeout(() => apresSaisieBarre(el), 0);   // après le déplacement du curseur vers la case suivante
  });

  // Infobulles des intitulés Stats : au survol, ou au clavier (Tab)
  document.addEventListener('mouseover', (e) => {
    const th = e.target.closest && e.target.closest('[data-info]');
    if (th && !th.contains(e.relatedTarget)) montrerInfo(th);
  });
  document.addEventListener('mouseout', (e) => {
    const th = e.target.closest && e.target.closest('[data-info]');
    if (th && !th.contains(e.relatedTarget)) cacherInfo();
  });
  document.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('[data-info]')) montrerInfo(e.target); });
  document.addEventListener('focusout', (e) => { if (e.target.matches && e.target.matches('[data-info]')) cacherInfo(); });
  document.addEventListener('scroll', cacherInfo, true);

  // Sur ordinateur, cliquer un bouton de hauteur ne retire pas le curseur de la case
  document.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.b-hauteur')) e.preventDefault(); });
  // Largeur de fenêtre changée : le texte se recoupe autrement, les cases se réajustent
  let attenteRedim = 0;
  window.addEventListener('resize', () => { clearTimeout(attenteRedim); attenteRedim = setTimeout(() => ajusterTout($('#vue')), 150); });

  // Double clic sur une barre (hors des cases de saisie) : interventions antérieures affichées / masquées
  document.addEventListener('dblclick', (e) => {
    const barre = e.target.closest('[data-barre]');
    if (!barre || e.target.closest('input, select, textarea, button, .b-interventions')) return;
    actions.historique({ id: barre.dataset.barre });
  });


  // Sauvegarde immédiate quand l'application passe en arrière-plan
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && S.state) S.sauver();
    if (document.visibilityState === 'visible' && S.state) rendre();
  });

  setInterval(() => { if (S.state) tic(); }, 1000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (!window.crypto || !crypto.subtle) {
    document.body.innerHTML = '<p class="erreur" style="padding:24px">Ce navigateur ne permet pas le chiffrement des données. Ouvrez l\'application via son adresse https.</p>';
  } else {
    rendreVerrou();
  }
})();
