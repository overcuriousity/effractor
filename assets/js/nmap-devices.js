// What two of nmap's scripts say of the network's devices (scan workflow
// spec §6.1, §6.2): the router a DHCP answer names, and the interfaces a
// device lists by SNMP. Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;

  // The routers of every DHCP answer, each address once. `scripts`: the
  // scripts nmap ran before the scan, as nmap-read.js reads them.
  function gateways(scripts) {
    var out = [];
    (scripts || []).forEach(function (s) {
      if (!s || s.id !== "broadcast-dhcp-discover" || !s.data) return;
      (s.data.tables || []).forEach(function (answer) {
        // One router is an elem; several are a table of their own
        // (dhcp.lua's read_ip).
        var several = (answer.tables || []).filter(function (t) { return t && t.key === "Router"; })[0];
        var named = several ? several.items || [] : [String((answer.elems || {}).Router || "")];
        named.forEach(function (a) {
          if (Ad.bytes(a) && out.map(Ad.addressKey).indexOf(Ad.addressKey(a)) < 0) out.push(a);
        });
      });
    });
    return out;
  }

  // The prefix length of a netmask, or null where it is none
  // ("255.255.255.0" is 24; "255.0.255.0" is no netmask).
  function prefixOf(netmask) {
    var b = Ad.bytes(netmask);
    if (!b || b.length !== 4) return null;
    var bits = b.map(function (x) { return ("00000000" + x.toString(2)).slice(-8); }).join("");
    return /^1*0*$/.test(bits) ? bits.indexOf("0") < 0 ? 32 : bits.indexOf("0") : null;
  }

  // The interfaces of snmp-interfaces' output that are up and have an
  // address of their own: [{name, address, cidr}], each address once.
  // Loopback, link-local, "this network" and multicast addresses say
  // nothing of a network, and a /32 or /31 is none with hosts. A netmask
  // is IPv4's, so the address is too.
  var NAME_MAX = 60;
  function interfaces(output) {
    var out = [], at = null;
    String(output == null ? "" : output).split("\n").forEach(function (line) {
      var indent = /^ */.exec(line)[0].length, text = line.trim();
      if (!text) return;
      if (indent <= 2) {
        at = { name: text.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, NAME_MAX), up: true, address: null, netmask: null };
        out.push(at);
        return;
      }
      if (!at) return;
      var ip = /^IP address: (\S+)\s+Netmask: (\S+)$/.exec(text);
      if (ip) {
        at.address = ip[1];
        at.netmask = ip[2];
      }
      var status = /^Status: (\S+)/.exec(text);
      if (status) at.up = status[1] === "up";
    });
    var seen = [];
    return out.filter(function (i) {
      var four = i.address && Ad.bytes(i.address) && Ad.bytes(i.address).length === 4;
      var bits = four ? prefixOf(i.netmask) : null;
      if (!i.up || bits == null || bits < 8 || bits > 30) return false;
      if (["0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4"].some(function (c) { return Ad.inCidr(i.address, c); })) return false;
      if (seen.indexOf(Ad.addressKey(i.address)) >= 0) return false;
      seen.push(Ad.addressKey(i.address));
      i.cidr = Ad.networkOf(i.address + "/" + bits);
      return !!i.cidr;
    }).map(function (i) { return { name: i.name, address: i.address, cidr: i.cidr }; });
  }

  var api = { gateways: gateways, prefixOf: prefixOf, interfaces: interfaces };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapDevices = api;
})();
