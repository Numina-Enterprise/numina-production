const ROOT = '/workspace/numina-production';
const TEAMS = ['engineering', 'deployment', 'proofs', 'signatures', 'review'];
const STATES = new Set(['queued', 'executing', 'completed', 'needs_evidence', 'failed']);
const READINESS = new Set(['ready_for_cloud_review', 'needs_evidence']);
const LABELS = {queued: 'Queued', executing: 'Executing', completed: 'Completed', needs_evidence: 'Needs evidence', failed: 'Failed', ready_for_cloud_review: 'Ready for cloud review'};
const byId = id => document.getElementById(id);
const form = byId('task-filters');
let ledger = null;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function text(value, maximum = 1200) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function validReceipt(value) {
  return value && typeof value === 'object' && text(value.path, 400) &&
    typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256) && value.sha256.length === 64 &&
    text(value.runId, 160);
}

function validate(value, workspace) {
  if (!value || value.schema !== 'numina.agentforce-tasks.v1' || value.canonicalRoot !== ROOT ||
      value.configurationStatus !== 'prepared' || value.taskCount !== 100 ||
      !Array.isArray(value.tasks) || value.tasks.length !== 100 ||
      !value.execution || value.execution.mode !== 'cloud_team_executor' ||
      value.execution.salesforceAgentActivationEstablished !== false ||
      value.execution.workspaceCountIsConcurrency !== false || value.execution.executionCapacityReserved !== false ||
      !value.executionPolicy || value.executionPolicy.autonomousFinancialActions !== false ||
      value.executionPolicy.autonomousProviderMutations !== false ||
      !workspace || workspace.schema !== 'numina.workspaces.v1' || workspace.canonicalRoot !== ROOT ||
      !Array.isArray(workspace.workspaces)) {
    throw new Error('The task ledger is unavailable in the expected prepared format.');
  }
  const configurations = workspace.workspaces.filter(item => item?.kind === 'agentforce');
  const expected = new Map(configurations.map(item => [item.id, item.team]));
  if (configurations.length !== 100 || expected.size !== 100) throw new Error('The workspace configurations need review.');
  const ids = new Set();
  for (const task of value.tasks) {
    if (!task || !text(task.id, 14) || task.id.length !== 14 ||
        !/^agentforce-(?:00[1-9]|0[1-9][0-9]|100)$/.test(task.id) || ids.has(task.id) ||
        task.configurationId !== task.id || task.canonicalRoot !== ROOT || expected.get(task.id) !== task.team ||
        !TEAMS.includes(task.team) || !STATES.has(task.status) || !READINESS.has(task.readiness) ||
        !text(task.title, 160) || !text(task.nextBestAction) || !text(task.target, 400) ||
        !task.workerAssignment || task.workerAssignment.type !== 'cloud_team_executor' ||
        !text(task.workerAssignment.agentTask, 160) || task.workerAssignment.salesforceAgentActivated !== false ||
        !Array.isArray(task.dependencies) || task.dependencies.some(item => !item || !text(item.id, 160) || !text(item.status, 80)) ||
        !task.acceptance || task.acceptance.requiresMatchingReceipt !== true || !text(task.acceptance.passCondition) ||
        !text(task.acceptance.receiptPath, 400) || !task.onFailure || task.onFailure.showMessage !== true ||
        (task.status === 'completed' && !validReceipt(task.lastReceipt)) ||
        (task.status === 'executing' && !validReceipt(task.startReceipt))) {
      throw new Error('A task needs a valid state, assignment and matching record before it can be shown.');
    }
    ids.add(task.id);
  }
  if (ids.size !== expected.size || [...expected.keys()].some(id => !ids.has(id))) {
    throw new Error('Task IDs do not match the prepared workspace configurations.');
  }
  return value;
}

function field(list, name, value) {
  const row = node('div');
  row.append(node('dt', name), node('dd', value));
  list.append(row);
}

