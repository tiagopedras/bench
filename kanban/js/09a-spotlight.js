'use strict';

/* =========================================================================
   Spotlight

   Dims everything on the page except one element, so it can be used on any
   element, not only a card (the card hold in TaskCard.tsx is the first caller).

   It dims by opacity on the siblings of the element and of each of its
   ancestors, never on an ancestor itself. An ancestor's opacity would dim the
   spotlit element too, and an overlay behind it would be capped by whatever
   stacking context a column or a transform has made. Opacity on the other
   branches of the tree has neither problem.
   ========================================================================= */

let spotlit = [];
let spotTimer = 0;

function spotlight(el){
  clearSpotlight(true);
  for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) break;
    Array.from(parent.children).forEach(sib => {
      if (sib === node || /^(SCRIPT|STYLE|LINK|META)$/.test(sib.tagName)) return;
      sib.classList.add('spot-dim');
      spotlit.push(sib);
    });
  }
}

/* Fades back over 150ms: `spot-undim` carries the slower-out transition while
   the opacity returns to whatever the element had before. */
function clearSpotlight(now){
  window.clearTimeout(spotTimer);
  const els = spotlit;
  spotlit = [];
  els.forEach(e => { e.classList.remove('spot-dim'); if (!now) e.classList.add('spot-undim'); });
  if (now) { els.forEach(e => e.classList.remove('spot-undim')); return; }
  spotTimer = window.setTimeout(() => els.forEach(e => e.classList.remove('spot-undim')), 160);
}
