import { readFile, writeFile, rename, unlink, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

/* ── a drop-in for @netlify/blobs ──────────────────────────────
   The webinar system was built on Netlify Blobs. On the DigitalOcean server the
   same calls are answered from files on the data volume, so none of the code
   that uses storage had to change — only its import line.

     /data/blobs/<store>/<key>            the value (JSON, PNG, video…)
     /data/blobs/<store>/<key>.meta.json  its metadata, if any

   Keys are URL-encoded into one file name, so "id/clip.mp4" stays one file.
   Writes go to a temporary file first and are renamed into place, so a crash
   mid-write can never leave a half-written record behind.

   Supports exactly what the system uses: get (json / arrayBuffer / text), set,
   setJSON, delete, list.
   ───────────────────────────────────────────────────────────── */

const ROOT = join(process.env.DATA_DIR || "/data", "blobs");
const META = ".meta.json";
const fileOf = (dir, key) => join(dir, encodeURIComponent(String(key)));

async function atomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export function getStore(opts) {
  const name = typeof opts === "string" ? opts : opts?.name;
  if (!name || /[\/\\]|\.\./.test(name)) throw new Error(`bad store name ${name}`);
  const dir = join(ROOT, name);
  let ready = null;
  const ensure = () => (ready ||= mkdir(dir, { recursive: true }));

  return {
    async get(key, { type } = {}) {
      await ensure();
      let buf;
      try { buf = await readFile(fileOf(dir, key)); } catch (err) { if (err.code === "ENOENT") return null; throw err; }
      if (type === "json") return JSON.parse(buf.toString("utf8"));
      if (type === "arrayBuffer") return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      if (type === "blob") return new Blob([buf]);
      return buf.toString("utf8");
    },
    async getMetadata(key) {
      await ensure();
      try { return { metadata: JSON.parse(await readFile(fileOf(dir, key) + META, "utf8")) }; }
      catch { return null; }
    },
    async set(key, data, { metadata } = {}) {
      await ensure();
      const body = typeof data === "string" ? data
        : data instanceof ArrayBuffer ? Buffer.from(data)
        : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : data instanceof Blob ? Buffer.from(await data.arrayBuffer())
        : Buffer.from(String(data));
      await atomic(fileOf(dir, key), body);
      if (metadata) await atomic(fileOf(dir, key) + META, JSON.stringify(metadata));
    },
    async setJSON(key, value, { metadata } = {}) {
      return this.set(key, JSON.stringify(value), { metadata });
    },
    async delete(key) {
      await ensure();
      for (const p of [fileOf(dir, key), fileOf(dir, key) + META]) {
        try { await unlink(p); } catch (err) { if (err.code !== "ENOENT") throw err; }
      }
    },
    async list() {
      await ensure();
      const names = await readdir(dir);
      return { blobs: names.filter((n) => !n.endsWith(META) && !n.includes(".tmp-"))
                           .map((n) => ({ key: decodeURIComponent(n) })) };
    },
  };
}
