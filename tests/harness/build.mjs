// Copies the repository into a runnable app directory and injects the test hook.
//   node build.mjs                  -> /tmp/2dws_app          (working tree)
//   REF=HEAD~1 node build.mjs       -> /tmp/2dws_before       (a given git ref)
//   REPO=/path/to/repo node build.mjs (defaults to the current directory)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = import.meta.dirname;
const REPO = process.env.REPO || process.cwd();
const OUT = process.env.REF ? (process.env.OUT_DIR || '/tmp/2dws_before') : (process.env.OUT_DIR || '/tmp/2dws_app');
const MARKER = '} // end of mainscript';

fs.rmSync(OUT, { recursive : true, force : true });
fs.mkdirSync(OUT, { recursive : true });

if (process.env.REF) {
  const tar = OUT + '.tar';
  execFileSync('git', [ '-C', REPO, 'archive', '--format=tar', '-o', tar, process.env.REF ]);
  execFileSync('tar', [ 'xf', tar, '-C', OUT ]);
  fs.rmSync(tar);
} else {
  execFileSync('bash', [ '-c', `cd ${REPO} && git ls-files -z | xargs -0 tar cf - | tar xf - -C ${OUT}` ]);
}

const hook = fs.readFileSync(path.join(HERE, 'hook.js.txt'), 'utf8');
const appPath = path.join(OUT, 'app.js');
let src = fs.readFileSync(appPath, 'utf8');
if (src.includes('window.__sim = {')) throw new Error('hook already injected');
const at = src.lastIndexOf(MARKER);
if (at < 0) throw new Error('injection marker not found in ' + appPath);
src = src.slice(0, at) + hook + '\n' + src.slice(at);
fs.writeFileSync(appPath, src);
console.log(`built ${OUT} (${process.env.REF || 'working tree'})`);
