/* Loads the DOM-free game scripts into this Node process, the same way the
   browser does: classic scripts sharing one global AIT namespace. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

if (!globalThis.AIT || !globalThis.AIT.Sim) {
  for (const f of ['data.js', 'flavor.js', 'events.js', 'sim.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
  }
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8'), { filename: 'report.js' });
}

module.exports = globalThis.AIT;
