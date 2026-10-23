/* The browser the board's test suites drive, shared by every kanban/test_*.mjs.
 *
 * CHROME_BIN wins when set. Otherwise the first installed of Google Chrome,
 * Brave Browser and Chromium is used, from where each platform puts them.
 * Each suite spawns it headless with --remote-debugging-port, so any
 * Chromium-based browser works.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const WINDOWS_ROOTS = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  .filter(Boolean)

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: WINDOWS_ROOTS.flatMap(root => [
    join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    join(root, 'Chromium', 'Application', 'chrome.exe'),
  ]),
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/brave-browser',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
}[process.platform] || []

export const CHROME_BIN = (() => {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  const found = CANDIDATES.find(p => existsSync(p))
  if (found) return found
  throw new Error(
    'No Chromium-based browser found. Install Google Chrome, Brave Browser or Chromium, ' +
    'or set CHROME_BIN to the browser binary.'
  )
})()
