/**
 * Minimal OpenStreetMap .osm.pbf reader (BlobHeader/Blob, zlib, PrimitiveBlock
 * with DenseNodes, Ways and Relations) using the `pbf` protobuf reader.
 * Shared by extract-pbf.ts and extract-airport.ts.
 */
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PbfReader as Pbf } from 'pbf';

export type Tags = Record<string, string>;

// ---------------------------------------------------------------------------
// Low-level PBF block iteration
// ---------------------------------------------------------------------------

interface Block {
  strings: string[];
  granularity: number;
  latOffset: number;
  lonOffset: number;
  groups: Uint8Array[];
}

function* blocks(path: string): Generator<Block> {
  const fd = openSync(path, 'r');
  const size = statSync(path).size;
  let pos = 0;
  const lenBuf = Buffer.alloc(4);
  try {
    while (pos < size) {
      readSync(fd, lenBuf, 0, 4, pos);
      const hlen = lenBuf.readUInt32BE(0);
      pos += 4;
      const hbuf = Buffer.alloc(hlen);
      readSync(fd, hbuf, 0, hlen, pos);
      pos += hlen;
      const header = new Pbf(hbuf).readFields((tag, h: { type: string; size: number }, p) => {
        if (tag === 1) h.type = p!.readString();
        else if (tag === 3) h.size = p!.readVarint();
      }, { type: '', size: 0 });
      const bbuf = Buffer.alloc(header.size);
      readSync(fd, bbuf, 0, header.size, pos);
      pos += header.size;
      if (header.type !== 'OSMData') continue;
      const blob = new Pbf(bbuf).readFields((tag, b: { raw?: Uint8Array; zlib?: Uint8Array }, p) => {
        if (tag === 1) b.raw = p!.readBytes();
        else if (tag === 3) b.zlib = p!.readBytes();
        else if (tag === 4 || tag === 7) throw new Error('LZMA/ZSTD-compressed PBF blobs are not supported; use a Geofabrik (zlib) extract.');
      }, {} as { raw?: Uint8Array; zlib?: Uint8Array });
      const data = blob.raw ?? inflateSync(blob.zlib!);
      const block: Block = { strings: [], granularity: 100, latOffset: 0, lonOffset: 0, groups: [] };
      new Pbf(data).readFields((tag, b: Block, p) => {
        if (tag === 1) {
          p!.readMessage((t, s: string[], pp) => {
            if (t === 1) s.push(Buffer.from(pp!.readBytes()).toString('utf8'));
          }, b.strings);
        } else if (tag === 2) b.groups.push(p!.readBytes());
        else if (tag === 17) b.granularity = p!.readVarint();
        else if (tag === 19) b.latOffset = p!.readVarint(true);
        else if (tag === 20) b.lonOffset = p!.readVarint(true);
      }, block);
      yield block;
    }
  } finally {
    closeSync(fd);
  }
}

export interface Visitor {
  node?(id: number, lat: number, lon: number, tags: Tags | null): void;
  way?(id: number, refs: number[], tags: Tags): void;
  relation?(id: number, members: Array<{ type: 'node' | 'way' | 'relation'; ref: number; role: string }>, tags: Tags): void;
}

function tagsOf(keys: number[], vals: number[], s: string[]): Tags {
  const t: Tags = {};
  for (let i = 0; i < keys.length; i++) t[s[keys[i]!]!] = s[vals[i]!]!;
  return t;
}

export function visit(path: string, v: Visitor): void {
  for (const b of blocks(path)) {
    const s = b.strings;
    const scale = 1e-9;
    for (const g of b.groups) {
      new Pbf(g).readFields((tag, _o: object, p) => {
        const pbf = p!;
        if (tag === 2 && v.node) {
          // DenseNodes
          const d = pbf.readMessage((t, o: { id: number[]; lat: number[]; lon: number[]; kv: number[] }, pp) => {
            if (t === 1) pp!.readPackedSVarint(o.id);
            else if (t === 8) pp!.readPackedSVarint(o.lat);
            else if (t === 9) pp!.readPackedSVarint(o.lon);
            else if (t === 10) pp!.readPackedVarint(o.kv);
          }, { id: [], lat: [], lon: [], kv: [] });
          let id = 0;
          let lat = 0;
          let lon = 0;
          let k = 0;
          for (let i = 0; i < d.id.length; i++) {
            id += d.id[i]!;
            lat += d.lat[i]!;
            lon += d.lon[i]!;
            let tags: Tags | null = null;
            if (d.kv.length) {
              while (k < d.kv.length && d.kv[k] !== 0) {
                (tags ??= {})[s[d.kv[k]!]!] = s[d.kv[k + 1]!]!;
                k += 2;
              }
              k++;
            }
            v.node(id, scale * (b.latOffset + b.granularity * lat), scale * (b.lonOffset + b.granularity * lon), tags);
          }
        } else if (tag === 1 && v.node) {
          const n = pbf.readMessage((t, o: { id: number; keys: number[]; vals: number[]; lat: number; lon: number }, pp) => {
            if (t === 1) o.id = pp!.readSVarint();
            else if (t === 2) pp!.readPackedVarint(o.keys);
            else if (t === 3) pp!.readPackedVarint(o.vals);
            else if (t === 8) o.lat = pp!.readSVarint();
            else if (t === 9) o.lon = pp!.readSVarint();
          }, { id: 0, keys: [], vals: [], lat: 0, lon: 0 });
          v.node(n.id, scale * (b.latOffset + b.granularity * n.lat), scale * (b.lonOffset + b.granularity * n.lon), n.keys.length ? tagsOf(n.keys, n.vals, s) : null);
        } else if (tag === 3 && v.way) {
          const w = pbf.readMessage((t, o: { id: number; keys: number[]; vals: number[]; refs: number[] }, pp) => {
            if (t === 1) o.id = pp!.readVarint();
            else if (t === 2) pp!.readPackedVarint(o.keys);
            else if (t === 3) pp!.readPackedVarint(o.vals);
            else if (t === 8) pp!.readPackedSVarint(o.refs);
          }, { id: 0, keys: [], vals: [], refs: [] });
          let r = 0;
          const refs = w.refs.map((dlt) => (r += dlt));
          v.way(w.id, refs, tagsOf(w.keys, w.vals, s));
        } else if (tag === 4 && v.relation) {
          const rel = pbf.readMessage((t, o: { id: number; keys: number[]; vals: number[]; roles: number[]; ids: number[]; types: number[] }, pp) => {
            if (t === 1) o.id = pp!.readVarint();
            else if (t === 2) pp!.readPackedVarint(o.keys);
            else if (t === 3) pp!.readPackedVarint(o.vals);
            else if (t === 8) pp!.readPackedVarint(o.roles);
            else if (t === 9) pp!.readPackedSVarint(o.ids);
            else if (t === 10) pp!.readPackedVarint(o.types);
          }, { id: 0, keys: [], vals: [], roles: [], ids: [], types: [] });
          let m = 0;
          const members = rel.ids.map((dlt, i) => ({ type: (['node', 'way', 'relation'] as const)[rel.types[i]!]!, ref: (m += dlt), role: s[rel.roles[i]!] ?? '' }));
          v.relation(rel.id, members, tagsOf(rel.keys, rel.vals, s));
        }
      }, {});
    }
  }
}
