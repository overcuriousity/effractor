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

const fs = require('node:fs');
const fixture = name => fs.readFileSync('scripts/fixtures/nmap/' + name, 'utf8');

test('a real Standard scan reads its hosts, open ports and services; hints are not hosts', () => {
  const text = fixture('standard-localhost.xml');
  const { scan } = N.read(text);
  assert.equal(scan.hosts.length, 1, 'the <hosthint> is not a second host');
  const h = scan.hosts[0];
  assert.deepEqual(h.addresses, ['127.0.0.1']);
  assert.equal(h.hostname, 'localhost');
  assert.equal(h.os, null);
  const open = [...text.matchAll(/<port protocol="(\w+)" portid="(\d+)"><state state="open"/g)].map(m => m[1] + '/' + m[2]);
  assert.deepEqual(h.ports.filter(p => p.state === 'open').map(p => p.protocol + '/' + p.port), open);
  assert.ok(h.ports.every(p => p.service === null || typeof p.service.name === 'string'));
  assert.match(scan.args, /^nmap -sT -sV --top-ports 100 -oX - 127\.0\.0\.1$/, 'entities in attributes are decoded');
});

test('a discover scan has hosts without ports', () => {
  const { scan } = N.read(fixture('discover-localhost.xml'));
  assert.equal(scan.hosts.length, 1);
  assert.deepEqual(scan.hosts[0].ports, []);
});

test('a deep scan: MAC left out, TCP and UDP, products, OS guess, silent UDP counted, down hosts dropped', () => {
  const { scan } = N.read(fixture('deep-lab.xml'));
  assert.deepEqual(scan.hosts.map(h => h.addresses), [['10.0.1.5'], ['10.0.1.7']]);
  const [srv, other] = scan.hosts;
  assert.equal(srv.hostname, 'srv-01.lab');
  assert.equal(other.hostname, null);
  assert.deepEqual(srv.os, { name: 'Linux 5.0 - 5.4', accuracy: 96 });
  assert.deepEqual(srv.ports.map(p => [p.protocol, p.port, p.state]), [
    ['tcp', 22, 'open'], ['tcp', 8443, 'open'], ['udp', 53, 'open'], ['udp', 123, 'open|filtered'], ['udp', 161, 'open|filtered'],
  ]);
  assert.deepEqual(srv.ports[0].service, { name: 'ssh', product: 'OpenSSH', version: '9.6p1' });
  assert.equal(srv.ports[1].service, null);
  assert.deepEqual(srv.ports[2].service, { name: 'domain', product: 'dnsmasq', version: '2.90' });
  assert.equal(scan.silentUdp, 2);
});

test('what is not a usable result says why', () => {
  const code = t => N.read(t).problem && N.read(t).problem.code;
  assert.equal(code(''), 'empty');
  assert.equal(code('   \n '), 'empty');
  assert.equal(code('hello'), 'not-xml');
  assert.equal(code(fixture('normal.txt')), 'normal-output');
  assert.equal(code('<?xml version="1.0"?><html><body/></html>'), 'not-nmap');
  assert.equal(code(fixture('truncated.xml')), 'truncated');
  assert.equal(code('<nmaprun><host>'), 'truncated');
  assert.equal(code('<nmaprun></host></nmaprun>'), 'not-xml');
  assert.equal(code(fixture('down.xml')), 'no-host-up');
  const error = N.read(fixture('error.xml')).problem;
  assert.equal(error.code, 'nmap-error');
  assert.match(error.message, /requires root privileges/);
  for (const t of ['', 'x', fixture('normal.txt'), '<a/>', '<nmaprun>', fixture('down.xml')]) {
    assert.ok(N.read(t).problem.message.length > 10, 'every problem is said in words');
  }
});

test('names from the network are kept verbatim, decoded, never interpreted', () => {
  const { scan } = N.read(fixture('hostile.xml'));
  assert.equal(scan.hosts[0].hostname, '<img src=x onerror=alert(1)>&ünï');
  assert.equal(scan.hosts[0].ports[0].service.product, 'x">y');
});

test('a byte-order mark and CRLF line ends read the same', () => {
  const text = fixture('deep-lab.xml');
  assert.deepEqual(N.read('﻿' + text.replace(/\n/g, '\r\n')), N.read(text));
});
