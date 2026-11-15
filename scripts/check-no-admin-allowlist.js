const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}
walk(path.join(root, 'routes'));
files.push(path.join(root, 'server.js'));

const offenders = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /(requireRole\([^)]*'admin'|pageAuthGuard\(\[[^\]]*'admin')/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    offenders.push(`${path.relative(root, file)}:${line}: ${m[0]}`);
  }
}

assert.deepStrictEqual(offenders, [], `Tidak boleh ada 'admin' di allow-list:\n${offenders.join('\n')}`);

const auth = fs.readFileSync(path.join(root, 'middleware', 'auth.js'), 'utf8');
assert.ok(auth.includes('effectiveRole'), 'requireRole/pageAuthGuard harus memakai effectiveRole');

console.log('OK: tidak ada allow-list admin dan guard memakai effectiveRole.');