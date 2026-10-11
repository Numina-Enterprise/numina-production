const CANONICAL_ROOT = '/workspace/numina-production';
const TEAM_IDS = ['engineering', 'deployment', 'proofs', 'signatures', 'review'];
const DESTINATIONS = new Set(['/build', '/deployment-readiness', '/downloads/provenance/decoded-attribution-closure-2026-10-11/README.md', '/provenance', '/control', '/integrations']);
const PAPER_SHA256 = '3e5db9f5ef29b7adb7ce408488b6c78cdd7121732d92efa638157de7a96f3ce9';
const PERSONAL_ORDER = [
  ['Samuel J. Kott', '1A', 'source_2', 'UNIVERSAL_PAIR_2'],
  ['Lauren J. Anderson', '1B', 'source_1', 'UNIVERSAL_PAIR_1']
];
const byId = id => document.getElementById(id);
const form = byId('workspace-filters');
const search = byId('workspace-search');
const kind = byId('workspace-kind');
const team = byId('workspace-team');
let manifest = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function validate(value) {
  if (!value || value.schema !== 'numina.workspaces.v1' || value.canonicalRoot !== CANONICAL_ROOT ||
      value.workspaceBase !== '/workspace/numina-workspaces' || value.linkName !== 'numina-production' ||
      value.configurationStatus !== 'prepared' || value.salesforce?.deploymentStatus !== 'not_deployed' ||
      value.salesforce?.orgConfigured !== false || value.salesforce?.agentConfigured !== false ||
      value.salesforce?.licenseOrQuotaEstablished !== false || value.agentExecution?.workspaceCountIsConcurrency !== false ||
      value.agentExecution?.runningAgentsEstablished !== false || value.agentExecution?.executionCapacityReserved !== false ||
      !Array.isArray(value.workspaces) || value.workspaces.length !== 105) {
    throw new Error('The workspace manifest is not available in the expected prepared format.');
  }
  const ids = new Set();
  for (const room of value.workspaces) {
    if (!room || typeof room.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}(?![\s\S])/.test(room.id) || ids.has(room.id) ||
        !['team', 'agentforce'].includes(room.kind) || !TEAM_IDS.includes(room.team) || room.status !== 'prepared' ||
        typeof room.name !== 'string' || !room.name || room.name.length > 80 ||
        typeof room.description !== 'string' || room.description.length > 240 || !DESTINATIONS.has(room.destination) ||
        (room.kind === 'team' && (room.id !== room.team || !TEAM_IDS.includes(room.id))) ||
        (room.kind === 'agentforce' && !/^agentforce-(?:00[1-9]|0[1-9][0-9]|100)(?![\s\S])/.test(room.id))) {
      throw new Error('A workspace entry needs review before this directory can be shown.');
    }
    ids.add(room.id);
  }
  if (value.workspaces.filter(room => room.kind === 'team').length !== 5 || value.workspaces.filter(room => room.kind === 'agentforce').length !== 100) {
    throw new Error('The prepared workspace counts do not match this directory.');
  }
  const attribution = value.attribution;
  if (attribution?.schema !== 'numina.workspace-attribution.v1' || attribution.historicalSignedAliasesChanged !== false ||
      attribution.signedManuscriptChanged !== false || attribution.signingAuthorityGrantedByAttribution !== false ||
      !Array.isArray(attribution.personalOrder) || attribution.personalOrder.length !== 2 ||
      attribution.paperReference?.filename !== 'draft-kott-numina-pair-binding-02-final.pdf' ||
      attribution.paperReference.sha256 !== PAPER_SHA256 ||
      JSON.stringify(attribution.paperReference.pages) !== '[76,77]') {
    throw new Error('The manuscript attribution reference needs review.');
  }
  attribution.personalOrder.forEach((person, index) => {
    const [name, label, sourceId, sourceAlias] = PERSONAL_ORDER[index];
    if (person.name !== name || person.label !== label || person.retainedSourceId !== sourceId ||
        person.retainedSourceAlias !== sourceAlias || typeof person.role !== 'string' || person.role.length > 80) {
      throw new Error('The personal display order does not match the retained attribution.');
    }
  });
  const controlRoom = value.controlRoom;
  if (controlRoom?.id !== 'control-room' || controlRoom.canonicalRoot !== CANONICAL_ROOT ||
      controlRoom.destination !== '/control' || controlRoom.taskLedgerDestination !== '/task-ledger.html' ||
      controlRoom.personalMoneyActionsEnabled !== false) {
    throw new Error('The control room reference needs review.');
  }
  const communication = value.communicationRooms;
  if (communication?.schema !== 'numina.communication-room-map.v1' || communication.roomCount !== 17 ||
      communication.publicRoomCount !== 13 || communication.privateRoomCount !== 4 ||
      communication.privateRoomDetailsPublished !== false || !Array.isArray(communication.rooms) ||
      communication.rooms.length !== 17 || typeof communication.observedAtUtc !== 'string' || communication.observedAtUtc.length > 40) {
    throw new Error('The communication room map needs review.');
  }
  const communicationIds = new Set();
  for (const room of communication.rooms) {
    if (!room || communicationIds.has(room.id) || typeof room.description !== 'string' || room.description.length > 240) {
      throw new Error('A communication room entry needs review.');
    }
    if (room.visibility === 'public') {
      if (typeof room.name !== 'string' || !/^[a-z][a-z0-9-]{0,79}(?![\s\S])/.test(room.name) || room.id !== `slack-${room.name}` ||
          typeof room.destination !== 'string' || !/^https:\/\/numina-labs\.slack\.com\/archives\/C[A-Z0-9]+(?![\s\S])/.test(room.destination)) {
        throw new Error('A public room link needs review.');
      }
    } else if (room.visibility === 'private') {
      const match = /^private-slack-room-0([1-4])(?![\s\S])/.exec(room.id);
      if (!match || room.name !== `Private Slack room ${match[1]}` || room.destination !== '/control') {
        throw new Error('A private room placeholder needs review.');
      }
    } else throw new Error('A communication room visibility needs review.');
    communicationIds.add(room.id);
  }
  if (communication.rooms.filter(room => room.visibility === 'public').length !== 13 ||
      communication.rooms.filter(room => room.visibility === 'private').length !== 4) {
    throw new Error('The communication room counts do not match the observed map.');
  }
  return value;
}

