# effractor's nuclei templates

Five templates that ask what the drawing needs: what answers on a port, which
web server and application, which names a certificate bears, where someone
logs in, and what a name points to. They only read: `GET` requests, one line
feed, a TLS handshake, a DNS question. The page writes the command that
carries them; nothing here has to be downloaded.

The files are written from the table in `assets/js/nuclei-templates.js`
(`node scripts/dev/nuclei-templates-write.js`); change the table, not the
files.

The traces by which applications are known are taken from the
[nuclei-templates](https://github.com/projectdiscovery/nuclei-templates)
collection, © ProjectDiscovery, Inc., MIT licence, and rewritten: reduced to
what needs no login, without backslashes and single quotes.
