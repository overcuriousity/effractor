const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const T = require('../assets/js/nuclei-templates.js');

// effractor's own nuclei templates (nuclei templates spec §2): the table of
// what they answer, and their text written from it.
const texts = () => T.TEMPLATES.map(t => [t.id, T.text(t.id)]);

test('five templates, in two groups', () => {
  assert.deepEqual(T.TEMPLATES.map(t => [t.id, t.group, t.protocol]), [
    ['effractor-banner', 'identify', 'tcp'],
    ['effractor-web', 'identify', 'http'],
    ['effractor-certificate', 'identify', 'ssl'],
    ['effractor-login', 'connect', 'http'],
    ['effractor-points-to', 'connect', 'dns'],
  ]);
  assert.equal(T.text('nope'), null);
});

test('spec §2.1: no backslash, no single quote, printable ASCII; they only read', () => {
  for (const [id, text] of texts()) {
    assert.doesNotMatch(text, /[\\']/, id);
    assert.doesNotMatch(text, /[^\n\x20-\x7e]/, id);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), id);
    assert.ok(text.startsWith('id: ' + id + '\ninfo:\n  name: '), id);
    assert.match(text, /\n  author: effractor\n  severity: info\n(tcp|http|ssl|dns):\n/, id);
    assert.equal((text.match(/^(tcp|http|ssl|dns|javascript|code|headless|file|workflows?|websocket|whois):/gm) || []).length, 1, id);
    assert.doesNotMatch(text, /interactsh|payloads?:|body:|raw:|fuzzing:|attack:|\{\{(?!BaseURL|Hostname|Host|Port|FQDN)[^}]*\}\}/, id);
    for (const m of text.match(/^\s+- method: .*$/gm) || []) assert.equal(m.trim(), '- method: GET', id);
    // A value that holds a double quote is a folded block; any other is quoted.
    for (const line of text.split('\n')) if (/^\s+- "/.test(line)) assert.match(line, /^\s+- "[^"]*"$/, id + ': ' + line);
  }
});

