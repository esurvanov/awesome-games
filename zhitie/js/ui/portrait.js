// Портрет сима — простая SVG-голова по look (кожа, рубашка, волосы). Без фото-рендера:
// дёшево, чётко на любом зуме, и зрачки можно поворачивать (круговое меню).
import { hash01 } from './dom.js';

const HAIR = ['#3b2a1e', '#6b4226', '#a8753a', '#d8b36a', '#1f1f24', '#8a3b22'];

export function portraitSvg(sim, size = 40) {
  const look = sim?.look || {};
  const skin = look.skin || '#e0b48f';
  const shirt = look.shirt || '#4a7fc1';
  const hair = look.hair || HAIR[Math.floor(hash01(sim?.id ?? sim?.name ?? 0) * HAIR.length)];
  const female = (look.body || look.gender) === 'female';
  // волосы: у «female» — длинные по бокам, у «male» — шапочка
  const hairBack = female ? `<path d="M10 20c0-10 5-14 10-14s10 4 10 14v10h-4V20H14v10h-4z" fill="${hair}"/>` : '';
  const hairTop = female
    ? `<path d="M11 18c1-7 5-10 9-10s8 3 9 10c-3-3-6-4-9-4s-6 1-9 4z" fill="${hair}"/>`
    : `<path d="M11.5 17c.5-6 4-9 8.5-9s8 3 8.5 9c-2-2.5-5-3.5-8.5-3.5S13.5 14.5 11.5 17z" fill="${hair}"/>`;
  return `<svg class="portrait" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="20" fill="#dbe7f7"/>
    ${hairBack}
    <path d="M6 40c1-8 6-11 14-11s13 3 14 11z" fill="${shirt}"/>
    <rect x="17" y="24" width="6" height="6" fill="${skin}"/>
    <ellipse cx="20" cy="18" rx="8.5" ry="9.5" fill="${skin}"/>
    ${hairTop}
    <g class="eyes" style="transform:translate(var(--ex,0px),var(--ey,0px))">
      <circle cx="16.8" cy="19" r="1.25" fill="#1e2433"/><circle cx="23.2" cy="19" r="1.25" fill="#1e2433"/>
    </g>
    <path d="M17.5 23.2c1.5 1 3.5 1 5 0" stroke="#8a4a3a" stroke-width="1" fill="none" stroke-linecap="round"/>
  </svg>`;
}
