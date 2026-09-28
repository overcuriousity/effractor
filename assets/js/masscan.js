// masscan beside nmap (roadmap scanner-readers): its -oX is nmap's XML
// shape, one <host> per open port and no <status>, so nmap's reader takes
// it into the same scan; this file adds the command and masscan's own
// words. Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;

  // ---- reading ----

  // masscan's banner names that are services, as nmap names them; the
  // rest (a page title, a certificate, "ssl") say nothing of the service.
  var NAMES = { ssh: "ssh", http: "http", ftp: "ftp", smtp: "smtp", pop: "pop3", imap: "imap", telnet: "telnet", rdp: "ms-wbt-server", vnc: "vnc", ntp: "ntp", snmp: "snmp", memcached: "memcached" };
  var OWN = {
    "not-nmap": "This is not a masscan result.",
    "normal-output": "This is not masscan's XML; run the command with -oX -.",
    "truncated": "The result is cut off; copy the whole output, from <?xml to </nmaprun>.",
  };

  function read(text) {
    var r = R.read(text, {
      scanner: "masscan",
      serviceName: function (name) { return R.has(NAMES, name) ? NAMES[name] : null; },
    });
    if (r.problem) {
      if (R.has(OWN, r.problem.code)) r.problem.message = OWN[r.problem.code];
      return r;
    }
    // masscan asks which ports are open, and nothing else.
    r.scan.asks = ["ports"];
    // A port it only saw open is named by its number, as nmap's table would.
    r.scan.hosts.forEach(function (h) {
      h.ports.forEach(function (p) {
        var name = p.service ? null : R.portName(p.protocol, p.port);
        if (name) p.service = { name: name, product: null, version: null };
      });
    });
    return r;
  }

  // ---- the command ----

  // nmap's top TCP ports, and all of them; UDP only where it is common.
  var PORTS = [
    { id: "common", name: "Common ports", ports: "21-23,25,53,80,110,111,135,139,143,443,445,993,995,1723,3306,3389,5900,8080" },
    { id: "tcp", name: "All TCP ports", ports: "1-65535" },
    { id: "both", name: "All TCP, common UDP", ports: "1-65535,U:53,U:123,U:161,U:500" },
  ];
  var RATES = [
    { id: "100", name: "Gentle · 100 packets/s" },
    { id: "1000", name: "Steady · 1,000 packets/s" },
    { id: "10000", name: "Fast · 10,000 packets/s", warning: "Fast can overload small routers and set off alarms." },
  ];
  function pick(list, id, otherwise) {
    return list.filter(function (x) { return x.id === id; })[0] || list.filter(function (x) { return x.id === otherwise; })[0];
  }

  // masscan takes addresses only: an address, a CIDR, or a-b.
  function target(part) {
    var cidr = /^([^/]+)\/(\d{1,3})$/.exec(part);
    if (cidr) {
      var b = Ad.bytes(cidr[1]);
      return !!b && Number(cidr[2]) <= b.length * 8;
    }
    var dash = part.split("-");
    if (dash.length === 2) return !!Ad.bytes(dash[0]) && !!Ad.bytes(dash[1]) && Ad.bytes(dash[0]).length === Ad.bytes(dash[1]).length;
    return dash.length === 1 && !!Ad.bytes(part);
  }

  // `choice`: {ports, rate} by id.
  function command(choice, range) {
    choice = choice || {};
    var words = String(range == null ? "" : range).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { problem: "Give the range to scan, such as 10.0.1.0/24." };
    var parts = [];
    words.forEach(function (w) { parts = parts.concat(w.split(",")); });
    if (!parts.every(target)) return { problem: "masscan takes addresses, a-b ranges and CIDR only, such as 10.0.1.0/24." };
    var rate = pick(RATES, choice.rate, "1000");
    return {
      text: "sudo masscan -p" + pick(PORTS, choice.ports, "common").ports + " --rate " + rate.id + " -oX - " + words.join(" "),
      warning: rate.warning || null,
    };
  }

  // ---- the stamp ----

  var STAMP = /^Last masscan import: .*$/m;
  function stampFor(scan, range, date) {
    var r = String(range == null ? "" : range).trim().replace(/\s+/g, " ");
    return { line: "Last masscan import: " + date + ", scan" + (r ? " of " + r : "") + ".", pattern: STAMP };
  }

  var api = { read: read, PORTS: PORTS, RATES: RATES, command: command, stampFor: stampFor };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorMasscan = api;
})();
