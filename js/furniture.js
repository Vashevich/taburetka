// Параметрические «болванки» мебели.
// Каждая болванка строится в локальных координатах группы:
// x ∈ [-w/2, w/2], y ∈ [0, h], z ∈ [-d/2, d/2]; «лицо» мебели смотрит в +Z.
import * as THREE from 'three';

export const EDGE = new THREE.LineBasicMaterial({ color: 0x1d1d1d });
const noRay = () => {};

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, ...extra });
}

function addEdges(mesh, angle = 25) {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), EDGE);
  e.raycast = noRay;
  e.userData.edge = true;
  mesh.add(e);
}

class Builder {
  constructor(group, color) {
    this.g = group;
    const c = new THREE.Color(color);
    this.m = std(c);
    this.m2 = std(c.clone().multiplyScalar(0.72));
    this.m3 = std(c.clone().lerp(new THREE.Color('#ffffff'), 0.5));
    this.parts = 0;
  }
  // подвижная часть (дверца, ящик): всё, что строится внутри fn, попадает в отдельную группу
  part(x, y, z, act, fn) {
    const prev = this.g, group = new THREE.Group();
    group.position.set(x, y, z);
    group.userData.act = act;
    group.userData.part = this.parts++;
    this.g = group;
    fn();
    this.g = prev;
    prev.add(group);
    return group;
  }
  finish(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    addEdges(mesh);
    this.g.add(mesh);
    return mesh;
  }
  // x, z — центр; y — низ
  box(w, h, d, x = 0, y = 0, z = 0, m = this.m) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(w, 0.004), Math.max(h, 0.004), Math.max(d, 0.004)), m);
    mesh.position.set(x, y + h / 2, z);
    return this.finish(mesh);
  }
  // цилиндр/конус единичного радиуса масштабируется до эллипса sx × sz
  cyl(rTop, rBot, h, x, y, z, m = this.m, sx = 1, sz = 1) {
    h = Math.max(h, 0.004);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 32), m);
    mesh.position.set(x, y + h / 2, z);
    mesh.scale.set(sx, 1, sz);
    return this.finish(mesh);
  }
}

function legs(b, w, d, h, leg, inset, m = b.m2) {
  const lx = w / 2 - inset - leg / 2, lz = d / 2 - inset - leg / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(leg, h, leg, sx * lx, 0, sz * lz, m);
  return { lx, lz };
}

// Фасады: handle 'v' — распашные дверцы, 'h' — выдвижные ящики.
function fronts(b, w, h, d, cols, rows, y0, zc, handle = 'h') {
  const cw = w / cols, rh = h / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = -w / 2 + cw * (i + 0.5), y = y0 + rh * j;
    if (handle === 'h') {
      b.part(x, y, zc, { kind: 'drawer', z0: zc, travel: Math.max(0.1, (d - 0.08) * 0.75) }, () => {
        b.box(cw - 0.006, rh - 0.006, 0.02, 0, 0.003, 0, b.m3);
        b.box(Math.min(0.16, cw * 0.4), 0.014, 0.016, 0, rh * 0.72, 0.016, b.m2);
        const dd = Math.max(0.05, d - 0.1), bw = cw - 0.05, bh = Math.max(0.02, rh - 0.06);
        b.box(bw, 0.01, dd, 0, 0.02, -dd / 2 - 0.01, b.m2);
        for (const s of [-1, 1]) b.box(0.012, bh, dd, s * (bw / 2 - 0.006), 0.03, -dd / 2 - 0.01, b.m2);
        b.box(bw - 0.024, bh, 0.012, 0, 0.03, -dd - 0.004, b.m2);
      });
    } else {
      const left = cols === 1 || i % 2 === 0, k = left ? 1 : -1, half = cw / 2 - 0.003;
      b.part(x - k * half, y, zc, { kind: 'door', sign: -k }, () => {
        b.box(cw - 0.006, rh - 0.006, 0.02, k * half, 0.003, 0, b.m3);
        b.box(0.014, Math.min(0.16, rh * 0.3), 0.016, k * (2 * half - 0.05), Math.min(rh * 0.5, 1.0), 0.016, b.m2);
      });
    }
  }
}

export function applyAct(part, t) {
  const a = part.userData.act;
  part.userData.t = t;
  if (a.kind === 'door') part.rotation.y = a.sign * t * 1.9;
  else part.position.z = a.z0 + t * a.travel;
}