test('spec §2.1: every extractor is named, each name once, and the table knows each', () => {
  const names = T.ANSWERS.map(a => a.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  for (const a of T.ANSWERS) {
    assert.match(a.name, /^[a-z][a-z0-9-]*$/, a.name);
    assert.ok(T.TEMPLATES.some(t => t.id === a.template), a.name);
    assert.equal(T.answer(a.name), a);
    assert.ok(['product', 'server', 'application', 'version', 'names', 'login', 'sso', 'address', 'alias', 'said'].includes(a.is), a.name);
    if (a.is === 'version') assert.equal((T.answer(a.of) || {}).is, 'application', a.name + ' of ' + a.of);
    if (a.is === 'product' || a.is === 'application') assert.ok(a.product && !/[0-9]$/.test(a.product), a.name);
    if (a.unless) assert.ok(T.answer(a.unless), a.name);
    const http = T.TEMPLATES.find(t => t.id === a.template).protocol === 'http';
    assert.equal(Array.isArray(a.paths) && a.paths.length > 0, http, a.name + ': paths are an http answer\'s');
    for (const p of T.pattern(a)) assert.ok(p instanceof RegExp, a.name);
  }
  for (const [id, text] of texts()) {
    const written = (text.match(/^        name: .*$/gm) || []).map(l => l.trim().slice(6));
    const mine = T.ANSWERS.filter(a => a.template === id).map(a => a.name);
    assert.deepEqual([...new Set(written)].sort(), mine.slice().sort(), id);
    assert.equal((text.match(/^      - type: /gm) || []).length, written.length, id + ': an extractor without a name');
  }
});

test('spec §5.3: the web template asks the root page and at most sixteen further paths', () => {
  const paths = [...new Set(T.ANSWERS.filter(a => a.paths).flatMap(a => a.paths))];
  assert.ok(paths.includes('/'));
  assert.ok(paths.length - 1 <= 16, paths.join(' '));
  for (const p of paths) assert.match(p, /^\/[0-9A-Za-z._\/?=+-]*$/, p);
  const web = T.text('effractor-web');
  assert.equal((web.match(/host-redirects: true\n    max-redirects: 3/g) || []).length, 1, 'redirects are followed from the root page, on the same host');
  assert.doesNotMatch(web, /\n    redirects: true/);
});

test('about fifty applications, the management pages and sign-ons among them marked', () => {
  const apps = T.ANSWERS.filter(a => a.is === 'application');
  assert.equal(apps.length, 49);
  assert.deepEqual(apps.filter(a => a.signs).map(a => a.name), ['keycloak', 'adfs']);
  assert.deepEqual(apps.filter(a => a.manages).map(a => a.name), ['fortigate', 'big-ip', 'sonicwall', 'vcenter', 'esxi', 'proxmox-ve', 'hpe-ilo', 'dell-idrac', 'synology-dsm', 'pfsense', 'opnsense', 'fritzbox', 'mikrotik-routeros', 'webmin', 'portainer']);
});

test('the files the page serves are what the table writes', () => {
  for (const [id, text] of texts()) assert.equal(fs.readFileSync('assets/nuclei/' + id + '.yaml', 'utf8'), text, id + ': run node scripts/dev/nuclei-templates-write.js');
  assert.deepEqual(fs.readdirSync('assets/nuclei').sort(), ['README.md'].concat(T.TEMPLATES.map(t => t.id + '.yaml')).sort());
});

const E = require('../assets/js/architecture-edit.js');

function drawing() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'LAN', addresses: ['10.0.1.0/24'] },
    box: { kind: 'host', label: 'Admin box', addresses: ['10.0.1.2'] },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
    web: { kind: 'host', label: 'Web 1', addresses: ['10.0.1.40', 'fd00::40'], names: ['grafana.corp.example', 'metrics.corp.example'] },
    six: { kind: 'host', label: 'six', addresses: ['fd00::5'] },
    wiki: { kind: 'host', label: 'wiki.lab' },
    far: { kind: 'host', label: 'Far', addresses: ['10.9.9.9'], names: ['far.corp.example'] },
    alt: { kind: 'service', label: 'alt' },
    https: { kind: 'service', label: 'https' },
  };
  d.associations = {
    a1: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
    a2: { kind: 'hosts', from: 'web', to: 'alt', privilege: 'unknown' },
    a3: { kind: 'hosts', from: 'web', to: 'https', privilege: 'unknown' },
  };
  d.flows = {
    f1: { label: 'alt on Web 1', source: 'nuclei', target: 'alt', route: [], protocol: 'tcp/8444' },
    f2: { label: 'https on Web 1', source: 'nuclei', target: 'https', route: [], protocol: 'tcp/443' },
    f3: { label: 'again', source: 'nuclei', target: 'alt', route: [], protocol: 'tcp/8444' },
    f4: { label: 'dns', source: 'nuclei', target: 'alt', route: [], protocol: 'udp/53' },
  };
  return d;
}

test('spec §3.2: thirty-two usual ports', () => {
  assert.equal(T.USUAL_PORTS.length, 32);
  assert.deepEqual(T.USUAL_PORTS, T.USUAL_PORTS.slice().sort((a, b) => a - b));
  assert.deepEqual(T.USUAL_PORTS.filter((p, i) => T.USUAL_PORTS.indexOf(p) !== i), []);
  for (const p of [21, 22, 25, 80, 443, 465, 993, 3306, 8006, 8443, 10443]) assert.ok(T.USUAL_PORTS.includes(p), String(p));
});

