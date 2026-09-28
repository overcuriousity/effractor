// nuclei templates of effractor's own (nuclei templates spec): the table of
// everything a template can answer, the templates' text written from it,
// what they are pointed at, the command that carries them, and the reading
// of their answers. The traces of the applications are taken from the
// nuclei-templates collection (MIT, ProjectDiscovery; assets/nuclei/README.md),
// rewritten without backslash and single quote: the command holds the text
// between single quotes, where fish reads a backslash and sh does not. Pure.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var C = node ? require("./nuclei-command.js") : window.effractorNucleiCommand;
  var A = node ? require("./architecture-edit.js") : window.effractorArchitectureEdit;

  var TEMPLATES = [
    { id: "effractor-banner", group: "identify", protocol: "tcp", name: "What answers on a port" },
    { id: "effractor-web", group: "identify", protocol: "http", name: "Which web server and application" },
    { id: "effractor-certificate", group: "identify", protocol: "ssl", name: "Which names a certificate bears" },
    { id: "effractor-login", group: "connect", protocol: "http", name: "Where someone logs in" },
    { id: "effractor-points-to", group: "connect", protocol: "dns", name: "What a name points to" },
  ];

  // A version as every answer gives it.
  var VERSION = "([0-9][0-9A-Za-z._-]*)";
  var B = "effractor-banner", W = "effractor-web", L = "effractor-login";
  var ROOT = ["/"];

  function product(name, label, regex, more) {
    return Object.assign({ name: name, template: B, is: "product", product: label, regex: regex }, regex.indexOf(VERSION) >= 0 ? { gives: "version", group: 1 } : {}, more || {});
  }
  // `found`: [part, pattern]; `more`: manages, signs, server, paths.
  function app(name, label, found, more) {
    return Object.assign({ name: name, template: W, is: "application", product: label, paths: ROOT, part: found[0], regex: found[1] }, more || {});
  }
  function version(of, found, more) {
    return Object.assign({ name: of + "-version", template: W, is: "version", of: of, paths: ROOT, part: found[0], regex: found[1], group: 1 }, more || {});
  }
  function sso(name, kind, part, regex) {
    return { name: name, template: L, is: "sso", kind: kind, paths: ROOT, part: part, regex: regex, group: 1 };
  }
  // Where a sign-on is named: in a redirect that leaves the host, in a link.
  // It is known by the URL's host (that name or one under it), by its path,
  // or by its query, never by a word somewhere in the URL. `{X}` in a
  // pattern is what ends the URL: a space, in a link a double quote too.
  function signOn(where, quote) {
    var x = quote + "[:space:]";
    var host = "https?://[^/?#@" + x + "]+";
    var found = where.host ? "https?://(?:[^/?#@" + x + "]*[.])?" + where.host + "(?:[:/?#][^" + x + "]*)?"
      : where.path ? host + "(?:/[^?#" + x + "]*)?" + where.path + "[^" + x + "]*"
        : host + "[^?#" + x + "]*[?](?:[^#" + x + "]*&)?(?:" + where.query + ")[^" + x + "]*";
    return found.split("{X}").join(x);
  }
  function sent(where) {
    return ["(?im)^location:[[:space:]]*(" + signOn(where, "") + ")[[:space:]]*$"];
  }
  function linked(where) {
    return ["(?i)(?:href|action)=\"(" + signOn(where, "\"") + ")\""];
  }
  var KEYCLOAK = { path: "/realms/[^/{X}]+/protocol/(?:openid-connect|saml)" }, ADFS = { path: "/adfs/(?:ls|oauth2)" };
  var ENTRA = { host: "login[.]microsoftonline[.]com" }, OKTA = { host: "okta[.]com" }, GOOGLE = { host: "accounts[.]google[.]com" };

  var ANSWERS = [
    // ---- what answers on a port (spec §5.1), spelled as nmap spells it ----
    product("openssh", "OpenSSH", "SSH-[0-9.]+-OpenSSH_" + VERSION),
    product("dropbear", "Dropbear sshd", "SSH-[0-9.]+-dropbear_" + VERSION),
    product("vsftpd", "vsftpd", "220[ -][(]?vsFTPd " + VERSION),
    product("proftpd", "ProFTPD", "220[ -]ProFTPD " + VERSION),
    product("pure-ftpd", "Pure-FTPd", "220-+ Welcome to Pure-FTPd"),
    product("postfix", "Postfix smtpd", "220 [^ ]+ ESMTP Postfix"),
    product("exim", "Exim smtpd", "220 [^ ]+ ESMTP Exim " + VERSION),
    product("sendmail", "Sendmail", "ESMTP Sendmail " + VERSION),
    product("exchange-smtp", "Microsoft Exchange smtpd", "Microsoft ESMTP MAIL Service"),
    product("dovecot", "Dovecot", "[*+] ?OK.*Dovecot"),
    product("courier", "Courier", "[*+] ?OK.*Courier"),
    product("cyrus", "Cyrus", "[*+] ?OK.*Cyrus (?:IMAP|POP3)[^ ]* v?" + VERSION),
    product("mariadb", "MariaDB", "([0-9]+[.][0-9]+[.][0-9]+)-MariaDB", { gives: "version", group: 1 }),
    // MariaDB's handshake names the same plugins: where both answer, it is MariaDB.
    product("mysql", "MySQL", "(?s)([0-9]+[.][0-9]+[.][0-9]+)[^[:cntrl:]]*[[:cntrl:]].*(?:mysql_native_password|caching_sha2_password)", { gives: "version", group: 1, unless: "mariadb" }),
    { name: "banner", template: B, is: "said", regex: "^[ -~]{4,120}" },

    // ---- the web server and the page's own words (spec §5.2) ----
    { name: "server", template: W, is: "server", paths: ROOT, kval: "server" },
    { name: "title", template: W, is: "said", paths: ROOT, part: "body", regex: "(?i)<title>([^<]{1,120})</title>", group: 1 },

    // ---- the web application (spec §5.3): monitoring and data ----
    app("grafana", "Grafana", ["body", "window[.]grafanaBootData"]),
    version("grafana", ["body", "\"version\":\"" + VERSION + "\""]),
    app("kibana", "Kibana", ["header", "(?i)kbn-name:"]),
    version("kibana", ["header", "(?i)kbn-version:[[:space:]]*" + VERSION]),
    app("elasticsearch", "Elasticsearch", ["body", "You Know, for Search"]),
    version("elasticsearch", ["body", "\"number\"[[:space:]]*:[[:space:]]*\"" + VERSION + "\""]),
    app("zabbix", "Zabbix", ["body", "Zabbix SIA|zbxCallPostScripts"]),
    app("prtg", "PRTG Network Monitor", ["header", "(?i)server:[[:space:]]*PRTG"], { server: "prtg" }),
    version("prtg", ["header", "(?i)server:[[:space:]]*PRTG/" + VERSION]),
    app("splunk", "Splunk", ["header", "(?i)server:[[:space:]]*Splunkd"], { server: "splunkd" }),
    version("splunk", ["body", "\"VERSION_LABEL\":[[:space:]]*\"" + VERSION + "\""]),
    // ---- development ----
    // Its own page says so; a link to about.gitlab.com is on many a start page.
    app("gitlab", "GitLab", ["body", "content=\"GitLab\" property=\"og:site_name\"|property=\"og:site_name\" content=\"GitLab\"|gon[.]gitlab_url"]),
    app("gitea", "Gitea", ["body", "Powered by Gitea"]),
    version("gitea", ["body", "Gitea Version:[[:space:]]*" + VERSION]),
    app("jenkins", "Jenkins", ["header", "(?i)x-jenkins:"]),
    version("jenkins", ["header", "(?i)x-jenkins:[[:space:]]*" + VERSION]),
    app("sonarqube", "SonarQube", ["body", "/css/sonar[.]css"]),
    version("sonarqube", ["body", "/css/sonar[.]css[?]v=" + VERSION]),
    app("nexus-repository", "Nexus Repository", ["body", "nexus-coreui-bundle|Sonatype Nexus Repository"]),
    version("nexus-repository", ["body", "nexus-coreui-bundle[^\"]*_v=" + VERSION]),
    app("harbor", "Harbor", ["body", "<harbor-app>"]),
    version("harbor", ["body", "\"harbor_version\":[[:space:]]*\"v?" + VERSION + "\""], { paths: ["/api/v2.0/systeminfo"] }),
    // ---- collaboration and mail ----
    app("confluence", "Confluence", ["body", "confluence-base-url"]),
    version("confluence", ["body", "<meta name=\"ajs-version-number\" content=\"" + VERSION + "\""]),
    app("jira", "Jira", ["body", "com[.]atlassian[.]jira"]),
    version("jira", ["body", "title=\"JiraVersion\" value=\"" + VERSION]),
    app("bitbucket", "Bitbucket", ["body", "com[.]atlassian[.]bitbucket[.]server|bitbucket-webpack-INTERNAL"]),
    version("bitbucket", ["body", "id=\"product-version\"[^>]*>[[:space:]]*v?" + VERSION]),
    app("nextcloud", "Nextcloud", ["body", "var nc_lastLogin|var nc_pageLoad"]),
    version("nextcloud", ["body", "\"version\":\"" + VERSION + "\""]),
    // /wp-content/ is in every page that shows a picture of another's blog.
    app("wordpress", "WordPress", ["body", "name=\"generator\" content=\"WordPress|/wp-includes/"]),
    version("wordpress", ["body", "name=\"generator\" content=\"WordPress " + VERSION + "\""]),
    app("roundcube", "Roundcube Webmail", ["body", "\"rcversion\":"]),
    // 10611 is 1.6.11.
    version("roundcube", ["body", "\"rcversion\":([0-9]{5,6})"], { decode: "rcversion" }),
    app("zimbra", "Zimbra", ["header", "(?i)set-cookie:[[:space:]]*ZM_(?:LOGIN_CSRF|TEST)"]),
    version("zimbra", ["body", "CLIENT_VERSION\"[^\"]*defaultValue:\"" + VERSION], { paths: ["/js/zimbraMail/share/model/ZmSettings.js"] }),
    app("outlook-web", "Outlook on the web", ["header", "(?i)x-owa-version:"], { paths: ["/", "/owa/auth/logon.aspx"] }),
    version("outlook-web", ["header", "(?i)x-owa-version:[[:space:]]*" + VERSION], { paths: ["/", "/owa/auth/logon.aspx"] }),
    app("sharepoint", "SharePoint", ["header", "(?i)microsoftsharepointteamservices:"]),
    version("sharepoint", ["header", "(?i)microsoftsharepointteamservices:[[:space:]]*" + VERSION]),
    // ---- identity ----
    app("keycloak", "Keycloak", ["body", "kc-form-buttons|<span>Keycloak</span>"], { signs: true }),
    app("adfs", "AD FS", ["body", "/adfs/portal/css/style[.]css"], { signs: true, paths: ["/adfs/ls/idpinitiatedsignon.aspx"] }),
    // ---- remote access and edge ----
    app("citrix-gateway", "Citrix Gateway", ["header", "(?i)set-cookie:[[:space:]]*(?:NSC_|citrix_ns_id)"], { paths: ["/", "/vpn/index.html"] }),
    app("globalprotect", "GlobalProtect", ["body", "(?s)GlobalProtect Portal.*global-protect|global-protect.*GlobalProtect Portal"], { paths: ["/global-protect/login.esp"] }),
    // On the machine itself: a link to another machine's is no trace.
    app("ivanti-connect-secure", "Ivanti Connect Secure", ["body", "(?i)(?:href|action|src)=\"/dana-na/"]),
    app("cisco-asa", "Cisco Secure Firewall ASA", ["body", "/[+]CSCOU[+]/portal[.]css"], { paths: ["/", "/+CSCOE+/logon.html"] }),
    app("guacamole", "Apache Guacamole", ["body", "guacamole-logo"]),
    app("fortigate", "FortiGate", ["body", "top[.]location=\"/remote/login\""], { manages: true }),
    app("big-ip", "F5 BIG-IP", ["body", "(?s)Configuration Utility.*F5 Networks|F5 Networks.*Configuration Utility"], { manages: true, paths: ["/tmui/login.jsp"] }),
    // Its Server header names the maker or the machine (SMA), which has the version.
    app("sonicwall", "SonicWall", ["header", "(?i)server:[[:space:]]*(?:SonicWALL|SMA/[0-9])"], { manages: true, server: ["sonicwall", "sma"], paths: ["/", "/cgi-bin/welcome"] }),
    version("sonicwall", ["header", "(?i)server:[[:space:]]*SMA/" + VERSION], { paths: ["/", "/cgi-bin/welcome"] }),
    // ---- machines and their management ----
    app("vcenter", "VMware vCenter", ["body", "content=\"VMware vCenter"], { manages: true }),
    app("esxi", "VMware ESXi", ["body", "(?i)esxUiApp|content=\"VMware ESXi"], { manages: true }),
    app("proxmox-ve", "Proxmox VE", ["body", "PVEAuthCookie"], { manages: true }),
    version("proxmox-ve", ["body", "pvemanagerlib[.]js[?]ver=" + VERSION]),
    app("hpe-ilo", "HPE iLO", ["body", "(?s)<RIMP>.*<HSI>"], { manages: true, paths: ["/xmldata?item=all"] }),
    version("hpe-ilo", ["body", "<FWRI>" + VERSION + "</FWRI>"], { paths: ["/xmldata?item=all"] }),
    app("dell-idrac", "Dell iDRAC", ["body", "<idrac-start-screen|thisIDRACText"], { manages: true, paths: ["/", "/login.html"] }),
    version("dell-idrac", ["body", "\"FwVer\"[[:space:]]*:[[:space:]]*\"" + VERSION + "\""], { paths: ["/sysmgmt/2015/bmc/info"] }),
    app("synology-dsm", "Synology DSM", ["body", "content=\"Synology DiskStation|class=\"logo-synology\""], { manages: true }),
    app("pfsense", "pfSense", ["body", "(?s)pfSense - Login.*Netgate|Netgate.*pfSense - Login"], { manages: true }),
    // The title and the login field: the title alone names nothing.
    app("opnsense", "OPNsense", ["body", "(?s)[|] OPNsense</title>.*usernamefld"], { manages: true }),
    app("fritzbox", "FRITZ!Box", ["body", "<e:BoxInfo"], { manages: true, paths: ["/juis_boxinfo.xml"] }),
    app("mikrotik-routeros", "MikroTik RouterOS", ["body", "RouterOS router configuration page"], { manages: true, server: "mikrotik" }),
    version("mikrotik-routeros", ["body", "RouterOS v?" + VERSION]),
    app("webmin", "Webmin", ["header", "(?i)server:[[:space:]]*MiniServ"], { manages: true, server: "miniserv" }),
    version("webmin", ["header", "(?i)server:[[:space:]]*MiniServ/" + VERSION]),
    app("portainer", "Portainer", ["body", "ng-app=\"portainer|portainer[.]auth"], { manages: true }),
    // ---- middleware and stores ----
    app("tomcat", "Apache Tomcat", ["body", "(?s)Apache Tomcat.*/manager/html"]),
    version("tomcat", ["body", "Apache Tomcat/" + VERSION]),
    app("weblogic", "Oracle WebLogic Server", ["body", "WebLogic Server Version:"], { paths: ["/console/login/LoginForm.jsp"] }),
    version("weblogic", ["body", "WebLogic Server Version: " + VERSION], { paths: ["/console/login/LoginForm.jsp"] }),
    app("sap-netweaver", "SAP NetWeaver", ["header", "(?i)sap-server:"]),
    app("phpmyadmin", "phpMyAdmin", ["body", "name=\"pma_username|phpMyAdmin[.]css[.]php"], { paths: ["/", "/phpmyadmin/"] }),
    version("phpmyadmin", ["body", "PMA_VERSION:\"" + VERSION], { paths: ["/", "/phpmyadmin/"] }),
    app("vault", "HashiCorp Vault", ["body", "vault/config/environment"]),
    version("vault", ["body", "\"version\":[[:space:]]*\"" + VERSION + "\""], { paths: ["/v1/sys/health"] }),
    // Its root page sends on to /login.aspx, which is followed.
    app("veeam", "Veeam Backup Enterprise Manager", ["body", "(?s)Veeam Backup Enterprise Manager.*login[.]bundle[.]js"]),
    version("veeam", ["body", "login[.]bundle[.]js[?]v=" + VERSION]),

    // ---- the names a certificate bears (spec §5.5) ----
    { name: "names", template: "effractor-certificate", is: "names", json: ".subject_an[]" },
    { name: "subject", template: "effractor-certificate", is: "names", json: ".subject_cn" },

    // ---- logins and where they are sent (spec §6.1, §6.2) ----
    { name: "login", template: L, is: "login", paths: ROOT, part: "body", regex: "(?i)<input[^>]*type=[\"]?password" },
    sso("sso-keycloak", "Keycloak", "header", sent(KEYCLOAK)),
    sso("sso-adfs", "AD FS", "header", sent(ADFS)),
    sso("sso-entra", "Microsoft Entra ID", "header", sent(ENTRA)),
    sso("sso-okta", "Okta", "header", sent(OKTA)),
    sso("sso-google", "Google sign-in", "header", sent(GOOGLE)),
    sso("sso-saml", null, "header", sent({ query: "SAMLRequest=" })),
    // Both parameters, whichever comes first.
    sso("sso-oidc", null, "header", sent({ query: "response_type=[^&#{X}]*&(?:[^#{X}]*&)?client_id=|client_id=[^&#{X}]*&(?:[^#{X}]*&)?response_type=" })),
    // The same, as a link or a form on the login page.
    sso("sso-keycloak-link", "Keycloak", "body", linked(KEYCLOAK)),
    sso("sso-adfs-link", "AD FS", "body", linked(ADFS)),
    sso("sso-entra-link", "Microsoft Entra ID", "body", linked(ENTRA)),
    sso("sso-okta-link", "Okta", "body", linked(OKTA)),
    sso("sso-google-link", "Google sign-in", "body", linked(GOOGLE)),

    // ---- what a name points to (spec §6.4) ----
    { name: "address", template: "effractor-points-to", is: "address", regex: "IN[[:space:]]+A[[:space:]]+([0-9.]+)", group: 1 },
    { name: "alias", template: "effractor-points-to", is: "alias", regex: "IN[[:space:]]+CNAME[[:space:]]+([0-9A-Za-z._-]+)", group: 1 },
  ];

  var byName = Object.create(null);
  ANSWERS.forEach(function (a) { byName[a.name] = a; });
  function answer(name) {
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(byName, name) ? byName[name] : null;
  }
  function template(id) {
    return TEMPLATES.filter(function (t) { return t.id === id; })[0] || null;
  }
  function patterns(a) {
    return a.regex == null ? [] : [].concat(a.regex);
  }

  // ---- the templates' text (spec §2) ----

  // A value between double quotes; one that holds a double quote as a
  // folded block, which needs no escape.
  function value(indent, text) {
    return text.indexOf('"') < 0 ? ' "' + text + '"' : " >-\n" + indent + "  " + text;
  }
  function extractor(a) {
    var type = a.kval ? "kval" : a.json ? "json" : "regex";
    var out = ["      - type: " + type, "        name: " + a.name];
    if (a.part) out.push("        part: " + a.part);
    if (a.group != null) out.push("        group: " + a.group);
    out.push("        " + type + ":");
    (type === "regex" ? patterns(a) : [a.kval || a.json]).forEach(function (p) {
      out.push("          -" + value("          ", p));
    });
    return out;
  }
  function text(id) {
    var t = template(id);
    if (!t) return null;
    var mine = ANSWERS.filter(function (a) { return a.template === id; });
    var out = ["id: " + t.id, "info:", "  name: " + t.name, "  author: effractor", "  severity: info", t.protocol + ":"];
    function extractors(list) {
      out.push("    extractors:");
      list.forEach(function (a) { out = out.concat(extractor(a)); });
    }
    if (t.protocol === "tcp") {
      // One line feed: what speaks first has spoken, what waits answers.
      out.push("  - host:", '      - "{{Hostname}}"', "    inputs:", '      - data: "0a"', "        type: hex", "    read-size: 256");
      extractors(mine);
    } else if (t.protocol === "ssl") {
      out.push('  - address: "{{Host}}:{{Port}}"');
      extractors(mine);
    } else if (t.protocol === "dns") {
      out.push('  - name: "{{FQDN}}"', "    type: A", "    class: inet", "    recursion: true");
      extractors(mine);
    } else {
      // One request per path, each with the answers found there; redirects
      // are followed from the root page only, and only on the same host.
      var paths = [];
      mine.forEach(function (a) {
        a.paths.forEach(function (p) { if (paths.indexOf(p) < 0) paths.push(p); });
      });
      paths.forEach(function (p) {
        out.push("  - method: GET", "    path:", '      - "{{BaseURL}}' + p + '"');
        if (p === "/") out.push("    host-redirects: true", "    max-redirects: 3");
        extractors(mine.filter(function (a) { return a.paths.indexOf(p) >= 0; }));
      });
    }
    return out.join("\n") + "\n";
  }

  // The answer's patterns as JavaScript reads them: Go's classes and its
  // leading flags written JavaScript's way. For tests; nuclei reads the
  // templates.
  function pattern(a) {
    return patterns(a).map(function (p) {
      var flags = "";
      var m = /^\(\?([ims]+)\)/.exec(p);
      if (m) {
        flags = m[1];
        p = p.slice(m[0].length);
      }
      return new RegExp(p.replace(/\[\[:space:\]\]/g, "\\s").replace(/\[\^([^\]]*)\[:space:\]\]/g, "[^$1\\s]").replace(/\[\[:cntrl:\]\]/g, "[\\x00-\\x1f]").replace(/\[\^\[:cntrl:\]\]/g, "[^\\x00-\\x1f]"), flags);
    });
  }

  // ---- what they are pointed at (spec §3.1, §3.2) ----

  // Ports where one of the templates can get an answer.
  var USUAL = {
    speaks: [21, 22, 25, 110, 143, 587, 2222, 3306],
    mail: [465, 993, 995],
    web: [80, 443, 3000, 4443, 5000, 5601, 7001, 8000, 8006, 8008, 8080, 8081, 8088, 8443, 8888, 9000, 9090, 9200, 9443, 10000, 10443],
  };
  var USUAL_PORTS = USUAL.speaks.concat(USUAL.mail, USUAL.web).sort(function (a, b) { return a - b; });
  // The addresses of a range nobody has drawn, at most.
  var MOST = 1024;
  var GROUPS = ["identify", "connect"];
  // The blocks of nuclei's Adjust that apply to these templates.
  var ADJUST = ["addresses", "speed", "patience", "errors"];
  // As nuclei-command.js: nothing a shell reads as its own.
  var RANGE_CHARS = /^[0-9A-Za-z.:\/\-_~%?=&@\[\]+]+$/;
  var RANGE_PROBLEM = "The range may hold only addresses, names, CIDR and URLs, such as 10.0.1.0/24 or https://app.lab:8443.";

  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function links(doc, kind) {
    return Object.keys(doc.associations || {}).map(function (k) { return doc.associations[k]; }).filter(function (a) { return a.kind === kind; });
  }
  // An address as a target has it: an IPv6 one between brackets.
  function written(address) {
    return address.indexOf(":") >= 0 ? "[" + address + "]" : address;
  }
  // The addresses of an IPv4 range, without its network and broadcast
  // address where it has them; null for any other word.
  function expand(cidr) {
    var m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr);
    var b = m ? Ad.bytes(m[1]) : null, bits = m ? Number(m[2]) : 0;
    if (!b || b.length !== 4 || bits > 32) return null;
    var size = Math.pow(2, 32 - bits), edges = bits < 31 ? 1 : 0;
    if (size - 2 * edges > MOST) return { tooMany: true };
    var base = b[0] * 16777216 + b[1] * 65536 + b[2] * 256 + b[3];
    base -= base % size;
    var out = [];
    for (var i = edges; i < size - edges; i++) {
      var n = base + i;
      out.push([Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join("."));
    }
    return { list: out };
  }
  function count(k, one) {
    return k + " " + one + (k === 1 ? "" : "s");
  }
  // An address as nuclei reads one. What it cannot read (an octet with a
  // leading zero, a zone) it would look up as a name.
  function address(text) {
    var s = String(text);
    if (!Ad.bytes(s)) return false;
    return s.indexOf(":") >= 0 || /^(?:0|[1-9][0-9]{0,2})(?:[.](?:0|[1-9][0-9]{0,2})){3}$/.test(s);
  }
  // Whether a word of the range names a port, as C.target reads one.
  function portTyped(word) {
    var s = String(word).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[\/?#]/)[0];
    s = s.slice(s.lastIndexOf("@") + 1);
    var v6 = /^\[[^\]]*\](.*)$/.exec(s);
    return v6 ? v6[1] !== "" : s.split(":").length === 2;
  }

  function targets(doc, range, groups) {
    var words = String(range == null ? "" : range).trim().split(/[\s,]+/).filter(Boolean);
    if (!words.length) return { problem: "Give what to scan, such as 10.0.1.0/24." };
    if (!words.every(function (w) { return RANGE_CHARS.test(w) && w[0] !== "-"; })) {
      return { problem: RANGE_PROBLEM };
    }
    // A word is an address, a range of them, or a name, with a port or in
    // a URL; anything else nuclei would look up as a name, at public
    // resolvers.
    var nets = [], singles = [], named = [], typed = [], odd = false;
    words.forEach(function (w) {
      var cidr = /^([^\/]+)\/(\d{1,3})$/.exec(w);
      if (cidr) {
        if (address(cidr[1]) && Number(cidr[2]) <= (cidr[1].indexOf(":") >= 0 ? 128 : 32)) nets.push(w);
        else odd = true;
        return;
      }
      var t = C.target(w), host = (t.host || "").toLowerCase();
      if (address(host)) singles.push(host);
      else if (A.isName(host)) named.push(host);
      else odd = true;
      if (portTyped(w) && !t.port) odd = true;
      // A port typed by hand is asked, as what is typed by hand is.
      if (t.port && USUAL_PORTS.indexOf(t.port) < 0) typed.push((address(host) ? written(host) : host) + ":" + t.port);
    });
    if (odd) return { problem: RANGE_PROBLEM };
    var cover = nets.concat(singles).join(" ");
    var hosts = [], extra = [], names = [], drawn = 0, services = 0;
    var hostOf = Object.create(null);
    links(doc, "hosts").forEach(function (a) {
      if (doc.entities[a.to] && doc.entities[a.to].kind === "service") hostOf[a.to] = a.from;
    });
    Object.keys(doc.entities || {}).forEach(function (id) {
      var e = doc.entities[id];
      if (e.kind !== "host") return;
      var at = null, called = null;
      var found = cover ? (e.addresses || []).filter(function (a) { return address(a) && Ad.covers(cover, a); })[0] : null;
      var own = [String(e.label).trim().toLowerCase()].concat(e.names || []).filter(A.isName);
      called = own.filter(function (n) { return named.indexOf(n) >= 0; })[0];
      if (!found && !called) return;
      at = found ? written(found) : called;
      if (hosts.indexOf(at) >= 0) return;
      hosts.push(at);
      drawn++;
      Object.keys(hostOf).forEach(function (s) { if (hostOf[s] === id) services++; });
      Object.keys(doc.flows || {}).forEach(function (k) {
        var f = doc.flows[k], m = /^tcp\/(\d{1,5})$/.exec(f.protocol || "");
        if (!m || hostOf[f.target] !== id) return;
        var port = Number(m[1]);
        if (port < 1 || port > 65535 || USUAL_PORTS.indexOf(port) >= 0 || extra.indexOf(at + ":" + port) >= 0) return;
        extra.push(at + ":" + port);
      });
      (e.names || []).forEach(function (n) { if (A.isName(n) && names.indexOf(n) < 0) names.push(n); });
    });
    // What was typed by hand and is not drawn is asked too.
    singles.forEach(function (a) { if (hosts.indexOf(written(a)) < 0) hosts.push(written(a)); });
    named.forEach(function (n) { if (hosts.indexOf(n) < 0) hosts.push(n); });
    var notes = [];
    if (!drawn && nets.length) {
      for (var i = 0; i < nets.length; i++) {
        var x = expand(nets[i]);
        if (!x) return { problem: "Nothing is drawn in " + nets[i] + " yet; give its hosts, or draw them first with nmap." };
        if (x.tooMany || hosts.length + x.list.length > MOST) return { problem: "Give a smaller range, or draw the hosts first with nmap." };
        x.list.forEach(function (a) { if (hosts.indexOf(a) < 0) hosts.push(a); });
      }
      notes.push("Nothing is drawn in " + nets.join(", ") + " yet. nmap finds hosts faster.");
    }
    if (!hosts.length) return { problem: "Nothing is drawn in " + words.join(", ") + " yet; give its hosts, or draw them first with nmap." };
    var connect = (groups || []).indexOf("connect") >= 0;
    if (!connect) names = [];
    var ofDrawing = extra.length;
    typed.forEach(function (x) { if (extra.indexOf(x) < 0) extra.push(x); });
    var more = [[ofDrawing, "drawn one"], [extra.length - ofDrawing, "typed one"]].filter(function (x) { return x[0]; }).map(function (x) { return count(x[0], x[1]); });
    var said = (drawn ? count(drawn, "drawn host") : count(hosts.length, "host")) + ", " + USUAL_PORTS.length + " usual ports"
      + (more.length === 2 ? ", " : more.length ? " and " : "") + more.join(" and ") + (names.length ? ", " + count(names.length, "name") : "") + ".";
    return { hosts: hosts, ports: USUAL_PORTS.slice(), extra: extra, names: names, drawn: drawn, services: services, said: said, notes: notes, resolves: hosts.some(A.isName) };
  }

  // ---- the command (spec §3) ----

  var DIR = "effractor-templates";
  // nuclei asks public resolvers unless given a list: this machine's own.
  var RESOLVERS = "awk '/^nameserver/ {print $2}' /etc/resolv.conf > resolvers.txt";
  var ALWAYS = "-jsonl -silent -omit-raw -omit-template -no-interactsh -disable-update-check";

  function adjusted(adjust) {
    var args = [], warnings = [];
    C.BLOCKS.forEach(function (b) {
      if (ADJUST.indexOf(b.id) < 0) return;
      var id = adjust && has(adjust, b.id) ? adjust[b.id] : C.DEFAULTS[b.id];
      var x = b.choices.filter(function (c) { return c.id === id; })[0] || b.choices[0];
      if (x.args) args.push(x.args);
      if (x.warning) warnings.push(x.warning);
    });
    return { args: args, warnings: warnings };
  }

  // Writes the ticked groups' templates and the targets, then runs nuclei:
  // once against the ports, and once for the names, which are asked of a
  // resolver and of nothing else. Returns {text, shown, said, note?,
  // warning?} or {problem}.
  function command(groups, adjust, range, doc) {
    var chosen = GROUPS.filter(function (g) { return (groups || []).indexOf(g) >= 0; });
    if (!chosen.length) return { problem: "Choose what nuclei should look for." };
    var t = targets(doc, range, chosen);
    if (t.problem) return { problem: t.problem };
    // Logins are asked of what is drawn: without a service there is nothing to ask.
    if (chosen.length === 1 && chosen[0] === "connect" && t.drawn && !t.services) return { problem: "Nothing drawn to ask yet; run What is there first." };
    var files = TEMPLATES.filter(function (x) { return chosen.indexOf(x.group) >= 0; });
    var ports = files.filter(function (x) { return x.protocol !== "dns"; });
    var dns = t.names.length ? files.filter(function (x) { return x.protocol === "dns"; }) : [];
    function paths(list) {
      return list.map(function (x) { return DIR + "/" + x.id + ".yaml"; }).join(",");
    }
    // `short`: the same with each template's text left out, to be shown.
    var parts = ["mkdir -p " + DIR], short = ["mkdir -p " + DIR];
    ports.concat(dns).forEach(function (x) {
      var body = text(x.id).replace(/\n$/, "");
      parts.push("echo '" + body + "' > " + DIR + "/" + x.id + ".yaml");
      short.push("echo '… " + body.split("\n").length + " lines …' > " + DIR + "/" + x.id + ".yaml");
    });
    function both(part) {
      parts.push(part);
      short.push(part);
    }
    var prints = t.extra.map(function (x) { return '; print "' + x + '"'; }).join("");
    both("awk 'BEGIN { n = split(\"" + t.hosts.join(" ") + "\", h, \" \"); m = split(\"" + t.ports.join(" ") + "\", p, \" \"); for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) print h[i] \":\" p[j]" + prints + " }' > targets.txt");
    if (t.resolves || dns.length) both(RESOLVERS);
    var a = adjusted(adjust);
    var more = (a.args.length ? " " + a.args.join(" ") : "") + " " + ALWAYS;
    both("nuclei -t " + paths(ports) + " -list targets.txt " + (t.resolves ? "-resolvers resolvers.txt" : "-exclude-type dns") + more);
    if (dns.length) {
      both("echo '" + t.names.join("\n") + "' > names.txt");
      both("nuclei -t " + paths(dns) + " -list names.txt -resolvers resolvers.txt" + more);
    }
    var out = { text: parts.join("; "), shown: short.join("; "), said: t.said };
    var notes = t.notes.slice();
    if (t.resolves || dns.length) notes.push("Names are asked of this machine's resolvers; nuclei's own are public ones.");
    if (notes.length) out.note = notes.join(" ");
    if (a.warnings.length) out.warning = a.warnings.join(" ");
    return out;
  }

  var api = { TEMPLATES: TEMPLATES, ANSWERS: ANSWERS, VERSION: VERSION, answer: answer, text: text, pattern: pattern, USUAL_PORTS: USUAL_PORTS, GROUPS: GROUPS, ADJUST: ADJUST, targets: targets, command: command };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNucleiTemplates = api;
})();
