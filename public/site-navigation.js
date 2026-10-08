// Native details works without JavaScript. Enhance keyboard and viewport transitions.
const menu = document.querySelector('.mobile-menu');
if (menu) {
  const summary = menu.querySelector('summary');
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { menu.open = false; summary.focus(); }
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('a')) menu.open = false;
  });
  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  matchMedia('(min-width: 1060px)').addEventListener('change', event => {
    if (event.matches) menu.open = false;
  });
  menu.addEventListener('focusout', event => {
    if (event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
  });
  window.addEventListener('pageshow', () => { menu.open = false; });
}