test('spec §3.1: the drawn hosts the range covers, their drawn ports, and what was typed by hand', () => {
  const t = T.targets(drawing(), '10.0.1.0/24 fd00::/64 wiki.lab 10.0.1.77', ['identify', 'connect']);
  assert.deepEqual(t.hosts, ['10.0.1.2', '10.0.1.40', '[fd00::5]', 'wiki.lab', '10.0.1.77']);
  assert.deepEqual(t.extra, ['10.0.1.40:8444'], 'a drawn port once, a usual one not again, UDP never');
  assert.deepEqual(t.names, ['grafana.corp.example', 'metrics.corp.example']);
  assert.equal(t.drawn, 4);
  assert.equal(t.said, '4 drawn hosts, 32 usual ports and 1 drawn one, 2 names.');
  assert.equal(t.resolves, true);
  assert.deepEqual(t.notes, []);
  // Without connect no name is asked.
  const i = T.targets(drawing(), '10.0.1.0/24', ['identify']);
  assert.deepEqual([i.hosts, i.names, i.resolves, i.said], [['10.0.1.2', '10.0.1.40'], [], false, '2 drawn hosts, 32 usual ports and 1 drawn one.']);
  // A URL names its host; a name a drawn host keeps names that host, by
  // the name, since it was the name that was typed.
  const far = T.targets(drawing(), 'https://far.corp.example:8443/x', ['identify']);
  assert.deepEqual([far.hosts, far.drawn, far.resolves], [['far.corp.example'], 1, true]);
});

test('spec §3.1: a range with nothing drawn in it is asked itself, up to 1,024 addresses', () => {
  const t = T.targets(E.empty(), '10.0.1.0/30 10.0.2.8/31', ['identify']);
  assert.deepEqual(t.hosts, ['10.0.1.1', '10.0.1.2', '10.0.2.8', '10.0.2.9']);
  assert.equal(t.said, '4 hosts, 32 usual ports.');
  assert.deepEqual(t.notes, ['Nothing is drawn in 10.0.1.0/30, 10.0.2.8/31 yet. nmap finds hosts faster.']);
  assert.equal(T.targets(E.empty(), '10.0.0.0/22', ['identify']).hosts.length, 1022);
  assert.equal(T.targets(E.empty(), '10.0.0.0/21', ['identify']).problem, 'Give a smaller range, or draw the hosts first with nmap.');
  assert.equal(T.targets(E.empty(), '10.0.0.0/23 10.0.4.0/23', ['identify']).hosts.length, 1020);
  assert.equal(T.targets(E.empty(), '10.0.0.0/22 10.0.4.0/29', ['identify']).problem, 'Give a smaller range, or draw the hosts first with nmap.');
  assert.match(T.targets(E.empty(), 'fd00::/64', ['identify']).problem, /^Nothing is drawn in fd00::\/64 yet; give its hosts/);
  assert.match(T.targets(E.empty(), '', ['identify']).problem, /^Give what to scan/);
  // A drawn host outside the range is left out, and a range that holds one drawn host is not expanded.
  assert.deepEqual(T.targets(drawing(), '10.9.9.0/24', ['identify']).hosts, ['10.9.9.9']);
});

test('what a shell reads as its own is refused in the range', () => {
  for (const bad of ['10.0.1.5; id', '$(id)', '`id`', "10.0.1.5'", '10.0.1.5"', '-oN', '10.0.1.0/24 | x', 'a\\b', 'a b>c']) {
    assert.match(T.targets(drawing(), bad, ['identify']).problem || '', /^The range may hold only/, bad);
    assert.match(T.command(['identify'], {}, bad, drawing()).problem || '', /^The range may hold only/, bad);
  }
});

