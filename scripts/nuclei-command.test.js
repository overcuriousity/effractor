const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/nuclei-command.js');
const Nu = require('../assets/js/nuclei.js');
const r = '10.0.1.0/24';
// What every command ends in: JSON lines, no third party asked.
const END = ' -jsonl -silent -omit-raw -omit-template -no-interactsh -disable-update-check';
// DNS checks ask resolvers; a range of addresses has no name to ask about.
const NODNS = ' -exclude-type dns';
const text = (recipes, adjust, range, extra) => C.command(recipes, adjust || {}, range == null ? r : range, extra).text;

test('the recipes by purpose, in the order the dialog offers them', () => {
  assert.deepEqual(C.RECIPES.map(x => x.id), ['all', 'cves', 'exploited', 'exposures', 'misconfig', 'logins', 'network', 'tls', 'takeover', 'panels', 'tech', 'auto', 'fuzz']);
  assert.ok(C.RECIPES.every(x => x.name && x.finds && x.time));
  assert.deepEqual(C.BLOCKS.map(b => b.id), ['severity', 'checks', 'templates', 'protocols', 'browser', 'code', 'payloads', 'oast', 'redirects', 'addresses', 'login', 'portscan', 'order', 'speed', 'patience', 'errors', 'honeypots', 'evidence']);
  // Every block starts at its first choice, which adds nothing but the fixed end.
  for (const b of C.BLOCKS) assert.equal(C.DEFAULTS[b.id], b.choices[0].id, b.id);
  assert.ok(C.BLOCKS.every(b => b.name && b.choices.every(c => c.id && c.name)));
  assert.deepEqual(Nu.RECIPES.filter(r => !r.ours), C.RECIPES, 'nuclei.js has every name of the commands, after effractor\'s two');
});

test('each recipe alone prints the scan it names', () => {
  assert.equal(text(['all']), 'nuclei -target 10.0.1.0/24' + NODNS + END);
  assert.equal(text(['cves']), 'nuclei -target 10.0.1.0/24 -tags cve' + NODNS + END);
  assert.equal(text(['exploited']), 'nuclei -target 10.0.1.0/24 -tags kev,vkev' + NODNS + END);
  assert.equal(text(['exposures']), 'nuclei -target 10.0.1.0/24 -tags exposure' + NODNS + END);
  assert.equal(text(['misconfig']), 'nuclei -target 10.0.1.0/24 -tags misconfig' + NODNS + END);
  assert.equal(text(['logins']), 'nuclei -target 10.0.1.0/24 -tags default-login' + NODNS + END);
  assert.equal(text(['network']), 'nuclei -target 10.0.1.0/24 -tags network' + NODNS + END);
  assert.equal(text(['tls']), 'nuclei -target 10.0.1.0/24 -tags ssl' + NODNS + END);
  assert.equal(text(['takeover']), 'nuclei -target 10.0.1.0/24 -tags takeover' + NODNS + END);
  assert.equal(text(['panels']), 'nuclei -target 10.0.1.0/24 -tags panel' + NODNS + END);
  assert.equal(text(['tech']), 'nuclei -target 10.0.1.0/24 -tags tech' + NODNS + END);
  assert.equal(text(['auto']), 'nuclei -target 10.0.1.0/24 -automatic-scan' + NODNS + END);
  assert.equal(text(['fuzz']), 'nuclei -target 10.0.1.0/24 -dast' + NODNS + END);
});

test('recipes combine into one list of tags, in the dialog\'s order; two go alone', () => {
  assert.equal(text(['tls', 'cves', 'exposures']), 'nuclei -target 10.0.1.0/24 -tags cve,exposure,ssl' + NODNS + END);
  assert.match(C.command(['all', 'cves'], {}, r).problem, /Everything standard holds the others/);
  assert.match(C.command(['auto', 'cves'], {}, r).problem, /chooses its own checks/);
  assert.match(C.command(['cves', 'fuzz'], {}, r).problem, /runs its own checks/);
  assert.match(C.command([], {}, r).problem, /what nuclei should look for/i);
  assert.match(C.command(['nope'], {}, r).problem, /what nuclei should look for/i);
});

