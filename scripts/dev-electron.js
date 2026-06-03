// Dev launcher for Electron.
//
// Some host environments (notably running from inside another Electron app's
// integrated terminal) export ELECTRON_RUN_AS_NODE=1. That flag makes the
// electron binary behave like plain Node, so require('electron') returns a
// path string instead of the API and the GUI never launches. Electron reads
// the flag natively via getenv() before main.js runs, and getenv treats an
// empty string as "set" — so the variable must be deleted, not blanked.
//
// In a normal terminal the var is absent and the delete is a harmless no-op.
const { spawn } = require('node:child_process')
const electronPath = require('electron')

const env = { ...process.env, NODE_ENV: 'development' }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env })
child.on('close', (code) => process.exit(code ?? 0))