test('spec §3: one paste writes the templates and the targets, then runs nuclei', () => {
  const c = T.command(['identify'], {}, '10.0.1.0/24', drawing());
  const parts = c.text.split('; ');
  assert.equal(parts[0], 'mkdir -p effractor-templates');
  for (const [i, id] of ['effractor-banner', 'effractor-web', 'effractor-certificate'].entries()) {
    assert.equal(parts[i + 1], "echo '" + T.text(id).replace(/\n$/, '') + "' > effractor-templates/" + id + '.yaml');
  }
  // The awk program holds a `;` of its own: split on the shell's, between the quotes' ends.
  const rest = c.text.slice(c.text.indexOf("; awk 'BEGIN") + 2);
  assert.equal(rest, 'awk \'BEGIN { n = split("10.0.1.2 10.0.1.40", h, " "); m = split("' + T.USUAL_PORTS.join(' ') + '", p, " "); for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) print h[i] ":" p[j]; print "10.0.1.40:8444" }\' > targets.txt; '
    + 'nuclei -t effractor-templates/effractor-banner.yaml,effractor-templates/effractor-web.yaml,effractor-templates/effractor-certificate.yaml -list targets.txt -exclude-type dns -jsonl -silent -omit-raw -omit-template -no-interactsh -disable-update-check');
  assert.equal(c.said, '2 drawn hosts, 32 usual ports and 1 drawn one.');
  assert.equal(c.note, undefined);
  assert.equal(c.warning, undefined);
});

test('names and connect: this machine\'s resolvers, and the names asked in a run of their own', () => {
  const c = T.command(['identify', 'connect'], { speed: 'gentle', patience: 'slow', errors: 'never', addresses: 'both', severity: 'high', oast: 'own', browser: 'on' }, '10.0.1.0/24 wiki.lab', drawing());
  const tail = c.text.slice(c.text.indexOf("' > targets.txt; ") + 17);
  const more = ' -ip-version 4,6 -rate-limit 20 -concurrency 5 -timeout 20 -retries 2 -no-mhe -jsonl -silent -omit-raw -omit-template -no-interactsh -disable-update-check';
  assert.equal(tail, "awk '/^nameserver/ {print $2}' /etc/resolv.conf > resolvers.txt; "
    + 'nuclei -t effractor-templates/effractor-banner.yaml,effractor-templates/effractor-web.yaml,effractor-templates/effractor-certificate.yaml,effractor-templates/effractor-login.yaml -list targets.txt -resolvers resolvers.txt' + more + '; '
    + "echo 'grafana.corp.example\nmetrics.corp.example' > names.txt; "
    + 'nuclei -t effractor-templates/effractor-points-to.yaml -list names.txt -resolvers resolvers.txt' + more);
  assert.match(c.text, /> effractor-templates\/effractor-points-to\.yaml; awk/);
  assert.equal(c.note, 'Names are asked of this machine\'s resolvers; nuclei\'s own are public ones.');
  // Connect alone, no name kept: the login template, nothing asked of a resolver.
  const d = drawing();
  delete d.entities.web.names;
  const l = T.command(['connect'], {}, '10.0.1.0/24', d);
  assert.match(l.text, /nuclei -t effractor-templates\/effractor-login\.yaml -list targets\.txt -exclude-type dns /);
  assert.doesNotMatch(l.text, /resolvers|names\.txt|points-to/);
  assert.equal(T.command([], {}, '10.0.1.0/24', drawing()).problem, 'Choose what nuclei should look for.');
  assert.equal(T.command(['nope'], {}, '10.0.1.0/24', drawing()).problem, 'Choose what nuclei should look for.');
  assert.match(T.command(['identify'], { speed: 'fast' }, '10.0.1.0/24', drawing()).warning, /^Fast can overload/);
});

test('review focus 4: hundreds of drawn hosts are one line of targets', () => {
  const d = drawing();
  for (let i = 0; i < 600; i++) d.entities['h' + i] = { kind: 'host', label: 'h' + i, addresses: ['10.1.' + Math.floor(i / 250) + '.' + (i % 250 + 1)] };
  const c = T.command(['identify'], {}, '10.1.0.0/16', d);
  assert.equal(c.said, '600 drawn hosts, 32 usual ports.');
  assert.equal(c.text.split('\n').filter(l => /^awk /.test(l) || /; awk /.test(l)).length, 1);
  assert.ok(c.text.length < 30000, String(c.text.length));
});

