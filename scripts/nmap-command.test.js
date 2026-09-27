const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/nmap-command.js');
const r = '10.0.1.0/24';
const IDENTITY = 'ssh-hostkey or ssl-cert or nbstat or smb-os-discovery';

test('seven recipes by purpose, in the order the dialog offers them', () => {
  assert.deepEqual(C.RECIPES.map(x => x.id), ['lan', 'names', 'services', 'identity', 'route', 'firewall', 'checks']);
  assert.ok(C.RECIPES.every(x => x.name && x.finds));
  assert.deepEqual(C.BLOCKS.map(b => b.id), ['discovery', 'ports', 'tcp', 'udp', 'depth', 'identity', 'route', 'reasons', 'checks', 'pace']);
  // Every block a recipe sets is a choice of that block.
  for (const x of C.RECIPES) for (const b of Object.keys(x.sets)) assert.ok(C.BLOCKS.filter(k => k.id === b)[0].choices.some(c => c.id === x.sets[b]), x.id + '.' + b);
});

test('each recipe alone prints the scan it names', () => {
  assert.equal(C.command(['services'], {}, r).text, 'nmap -sT -sV -oX - 10.0.1.0/24');
  assert.equal(C.command(['lan'], {}, r).text, 'sudo nmap -PR -sn -oX - 10.0.1.0/24');
  assert.equal(C.command(['names'], {}, r).text, 'nmap -sL -oX - 10.0.1.0/24');
  assert.equal(C.command(['route'], {}, r).text, 'sudo nmap -sn --traceroute -oX - 10.0.1.0/24');
  assert.equal(C.command(['identity'], {}, r).text, "sudo nmap -sS -sU --top-ports 100 --script '" + IDENTITY + "' -oX - 10.0.1.0/24");
  assert.equal(C.command(['checks'], {}, r).text, "nmap -sT -sV --script 'vuln and safe and not external' -oX - 10.0.1.0/24");
});

test('recipes combine block by block: the stronger choice wins, root if any needs it', () => {
  const c = C.command(['lan', 'services', 'route'], {}, r);
  assert.equal(c.text, 'sudo nmap -PR -sS -sV --traceroute -oX - 10.0.1.0/24', 'ports beat none; a root scan takes SYN');
  assert.equal(c.root, true);
  assert.equal(C.command(['lan', 'services', 'route'], { tcp: 'connect' }, r).text, 'sudo nmap -PR -sT -sV --traceroute -oX - 10.0.1.0/24', 'unless told not to');
  const both = C.command(['identity', 'checks'], {}, r);
  assert.equal(both.text, "sudo nmap -sS -sU --top-ports 1000 -sV --script '(" + IDENTITY + ") or (vuln and safe and not external)' -oX - 10.0.1.0/24");
  assert.match(both.note, /one count for TCP and UDP/);
  assert.equal(C.command(['services'], {}, r).root, false);
});

test('names only goes alone; nothing ticked is a problem, not a command', () => {
  assert.match(C.command(['names', 'services'], {}, r).problem, /names only/i);
  assert.match(C.command([], {}, r).problem, /what the scan is for/i);
  assert.match(C.command(['nope'], {}, r).problem, /what the scan is for/i);
  assert.equal(C.command(['names'], { route: 'on', checks: 'all' }, r).text, 'nmap -sL -oX - 10.0.1.0/24', 'it sends nothing, whatever is adjusted');
});

test('a port list takes numbers, ranges and T:/U: only; the identity ports join it', () => {
  assert.equal(C.command(['services'], { ports: 'list' }, r, { portList: '8000-8100, 80,22' }).text, 'nmap -sT -p 22,80,8000-8100 -sV -oX - 10.0.1.0/24');
  assert.equal(C.command(['services'], { ports: 'list' }, r, { portList: 'T:80,U:53,161' }).text, 'sudo nmap -sS -sU -p T:80,U:53,161 -sV -oX - 10.0.1.0/24'.replace('sudo nmap -sS', 'nmap -sT'), 'UDP ports alone do not make the TCP scan SYN');
  assert.equal(C.command(['services', 'identity'], { ports: 'list' }, r, { portList: '80' }).text,
    "sudo nmap -sS -sU -p T:22,80,443,445,U:137 -sV --script '" + IDENTITY + "' -oX - 10.0.1.0/24");
  assert.match(C.command(['services'], { ports: 'list' }, r, {}).problem, /ports to scan/);
  for (const bad of ['22;id', '-oN x', '80 443', '$(x)', 'T:22,U:0', '70000', '90-80', "22'", 'X:22']) {
    const c = C.command(['services'], { ports: 'list' }, r, { portList: bad });
    assert.equal(c.text, undefined, bad);
    assert.match(c.problem, /port list/, bad);
  }
});

