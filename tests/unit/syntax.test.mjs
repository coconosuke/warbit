// 全部のソースが構文として読める（ブラウザだけが読み込むファイル＝main.js など も。単体テストはそれらを読まないので、ここで確かめる）。
// node --check は ES モジュールの構文の誤りを見逃すことがあるので、vm.SourceTextModule で1つずつ読む（実行はしない）
import { test, ok } from '../lib/t.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src');
test('構文: src の全部の .js が読める', () => {
  const code = `const vm=require('vm'),fs=require('fs'),path=require('path');const bad=[];let n=0;
const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.js')){n++;try{new vm.SourceTextModule(fs.readFileSync(p,'utf8'),{identifier:p});}catch(x){bad.push(path.relative(${JSON.stringify(ROOT)},p)+': '+x.message);}}}};
walk(${JSON.stringify(ROOT)});process.stdout.write(JSON.stringify({n,bad}));`;
  const r = JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', code], { encoding: 'utf8' }));
  ok(r.n > 50, `ファイル ${r.n}`);
  ok(!r.bad.length, r.bad.slice(0, 3).join(' | '));
});
