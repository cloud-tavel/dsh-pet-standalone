#!/usr/bin/env node
/**
 * start-app.mjs —— 开发期直接跑「单进程桌宠应用」（不打包）。
 *
 * 与打包产物的差别只有 Electron 从哪来：这里用本机已解压的 Electron 拉起 `lib/app.js`，
 * 打包产物则把这些文件塞进自己的 exe。环境变量与打包版一致，方便对照排查。
 *
 * 用法：
 *   node scripts/start-app.mjs           # 用 $DSH_HOME/electron
 *   DSH_PET_ELECTRON_PATH=... node scripts/start-app.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const ELECTRON_REL =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const electron = [process.env.DSH_PET_ELECTRON_PATH, join(dshHome, 'electron', ELECTRON_REL)].find(
  (value) => value && existsSync(value),
);
if (!electron) {
  console.error('[start-app] 找不到 Electron：先跑 `npm run ensure:electron` 或设置 DSH_PET_ELECTRON_PATH。');
  process.exit(1);
}

const env = { ...process.env };
// 宿主里可能带着它：会让 Electron 以纯 Node 模式启动，main 里 require('electron') 直接失败
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [join(root, 'lib', 'app.js')], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