test('Adjust: each choice adds its own words, the first of each none', () => {
  const one = (block, id, extra) => text(['cves'], { [block]: id }, r, extra).replace('nuclei -target 10.0.1.0/24 -tags cve', '').replace(END, '').replace(NODNS, '').trim();
  for (const b of C.BLOCKS) assert.equal(one(b.id, b.choices[0].id), '', b.id);
  assert.equal(one('severity', 'low'), '-severity low,medium,high,critical');
  assert.equal(one('severity', 'medium'), '-severity medium,high,critical');
  assert.equal(one('severity', 'high'), '-severity high,critical');
  assert.equal(one('severity', 'critical'), '-severity critical');
  assert.equal(one('checks', 'careful'), '-exclude-tags intrusive');
  assert.equal(one('checks', 'all'), '-include-tags dos,fuzz,bruteforce');
  assert.equal(one('templates', 'new'), '-new-templates');
  assert.equal(one('protocols', 'web'), '-type http');
  assert.equal(one('protocols', 'tls'), '-type ssl');
  assert.equal(text(['cves'], { protocols: 'web' }), 'nuclei -target 10.0.1.0/24 -tags cve -type http' + END, 'no DNS checks among them: nothing to leave out');
  assert.equal(one('protocols', 'network'), '-type tcp,javascript');
  assert.equal(one('browser', 'on'), '-headless');
  assert.equal(one('code', 'on'), '-code');
  // Payloads are the fuzzing recipe's: without it they say nothing.
  assert.equal(one('payloads', 'high'), '');
  assert.equal(text(['fuzz'], { payloads: 'medium' }), 'nuclei -target 10.0.1.0/24 -dast -fuzz-aggression medium' + NODNS + END);
  assert.equal(text(['fuzz'], { payloads: 'high' }), 'nuclei -target 10.0.1.0/24 -dast -fuzz-aggression high' + NODNS + END);
  assert.equal(C.combine(['cves'], { payloads: 'high' }).choices.payloads, 'low');
  assert.equal(one('redirects', 'host'), '-follow-host-redirects');
  assert.equal(one('redirects', 'any'), '-follow-redirects');
  assert.equal(one('addresses', 'six'), '-ip-version 6');
  assert.equal(one('addresses', 'both'), '-ip-version 4,6');
  assert.equal(one('addresses', 'every'), '-scan-all-ips -ip-version 4,6');
  assert.equal(one('portscan', 'on'), '-preflight-portscan');
  assert.equal(one('order', 'host'), '-scan-strategy host-spray');
  assert.equal(one('order', 'template'), '-scan-strategy template-spray');
  assert.equal(one('speed', 'gentle'), '-rate-limit 20 -concurrency 5');
  assert.equal(one('speed', 'fast'), '-rate-limit 500 -concurrency 50');
  assert.equal(one('patience', 'slow'), '-timeout 20 -retries 2');
  assert.equal(one('errors', 'never'), '-no-mhe');
  assert.equal(one('honeypots', 'flag'), '-honeypot-detect');
  assert.equal(one('honeypots', 'hide'), '-honeypot-detect -suppress-honeypot');
  // A choice that is none of the block's is not taken.
  assert.equal(one('speed', 'bogus'), '');
  assert.equal(text(['cves'], { nope: 'x' }), 'nuclei -target 10.0.1.0/24 -tags cve' + NODNS + END);
});

