const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../assets/js/scan-targets.js');

function drawing() {
  return { profile: 'architecture', entities: {
    lan: { kind: 'network', label: 'Office LAN', addresses: ['10.0.1.0/24'] },
    pc7: { kind: 'host', label: 'pc-7', addresses: ['10.0.1.7'] },
    pc9: { kind: 'host', label: 'pc-9', addresses: ['10.0.1.9', 'fd00::9'] },
    wiki: { kind: 'host', label: 'wiki.lab', names: ['docs.lab'] },
    db1: { kind: 'host', label: 'db1', addresses: ['10.0.2.9'] },
    bare: { kind: 'host', label: '' },
    sshd: { kind: 'service', label: 'ssh' },
  }, associations: {}, flows: {} };
}

test('the drawn hosts the words hold, by an address or by a name, in file order', () => {
  const d = drawing();
  assert.deepEqual(T.asked(d, '10.0.1.0/24'), ['pc7', 'pc9']);
  assert.deepEqual(T.asked(d, '10.0.2.9 10.0.1.7'), ['pc7', 'db1']);
  assert.deepEqual(T.asked(d, '10.0.1.5-9'), ['pc7', 'pc9'], 'nmap\'s ranges');
  assert.deepEqual(T.asked(d, 'fd00::/120'), ['pc9']);
  assert.deepEqual(T.asked(d, 'WIKI.lab'), ['wiki'], 'by its label, whatever the case');
  assert.deepEqual(T.asked(d, 'docs.lab,10.0.2.9'), ['wiki', 'db1'], 'by a name it keeps; commas separate too');
  assert.deepEqual(T.asked(d, '10.0.3.0/24'), []);
  assert.deepEqual(T.asked(d, ''), []);
  assert.deepEqual(T.asked(d, null), []);
  assert.deepEqual(T.asked(null, '10.0.1.0/24'), []);
  assert.deepEqual(T.asked({}, '10.0.1.0/24'), []);
});

test('a word with a port or in a URL names its host', () => {
  const d = drawing();
  assert.deepEqual(T.asked(d, '10.0.1.7:8443'), ['pc7']);
  assert.deepEqual(T.asked(d, 'https://wiki.lab:8443/a/?b=1'), ['wiki']);
  assert.deepEqual(T.asked(d, 'http://[fd00::9]:8080'), ['pc9']);
  assert.deepEqual(T.asked(d, '[fd00::9]:443'), ['pc9']);
  assert.equal(T.hostOf('fd00::9'), 'fd00::9', 'an IPv6 address is no host with a port');
});
