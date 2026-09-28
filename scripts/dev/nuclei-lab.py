#!/usr/bin/env python3
"""The lab effractor's nuclei templates are recorded against (nuclei templates
spec §11): throwaway servers on 127.0.0.1 that say what
scripts/fixtures/nuclei/lab.json holds, and a recorder that runs nuclei
against them and rewrites what it wrote to the lab's addresses.

  nuclei-lab.py serve               start the servers, print the ports, wait
  nuclei-lab.py record identify     write scripts/fixtures/nuclei/identify.jsonl
  nuclei-lab.py record connect      write scripts/fixtures/nuclei/connect.jsonl

Nothing is asked but 127.0.0.1: nuclei runs with -no-interactsh,
-disable-update-check and the lab's own resolver.
"""
import http.server, json, os, re, socket, ssl, struct, subprocess, sys, tempfile, threading, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FIXTURES = os.path.join(ROOT, "scripts", "fixtures", "nuclei")
LAB = json.load(open(os.path.join(FIXTURES, "lab.json"), encoding="utf-8"))
GROUPS = {
    "identify": ["effractor-banner", "effractor-web", "effractor-certificate"],
    "connect": ["effractor-login", "effractor-points-to"],
}
FIRST, RESOLVER = 19000, 15353
DAY = "2026-09-28T10:00:%02d.000000000+02:00"


def certificate(directory, index, names):
    """A self-signed certificate bearing the names, made with openssl."""
    key, cert = (os.path.join(directory, "%d.%s" % (index, e)) for e in ("key", "pem"))
    alt = ",".join("DNS:" + n for n in names)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
                    "-days", "2", "-subj", "/CN=" + names[0], "-addext", "subjectAltName=" + alt],
                   check=True, capture_output=True)
    return cert, key


def banner(sock, text):
    """Says its text to whoever connects, as a service that speaks first."""
    def serve():
        while True:
            c, _ = sock.accept()
            try:
                c.sendall(text.encode("latin-1"))
                time.sleep(0.3)
            except OSError:
                pass
            finally:
                c.close()
    threading.Thread(target=serve, daemon=True).start()