function field(list, label, value) {
  const row = element('div');
  row.append(element('dt', label), element('dd', value));
  list.append(row);
}

function renderCards() {
  if (!manifest) return;
  const query = search.value.trim().toLocaleLowerCase();
  const teamNames = new Map(manifest.workspaces.filter(room => room.kind === 'team').map(room => [room.id, room.name]));
  const rooms = manifest.workspaces.filter(room =>
    (kind.value === 'all' || room.kind === kind.value) && (team.value === 'all' || room.team === team.value) &&
    (!query || `${room.id} ${room.name} ${room.team} ${room.description}`.toLocaleLowerCase().includes(query)));
  const fragment = document.createDocumentFragment();
  for (const room of rooms) {
    const card = element('article', undefined, 'workspace-card');
    card.id = `workspace-${room.id}`;
    const headingId = `heading-${room.id}`;
    card.setAttribute('aria-labelledby', headingId);
    const header = element('div', undefined, 'workspace-card-header');
    header.append(element('span', room.kind === 'team' ? 'Team room' : 'Agentforce', 'workspace-kind'), element('span', 'Prepared', 'status-pill'));
    const heading = element('h3', room.name);
    heading.id = headingId;
    const facts = element('dl');
    field(facts, 'Team', teamNames.get(room.team));
    field(facts, 'Local workspace', `${manifest.workspaceBase}/${room.id}`);
    field(facts, 'Production link', `${manifest.workspaceBase}/${room.id}/${manifest.linkName} → ${manifest.canonicalRoot}`);
    const link = element('a', room.kind === 'agentforce' ? 'Open integration preparation ↗' : 'Open team tools ↗', 'text-link');
    link.href = room.destination;
    card.append(header, heading, element('p', room.description), facts, link);
    fragment.append(card);
  }
  byId('workspace-cards').replaceChildren(fragment);
  byId('workspace-empty').hidden = rooms.length !== 0;
  byId('workspace-status').classList.remove('error');
  byId('workspace-status').textContent = `Showing ${rooms.length} of ${manifest.workspaces.length} prepared workspaces. Salesforce agents have not been deployed by this configuration.`;
}

function resetFilters() {
  search.value = '';
  kind.value = 'all';
  team.value = 'all';
}

