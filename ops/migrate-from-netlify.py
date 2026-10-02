#!/usr/bin/env python3
"""Copy the webinar system's data from Netlify to the DigitalOcean server.

Safe to run as often as you like — it is how the final sync at cut-over is
done, and running it twice gives the same result. It only READS from Netlify.

What it copies, from Netlify Blobs into the server's data volume
(/data/blobs/<store>/<key>, the layout src/../app/netlify/shared/blobs.mjs reads):

  webinars       every webinar record
  webinar-art    the email images (/art/<token>.png) — including those that
                 campaigns already sent point at
  clip-previews  the clip preview videos

and every file a client uploaded (logos, headshots, assets). Those live on
Netlify's file servers; each is downloaded into the server's `uploads` store and
the COPIED record is pointed at https://webinars.redcloudfs.com/uploads/…, so the
new server never depends on Netlify for them. Netlify's own records are not
changed.

Usage (from ~/webinar-pipeline):   python3 ops/migrate-from-netlify.py [--dry-run]
"""
import hashlib, json, os, re, subprocess, sys, tarfile, tempfile, urllib.parse, urllib.request

SITE_DIR = "/Users/redcloudmediabot/Desktop/Claude /red-cloud-webinar-intake"   # the linked Netlify site
HOST = "root@138.197.139.66"
SERVER_DIR = "/root/webinar-pipeline"
NEW_ORIGIN = "https://webinars.redcloudfs.com"
STORES = ["webinars", "webinar-art", "clip-previews"]
DRY = "--dry-run" in sys.argv

def js_encode(key):
    """encodeURIComponent, which blobs.mjs uses to turn a key into a file name"""
    return urllib.parse.quote(key, safe="-_.!~*'()")

def netlify(*args, **kw):
    return subprocess.run(["netlify", *args], cwd=SITE_DIR, capture_output=True, timeout=300, **kw)

def list_keys(store):
    r = netlify("blobs:list", store, "--json", text=True)
    if r.returncode: raise SystemExit(f"could not list {store}: {r.stderr[-300:]}")
    return [b["key"] for b in json.loads(r.stdout or "{}").get("blobs", [])]

def get_blob(store, key, out):
    r = netlify("blobs:get", store, key, "-O", out, text=True)
    if r.returncode or not os.path.exists(out): raise RuntimeError(f"{store}/{key}: {r.stderr[-200:]}")

def main():
    stage = tempfile.mkdtemp(prefix="wp-migrate-")
    counts, uploads, failures = {}, 0, []
    for store in STORES:
        keys = list_keys(store)
        counts[store] = len(keys)
        os.makedirs(os.path.join(stage, store), exist_ok=True)
        for k in keys:
            get_blob(store, k, os.path.join(stage, store, js_encode(k)))
        print(f"  {store:14} {len(keys):4} item(s) read from Netlify")

    # ── the uploaded files, and the copied records pointed at their copies ──
    up_dir = os.path.join(stage, "uploads"); os.makedirs(up_dir, exist_ok=True)
    for name in os.listdir(os.path.join(stage, "webinars")):
        path = os.path.join(stage, "webinars", name)
        rec = json.load(open(path, encoding="utf-8"))
        token = hashlib.sha256(("migrate:" + rec["id"]).encode()).hexdigest()[:32]   # same every run
        remap = {}
        urls = list(rec.get("files") or []) + list(rec.get("logoFiles") or []) + [h.get("url") for h in rec.get("headshots") or [] if h.get("url")]
        for u in dict.fromkeys(urls):
            if not u or u.startswith(NEW_ORIGIN): continue
            fname = re.sub(r"[^\w.\- ]+", "_", urllib.parse.unquote(urllib.parse.urlparse(u).path.rsplit("/", 1)[-1]))[:120] or "file"
            key = f"{token}/{fname}"
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data, ctype = r.read(), r.headers.get("content-type", "application/octet-stream")
            except Exception as e:
                failures.append(f"{rec['id']}: {u[:80]} — {e}"); continue
            open(os.path.join(up_dir, js_encode(key)), "wb").write(data)
            open(os.path.join(up_dir, js_encode(key)) + ".meta.json", "w").write(json.dumps({"contentType": ctype}))
            remap[u] = f"{NEW_ORIGIN}/uploads/{token}/{urllib.parse.quote(fname)}"
            uploads += 1
        # a hand-set logo hosted on the Netlify site (public/logos/) — the same file is on the new site
        old_site = "https://redcloud-webinar-form.netlify.app/"
        logo = (rec.get("facts") or {}).get("logoUrl") or ""
        if logo.startswith(old_site):
            rec["facts"]["logoUrl"] = NEW_ORIGIN + "/" + logo[len(old_site):]
            remap[logo] = rec["facts"]["logoUrl"]
        if remap:
            rec["files"] = [remap.get(u, u) for u in rec.get("files") or []]
            rec["logoFiles"] = [remap.get(u, u) for u in rec.get("logoFiles") or []]
            for h in rec.get("headshots") or []:
                if h.get("url") in remap: h["url"] = remap[h["url"]]
            json.dump(rec, open(path, "w", encoding="utf-8"))
    print(f"  uploads        {uploads:4} file(s) copied off Netlify's file servers")
    for f in failures: print("  ! could not copy", f)

    if DRY:
        print(f"dry run — nothing sent to the server. Staged in {stage}"); return

    # ── into the server's data volume, as the app's own user ──
    tarpath = os.path.join(stage, "..", os.path.basename(stage) + ".tar")
    with tarfile.open(tarpath, "w") as t:
        for store in STORES + ["uploads"]:
            t.add(os.path.join(stage, store), arcname=store)
    cmd = f"cd {SERVER_DIR} && docker compose exec -T pipeline sh -c 'mkdir -p /data/blobs && tar -xf - -C /data/blobs'"
    with open(tarpath, "rb") as fh:
        r = subprocess.run(["ssh", "-o", "BatchMode=yes", HOST, cmd], stdin=fh, capture_output=True, timeout=600)
    if r.returncode: raise SystemExit(f"copy to server failed: {r.stderr.decode()[-400:]}")
    os.remove(tarpath)

    # ── check: the server now holds exactly what Netlify holds ──
    check = "cd %s && docker compose exec -T pipeline sh -c '%s'" % (SERVER_DIR, "; ".join(
        f'printf "{s} "; ls /data/blobs/{s} | grep -v \\.meta\\.json | wc -l' for s in STORES + ["uploads"]))
    out = subprocess.run(["ssh", "-o", "BatchMode=yes", HOST, check], capture_output=True, text=True, timeout=120).stdout
    print("on the server now:"); bad = False
    for line in out.strip().splitlines():
        s, n = line.split()
        want = counts.get(s)
        ok = want is None or int(n) >= want
        bad |= not ok
        print(f"  {s:14} {n:>4}" + ("" if want is None else f"   (Netlify: {want}) {'✓' if ok else '✗ MISSING'}"))
    if bad or failures: sys.exit(1)

if __name__ == "__main__":
    main()
