import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const text=fs.readFileSync(new URL('../api/dataset.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('dataset.ts',text,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='calculateTimeBounds');
class Clock extends Date { constructor(...args){super(...(args.length?args:['2026-11-10T18:30:00Z']));} }
const bounds=vm.runInNewContext(ts.transpile(fn.getText(ast),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None})+';calculateTimeBounds',{Date:Clock,Intl});
test('dashboard dataset rentang sama dengan statistik UTC, bukan rolling',()=>{
 for(const [range,expected] of [['today','2026-11-10'],['7d','2026-11-04'],['14d','2026-10-28'],['30d','2026-10-12']]) assert.equal(bounds(range,null,'UTC').startDateIso,expected+'T00:00:00.000Z');
 const explicit=bounds('today','2026-11-09','UTC');assert.equal(explicit.startDateIso,'2026-11-09T00:00:00.000Z');assert.equal(explicit.endDateIso,'2026-11-09T23:59:59.999Z');
 assert.equal(bounds('all',null,'UTC').startDateIso,null);
});