function renderHouse() {
  const rooms = manifest.workspaces.filter(room => room.kind === 'team');
  const fragment = document.createDocumentFragment();
  rooms.forEach((room, index) => {
    const link = element('a', undefined, 'house-room');
    link.href = `#workspace-${room.id}`;
    link.append(element('span', `ROOM ${String(index + 1).padStart(2, '0')}`, 'room-number'), element('strong', room.name), element('span', room.description));
    link.addEventListener('click', () => { resetFilters(); renderCards(); });
    fragment.append(link);
  });
  const wing = element('a', undefined, 'house-room agentforce-wing');
  wing.href = '#workspace-directory';
  wing.append(element('span', '100 PREPARED WORKSPACES', 'room-number'), element('strong', 'Agentforce wing'), element('span', 'Explore the prepared configurations.'));
  wing.addEventListener('click', () => { resetFilters(); kind.value = 'agentforce'; renderCards(); search.focus({preventScroll: true}); });
  fragment.append(wing);
  byId('house-rooms').replaceChildren(fragment);
  const options = document.createDocumentFragment();
  options.append(element('option', 'All teams'));
  options.firstChild.value = 'all';
  for (const room of rooms) {
    const option = element('option', room.name);
    option.value = room.id;
    options.append(option);
  }
  team.replaceChildren(options);
  byId('root-path').textContent = manifest.canonicalRoot;
  byId('team-count').textContent = String(rooms.length);
  byId('agentforce-count').textContent = String(manifest.workspaces.filter(room => room.kind === 'agentforce').length);
  byId('deployment-count').textContent = '0';
}

function renderAttributionAndRooms() {
  const people = document.createDocumentFragment();
  for (const person of manifest.attribution.personalOrder) {
    const card = element('article', undefined, 'workspace-card');
    card.append(element('span', `PERSONAL LABEL ${person.label}`, 'workspace-kind'), element('h3', person.name), element('p', person.role));
    const facts = element('dl');
    field(facts, 'Retained source identity', `${person.retainedSourceId} / ${person.retainedSourceAlias}`);
    card.append(facts);
    people.append(card);
  }
  byId('attribution-cards').replaceChildren(people);
  byId('paper-reference').textContent = `Retained manuscript: ${manifest.attribution.paperReference.filename}, Appendix F, pages 76–77. SHA-256 ${PAPER_SHA256}.`;
  const rooms = document.createDocumentFragment();
  for (const room of manifest.communicationRooms.rooms) {
    const card = element('article', undefined, 'workspace-card');
    card.append(element('span', room.visibility === 'public' ? 'Slack workspace public room' : 'Owner coordination', 'workspace-kind'), element('h3', room.name),
      element('p', room.visibility === 'public' ? 'Open this room with your Numina Labs workspace access.' : 'Room details are available through authorized owner coordination.'));
    const link = element('a', room.visibility === 'public' ? 'Open Slack room ↗' : 'Open control room ↗', 'text-link');
    link.href = room.destination;
    card.append(link);
    rooms.append(card);
  }
  byId('communication-rooms').replaceChildren(rooms);
  byId('communication-status').textContent = `17 observed Slack rooms: 13 public workspace links and four private room placeholders. Readback ${manifest.communicationRooms.observedAtUtc}.`;
}

async function loadManifest() {
  byId('workspace-retry').hidden = true;
  byId('workspace-status').textContent = 'Reading the workspace manifest…';
  byId('workspace-status').classList.remove('error');
  for (const control of form.elements) control.disabled = true;
  try {
    const response = await fetch('/workspaces.json', {headers: {Accept: 'application/json'}, credentials: 'omit', cache: 'no-store'});
    if (!response.ok) throw new Error('The workspace manifest could not be read.');
    manifest = validate(await response.json());
    renderHouse();
    renderAttributionAndRooms();
    resetFilters();
    renderCards();
    for (const control of form.elements) control.disabled = false;
  } catch (error) {
    manifest = null;
    byId('workspace-status').classList.add('error');
    byId('workspace-status').textContent = error instanceof Error ? error.message : 'The workspace manifest could not be read.';
    byId('workspace-cards').replaceChildren();
    byId('house-rooms').replaceChildren();
    byId('attribution-cards').replaceChildren();
    byId('communication-rooms').replaceChildren();
    byId('paper-reference').textContent = 'The manuscript reference could not be read.';
    byId('communication-status').textContent = 'The observed room map could not be read.';
    byId('team-count').textContent = '—';
    byId('agentforce-count').textContent = '—';
    byId('deployment-count').textContent = '—';
    byId('workspace-empty').hidden = true;
    byId('workspace-retry').hidden = false;
  }
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('reset', event => { event.preventDefault(); resetFilters(); renderCards(); });
search.addEventListener('input', renderCards);
kind.addEventListener('change', renderCards);
team.addEventListener('change', renderCards);
byId('workspace-retry').addEventListener('click', loadManifest);
loadManifest();
