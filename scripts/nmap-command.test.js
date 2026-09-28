const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/nmap-command.js');
const r = '10.0.1.0/24';
const IDENTITY = 'ssh-hostkey or ssl-cert or nbstat or smb-os-discovery';

test('seven recipes by purpose, in the order the dialog offers them', () => {
  assert.deepEqual(C.RECIPES.map(x => x.id), ['lan', 'names', 'services', 'identity', 'route', 'firewall', 'checks']);
  assert.ok(C.RECIPES.every(x => x.name && x.finds));
  assert.deepEqual(C.BLOCKS.map(b => b.id), ['discovery', 'names', 'exclude', 'interface', 'ports', 'tcp', 'udp', 'depth', 'effort', 'osguess', 'identity', 'route', 'reasons', 'checks', 'pace', 'rate', 'retries', 'patience', 'delay']);
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
  assert.equal(C.command(['services'], { ports: 'list' }, r, { portList: 'T:80,U:53,161' }).text, 'sudo nmap -sT -sU -p T:80,U:53,161 -sV -oX - 10.0.1.0/24', 'UDP ports need root, and alone do not make the TCP scan SYN');
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
  // Beside it, Identity keeps the UDP its NetBIOS lookup needs, list or none.
  assert.match(C.command(['firewall', 'identity'], {}, r, { drawnPorts: [] }).text, /^sudo nmap -sS -sU --top-ports 1000 --reason --traceroute --script /);
  assert.match(C.command(['firewall', 'identity'], {}, r, { drawnPorts: ['tcp/8443'] }).text, /,8443,.*,U:137 --reason /);
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

// What every typed text is, where a test needs them all.
const TYPED = { resolver: '10.0.1.1', exclude: '10.0.1.20', iface: 'eth0', rate: '100' };
const EXTRA = Object.assign({ drawnPorts: ['tcp/443'], ack: true, asDrawn: ['tcp/22', 'udp/53'], self: ['10.0.1.2'], portList: '22,80' }, TYPED);

test('no command asks a third party or hides the scan', () => {
  const all = [];
  for (const x of C.RECIPES) for (const checks of ['none', 'safe', 'all']) all.push(C.command([x.id], { checks }, r, EXTRA));
  all.push(C.command(C.RECIPES.filter(x => !x.alone).map(x => x.id), { checks: 'all' }, r, EXTRA));
  // Scan workflow spec §5.2: every recipe under every choice of every block.
  for (const x of C.RECIPES) for (const b of C.BLOCKS) for (const c of b.choices) all.push(C.command([x.id], { [b.id]: c.id }, r, EXTRA));
  assert.ok(all.filter(c => c.text).length > 400, String(all.filter(c => c.text).length));
  for (const c of all) {
    for (const t of [c.text, c.second].filter(Boolean)) {
      assert.doesNotMatch(t, /vulners|whois|shodan|-D |-S |-f |--spoof|--mtu|--data-length|--source-port|--proxies|--badsum| -g | -sI | -b | -T0| -T1|--randomize-hosts|--ttl|--ip-options/, t);
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

// ---- the library of options (scan workflow spec §5) ----

const one = (adjust, extra, recipes) => C.command(recipes || ['services'], adjust, r, extra || {});

test('the blocks stand in four groups, each choice with the argument the design names', () => {
  assert.deepEqual(C.GROUPS.map(g => g.id), ['hosts', 'ports', 'depth', 'pace']);
  assert.ok(C.BLOCKS.every(b => C.GROUPS.some(g => g.id === b.group)), 'every block is in a group');
  assert.deepEqual(Object.keys(C.DEFAULTS), C.BLOCKS.map(b => b.id));
  for (const b of C.BLOCKS) assert.ok(b.choices.some(c => c.id === C.DEFAULTS[b.id]), b.id);
  const args = (block, id) => C.BLOCKS.filter(b => b.id === block)[0].choices.filter(c => c.id === id)[0];
  const table = [
    ['discovery', 'arp', '-PR', true], ['discovery', 'tcp', '-PS22,80,443,445 -PA80,443', undefined], ['discovery', 'udp', '-PU53,161', true],
    ['discovery', 'icmp', '-PE -PP -PM', true], ['discovery', 'every', '-PE -PP -PM -PS22,80,443,445 -PA80,443 -PU53,161', true],
    ['discovery', 'noping', '-Pn', undefined], ['discovery', 'list', '-sL', undefined],
    ['names', 'never', '-n', undefined], ['names', 'every', '-R', undefined], ['names', 'system', '--system-dns', undefined],
    ['tcp', 'connect', '-sT', undefined], ['tcp', 'syn', '-sS', true], ['tcp', 'ack', '-sA', true], ['tcp', 'window', '-sW', true],
    ['tcp', 'fin', '-sF', true], ['tcp', 'null', '-sN', true], ['tcp', 'xmas', '-sX', true],
    ['effort', 'light', '--version-light', undefined], ['effort', 'all', '--version-all', undefined],
    ['osguess', 'limit', '--osscan-limit', undefined], ['osguess', 'guess', '--osscan-guess', undefined],
    ['pace', 'polite', '-T2', undefined], ['pace', 'fast', '-T4', undefined], ['pace', 'insane', '-T5', undefined],
    ['retries', 'one', '--max-retries 1', undefined], ['retries', 'none', '--max-retries 0', undefined],
    ['patience', 'quarter', '--host-timeout 15m', undefined], ['patience', 'hour', '--host-timeout 1h', undefined],
    ['delay', 'second', '--scan-delay 1s', undefined],
  ];
  for (const [block, id, arg, root] of table) {
    assert.equal(args(block, id).args, arg, block + '.' + id);
    assert.equal(args(block, id).root, root, block + '.' + id + ' root');
  }
  for (const id of ['ack', 'window', 'fin', 'null', 'xmas']) assert.match(args('tcp', id).hint, /what a filter passes, not what is open/, id);
  assert.match(args('pace', 'insane').warning, /Misses ports/);
  assert.match(args('retries', 'none').warning, /Misses ports/);
  assert.match(args('rate', 'least').warning, /overload/);
});

test('finding hosts: the probes, the names, what is left out, the interface', () => {
  assert.equal(one({ discovery: 'tcp' }).text, 'nmap -PS22,80,443,445 -PA80,443 -sT -sV -oX - 10.0.1.0/24');
  assert.equal(one({ discovery: 'every' }).text, 'sudo nmap -PE -PP -PM -PS22,80,443,445 -PA80,443 -PU53,161 -sS -sV -oX - 10.0.1.0/24', 'root, so SYN');
  assert.equal(one({ discovery: 'icmp', tcp: 'connect' }).text, 'sudo nmap -PE -PP -PM -sT -sV -oX - 10.0.1.0/24');
  assert.equal(one({ names: 'never' }).text, 'nmap -n -sT -sV -oX - 10.0.1.0/24');
  assert.equal(one({ names: 'own' }, { resolver: ' 10.0.1.1, fd00::53 ' }).text, 'nmap --dns-servers 10.0.1.1,fd00::53 -sT -sV -oX - 10.0.1.0/24');
  assert.equal(one({ exclude: 'typed' }, { exclude: '10.0.1.1 10.0.1.16/28,printer.lab' }).text, 'nmap --exclude 10.0.1.1,10.0.1.16/28,printer.lab -sT -sV -oX - 10.0.1.0/24');
  assert.equal(one({ exclude: 'self' }, { self: ['10.0.1.2', 'fd00::2', 'bogus'] }).text, 'nmap --exclude 10.0.1.2,fd00::2 -sT -sV -oX - 10.0.1.0/24');
  const nowhere = one({ exclude: 'self' }, {});
  assert.equal(nowhere.text, 'nmap -sT -sV -oX - 10.0.1.0/24');
  assert.match(nowhere.note, /nothing is left out/);
  assert.equal(one({ interface: 'named' }, { iface: 'enp3s0.100' }).text, 'nmap -e enp3s0.100 -sT -sV -oX - 10.0.1.0/24');
  // Names only asks DNS: how it asks, and whom it leaves out, still count.
  assert.equal(C.command(['names'], { names: 'own', exclude: 'typed', pace: 'fast', retries: 'one' }, r, { resolver: '10.0.1.1', exclude: '10.0.1.9' }).text, 'nmap -sL --dns-servers 10.0.1.1 --exclude 10.0.1.9 -oX - 10.0.1.0/24');
});

test('what is typed into the command is held to its shape, or refused', () => {
  const cases = {
    resolver: [{ names: 'own' }, ['', ' ', 'dns.lab', '10.0.1', '10.0.1.1;id', '10.0.1.1 -oN x', "10.0.1.1'", '$(id)', '10.0.1.300', '-n']],
    exclude: [{ exclude: 'typed' }, ['', '-iL /etc/passwd', '10.0.1.1;id', '`id`', "a'b", '10.0.1.1 | x', '$HOME', 'a\\b', '--exclude']],
    iface: [{ interface: 'named' }, ['', '-e', 'eth0 -oN x', 'eth0;id', 'a'.repeat(16), '.eth0', "e'0", 'eth 0', '$IF']],
    rate: [{ rate: 'most' }, ['', '0', '-5', '1.5', '1e3', '100001', '1000000', '10 0', '0x10', 'fast', '007']],
  };
  for (const key of Object.keys(cases)) {
    for (const bad of cases[key][1]) {
      const c = one(cases[key][0], { [key]: bad });
      assert.equal(c.text, undefined, key + ': ' + JSON.stringify(bad));
      assert.ok(c.problem && /^Give /.test(c.problem), key + ': ' + JSON.stringify(bad));
    }
    assert.equal(one(cases[key][0], {}).text, undefined, key + ' left out');
    assert.equal(one(cases[key][0], { [key]: null }).text, undefined, key + ' null');
  }
  assert.equal(one({ rate: 'most' }, { rate: 12 }).text, 'nmap -sT -sV --max-rate 12 -oX - 10.0.1.0/24', 'a number is read as its text');
  assert.equal(one({ rate: 'most' }, { rate: '100000' }).text, 'nmap -sT -sV --max-rate 100000 -oX - 10.0.1.0/24');
  const least = one({ rate: 'least' }, { rate: ' 1000 ' });
  assert.equal(least.text, 'nmap -sT -sV --min-rate 1000 -oX - 10.0.1.0/24');
  assert.match(least.warning, /overload/);
  // A text whose choice is not taken is not looked at.
  assert.equal(one({}, { resolver: ';id', exclude: '`x`', iface: '-', rate: 'x' }).text, 'nmap -sT -sV -oX - 10.0.1.0/24');
});

test('ports: twenty, as drawn; the counts of TCP and UDP are one', () => {
  assert.equal(one({ ports: 'top20' }).text, 'nmap -sT --top-ports 20 -sV -oX - 10.0.1.0/24');
  assert.equal(one({ ports: 'top100' }).text, 'nmap -sT --top-ports 100 -sV -oX - 10.0.1.0/24');
  assert.equal(one({ ports: 'top20', udp: 'top20' }).text, 'sudo nmap -sS -sU --top-ports 20 -sV -oX - 10.0.1.0/24');
  const wide = one({ ports: 'top100', udp: 'top20' });
  assert.equal(wide.text, 'sudo nmap -sS -sU --top-ports 100 -sV -oX - 10.0.1.0/24');
  assert.match(wide.note, /one count for TCP and UDP/);
  assert.equal(one({ ports: 'top20', udp: 'top100' }).note, undefined, 'UDP is the wider: TCP is fast');
  assert.equal(one({ ports: 'drawn' }, { asDrawn: ['tcp/443', 'tcp/22', 'tcp/23', 'tcp/22', 'bogus', 'tcp/0', 'tcp/70000', 'sctp/9'] }).text, 'nmap -sT -p 22-23,443 -sV -oX - 10.0.1.0/24');
  assert.equal(one({ ports: 'drawn' }, { asDrawn: ['udp/53', 'tcp/22'] }).text, 'sudo nmap -sT -sU -p T:22,U:53 -sV -oX - 10.0.1.0/24');
  const udp = one({ ports: 'drawn' }, { asDrawn: ['udp/53'] });
  assert.equal(udp.text, 'sudo nmap -sU -p U:53 -sV -oX - 10.0.1.0/24');
  assert.equal(udp.root, true);
  assert.equal(one({ ports: 'drawn' }, { asDrawn: ['tcp/8080'] }, ['services', 'identity']).text, "sudo nmap -sS -sU -p T:22,443,445,8080,U:137 -sV --script '" + IDENTITY + "' -oX - 10.0.1.0/24");
  for (const none of [{}, { asDrawn: [] }, { asDrawn: ['bogus'] }, { asDrawn: null }]) {
    assert.match(one({ ports: 'drawn' }, none).problem, /Nothing is drawn there yet; choose 1000 most common\./);
  }
});

test('the scans that say what a filter passes are root scans of their own kind', () => {
  for (const [id, arg] of [['ack', '-sA'], ['window', '-sW'], ['fin', '-sF'], ['null', '-sN'], ['xmas', '-sX']]) {
    const c = one({ tcp: id });
    assert.equal(c.text, 'sudo nmap ' + arg + ' -sV -oX - 10.0.1.0/24', id);
    assert.equal(c.root, true, id);
  }
});

test('depth and pace: what adds nothing without its block is left out', () => {
  assert.equal(one({ effort: 'light' }).text, 'nmap -sT -sV --version-light -oX - 10.0.1.0/24');
  assert.equal(one({ effort: 'all', depth: 'ports' }).text, 'nmap -sT -oX - 10.0.1.0/24', 'no versions, no effort');
  assert.equal(one({ osguess: 'guess' }).text, 'nmap -sT -sV -oX - 10.0.1.0/24', 'no OS guess asked');
  assert.equal(one({ osguess: 'guess', depth: 'os', effort: 'all' }).text, 'sudo nmap -sS -sV -O --version-all --osscan-guess -oX - 10.0.1.0/24');
  assert.equal(one({ osguess: 'limit', depth: 'os' }).text, 'sudo nmap -sS -sV -O --osscan-limit -oX - 10.0.1.0/24');
  const all = one({ pace: 'insane', rate: 'most', retries: 'none', patience: 'quarter', delay: 'second' }, { rate: '50' });
  assert.equal(all.text, 'nmap -sT -sV -T5 --max-rate 50 --max-retries 0 --host-timeout 15m --scan-delay 1s -oX - 10.0.1.0/24');
  assert.equal(all.warning, 'Misses ports on all but the fastest networks. Misses ports.');
  assert.equal(one({}).warning, undefined);
  assert.equal(one({ checks: 'all' }).warning, undefined, 'the checks\' warning is the block\'s own line');
});
