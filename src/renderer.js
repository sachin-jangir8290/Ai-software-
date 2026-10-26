const $ = (s) => document.querySelector(s);
const tabs = [];
let active = null;
const history = []; // conversation with the companion

const settings = Object.assign(
  { apiKey: '', model: 'claude-sonnet-5-5', agentMode: true },
  JSON.parse(localStorage.getItem('nova-settings') || '{}')
);

const COMPANIONS = {
  assistant: 'You are Nova, a helpful browsing assistant.',
  research: 'You are Nova Researcher. Investigate thoroughly, cite URLs, and separate facts from opinions.',
  sales: 'You are Nova Sales. Identify leads, company info, decision makers, and draft concise outreach messages.',
  writer: 'You are Nova Writer. Produce clear, polished drafts and rewrites in the requested tone.',
  analyst: 'You are Nova Analyst. Extract structured data, build tables, and highlight trends and numbers.'
};

const AGENT_RULES = `
You are embedded in a web browser and can see the current page.
When you need to act on the page, reply with ONLY a JSON object (no prose) of one of these forms:
{"action":"click","selector":"CSS selector","why":"..."}
{"action":"type","selector":"CSS selector","text":"...","submit":true|false,"why":"..."}
{"action":"navigate","url":"https://...","why":"..."}
{"action":"scroll","why":"..."}
After each action you will receive the updated page. When the task is done, or no action is needed, reply in normal text.
Never enter passwords or payment details, and never submit purchases without the user's explicit confirmation.`;

