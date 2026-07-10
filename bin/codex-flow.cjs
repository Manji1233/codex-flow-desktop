#!/usr/bin/env node
const path = require('node:path');
const { spawn } = require('node:child_process');
const electronPath = require('electron');

const cliEntry = path.join(__dirname, '..', 'electron', 'cli-main.cjs');
const child = spawn(electronPath, [cliEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' }
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => {
  console.error('无法启动 Codex Flow CLI：' + error.message);
  process.exit(1);
});
