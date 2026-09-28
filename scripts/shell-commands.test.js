const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const N = require('../assets/js/nmap-command.js');
const M = require('../assets/js/masscan.js');
const Nu = require('../assets/js/nuclei-command.js');

// Owner, 2026-09-28: every command the page offers runs as it stands in
// fish, bash and sh. Each is run in each shell with stand-ins for the
// programs, which write down the arguments they were given; every shell
// must hand over the same ones, and they must be what the command says.
// A shell that is not installed is left out; CI installs all three.
const SHELLS = ['sh', 'bash', 'fish'].filter(s => spawnSync(s, ['-c', 'true']).status === 0);

function commands() {
  const out = [];
  const take = c => { if (c && c.text) out.push(c.text); if (c && c.second) out.push(c.second); };
  const ranges = ['10.0.1.0/24', '10.0.1.5 10.0.1.7', 'fd00::/120', 'fe80::1%eth0', 'srv-01.lab 10.0.1.5'];
  for (const range of ranges) {
    for (const r of N.RECIPES) take(N.command([r.id], {}, range, { portList: '22,80,8000-8100', drawnPorts: ['tcp/443', 'udp/53'], ack: true }));
    take(N.command(N.RECIPES.filter(r => !r.alone).map(r => r.id), {}, range, { drawnPorts: ['tcp/443'], ack: true }));
    const typed = { portList: 'T:22,U:53', asDrawn: ['tcp/443', 'udp/53'], self: ['10.0.1.2', 'fd00::2'], resolver: '10.0.1.1, fd00::53', exclude: '10.0.1.1 10.0.1.16/28,printer.lab fe80::1%eth0', iface: 'enp3s0.100', rate: '100' };
    for (const b of N.BLOCKS) for (const c of b.choices) take(N.command(['services'], { [b.id]: c.id }, range, typed));
    // Every block at its last choice, in one command (scan workflow spec §8).
    const every = {};
    for (const b of N.BLOCKS) every[b.id] = b.choices[b.choices.length - 1].id;
    take(N.command(['services'], Object.assign(every, { discovery: 'every', ports: 'drawn' }), range, typed));
  }
  for (const range of ['10.0.1.0/24', '10.0.1.5 10.0.1.7', '10.0.1.5-10.0.1.9']) {
    for (const p of M.PORTS) for (const r of M.RATES) take(M.command({ ports: p.id, rate: r.id }, range));
  }
  const extra = { server: 'https://oast.lab.example:8443', header: 'Cookie: session=a1b2; theme=dark & $HOME `id` "x" (y) {z} *?~ #!' };
  const urls = ['10.0.1.0/24', 'app.lab 10.0.1.5:8443', 'https://app.lab:8443/a/?b=1&c=[2]~%20+@=', 'http://[fd00::5]:8080'];
  for (const range of urls) {
    for (const r of Nu.RECIPES) take(Nu.command([r.id], {}, range));
    take(Nu.command(Nu.RECIPES.filter(r => !r.alone).map(r => r.id), {}, range));
    for (const b of Nu.BLOCKS) for (const c of b.choices) take(Nu.command([b.only || 'cves'], { [b.id]: c.id }, range, extra));
    const every = {};
    for (const b of Nu.BLOCKS) every[b.id] = b.choices[b.choices.length - 1].id;
    take(Nu.command(['cves', 'tls'], every, range, extra));
  }
  return out.filter((c, i) => out.indexOf(c) === i);
}

// The words of a command as a POSIX shell reads them, by hand: quotes are
// single ones only, and nothing else is special in what the page writes.
function words(command) {
  const parts = [];
  let out = [], word = null, quoted = false;
  const end = () => {
    if (word != null) out.push(word);
    word = null;
  };
  for (const ch of command) {
    if (quoted) {
      if (ch === "'") quoted = false;
      else word += ch;
    } else if (ch === "'") {
      quoted = true;
      word = word == null ? '' : word;
    } else if (ch === ' ') end();
    else if (ch === ';') {
      end();
      parts.push(out);
      out = [];
    } else word = (word == null ? '' : word) + ch;
  }
  end();
  parts.push(out);
  return parts;
}