function sofa(b, w, d, h) {
  const baseH = Math.max(0.1, Math.min(0.3, h * 0.36));
  const armW = Math.min(0.18, w * 0.16), backD = Math.min(0.22, d * 0.26);
  const armH = Math.max(0.05, Math.min(h - baseH - 0.12, 0.3));
  b.box(w, baseH, d, 0, 0, 0, b.m2);
  b.box(w, h - baseH, backD, 0, baseH, -d / 2 + backD / 2);
  for (const s of [-1, 1]) b.box(armW, armH, d - backD, s * (w / 2 - armW / 2), baseH, backD / 2);
  const inner = w - 2 * armW, n = Math.max(1, Math.round(inner / 0.7)), cw = inner / n;
  for (let i = 0; i < n; i++)
    b.box(cw - 0.012, 0.12, d - backD - 0.02, -inner / 2 + cw * (i + 0.5), baseH, backD / 2 - 0.01, b.m3);
}

const BUILD = {
  box(b, w, d, h) { b.box(w, h, d); },
  wall(b, w, d, h) { b.box(w, h, d); },
  rug(b, w, d, h) { b.box(w, h, d); },

  wardrobe(b, w, d, h) {
    b.box(w, h, d - 0.02, 0, 0, -0.01);
    fronts(b, w, h - 0.06, d, Math.max(1, Math.round(w / 0.5)), 1, 0.05, d / 2 - 0.01, 'v');
  },
  dresser(b, w, d, h) {
    b.box(w, h, d - 0.02, 0, 0, -0.01);
    fronts(b, w, h - 0.06, d, w > 1.1 ? 2 : 1, Math.max(1, Math.round((h - 0.06) / 0.22)), 0.05, d / 2 - 0.01, 'h');
  },
  kitchen(b, w, d, h) {
    const t = 0.04;
    b.box(w, h - t, d - 0.04, 0, 0, -0.02);
    fronts(b, w, h - t - 0.1, d, Math.max(1, Math.round(w / 0.6)), 1, 0.1, d / 2 - 0.03, 'v');
    b.box(w, t, d, 0, h - t, 0, b.m2);
  },
  fridge(b, w, d, h) {
    b.box(w, h, d - 0.03, 0, 0, -0.015);
    const split = h * 0.62;
    const hx = w / 2 - 0.003;          // петли справа, ручки слева
    b.part(hx, 0, d / 2 - 0.015, { kind: 'door', sign: 1 }, () => {
      b.box(w - 0.006, split - 0.012, 0.03, -hx, 0.006, 0, b.m3);
      b.box(0.016, 0.3, 0.02, -2 * hx + 0.05, split - 0.4, 0.025, b.m2);
    });
    b.part(hx, split, d / 2 - 0.015, { kind: 'door', sign: 1 }, () => {
      b.box(w - 0.006, h - split - 0.012, 0.03, -hx, 0.006, 0, b.m3);
      b.box(0.016, 0.2, 0.02, -2 * hx + 0.05, 0.08, 0.025, b.m2);
    });
  },
  shelf(b, w, d, h) {
    const t = 0.02;
    for (const s of [-1, 1]) b.box(t, h, d, s * (w / 2 - t / 2), 0, 0);
    b.box(w - 2 * t, h, 0.008, 0, 0, -d / 2 + 0.004, b.m2);
    const n = Math.max(1, Math.round(h / 0.35));
    for (let i = 0; i <= n; i++) b.box(w - 2 * t, t, d - 0.008, 0, i * (h - t) / n, 0.004);
  },
  table(b, w, d, h) {
    const t = 0.04;
    b.box(w, t, d, 0, h - t, 0);
    legs(b, w, d, h - t, 0.05, 0.03);
  },
  desk(b, w, d, h) {
    const t = 0.03;
    b.box(w, t, d, 0, h - t, 0);
    for (const s of [-1, 1]) b.box(0.025, h - t, d - 0.06, s * (w / 2 - 0.04), 0, 0, b.m2);
    b.box(w - 0.105, (h - t) * 0.4, 0.018, 0, (h - t) * 0.5, -d / 2 + 0.06, b.m2);
  },
  roundtable(b, w, d, h) {
    const t = 0.035;
    b.cyl(0.5, 0.5, t, 0, h - t, 0, b.m, w, d);
    b.cyl(0.04, 0.04, h - t - 0.03, 0, 0.03, 0, b.m2);
    b.cyl(0.5, 0.5, 0.03, 0, 0, 0, b.m2, w * 0.55, d * 0.55);
  },
  chair(b, w, d, h) {
    const sh = Math.min(0.45, h * 0.55), st = 0.04, leg = 0.035;
    b.box(w, st, d, 0, sh - st, 0);
    const { lx, lz } = legs(b, w, d, sh - st, leg, 0);
    for (const s of [-1, 1]) b.box(leg, h - sh, leg, s * lx, sh, -lz, b.m2);
    b.box(w - 2 * leg, (h - sh) * 0.5, 0.02, 0, sh + (h - sh) * 0.45, -lz, b.m3);
  },
  stool(b, w, d, h) {
    const st = 0.03, leg = 0.035, inset = 0.02;
    b.box(w, st, d, 0, h - st, 0);
    const { lx, lz } = legs(b, w, d, h - st, leg, inset);
    for (const s of [-1, 1]) {
      b.box(2 * lx - leg, 0.02, 0.02, 0, h * 0.3, s * lz, b.m2);
      b.box(0.02, 0.02, 2 * lz - leg, s * lx, h * 0.3, 0, b.m2);
    }
  },
  sofa,
  armchair: sofa,
  cornersofa(b, w, d, h) {
    const bh = Math.min(0.28, h * 0.36), dd = Math.min(0.95, d * 0.5), cw = Math.min(0.95, w * 0.42), bk = 0.2;
    b.box(w, bh, dd, 0, 0, -d / 2 + dd / 2, b.m2);
    b.box(cw, bh, d - dd, w / 2 - cw / 2, 0, -d / 2 + dd + (d - dd) / 2, b.m2);
    b.box(w, h - bh, bk, 0, bh, -d / 2 + bk / 2);
    b.box(0.18, Math.min(0.24, h - bh), dd - bk, -w / 2 + 0.09, bh, -d / 2 + bk + (dd - bk) / 2);
    b.box(w - 0.2 - cw, 0.12, dd - bk - 0.02, -w / 2 + 0.19 + (w - 0.2 - cw) / 2, bh, -d / 2 + bk + (dd - bk) / 2, b.m3);
    b.box(cw - 0.02, 0.12, d - bk - 0.02, w / 2 - cw / 2, bh, -d / 2 + bk + (d - bk) / 2, b.m3);
  },
  bench(b, w, d, h) {
    b.box(w, 0.04, d, 0, h - 0.04, 0);
    for (const s of [-1, 1]) b.box(0.04, h - 0.04, d - 0.04, s * (w / 2 - 0.1), 0, 0, b.m2);
    b.box(w - 0.24, 0.03, 0.03, 0, h * 0.35, 0, b.m2);
  },
  barstool(b, w, d, h) {
    b.cyl(0.5, 0.5, 0.04, 0, h - 0.04, 0, b.m, w, d);
    const { lx, lz } = legs(b, w, d, h - 0.04, 0.03, 0.05);
    for (const s of [-1, 1]) {
      b.box(2 * lx - 0.03, 0.02, 0.02, 0, h * 0.32, s * lz, b.m2);
      b.box(0.02, 0.02, 2 * lz - 0.03, s * lx, h * 0.32, 0, b.m2);
    }
  },
  coffeetable(b, w, d, h) {
    b.box(w, 0.03, d, 0, h - 0.03, 0);
    legs(b, w, d, h - 0.03, 0.04, 0.02);
    b.box(w - 0.14, 0.02, d - 0.14, 0, h * 0.3, 0, b.m3);
  },
  pouf(b, w, d, h) {
    b.cyl(0.5, 0.5, h - 0.012, 0, 0, 0, b.m, w, d);
    b.cyl(0.47, 0.5, 0.012, 0, h - 0.012, 0, b.m3, w, d);
  },
  wallshelf(b, w, d, h) {
    b.box(w, 0.03, d, 0, h - 0.03, 0);
    for (const s of [-1, 1]) b.box(0.02, h - 0.03, d * 0.7, s * (w / 2 - 0.12), 0, -d * 0.15, b.m2);
  },
  picture(b, w, d, h) {
    b.box(w, h, d, 0, 0, 0, b.m2);
    b.box(w - 0.08, h - 0.08, 0.006, 0, 0.04, d / 2, b.m3);
  },
  washer(b, w, d, h) {
    b.box(w, h, d - 0.02, 0, 0, -0.01);
    b.box(w - 0.04, 0.08, 0.012, 0, h - 0.13, d / 2 - 0.014, b.m3);
    const r = Math.min(w, h) * 0.3;
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 32), std('#2b2f36', { roughness: 0.35 }));
    door.rotation.x = Math.PI / 2;
    door.scale.set(2 * r, 1, 2 * r);
    door.position.set(0, h * 0.45, d / 2 - 0.005);
    b.finish(door);
  },
  bathtub(b, w, d, h) {
    b.box(w, h, d);
    b.box(w - 0.14, 0.012, d - 0.14, 0, h - 0.006, 0, std('#cfe4ee', { roughness: 0.3 }));
  },
  nightstand(b, w, d, h) { BUILD.dresser(b, w, d, h); },
  bed(b, w, d, h) {
    const fh = Math.min(0.3, h * 0.35), mh = Math.min(0.22, h * 0.3), ht = 0.06;
    b.box(w, fh, d - ht, 0, 0, ht / 2, b.m2);
    b.box(w, h, ht, 0, 0, -d / 2 + ht / 2);
    const white = std('#f4f1ea');
    b.box(w - 0.04, mh, d - ht - 0.04, 0, fh, ht / 2, white);
    const n = w > 1.2 ? 2 : 1, pw = Math.min(0.6, (w - 0.1) / n - 0.05);
    for (let i = 0; i < n; i++)
      b.box(pw, 0.1, 0.38, (i - (n - 1) / 2) * (pw + 0.08), fh + mh, -d / 2 + ht + 0.26, b.m3);
  },
  plant(b, w, d, h) {
    const ph = Math.min(0.35, h * 0.3);
    b.cyl(0.5, 0.38, ph, 0, 0, 0, std('#b0714f'), w * 0.55, d * 0.55);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), b.m);
    leaf.scale.set(w, h - ph, d);
    leaf.position.set(0, ph + (h - ph) / 2, 0);
    b.finish(leaf);
  },
  lamp(b, w, d, h) {
    const sh = Math.min(0.3, h * 0.25);
    b.cyl(0.5, 0.5, 0.03, 0, 0, 0, b.m2, w * 0.6, d * 0.6);
    b.cyl(0.012, 0.012, h - sh - 0.03, 0, 0.03, 0, b.m2);
    b.cyl(0.36, 0.5, sh, 0, h - sh, 0, std(b.m3.color, { emissive: b.m3.color, emissiveIntensity: 0.25 }), w, d);
  },
  tv(b, w, d, h) {
    b.box(w * 0.4, 0.02, d, 0, 0, 0, b.m2);
    b.box(0.06, h * 0.12, 0.04, 0, 0.02, 0, b.m2);
    b.box(w, h * 0.86, 0.04, 0, h * 0.14, 0);
    b.box(w - 0.03, h * 0.86 - 0.03, 0.004, 0, h * 0.14 + 0.015, 0.022, std('#0d1014', { roughness: 0.3 }));
  },
  door(b, w, d, h) {
    for (const s of [-1, 1]) b.box(0.05, h, d, s * (w / 2 - 0.025), 0, 0, b.m2);
    b.box(w - 0.1, 0.05, d, 0, h - 0.05, 0, b.m2);
    const lw = w - 0.1;
    b.part(-lw / 2, 0, 0, { kind: 'door', sign: -1 }, () => {
      b.box(lw, h - 0.05, 0.04, lw / 2, 0, 0, b.m3);
      b.box(0.02, 0.12, 0.09, lw - 0.08, 1.0 > h ? h / 2 : 1.0, 0, b.m2);
    });
  },
  window(b, w, d, h) {
    for (const s of [-1, 1]) b.box(0.05, h, d, s * (w / 2 - 0.025), 0, 0);
    b.box(w - 0.1, 0.05, d, 0, 0, 0);
    b.box(w - 0.1, 0.05, d, 0, h - 0.05, 0);
    b.box(0.03, h - 0.1, d * 0.6, 0, 0.05, 0);
    b.box(w - 0.1, h - 0.1, 0.008, 0, 0.05, 0,
      std('#bfe3f2', { transparent: true, opacity: 0.35, roughness: 0.1 }));
  },
  human(b, w, d, h) {
    const head = 0.22;
    b.cyl(0.5, 0.36, h - head - 0.02, 0, 0, 0, b.m, w, d);
    const s = new THREE.Mesh(new THREE.SphereGeometry(head / 2, 20, 14), b.m3);
    s.position.set(0, h - head / 2, 0);
    b.finish(s);
  },
};