def web(port):
    """A request handler that answers with the port's pages and nothing else."""
    class Pages(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def version_string(self):
            return port.get("server", "")

        def do_GET(self):
            page = port.get("pages", {}).get(self.path)
            body = (page or {}).get("body", "" if page else "not here").encode("utf-8")
            self.send_response_only((page or {}).get("status", 200) if page else 404)
            if port.get("server"):
                self.send_header("Server", port["server"])
            headers = dict(port.get("headers", {}), **(page or {}).get("headers", {}))
            if page and page.get("location"):
                headers["Location"] = page["location"]
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    return Pages


def resolver():
    """Answers A questions for the lab's names, with their alias first."""
    def name(n):
        return b"".join(bytes([len(p)]) + p.encode() for p in n.split(".")) + b"\0"
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", RESOLVER))

    def serve():
        while True:
            q, a = s.recvfrom(512)
            i, labels = 12, []
            while q[i]:
                labels.append(q[i + 1:i + 1 + q[i]].decode())
                i += q[i] + 1
            known = LAB["names"].get(".".join(labels).lower())
            answer, n, owner = b"", 0, b"\xc0\x0c"
            if known and known.get("alias"):
                t = name(known["alias"])
                answer += owner + struct.pack(">HHIH", 5, 1, 60, len(t)) + t
                owner, n = name(known["alias"]), n + 1
            if known and known.get("address"):
                answer += owner + struct.pack(">HHIH", 1, 1, 60, 4) + bytes(int(x) for x in known["address"].split("."))
                n += 1
            s.sendto(q[:2] + struct.pack(">HHHHH", 0x8180 | (0 if n else 3), 1, n, 0, 0) + q[12:i + 5] + answer, a)
    threading.Thread(target=serve, daemon=True).start()


def serve(directory):
    """Starts every server; returns {local port: (lab address, lab port, lab name)}."""
    local, at = {}, FIRST
    for host in LAB["hosts"]:
        for port in host["ports"]:
            local[at] = (host["address"], port["port"], host.get("name"))
            if "banner" in port:
                s = socket.socket()
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", at))
                s.listen(16)
                banner(s, port["banner"])
            else:
                server = http.server.ThreadingHTTPServer(("127.0.0.1", at), web(port))
                if "tls" in port:
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(*certificate(directory, at, port["tls"]["names"]))
                    server.socket = context.wrap_socket(server.socket, server_side=True)
                threading.Thread(target=server.serve_forever, daemon=True).start()
            at += 1
    resolver()
    return local


def rewrite(record, local, second):
    """The record as the lab would have been: its address, its port, its day."""
    text = json.dumps(record)
    for at, (address, port, _) in local.items():
        shown = "[%s]" % address if ":" in address else address
        text = text.replace("127.0.0.1:%d" % at, "%s:%d" % (shown, port))
    out = json.loads(text)
    m = re.search(r"(\d+\.\d+\.\d+\.\d+|\[[0-9a-f:]+\]):(\d+)", str(out.get("matched-at", "")) + " " + str(out.get("host", "")))
    if out.get("type") == "dns":
        out.pop("ip", None)
    elif m:
        out["ip"] = m.group(1).strip("[]")
        out["host"] = m.group(1)
        out["port"] = m.group(2)
        # A default port is left out of a URL, as nuclei leaves it out.
        for key in ("url", "matched-at"):
            if isinstance(out.get(key), str):
                out[key] = re.sub(r"^(https)://([^/]+):443(/|$)", r"\1://\2\3", re.sub(r"^(http)://([^/]+):80(/|$)", r"\1://\2\3", out[key]))
    out["timestamp"] = DAY % (second % 60)
    out.pop("curl-command", None)
    if "template-path" in out:
        out["template-path"] = "/home/user/effractor-templates/" + os.path.basename(out["template-path"])
    return out


def record(group):
    with tempfile.TemporaryDirectory() as directory:
        local = serve(directory)
        time.sleep(1)
        targets, names, resolvers = (os.path.join(directory, n) for n in ("targets.txt", "names.txt", "resolvers.txt"))
        open(targets, "w").write("".join("127.0.0.1:%d\n" % at for at in local))
        open(names, "w").write("".join(n + "\n" for n in LAB["names"]))
        open(resolvers, "w").write("127.0.0.1:%d\n" % RESOLVER)
        always = ["-jsonl", "-silent", "-omit-raw", "-omit-template", "-no-interactsh", "-disable-update-check"]
        runs = []
        ports = [t for t in GROUPS[group] if t != "effractor-points-to"]
        if ports:
            runs.append(["-t", ",".join(os.path.join(ROOT, "assets", "nuclei", t + ".yaml") for t in ports), "-list", targets, "-exclude-type", "dns"])
        if "effractor-points-to" in GROUPS[group]:
            runs.append(["-t", os.path.join(ROOT, "assets", "nuclei", "effractor-points-to.yaml"), "-list", names, "-resolvers", resolvers])
        lines = []
        for run in runs:
            out = subprocess.run(["nuclei"] + run + always, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=900)
            lines += [json.loads(l) for l in out.stdout.splitlines() if l.startswith("{")]
        # In an order that does not depend on which answer came first.
        lines.sort(key=lambda r: (r.get("template-id", ""), r.get("matched-at", ""), r.get("extractor-name", "")))
        written = [rewrite(r, local, i) for i, r in enumerate(lines)]
        path = os.path.join(FIXTURES, group + ".jsonl")
        open(path, "w", encoding="utf-8").write("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in written))
        version = subprocess.run(["nuclei", "-version"], capture_output=True, text=True).stderr
        print("wrote %d records to %s (%s)" % (len(written), path, (re.search(r"v[0-9.]+", version) or [""])[0]))


if __name__ == "__main__":
    if sys.argv[1:] == ["serve"]:
        with tempfile.TemporaryDirectory() as directory:
            for at, (address, port, _) in serve(directory).items():
                print("127.0.0.1:%d is %s:%d" % (at, address, port))
            threading.Event().wait()
    elif len(sys.argv) == 3 and sys.argv[1] == "record" and sys.argv[2] in GROUPS:
        record(sys.argv[2])
    else:
        sys.exit(__doc__)
