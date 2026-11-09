const buttons=[...document.querySelectorAll('[data-topology-filter]')];
const cards=[...document.querySelectorAll('[data-provider-group]')];
for(const button of buttons)button.addEventListener('click',()=>{
  const selected=button.dataset.topologyFilter;
  for(const item of buttons)item.setAttribute('aria-pressed',String(item===button));
  for(const card of cards)card.hidden=selected!=='all'&&card.dataset.providerGroup!==selected;
  const count=cards.filter(card=>!card.hidden).length;
  document.querySelector('#provider-count').textContent=count+' destinations shown';
});