// ---------- Tabs ----------
function toURL(input) {
  const t = input.trim();
  if (/^[a-z]+:\/\//i.test(t)) return t;
  if (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return 'https://' + t;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(t);
}

function newTab(url = 'https://duckduckgo.com') {
  const view = document.createElement('webview');
  view.setAttribute('src', url);
  view.setAttribute('allowpopups', '');
  $('#views').appendChild(view);
  const el = document.createElement('div');
  el.className = 'tab';
  el.innerHTML = '<span>New tab</span><b>×</b>';
  $('#tabs').appendChild(el);
  const tab = { view, el };
  tabs.push(tab);
  el.onclick = (e) => (e.target.tagName === 'B' ? closeTab(tab) : select(tab));
  view.addEventListener('page-title-updated', (e) => (el.firstChild.textContent = e.title));
  view.addEventListener('did-navigate', (e) => tab === active && ($('#url').value = e.url));
  view.addEventListener('did-navigate-in-page', (e) => tab === active && e.isMainFrame && ($('#url').value = e.url));
  select(tab);
  return tab;
}

function select(tab) {
  active = tab;
  for (const t of tabs) {
    t.view.classList.toggle('hidden', t !== tab);
    t.el.classList.toggle('active', t === tab);
  }
  try { $('#url').value = tab.view.getURL(); } catch { $('#url').value = tab.view.getAttribute('src'); }
}

function closeTab(tab) {
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  tab.view.remove();
  tab.el.remove();
  if (!tabs.length) newTab();
  else if (tab === active) select(tabs[Math.max(0, i - 1)]);
}

// ---------- Page reading & actions ----------
const READ_PAGE = `(() => {
  const els = [...document.querySelectorAll('a,button,input,textarea,select,[role=button]')].slice(0, 120);
  const sel = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    const idx = [...el.parentNode.children].indexOf(el) + 1;
    let p = el, path = [];
    while (p && p !== document.body && path.length < 4) {
      const i = [...p.parentNode.children].indexOf(p) + 1;
      path.unshift(p.tagName.toLowerCase() + ':nth-child(' + i + ')'); p = p.parentNode;
    }
    return path.join(' > ');
  };
  const interactive = els.filter(e => e.offsetParent !== null).map(e =>
    '- ' + e.tagName.toLowerCase() + ' "' + (e.innerText || e.value || e.placeholder || e.ariaLabel || '').trim().slice(0, 60) + '" => ' + sel(e));
  return { url: location.href, title: document.title,
    text: document.body.innerText.replace(/\\n{3,}/g, '\\n\\n').slice(0, 15000),
    interactive: interactive.join('\\n') };
})()`;

async function readPage(view = active.view) {
  try { return await view.executeJavaScript(READ_PAGE); }
  catch { return { url: '', title: '', text: '(page not readable)', interactive: '' }; }
}

function pageContext(p) {
  return `CURRENT PAGE\nURL: ${p.url}\nTitle: ${p.title}\n\nCONTENT:\n${p.text}\n\nINTERACTIVE ELEMENTS:\n${p.interactive}`;
}

async function perform(act) {
  const v = active.view;
  const s = JSON.stringify(act.selector || '');
  if (act.action === 'navigate') { v.loadURL(toURL(act.url)); }
  else if (act.action === 'scroll') { await v.executeJavaScript('window.scrollBy(0, innerHeight*0.8)'); }
  else if (act.action === 'click') {
    const ok = await v.executeJavaScript(`(()=>{const e=document.querySelector(${s}); if(!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true;})()`);
    if (!ok) return 'Element not found: ' + act.selector;
  } else if (act.action === 'type') {
    const ok = await v.executeJavaScript(`(()=>{const e=document.querySelector(${s}); if(!e) return false; e.focus();
      const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set; set?set.call(e,${JSON.stringify(act.text)}):(e.value=${JSON.stringify(act.text)});
      e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));
      if(${!!act.submit}){ e.form ? e.form.requestSubmit() : e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); } return true;})()`);
    if (!ok) return 'Element not found: ' + act.selector;
  }
  await new Promise((r) => setTimeout(r, 1500)); // let the page settle
  return 'Done.';
}

function parseAction(text) {
  const m = text.trim().match(/^\{[\s\S]*\}$/);
  if (!m) return null;
  try { const j = JSON.parse(m[0]); return j.action ? j : null; } catch { return null; }
}

// ---------- Chat ----------
function addMsg(text, cls) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text;
  $('#chat').appendChild(d);
  $('#chat').scrollTop = 1e9;
  return d;
}

async function ask(question) {
  if (!settings.apiKey) { $('#settings').hidden = false; addMsg('Add your Anthropic API key in settings first.', 'bot'); return; }
  addMsg(question, 'user');
  let context;
  if (question.startsWith('ALLTABS:')) {
    question = question.slice(8).trim();
    const pages = await Promise.all(tabs.map((t) => readPage(t.view)));
    context = pages.map((p, i) => `TAB ${i + 1}\nURL: ${p.url}\nTitle: ${p.title}\n${p.text.slice(0, 5000)}`).join('\n\n---\n\n');
  } else {
    context = pageContext(await readPage());
  }
  const system = COMPANIONS[$('#companion').value] + (settings.agentMode ? AGENT_RULES : '');
  history.push({ role: 'user', content: `${context}\n\nUSER REQUEST: ${question}` });
  const thinking = addMsg('Thinking…', 'bot');

  try {
    for (let step = 0; step < 10; step++) {
      const reply = await window.nova.ask({ apiKey: settings.apiKey, model: settings.model, system, messages: trimmed() });
      history.push({ role: 'assistant', content: reply });
      const act = settings.agentMode && parseAction(reply);
      if (!act) { thinking.textContent = reply; return; }
      addMsg(`⚡ ${act.action} ${act.selector || act.url || ''} — ${act.why || ''}`, 'action');
      const result = await perform(act);
      history.push({ role: 'user', content: `Action result: ${result}\n\n${pageContext(await readPage())}` });
    }
    thinking.textContent = 'Stopped after 10 steps. Tell me to continue if needed.';
  } catch (e) {
    thinking.textContent = '⚠ ' + e.message;
  }
}

// keep only the latest page snapshots so requests stay small
function trimmed() {
  return history.slice(-12).map((m, i, a) =>
    m.role === 'user' && i < a.length - 3 ? { ...m, content: m.content.replace(/CONTENT:[\s\S]*/, '(older page content omitted)') } : m);
}

// ---------- Wiring ----------
$('#newTab').onclick = () => newTab();
$('#back').onclick = () => active.view.canGoBack() && active.view.goBack();
$('#fwd').onclick = () => active.view.canGoForward() && active.view.goForward();
$('#reload').onclick = () => active.view.reload();
$('#toggleAI').onclick = () => $('#ai').classList.toggle('closed');
$('#url').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const v = e.target.value;
  if (v.startsWith('/')) { $('#ai').classList.remove('closed'); ask(v.slice(1)); }
  else active.view.loadURL(toURL(v));
});
$('#askForm').onsubmit = (e) => { e.preventDefault(); const q = $('#ask').value.trim(); if (q) { $('#ask').value = ''; ask(q); } };
$('#ask').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#askForm').requestSubmit(); } });
document.querySelectorAll('#quick button').forEach((b) => (b.onclick = () => ask(b.dataset.q)));
$('#settingsBtn').onclick = () => ($('#settings').hidden = !$('#settings').hidden);
$('#apiKey').value = settings.apiKey;
$('#model').value = settings.model;
$('#agentMode').checked = settings.agentMode;
$('#saveSettings').onclick = () => {
  Object.assign(settings, { apiKey: $('#apiKey').value.trim(), model: $('#model').value.trim(), agentMode: $('#agentMode').checked });
  localStorage.setItem('nova-settings', JSON.stringify(settings));
  $('#settings').hidden = true;
};
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === 't') { e.preventDefault(); newTab(); }
  if (e.key === 'w') { e.preventDefault(); closeTab(active); }
  if (e.key === 'l') { e.preventDefault(); $('#url').select(); }
  if (e.key === 'j') { e.preventDefault(); $('#ai').classList.toggle('closed'); }
});

window.nova.onOpenTab((url) => newTab(url));
newTab();
