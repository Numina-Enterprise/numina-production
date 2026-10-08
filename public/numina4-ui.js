// Preserve bookmarked operational links after separating the public home page.
const legacyOperationAnchors = new Set(["frontier-status", "refresh", "head-state", "canonical-root", "canonical-head", "head-revision", "chain-state", "chain-height", "chain-observed", "account-status", "requests", "treasury", "treasury-status", "treasury-balances", "funding-plan", "accounts", "treasury-actions", "treasury-policy", "providers", "runtime-metrics", "telemetry-status", "telemetry-refresh", "telemetry-values", "subagent-control-room", "tree-refresh", "tree-status", "root-title", "tree-root-values", "rooms-title", "room-count", "tree-rooms", "tasks-title", "task-status", "tree-task-form", "task-room", "tree-tasks", "deployment-readiness"]);
if (["/", "/index.html"].includes(location.pathname) && legacyOperationAnchors.has(location.hash.slice(1))) {
  location.replace("/frontier" + location.search + location.hash);
}
// Presentation-only behavior. Runtime records and authority stay in their existing modules.
const controls = document.querySelector('#operations');
function exposeAnchor() {
  if (!location.hash) return;
  let target;
  try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { return; }
  if (!target || !controls?.contains(target)) return;
  controls.open = true;
  requestAnimationFrame(() => target.scrollIntoView({block: 'start', behavior: 'instant'}));
}
window.addEventListener('hashchange', exposeAnchor);
exposeAnchor();
document.querySelector('a[href="#operations"]')?.addEventListener('click', () => { if (controls) controls.open = true; });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
if (!reduceMotion.matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add('v4-in-view'); observer.unobserve(entry.target);
    }
  }, {threshold: 0.08});
  document.querySelectorAll('.enterprise-overview, .v4-architecture, .v4-operations').forEach(section => observer.observe(section));
}
