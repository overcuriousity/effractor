const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../assets/js/nmap.js');

test('four levels, Standard first offered, root only where the scan needs it', () => {
  assert.deepEqual(N.LEVELS.map(l => l.id), ['discover', 'standard', 'deep', 'complete']);
  assert.deepEqual(N.LEVELS.map(l => l.root), [false, false, true, true]);
  assert.equal(N.level('standard').name, 'Standard');
  assert.equal(N.level('nope'), null);
});

test('each level prints XML to the terminal for the range', () => {
  const r = '10.0.1.0/24';
  assert.equal(N.command('discover', r).text, 'nmap -sn -oX - 10.0.1.0/24');
  assert.equal(N.command('standard', r).text, 'nmap -sT -sV -oX - 10.0.1.0/24');
  assert.equal(N.command('deep', r).text, 'sudo nmap -sS -sU -sV -O --top-ports 1000 -oX - 10.0.1.0/24');
  assert.equal(N.command('complete', r).text, 'sudo nmap -sS -sU -sV -O -p T:1-65535,U:1-1024 -oX - 10.0.1.0/24');
  assert.equal(N.command('standard', '  10.0.1.0/24   fd00::/64 ').text, 'nmap -sT -sV -oX - 10.0.1.0/24 fd00::/64');
  assert.equal(N.command('standard', 'srv-01.lab,10.0.2.1-20').text, 'nmap -sT -sV -oX - srv-01.lab,10.0.2.1-20');
});

test('a range never carries shell syntax or an nmap option', () => {
  for (const bad of ['10.0.0.1; rm -rf ~', '$(id)', '10.0.0.1 | tee x', '`id`', "10.0.0.1'", '10.0.0.1 -iL /etc/shadow', '-oN x 10.0.0.1', '10.0.0.1\n-sC']) {
    const c = N.command('standard', bad);
    assert.equal(c.text, undefined, bad);
    assert.match(c.problem, /range/, bad);
  }
  assert.match(N.command('standard', '   ').problem, /range/);
  assert.equal(N.command('bogus', '10.0.0.1'), null);
});