test('what is shown is the command without the templates\' text; what is copied is whole', () => {
  const c = T.command(['identify', 'connect'], {}, '10.0.1.0/24', drawing());
  assert.ok(c.shown.length < 1600, String(c.shown.length));
  assert.equal(c.shown.split('\n').length, 2, 'the names are two lines');
  assert.match(c.shown, /^mkdir -p effractor-templates; echo '… \d+ lines …' > effractor-templates\/effractor-banner\.yaml; /);
  assert.equal(c.shown.replace(/echo '… \d+ lines …' > effractor-templates\/[a-z-]+\.yaml; /g, ''), c.text.replace(/echo 'id: effractor-[^']*' > effractor-templates\/[a-z-]+\.yaml; /g, ''));
});

test('spec §10: How it connects on a drawing without services says what to run first', () => {
  const d = drawing();
  d.associations = { a1: d.associations.a1 };
  d.flows = {};
  assert.equal(T.command(['connect'], {}, '10.0.1.0/24', d).problem, 'Nothing drawn to ask yet; run What is there first.');
  assert.ok(T.command(['identify', 'connect'], {}, '10.0.1.0/24', d).text, 'with What is there it is asked at once');
  assert.ok(T.command(['connect'], {}, '10.0.1.0/24', drawing()).text);
  // Hosts typed by hand on an empty drawing are asked: nothing is drawn to wait for.
  assert.ok(T.command(['connect'], {}, '10.0.1.5', E.empty()).text);
});

const LAB = JSON.parse(fs.readFileSync('scripts/fixtures/nuclei/lab.json', 'utf8'));

// Every answer has a place in the lab where its own pattern finds it: what
// the fixtures hold is then what nuclei found there (spec §2.1 rule 6).
test('the lab answers every question of the table', () => {
  const ports = LAB.hosts.flatMap(h => h.ports.map(p => Object.assign({ host: h.address }, p)));
  const head = (p, page) => Object.entries(Object.assign({}, p.server ? { Server: p.server } : {}, p.headers || {}, page.headers || {}, page.location ? { Location: page.location } : {})).map(([k, v]) => k + ': ' + v).join('\r\n');
  const found = a => {
    if (a.is === 'names') return ports.some(p => p.tls && p.tls.names.length);
    if (a.is === 'server') return ports.some(p => p.server);
    if (a.is === 'address') return Object.values(LAB.names).some(n => n.address);
    if (a.is === 'alias') return Object.values(LAB.names).some(n => n.alias);
    const res = T.pattern(a);
    if (!a.paths) return ports.some(p => p.banner && res.some(r => r.test(p.banner)));
    return ports.some(p => a.paths.some(path => {
      // The root page is followed where it sends on, on the same host.
      let page = (p.pages || {})[path], hops = 0;
      while (path === '/' && page && page.location && /^\//.test(page.location) && hops++ < 3) {
        if (a.part === 'header' && res.some(r => r.test(head(p, page)))) return true;
        page = p.pages[page.location];
      }
      if (!page) return false;
      return res.some(r => r.test(a.part === 'header' ? head(p, page) : page.body || ''));
    }));
  };
  assert.deepEqual(T.ANSWERS.filter(a => !found(a)).map(a => a.name), []);
  // Each application is alone on its port: a page that two applications claim proves neither.
  for (const p of ports.filter(p => p.pages)) {
    const apps = T.ANSWERS.filter(a => a.is === 'application' && a.paths.some(path => {
      const page = p.pages[path];
      return page && T.pattern(a).some(r => r.test(a.part === 'header' ? head(p, page) : page.body || ''));
    })).map(a => a.name);
    assert.ok(apps.length <= 1, p.host + ':' + p.port + ' answers as ' + apps.join(' and '));
  }
  for (const h of LAB.hosts) assert.match(h.address, /^10\.0\.2\.\d+$|^fd00:2::[0-9a-f]+$/, 'the lab is 10.0.2.0/24 and fd00:2::/64');
});