function receiptUrl(receipt) {
  if (!receipt || !text(receipt.url, 500)) return null;
  try {
    const url = new URL(receipt.url, location.origin);
    if (url.origin === location.origin && !url.search && !url.hash &&
        /^\/(?:downloads|receipts)\//.test(url.pathname)) return url.href;
  } catch {}
  return null;
}

function render() {
  if (!ledger) return;
  const query = byId('task-search').value.trim().toLocaleLowerCase();
  const team = byId('task-team').value;
  const state = byId('task-state').value;
  const tasks = ledger.tasks.filter(task =>
    (team === 'all' || task.team === team) &&
    (state === 'all' || task.status === state || task.readiness === state) &&
    (!query || [task.id, task.title, task.nextBestAction, task.team, task.target,
      ...task.dependencies.map(item => `${item.id} ${item.status}`)].join(' ').toLocaleLowerCase().includes(query)));
  const fragment = document.createDocumentFragment();
  for (const task of tasks) {
    const card = node('article', undefined, 'workspace-card');
    card.id = `task-${task.id}`;
    const headingId = `heading-${task.id}`;
    card.setAttribute('aria-labelledby', headingId);
    const header = node('div', undefined, 'workspace-card-header');
    header.append(node('span', task.id, 'workspace-kind'), node('span', LABELS[task.status], 'status-pill'));
    const heading = node('h3', task.title);
    heading.id = headingId;
    const facts = node('dl');
    field(facts, 'Team', task.team);
    field(facts, 'Cloud assignment', task.workerAssignment.agentTask);
    field(facts, 'Target', task.target);
    field(facts, 'Readiness', LABELS[task.readiness]);
    field(facts, 'Dependencies', task.dependencies.map(item => `${item.id}: ${item.status.replaceAll('_', ' ')}`).join('; ') || 'No dependency recorded');
    field(facts, 'Acceptance condition', task.acceptance.passCondition);
    field(facts, 'Receipt', task.lastReceipt ? `${task.lastReceipt.path} · ${task.lastReceipt.sha256 || 'Digest not recorded'}` : 'No acceptance receipt recorded');
    if (task.status === 'failed') field(facts, 'Action required', task.failure?.message || task.onFailure.manualHandoff || 'Read the failure record before retrying.');
    const workspace = node('a', 'Open configuration ↗', 'text-link');
    workspace.href = `/workspaces.html#workspace-${task.id}`;
    card.append(header, heading, node('p', task.nextBestAction), facts, workspace);
    const url = receiptUrl(task.lastReceipt);
    if (url) {
      const receipt = node('a', ' Read receipt ↗', 'text-link');
      receipt.href = url;
      card.append(receipt);
    }
    fragment.append(card);
  }
  byId('task-cards').replaceChildren(fragment);
  byId('task-empty').hidden = tasks.length !== 0;
  byId('task-status').classList.remove('error');
  byId('task-status').textContent = `Showing ${tasks.length} of 100 task records. Salesforce activation is not established by this cloud queue.`;
  byId('task-count').textContent = String(ledger.tasks.length);
  byId('executing-count').textContent = String(ledger.tasks.filter(task => task.status === 'executing').length);
  byId('completed-count').textContent = String(ledger.tasks.filter(task => task.status === 'completed' && validReceipt(task.lastReceipt)).length);
  byId('attention-count').textContent = String(ledger.tasks.filter(task => task.status === 'failed' || task.status === 'needs_evidence' || task.readiness === 'needs_evidence').length);
}

async function readJson(path, maximum) {
  const response = await fetch(path, {headers: {Accept: 'application/json'}, credentials: 'omit', cache: 'no-store'});
  if (!response.ok) throw new Error(`The ${path} record could not be read (${response.status}).`);
  const content = await response.text();
  if (content.length > maximum) throw new Error('The task records exceed the supported reader size.');
  return JSON.parse(content);
}

async function load() {
  byId('task-retry').hidden = true;
  byId('task-status').textContent = 'Reading the task ledger…';
  byId('task-status').classList.remove('error');
  for (const control of form.elements) control.disabled = true;
  try {
    const [tasks, workspaces] = await Promise.all([readJson('/tasks.json', 524288), readJson('/workspaces.json', 262144)]);
    ledger = validate(tasks, workspaces);
    render();
    for (const control of form.elements) control.disabled = false;
  } catch (error) {
    ledger = null;
    byId('task-cards').replaceChildren();
    byId('task-status').classList.add('error');
    byId('task-status').textContent = error instanceof Error ? error.message : 'The task ledger could not be read.';
    for (const id of ['task-count', 'executing-count', 'completed-count', 'attention-count']) byId(id).textContent = '—';
    byId('task-empty').hidden = true;
    byId('task-retry').hidden = false;
  }
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('reset', event => {
  event.preventDefault();
  byId('task-search').value = '';
  byId('task-team').value = 'all';
  byId('task-state').value = 'all';
  render();
});
byId('task-search').addEventListener('input', render);
byId('task-team').addEventListener('change', render);
byId('task-state').addEventListener('change', render);
byId('task-retry').addEventListener('click', load);
load();