test('the page offers commands of every tool, and only what is quoted holds a shell\'s own signs', () => {
  const all = commands();
  assert.ok(all.length > 300, String(all.length));
  assert.ok(all.some(c => /^sudo nmap /.test(c)) && all.some(c => /^sudo masscan /.test(c)) && all.some(c => /^awk .*; nuclei /.test(c)));
  for (const c of all) {
    // Outside single quotes: nothing fish, bash or sh would read as its own.
    const bare = c.replace(/'[^']*'/g, '');
    assert.doesNotMatch(bare, /[\\"`$&|<(){}\[\]*?~#!^]/, c);
    assert.ok(bare.split(';').length <= 2 && bare.split('>').length <= 2, c);
    // Inside them: no backslash, which fish reads there and sh does not.
    assert.doesNotMatch(c, /\\/, c);
    assert.equal(c.split("'").length % 2, 1, 'quotes close: ' + c);
  }
});

test('fish, bash and sh hand the programs the same arguments', { skip: SHELLS.length < 2 ? 'fewer than two of sh, bash, fish installed' : false }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effractor-shells-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(dir, 'resolv.conf'), 'nameserver 192.0.2.53\n');
    // Each stand-in writes its name and arguments, one a line, the line
    // breaks of an argument shown; sudo is one more program with its own.
    const stub = '#!/bin/sh\nn=$(basename "$0")\nfor a in "$@"; do printf \'%s\\037\' "$a"; done >> "$OUT.args"\nprintf \'%s\\036\' "$n" >> "$OUT.args"\n';
    for (const name of ['nmap', 'masscan', 'nuclei', 'sudo', 'awk']) fs.writeFileSync(path.join(bin, name), stub, { mode: 0o755 });
    const all = commands();
    const env = Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH, HOME: dir });
    const ran = {};
    for (const shell of SHELLS) {
      ran[shell] = all.map((c, i) => {
        const out = path.join(dir, shell + '-' + i);
        const args = shell === 'fish' ? ['--no-config', '-c', c] : ['-c', c];
        const r = spawnSync(shell, args, { cwd: dir, env: Object.assign({}, env, { OUT: out }), encoding: 'utf8' });
        assert.equal(r.status, 0, shell + ' could not run: ' + c + '\n' + r.stderr);
        assert.equal(r.stderr, '', shell + ' complained of: ' + c);
        return fs.readFileSync(out + '.args', 'utf8').split('\u001e').filter(Boolean).map(p => {
          const parts = p.split('\u001f');
          return [parts.pop()].concat(parts);
        });
      });
    }
    all.forEach((c, i) => {
      const expected = words(c).map(w => w.filter(x => x !== '>' && x !== 'resolvers.txt' || w[0] !== 'awk'));
      for (const shell of SHELLS) assert.deepEqual(ran[shell][i], expected, shell + ': ' + c);
    });
    // What the first part of a command with a name writes is a file.
    assert.ok(fs.existsSync(path.join(dir, 'resolvers.txt')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('all three shells were there to ask', { skip: process.env.CI ? false : 'only CI must have sh, bash and fish' }, () => {
  assert.deepEqual(SHELLS, ['sh', 'bash', 'fish']);
});

const T = require('../assets/js/nuclei-templates.js');
const E = require('../assets/js/architecture-edit.js');

// effractor's own templates (nuclei templates spec §3): the command writes
// files, so it is run with the real mkdir, echo and awk and a stand-in for
// nuclei, and what every shell wrote is compared byte for byte.
function ours() {
  const d = E.empty();
  d.entities = {
    web: { kind: 'host', label: 'Web 1', addresses: ['10.0.1.40'], names: ['grafana.corp.example', 'metrics.corp.example'] },
    six: { kind: 'host', label: 'six', addresses: ['fd00::5'] },
    wiki: { kind: 'host', label: 'wiki.lab' },
    alt: { kind: 'service', label: 'alt' },
    web2: { kind: 'service', label: 'https' },
    nu: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
  };
  d.associations = { a: { kind: 'hosts', from: 'web', to: 'alt', privilege: 'unknown' }, b: { kind: 'hosts', from: 'wiki', to: 'web2', privilege: 'unknown' } };
  d.flows = { f: { label: 'alt on Web 1', source: 'nu', target: 'alt', route: [], protocol: 'tcp/8444' } };
  return [
    T.command(['identify'], {}, '10.0.1.0/24', d),
    T.command(['identify', 'connect'], { speed: 'gentle' }, '10.0.1.0/24 fd00::/64 wiki.lab', d),
    T.command(['connect'], {}, 'https://wiki.lab:8443/a?b=1', d),
  ].map(c => c.text);
}

test('effractor\'s templates: only what is quoted holds a shell\'s own signs', () => {
  for (const c of ours()) {
    const bare = c.replace(/'[^']*'/g, '');
    assert.doesNotMatch(bare, /[\\"`$&|<(){}\[\]*?~#!^]/, bare);
    assert.doesNotMatch(c, /\\/);
    assert.equal(c.split("'").length % 2, 1, 'quotes close');
    // Every `>` writes one of the command's own files.
    for (const m of bare.match(/> [^\s;]+/g)) assert.match(m, /^> (effractor-templates\/effractor-[a-z-]+\.yaml|targets\.txt|names\.txt|resolvers\.txt)$/);
  }
});

test('effractor\'s templates: fish, bash and sh write the same files and run nuclei the same way', { skip: SHELLS.length < 2 ? 'fewer than two of sh, bash, fish installed' : false }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effractor-own-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'nuclei'), '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done >> nuclei.args\nprintf \'%s\\n\' --- >> nuclei.args\n', { mode: 0o755 });
    const env = Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH, HOME: dir });
    ours().forEach((c, i) => {
      const wrote = {};
      for (const shell of SHELLS) {
        const cwd = path.join(dir, shell + '-' + i);
        fs.mkdirSync(cwd);
        const r = spawnSync(shell, shell === 'fish' ? ['--no-config', '-c', c] : ['-c', c], { cwd, env, encoding: 'utf8' });
        assert.equal(r.status, 0, shell + ': ' + r.stderr);
        assert.equal(r.stderr, '', shell);
        const files = {};
        for (const name of fs.readdirSync(cwd)) if (name !== 'effractor-templates' && name !== 'resolvers.txt') files[name] = fs.readFileSync(path.join(cwd, name), 'utf8');
        for (const name of fs.readdirSync(path.join(cwd, 'effractor-templates'))) {
          files[name] = fs.readFileSync(path.join(cwd, 'effractor-templates', name), 'utf8');
          assert.equal(files[name], fs.readFileSync(path.join('assets/nuclei', name), 'utf8'), shell + ' wrote ' + name);
        }
        wrote[shell] = files;
      }
      for (const shell of SHELLS) assert.deepEqual(wrote[shell], wrote[SHELLS[0]], shell);
      const first = wrote[SHELLS[0]];
      if (i === 1) {
        const lines = first['targets.txt'].trim().split('\n');
        assert.equal(lines.length, 3 * T.USUAL_PORTS.length + 1);
        assert.deepEqual([lines[0], lines[T.USUAL_PORTS.length], lines[2 * T.USUAL_PORTS.length], lines[lines.length - 1]], ['10.0.1.40:21', '[fd00::5]:21', 'wiki.lab:21', '10.0.1.40:8444']);
        assert.equal(first['names.txt'], 'grafana.corp.example\nmetrics.corp.example\n');
        assert.equal(first['nuclei.args'].split('---\n').filter(Boolean).length, 2, 'two runs');
      }
      assert.match(first['nuclei.args'], /^-t\neffractor-templates\//);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