test('the firewall recipe: reasons and the route, the ports drawn and the 100 most common; ACK a second command', () => {
  const c = C.command(['firewall'], {}, r, { drawnPorts: ['tcp/4443', 'tcp/3389', 'udp/53', 'bogus', 'tcp/0x50'], ack: true });
  assert.match(c.text, /^sudo nmap -sS -sU -p T:7,9,13,21-23,.*,3389,.*,4443,.*,49152-49157,U:53 --reason --traceroute -oX - 10\.0\.1\.0\/24$/);
  assert.match(c.second, /^sudo nmap -sA --reason -p 7,9,13,.*,4443,.*49152-49157 -oX - 10\.0\.1\.0\/24$/);
  assert.doesNotMatch(c.second, /U:/, 'TCP only');
  const none = C.command(['firewall'], {}, r, { drawnPorts: [] });
  assert.equal(none.text, 'sudo nmap -sS --reason --traceroute -oX - 10.0.1.0/24', 'nothing drawn: the 1000 most common');
  assert.equal(none.second, undefined);
  // Drawn ports are the firewall recipe's; another recipe does not take them.
  assert.match(C.command(['services'], { ports: 'list' }, r, { drawnPorts: ['tcp/443'] }).problem, /ports to scan/);
  const withServices = C.command(['firewall', 'services'], {}, r, { drawnPorts: ['tcp/443'] });
  assert.match(withServices.note, /takes the list/);
});

test('pace and discovery are the author\'s; the range rules stay', () => {
  assert.equal(C.command(['services'], { pace: 'polite', discovery: 'noping' }, r).text, 'nmap -Pn -sT -sV -T2 -oX - 10.0.1.0/24');
  assert.equal(C.command(['services'], { pace: 'fast' }, r).text, 'nmap -sT -sV -T4 -oX - 10.0.1.0/24');
  assert.equal(C.command(['services'], { pace: 'bogus', nope: 'x' }, r).text, 'nmap -sT -sV -oX - 10.0.1.0/24');
  assert.equal(C.command(['services'], {}, 'fd00::/120').text, 'nmap -6 -sT -sV -oX - fd00::/120');
  assert.match(C.command(['services'], {}, '10.0.0.1 fd00::1').problem, /separate/);
  assert.match(C.command(['services'], {}, 'fd00::/64').note, /too wide/);
  assert.match(C.command(['firewall'], {}, 'fd00::5', { ack: true }).second, /^sudo nmap -6 -sA /);
});

test('no command asks a third party or hides the scan', () => {
  const all = [];
  for (const x of C.RECIPES) for (const checks of ['none', 'safe', 'all']) all.push(C.command([x.id], { checks }, r, { drawnPorts: ['tcp/443'], ack: true }));
  all.push(C.command(C.RECIPES.filter(x => !x.alone).map(x => x.id), { checks: 'all' }, r, { drawnPorts: ['tcp/443'], ack: true }));
  for (const c of all) {
    for (const t of [c.text, c.second].filter(Boolean)) {
      assert.doesNotMatch(t, /vulners|whois|shodan|-D |-S |-f |--spoof|--data-length|--source-port|--proxies|--badsum| -g /, t);
      if (/vuln/.test(t)) assert.match(t, /not external/, t);
    }
  }
  const warn = C.BLOCKS.filter(b => b.id === 'checks')[0].choices.filter(c => c.id === 'all')[0];
  assert.match(warn.warning, /exploits/);
});

test('the recipes a command holds are read back from what nmap says it ran', () => {
  for (const ids of [['lan'], ['names'], ['services'], ['identity'], ['route'], ['lan', 'services', 'route'], ['services', 'identity', 'checks']]) {
    const args = C.command(ids, {}, r).text.replace(/^sudo /, '').replace(/'/g, '"');
    assert.deepEqual(C.recipesOf(args), ids, args);
  }
  assert.deepEqual(C.recipesOf(C.command(['firewall'], {}, r, { drawnPorts: [] }).text), ['firewall']);
  assert.deepEqual(C.recipesOf(''), []);
  assert.deepEqual(C.recipesOf('nmap -sn -oX - 10.0.1.0/24'), []);
});