test('what is dangerous is offered, with its warning', () => {
  const warned = (block, id) => C.command(['cves'], { [block]: id }, r).warning;
  assert.match(warned('checks', 'all'), /denial-of-service/);
  assert.match(warned('code', 'on'), /on this machine/);
  assert.match(C.command(['fuzz'], {}, r).warning, /attack payloads/);
  assert.match(warned('speed', 'fast'), /overload/);
  assert.equal(warned('speed', 'gentle'), undefined);
  assert.match(C.command(['cves'], { checks: 'all', speed: 'fast' }, r).warning, /denial-of-service.* .*overload/);
  assert.match(C.command(['logins'], {}, r).note, /tries the vendors' passwords/);
});

test('evidence, out-of-band checks and a login take their own words', () => {
  assert.equal(text(['cves'], { evidence: 'raw' }), 'nuclei -target 10.0.1.0/24 -tags cve -exclude-type dns -jsonl -silent -omit-template -no-interactsh -disable-update-check');
  assert.equal(text(['cves'], { oast: 'own' }, r, { server: 'oast.lab.example' }), 'nuclei -target 10.0.1.0/24 -tags cve -interactsh-server oast.lab.example -exclude-type dns -jsonl -silent -omit-raw -omit-template -disable-update-check');
  assert.equal(text(['cves'], { oast: 'own' }, r, { server: ' https://oast.lab.example:8443 ' }), 'nuclei -target 10.0.1.0/24 -tags cve -interactsh-server https://oast.lab.example:8443 -exclude-type dns -jsonl -silent -omit-raw -omit-template -disable-update-check');
  assert.match(C.command(['cves'], { oast: 'own' }, r, {}).problem, /your interactsh server/);
  for (const bad of ['oast.pro', 'x.oast.fun', 'https://oast.live', 'oast.site', 'oast.online', 'oast.me', 'interact.sh', 'a.interact.sh']) {
    assert.match(C.command(['cves'], { oast: 'own' }, r, { server: bad }).problem, /public/, bad);
  }
  for (const bad of ['-x', 'a b', "a'b", 'a;b', '$(id)', 'a`b`', 'a|b']) {
    assert.match(C.command(['cves'], { oast: 'own' }, r, { server: bad }).problem, /server/, bad);
  }
  assert.equal(text(['cves'], { login: 'header' }, r, { header: 'Cookie: session=abc123; theme=dark' }), "nuclei -target 10.0.1.0/24 -tags cve -header 'Cookie: session=abc123; theme=dark'" + NODNS + END);
  assert.match(C.command(['cves'], { login: 'header' }, r, {}).problem, /header/);
  for (const bad of ['no colon', "Cookie: a'b", 'Cookie: a\nb', 'Cookie: a\\b', ': x', 'Cookie: é']) {
    const c = C.command(['cves'], { login: 'header' }, r, { header: bad });
    assert.equal(c.text, undefined, bad);
    assert.match(c.problem, /header/, bad);
  }
});

test('the range: addresses, CIDR, names and URLs; what a shell would read is refused or quoted', () => {
  assert.equal(text(['cves'], {}, '10.0.1.5 10.0.1.7:8443'), 'nuclei -target 10.0.1.5,10.0.1.7:8443 -tags cve' + NODNS + END);
  assert.equal(text(['cves'], {}, '10.0.1.5,10.0.1.7'), 'nuclei -target 10.0.1.5,10.0.1.7 -tags cve' + NODNS + END);
  assert.equal(text(['cves'], {}, 'https://10.0.1.5:8443/app/?a=1&b=2'), "nuclei -target 'https://10.0.1.5:8443/app/?a=1&b=2' -tags cve" + NODNS + END);
  assert.equal(text(['cves'], {}, 'http://[fd00::5]:8080'), "nuclei -target 'http://[fd00::5]:8080' -tags cve" + NODNS + END);
  assert.match(C.command(['cves'], {}, '  ').problem, /Give what to scan/);
  for (const bad of ['-l hosts', '10.0.1.5;id', '$(id)', "10.0.1.5'", '10.0.1.5|x', 'a`b`', '10.0.1.5 -ut', 'a\\b', 'a"b', 'a>b', 'a*', 'a!b', '{a,b}', 'a#b', 'a(b)']) {
    const c = C.command(['cves'], {}, bad);
    assert.equal(c.text, undefined, bad);
    assert.match(c.problem, /may hold only/, bad);
  }
});

test('a name is asked of this machine\'s resolvers, never of nuclei\'s public ones', () => {
  const RESOLVERS = "awk '/^nameserver/ {print $2}' /etc/resolv.conf > resolvers.txt; ";
  const named = C.command(['cves'], {}, 'app.lab 10.0.1.5');
  assert.equal(named.text, RESOLVERS + 'nuclei -target app.lab,10.0.1.5 -tags cve -resolvers resolvers.txt' + END);
  assert.match(named.note, /this machine's resolvers/);
  assert.equal(text(['cves'], {}, 'https://app.lab:8443'), RESOLVERS + 'nuclei -target https://app.lab:8443 -tags cve -resolvers resolvers.txt' + END);
  for (const plain of ['10.0.1.0/24', '10.0.1.5:22', 'https://10.0.1.5', 'http://[fd00::5]:8080', 'fd00::5', 'fd00::/120']) {
    assert.doesNotMatch(text(['cves'], {}, plain), /resolvers/, plain);
    assert.equal(C.command(['cves'], {}, plain).note, undefined, plain);
  }
  // DNS checks ask resolvers whatever the range holds.
  assert.equal(text(['cves'], { protocols: 'dns' }, '10.0.1.5'), RESOLVERS + 'nuclei -target 10.0.1.5 -tags cve -type dns -resolvers resolvers.txt' + END);
  assert.doesNotMatch(text(['all'], { protocols: 'web' }, '10.0.1.5'), /resolvers|exclude-type/);
});

// Owner, 2026-09-24 and 2026-09-28: nothing offered asks a third party,
// and nothing offered hides a scan.
test('no command asks a third party or hides the scan, whatever is ticked', () => {
  const FORBIDDEN = /(^| )-(uc|uncover|uq|uncover-query|ue|uncover-engine|pd|dashboard|pdu|dashboard-upload|cup|cloud-upload|auth|tid|team-id|sid|scan-id|ai|prompt|turl|template-url|wurl|workflow-url|up|update|ut|update-templates|p|proxy|pi|proxy-internal|tlsi|tls-impersonate|sip|source-ip|i|interface|system-resolvers|sr)( |$)/;
  const extra = { server: 'oast.lab.example', header: 'Cookie: a=b' };
  const all = [];
  for (const range of [r, 'app.lab 10.0.1.5']) {
    for (const x of C.RECIPES) all.push(C.command([x.id], {}, range));
    all.push(C.command(C.RECIPES.filter(x => !x.alone).map(x => x.id), {}, range));
    for (const b of C.BLOCKS) for (const c of b.choices) all.push(C.command(['cves'], { [b.id]: c.id }, range, extra));
    const everything = {};
    for (const b of C.BLOCKS) everything[b.id] = b.choices[b.choices.length - 1].id;
    all.push(C.command(['cves', 'tls'], everything, range, extra));
  }
  assert.ok(all.length > 120);
  for (const c of all) {
    assert.equal(c.problem, undefined, JSON.stringify(c));
    assert.doesNotMatch(c.text, FORBIDDEN, c.text);
    assert.match(c.text, / -disable-update-check$/, c.text);
    assert.ok(/ -no-interactsh /.test(c.text) !== / -interactsh-server oast\.lab\.example /.test(c.text), 'nuclei\'s public servers are never used: ' + c.text);
    // Whatever may ask a resolver asks this machine's.
    const dns = !/ -exclude-type dns /.test(c.text) && !/ -type (http|ssl|tcp,javascript) /.test(c.text);
    assert.equal(/ -resolvers resolvers\.txt /.test(c.text), / -target (\S*,)?app\.lab/.test(c.text) || dns, c.text);
    assert.equal(/^awk /.test(c.text), / -resolvers /.test(c.text), c.text);
  }
});

test('the dialog\'s words per recipe say what is drawn and what is only seen', () => {
  const informational = C.RECIPES.filter(x => x.informational).map(x => x.id);
  assert.deepEqual(informational, ['panels', 'tech']);
  for (const id of informational) assert.match(C.command([id], {}, r).note, /only say a port is open/);
  assert.equal(C.command(['cves', 'tech'], {}, r).note, undefined, 'beside a recipe with findings nothing needs saying');
});

test('effractor\'s own templates: nothing asks a third party or hides a scan', () => {
  const T = require('../assets/js/nuclei-templates.js');
  const E = require('../assets/js/architecture-edit.js');
  const d = E.empty();
  d.entities = { h: { kind: 'host', label: 'app.lab', addresses: ['10.0.1.5'], names: ['app.corp.example'] }, s: { kind: 'service', label: 'https' } };
  d.associations = { a: { kind: 'hosts', from: 'h', to: 's', privilege: 'unknown' } };
  for (const groups of [['identify'], ['connect'], ['identify', 'connect']]) {
    for (const range of ['10.0.1.0/24', 'app.lab', '10.0.1.5 app.lab']) {
      const c = T.command(groups, {}, range, d);
      const runs = c.text.split('; ').filter(p => /^nuclei /.test(p));
      assert.ok(runs.length >= 1);
      for (const run of runs) {
        assert.match(run, / -no-interactsh /);
        assert.match(run, / -disable-update-check$/);
        assert.match(run, / -resolvers resolvers\.txt | -exclude-type dns /);
        assert.doesNotMatch(run, / -(preflight-portscan|interactsh-server|cloud-upload|dashboard|uncover|ai|proxy|source-ip|interface|tls-impersonate|update|update-templates|templates-url|target) /);
        assert.doesNotMatch(run, /https?:\/\//);
      }
    }
  }
});
