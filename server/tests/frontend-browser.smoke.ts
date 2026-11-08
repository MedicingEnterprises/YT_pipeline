import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from '../../node_modules/vite/dist/node/index.js'
import { databaseFixture } from './database.fixture.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config/env.js'

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until<T>(work: () => Promise<T>, label: string): Promise<T> {
  const end = Date.now() + 30000
  while (Date.now() < end) { try { const value = await work(); if (value) return value } catch {} await pause(100) }
  throw Error('Timed out: ' + label)
}
const browserPath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
if (!existsSync(browserPath)) throw Error('Set CHROME_PATH to an installed Chrome or Edge executable for this optional smoke check.')
const fixture = await databaseFixture()
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/unused', SESSION_SECRET: randomBytes(32).toString('base64url'), LOG_LEVEL: 'error' })
const app = buildApp(config, { database: fixture.database })
const backend = await app.listen({ host: '127.0.0.1', port: 0 })
const vite = await createServer({ root: resolve('..'), clearScreen: false, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(backend) }, server: { host: '127.0.0.1', port: 0 } })
await vite.listen()
const frontend = vite.resolvedUrls!.local[0]!
config.allowedOrigins.push(new URL(frontend).origin) // Assigned test origin only.
const profile = await mkdtemp(join(tmpdir(), 'content-hub-3e-browser-'))
const chrome = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let socket: WebSocket | null = null
let counter = 0
const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const exceptions: string[] = []
const cdp = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => { const id = ++counter; waiting.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression: string) => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value }
const fill = (selector: string, value: string) => evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()')
const button = (text: string) => evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===' + JSON.stringify(text) + ');if(!b)throw Error("Button missing");b.click();return true})()')
try {
  const port = await until(async () => Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]), 'Chrome debug port')
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(frontend), { method: 'PUT' })).json() as { webSocketDebuggerUrl: string }
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = () => reject(Error('Chrome connection failed')) })
  socket.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const entry = waiting.get(message.id); waiting.delete(message.id); if (message.error) entry?.reject(Error(message.error.message)); else entry?.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text) }
  await cdp('Runtime.enable'); await cdp('Page.enable')
  await until(() => evaluate('document.querySelector("input[name=email]")!==null'), 'Sign-in form')
  await button('Create an account')
  await fill('input[name=displayName]', 'Browser integration')
  await fill('input[name=email]', 'browser-integration@example.invalid')
  await fill('input[name=password]', 'Disposable browser password 123!')
  await evaluate('document.querySelector("button[type=submit]").click();document.querySelector("button[type=submit]").click()')
  await until(() => evaluate('!!document.querySelector(\'a[href="/channels"]\')'), 'Authenticated application')
  assert.equal(await fixture.database.user.count(), 1, 'Double registration must not duplicate the account')
  await evaluate('document.querySelector(\'a[href="/channels"]\').click()')
  await until(() => evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Create channel")'), 'Channels page')
  await button('Create channel')
  await until(() => evaluate('!!document.querySelector("[role=dialog] input")'), 'Channel editor')
  await evaluate('(()=>{for(const [label,value] of [["Channel name","Browser channel"],["Handle","@browserchannel"]]){const input=[...document.querySelectorAll("[role=dialog] label")].find(e=>e.textContent.startsWith(label)).querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}))}})()')
  await button('Save changes')
  await until(() => evaluate('!document.querySelector("[role=dialog]")&&document.body.textContent.includes("Browser channel")'), 'Saved server channel')
  assert.equal(await fixture.database.channel.count(), 1)
  await cdp('Page.reload')
  await until(() => evaluate('document.body.textContent.includes("Browser channel")&&!!document.querySelector(\'[aria-label="Sign out"]\')'), 'Refresh restores session/workspace')
  await evaluate('document.querySelector(\'[aria-label="Sign out"]\').click()')
  await until(() => evaluate('!!document.querySelector("input[name=password]")'), 'Logout sign-in screen')
  assert.equal(await fixture.database.session.count(), 0)
  assert.deepEqual(exceptions, [])
  console.log('Browser smoke passed: registration, duplicate-submit guard, channel creation, refresh restoration and logout. No uncaught page exceptions.')
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await cdp('Browser.close') } catch {} socket.close() }
  chrome.kill()
  await vite.close(); await app.close(); await fixture.close()
}
