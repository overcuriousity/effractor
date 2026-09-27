// nmap's addresses (the nmap import design, in history; nmap recipes spec):
// IPv4 and IPv6 as bytes, one spelling per address, CIDR membership. Pure.
(function () {
  var node = typeof module !== "undefined";

  // ---- addresses ----

  function bytes(ip) {
    var s = String(ip);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
      var four = s.split(".").map(Number);
      return four.every(function (n) { return n <= 255; }) ? four : null;
    }
    if (!/^[0-9A-Fa-f:]+$/.test(s) || s.indexOf(":") < 0) return null;
    var halves = s.split("::");
    if (halves.length > 2) return null;
    function groups(part) {
      return part ? part.split(":") : [];
    }
    var head = groups(halves[0]), tail = halves.length === 2 ? groups(halves[1]) : [];
    var fill = 8 - head.length - tail.length;
    if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
    var all = head.concat(Array(halves.length === 2 ? fill : 0).fill("0"), tail);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(all[i])) return null;
      var n = parseInt(all[i], 16);
      out.push(n >> 8, n & 255);
    }
    return out;
  }

  // One spelling per address, so fd00::5 and fd00:0::5 are the same host.
  function addressKey(ip) {
    var b = bytes(ip);
    return b ? b.join(".") : String(ip);
  }

  function inCidr(ip, cidr) {
    var parts = String(cidr).split("/");
    if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) return false;
    var a = bytes(ip), net = bytes(parts[0]), bits = Number(parts[1]);
    if (!a || !net || a.length !== net.length || bits > a.length * 8) return false;
    for (var i = 0; i < a.length; i++) {
      var take = Math.max(0, Math.min(8, bits - i * 8));
      var mask = take ? (0xff << (8 - take)) & 0xff : 0;
      if ((a[i] & mask) !== (net[i] & mask)) return false;
    }
    return true;
  }

  // The network a CIDR range names, written from its own address:
  // 192.168.2.138/24 is 192.168.2.0/24.
  function networkOf(cidr) {
    var parts = String(cidr).split("/");
    var b = bytes(parts[0]), bits = Number(parts[1]);
    if (!b || parts.length !== 2 || !/^\d{1,3}$/.test(parts[1]) || bits > b.length * 8) return null;
    var masked = b.map(function (x, i) {
      var take = Math.max(0, Math.min(8, bits - i * 8));
      return take ? x & ((0xff << (8 - take)) & 0xff) : 0;
    });
    if (masked.length === 4) return masked.join(".") + "/" + bits;
    var groups = [];
    for (var i = 0; i < 16; i += 2) groups.push(((masked[i] << 8) | masked[i + 1]).toString(16));
    // The longest run of zero groups, if two or more, becomes "::".
    var best = -1, len = 0;
    for (var j = 0; j < 8; j++) {
      var k = j;
      while (k < 8 && groups[k] === "0") k++;
      if (k - j > len && k - j > 1) { best = j; len = k - j; }
      if (k > j) j = k;
    }
    var text = best < 0 ? groups.join(":") : groups.slice(0, best).join(":") + "::" + groups.slice(best + len).join(":");
    return text + "/" + bits;
  }
  // Private space (nmap recipes spec §4.2): a route is cut before the first
  // hop outside it.
  var PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "127.0.0.0/8", "fc00::/7", "fe80::/10", "::1/128"];
  function isPrivate(ip) {
    return !!bytes(ip) && PRIVATE.some(function (c) { return inCidr(ip, c); });
  }

  // Whether a scan of `targets` (nmap's own words: addresses, CIDR, octet
  // ranges such as 10.0.1-5.1-254) looked at `ip` (nmap recipes spec §5.1).
  // A name covers nothing here: which address it meant is not known.
  function octets(word) {
    var parts = String(word).split(".");
    if (parts.length !== 4) return null;
    var out = [];
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}(-\d{1,3})?(,\d{1,3}(-\d{1,3})?)*$/.test(parts[i])) return null;
      out.push(parts[i].split(",").map(function (r) {
        var b = r.split("-").map(Number);
        return [b[0], b.length > 1 ? b[1] : b[0]];
      }));
    }
    return out;
  }
  function covers(targets, ip) {
    var b = bytes(ip);
    if (!b) return false;
    return String(targets == null ? "" : targets).trim().split(/\s+/).filter(Boolean).some(function (word) {
      var w = word.indexOf(":") >= 0 ? word.replace(/%[^\/]*/, "") : word;
      if (w.indexOf("/") >= 0) return inCidr(ip, w);
      if (bytes(w)) return addressKey(w) === addressKey(ip);
      var o = b.length === 4 ? octets(w) : null;
      return !!o && o.every(function (ranges, i) {
        return ranges.some(function (r) { return b[i] >= r[0] && b[i] <= r[1]; });
      });
    });
  }

  var api = { covers: covers, isPrivate: isPrivate, bytes: bytes, addressKey: addressKey, inCidr: inCidr, networkOf: networkOf };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapAddress = api;
})();
