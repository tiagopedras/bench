'use strict';

/* A face for an agent, and only an agent — see AGENT_NAMES just above this in
   core/todo.js. Abstract geometric shapes on a flat background, in Tenon's own
   chart colours (--tenon-chart-1..10, see BUCKET_COLOR in kanban/js/02-state.js
   for the board's other user of that same set), seeded from the name itself so
   the same agent always draws the same picture and no two agents draw the
   same one by coincidence worth minding. No network call, no CDN, nothing to
   vendor — a few lines of arithmetic and a template string.

   Classic script, loaded right after core/todo.js and before every file in
   kanban/js/, so agentAvatarSVG() is a plain global by the time cardModel()
   (09-columns.js) and the drawer (19-drawer.js) reach for it. Free of window,
   document and state, the same rule core/todo.js keeps beside it, so it runs
   the same in the browser and in a bare Node vm. */

const AVATAR_PALETTE = [
  'var(--tenon-chart-1)', 'var(--tenon-chart-2)', 'var(--tenon-chart-3)', 'var(--tenon-chart-4)',
  'var(--tenon-chart-5)', 'var(--tenon-chart-6)', 'var(--tenon-chart-7)', 'var(--tenon-chart-8)',
  'var(--tenon-chart-9)', 'var(--tenon-chart-10)'
];

/* djb2 — not cryptographic, just a cheap, deterministic way to spread names
   across the palette and the shapes below. */
function avatarHash(name){
  let h = 5381;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}
/* A linear congruential step, so three shapes on one avatar don't all read
   off the same few bits of the name's hash. */
function avatarNext(seed){ return (seed * 1103515245 + 12345) >>> 0; }

const AVATAR_SHAPES = [
  (cx, cy, r, fill) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '"/>',
  (cx, cy, r, fill) => '<rect x="' + (cx - r) + '" y="' + (cy - r) + '" width="' + (r * 2) + '" height="' + (r * 2) +
    '" fill="' + fill + '" transform="rotate(45 ' + cx + ' ' + cy + ')"/>',
  (cx, cy, r, fill) => '<rect x="' + (cx - r) + '" y="' + (cy - r) + '" width="' + (r * 2) + '" height="' + (r * 2) + '" fill="' + fill + '"/>',
  (cx, cy, r, fill) => '<polygon points="' + [0, 1, 2].map(k => {
    const a = Math.PI * 2 * k / 3 - Math.PI / 2;
    return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
  }).join(' ') + '" fill="' + fill + '"/>'
];

/* The designed avatars, exported from Figma (file Cgocs5SMDGPSF5MzNan4Hu, node
   145:9194) as a white rounded square with one shape on it, on a 128x128 grid.
   Inlined because this file is a classic script with no fetch. Each is the
   shape's path alone; DESIGNED_FILL is its designed colour. 'Bucket planners'
   is one shape for every bucket, so a caller passes the bucket's own colour
   as `fill` — see bucketColor() in kanban/js/02-state.js. */
const AVATAR_TILE = 'M0 8C0 3.58172 3.58172 0 8 0H120C124.418 0 128 3.58172 128 8V120C128 124.418 124.418 128 120 128H8C3.58172 128 0 124.418 0 120V8Z';
const DESIGNED_AVATARS = {
  'PA': ['<path d="M64 18.1194L103.837 41.0596V86.9402L64 109.88L24.1628 86.9402V41.0596L64 18.1194Z" fill="FILL"/>', '#6AA0FF'],
  'Plan agent': ['<path d="M64 18.1194L107.749 49.822L91.0381 101.118H36.9619L20.2514 49.822L64 18.1194Z" fill="FILL"/>', '#F0B355'],
  'Implement agent': ['<path d="M64 18.1194L110 63.9999L64 109.88L18 63.9999L64 18.1194Z" fill="FILL"/>', '#A98CF0'],
  'Bucket planners': ['<circle cx="64" cy="64" r="41.8909" fill="FILL"/>', '#FF887C']
};
function designedAvatarSvg(name, size, fill){
  const d = DESIGNED_AVATARS[name];
  if (!d) return '';
  const px = size || 20;
  return '<svg viewBox="0 0 128 128" width="' + px + '" height="' + px + '" aria-hidden="true" focusable="false">' +
    '<path d="' + AVATAR_TILE + '" fill="white"/>' + d[0].replace('FILL', fill || d[1]) + '</svg>';
}

/* An agent's avatar as a self-contained <svg> string. A name with a design
   gets it (`fill` recolours the shape); any other draws a rounded square in
   one Tenon colour with three overlapping shapes in others on top, on a 40x40
   grid. `size` is the drawn width and height in CSS pixels. */
function avatarSvg(name, size, fill){
  const designed = designedAvatarSvg(name, size, fill);
  if (designed) return designed;
  const h = avatarHash(name);
  const px = size || 20;
  let svg = '<svg viewBox="0 0 40 40" width="' + px + '" height="' + px + '" aria-hidden="true" focusable="false">' +
    '<rect width="40" height="40" rx="9" fill="' + AVATAR_PALETTE[h % AVATAR_PALETTE.length] + '"/>';
  let seed = h || 1;
  for (let i = 0; i < 3; i++) {
    seed = avatarNext(seed);
    // seed can sit past 2^31, where JS's >> sign-extends — >>> throughout
    // keeps every slice of it an ordinary unsigned number. Shape reads the
    // high bits rather than seed's own low ones: this LCG's low bits are the
    // textbook-weak part of it, cycling through far too few values.
    const shape = AVATAR_SHAPES[(seed >>> 20) % AVATAR_SHAPES.length];
    const fill = AVATAR_PALETTE[(seed >>> 8) % AVATAR_PALETTE.length];
    const cx = 9 + (seed >>> 4) % 22;
    const cy = 9 + (seed >>> 12) % 22;
    const r = 5 + (seed >>> 16) % 7;
    svg += shape(cx, cy, r, fill);
  }
  return svg + '</svg>';
}
/* The avatar wrapped for drawing beside a name, or '' for anyone agentOf()
   does not recognise — the one call site the drawer and the board both use,
   so "agents only, people get none" is decided in one place. */
function agentAvatarHTML(to, size){
  const agent = agentOf(to);
  if (!agent) return '';
  return '<span class="avatar" aria-hidden="true">' + avatarSvg(agent, size) + '</span>';
}
/* A bucket planner's avatar, in its bucket's colour (`color` from bucketColor()). */
function plannerAvatarHTML(color, size){
  return '<span class="avatar" aria-hidden="true">' + avatarSvg('Bucket planners', size, color) + '</span>';
}
