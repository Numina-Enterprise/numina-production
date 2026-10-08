// Native disclosure menus remain usable without JavaScript.
const menus = [...document.querySelectorAll('.mobile-menu, .n-nav-menu')];
for (const menu of menus) {
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
  menu.addEventListener('toggle', () => {
    if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
  });
  matchMedia('(min-width: 1280px)').addEventListener('change', () => {
    menu.open = false;
  });
  menu.addEventListener('focusout', event => {
    if (event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
  });
  window.addEventListener('pageshow', () => { menu.open = false; });
}
