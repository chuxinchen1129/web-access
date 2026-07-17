#!/usr/bin/env node
// launch-chrome - 启动并管理独立 Chrome 实例（持久 profile）
//
// 仅在 ISOLATED 模式下使用。和用户日常 Chrome 完全隔离：
//   - 独立 user-data-dir（默认 ~/.web-access-chrome/）
//   - 固定调试端口 9224（避开 9222 这个 Chrome 默认 CDP 端口）
//   - 独立进程，detached 常驻，proxy 退出不杀
//
// 用法：
//   node launch-chrome.mjs ensure   # 检查 + 必要时启动（默认）
//   node launch-chrome.mjs status   # 打印运行状态
//   node launch-chrome.mjs stop     # 杀掉独立 Chrome 进程

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.WEB_ACCESS_CHROME_PORT || 9224);
const PROFILE_DIR = process.env.WEB_ACCESS_CHROME_PROFILE
  || path.join(os.homedir(), '.web-access-chrome');

// --- Chrome 可执行文件发现 ---

function findChromeExecutable() {
  const platform = os.platform();
  const candidates = [];

  // 环境变量优先（用户自定义路径）
  if (process.env.WEB_ACCESS_CHROME_PATH && fs.existsSync(process.env.WEB_ACCESS_CHROME_PATH)) {
    return process.env.WEB_ACCESS_CHROME_PATH;
  }

  if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else if (platform === 'linux') {
    candidates.push('google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium');
  } else if (platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(`${pf}\\Google\\Chrome\\Application\\chrome.exe`);
    candidates.push(`${pf86}\\Google\\Chrome\\Application\\chrome.exe`);
    candidates.push(`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`);
  }

  for (const c of candidates) {
    if (c.includes(path.sep) || platform === 'win32') {
      // 绝对路径：直接检查
      if (fs.existsSync(c)) return c;
    } else {
      // 命令名：用 which/where 找
      const cmd = os.platform() === 'win32' ? 'where' : 'which';
      const r = spawnSync(cmd, [c], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
    }
  }
  return null;
}

// --- 端口探测 ---

function checkPort(port, host = '127.0.0.1', timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// --- 启动 Chrome ---

function startChrome(execPath) {
  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=ChromeWhatsNewUI',
    // 减少首次启动干扰
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
  ];

  const child = spawn(execPath, args, {
    detached: true,
    stdio: 'ignore',
    ...(os.platform() === 'win32' ? { windowsHide: false } : {}),
  });
  child.unref();
  return child.pid;
}

// --- 等待端口就绪 ---

async function waitPortReady(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkPort(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// --- 子命令 ---

async function ensure() {
  if (await checkPort(PORT)) {
    console.log(`chrome: ok (port ${PORT}, profile ${PROFILE_DIR})`);
    return 0;
  }

  const execPath = findChromeExecutable();
  if (!execPath) {
    console.error('chrome: 未找到 Chrome 可执行文件');
    console.error('  支持：Google Chrome / Chromium / Chrome Canary');
    console.error('  macOS 默认路径：/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    console.error('  或设置环境变量 WEB_ACCESS_CHROME_PATH 指向自定义路径');
    return 1;
  }

  console.log(`chrome: launching (port ${PORT}, profile ${PROFILE_DIR})`);
  const pid = startChrome(execPath);
  console.log(`chrome: spawned pid ${pid}, waiting for port...`);

  const ready = await waitPortReady(PORT);
  if (!ready) {
    console.error('chrome: 启动超时（15s 内端口未就绪）');
    console.error('  可能原因：Chrome 已在运行（且未用同一 user-data-dir）、profile 损坏、权限问题');
    return 1;
  }
  console.log(`chrome: ok (port ${PORT}, profile ${PROFILE_DIR})`);
  return 0;
}

async function status() {
  const portAlive = await checkPort(PORT);
  const profileExists = fs.existsSync(PROFILE_DIR);
  console.log(`port ${PORT}: ${portAlive ? 'listening' : 'free'}`);
  console.log(`profile: ${PROFILE_DIR} (${profileExists ? 'exists' : 'not created'})`);
  if (portAlive) {
    console.log('状态：独立 Chrome 运行中');
  } else {
    console.log('状态：未运行，运行 `node launch-chrome.mjs ensure` 启动');
  }
  return 0;
}

async function stop() {
  if (!await checkPort(PORT)) {
    console.log('chrome: 未运行');
    return 0;
  }

  // 用 --remote-debugging-port=PORT 作为特征匹配整个 Chrome 进程树
  // 这是独立 Chrome 启动时独有的参数，不会误杀用户日常 Chrome
  if (os.platform() === 'win32') {
    spawnSync('powershell', ['-Command',
      `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%remote-debugging-port=${PORT}%'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]);
  } else {
    spawnSync('pkill', ['-f', `remote-debugging-port=${PORT}`]);
    await new Promise((r) => setTimeout(r, 1500));
    if (await checkPort(PORT)) {
      spawnSync('pkill', ['-9', '-f', `remote-debugging-port=${PORT}`]);
    }
  }

  // 等端口释放
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!await checkPort(PORT)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`chrome: stopped (port ${PORT} released)`);
  return 0;
}

// --- main ---

const cmd = process.argv[2] || 'ensure';
let exitCode = 0;
switch (cmd) {
  case 'ensure':  exitCode = await ensure(); break;
  case 'status':  exitCode = await status(); break;
  case 'stop':    exitCode = await stop(); break;
  default:
    console.error(`未知命令: ${cmd}`);
    console.error('用法: node launch-chrome.mjs [ensure|status|stop]');
    exitCode = 1;
}
process.exit(exitCode);