// Размеры в метрах: w — ширина, d — глубина, h — высота, y — высота от пола.
export const CATALOG = [
  { type: 'stool', name: 'Табурет', w: 0.35, d: 0.35, h: 0.45, color: '#c8a27a' },
  { type: 'chair', name: 'Стул', w: 0.45, d: 0.5, h: 0.9, color: '#c8a27a' },
  { type: 'armchair', name: 'Кресло', w: 0.9, d: 0.85, h: 0.8, color: '#8c9aa8' },
  { type: 'sofa', name: 'Диван', w: 2.1, d: 0.95, h: 0.8, color: '#8c9aa8' },
  { type: 'cornersofa', name: 'Угловой диван', w: 2.6, d: 1.7, h: 0.8, color: '#8c9aa8' },
  { type: 'pouf', name: 'Пуф', w: 0.5, d: 0.5, h: 0.42, color: '#b5553c' },
  { type: 'bench', name: 'Скамья', w: 1.2, d: 0.38, h: 0.45, color: '#c8a27a' },
  { type: 'barstool', name: 'Барный стул', w: 0.38, d: 0.38, h: 0.75, color: '#c8a27a' },
  { type: 'bed', name: 'Кровать', w: 1.6, d: 2.1, h: 0.9, color: '#b9a48c' },
  { type: 'table', name: 'Стол', w: 1.4, d: 0.8, h: 0.75, color: '#c8a27a' },
  { type: 'coffeetable', name: 'Журнальный столик', w: 1.0, d: 0.6, h: 0.42, color: '#c8a27a' },
  { type: 'roundtable', name: 'Круглый стол', w: 0.9, d: 0.9, h: 0.75, color: '#c8a27a' },
  { type: 'desk', name: 'Письменный стол', w: 1.2, d: 0.6, h: 0.75, color: '#e9e4da' },
  { type: 'wardrobe', name: 'Шкаф', w: 1.2, d: 0.6, h: 2.1, color: '#e9e4da' },
  { type: 'dresser', name: 'Комод / тумба', w: 0.8, d: 0.45, h: 0.8, color: '#e9e4da' },
  { type: 'nightstand', name: 'Прикроватная тумба', w: 0.45, d: 0.4, h: 0.5, color: '#e9e4da' },
  { type: 'shelf', name: 'Стеллаж', w: 0.8, d: 0.3, h: 1.8, color: '#c8a27a' },
  { type: 'kitchen', name: 'Кухонный модуль', w: 0.6, d: 0.6, h: 0.86, color: '#e9e4da' },
  { type: 'fridge', name: 'Холодильник', w: 0.6, d: 0.65, h: 1.9, color: '#d5d9dc' },
  { type: 'washer', name: 'Стиральная машина', w: 0.6, d: 0.55, h: 0.85, color: '#e3e5e6' },
  { type: 'bathtub', name: 'Ванна', w: 1.7, d: 0.75, h: 0.58, color: '#f1f1ee' },
  { type: 'wallshelf', name: 'Настенная полка', w: 0.9, d: 0.22, h: 0.2, y: 1.4, color: '#c8a27a' },
  { type: 'picture', name: 'Картина', w: 0.7, d: 0.03, h: 0.5, y: 1.3, color: '#3a332b' },
  { type: 'tv', name: 'Телевизор', w: 1.2, d: 0.25, h: 0.78, color: '#2b2f36' },
  { type: 'lamp', name: 'Торшер', w: 0.4, d: 0.4, h: 1.6, color: '#d8c9a0' },
  { type: 'plant', name: 'Растение', w: 0.5, d: 0.5, h: 1.1, color: '#5f8f4e' },
  { type: 'rug', name: 'Ковёр', w: 2.0, d: 1.4, h: 0.012, color: '#b5553c' },
  { type: 'box', name: 'Коробка', w: 0.6, d: 0.6, h: 0.6, color: '#f1eee8' },
  { type: 'wall', name: 'Перегородка', w: 2.0, d: 0.1, h: 2.7, color: '#f2efe9' },
  { type: 'door', name: 'Дверь', w: 0.9, d: 0.1, h: 2.05, color: '#d9c7a8' },
  { type: 'window', name: 'Окно', w: 1.4, d: 0.1, h: 1.4, y: 0.85, color: '#f5f5f2' },
  { type: 'human', name: 'Человек 175 см', w: 0.45, d: 0.28, h: 1.75, color: '#7a8fa3' },
];

export function fillBlank(group, type, w, d, h, color, open) {
  const b = new Builder(group, color || '#f1eee8');
  (BUILD[type] || BUILD.box)(b, w, d, h);
  for (const c of group.children)
    if (c.userData.act) applyAct(c, open && open.includes(c.userData.part) ? 1 : 0);
  return group;
}
