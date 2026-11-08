// Dependency-free browser acceptance checks using installed Chrome/Edge + CDP.
// Run after npm run build. Uses an isolated temporary browser profile only.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { preview } from 'vite'

const chromePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(value => value && existsSync(value))
if (!chromePath) { console.log('SKIP: installed Chrome/Edge not found; set CHROME_PATH to run browser acceptance'); process.exit(0) }
const artifacts = await mkdtemp(path.join(tmpdir(), 'content-hub-acceptance-'))
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } })
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${path.join(artifacts, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
let endpoint = ''
let browserLog = ''
let launchError
browser.on('error', error => { launchError = error })
browser.stderr.on('data', chunk => { browserLog += String(chunk); endpoint ||= String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1] ?? '' })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(work, label, timeout = 10000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try { const result = await work(); if (result) return result } catch (error) { lastError = error }
    await sleep(40)
  }
  throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ''}`)
}
async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const requests = new Map()
  const listeners = new Map()
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const request = requests.get(message.id)
      if (!request) return
      requests.delete(message.id); clearTimeout(request.timer)
      if (message.error) request.reject(new Error(JSON.stringify(message.error)))
      else request.resolve(message.result)
    } else for (const listener of listeners.get(message.method) ?? []) listener(message.params)
  })
  return {
    send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; const timer = setTimeout(() => { requests.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 10000); requests.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })) }) },
    on(method, listener) { listeners.set(method, [...listeners.get(method) ?? [], listener]) },
    close() { for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error('CDP closed')) } requests.clear(); ws.close() },
  }
}
let page
const errors = []
const externalRequests = []
const results = []
function pass(name) { results.push(name); console.log(`PASS: ${name}`) }
try {
  await until(() => { if (launchError) throw launchError; return endpoint }, 'headless browser launch')
  const browserPort = new URL(endpoint).port
  const target = await (await fetch(`http://127.0.0.1:${browserPort}/json/new?about:blank`, { method: 'PUT' })).json()
  page = await connect(target.webSocketDebuggerUrl)
  page.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text))
  page.on('Runtime.consoleAPICalled', event => { if (event.type === 'error') errors.push(event.args.map(arg => arg.description ?? arg.value ?? '').join(' ')) })
  page.on('Network.requestWillBeSent', event => { if (/^https?:/.test(event.request.url) && !event.request.url.startsWith(base + '/')) externalRequests.push(event.request.url) })
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable')
  const browserVersion = (await page.send('Browser.getVersion')).product
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Pacific/Auckland' })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const NativeDate = Date; window.__acceptanceNow = Number(sessionStorage.getItem('acceptance-clock')) || NativeDate.parse('2030-01-01T10:00:00Z'); class TestDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [window.__acceptanceNow])); } static now() { return window.__acceptanceNow; } } window.Date = TestDate; })()` })
  const evaluate = async expression => { const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value }
  const state = () => evaluate(`JSON.parse(localStorage.getItem('content-hub.workspace'))?.workspace`)
  const text = () => evaluate('document.body.innerText')
  const navigate = async route => { await page.send('Page.navigate', { url: base + route }); await until(() => evaluate(`Boolean(document.querySelector('h1'))`), `load ${route}`) }
  const click = async (label, scope = 'document') => {
    const result = await evaluate(`(() => { const root = ${scope}; const el = [...root.querySelectorAll('button,a,summary')].find(node => node.getClientRects().length && !node.disabled && !node.closest('[inert]') && (node.textContent.trim() === ${JSON.stringify(label)} || node.getAttribute('aria-label') === ${JSON.stringify(label)})); if (!el) return null; el.scrollIntoView({block:'center'}); const box=el.getBoundingClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2}; })()`)
    assert.ok(result, `Clickable control: ${label}`)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...result })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...result })
    await sleep(50)
  }
  const fill = async (label, value, scope = 'document') => {
    const result = await evaluate(`(() => { const root = ${scope}; const el = [...root.querySelectorAll('input,textarea,select')].find(node => node.getClientRects().length && (node.getAttribute('aria-label') === ${JSON.stringify(label)} || [...node.labels ?? []].some(item => item.textContent.trim().startsWith(${JSON.stringify(label)})))); if (!el) return false; el.focus(); const prototype = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`)
    assert.equal(result, true, `Editable field: ${label}`)
    await sleep(40)
  }
  const waitText = value => until(async () => (await text()).includes(value), `text ${value}`)
  const snapshot = async name => { const image = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(image.data, 'base64')) }
  const keyboard = async key => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 9 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key }); await sleep(40) }
  const advance = async ms => { await evaluate(`window.__acceptanceNow += ${ms}; sessionStorage.setItem('acceptance-clock',String(window.__acceptanceNow))`); await sleep(100) }
  const readInput = label => evaluate(`(() => { const el = [...document.querySelectorAll('input')].find(node => [...node.labels ?? []].some(item => item.textContent.trim().startsWith(${JSON.stringify(label)}))); return el?.value })()`)
  const listenerCounts = () => evaluate(`({window:getEventListeners(window).keydown?.length ?? 0,document:getEventListeners(document).keydown?.length ?? 0})`)

  await navigate('/')
  await until(async () => Boolean((await state())?.channels), 'first-run persisted workspace')
  pass('production app loads and initializes persistence')
  for (const width of [1440, 768, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    for (const route of ['/', '/channels', '/providers', '/pipelines', '/content', '/scheduler', '/analytics', '/settings']) {
      await navigate(route)
      const layout = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector('h1')?.textContent})`)
      assert.ok(layout.scroll <= width + 2, `${route} at ${width}px overflows to ${layout.scroll}px`)
      assert.ok(layout.heading)
    }
    await snapshot(`settings-${width}`)
  }
  pass('all eight pages render without horizontal page overflow at desktop, tablet, and mobile widths')
  await click('Open navigation')
  assert.equal(await evaluate(`document.querySelector('#workspace-sidebar').contains(document.activeElement)`), true)
  await keyboard('Escape')
  assert.equal(await evaluate(`document.querySelector('#workspace-sidebar').inert`), true)
  await click('Open content search'); await waitText('Content')
  await until(() => evaluate(`document.activeElement?.getAttribute('aria-label') === 'Search content'`), 'mobile content search focus')
  await evaluate(`document.activeElement.blur()`)
  await click('Open content search')
  await until(() => evaluate(`document.activeElement?.getAttribute('aria-label') === 'Search content'`), 'repeated mobile search restores focus')
  pass('mobile navigation focus, Escape dismissal, inert closed navigation and accessible mobile search')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await navigate('/')
  const baselineListeners = await listenerCounts()
  for (let i = 0; i < 3; i++) { await click('Help'); await waitText('Mock workspace help'); await keyboard('Escape') }
  assert.deepEqual(await listenerCounts(), baselineListeners, 'Help dialogs must clean up their keyboard listeners')
  await click('Notifications'); await waitText('Activity history')
  pass('help, notification navigation and dialog listener cleanup')
  await navigate('/settings')
  await click('Reset workspace'); await waitText('Reset this workspace?')
  await click('Keep workspace'); assert.ok((await state()).channels.length > 0)
  await click('Reset workspace'); await click('Reset workspace permanently')
  await until(async () => (await state()).channels.length === 0, 'reset clears saved entities')
  await navigate('/channels'); await waitText('No channels yet')
  await click('Create channel')
  await fill('Channel name', 'Acceptance Channel'); await fill('Handle', '@acceptance')
  await click('Save changes'); await until(async () => (await state()).channels.length === 1, 'channel saved')
  await click('Mock connect')
  await until(async () => (await state()).channels[0].status === 'connected', 'mock connection saved')
  await fill('Channel filter', 'disconnected'); await waitText('No disconnected channels'); await fill('Channel filter', 'all')
  await click('Edit Acceptance Channel'); await fill('Publishing days', 'Monday, Monday'); await click('Save changes'); await waitText('List each publishing day only once')
  await fill('Publishing days', 'Monday, Friday'); await click('Save changes')
  await until(async () => (await state()).channels[0].scheduleDays === 'Monday, Friday', 'channel edit saved')
  pass('reset confirmation/cancellation, empty state, channel creation and mock connection')
  await navigate('/providers'); await click('Add Provider')
  await fill('Provider name', 'Acceptance Provider')
  await click('Test configuration'); await waitText('Mock test passed')
  await click('Save provider'); await until(async () => (await state()).providers.length === 1, 'provider saved')
  await fill('Filter provider category', 'Image generation'); await waitText('No providers in this category'); await fill('Filter provider category', 'all')
  await click('Test'); await until(async () => (await state()).providers[0].connected, 'provider mock connection test')
  await click('Disable Acceptance Provider'); await until(async () => !(await state()).providers[0].enabled, 'provider disabled')
  await click('Enable Acceptance Provider'); await until(async () => (await state()).providers[0].enabled, 'provider enabled')
  pass('mock provider configuration and configuration validation')
  await navigate('/pipelines'); await click('New pipeline')
  // The builder's existing field labels are used by the same helper as browser users.
  await fill('Pipeline name', 'Acceptance Pipeline')
  await fill('Assigned provider', (await state()).providers[0].id)
  await fill('Instructions', 'Acceptance mock step instructions')
  await click('Move Idea down'); await click('Move Idea up')
  await click('Add step'); await click('Remove Research step')
  await click('Save pipeline')
  await until(async () => (await state()).pipelines.length === 1, 'pipeline saved')
  assert.equal((await state()).pipelines[0].steps[0].config.providerId, (await state()).providers[0].id)
  pass('pipeline creation with configured enabled steps')
  await navigate('/content'); await click('Create content')
  await click('Save changes'); await waitText('Content title is required')
  await fill('Topic or idea', 'Acceptance Idea')
  const saved = await state()
  await fill('Channel', saved.channels[0].id); await fill('Pipeline', saved.pipelines[0].id)
  await click('Save changes'); await waitText('MOCK PIPELINE EXECUTION')
  const contentId = (await state()).content[0].id
  assert.ok((await evaluate('location.search')).includes(contentId))
  await fill('Step duration', '100')
  await click('Run mock pipeline')
  await until(async () => (await state()).jobs.some(job => job.execution?.status === 'PROCESSING'), 'pipeline begins')
  await click('Pause', `document.querySelector('[aria-label="Mock pipeline execution"]')`)
  await until(async () => (await state()).jobs.find(job => job.execution)?.execution.paused, 'pipeline paused')
  await advance(5000)
  await page.send('Page.reload')
  await waitText('Resume')
  assert.equal((await state()).jobs.find(job => job.execution).execution.paused, true)
  await click('Resume', `document.querySelector('[aria-label="Mock pipeline execution"]')`)
  await click('Simulate failure', `document.querySelector('[aria-label="Mock pipeline execution"]')`)
  await waitText('Retry failed step')
  await click('Retry failed step')
  for (let i = 0; i < 100; i++) {
    await advance(1000)
    if ((await state()).jobs.find(job => job.execution)?.execution.status === 'COMPLETED') break
  }
  assert.equal((await state()).content[0].status, 'Ready')
  await waitText('Schedule ready content')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 2`), 'Ready dialog fits mobile viewport')
  const focusInside = await evaluate(`(() => { const dialog = document.querySelector('.content-details-dialog'); const controls=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary')].filter(node=>node.getClientRects().length); controls.at(-1).focus(); return true })()`)
  assert.ok(focusInside); await keyboard('Tab')
  assert.equal(await evaluate(`document.querySelector('.content-details-dialog').contains(document.activeElement)`), true)
  await snapshot('ready-mobile')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  pass('content validation, direct Details handoff, execution, pause, refresh, resume, failure/retry and Ready completion')
  await click('Schedule ready content')
  const mode = await evaluate(`[...document.querySelectorAll('select')].find(node => [...node.options].some(option => option.value === 'publication'))?.value`)
  assert.equal(mode, 'publication')
  const planned = await evaluate(`(() => { const date = new Date(window.__acceptanceNow + 120000); const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date); const get=type=>parts.find(item=>item.type===type).value; return get('year')+'-'+get('month')+'-'+get('day')+'T'+get('hour')+':'+get('minute') })()`)
  await fill('Date and time', planned); await click('Save changes')
  await until(async () => (await state()).content[0].status === 'Scheduled', 'future schedule saved')
  await navigate('/scheduler')
  await waitText('SCHEDULED_PUBLICATION')
  assert.ok((await text()).includes('Asia/Colombo'))
  await click('Month'); await click('Week')
  await fill('Filter schedule by specific date', '2031-01-01'); await waitText('No scheduled videos'); await click('Clear filters')
  await advance(180000)
  await until(async () => { await advance(1000); return (await state()).content[0].status === 'Published' }, 'scheduled publication completes')
  const published = await state()
  assert.equal(published.jobs.filter(job => job.execution).length, 1)
  assert.ok(published.jobs.every(job => job.status === 'completed'))
  await navigate(`/content?content=${contentId}`); await waitText('Mock publication complete')
  await navigate('/channels'); await click('Channel details'); await waitText('Published')
  await keyboard('Escape')
  await navigate('/'); await waitText('Videos published')
  await snapshot('published-dashboard')
  pass('future publication-only scheduling, timezone-independent due detection, publication and synchronized page state')
  await navigate('/settings')
  await fill('Workspace name', 'Acceptance saved workspace'); await click('Save preferences')
  await until(async () => (await state()).preferences.workspaceName === 'Acceptance saved workspace', 'preferences persist')
  await page.send('Page.reload'); await waitText('Acceptance saved workspace')
  assert.equal(await readInput('Workspace name'), 'Acceptance saved workspace')
  await fill('Workspace name', 'Unsaved draft'); await click('Reset unsaved changes')
  assert.equal(await readInput('Workspace name'), 'Acceptance saved workspace')
  await fill('Color theme', 'dark'); await click('Save preferences')
  await until(() => evaluate(`document.documentElement.dataset.theme === 'dark'`), 'appearance preference applied')
  pass('settings save and restoration')
  await fill('Search content workspace', 'Acceptance Idea')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await waitText('Content'); await until(() => evaluate(`document.querySelector('[aria-label="Search content"]')?.value === 'Acceptance Idea'`), 'header search delegates to Content filter')
  await fill('Search content', 'no-matching-idea'); await waitText('No matching content'); await click('Clear filters')
  await fill('Filter by status', 'Idea'); await waitText('No matching content'); await click('Clear filters')
  await fill('Filter by status', 'Published'); assert.ok((await text()).includes('Acceptance Idea'))
  pass('header search, content search and status filters')
  await navigate('/content'); await click('Create content')
  await fill('Topic or idea', 'Cancellation check')
  await fill('Channel', (await state()).channels[0].id); await fill('Pipeline', (await state()).pipelines[0].id)
  await click('Save changes'); await waitText('MOCK PIPELINE EXECUTION')
  const cancelledId = (await state()).content.find(item => item.title === 'Cancellation check').id
  await click('Run mock pipeline')
  await until(async () => (await state()).jobs.some(job => job.contentId === cancelledId && job.status === 'running'), 'cancellable run begins')
  await click('Cancel execution', `document.querySelector('[aria-label="Mock pipeline execution"]')`)
  await until(async () => (await state()).jobs.find(job => job.contentId === cancelledId)?.status === 'cancelled', 'execution cancellation saved')
  await keyboard('Escape')
  const cancelRow = `[...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes('Cancellation check'))`
  await click('Delete', cancelRow); await click('Keep content')
  assert.ok((await state()).content.some(item => item.id === cancelledId))
  await click('Delete', cancelRow); await click('Delete content')
  await until(async () => !(await state()).content.some(item => item.id === cancelledId), 'confirmed delete removes content')
  assert.ok(!(await state()).jobs.some(job => job.contentId === cancelledId))
  pass('execution cancellation, delete confirmation/cancellation and dependent job cleanup')
  await navigate('/settings')
  const originalRaw = await evaluate(`localStorage.getItem('content-hub.workspace')`)
  await evaluate(`window.__originalSetItem=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw new DOMException('Storage full','QuotaExceededError')}`)
  await fill('Workspace name', 'Recovered workspace'); await click('Save preferences')
  await waitText('Workspace changes could not be saved')
  assert.equal((await state()).preferences.workspaceName, 'Acceptance saved workspace')
  await evaluate(`Storage.prototype.setItem=window.__originalSetItem`)
  await click('Retry saving')
  await until(async () => (await state()).preferences.workspaceName === 'Recovered workspace', 'quota failure recovered without losing in-memory draft')
  await evaluate(`localStorage.setItem('content-hub.workspace','{malformed')`)
  await page.send('Page.reload'); await waitText('saved workspace could not be restored')
  assert.equal(await evaluate(`localStorage.getItem('content-hub.workspace')`), '{malformed')
  await evaluate(`localStorage.setItem('content-hub.workspace',${JSON.stringify(originalRaw)})`)
  await page.send('Page.reload'); await waitText('Acceptance saved workspace')
  pass('quota failure warning/retry and preservation of malformed saved data')
  assert.deepEqual(externalRequests, [], 'No external application network/API requests')
  assert.deepEqual(errors, [], 'No page console errors or unhandled exceptions')
  pass('no browser console errors or unhandled page exceptions')
  console.log(JSON.stringify({ browser: chromePath, browserVersion, checks: results, artifacts }, null, 2))
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ browserVersion, checks: results, errors, externalRequests }, null, 2))
} catch (error) {
  console.error(error.stack)
  console.error(`Browser artifacts: ${artifacts}`)
  console.error(browserLog.slice(-3000))
  if (page) {
    try { const result = await page.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true }); console.error(String(result.result.value).slice(-6500)); const image = await page.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(artifacts, 'failure.png'), Buffer.from(image.data, 'base64')) } catch { /* Browser may have already exited. */ }
  }
  process.exitCode = 1
} finally {
  if (page) { try { await page.send('Browser.close') } catch { /* Browser shutdown closes CDP. */ } page.close() }
  if (browser.exitCode === null) browser.kill()
  server.httpServer.closeAllConnections()
  await new Promise(resolve => server.httpServer.close(resolve))
}
