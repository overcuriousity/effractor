// nuclei templates of effractor's own (nuclei templates spec): the table of
// everything a template can answer, the templates' text written from it,
// what they are pointed at, the command that carries them, and the reading
// of their answers. The traces of the applications are taken from the
// nuclei-templates collection (MIT, ProjectDiscovery; assets/nuclei/README.md),
// rewritten without backslash and single quote: the command holds the text
// between single quotes, where fish reads a backslash and sh does not. Pure.
(function () {
  var node = typeof module !== "undefined";

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
  function sent(to) {
    return ["(?i)location:[[:space:]]*(https?://[^[:space:]]*" + to + "[^[:space:]]*)"];
  }
  function linked(to) {
    return ["(?i)(?:href|action)=\"(https?://[^\"[:space:]]*" + to + "[^\"[:space:]]*)\""];
  }

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
    app("gitlab", "GitLab", ["body", "about[.]gitlab[.]com"]),
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
    app("wordpress", "WordPress", ["body", "name=\"generator\" content=\"WordPress|/wp-content/"]),
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
    app("ivanti-connect-secure", "Ivanti Connect Secure", ["body", "/dana-na/"]),
    app("cisco-asa", "Cisco Secure Firewall ASA", ["body", "/[+]CSCOU[+]/portal[.]css"], { paths: ["/", "/+CSCOE+/logon.html"] }),
    app("guacamole", "Apache Guacamole", ["body", "guacamole-logo"]),
    app("fortigate", "FortiGate", ["body", "top[.]location=\"/remote/login\""], { manages: true }),
    app("big-ip", "F5 BIG-IP", ["body", "(?s)Configuration Utility.*F5 Networks|F5 Networks.*Configuration Utility"], { manages: true, paths: ["/tmui/login.jsp"] }),
    app("sonicwall", "SonicWall", ["header", "(?i)server:[[:space:]]*SonicWALL"], { manages: true, server: "sonicwall", paths: ["/", "/cgi-bin/welcome"] }),
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
    sso("sso-keycloak", "Keycloak", "header", sent("/realms/[^/[:space:]]+/protocol/(?:openid-connect|saml)")),
    sso("sso-adfs", "AD FS", "header", sent("/adfs/(?:ls|oauth2)")),
    sso("sso-entra", "Microsoft Entra ID", "header", sent("login[.]microsoftonline[.]com")),
    sso("sso-okta", "Okta", "header", sent("[.]okta[.]com")),
    sso("sso-google", "Google sign-in", "header", sent("accounts[.]google[.]com")),
    sso("sso-saml", null, "header", sent("[?&]SAMLRequest=")),
    sso("sso-oidc", null, "header", sent("[?&]response_type=[^[:space:]]*client_id=|[?&]client_id=[^[:space:]]*response_type=")),
    // The same, as a link or a form on the login page.
    sso("sso-keycloak-link", "Keycloak", "body", linked("/realms/[^/\"[:space:]]+/protocol/(?:openid-connect|saml)")),
    sso("sso-adfs-link", "AD FS", "body", linked("/adfs/(?:ls|oauth2)")),
    sso("sso-entra-link", "Microsoft Entra ID", "body", linked("login[.]microsoftonline[.]com")),
    sso("sso-okta-link", "Okta", "body", linked("[.]okta[.]com")),
    sso("sso-google-link", "Google sign-in", "body", linked("accounts[.]google[.]com")),

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
      var m = /^\(\?([is]+)\)/.exec(p);
      if (m) {
        flags = m[1];
        p = p.slice(m[0].length);
      }
      return new RegExp(p.replace(/\[\[:space:\]\]/g, "\\s").replace(/\[\^([^\]]*)\[:space:\]\]/g, "[^$1\\s]").replace(/\[\[:cntrl:\]\]/g, "[\\x00-\\x1f]").replace(/\[\^\[:cntrl:\]\]/g, "[^\\x00-\\x1f]"), flags);
    });
  }

  var api = { TEMPLATES: TEMPLATES, ANSWERS: ANSWERS, VERSION: VERSION, answer: answer, text: text, pattern: pattern };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNucleiTemplates = api;
})();
