// Табуретка — планировщик комнаты: 3D в браузере, VR и AR через WebXR.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { CATALOG, CATS, fillBlank, applyAct, EDGE, NOSUP_T, RUGS } from './furniture.js?v=52';

const STORE = 'taburetka.project.v1';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
const uid = () => Math.random().toString(36).slice(2, 9);
const coarse = matchMedia('(pointer: coarse)').matches;
const fmt = (m) => `${Math.round(m * 1000) / 10} см`.replace('.', ',');

// ───────────────────────── сцена ─────────────────────────
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
const SKY = new THREE.Color('#EFE6D0');
scene.background = SKY;

const rig = new THREE.Group();          // «тележка» пользователя в VR
scene.add(rig);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
camera.position.set(4.6, 4.4, 6.2);
rig.add(camera);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
ortho.up.set(0, 0, -1);
ortho.position.set(0, 50, 0);
scene.add(ortho);

const world = new THREE.Group();        // комната + мебель; в XR двигается и масштабируется целиком
const roomG = new THREE.Group(), itemsG = new THREE.Group(), dimsG = new THREE.Group(),
  tmpG = new THREE.Group(), gizmo = new THREE.Group();
world.add(roomG, itemsG, dimsG, tmpG, gizmo);
scene.add(world);

scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(5, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 40 });
sun.shadow.bias = -0.0005;
world.add(sun, sun.target);             // свет живёт в координатах комнаты и едет вместе с ней

// Подложка без линии горизонта: земля того же цвета, что фон, а сетка уходит вдаль и растворяется.
const FOG = new THREE.Fog(SKY, 14, 62);
scene.fog = FOG;
const ground = new THREE.Group();
const groundPlane = new THREE.Mesh(new THREE.CircleGeometry(200, 48), new THREE.MeshBasicMaterial({ color: SKY, fog: false }));
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.position.y = -0.03;
const farGrid = new THREE.GridHelper(160, 160, 0x1b1a18, 0x1b1a18);
farGrid.material.transparent = true;
farGrid.material.opacity = 0.14;
farGrid.position.y = -0.012;
ground.add(groundPlane, farGrid);
ground.traverse((o) => { o.raycast = () => {}; });
scene.add(ground);

// ───────────────────────── состояние ─────────────────────────
let state = { room: { w: 4, d: 5, h: 2.7, floor: '#d9c7a8', wall: '#f4f1ea' }, snap: 0.05, items: [], dims: [] };
const objs = new Map();                 // id → THREE.Group
let selId = null, tool = 'select', view = '3d';
let undoStack = [], redoStack = [], cur = '';
const item = (id) => state.items.find((i) => i.id === id);
const sel = () => (selId ? item(selId) : null);

function demo() {
  const pick = (t) => CATALOG.find((c) => c.type === t);
  const mk = (t, x, z, rot = 0, y) => {
    const c = pick(t);
    return { id: uid(), type: t, name: c.name, w: c.w, d: c.d, h: c.h, x, z, y: y ?? (c.y || 0), rot, color: c.color, ...(c.y ? { hold: 'wall' } : {}) };
  };
  // Стартовая комната буквой «Г»: над столом скошенный потолок, в выступе подиум —
  // сразу видно, что стены, пол и потолок лепятся инструментом «Комната».
  const P = 0.15, H = 2.7, L = 1.8;
  const mesh = {
    v: [[-2.5, 0, -2.5], [2.5, 0, -2.5], [2.5, 0, 0.5], [0, 0, 0.5], [-2.5, 0, 0.5],
      [-2.5, P, 0.5], [0, P, 0.5], [0, P, 2.5], [-2.5, P, 2.5],
      [-2.5, H, -2.5], [1.2, H, -2.5], [2.5, L, -2.5], [2.5, L, 0.5], [1.2, H, 0.5], [0, H, 0.5], [0, H, 2.5], [-2.5, H, 2.5]],
    f: [[0, 4, 3, 2, 1], [5, 8, 7, 6], [3, 4, 5, 6],            // пол, подиум, ступенька
      [9, 10, 13, 14, 15, 16], [10, 11, 12, 13],                 // потолок и скос
      [0, 1, 11, 10, 9], [1, 2, 12, 11], [2, 3, 6, 14, 13, 12],  // стены
      [6, 7, 15, 14], [7, 8, 16, 15], [8, 5, 4, 0, 9, 16]],
  };
  return {
    v: 1, room: { w: 5, d: 5, h: H, floor: state.room.floor, wall: state.room.wall, mesh }, snap: 0.05, dims: [],
    items: [mk('bed', -1.7, -1.45), mk('nightstand', -0.65, -2.3), mk('window', 0.6, -2.45),
      mk('desk', 2.2, -1.0, -Math.PI / 2), mk('chair', 1.6, -1.0, Math.PI / 2), mk('door', 1.5, 0.45, Math.PI),
      mk('rug', 0.4, -0.5), mk('wardrobe', -2.2, 1.5, Math.PI / 2, P), mk('stool', -1.2, 2.0, 0, P), mk('human', -0.7, 1.2, 0, P)],
  };
}

function validMesh(m) {
  return !!m && Array.isArray(m.v) && m.v.length >= 4 && m.v.length <= 400 && m.v.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))
    && Array.isArray(m.f) && m.f.length >= 4 && m.f.every((f) => Array.isArray(f) && f.length >= 3 && f.length <= 60 && f.every((i) => Number.isInteger(i) && i >= 0 && i < m.v.length));
}
function normalize(d) {
  const num = (v, def) => (Number.isFinite(+v) ? +v : def);
  const room = d.room || {};
  return {
    room: {
      w: clamp(num(room.w, 4), 0.5, 50), d: clamp(num(room.d, 5), 0.5, 50), h: clamp(num(room.h, 2.7), 0.5, 20),
      floor: room.floor || '#d9c7a8', wall: room.wall || '#f4f1ea', ...(room.blank ? { blank: true } : {}),
      ...(validMesh(room.mesh) ? { mesh: { v: JSON.parse(JSON.stringify(room.mesh.v)), f: JSON.parse(JSON.stringify(room.mesh.f)),
        ...(Array.isArray(room.mesh.c) && room.mesh.c.length === room.mesh.f.length ? { c: room.mesh.c.map((q) => (typeof q === 'string' && /^#[0-9a-f]{6}$/i.test(q) ? q : null)) } : {}) } } : {}),
      ...(room.sun && [room.sun.x, room.sun.y, room.sun.z].every(Number.isFinite) ? { sun: { x: room.sun.x, y: room.sun.y, z: room.sun.z } }
        : room.sun && Number.isFinite(room.sun.az) && Number.isFinite(room.sun.el) ? { sun: { az: room.sun.az, el: room.sun.el } } : {}),
    },
    snap: num(d.snap, 0.05),
    grid: d.grid !== false,
    dims: Array.isArray(d.dims) ? d.dims.filter((m) => m && m.a && m.b) : [],
    items: (Array.isArray(d.items) ? d.items : []).filter((i) => i && i.type && i.type !== 'model').map((i) => ({
      ...i, id: i.id || uid(), name: String(i.name || 'Предмет'),
      w: Math.max(0.01, num(i.w, 0.6)), d: Math.max(0.01, num(i.d, 0.6)), h: Math.max(0.005, num(i.h, 0.6)),
      x: num(i.x, 0), z: num(i.z, 0), y: num(i.y, 0), rot: num(i.rot, 0),
    })),
  };
}

const serialize = () => JSON.stringify({ v: 1, room: state.room, snap: state.snap, grid: state.grid !== false, items: state.items, dims: state.dims });
function save() { try { localStorage.setItem(STORE, cur); } catch { /* приватный режим */ } }
function commit() {
  const s = serialize();
  if (s === cur) return;
  undoStack.push(cur);
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
  cur = s;
  save();
  refreshHistoryButtons();
}
function silentSave() { cur = serialize(); save(); }
function undo() {
  if (!undoStack.length) return;
  redoStack.push(cur);
  cur = undoStack.pop();
  load(JSON.parse(cur)); save(); refreshHistoryButtons();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(cur);
  cur = redoStack.pop();
  load(JSON.parse(cur)); save(); refreshHistoryButtons();
}
function refreshHistoryButtons() {
  vm.dirty = true;
  $('#btnUndo').disabled = !undoStack.length;
  $('#btnRedo').disabled = !redoStack.length;
}

function load(data) {
  roomSel = null;
  state = normalize(data);
  for (const g of objs.values()) { disposeChildren(g); itemsG.remove(g); }
  objs.clear();
  buildRoom();
  for (const it of state.items) makeItemObj(it);
  rebuildDims();
  if (!item(selId)) selId = null;
  updateGizmo(); updateProps(); updateStatus();
}

// ───────────────────────── комната ─────────────────────────
let floorMesh, wallMesh, gridLines, wallEdges, outline, shadowFloor;
function disposeChildren(g) {
  const shared = g.userData.shared;
  for (const c of [...g.children]) {
    g.remove(c);
    if (shared) continue;
    c.traverse((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) if (m && m !== EDGE) { m.map?.dispose?.(); m.dispose?.(); }
    });
  }
  g.userData.shared = false;
}

// Оболочка комнаты — свободная сетка из четырёхугольников: вершины [x, y, z] и грани [a, b, c, d].
// Обход каждой грани такой, что её нормаль смотрит внутрь комнаты. Пол, стены и потолок — равноправные грани:
// любой угол двигается сам, грань при этом сама ломается по диагонали.
function boxMesh(w, d, h) {
  const x = w / 2, z = d / 2;
  return { v: [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z]],
    f: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] };
}
function roomMesh() {
  const R = state.room;
  if (!R.mesh) R.mesh = boxMesh(R.w, R.d, R.h);
  return R.mesh;
}
const mv = (i) => new THREE.Vector3(...roomMesh().v[i]);
function faceNormal(f) {                // нормаль по Ньюэллу — годится и для неплоской грани
  const n = new THREE.Vector3(), p = f.map(mv);
  for (let i = 0; i < p.length; i++) n.add(p[i].clone().cross(p[(i + 1) % p.length]));
  return n.lengthSq() > 1e-12 ? n.normalize() : new THREE.Vector3(0, 1, 0);
}
function meshEdges() {
  const out = new Map();
  for (const f of roomMesh().f) for (let i = 0; i < f.length; i++) {
    const a = Math.min(f[i], f[(i + 1) % f.length]), b = Math.max(f[i], f[(i + 1) % f.length]);
    out.set(a + '_' + b, [a, b]);
  }
  return [...out.values()];
}
// Разрез одной грани по линии между двумя точками на её рёбрах.
function insertOnEdge(a, b, t, m = roomMesh()) {   // новая вершина на ребре a–b, доля t от a; попадает во все грани с этим ребром
  const P = m.v[a], Q = m.v[b];
  m.v.push([0, 1, 2].map((k) => r3(P[k] + (Q[k] - P[k]) * t)));
  const n = m.v.length - 1;
  for (const f of m.f) for (let i = 0; i < f.length; i++) {
    const u = f[i], w = f[(i + 1) % f.length];
    if ((u === a && w === b) || (u === b && w === a)) { f.splice(i + 1, 0, n); break; }
  }
  return n;
}
function commonFace(e1, e2, m = roomMesh()) {      // грань, у которой есть оба ребра
  const has = (f, [a, b]) => f.some((u, i) => { const w = f[(i + 1) % f.length]; return (u === a && w === b) || (u === b && w === a); });
  return m.f.findIndex((f) => has(f, e1) && has(f, e2));
}
function cutFace(A, B) {                // A, B — { a, b, t } на двух разных рёбрах одной грани
  const m = roomMesh();
  if (m.v.length > 200) { toast('В комнате уже очень много изломов'); return false; }
  const fi = commonFace([A.a, A.b], [B.a, B.b]);
  if (fi < 0) return false;
  const v1 = insertOnEdge(A.a, A.b, A.t), v2 = insertOnEdge(B.a, B.b, B.t);
  const f = m.f[fi], i1 = f.indexOf(v1), i2 = f.indexOf(v2);
  if (i1 < 0 || i2 < 0) return false;
  const lo = Math.min(i1, i2), hi = Math.max(i1, i2);
  m.f.splice(fi, 1, f.slice(lo, hi + 1), [...f.slice(hi), ...f.slice(0, lo + 1)]);
  if (m.c) { while (m.c.length < m.f.length - 1) m.c.push(null); m.c.splice(fi, 1, m.c[fi] || null, m.c[fi] || null); }   // обе половины — прежнего цвета
  return true;
}
// Грани остаются плоскими: если сдвиг согнул бы грань, вместе с точкой едет вся эта грань.
function planarPoly(p) {
  const n = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.length; i++) { n.add(p[i].clone().cross(p[(i + 1) % p.length])); c.add(p[i]); }
  const len = n.length();
  if (len < 1e-6) return true;
  n.multiplyScalar(1 / len); c.multiplyScalar(1 / p.length);
  return p.every((q) => Math.abs(n.dot(q.clone().sub(c))) < 0.002);
}
function expandMove(ids, dir) {
  const m = roomMesh(), S = new Set(ids);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of m.f) {
      const cnt = f.filter((i) => S.has(i)).length;
      if (cnt === 0 || cnt === f.length) continue;
      if (planarPoly(f.map(mv)) && !planarPoly(f.map((i) => (S.has(i) ? mv(i).addScaledVector(dir, 0.5) : mv(i))))) { f.forEach((i) => S.add(i)); grew = true; }
    }
  }
  return [...S];
}
function faceAtRay() {                   // грань оболочки под курсором или лучом
  if (!wallMesh) return -1;
  world.updateMatrixWorld(true);
  shellRay.ray.copy(ray.ray);
  const hits = [];
  for (const mesh of [wallMesh, floorMesh]) THREE.Mesh.prototype.raycast.call(mesh, shellRay, hits);
  if (!hits.length) return -1;
  hits.sort((p, q) => p.distance - q.distance);
  return hits[0].object.userData.tri[hits[0].faceIndex] ?? -1;
}
function setFaceColor(c) {              // свой цвет у выделенной стены, пола или потолка; null — как у комнаты
  if (!roomSel || roomSel.kind !== 'f') return;
  const m = roomMesh(), fi = +roomSel.key.slice(1);
  if (!m.c) m.c = m.f.map(() => null);
  while (m.c.length < m.f.length) m.c.push(null);
  m.c[fi] = c;
  buildRoom(); commit(); updateFacePanel();
}
function updateFacePanel() {
  const on = tool === 'room' && !!roomSel && roomSel.kind === 'f' && !renderer.xr.isPresenting, el = $('#facePanel');
  el.hidden = !on;
  if (!on) return;
  const m = roomMesh(), fi = +roomSel.key.slice(1), ny = faceNormal(m.f[fi]).y;
  $('#fTitle').textContent = ny > 0.7 ? 'Пол' : ny < -0.7 ? 'Потолок' : 'Стена';
  markSwatch($('#fSwatches'), (m.c && m.c[fi]) || '');
}
function recenterRoom() {               // габариты комнаты — по сетке; центр возвращаем в ноль, сдвигая всё разом
  const R = state.room, m = roomMesh(), bb = new THREE.Box3();
  for (const p of m.v) bb.expandByPoint(new THREE.Vector3(...p));
  const cx = r3((bb.min.x + bb.max.x) / 2), cz = r3((bb.min.z + bb.max.z) / 2);
  R.w = r3(Math.max(0.5, bb.max.x - bb.min.x)); R.d = r3(Math.max(0.5, bb.max.z - bb.min.z)); R.h = r3(Math.max(0.5, bb.max.y));
  if (Math.abs(cx) < 1e-4 && Math.abs(cz) < 1e-4) return;
  for (const p of m.v) { p[0] = r3(p[0] - cx); p[2] = r3(p[2] - cz); }
  for (const o of state.items) { o.x = r3(o.x - cx); o.z = r3(o.z - cz); placeItem(o); }
  for (const q of state.dims) for (const k of ['a', 'b']) { q[k][0] = r3(q[k][0] - cx); q[k][2] = r3(q[k][2] - cz); }
  if (state.room.sun && Number.isFinite(state.room.sun.x)) { state.room.sun.x = r3(state.room.sun.x - cx); state.room.sun.z = r3(state.room.sun.z - cz); }
  if (renderer.xr.isPresenting) {
    world.position.add(new THREE.Vector3(cx, 0, cz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, world.rotation.y).multiplyScalar(world.scale.x));
  } else for (const v of [controls3d.target, camera.position, controlsPlan.target, ortho.position]) { v.x -= cx; v.z -= cz; }
}
// Высота пола и потолка в точке — лучом по оболочке (грани видны только изнутри).
const shellRay = new THREE.Raycaster();
function shellHit(o, dir) {
  if (!wallMesh) return null;
  world.updateMatrixWorld(true);
  shellRay.set(o.applyMatrix4(world.matrixWorld), dir.transformDirection(world.matrixWorld));
  const hits = [];
  for (const mesh of [wallMesh, floorMesh]) THREE.Mesh.prototype.raycast.call(mesh, shellRay, hits);
  if (!hits.length) return null;
  hits.sort((p, q) => p.distance - q.distance);
  return world.worldToLocal(hits[0].point.clone());
}
function floorAt(x, z) {
  const p = shellHit(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0));
  return p ? r3(p.y) : 0;
}
function ceilAt(x, z) {
  const p = shellHit(new THREE.Vector3(x, floorAt(x, z) + 0.02, z), new THREE.Vector3(0, 1, 0));
  return p ? p.y : state.room.h;
}
function ceilMin(it, x, z) {            // самая низкая точка потолка над предметом
  const c = Math.cos(it.rot), sn = Math.sin(it.rot);
  let m = ceilAt(x, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = (sx * it.w) / 2, lz = (sz * it.d) / 2;
    m = Math.min(m, ceilAt(x + lx * c + lz * sn, z - lx * sn + lz * c));
  }
  return m;
}
// Направление света хранится в комнате: азимут и высота солнца над горизонтом.
function sunPos() {                      // точка над комнатой, из которой светит солнце
  const q = state.room.sun, R = state.room;
  if (q && Number.isFinite(q.x)) return new THREE.Vector3(q.x, q.y, q.z);
  const az = q ? q.az : 0.695, el = clamp(q ? q.el : 0.856, 0.12, 1.5), y = R.h + 0.8, r = clamp(y / Math.tan(el), 0.3, 14);
  return new THREE.Vector3(r * Math.sin(az), y, r * Math.cos(az));
}
function applySun() {
  const p = sunPos();
  if (p.lengthSq() < 1e-4) p.set(0, 1, 0);
  sun.position.copy(p.normalize().multiplyScalar(14));
  sun.target.position.set(0, 0, 0);
}
function buildRoom() {
  disposeChildren(roomG);
  const { w, d, floor, wall } = state.room, m = roomMesh();
  // оболочка: пол отдельно (свой цвет), стены и потолок вместе; грани — плоские многоугольники
  const fpos = [], spos = [], fcol = [], scol = [], ftri = [], stri = [];
  let flat = true;
  m.f.forEach((f, fi) => {
    const n = faceNormal(f), up = n.y > 0.7, out = up ? fpos : spos, P = f.map(mv);
    const col = new THREE.Color((m.c && m.c[fi]) || (up ? floor : wall)), ocol = up ? fcol : scol;
    const u = new THREE.Vector3(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize(), w = n.clone().cross(u);
    const tris = P.length === 3 ? [[0, 1, 2]] : THREE.ShapeUtils.triangulateShape(P.map((q) => new THREE.Vector2(q.dot(u), q.dot(w))), []);
    for (const [i, j, k] of tris) {
      const a = P[i], b = P[j], c = P[k], flip = b.clone().sub(a).cross(c.clone().sub(a)).dot(n) < 0;
      out.push(a.x, a.y, a.z, ...(flip ? [c.x, c.y, c.z, b.x, b.y, b.z] : [b.x, b.y, b.z, c.x, c.y, c.z]));
      for (let q = 0; q < 3; q++) ocol.push(col.r, col.g, col.b);
      (up ? ftri : stri).push(fi);
    }
    if (up && f.some((i) => Math.abs(m.v[i][1]) > 1e-3)) flat = false;
  });
  const geo = (pos, col) => {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  floorMesh = new THREE.Mesh(geo(fpos, fcol), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  floorMesh.userData.tri = ftri;
  floorMesh.receiveShadow = true;
  wallMesh = new THREE.Mesh(geo(spos, scol), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  wallMesh.userData.tri = stri;
  wallMesh.receiveShadow = true;
  const epos = [];                      // все рёбра граней, включая линии разреза на ровной поверхности
  for (const [a, b] of meshEdges()) epos.push(...m.v[a], ...m.v[b]);
  wallEdges = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(epos, 3)), EDGE);

  // двойная сетка по полу (пока он ровный): мелкая, еле заметная, — шаг привязки; крупная — ровно 1 м
  const fine = [], big = [], st = state.snap >= 0.05 ? state.snap : state.snap > 0 ? state.snap * 10 : 0;
  if (flat) {
    const lines = (step, out) => {
      for (let x = Math.ceil(-w / 2 / step - 1e-6) * step; x <= w / 2 + 1e-6; x += step) out.push(x, 0, -d / 2, x, 0, d / 2);
      for (let z = Math.ceil(-d / 2 / step - 1e-6) * step; z <= d / 2 + 1e-6; z += step) out.push(-w / 2, 0, z, w / 2, 0, z);
    };
    if (st > 0 && st < 1) lines(st, fine);
    lines(1, big);
  }
  const gl = (pts, opacity) => new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
    new THREE.LineBasicMaterial({ color: 0x1b1a18, transparent: true, opacity }));
  gridLines = new THREE.Group().add(gl(fine, 0.05), gl(big, 0.2));
  gridLines.position.y = 0.003;

  const o = [-w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2];
  outline = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(o, 3)),
    new THREE.LineBasicMaterial({ color: 0xa61e1e }));
  outline.position.y = 0.004;
  // в сквозном режиме пола нет — тени ложатся на прозрачную подложку поверх настоящего пола
  shadowFloor = new THREE.Mesh(geo(fpos), new THREE.ShadowMaterial({ opacity: 0.28 }));
  shadowFloor.position.y = 0.002;
  shadowFloor.receiveShadow = true;
  for (const mesh of [floorMesh, gridLines, wallMesh, wallEdges, outline, shadowFloor]) mesh.raycast = () => {};
  roomG.add(floorMesh, gridLines, wallMesh, wallEdges, outline, shadowFloor);
  applySun();
  updateXRVis();
}

// ───────────────────────── предметы ─────────────────────────
function fillItem(it, g) {
  disposeChildren(g);
  fillBlank(g, it.type, it.w, it.d, it.h, it.color, it.open, it.pose);
}
function placeItem(it) {
  const g = objs.get(it.id);
  if (!g) return;
  g.position.set(it.x, it.y || 0, it.z);
  g.rotation.y = it.rot || 0;
}
function makeItemObj(it) {
  const g = new THREE.Group();
  g.userData.id = it.id;
  objs.set(it.id, g);
  itemsG.add(g);
  fillItem(it, g);
  placeItem(it);
  return g;
}

function footprint(it) {
  const c = Math.abs(Math.cos(it.rot)), s = Math.abs(Math.sin(it.rot));
  return { hx: (c * it.w + s * it.d) / 2, hz: (s * it.w + c * it.d) / 2 };
}

// привязка: сетка → стены и края соседей (приоритетнее)
function snapPos(it, x, z) {
  const step = state.snap;
  if (!(step > 0)) return [x, z];
  let nx = Math.round(x / step) * step, nz = Math.round(z / step) * step;
  const f = footprint(it), T = 0.08, R = state.room;
  let bx = T, bz = T, sx = null, sz = null;
  const tryX = (edge, target) => { const dd = Math.abs(target - edge); if (dd < bx) { bx = dd; sx = x + target - edge; } };
  const tryZ = (edge, target) => { const dd = Math.abs(target - edge); if (dd < bz) { bz = dd; sz = z + target - edge; } };
  tryX(x - f.hx, -R.w / 2); tryX(x + f.hx, R.w / 2);
  tryZ(z - f.hz, -R.d / 2); tryZ(z + f.hz, R.d / 2);
  for (const o of state.items) {
    if (o.id === it.id) continue;
    const g = footprint(o);
    if (Math.abs(z - o.z) < f.hz + g.hz + T)
      for (const e of [o.x - g.hx, o.x + g.hx]) { tryX(x - f.hx, e); tryX(x + f.hx, e); }
    if (Math.abs(x - o.x) < f.hx + g.hx + T)
      for (const e of [o.z - g.hz, o.z + g.hz]) { tryZ(z - f.hz, e); tryZ(z + f.hz, e); }
  }
  if (sx !== null) nx = sx;
  if (sz !== null) nz = sz;
  return [r3(nx), r3(nz)];
}
// ── «гравитация»: на что встанет предмет в точке (x, z) ──
const NOSUP = new Set(['wall', 'door', 'window', 'human', 'plant', 'lamp', 'tv', 'picture', ...NOSUP_T]);
const downRay = new THREE.Raycaster();
// То, что стоит на предмете, едет вместе с ним и не считается ему опорой.
let dragSkip = new Set();
function ridersOf(base, seen = new Set([base.id])) {
  const out = [], g = objs.get(base.id);
  if (!g) return out;
  const f = footprint(base);
  for (const o of state.items) {
    if (seen.has(o.id) || o.hold) continue;
    if (Math.abs(o.x - base.x) > f.hx + 0.01 || Math.abs(o.z - base.z) > f.hz + 0.01 || o.y < base.y + 0.01) continue;
    const top = topOf(g, o.x, o.z);
    if (top === null || Math.abs(o.y - top) > 0.03) continue;
    seen.add(o.id);
    out.push(o, ...ridersOf(o, seen));
  }
  return out;
}
function settle(list) {                 // опустить на опору то, что осталось без неё
  for (const o of [...list].sort((a, b) => a.y - b.y)) {
    if (!item(o.id) || o.hold) continue;
    o.y = restY(o, o.x, o.z);
    placeItem(o);
    refreshDims(o.id);
  }
}
// Поза человечка. «Сидит» бывает двух видов: на краю опоры голени свисают, посреди опоры или на полу ноги вытянуты вперёд.
function setPose(it, pose, exact) {
  if (pose === 'sit' && !exact) {
    const kk = it.h / 1.75, fx = it.x + Math.sin(it.rot) * 0.45 * kk, fz = it.z + Math.cos(it.rot) * 0.45 * kk;
    if (restY(it, fx, fz) > it.y - 0.2) pose = 'sitf';
  }
  if ((it.pose || 'stand') === pose) return false;
  if (pose === 'stand') delete it.pose; else it.pose = pose;
  const g = objs.get(it.id);
  if (g) fillItem(it, g);
  ptCache.delete(it.id);
  return true;
}
function restY(it, x, z) {
  const fl = floorAt(x, z);              // пол может быть неровным
  if (RUGS.has(it.type)) return fl;
  const cands = [];
  for (const o of state.items) {
    if (o.id === it.id || NOSUP.has(o.type) || dragSkip.has(o.id)) continue;
    const f = footprint(o);
    if (Math.abs(x - o.x) > f.hx || Math.abs(z - o.z) > f.hz) continue;
    const g = objs.get(o.id);
    if (g) cands.push(g);
  }
  if (!cands.length) return fl;
  world.updateMatrixWorld(true);
  downRay.set(new THREE.Vector3(x, 1000, z).applyMatrix4(world.matrixWorld),
    new THREE.Vector3(0, -1, 0).transformDirection(world.matrixWorld));
  const tops = new Map();
  for (const h of downRay.intersectObjects(cands, true)) {
    let g = h.object;
    while (g && g.parent !== itemsG) g = g.parent;
    const o = g && item(g.userData.id);
    if (o && !tops.has(o)) tops.set(o, world.worldToLocal(h.point.clone()).y);
  }
  let level = fl;                        // если предмет не помещается под опорой — он встаёт на неё
  for (const [o, top] of [...tops].sort((a, b) => a[0].y - b[0].y))
    if (o.y - level < it.h - 1e-3) level = Math.max(level, top);
  if (level + it.h > ceilMin(it, x, z) + 1e-3) level = fl;
  return r3(level);
}
function topOf(group, x, z) {            // высота верхней поверхности предмета в точке (x, z)
  world.updateMatrixWorld(true);
  downRay.set(new THREE.Vector3(x, 1000, z).applyMatrix4(world.matrixWorld),
    new THREE.Vector3(0, -1, 0).transformDirection(world.matrixWorld));
  const h = downRay.intersectObject(group, true)[0];
  return h ? world.worldToLocal(h.point.clone()).y : null;
}
function topUnder(it, lr) {             // на чью верхнюю грань смотрит курсор (сам предмет не в счёт)
  const cands = [];
  for (const o of state.items) if (o.id !== it.id && !NOSUP.has(o.type) && !dragSkip.has(o.id)) { const g = objs.get(o.id); if (g) cands.push(g); }
  if (!cands.length) return null;
  world.updateMatrixWorld(true);
  downRay.set(lr.o.clone().applyMatrix4(world.matrixWorld), lr.d.clone().transformDirection(world.matrixWorld));
  const h = downRay.intersectObjects(cands, true)[0];
  if (!h || !h.face) return null;
  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  if (n.y < 0.6) return null;
  let g = h.object;
  while (g && g.parent !== itemsG) g = g.parent;
  const pl = world.worldToLocal(h.point.clone());
  return g ? { x: pl.x, y: pl.y, z: pl.z, g } : null;
}
function roomExit(lr) {                 // точка, в которой луч выходит из объёма комнаты
  const R = state.room, mn = [-R.w / 2, 0, -R.d / 2], mx = [R.w / 2, R.h, R.d / 2];
  const o = lr.o.toArray(), d = lr.d.toArray();
  let t0 = -Infinity, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) { if (o[i] < mn[i] || o[i] > mx[i]) return null; continue; }
    const a = (mn[i] - o[i]) / d[i], b = (mx[i] - o[i]) / d[i];
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 > 0 && t1 >= t0 ? lr.o.clone().addScaledVector(lr.d, t1) : null;
}
function makeGrab(it, pl, free = false) {   // pl — точка захвата в координатах world
  return { id: it.id, rel: pl.y - it.y, off: { x: it.x - pl.x, z: it.z - pl.z }, base: it.y, free,
    float: it.y > restY(it, it.x, it.z) + 0.02, changed: false, turned: false,
    hang: it.y > restY(it, it.x, it.z) + 0.02 && it.y + it.h > ceilMin(it, it.x, it.z) - 0.03,   // висит под потолком
    riders: free ? [] : ridersOf(it).map((o) => ({ o, dx: o.x - it.x, dy: o.y - it.y, dz: o.z - it.z })) };
}
// Перетаскивание: предмет всегда к чему-то примагничен — к полу, к другому предмету, к стене или к потолку.
// В воздухе он не остаётся: оторванный от стены падает на опору. Поднять в воздух можно только инструментом «По осям».
function dragMove(it, g, lr) {
  dragSkip = new Set((g.riders || []).map((r) => r.o.id));
  const ok = dragMoveCore(it, g, lr);
  dragSkip = new Set();
  if (!ok) return false;
  if (g.free) { if (it.y > restY(it, it.x, it.z) + 0.02) it.hold = 'free'; else delete it.hold; }
  else if (g.float) it.hold = 'wall'; else delete it.hold;
  if (it.type === 'human' && !g.free) {  // человечек: на мебели садится, на полу встаёт
    setPose(it, !g.float && it.y > floorAt(it.x, it.z) + 0.05 ? 'sit' : 'stand');
  }
  for (const r of g.riders || []) { r.o.x = r3(it.x + r.dx); r.o.y = r3(it.y + r.dy); r.o.z = r3(it.z + r.dz); placeItem(r.o); refreshDims(r.o.id); }
  return true;
}
// Магнит при перетаскивании. Точка захвата на предмете даёт «щупы» — её проекции на грани габарита предмета
// по его собственным осям. Нижний щуп ищет опору под собой, боковой прижимается к стене или к боку мебели,
// верхний — к потолку. Точка захвата при этом остаётся под курсором, поэтому предмет не прыгает.
function castScene(o, d, it) {          // первое, во что упирается луч: мебель или оболочка комнаты (в координатах world)
  world.updateMatrixWorld(true);
  const groups = [];
  for (const q of state.items) if (q.id !== it.id && !dragSkip.has(q.id)) { const gr = objs.get(q.id); if (gr) groups.push(gr); }
  downRay.set(o.clone().applyMatrix4(world.matrixWorld), d.clone().transformDirection(world.matrixWorld));
  const hits = downRay.intersectObjects(groups, true);
  if (wallMesh) for (const mesh of [wallMesh, floorMesh]) THREE.Mesh.prototype.raycast.call(mesh, downRay, hits);
  hits.sort((a, b) => a.distance - b.distance);
  const inv = new THREE.Matrix4().copy(world.matrixWorld).invert();
  for (const h of hits) {
    if (!h.face) continue;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).transformDirection(inv);
    const room = h.object === wallMesh || h.object === floorMesh;
    let q = null;
    if (!room) {
      let gr = h.object;
      while (gr && gr.parent !== itemsG) gr = gr.parent;
      q = gr && item(gr.userData.id);
      if (!q || n.y < -0.3) continue;                    // низ мебели опорой не бывает
      if (n.y > 0.6 && NOSUP.has(q.type)) continue;      // на растение или лампу ничего не ставим
      if (n.y > 0.6 && RUGS.has(it.type)) continue;      // ковёр — только на пол
    }
    return { p: world.worldToLocal(h.point.clone()), n, room, q };
  }
  return null;
}
function dragMoveCore(it, g, lr) {
  const R = state.room, st = state.snap;
  if (g.free) {
    const p = hitPlaneY(lr, it.y + g.rel);
    if (!p) return false;
    [it.x, it.z] = snapPos(it, p.x + g.off.x, p.z + g.off.z);
    return true;
  }
  let x, z, y, float = false;
  // нижний щуп: луч, опущенный на высоту захвата, ищет опору — пол или верх мебели
  let h = castScene(lr.o.clone().setY(lr.o.y - g.rel), lr.d, it);
  if (!h || h.n.y <= 0.6) h = castScene(lr.o, lr.d, it) || h;   // иначе смотрим, во что упирается сам курсор
  if (!h) {                             // мимо комнаты: предмет встаёт на землю снаружи
    const p = hitPlaneY({ o: lr.o.clone().setY(lr.o.y - g.rel), d: lr.d }, 0);
    if (!p) return false;
    h = { p, n: new THREE.Vector3(0, 1, 0), room: true, ground: true };
  }
  if (h.n.y > 0.6) {                    // опора под предметом
    x = h.p.x + g.off.x; z = h.p.z + g.off.z; y = h.p.y;
    if (h.room && st > 0) {             // на полу действуют сетка, края соседей и стены
      const f = footprint(it);
      [x, z] = snapPos(it, x, z);
      if (h.ground) {                   // снаружи: вплотную к стене с другой стороны, внутрь не заходит
        const px = R.w / 2 + f.hx - Math.abs(x), pz = R.d / 2 + f.hz - Math.abs(z);
        if (px > 0 && pz > 0 && !R.blank) { if (px < pz) x = Math.sign(x || 1) * (R.w / 2 + f.hx); else z = Math.sign(z || 1) * (R.d / 2 + f.hz); }
      } else {
        if (R.w >= 2 * f.hx) x = clamp(x, -R.w / 2 + f.hx, R.w / 2 - f.hx);
        if (R.d >= 2 * f.hz) z = clamp(z, -R.d / 2 + f.hz, R.d / 2 - f.hz);
      }
      y = floorAt(x, z);
    }
  } else if (h.n.y < -0.6) {            // потолок: верхний щуп
    x = h.p.x + g.off.x; z = h.p.z + g.off.z;
    y = ceilMin(it, x, z) - it.h;
    float = true;
  } else {                              // стена или бок мебели: боковой щуп прижимает предмет вплотную
    const nh = new THREE.Vector2(h.n.x, h.n.z).normalize(), c = Math.cos(it.rot), sn = Math.sin(it.rot);
    const e = (Math.abs(c * nh.x - sn * nh.y) * it.w) / 2 + (Math.abs(sn * nh.x + c * nh.y) * it.d) / 2;
    const along = g.off.x * nh.x + g.off.z * nh.y;
    x = h.p.x + nh.x * e + (g.off.x - along * nh.x);
    z = h.p.z + nh.y * e + (g.off.z - along * nh.y);
    const rest = restY(it, x, z);
    y = rest;
    // по стене и по боку другой мебели предмет можно поднять: он приклеивается на высоте курсора
    const climb = h.p.y - g.rel, dead = g.float ? 0.05 : 0.35;
    if (climb >= rest + dead) { y = st > 0 ? Math.round(climb / st) * st : climb; float = true; }
  }
  const ch = ceilMin(it, x, z);
  if (ch >= it.h && y + it.h > ch - (float ? 0.06 : 0)) { y = ch - it.h; float = y > restY(it, x, z) + 0.02; }
  it.x = r3(x); it.z = r3(z); it.y = r3(y);
  g.float = float;
  g.base = y;
  return true;
}
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
function axisParam(lr, a0, u) {         // ближайшая к лучу точка на оси, проходящей через a0
  const w = a0.clone().sub(lr.o), b = u.dot(lr.d), den = 1 - b * b;
  if (den < 1e-4) return null;
  const s = (b * lr.d.dot(w) - u.dot(w)) / den;
  return Math.abs(s) < 200 ? s : null;
}
const snapLen = (v) => (state.snap > 0 ? Math.max(state.snap, Math.round(v / state.snap) * state.snap) : v);
const snapRot = (a) => { const s = Math.PI / 12; return state.snap > 0 ? Math.round(a / s) * s : a; };

function spawnXZ() {
  if (renderer.xr.isPresenting) {
    let p = null;
    if (xr.mode === 'ar' && xr.aim && !ctrls.some((c) => c.userData.src?.targetRayMode === 'tracked-pointer')) p = xr.aim.clone();
    else if (!xr.mini) {
      const h = camera.getWorldPosition(new THREE.Vector3()), f = camera.getWorldDirection(new THREE.Vector3());
      f.y = 0;
      if (f.lengthSq() > 1e-6) p = h.addScaledVector(f.normalize(), 1.3).setY(rig.position.y);
    }
    if (!p) return [0, 0];
    world.updateMatrixWorld(true);
    world.worldToLocal(p);
    return [p.x, p.z];
  }
  const t = ctl().target;
  return [t.x, t.z];
}

function addItemData(it) {
  let [x, z] = spawnXZ();
  if (!renderer.xr.isPresenting) {
    const f = footprint(it), R = state.room;
    if (R.w > 2 * f.hx) x = clamp(x, -R.w / 2 + f.hx, R.w / 2 - f.hx);
    if (R.d > 2 * f.hz) z = clamp(z, -R.d / 2 + f.hz, R.d / 2 - f.hz);
  }
  while (state.items.some((o) => Math.abs(o.x - x) < 0.03 && Math.abs(o.z - z) < 0.03)) { x += 0.2; z += 0.2; }
  it.x = r3(x); it.z = r3(z);
  const R = state.room;
  if (it.y > 0.02) {                    // настенный предмет сразу встаёт на ближайшую стену, лицом в комнату
    const opts = [[Math.abs(z + R.d / 2), 0], [Math.abs(z - R.d / 2), Math.PI], [Math.abs(x + R.w / 2), Math.PI / 2], [Math.abs(x - R.w / 2), -Math.PI / 2]];
    it.rot = opts.sort((p, q) => p[0] - q[0])[0][1];
    const f = footprint(it);
    if (it.rot === 0) it.z = r3(-R.d / 2 + f.hz); else if (it.rot === Math.PI) it.z = r3(R.d / 2 - f.hz);
    else if (it.rot > 0) it.x = r3(-R.w / 2 + f.hx); else it.x = r3(R.w / 2 - f.hx);
    it.hold = 'wall';
  }
  state.items.push(it);
  makeItemObj(it);
  if (!it.hold) { it.y = restY(it, it.x, it.z); placeItem(it); }   // остальное — на пол или на мебель под ним
  select(it.id);
  commit();
  return it;
}
function addBlank(def) {
  return addItemData({ id: uid(), type: def.type, name: def.name, w: def.w, d: def.d, h: def.h,
    x: 0, z: 0, y: def.y || 0, rot: 0, color: def.color });
}
function removeItem(id) {
  const gone = item(id), riders = gone ? ridersOf(gone) : [];
  for (const m of state.dims) for (const k of ['a', 'b'])   // размеры, привязанные к предмету, остаются на месте
    if (m[k + 'i']?.id === id) { m[k] = dimEnd(m, k).toArray().map(r3); delete m[k + 'i']; }
  const g = objs.get(id);
  if (g) { disposeChildren(g); itemsG.remove(g); objs.delete(id); }
  state.items = state.items.filter((i) => i.id !== id);
  settle(riders);
  if (selId === id) select(null);
  commit();
}
function duplicate(id) {
  const it = item(id);
  if (!it) return;
  const c = { ...it, id: uid(), x: r3(it.x + 0.3), z: r3(it.z + 0.3) };
  state.items.push(c);
  makeItemObj(c);
  select(c.id);
  commit();
}
function rotateSel(a) {
  const it = sel();
  if (!it || it.lock) return;
  const riders = ridersOf(it);
  it.rot = snapRot(it.rot + a);
  placeItem(it); settle(riders); updateGizmo(); updateProps(); refreshDims(it.id); commit();
}

// ───────────────────────── камеры и вид ─────────────────────────
const controls3d = new OrbitControls(camera, canvas);
controls3d.target.set(0, 0.6, 0);
controls3d.maxPolarAngle = Math.PI / 2 - 0.02;
controls3d.minDistance = 0.4;
controls3d.maxDistance = 60;
controls3d.zoomToCursor = true;
controls3d.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };   // левая — сдвиг сцены, правая — поворот
const controlsPlan = new OrbitControls(ortho, canvas);
controlsPlan.enableRotate = false;
controlsPlan.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controlsPlan.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
controlsPlan.minZoom = 0.2;
controlsPlan.maxZoom = 30;
controlsPlan.zoomToCursor = true;
controlsPlan.enabled = false;
const cam = () => (view === 'plan' ? ortho : camera);
const ctl = () => (view === 'plan' ? controlsPlan : controls3d);

function homeView() {                    // вид и положение комнаты по умолчанию
  camera.position.set(4.6, 4.4, 6.2);
  controls3d.target.set(0, 0.6, 0);
  ortho.position.set(0, 50, 0);
  controlsPlan.target.set(0, 0, 0);
  ortho.zoom = 1;
  fitOrtho();
  if (renderer.xr.isPresenting) {       // в шлеме комната снова встаёт вокруг точки входа
    world.position.set(0, 0, 0); world.rotation.set(0, 0, 0);
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    if (xr.mini) setMini(false);
  }
}
function fitOrtho() {
  const a = innerWidth / innerHeight;
  const S = Math.max(state.room.d, state.room.w / a) * 0.62 + 0.6;
  ortho.left = -S * a; ortho.right = S * a; ortho.top = S; ortho.bottom = -S;
  ortho.updateProjectionMatrix();
}
function setView(v) {
  if (drag) return;
  view = v;
  controls3d.enabled = v === '3d';
  controlsPlan.enabled = v === 'plan';
  if (v === 'plan') fitOrtho();
  $('#btn3d').classList.toggle('on', v === '3d');
  $('#btnPlan').classList.toggle('on', v === 'plan');
  updateXRVis();
}
// Мягкое затенение в углах и под мебелью (на экране; в шлеме сцена рисуется напрямую).
let post = null;
async function initPost() {
  if (coarse) return;                   // на телефоне бережём скорость
  try {
    const base = 'three/addons/postprocessing/';
    const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }] = await Promise.all([
      import(base + 'EffectComposer.js'), import(base + 'RenderPass.js'), import(base + 'GTAOPass.js'), import(base + 'OutputPass.js')]);
    class SoftAO extends GTAOPass {     // ручки, размеры и подложка в затенении не участвуют
      overrideVisibility() {
        super.overrideVisibility();
        for (const o of [gizmo, dimsG, tmpG, ground, snapMarker, eraseBox, cutMarker, cutMarkerA, cutLine]) o.visible = false;
      }
    }
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(sz.x, sz.y, { samples: 4, type: THREE.HalfFloatType }));
    const rp = new RenderPass(scene, camera);
    composer.addPass(rp);
    const ao = [camera, ortho].map((c) => {
      const p = new SoftAO(scene, c, sz.x, sz.y);
      p.blendIntensity = 0.75;
      p.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
      p.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 8, radiusExponent: 2, rings: 2, samples: 16 });
      composer.addPass(p);
      return p;
    });
    composer.addPass(new OutputPass());
    composer.setSize(innerWidth, innerHeight);
    post = { composer, render(c) { rp.camera = c; ao[0].enabled = c === camera; ao[1].enabled = false; composer.render(); } };
  } catch (e) { console.warn('Затенение недоступно', e); post = null; }
}
function resize() {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(innerWidth, innerHeight, false);
  if (post) post.composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fitOrtho();
}
addEventListener('resize', resize);

// ───────────────────────── лучи и выбор ─────────────────────────
const ray = new THREE.Raycaster();
const curPx = new THREE.Vector4();
const ndc = new THREE.Vector2(), _inv = new THREE.Matrix4(), _v = new THREE.Vector3(), _c = new THREE.Vector3();

function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  curPx.set(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  ray.setFromCamera(ndc, cam());
}
function localRay(r) {                  // луч в координатах группы world
  world.updateMatrixWorld(true);
  _inv.copy(world.matrixWorld).invert();
  return { o: r.origin.clone().applyMatrix4(_inv), d: r.direction.clone().transformDirection(_inv) };
}
function hitPlaneY(lr, y) {
  if (Math.abs(lr.d.y) < 1e-5) return null;
  const t = (y - lr.o.y) / lr.d.y;
  if (!(t > 0) || t > 400) return null;
  return lr.o.clone().addScaledVector(lr.d, t);
}
function pickItem() {
  const hits = ray.intersectObjects(itemsG.children, true);
  for (const h of hits) {
    let o = h.object;
    while (o && o.parent !== itemsG) o = o.parent;
    if (o && o.userData.id) return { id: o.userData.id, point: h.point.clone(), hit: h };
  }
  return null;
}

// ───────────────────────── выделение и «ручки» ─────────────────────────
const SEL = new THREE.LineBasicMaterial({ color: 0x1f6feb, depthTest: false, transparent: true });
const HCOL = { x: 0xa61e1e, z: 0x2e9e4f, y: 0x1f6feb };
let handles = [], arrows = [];
const ringR = (it) => Math.hypot(it.w, it.d) / 2 + 0.12;

function select(id) {
  selId = id && item(id) ? id : null;
  updateGizmo(); updateProps(); updateStatus(); updateXRHint();
}
function addArrows(hold, axes) {         // стрелки перемещения по осям комнаты
  for (const [axis, rx, rz] of [['x', 0, -Math.PI / 2], ['y', 0, 0], ['z', Math.PI / 2, 0]]) {
    if (!axes.includes(axis)) continue;
    const a = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: HCOL[axis], depthTest: false, transparent: true });
    a.rotation.set(rx, 0, rz);
    a.userData = { mat: m, col: HCOL[axis] };
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8).translate(0, 0.5, 0), m);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.24, 16).translate(0, 1.1, 0), m);
    shaft.renderOrder = cone.renderOrder = 12;
    a.add(shaft, cone);
    for (const t of [0.4, 0.75, 1.1]) {
      const pk = new THREE.Object3D();
      pk.position.y = t;
      pk.userData = { axis, arrow: a };
      a.add(pk);
      handles.push(pk);
    }
    hold.add(a);
    arrows.push(a);
  }
}
let roomSel = null;                     // выделенный элемент оболочки: { key, kind: 'v' | 'e' | 'f' | 'sun', ids }
let hot = null;                         // ручка под курсором / лучом
function setHot(h) {
  const t = h ? h.userData.arrow || h : null;
  if (t === hot) return;
  if (hot && hot.userData.mat) hot.userData.mat.color.set(hot.userData.col);
  hot = t;
  if (hot && hot.userData.mat) hot.userData.mat.color.set(0x1b1a18);   // под курсором — чёрная, размер прежний
}
function updateGizmo() {
  hot = null;
  for (const c of [...gizmo.children]) {
    gizmo.remove(c);
    c.traverse((o) => { o.geometry?.dispose(); if (o.material && o.material !== SEL) o.material.dispose(); });
  }
  handles = []; arrows = [];
  if (tool === 'room') {                // ручки оболочки: вершины, рёбра, грани и солнце
    gizmo.visible = true;
    gizmo.position.set(0, 0, 0);
    gizmo.rotation.y = 0;
    const m = roomMesh(), key = roomSel ? roomSel.key : '';
    let selPos = null;
    const mk = (p, el, col, cs, shape, dir) => {
      if (el.key === key) { col = 0xa61e1e; selPos = p.clone(); }
      const g = shape === 'edge' ? new THREE.CapsuleGeometry(0.55, 4.5, 6, 12) : shape === 'face' ? new THREE.BoxGeometry(2.6, 0.5, 2.6) : new THREE.SphereGeometry(1, 16, 12);
      const hm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true }));
      hm.position.copy(p);
      if (dir) hm.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, dir.clone().normalize());
      hm.renderOrder = 11;
      hm.userData = { el, cs: cs * (coarse ? 1.6 : 1), mat: hm.material, col, pr: shape ? 2 : 1 };
      gizmo.add(hm);
      handles.push(hm);
    };
    m.v.forEach((_, i) => mk(mv(i), { kind: 'v', ids: [i], key: 'v' + i }, 0x1f6feb, 0.009));
    for (const [a, b] of meshEdges()) {
      const A = mv(a), B = mv(b);
      mk(A.clone().add(B).multiplyScalar(0.5), { kind: 'e', ids: [a, b], key: `e${a}_${b}` }, 0x1f6feb, 0.007, 'edge', B.clone().sub(A));
    }
    m.f.forEach((f, i) => {
      const c = new THREE.Vector3(), n = faceNormal(f);
      for (const id of f) c.add(mv(id));
      mk(c.multiplyScalar(1 / f.length), { kind: 'f', ids: [...f], key: 'f' + i, n }, 0x1f6feb, 0.006, 'face', n);
    });
    const sp = sunPos();                // солнце: нажмите — появятся стрелки
    mk(sp, { kind: 'sun', ids: [], key: 'sun' }, 0xffb300, 0.02);
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([sp, new THREE.Vector3(0, 0, 0)]),
      new THREE.LineDashedMaterial({ color: 0xffb300, dashSize: 0.12, gapSize: 0.08, depthTest: false, transparent: true }));
    ln.computeLineDistances();
    ln.renderOrder = 10;
    ln.raycast = () => {};
    gizmo.add(ln);
    gizmo.userData.selPos = selPos;
    updateFacePanel();
    if (selPos) {                       // стрелки у выделенного элемента
      const hold = new THREE.Group();
      hold.position.copy(selPos);
      gizmo.add(hold);
      const free = roomSel.kind === 'sun' ? [] : ['x', 'y', 'z'].filter((ax) => expandMove(roomSel.ids, AXES[ax]).length === roomSel.ids.length);
      addArrows(hold, free.length ? free : ['x', 'y', 'z']);   // если сам не двигается никуда — тянет соседние грани
    }
    return;
  }
  const it = sel();
  gizmo.visible = !!it;
  if (!it) return;
  gizmo.position.set(it.x, it.y, it.z);
  gizmo.rotation.y = it.rot;
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(it.w + 0.012, it.h + 0.012, it.d + 0.012)), SEL);
  box.position.y = it.h / 2;
  box.renderOrder = 10;
  gizmo.add(box);
  if (tool === 'select' && !it.lock) addGumball(it);
}
// Гамбол, как в Rhino: в одном месте стрелки перемещения, кубики растяжения и дуга поворота.
// Оси — самого предмета; всё постоянного размера на экране.
function addGumball(it) {
  const hold = new THREE.Group();
  hold.position.y = it.h / 2;
  gizmo.add(hold);
  const part = (col, rx, rz) => {
    const a = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true });
    a.rotation.set(rx, 0, rz);
    a.userData = { mat: m, col };
    hold.add(a);
    arrows.push(a);
    return a;
  };
  const put = (a, geo, ro = 12) => { const q = new THREE.Mesh(geo, a.userData.mat); q.renderOrder = ro; a.add(q); };
  const grip = (a, pos, data) => { const pk = new THREE.Object3D(); pk.position.set(...pos); pk.userData = { ...data, arrow: a }; a.add(pk); handles.push(pk); };
  for (const [axis, rx, rz] of [['x', 0, -Math.PI / 2], ['y', 0, 0], ['z', Math.PI / 2, 0]]) {
    const ar = part(HCOL[axis], rx, rz);                    // стрелка: перемещение вдоль оси
    put(ar, new THREE.CylinderGeometry(0.018, 0.018, 1, 8).translate(0, 0.5, 0));
    put(ar, new THREE.ConeGeometry(0.07, 0.22, 16).translate(0, 1.1, 0));
    for (const t of [0.45, 0.8, 1.1]) grip(ar, [0, t, 0], { kind: 'move', axis });
    const sc = part(HCOL[axis], rx, rz);                    // кубик за стрелкой: тянуть эту сторону
    put(sc, new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0, 1.5, 0), 13);
    grip(sc, [0, 1.5, 0], { kind: 'scale', axis, sign: 1 });
    if (axis === 'y') continue;
    const sb = part(HCOL[axis], rx, rz);                    // кубик с обратной стороны: тянуть противоположную грань
    put(sb, new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6).translate(0, -0.3, 0));
    put(sb, new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0, -0.62, 0), 13);
    grip(sb, [0, -0.62, 0], { kind: 'scale', axis, sign: -1 });
  }
  const hub = part(0xf3ead4, 0, 0);                         // шарик в центре: обычное перетаскивание с магнитом
  put(hub, new THREE.SphereGeometry(0.085, 18, 12), 14);
  const rim = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 12), new THREE.MeshBasicMaterial({ color: 0x1b1a18, side: THREE.BackSide, depthTest: false, transparent: true }));
  rim.renderOrder = 13;
  hub.add(rim);
  grip(hub, [0, 0, 0], { kind: 'grab' });
  const arc = part(HCOL.y, 0, 0);                           // дуга между красной и зелёной стрелкой: поворот
  put(arc, new THREE.TorusGeometry(0.72, 0.02, 8, 28, Math.PI / 2).rotateX(Math.PI / 2));
  for (const a of [16, 24, 32, 40, 48, 56, 64, 72]) { const r = THREE.MathUtils.degToRad(a); grip(arc, [0.72 * Math.cos(r), 0, 0.72 * Math.sin(r)], { kind: 'rot' }); }
}
// высота видимой области (в единицах world) на расстоянии объекта — для элементов постоянного экранного размера
function viewHeightAt(obj) {
  const c = renderer.xr.isPresenting ? camera : cam(), ws = world.scale.x || 1;
  if (c.isOrthographicCamera) return (c.top - c.bottom) / c.zoom / ws;
  obj.getWorldPosition(_v); c.getWorldPosition(_c);
  return (_v.distanceTo(_c) * 2 * Math.tan(THREE.MathUtils.degToRad(c.fov / 2))) / ws;
}
const _m1 = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _n = new THREE.Vector3(), _up = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const _pa = new THREE.Vector2(), _pb = new THREE.Vector2(), _pc = new THREE.Vector2(), _q = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1), _winv = new THREE.Matrix4();
function updateConstSize() {
  for (const h of handles) if (h.userData.cs) h.scale.setScalar(h.userData.cs * viewHeightAt(h));
  for (const a of arrows) a.scale.setScalar((coarse ? 0.16 : 0.12) * viewHeightAt(a));
  for (const cm2 of [cutMarker, cutMarkerA]) if (cm2.visible) cm2.scale.setScalar((coarse ? 0.014 : 0.009) * viewHeightAt(cm2));
  if (snapMarker.visible) snapMarker.scale.setScalar((snapMarker.userData.cs || 0.01) * viewHeightAt(snapMarker));
  // Таблички размеров: на экране — постоянный экранный размер, лицом к камере;
  // в шлеме — постоянный настоящий размер, строго вертикально, поворачиваются к зрителю только вокруг вертикали.
  const inXR = renderer.xr.isPresenting, c = inXR ? camera : cam();
  world.updateMatrixWorld(true);
  _winv.copy(world.matrixWorld).invert();
  const cl = world.worldToLocal(c.getWorldPosition(new THREE.Vector3()));
  for (const g of [dimsG, tmpG]) for (const o of g.children) {
    if (o.userData.bar) { const t = inXR ? 0.004 : 0.0022 * viewHeightAt(o); o.scale.set(t, o.userData.len, t); continue; }
    if (o.userData.dot) { o.scale.setScalar(inXR ? 0.011 : 0.0058 * viewHeightAt(o)); continue; }
    if (!o.userData.label) continue;
    const s = inXR ? 0.055 : 0.034 * viewHeightAt(o);
    o.scale.set(s * o.userData.aspect, s, 1);
    if (inXR) { o.rotation.set(0, Math.atan2(cl.x - o.position.x, cl.z - o.position.z), 0); continue; }
    const A = o.userData.a, B = o.userData.b;
    if (!A || !B) { o.quaternion.copy(c.quaternion); continue; }
    // На экране: табличка повёрнута вдоль линии размера и уходит по ней в сторону, если закрывает ручку гамбола.
    const W = canvas.clientWidth / 2, Hh = canvas.clientHeight / 2;
    const px = (p, out) => { _v.copy(p).applyMatrix4(world.matrixWorld).project(c); out.set(_v.x * W, _v.y * Hh); return Math.abs(_v.z) <= 1; };
    px(A, _pa); px(B, _pb);
    // Табличка привязана к линии: длинной стороной вдоль неё, вокруг линии доворачивается к зрителю.
    // Если смотреть вдоль линии, она видна с ребра.
    const mid = _m1.copy(A).add(B).multiplyScalar(0.5);
    const X = _x.copy(B).sub(A).normalize(), view = c.isOrthographicCamera ? _c.set(0, 1, 0) : _c.copy(cl).sub(mid).normalize();
    const N = _n.copy(view).addScaledVector(X, -view.dot(X));
    if (N.lengthSq() < 1e-6) N.set(X.z, 0, -X.x).lengthSq() < 1e-6 && N.set(1, 0, 0);
    N.normalize();
    const up = _up.set(0, 1, 0).applyQuaternion(c.quaternion).transformDirection(_winv);   // «верх экрана» в координатах комнаты
    let Y = _y.crossVectors(N, X);
    const sc = Y.dot(up);
    if (Math.abs(sc) < 0.3 ? X.dot(up) < 0 : sc < 0) { X.negate(); Y.negate(); }   // текст не вверх ногами; на крутых линиях — снизу вверх
    o.quaternion.setFromRotationMatrix(_m4.makeBasis(X, Y, N));
    let best = 0.5;
    if (handles.length && tool !== 'room') {
      const lim = 0.034 * Hh * o.userData.aspect + 16;
      if (!o.userData.hp || o.userData.hp.length !== handles.length) o.userData.hp = handles.map(() => new THREE.Vector2());
      const ok = handles.map((h, i) => px(h.getWorldPosition(_c).applyMatrix4(_winv), o.userData.hp[i]));
      let far = -1;
      for (const t of [0.5, 0.36, 0.64, 0.24, 0.76]) {
        _pc.copy(_pa).lerp(_pb, t);
        let near = Infinity;
        o.userData.hp.forEach((q, i) => { if (ok[i]) near = Math.min(near, q.distanceTo(_pc)); });
        if (near > lim) { best = t; break; }
        if (near > far) { far = near; best = t; }
      }
    }
    o.position.copy(A).lerp(B, best);
    // чуть в сторону зрителя, чтобы табличка не тонула в поверхности, на которой лежит размер
    o.position.addScaledVector(N, s * 0.5);
  }
}
function pickHandle() {
  let best = null, bd = Infinity;
  for (const h of handles) {
    h.getWorldPosition(_v);
    const rad = h.userData.arrow ? h.userData.arrow.scale.x * 0.1 : h.scale.x * (h.userData.pr || 1);
    const d = ray.ray.distanceToPoint(_v), lim = rad * (world.scale.x || 1) * 2.4;
    if (d < lim && d < bd) { bd = d; best = h; }
  }
  return best;
}

// ───────────────────────── рулетка ─────────────────────────
const DIM = new THREE.MeshBasicMaterial({ color: 0xa61e1e });   // размер стоит в пространстве: мебель его заслоняет
const BAR_GEO = new THREE.CylinderGeometry(1, 1, 1, 8), DOT_GEO = new THREE.SphereGeometry(1, 14, 10);
let measureA = null;
const LABEL_GEO = new THREE.PlaneGeometry(1, 1);
function makeLabel(text) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), font = 'bold 40px "PT Mono", ui-monospace, monospace';
  x.font = font;
  c.width = Math.ceil(x.measureText(text).width) + 32;
  c.height = 64;
  x.font = font;
  x.fillStyle = '#F3EAD4';
  x.beginPath();
  x.rect(3, 3, c.width - 6, 58);
  x.fill();
  x.strokeStyle = '#A61E1E'; x.lineWidth = 6; x.stroke();
  x.fillStyle = '#1d1d1b'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, c.width / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Mesh(LABEL_GEO, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  sp.userData = { label: true, aspect: c.width / c.height };
  sp.renderOrder = 20;
  sp.raycast = () => {};
  return sp;
}
function dimObjects(group, a, b) {       // жирная линия размера с точками на концах и табличкой
  const dir = b.clone().sub(a), len = dir.length();
  const bar = new THREE.Mesh(BAR_GEO, DIM);
  bar.position.copy(a).add(b).multiplyScalar(0.5);
  if (len > 1e-6) bar.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, dir.clone().multiplyScalar(1 / len));
  bar.userData = { bar: true, len };
  bar.renderOrder = 19;
  bar.raycast = () => {};
  group.add(bar);
  for (const p of [a, b]) {
    const dot = new THREE.Mesh(DOT_GEO, DIM);
    dot.position.copy(p);
    dot.userData = { dot: true };
    dot.renderOrder = 19;
    dot.raycast = () => {};
    group.add(dot);
  }
  const lab = makeLabel(`${Math.round(len * 100)} см`);   // табличка лежит вдоль линии, прямо на ней
  lab.position.copy(a).add(b).multiplyScalar(0.5);
  lab.userData.a = a.clone(); lab.userData.b = b.clone();
  group.add(lab);
}
function clearGroup(g) {
  for (const c of [...g.children]) {
    g.remove(c);
    if (c.geometry !== LABEL_GEO && c.geometry !== BAR_GEO && c.geometry !== DOT_GEO) c.geometry?.dispose();
    if (c.material !== DIM) { c.material?.map?.dispose(); c.material?.dispose(); }
  }
}
// Конец размера может быть привязан к предмету: at = { id, l } — точка в долях его габарита.
function attachOf(p, id, n) {
  const it = id && item(id);
  if (!it) return undefined;
  const c = Math.cos(it.rot), s = Math.sin(it.rot), dx = p.x - it.x, dz = p.z - it.z, r4 = (v) => Math.round(v * 1e4) / 1e4;
  const at = { id, l: [r4((c * dx - s * dz) / it.w), r4((p.y - it.y) / it.h), r4((s * dx + c * dz) / it.d)] };
  if (n >= 0) { at.n = n; at.c = itemPoints(it).length; }   // номер настоящего угла детали: размер держится за него
  return at;
}
function dimEnd(m, k) {
  const at = m[k + 'i'], it = at && item(at.id);
  if (!it) return new THREE.Vector3(...m[k]);
  if (at.n >= 0) { const pts = itemPoints(it); if (pts.length === at.c && pts[at.n]) return pts[at.n].clone(); }
  const c = Math.cos(it.rot), s = Math.sin(it.rot), lx = at.l[0] * it.w, lz = at.l[2] * it.d;
  const p = new THREE.Vector3(it.x + c * lx + s * lz, it.y + at.l[1] * it.h, it.z - s * lx + c * lz);
  if (at.n === undefined) {              // старый размер: один раз находим угол детали, на котором он стоит
    const pts = itemPoints(it); let bi = -1, bd = 0.012;
    pts.forEach((q, i) => { const dd = q.distanceTo(p); if (dd < bd) { bd = dd; bi = i; } });
    at.n = bi; if (bi >= 0) at.c = pts.length;
  }
  return p;
}
function rebuildDims() {
  clearGroup(dimsG);
  for (const m of state.dims) dimObjects(dimsG, dimEnd(m, 'a'), dimEnd(m, 'b'));
}
function refreshDims(id) {
  if (state.dims.some((m) => m.ai?.id === id || m.bi?.id === id)) rebuildDims();
}
// Ластик: что под лучом — предмет или размер
const eraseBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0xd11919, transparent: true, opacity: 0.38, depthTest: false }));
eraseBox.add(new THREE.LineSegments(new THREE.EdgesGeometry(eraseBox.geometry),
  new THREE.LineBasicMaterial({ color: 0xd11919, depthTest: false, transparent: true })));
eraseBox.renderOrder = 30;
eraseBox.visible = false;
eraseBox.raycast = () => {};
world.add(eraseBox);
function eraseTarget() {
  const pk = pickItem();
  if (pk) return { id: pk.id };
  world.updateMatrixWorld(true);
  let best = null, bd = coarse ? 30 : 16;
  state.dims.forEach((m, i) => {
    const a = dimEnd(m, 'a'), b = dimEnd(m, 'b');
    for (const t of [0, 0.25, 0.5, 0.75, 1]) { const d = pxDist(a.clone().lerp(b, t)); if (d < bd) { bd = d; best = { dim: i, a, b }; } }
  });
  return best;
}
function showErase(t) {
  const it = t && t.id ? item(t.id) : null;
  eraseBox.visible = !!t && (!!it || t.dim !== undefined);
  if (it) {
    eraseBox.position.set(it.x, it.y + it.h / 2, it.z);
    eraseBox.rotation.set(0, it.rot, 0);
    eraseBox.scale.set(it.w + 0.02, it.h + 0.02, it.d + 0.02);
  } else if (t && t.dim !== undefined) {
    const d = t.b.clone().sub(t.a), len = Math.max(0.02, d.length());
    eraseBox.position.copy(t.a).add(t.b).multiplyScalar(0.5);
    eraseBox.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
    eraseBox.scale.set(len, 0.03, 0.03);
  }
}
function doErase(t) {
  if (!t) return;
  if (t.id) removeItem(t.id);
  else { state.dims.splice(t.dim, 1); rebuildDims(); commit(); }
  showErase(null);
}
// Привязка рулетки: сначала углы габаритов мебели и комнаты, затем вершины модели под курсором,
// иначе — точка на поверхности или на полу (по сетке).
const SNAP_COL = { corner: 0x2e9e4f, vertex: 0x1f6feb, free: 0xa61e1e };
const SNAP_NAME = { corner: 'угол', vertex: 'вершина', free: '' };
// метка привязки — крестик по трём осям: видно, от какой точки и вдоль чего пойдёт размер
const snapMarker = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 0.2),
  new THREE.MeshBasicMaterial({ color: SNAP_COL.free, depthTest: false, transparent: true }));
for (const sz of [[0.2, 3.2, 0.2], [0.2, 0.2, 3.2]]) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(...sz), snapMarker.material);
  arm.renderOrder = 25;
  arm.raycast = () => {};
  snapMarker.add(arm);
}
snapMarker.renderOrder = 25;
snapMarker.visible = false;
snapMarker.raycast = () => {};
world.add(snapMarker);
let snapKind = '';
function showSnap(m) {
  snapMarker.visible = !!m;
  snapKind = m ? SNAP_NAME[m.kind] : '';
  if (!m) return;
  snapMarker.position.copy(m.p);
  snapMarker.material.color.set(SNAP_COL[m.kind]);
  snapMarker.userData.cs = (m.kind === 'free' ? 0.007 : 0.01) * (coarse ? 1.5 : 1);
}
function itemCorners(it, out) {
  const c = Math.cos(it.rot), s = Math.sin(it.rot);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = (sx * it.w) / 2, lz = (sz * it.d) / 2, x = it.x + lx * c + lz * s, z = it.z - lx * s + lz * c;
    out.push(new THREE.Vector3(x, it.y, z), new THREE.Vector3(x, it.y + it.h, z));
  }
}
function pxDist(pLocal) {               // расстояние от курсора до точки на экране, в пикселях
  if (renderer.xr.isPresenting) {       // в шлеме — угловое расстояние от луча контроллера
    _v.copy(pLocal).applyMatrix4(world.matrixWorld);
    const o = ray.ray.origin, dist = _v.distanceTo(o);
    if (dist < 1e-3 || _c.copy(_v).sub(o).dot(ray.ray.direction) < 0) return Infinity;
    return (ray.ray.distanceToPoint(_v) / dist) * 500;
  }
  _v.copy(pLocal).applyMatrix4(world.matrixWorld).project(cam());
  if (_v.z > 1 || _v.z < -1) return Infinity;
  return Math.hypot(((_v.x + 1) / 2) * curPx.z - curPx.x, ((1 - _v.y) / 2) * curPx.w - curPx.y);
}
function nearest(points, lim) {
  let best = null, bd = lim;
  for (const p of points) { const d = pxDist(p); if (d < bd) { bd = d; best = p; } }
  return best;
}
const ptCache = new Map();
function itemPoints(it) {                // углы габарита + настоящие углы деталей болванки
  const g = objs.get(it.id);
  const key = [it.x, it.y, it.z, it.rot, it.w, it.d, it.h, it.type, g?.children.length, (it.open || []).join('.'), it.pose].join();
  const c = ptCache.get(it.id);
  if (c && c.key === key) return c.pts;
  const pts = [];
  itemCorners(it, pts);
  if (g && it.type !== 'model') {
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      const pos = o.isMesh && o.geometry.attributes.position;
      if (!pos || pos.count > 300) return;
      for (let i = 0; i < pos.count; i++)
        pts.push(world.worldToLocal(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)));
    });
  }
  for (const q of pts) q.itemId = it.id;
  ptCache.set(it.id, { key, pts });
  return pts;
}
function measurePoint() {
  world.updateMatrixWorld(true);
  const lim = coarse ? 30 : 14, R = state.room;
  const corners = [];
  for (const it of state.items) corners.push(...itemPoints(it));
  roomMesh().v.forEach((q) => corners.push(new THREE.Vector3(...q)));
  for (const m of state.dims) corners.push(dimEnd(m, 'a'), dimEnd(m, 'b'));
  const c = nearest(corners, lim);
  if (c) return { p: c.clone(), kind: 'corner', id: c.itemId, n: c.itemId ? itemPoints(item(c.itemId)).indexOf(c) : -1 };
  const pk = pickItem();
  if (pk) return { p: world.worldToLocal(pk.point), kind: 'free', id: pk.id };
  const p = hitPlaneY(localRay(ray.ray), 0);
  if (!p) return null;
  if (state.snap > 0) { p.x = Math.round(p.x / state.snap) * state.snap; p.z = Math.round(p.z / state.snap) * state.snap; }
  return { p, kind: 'free' };
}

// ───────────────────────── указатель (мышь / палец) ─────────────────────────
let drag = null, down = null;

function startDrag(d, e) {
  cancelCut();
  drag = d;
  d.pid = e.pointerId;
  d.changed = false;
  ctl().enabled = false;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
}
function onDown(e) {
  if (renderer.xr.isPresenting) return;
  $('#menu').hidden = true;
  if (down && !e.isPrimary) { down.multi = true; return; }
  down = null;
  if (e.button !== 0) return;
  down = { pid: e.pointerId, x: e.clientX, y: e.clientY, multi: false, moved: false, noTap: false };
  if (tool === 'measure' || tool === 'act' || tool === 'erase') return;
  setRay(e);
  const d = beginDrag(localRay(ray.ray), e.pointerType === 'mouse');
  if (d) { if (d.mode !== 'move' || d.handle) down.noTap = true; startDrag(d, e); }
}
// Начало перетаскивания лучом ray (мышь, палец или контроллер). direct — можно тащить невыделенный предмет.
function beginDrag(lr, direct) {
  if (tool === 'room') {
    const h = pickHandle();
    if (!h) return null;
    const u = h.userData, snap = (el, dir) => (el.kind === 'sun' ? null : expandMove(el.ids, dir).map((i) => [i, [...roomMesh().v[i]]]));
    if (u.arrow) {                      // стрелка: двигаем выделенное вдоль оси, от места захвата, без прыжка
      const a0 = gizmo.userData.selPos;
      if (!roomSel || !a0) return null;
      const dir = AXES[u.axis].clone();
      return { mode: 'room', kind: 'axis', dir, a0: a0.clone(), s0: axisParam(lr, a0, dir), sel: roomSel, v0: snap(roomSel, dir), p0: sunPos(), direct: false };
    }
    const el = u.el, a0 = h.position.clone();
    if (el.kind === 'f')                // плашку грани можно сразу тянуть вдоль её нормали
      return { mode: 'room', kind: 'axis', dir: el.n.clone(), a0, s0: axisParam(lr, a0, el.n), sel: el, v0: snap(el, el.n), direct: true };
    return { mode: 'room', kind: 'none', sel: el, direct: true };
  }
  const it = sel();
  if (it && !it.lock && tool === 'select') {   // гамбол: стрелка, кубик или дуга
    const h = pickHandle(), u = h && h.userData;
    if (u && u.kind === 'scale')
      return { mode: 'pull', riders: ridersOf(it), id: it.id, axis: u.axis, sign: u.sign, rot: it.rot,
        w0: it.w, d0: it.d, h0: it.h, x0: it.x, z0: it.z, hy: it.y + it.h / 2 };
    if (u && u.kind === 'move') {
      const a0 = new THREE.Vector3(it.x, it.y + it.h / 2, it.z), c = Math.cos(it.rot), sn = Math.sin(it.rot);
      const dir = u.axis === 'x' ? new THREE.Vector3(c, 0, -sn) : u.axis === 'z' ? new THREE.Vector3(sn, 0, c) : AXES.y.clone();
      return { mode: 'axis', id: it.id, axis: u.axis, dir, a0, s0: axisParam(lr, a0, dir), x0: it.x, y0: it.y, z0: it.z };
    }
    if (u && u.kind === 'grab')
      return { mode: 'move', handle: true, ...makeGrab(it, new THREE.Vector3(it.x, it.y + it.h / 2, it.z), false) };
    if (u && u.kind === 'rot') {
      const py = it.y + it.h / 2, p = hitPlaneY(lr, py);
      if (p) return { mode: 'rotate', id: it.id, py, a0: Math.atan2(p.x - it.x, p.z - it.z), rot0: it.rot };
    }
  }
  const pk = pickItem();
  if (pk && (direct || pk.id === selId)) {
    if (pk.id !== selId) select(pk.id);
    const t = item(pk.id);
    if (t.lock) return null;
    world.updateMatrixWorld(true);
    const pl = world.worldToLocal(pk.point.clone());
    return { mode: 'move', ...makeGrab(t, pl, false), pk };
  }
  return null;
}
function updateRoomDrag(d, lr) {
  if (d.kind !== 'axis') return false;
  const sp = axisParam(lr, d.a0, d.dir);
  if (sp === null) return false;
  if (d.s0 === null) { d.s0 = sp; return false; }
  const dl = Math.round((sp - d.s0) * 100) / 100;       // шаг 1 см, отсчёт от места захвата
  if (dl === d.last) return false;
  d.last = dl;
  if (d.sel.kind === 'sun') {
    const q = d.p0.clone().addScaledVector(d.dir, dl);
    state.room.sun = { x: r3(clamp(q.x, -15, 15)), y: r3(clamp(q.y, 0.3, 15)), z: r3(clamp(q.z, -15, 15)) };
  } else {
    const m = roomMesh();
    for (const [i, p] of d.v0) m.v[i] = [r3(p[0] + d.dir.x * dl), r3(p[1] + d.dir.y * dl), r3(p[2] + d.dir.z * dl)];
  }
  buildRoom(); updateGizmo();
  d.changed = true;
  return true;
}
function endRoomDrag(d) {
  if (!d.changed) {                     // нажатие без движения — выделить или снять выделение
    if (d.direct) { roomSel = roomSel && roomSel.key === d.sel.key ? null : { key: d.sel.key, kind: d.sel.kind, ids: d.sel.ids }; updateGizmo(); }
    return;
  }
  if (d.sel.kind !== 'sun') { recenterRoom(); buildRoom(); updateGizmo(); rebuildDims(); fitOrtho(); }
}
// Точка на ребре под курсором. only — список рёбер, среди которых искать (для второй точки разреза).
const cutMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd11919, depthTest: false, transparent: true }));
const cutMarkerA = cutMarker.clone();
const cutLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0xd11919, depthTest: false, transparent: true }));
for (const o of [cutMarker, cutMarkerA, cutLine]) { o.renderOrder = 26; o.visible = false; o.raycast = () => {}; o.frustumCulled = false; world.add(o); }
let cutHover = null, cutA = null;       // cutA — первая точка разреза, ждём вторую
function cutEdges() {                    // рёбра, на которые можно поставить вторую точку: те же грани, другое ребро
  if (!cutA) return meshEdges();
  const out = new Map();
  for (const f of roomMesh().f) {
    const es = f.map((u, i) => [Math.min(u, f[(i + 1) % f.length]), Math.max(u, f[(i + 1) % f.length])]);
    if (!es.some(([a, b]) => a === cutA.a && b === cutA.b)) continue;
    for (const [a, b] of es) if (a !== cutA.a || b !== cutA.b) out.set(a + '_' + b, [a, b]);
  }
  return [...out.values()];
}
function findCut() {
  world.updateMatrixWorld(true);
  let best = null, bd = coarse ? 28 : 13;
  const ps = new THREE.Vector3();
  for (const [a, b] of cutEdges()) {
    const A = mv(a).applyMatrix4(world.matrixWorld), B = mv(b).applyMatrix4(world.matrixWorld), len = A.distanceTo(B);
    if (len < 0.05) continue;
    ray.ray.distanceSqToSegment(A, B, undefined, ps);
    const t = A.distanceTo(ps) / len, local = world.worldToLocal(ps.clone()), dpx = pxDist(local);
    if (dpx < bd && t > 0.04 && t < 0.96) { bd = dpx; best = { a, b, t: Math.round(t * 100) / 100, p: local }; }
  }
  if (best && cutA) {                   // вторая точка липнет к положению «ровно напротив первой» — разрез выходит прямым
    const A = mv(best.a), d = mv(best.b).sub(A), tt = clamp(cutA.p.clone().sub(A).dot(d) / d.lengthSq(), 0.04, 0.96);
    if (Math.abs(tt - best.t) < 0.06) best.t = tt;
  }
  if (best) best.p = mv(best.a).lerp(mv(best.b), best.t);
  return best;
}
function showCut(c) {                   // красная точка под курсором; после первой точки — линия будущего разреза
  cutHover = c;
  cutMarker.visible = !!c;
  cutMarkerA.visible = !!cutA;
  cutLine.visible = !!c && !!cutA;
  if (c) cutMarker.position.copy(c.p);
  if (cutA) cutMarkerA.position.copy(cutA.p);
  if (c && cutA) { cutLine.geometry.setFromPoints([cutA.p, c.p]); }
}
function cancelCut() { cutA = null; showCut(null); }
function tapCut() {                     // нажатие в «Комнате» мимо ручек: первая точка, вторая точка — разрез
  if (!cutA) {                          // нажали на мебель — выходим из «Комнаты» в «Выбор» с этим предметом
    const pk = pickItem();
    if (pk) { setTool('select'); select(pk.id); return; }
  }
  const c = findCut();
  if (!c) {                             // мимо рёбер: начатый разрез отменяем, иначе выделяем грань под курсором
    if (cutA) { cancelCut(); return; }
    const fi = faceAtRay(), key = 'f' + fi;
    roomSel = fi < 0 || (roomSel && roomSel.key === key) ? null : { key, kind: 'f', ids: [...roomMesh().f[fi]] };
    updateGizmo();
    return;
  }
  if (!cutA) { cutA = c; showCut(null); updateStatus(); return; }
  const A = cutA;
  cutA = null;
  showCut(null);
  if (cutFace(A, c)) { roomSel = null; buildRoom(); updateGizmo(); commit(); }
  updateStatus();
}
function updateDrag(d, lr) {
  if (d.mode === 'room') return updateRoomDrag(d, lr);
  const it = item(d.id);
  if (!it) return false;
  if (d.mode === 'move') {
    if (!dragMove(it, d, lr)) return false;
    placeItem(it);
    if (tool !== 'room') gizmo.position.set(it.x, it.y, it.z);
  } else if (d.mode === 'axis') {
    const sp = axisParam(lr, d.a0, d.dir);
    if (sp === null) return false;
    if (d.s0 === null) { d.s0 = sp; return false; }
    const dl = sp - d.s0, st = state.snap, sn = (v) => (st > 0 ? Math.round(v / st) * st : v);
    if (d.axis !== 'y') { const m = sn(dl); it.x = r3(d.x0 + d.dir.x * m); it.z = r3(d.z0 + d.dir.z * m); }   // вдоль оси самого предмета
    else if (it.type === 'human') {      // человечка вдавливают в опору: сначала садится, потом ложится; тянут вверх — встаёт
      const base = restY(it, it.x, it.z);
      if (d.dep0 === undefined) d.dep0 = Math.abs(d.y0 - base) < 0.02 ? ({ sit: 0.5, sitf: 0.5, lie: 0.95 }[it.pose] || 0) : 0;
      const yv = d.y0 - d.dep0 + sn(dl), dep = base - yv;
      if (dep >= 0) { it.y = r3(base); setPose(it, dep < 0.3 ? 'stand' : dep < 0.75 ? 'sit' : 'lie'); }
      else { it.y = r3(yv); setPose(it, 'stand'); }
    } else {
      let y = sn(d.y0 + dl);
      const H = ceilMin(it, it.x, it.z);
      if (st > 0) { if (Math.abs(y) < 0.03) y = 0; if (Math.abs(y + it.h - H) < 0.06) y = H - it.h; }
      it.y = r3(y);
    }
    if (it.y > restY(it, it.x, it.z) + 0.02) it.hold = 'free'; else delete it.hold;   // по осям можно оставить в воздухе
    placeItem(it);
    if (tool !== 'room') gizmo.position.set(it.x, it.y, it.z);
  } else if (d.mode === 'rotate') {
    const p = hitPlaneY(lr, d.py ?? it.y);
    if (!p) return false;
    it.rot = snapRot(d.rot0 + Math.atan2(p.x - it.x, p.z - it.z) - d.a0);
    placeItem(it);
    if (tool !== 'room') gizmo.rotation.y = it.rot;
  } else if (d.mode === 'pull') {
    if (!applyPull(it, d, lr)) return false;
    fillItem(it, objs.get(it.id));
    placeItem(it);
    settle(d.riders || []);
    updateGizmo();
  }
  d.changed = true;
  refreshDims(d.id);
  return true;
}
function measureTap() {
  const m = measurePoint();
  if (!m) return;
  showSnap(m);
  const end = { p: m.p.clone(), at: attachOf(m.p, m.id, m.n) };
  if (!measureA) measureA = end;
  else {
    const dim = { a: measureA.p.toArray().map(r3), b: end.p.toArray().map(r3) };
    if (measureA.at) dim.ai = measureA.at;
    if (end.at) dim.bi = end.at;
    state.dims.push(dim);
    measureA = null;
    clearGroup(tmpG);
    rebuildDims();
    commit();
  }
  updateStatus();
}
function applyPull(it, d, lr) {
  let f = 1;
  if (d.axis === 'y') {
    const n = (renderer.xr.isPresenting ? camera : cam()).getWorldDirection(new THREE.Vector3());
    n.y = 0;
    if (n.lengthSq() < 1e-4) return false;         // вид строго сверху — высоту не потянуть
    n.normalize().transformDirection(_inv);
    const den = lr.d.dot(n);
    if (Math.abs(den) < 1e-5) return false;
    const t = new THREE.Vector3(d.x0, 0, d.z0).sub(lr.o).dot(n) / den;
    if (!(t > 0)) return false;
    const yy = lr.o.y + lr.d.y * t;
    if (d.l0 === undefined) { d.l0 = yy; return false; }   // тянем от места захвата, без прыжка
    const nh = snapLen(Math.max(0.01, d.h0 + yy - d.l0));
    f = nh / d.h0;
    it.h = r3(nh);
    if (it.keep) { it.w = r3(d.w0 * f); it.d = r3(d.d0 * f); }
    return true;
  }
  const p = hitPlaneY(lr, d.hy);
  if (!p) return false;
  const c = Math.cos(d.rot), s = Math.sin(d.rot), dx = p.x - d.x0, dz = p.z - d.z0;
  const l = d.axis === 'x' ? c * dx - s * dz : s * dx + c * dz;
  const size0 = d.axis === 'x' ? d.w0 : d.d0;
  if (d.l0 === undefined) { d.l0 = l; return false; }
  const ns = snapLen(Math.max(0.02, d.sign * (l - d.l0) + size0));
  const shift = (d.sign * (ns - size0)) / 2;
  f = ns / size0;
  if (d.axis === 'x') { it.w = r3(ns); it.x = r3(d.x0 + shift * c); it.z = r3(d.z0 - shift * s); if (it.keep) { it.d = r3(d.d0 * f); it.h = r3(d.h0 * f); } }
  else { it.d = r3(ns); it.x = r3(d.x0 + shift * s); it.z = r3(d.z0 + shift * c); if (it.keep) { it.w = r3(d.w0 * f); it.h = r3(d.h0 * f); } }
  return true;
}
function onMove(e) {
  if (renderer.xr.isPresenting) return;
  if (down && e.pointerId === down.pid && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
  if (drag) {
    if (e.pointerId !== drag.pid || !down?.moved) return;
    if (drag.mode !== 'room' && !item(drag.id)) { drag = null; ctl().enabled = true; return; }
    setRay(e);
    if (updateDrag(drag, localRay(ray.ray))) updateStatus();
    return;
  }
  if ((tool === 'select' || tool === 'room') && e.pointerType === 'mouse' && !down) {
    setRay(e);
    const hh = pickHandle();
    setHot(hh);
    if (tool === 'room') showCut(hh ? null : findCut());
  }
  if (tool === 'erase' && e.pointerType === 'mouse' && !(down && down.moved)) { setRay(e); showErase(eraseTarget()); }
  if (tool === 'measure' && e.pointerType === 'mouse' && !(down && down.moved)) {
    setRay(e);
    const m = measurePoint(), was = snapKind;
    showSnap(m);
    clearGroup(tmpG);
    if (m && measureA) dimObjects(tmpG, measureA.p, m.p);
    if (was !== snapKind) updateStatus();
  }
}
function onUp(e) {
  if (renderer.xr.isPresenting) return;
  if (drag && e.pointerId === drag.pid) {
    const d = drag;
    drag = null;
    ctl().enabled = true;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* не критично */ }
    if (d.mode === 'room') endRoomDrag(d);
    if (d.changed) { commit(); updateProps(); }
  }
  if (down && e.pointerId === down.pid) {
    const d = down;
    down = null;
    if (e.type === 'pointerup' && !d.moved && !d.multi && !d.noTap) onTap(e);
  }
}
function onTap(e) {
  setRay(e);
  if (tool === 'measure') { measureTap(); return; }
  if (tool === 'erase') { doErase(eraseTarget()); return; }
  if (tool === 'room') {                // нажатие по ребру — излом; мимо всего — снять выделение
    tapCut();
    return;
  }
  const pk = pickItem();
  if (tool === 'act') {
    if (!pk) return;
    if (!tapPart(pk)) toast(objs.get(pk.id).children.some((c) => c.userData.act)
      ? 'Нажмите на дверцу или ящик' : 'У этого предмета нет подвижных частей', 1800);
    return;
  }
  select(pk ? pk.id : null);
}
// «Действие»: открыть / закрыть дверцу или ящик, по которому попали
const anims = [];
function tapPart(pk) {
  const it = item(pk.id);
  if (it && it.type === 'human') {      // «Действие» по человечку: встать или сесть на том же месте
    const order = ['stand', 'sit', 'sitf', 'lie'];   // «Действие» перебирает позы по кругу
    setPose(it, order[(order.indexOf(it.pose || 'stand') + 1) % order.length], true);
    commit();
    return true;
  }
  let o = pk.hit.object;
  while (o && !o.userData.act && o.parent !== itemsG) o = o.parent;
  if (!it || !o || !o.userData.act) return false;
  const set = new Set(it.open || []), idx = o.userData.part, open = !set.has(idx);
  if (open) set.add(idx); else set.delete(idx);
  if (set.size) it.open = [...set].sort((a, b) => a - b); else delete it.open;
  anims.push({ part: o, to: open ? 1 : 0 });
  commit();
  return true;
}
function runAnims(dt) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i], t = a.part.userData.t || 0, n = a.to > t ? Math.min(a.to, t + dt * 2.6) : Math.max(a.to, t - dt * 2.6);
    applyAct(a.part, n);
    if (n === a.to) anims.splice(i, 1);
  }
}
canvas.addEventListener('pointerdown', onDown, true);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ───────────────────────── интерфейс ─────────────────────────
const HINTS = {
  select: 'Тащите предмет: он всегда примагничен — к полу, к другой мебели, к стене или потолку. У выбранного: стрелки — по осям, кубики — тянуть, дуга — поворот',
  room: 'Комната: нажмите на точку, ребро или плашку грани — появятся стрелки. Разрез грани: нажмите на ребро, затем на другое ребро той же грани. Солнце — направление света',
  erase: 'Ластик: наведите на предмет или размер — он станет красным — и нажмите, чтобы удалить',
  act: 'Нажимайте на дверцы и ящики — они открываются; по человечку — он по очереди встаёт, садится, вытягивает ноги, ложится',
  measure: 'Рулетка: укажите первую точку — липнет к углам',
};
function updateStatus() {
  const it = sel();
  let s = HINTS[tool];
  if (tool === 'room') s = cutA ? 'Разрез: теперь нажмите на другое ребро той же грани — красная линия показывает, где он пройдёт' : HINTS.room;
  else if (tool === 'act' || tool === 'erase') s = HINTS[tool];
  else if (tool === 'measure') s = (measureA ? 'Рулетка: укажите вторую точку' : HINTS.measure) + (snapKind ? ` · привязка: ${snapKind}` : '');
  else if (it) s = `${it.name} — ${fmt(it.w)} × ${fmt(it.d)} × ${fmt(it.h)}`.replace(/ см(?= ×)/g, '');
  $('#status').textContent = s;
}
// Курсор показывает, какой инструмент в руке: значок инструмента и точная точка нажатия.
let CURSORS = null;
const makeCursors = () => {
  const svg = (body, hx, hy) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36' fill='none' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`)}") ${hx} ${hy}, auto`;
  const two = (d, tr, fill = 'none') => `<path d='${d}' transform='${tr}' stroke='#F6EEDB' stroke-width='4.5'/><path d='${d}' transform='${tr}' stroke='#1b1a18' stroke-width='1.7' fill='${fill}'/>`;
  const cross = two('M7 1v12M1 7h12', '');
  const icon = (id) => TOOLS.find((q) => q[0] === id)[2];
  return {
    select: svg(two('M5 3l14 8-6 2-2 6z', 'translate(6 6) scale(1.15)', '#F6EEDB') + two('M11.5 2v4M3 9.5h4M5 3.5l2.6 2.6', ''), 12, 9),
    measure: svg(cross + two(icon('measure'), 'translate(13 13) scale(0.9)', '#F6EEDB'), 7, 7),
    erase: svg(two(icon('erase'), 'translate(2 2) scale(1.3)', '#F6EEDB'), 11, 28),
    act: svg(two(icon('act'), 'translate(2 1) scale(1.35)', '#F6EEDB'), 16, 6),
    room: svg(cross + two(icon('room'), 'translate(13 13) scale(0.9)', '#F6EEDB'), 7, 7),
  };
};
function setTool(t) {
  tool = t;
  CURSORS = CURSORS || makeCursors();
  canvas.style.cursor = CURSORS[t] || 'auto';
  measureA = null;
  clearGroup(tmpG);
  showSnap(null);
  showErase(null);
  vm.dirty = true;
  if (t !== 'room') $('#facePanel').hidden = true;
  if (t === 'room' && state.room.blank) {   // на чистом листе «Комната» ставит обычную комнату вокруг начала координат
    state.room = { w: 4, d: 5, h: 2.7, floor: state.room.floor, wall: state.room.wall, ...(state.room.sun ? { sun: state.room.sun } : {}) };
    buildRoom();
    for (const o of state.items) placeItem(o);
    commit();
  }
  if (t === 'room') selId = null;
  roomSel = null;
  cutA = null;
  showCut(null);
  updateProps();
  for (const b of $$('#tools [data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
  updateGizmo(); updateStatus();
}
let toastTimer = 0;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Базовый набор цветов вместо бесконечной палитры; цвет применяется сразу по нажатию.
const PALETTE = ['#f4f1ea', '#e9e4da', '#d5d9dc', '#9aa0a6', '#2b2f36', '#1b1a18', '#e3cfa8', '#d9c7a8', '#c8a27a', '#9c6b3f', '#5a3e2b',
  '#A61E1E', '#b5553c', '#C9963B', '#d8c9a0', '#5f8f4e', '#3f6b5c', '#8c9aa8', '#3d5a80'];
function swatches(el, onPick) {
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.dataset.c = c;
    b.title = c;
    b.onclick = (e) => { e.preventDefault(); onPick(c); markSwatch(el, c); };
    el.append(b);
  }
}
function markSwatch(el, c) {
  for (const b of el.children) b.classList.toggle('on', !!c && b.dataset.c.toLowerCase() === String(c).toLowerCase());
}
const P = { name: $('#pName'), w: $('#pW'), d: $('#pD'), h: $('#pH'), y: $('#pY'), rot: $('#pRot'),
  keep: $('#pKeep'), lock: $('#pLock') };
const cm = (m) => Math.round(m * 1000) / 10;
function updateProps() {
  const it = sel(), el = $('#props');
  el.hidden = !it || renderer.xr.isPresenting;
  if (!it) return;
  if (document.activeElement !== P.name) P.name.value = it.name;
  P.w.value = cm(it.w); P.d.value = cm(it.d); P.h.value = cm(it.h); P.y.value = cm(it.y);
  P.rot.value = Math.round((((THREE.MathUtils.radToDeg(it.rot) % 360) + 360) % 360) * 10) / 10;
  markSwatch($('#pSwatches'), it.color);
  P.keep.checked = !!it.keep;
  P.lock.checked = !!it.lock;
}
function editSel(fn, rebuild = true) {
  const it = sel();
  if (!it) return;
  const riders = ridersOf(it);
  fn(it);
  if (rebuild) fillItem(it, objs.get(it.id));
  placeItem(it); settle(riders); updateGizmo(); updateProps(); updateStatus(); refreshDims(it.id); commit();
}
function bindSize(input, key) {
  input.addEventListener('change', () => editSel((it) => {
    const v = clamp(parseFloat(input.value) / 100 || it[key], 0.005, 30), f = v / it[key];
    if (it.keep) { it.w = r3(it.w * f); it.d = r3(it.d * f); it.h = r3(it.h * f); } else it[key] = r3(v);
  }));
}
bindSize(P.w, 'w'); bindSize(P.d, 'd'); bindSize(P.h, 'h');
P.y.addEventListener('change', () => editSel((it) => { it.y = r3(clamp(parseFloat(P.y.value) / 100 || 0, -5, 20)); if (it.y > 0.02) it.hold = 'free'; else delete it.hold; }, false));
P.rot.addEventListener('change', () => editSel((it) => { it.rot = THREE.MathUtils.degToRad(parseFloat(P.rot.value) || 0); }, false));
swatches($('#pSwatches'), (c) => editSel((it) => { it.color = c; }));
swatches($('#rFloorSw'), (c) => { state.room.floor = c; buildRoom(); commit(); });
swatches($('#rWallSw'), (c) => { state.room.wall = c; buildRoom(); commit(); });
swatches($('#fSwatches'), (c) => setFaceColor(c));
$('#fReset').onclick = () => setFaceColor(null);
$('#fClose').onclick = () => { roomSel = null; updateGizmo(); };
P.name.addEventListener('change', () => editSel((it) => { it.name = P.name.value.trim() || it.name; }, false));
P.keep.addEventListener('change', () => editSel((it) => { it.keep = P.keep.checked; }, false));
P.lock.addEventListener('change', () => editSel((it) => { it.lock = P.lock.checked; }, false));
$('#pRotL').onclick = () => rotateSel(Math.PI / 2);
$('#pRotR').onclick = () => rotateSel(-Math.PI / 2);
$('#pDup').onclick = () => selId && duplicate(selId);
$('#pDel').onclick = () => selId && removeItem(selId);
$('#pClose').onclick = () => select(null);
$('#pMore').onclick = () => $('#props').classList.toggle('compact');
if (innerWidth <= 640) $('#props').classList.add('compact');

for (const b of $$('#tools [data-tool]')) b.onclick = () => setTool(b.dataset.tool);
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btn3d').onclick = () => setView('3d');
$('#btnPlan').onclick = () => setView('plan');

// каталог
const catalogEl = $('#catalog');
function toggleCatalog(show = catalogEl.hidden) { catalogEl.hidden = !show; }
$('#btnAdd').onclick = () => toggleCatalog();
$('#catClose').onclick = () => toggleCatalog(false);
function afterAdd() { if (innerWidth <= 640 || renderer.xr.isPresenting) toggleCatalog(false); }
let blankThumbs = {};
let catSel = 'all', pull = null;         // pull — карточка, которую тащат из каталога в комнату
function buildCatalog() {
  const thumbs = blankThumbs = makeThumbs();
  const grid = $('#tabBlanks'), chips = $('#catCats');
  const filter = () => {
    for (const c of chips.children) c.classList.toggle('on', c.dataset.cat === catSel);
    for (const b of grid.children) b.hidden = catSel !== 'all' && b.dataset.cat !== catSel;
  };
  for (const [id, label] of CATS) {
    const c = document.createElement('button');
    c.textContent = label;
    c.dataset.cat = id;
    c.onclick = () => { catSel = id; filter(); };
    chips.append(c);
  }
  for (const def of CATALOG) {
    const b = document.createElement('button');
    b.dataset.cat = def.cat;
    if (thumbs[def.type]) { const img = new Image(); img.src = thumbs[def.type]; img.alt = ''; img.draggable = false; b.append(img); }
    const name = document.createElement('span');
    name.textContent = def.name;
    const dim = document.createElement('small');
    dim.textContent = `${cm(def.w)}×${cm(def.d)}×${cm(def.h)}`;
    b.append(name, dim);
    b.onclick = () => { if (pull?.used) return; addBlank(def); afterAdd(); };
    b.addEventListener('pointerdown', (e) => { if (e.button === 0) pull = { def, pid: e.pointerId, x: e.clientX, y: e.clientY, g: null, used: false }; });
    grid.append(b);
  }
  filter();
}
// Нажали на карточку и потащили за пределы каталога — предмет едет за курсором в комнату.
addEventListener('pointermove', (e) => {
  if (!pull || e.pointerId !== pull.pid || renderer.xr.isPresenting) return;
  if (!pull.g) {
    if (Math.hypot(e.clientX - pull.x, e.clientY - pull.y) < 14 || catalogEl.contains(document.elementFromPoint(e.clientX, e.clientY))) return;
    const it = addBlank(pull.def);
    pull.g = { mode: 'move', ...makeGrab(it, new THREE.Vector3(it.x, it.y, it.z)) };
    pull.used = true;
  }
  setRay(e);
  if (updateDrag(pull.g, localRay(ray.ray))) updateStatus();
});
const endPull = (e) => {
  if (!pull || e.pointerId !== pull.pid) return;
  const p = pull;
  if (p.g) { if (p.g.changed) { commit(); updateProps(); } afterAdd(); }
  setTimeout(() => { if (pull === p) pull = null; }, 0);   // после возможного click по карточке
};
addEventListener('pointerup', endPull);
addEventListener('pointercancel', endPull);
function makeThumbs() {
  const out = {};
  try {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setSize(200, 150);
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xffffff, 0xb0a898, 1.3));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4);
    dl.position.set(2, 4, 3);
    sc.add(dl);
    const c = new THREE.PerspectiveCamera(28, 4 / 3, 0.05, 80);
    for (const def of CATALOG) {
      const g = fillBlank(new THREE.Group(), def.type, def.w, def.d, def.h, def.color);
      sc.add(g);
      const center = new THREE.Vector3(0, def.h / 2, 0), rad = Math.hypot(def.w, def.d, def.h) / 2;
      c.position.copy(center).addScaledVector(new THREE.Vector3(0.75, 0.6, 1).normalize(), (rad / Math.sin(THREE.MathUtils.degToRad(14))) * 0.98);
      c.lookAt(center);
      r.render(sc, c);
      out[def.type] = r.domElement.toDataURL('image/png');
      sc.remove(g);
      disposeChildren(g);
    }
    r.dispose();
    r.forceContextLoss();
  } catch (e) { console.warn('thumbs', e); }
  return out;
}
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.json$/i.test(f.name)) openProjectFile(f);
});

// меню
$('#btnMenu').onclick = (e) => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const b64e = (s) => { let b = ''; for (const c of new TextEncoder().encode(s)) b += String.fromCharCode(c); return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64d = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
async function openProjectFile(f) {
  try { load(JSON.parse(await f.text())); commit(); toast('Проект открыт'); }
  catch { toast('Не получилось прочитать файл проекта'); }
}
$('#fileProject').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
async function exportGLB() {
  try {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const prev = selId;
    select(null);
    const buf = await new GLTFExporter().parseAsync([roomG, itemsG], { binary: true });
    select(prev);
    download(new Blob([buf], { type: 'model/gltf-binary' }), 'taburetka.glb');
  } catch (e) { console.error(e); toast('Экспорт не удался: ' + (e?.message || e)); }
}
const MENU = {
  room() {
    const R = state.room;
    $('#rW').value = cm(R.w); $('#rD').value = cm(R.d); $('#rH').value = cm(R.h);
    markSwatch($('#rFloorSw'), R.floor); markSwatch($('#rWallSw'), R.wall); $('#rSnap').value = String(state.snap);
    if (!$('#rSnap').value) $('#rSnap').value = '0.05';
    $('#rGrid').checked = state.grid !== false;
    $('#roomDlg').showModal();
  },
  save() { download(new Blob([JSON.stringify(JSON.parse(cur), null, 1)], { type: 'application/json' }), 'taburetka-project.json'); },
  open() { $('#fileProject').click(); },
  async link() {
    const url = location.origin + location.pathname + '#p=' + b64e(cur);
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
    catch { prompt('Ссылка на проект:', url); }
  },
  glb: exportGLB,
  cleardims() { state.dims = []; measureA = null; clearGroup(tmpG); rebuildDims(); commit(); },
  new() {                               // комната по умолчанию: размеры, ровный потолок, свет, вид и стартовая мебель
    const snap = state.snap, grid = state.grid;
    state.room = { w: 4, d: 5, h: 2.7, floor: '#d9c7a8', wall: '#f4f1ea' };
    load({ ...demo(), snap, grid });
    commit();
    homeView();
    toast('Новая комната. Вернуть прежнюю — кнопка ↶');
  },
  blank() {                             // чистый лист: ни комнаты, ни предметов — только сетка
    const snap = state.snap, grid = state.grid;
    load({ v: 1, room: { w: 50, d: 50, h: 20, floor: '#d9c7a8', wall: '#f4f1ea', blank: true }, snap, grid, items: [], dims: [] });
    commit();
    homeView();
    toast('Чистый лист. Комнату можно добавить инструментом «Комната». Вернуть прежнее — кнопка ↶');
  },
  help() { $('#helpDlg').showModal(); },
};
$('#menu').onclick = (e) => { const a = e.target.dataset?.act; if (a) { $('#menu').hidden = true; MENU[a](); } };
$('#roomDlg').addEventListener('close', () => {
  if ($('#roomDlg').returnValue !== 'ok') return;
  const g = (id, def) => clamp(parseFloat($(id).value) / 100 || def, 0.5, 50);
  const old = state.room, oldSun = state.room.sun;
  state.room = { w: g('#rW', state.room.w), d: g('#rD', state.room.d), h: Math.min(20, g('#rH', state.room.h)),
    floor: state.room.floor, wall: state.room.wall };
  if (oldSun) state.room.sun = oldSun;
  if (old.mesh) {                       // форма комнаты сохраняется и растягивается под новые размеры
    const kx = state.room.w / old.w, ky = state.room.h / old.h, kz = state.room.d / old.d;
    state.room.mesh = { ...old.mesh, v: old.mesh.v.map((q) => [r3(q[0] * kx), r3(q[1] * ky), r3(q[2] * kz)]) };
  }
  state.snap = parseFloat($('#rSnap').value) || 0;
  state.grid = $('#rGrid').checked;
  buildRoom(); fitOrtho(); commit();
});

addEventListener('keydown', (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); if (selId) duplicate(selId); return; }
  if (mod) return;
  const it = sel();
  if (k === 'v' || k === 'м') setTool('select');
  else if (k === 'i' || k === 'ш') setTool('act');
  else if (k === 'x' || k === 'ч') setTool('erase');
  else if (k === 'c' || k === 'с') setTool('room');
  else if (k === 'g' || k === 'п') { state.grid = state.grid === false; updateXRVis(); commit(); }
  else if (k === 't' || k === 'е') setTool('measure');
  else if (k === 'a' || k === 'ф') toggleCatalog();
  else if (k === 'escape') { if (cutA) { cancelCut(); updateStatus(); } else if (measureA) setTool('measure'); else if (!catalogEl.hidden) toggleCatalog(false); else select(null); }
  else if ((k === 'delete' || k === 'backspace') && it) removeItem(it.id);
  else if (k === 'q' || k === 'й') rotateSel(Math.PI / 2);
  else if (k === 'e' || k === 'у') rotateSel(-Math.PI / 2);
  else if (k.startsWith('arrow') && it && !it.lock) {
    e.preventDefault();
    const s = state.snap > 0 ? state.snap : 0.01;
    if (k === 'arrowleft') it.x -= s; if (k === 'arrowright') it.x += s;
    if (k === 'arrowup') it.z -= s; if (k === 'arrowdown') it.z += s;
    it.x = r3(it.x); it.z = r3(it.z);
    placeItem(it); updateGizmo(); refreshDims(it.id); commit();
  }
});

// ───────────────────────── WebXR: VR и AR ─────────────────────────
const xr = { kind: null, env: false, next: null, session: null, mode: null, anchored: true, mini: false, hit: null, aim: null, saved: null, refType: 'local-floor' };
const xray = new THREE.Raycaster();
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.115, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xa61e1e, depthTest: false, transparent: true }));
reticle.visible = false;
reticle.renderOrder = 30;
rig.add(reticle);
const tpMarker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.22, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x1f6feb, depthTest: false, transparent: true }));
tpMarker.visible = false;
tpMarker.renderOrder = 30;
scene.add(tpMarker);

// ── VR-меню на левом контроллере: тот же каталог и те же инструменты, что на экране ──
const TOOLS = [
  ['select', 'Выбор', 'M5 3l14 8-6 2-2 6z'],
  ['measure', 'Рулетка', 'M3 16L16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2'],
  ['erase', 'Ластик', 'M8 21h12M5.6 14.4l8-8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 20H8.5l-2.9-2.8a2 2 0 0 1 0-2.8zM10 10l6 6'],
  ['act', 'Действие', 'M9 12V5a1.5 1.5 0 0 1 3 0v5.5m0-1a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.6L4.6 15a1.5 1.5 0 0 1 2.5-1.7L9 15.5'],
  ['room', 'Комната', 'M3 21V9l9-6 9 6v12zM3 9l9 5 9-5M12 14v7'],
];
const VW = 720, VH = 1110, FONT = '"Oswald", "PT Sans", system-ui, sans-serif';
const INK = '#1b1a18', RED = '#A61E1E', CREAM = '#F6EEDB';
const vm = { cat: 'all', mesh: null, ctx: null, tex: null, regions: [], hover: null, dirty: true, tab: 'blanks', page: 0, imgs: new Map() };
function vmImg(url) {
  if (!url) return null;
  let im = vm.imgs.get(url);
  if (!im) {
    im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => { vm.dirty = true; };
    im.src = url;
    vm.imgs.set(url, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}
function vmBuild() {
  const c = document.createElement('canvas');
  c.width = VW; c.height = VH;
  vm.ctx = c.getContext('2d');
  vm.tex = new THREE.CanvasTexture(c);
  vm.tex.colorSpace = THREE.SRGBColorSpace;
  vm.tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const w = 0.3;
  vm.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * VH) / VW),
    new THREE.MeshBasicMaterial({ map: vm.tex, transparent: true }));
  vm.mesh.position.set(0, 0.3, -0.1);
  vm.mesh.rotation.x = -0.45;
  vm.mesh.renderOrder = 40;
}
function vmDraw() {
  const x = vm.ctx;
  vm.regions = [];
  vm.dirty = false;
  x.clearRect(0, 0, VW, VH);
  x.textBaseline = 'middle';
  const card = (cx, cy, w, h, fill) => {
    x.beginPath(); x.rect(cx + 2, cy + 2, w - 4, h - 4);
    x.fillStyle = fill; x.fill();
    x.strokeStyle = INK; x.lineWidth = 4; x.stroke();
  };
  const btn = (bx, by, w, h, act, label, o = {}) => {
    const hov = vm.hover === act && !o.off;
    x.globalAlpha = o.off ? 0.4 : 1;
    x.beginPath(); x.rect(bx, by, w, h);
    x.fillStyle = o.on ? INK : hov ? '#fff8e6' : o.bg || '#F3EAD4';
    x.fill();
    x.strokeStyle = hov ? RED : INK; x.lineWidth = hov ? 4 : 2; x.stroke();
    if (label) {
      x.fillStyle = o.on ? CREAM : o.fg || INK;
      x.font = `600 ${o.font || 22}px ${FONT}`;
      x.textAlign = 'center';
      x.fillText(label.toUpperCase(), bx + w / 2, by + h / 2 + 1);
    }
    x.globalAlpha = 1;
    if (!o.off) vm.regions.push({ x: bx, y: by, w, h, act });
  };
  const icon = (path, ix, iy, s, color, lw = 1.8) => {
    x.save(); x.translate(ix, iy); x.scale(s, s);
    x.strokeStyle = color; x.lineWidth = lw; x.lineCap = 'round'; x.lineJoin = 'round';
    x.stroke(new Path2D(path));
    x.restore();
  };
  const fit = (text, max) => { let t = text; while (t.length > 3 && x.measureText(t).width > max) t = t.slice(0, -2); return t === text ? t : t.trimEnd() + '…'; };

  // верхняя полоса
  card(1, 1, VW - 2, 86, '#E8DABB');
  icon('M4 6h16v3H4zM6 9l-1.5 11M18 9l1.5 11M7 15h10', 16, 20, 2, RED, 2.4);
  x.fillStyle = INK; x.font = `700 22px ${FONT}`; x.textAlign = 'left';
  x.fillText('ТАБУРЕТКА', 70, 45);
  btn(222, 16, 56, 56, 'undo', '↶', { font: 28, off: !undoStack.length });
  btn(284, 16, 56, 56, 'redo', '↷', { font: 28, off: !redoStack.length });
  btn(352, 16, 168, 56, 'env', 'Окружение', { on: xr.env, off: xr.mode !== 'ar', font: 20 });
  btn(528, 16, 112, 56, 'mini', 'Макет', { on: xr.mini, font: 20 });
  btn(648, 16, 56, 56, 'exit', '✕', { fg: RED });

  // каталог болванок
  card(1, 102, VW - 2, 846, '#EBDFC3');
  if (tool === 'room') {                // вместо каталога — страница комнаты
    const R = state.room;
    x.fillStyle = INK; x.font = `700 24px ${FONT}`; x.textAlign = 'left';
    x.fillText('КОМНАТА', 24, 142);
    x.font = '20px "PT Mono", ui-monospace, monospace'; x.fillStyle = '#5a5147';
    x.fillText(`${cm(R.w)} × ${cm(R.d)} × ${cm(R.h)} см`, 24, 180);
    x.font = 'italic 22px "PT Serif", Georgia, serif'; x.fillStyle = '#5a5147'; x.textAlign = 'left';
    ['Точки — углы, чёрточки — рёбра,', 'синие плашки — грани. Грани остаются плоскими.', '', 'Нажмите на элемент — появятся стрелки', 'только тех осей, по которым он двигается.', '', 'Разрез грани: нажмите на ребро,', 'затем на другое ребро той же грани —', 'красная линия покажет разрез.', '', 'Жёлтое солнце — направление света.']
      .forEach((t, i) => x.fillText(t, 24, 236 + i * 36));
  } else {
  let chx = 20, chy = 116;
  x.font = `600 18px ${FONT}`;
  for (const [id, label] of CATS) {
    const w = Math.ceil(x.measureText(label.toUpperCase()).width) + 28;
    if (chx + w > VW - 20) { chx = 20; chy += 50; }
    btn(chx, chy, w, 42, 'cat:' + id, label, { on: vm.cat === id, font: 18 });
    chx += w + 8;
  }
  const y0 = chy + 58;
  const list = CATALOG.filter((d) => vm.cat === 'all' || d.cat === vm.cat)
    .map((d) => ({ act: 'add:' + d.type, name: d.name, sub: `${cm(d.w)}×${cm(d.d)}×${cm(d.h)}`, img: blankThumbs[d.type] }));
  const rows = Math.max(1, Math.floor((874 - y0) / 190)), per = rows * 3, pages = Math.max(1, Math.ceil(list.length / per));
  vm.page = clamp(vm.page, 0, pages - 1);
  list.slice(vm.page * per, vm.page * per + per).forEach((t, i) => {
    const tx = 20 + (i % 3) * 230, ty = y0 + Math.floor(i / 3) * 190;
    btn(tx, ty, 220, 180, t.act, '', {});
    const im = vmImg(t.img);
    if (im) x.drawImage(im, tx + 39, ty + 6, 142, 106);
    x.textAlign = 'center';
    x.fillStyle = INK; x.font = `500 19px ${FONT}`;
    x.fillText(fit(t.name.toUpperCase(), 204), tx + 110, ty + 132);
    x.fillStyle = '#5a5147'; x.font = '15px "PT Mono", ui-monospace, monospace';
    x.fillText(t.sub, tx + 110, ty + 158);
  });
  vm.pages = pages;
  }
  const pages = vm.pages || 1;
  if (tool !== 'room') {
    btn(20, 884, 96, 50, 'page:-1', '◀', { off: vm.page <= 0 });
    btn(VW - 116, 884, 96, 50, 'page:1', '▶', { off: vm.page >= pages - 1 });
    x.fillStyle = INK; x.font = '20px "PT Mono", ui-monospace, monospace'; x.textAlign = 'center';
    x.fillText(`${vm.page + 1} / ${pages}`, VW / 2, 910);
  }

  // инструменты
  card(1, 962, VW - 2, 146, '#EBDFC3');
  TOOLS.forEach(([id, label, path], i) => drawTool(x, btn, icon, id, label, path, 10 + i * 88, 974, 84, 122));
  vm.tex.needsUpdate = true;
}
function drawTool(x, btn, icon, id, label, path, bx, by, w, h, hot = tool === id) {
  if (btn) btn(bx, by, w, h, 'tool:' + id, '', { on: hot });
  icon(path, bx + w / 2 - 26, by + 12, 2.2, hot ? CREAM : INK);
  x.fillStyle = hot ? CREAM : INK; x.font = `600 15px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(label.toUpperCase(), bx + w / 2, by + h - 26);
}
// Панель инструментов на B: держим кнопку на правом контроллере — перед лучом появляются карточки,
// наводим луч на нужную и отпускаем.
const tw = { mesh: null, ctx: null, tex: null, hover: -1, by: null };
const TW_COLS = 4, TW_CELL = 170, TW_PAD = 16, TW_HEAD = 58, TW_M = 0.3 / 712;   // метров на пиксель
const twRows = () => Math.ceil(TOOLS.length / TW_COLS);
const twW = () => TW_COLS * TW_CELL + 2 * TW_PAD, twH = () => twRows() * TW_CELL + 2 * TW_PAD + TW_HEAD;
function twDraw() {
  const x = tw.ctx, W = twW(), H = twH();
  x.clearRect(0, 0, W, H);
  x.fillStyle = '#EBDFC3'; x.fillRect(2, 2, W - 4, H - 4);
  x.strokeStyle = INK; x.lineWidth = 4; x.strokeRect(2, 2, W - 4, H - 4);
  x.fillStyle = INK; x.font = `700 22px ${FONT}`; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillText('ИНСТРУМЕНТЫ', TW_PAD + 6, TW_PAD + 22);
  x.font = 'italic 17px "PT Serif", Georgia, serif'; x.fillStyle = '#5a5147'; x.textAlign = 'right';
  x.fillText('наведите луч и отпустите B', W - TW_PAD - 6, TW_PAD + 23);
  const icon = (path, ix, iy, sc, color) => {
    x.save(); x.translate(ix, iy); x.scale(sc, sc);
    x.strokeStyle = color; x.lineWidth = 1.8; x.lineCap = 'round'; x.lineJoin = 'round';
    x.stroke(new Path2D(path)); x.restore();
  };
  TOOLS.forEach(([id, label, path], i) => {
    const cx = TW_PAD + (i % TW_COLS) * TW_CELL + 5, cy = TW_PAD + TW_HEAD + Math.floor(i / TW_COLS) * TW_CELL + 5, s = TW_CELL - 10;
    const hot = tw.hover === i, cur = tool === id;
    x.fillStyle = hot ? RED : cur ? INK : '#F3EAD4';
    x.fillRect(cx, cy, s, s);
    x.strokeStyle = INK; x.lineWidth = hot ? 5 : 2; x.strokeRect(cx, cy, s, s);
    const col = hot || cur ? CREAM : INK;
    icon(path, cx + s / 2 - 36, cy + 22, 3, col);
    x.fillStyle = col; x.font = `600 19px ${FONT}`; x.textAlign = 'center';
    x.fillText(label.toUpperCase(), cx + s / 2, cy + s - 28);
  });
  tw.tex.needsUpdate = true;
}
function twEnsure() {
  if (!tw.mesh) {
    const cv = document.createElement('canvas');
    cv.width = twW(); cv.height = twH();
    tw.ctx = cv.getContext('2d');
    tw.tex = new THREE.CanvasTexture(cv);
    tw.tex.colorSpace = THREE.SRGBColorSpace;
    tw.tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tw.mesh = new THREE.Mesh(new THREE.PlaneGeometry(twW() * TW_M, twH() * TW_M),
      new THREE.MeshBasicMaterial({ map: tw.tex, transparent: true, depthTest: false }));
    tw.mesh.renderOrder = 50;
    tw.mesh.visible = false;
    scene.add(tw.mesh);
  }
}
function twOpen(c) {
  twEnsure();
  const R = ctrlRay(c), idx = Math.max(0, TOOLS.findIndex((t) => t[0] === tool));
  // центр карточки текущего инструмента — под лучом
  const px = TW_PAD + (idx % TW_COLS + 0.5) * TW_CELL - twW() / 2;
  const py = twH() / 2 - (TW_PAD + TW_HEAD + (Math.floor(idx / TW_COLS) + 0.5) * TW_CELL);
  tw.mesh.position.copy(R.origin).addScaledVector(R.direction, 0.3);
  tw.mesh.lookAt(R.origin);
  tw.mesh.translateX(-px * TW_M);
  tw.mesh.translateY(-py * TW_M);
  tw.mesh.visible = true;
  tw.by = c; tw.hover = idx;
  twDraw();
}
function twHit(R) {
  if (!tw.mesh || !tw.mesh.visible) return null;
  xray.ray.copy(R);
  return xray.intersectObject(tw.mesh, false)[0] || null;
}
function twUpdate(c) {
  const h = twHit(ctrlRay(c));
  let i = -1;
  if (h && h.uv) {
    const col = Math.floor((h.uv.x * twW() - TW_PAD) / TW_CELL), row = Math.floor(((1 - h.uv.y) * twH() - TW_PAD - TW_HEAD) / TW_CELL);
    if (col >= 0 && col < TW_COLS && row >= 0 && row * TW_COLS + col < TOOLS.length) i = row * TW_COLS + col;
  }
  if (i !== tw.hover) { tw.hover = i; twDraw(); }
}
function twClose() {
  if (tw.hover >= 0) setTool(TOOLS[tw.hover][0]);
  tw.mesh.visible = false;
  tw.by = null;
}
function vmHit(R) {
  const m = vm.mesh;
  if (!m || !m.parent || !m.visible || !m.parent.visible) return null;
  xray.ray.copy(R);
  const h = xray.intersectObject(m, false)[0];
  if (!h || !h.uv) return null;
  const px = h.uv.x * VW, py = (1 - h.uv.y) * VH;
  const r = vm.regions.find((q) => px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h);
  return { act: r ? r.act : null, dist: h.distance };
}
function vmAction(act) {
  if (!act) return;
  const [k, v] = act.split(/:(.*)/);
  if (k === 'page') vm.page += +v;
  else if (k === 'add') addBlank(CATALOG.find((d) => d.type === v));
  else if (k === 'tool') setTool(v);
  else if (k === 'undo') undo();
  else if (k === 'redo') redo();
  else if (k === 'mini') setMini(!xr.mini);
  else if (k === 'exit') xr.session?.end();
  else if (k === 'env' && xr.mode === 'ar') { xr.env = !xr.env; updateXRVis(); }
  else if (k === 'cat') { vm.cat = v; vm.page = 0; }
  vm.dirty = true;
}

const ctrls = [];
function setupControllers() {
  const factory = new XRControllerModelFactory();
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.userData = { src: null, grab: null, start: false, end: false, squeeze: false, turned: false, btn: [], rotId: null };
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x1f6feb }));
    line.scale.z = 4;
    line.visible = false;
    c.userData.line = line;
    c.add(line);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0x1f6feb, depthTest: false, transparent: true }));
    dot.renderOrder = 60;
    dot.visible = false;
    c.userData.dot = dot;
    c.add(dot);
    c.addEventListener('connected', (e) => {
      c.userData.src = e.data;
      const tracked = e.data.targetRayMode === 'tracked-pointer';
      line.visible = tracked;
      if (tracked && e.data.handedness === 'left') { if (!vm.mesh) vmBuild(); c.add(vm.mesh); vm.dirty = true; }
      if (tracked && xr.mode === 'ar' && !xr.anchored) { xr.anchored = true; updateXRVis(); }   // шлем: пол уже известен
    });
    c.addEventListener('disconnected', () => {
      const u = c.userData;
      if (u.grab) u.end = true;
      u.src = null; u.squeeze = false;
      line.visible = dot.visible = false;
    });
    c.addEventListener('selectstart', () => { c.userData.start = true; });
    c.addEventListener('selectend', () => { c.userData.end = true; });
    c.addEventListener('squeezestart', () => { c.userData.squeeze = true; });
    c.addEventListener('squeezeend', () => { c.userData.squeeze = false; teleport(c); });
    rig.add(c);
    const grip = renderer.xr.getControllerGrip(i);
    grip.add(factory.createControllerModel(grip));
    rig.add(grip);
    ctrls.push(c);
  }
}
function ctrlRay(c) {
  c.updateMatrixWorld(true);
  return new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld),
    new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld));
}
function floorPoint(R) {               // пересечение с физическим полом (y = 0 в мировых координатах)
  if (R.direction.y > -0.02) return null;
  const t = (rig.position.y - R.origin.y) / R.direction.y;
  return t > 0 && t < 25 ? R.origin.clone().addScaledVector(R.direction, t) : null;
}
function teleport(c) {
  tpMarker.visible = false;
  if (!xr.env || !c.visible) return;
  const p = floorPoint(ctrlRay(c));
  if (!p) return;
  const h = camera.getWorldPosition(new THREE.Vector3());
  rig.position.x += p.x - h.x;
  rig.position.z += p.z - h.z;
}
// Курок: первое нажатие выделяет предмет, нажатие по уже выделенному — тащит (или работает активный инструмент).
function xrSelectStart(c, R) {
  if (xr.mode === 'ar' && !xr.anchored) { if (xr.aim) anchorWorld(xr.aim); return; }
  if (!c.visible) return;
  const reg = vmHit(R);
  if (reg) {
    if (reg.act && reg.act.startsWith('add:')) {   // карточку можно «вытащить» из меню и нести лучом
      const it = addBlank(CATALOG.find((d) => d.type === reg.act.slice(4)));
      c.userData.grab = { mode: 'move', ...makeGrab(it, new THREE.Vector3(it.x, it.y, it.z)), fromMenu: true, t0: performance.now() };
      vm.dirty = true;
    } else vmAction(reg.act);
    return;
  }
  if (tw.by) return;
  ray.ray.copy(R);
  if (tool === 'measure') { measureTap(); return; }
  if (tool === 'erase') { doErase(eraseTarget()); return; }
  if (tool === 'act') { const pk = pickItem(); if (pk) tapPart(pk); return; }
  const d = beginDrag(localRay(R), false);
  if (d) { d.t0 = performance.now(); c.userData.grab = d; cancelCut(); return; }
  if (tool === 'room') { tapCut(); return; }
  const pk = pickItem();
  select(pk ? pk.id : null);
}
function xrDrag(c, R) {
  const g = c.userData.grab;
  if (!c.visible || (g.fromMenu ? !!vmHit(R) : g.mode === 'move' && performance.now() - g.t0 < 200)) return;
  ray.ray.copy(R);
  updateDrag(g, localRay(R));
}
function xrSelectEnd(c) {
  const g = c.userData.grab;
  c.userData.grab = null;
  if (!g) return;
  if (g.mode === 'room') endRoomDrag(g);
  if (g.changed) { commit(); vm.dirty = true; }
  else if (g.mode === 'move' && g.pk && performance.now() - g.t0 < 300) tapPart(g.pk);
}
function updateAim(frame) {
  let p = null;
  if (xr.hit && frame) {
    const res = frame.getHitTestResults(xr.hit);
    const pose = res.length ? res[0].getPose(renderer.xr.getReferenceSpace()) : null;
    if (pose) p = new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
  }
  if (!p && xr.refType === 'local-floor') {
    p = floorPoint(new THREE.Ray(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldDirection(new THREE.Vector3())));
    if (p && p.distanceTo(camera.getWorldPosition(_c)) > 8) p = null;
  }
  xr.aim = p;
  reticle.visible = !!p && xr.mode === 'ar' && !xr.anchored;
  if (p) reticle.position.copy(p);
}
function anchorWorld(p) {
  const h = camera.getWorldPosition(new THREE.Vector3());
  world.position.copy(p);
  world.rotation.set(0, Math.atan2(h.x - p.x, h.z - p.z), 0);
  xr.anchored = true;
  updateXRVis(); updateXRHint();
}
function setMini(on) {
  xr.mini = on;
  const R = state.room;
  world.scale.setScalar(on ? Math.min(0.2, 0.9 / Math.max(R.w, R.d, 1)) : 1);
  if (xr.mode === 'vr' || ctrls.some((c) => c.userData.src?.targetRayMode === 'tracked-pointer')) {
    if (on) {
      const h = camera.getWorldPosition(new THREE.Vector3()), f = camera.getWorldDirection(new THREE.Vector3());
      f.y = 0; f.normalize();
      world.position.copy(h).addScaledVector(f, 0.9).setY(rig.position.y + Math.max(0.6, h.y - rig.position.y - 0.6));
    } else { world.position.set(0, 0, 0); world.rotation.set(0, 0, 0); }
  }
  updateXRVis(); updateXRHint();
}
function updateXRVis() {
  if (!floorMesh) return;
  const ar = xr.mode === 'ar', pass = ar && !xr.env, bare = pass && !xr.mini;   // pass — сквозной режим
  ground.visible = !pass && !xr.mini;
  scene.background = pass ? null : SKY;
  scene.fog = pass || view === 'plan' ? null : FOG;   // на плане камера далеко сверху — дымка замыливала бы всё
  floorMesh.visible = wallMesh.visible = wallEdges.visible = !bare;
  gridLines.visible = !bare && state.grid !== false;
  farGrid.visible = state.grid !== false;
  outline.visible = shadowFloor.visible = bare;
  if (view === 'plan' && !renderer.xr.isPresenting) wallMesh.visible = false;   // на плане из оболочки виден только пол
  if (state.room.blank) {               // чистый лист: комнаты не видно, тени ложатся прямо на подложку
    floorMesh.visible = wallMesh.visible = wallEdges.visible = gridLines.visible = outline.visible = false;
    shadowFloor.visible = true;
  }
  world.visible = !ar || xr.anchored;
  const b = $('[data-xr="mini"]');
  if (b) b.textContent = xr.mini ? 'Размер 1:1' : 'Макет';
  vm.dirty = true;
}
function updateXRHint() {
  if (xr.mode !== 'ar') return;
  const it = sel();
  $('#xrHint').textContent = !xr.anchored ? 'Наведите прицел на пол и коснитесь экрана — сюда встанет центр комнаты'
    : it ? `${it.name}: тащите пальцем, ⟲ ⟳ — поворот` : 'Коснитесь предмета, чтобы выбрать. ⟲ ⟳ поворачивают всю комнату';
}
// Стики и кнопки. Правый стик ←→ вращает выделенный предмет; A — «Тянуть», B — «Рулетка»;
// X — отмена, Y — спрятать меню. В сквозном режиме (AR) ходьбы нет: левый стик аккуратно двигает
// саму комнату, правый (когда ничего не выделено) — поворачивает её.
function sticks(dt) {
  for (const c of ctrls) {
    const u = c.userData, src = u.src, gp = src?.gamepad;
    if (xr.env && u.squeeze && c.visible) {
      const p = floorPoint(ctrlRay(c));
      tpMarker.visible = !!p;
      if (p) tpMarker.position.copy(p).setY(p.y + 0.01);
    }
    if (!gp || src.targetRayMode !== 'tracked-pointer') continue;
    const hand = src.handedness, edge = (i) => { const p = !!gp.buttons[i]?.pressed, was = !!u.btn[i]; u.btn[i] = p; return p && !was; };
    if (hand === 'right') {             // B: держать — кольцо инструментов
      const held = !!gp.buttons[5]?.pressed;
      if (held && !tw.by && !u.grab) twOpen(c);
      else if (held && tw.by === c) twUpdate(c);
      else if (!held && tw.by === c) twClose();
    } else if (hand === 'left') {
      if (edge(4)) undo();
      if (edge(5) && vm.mesh) vm.mesh.visible = !vm.mesh.visible;
    }
    const ax = gp.axes;
    const x = (Math.abs(ax[2] ?? 0) > Math.abs(ax[0] ?? 0) ? ax[2] : ax[0]) || 0;
    const y = (Math.abs(ax[3] ?? 0) > Math.abs(ax[1] ?? 0) ? ax[3] : ax[1]) || 0;
    if (hand === 'right') {             // правый стик: вперёд-назад — движение, влево-вправо — плавный поворот
      const f = camera.getWorldDirection(new THREE.Vector3());
      f.y = 0; f.normalize();
      if (xr.env) {
        if (Math.abs(x) > 0.2) {
          const an = -Math.sign(x) * ((Math.abs(x) - 0.2) / 0.8) * 1.6 * dt, h = camera.getWorldPosition(new THREE.Vector3());
          rig.position.sub(h).applyAxisAngle(THREE.Object3D.DEFAULT_UP, an).add(h);
          rig.rotation.y += an;
        }
        if (Math.abs(y) > 0.2) rig.position.addScaledVector(f, -Math.sign(y) * ((Math.abs(y) - 0.2) / 0.8) * 1.6 * dt);
      } else {                          // сквозной режим: стик аккуратно двигает и поворачивает саму комнату
        if (Math.abs(x) > 0.35) world.rotation.y -= x * dt * 0.5;
        if (Math.abs(y) > 0.35) world.position.addScaledVector(f, -y * 0.4 * dt);
      }
    } else if (hand === 'left') {       // левый стик листает меню: ←→ страницы, ↑↓ вкладки
      const nx = Math.abs(x) > 0.6 && Math.abs(x) >= Math.abs(y) ? Math.sign(x) : 0;
      const ny = Math.abs(y) > 0.6 && Math.abs(y) > Math.abs(x) ? Math.sign(y) : 0;
      if (nx && nx !== u.navx) { vm.page += nx; vm.dirty = true; }
      if (ny && ny !== u.navy) {
        const n = CATS.length, i = CATS.findIndex((q) => q[0] === vm.cat);
        vm.cat = CATS[(Math.max(0, i) + ny + n) % n][0];
        vm.page = 0; vm.dirty = true;
      }
      u.navx = nx; u.navy = ny;
    }
  }
}
const lastAim = new THREE.Vector3(1e9, 0, 0);
function xrTick(frame, dt) {
  rig.updateMatrixWorld(true);
  updateAim(frame);
  let hover = null, aimed = false, hotH = null;
  const handleDrag = ctrls.some((c) => c.userData.grab && c.userData.grab.mode !== 'move');
  for (const c of ctrls) {
    const u = c.userData, R = ctrlRay(c);
    if (u.start) { u.start = false; xrSelectStart(c, R); }
    if (u.grab) xrDrag(c, R);
    if (c.visible && u.src?.targetRayMode === 'tracked-pointer') {
      let dist = null, lineCol = 0x1f6feb;
      const reg = tw.by ? null : vmHit(R), th = tw.by ? twHit(R) : null;
      if (reg) { dist = reg.dist; if (!u.grab) hover = reg.act || hover; }
      else if (th) dist = th.distance;
      else if (!tw.by) {
        ray.ray.copy(R);
        const h = u.grab ? null : pickHandle();
        if (h) { hotH = hotH || h; dist = h.getWorldPosition(_v).distanceTo(R.origin); }
        else {                          // куда упирается луч: предмет или пол
          const hit = ray.intersectObjects(itemsG.children, true)[0];
          if (hit) dist = hit.distance;
          else { const lr = localRay(R), p = hitPlaneY(lr, 0); if (p) dist = p.distanceTo(lr.o) * (world.scale.x || 1); }
        }
        if (!u.grab && !aimed && u.src.handedness !== 'left') {
          if (tool === 'room') { aimed = true; showCut(h ? null : findCut()); }
          if (tool === 'erase') {       // ластик: цель краснеет
            aimed = true;
            const t = eraseTarget();
            showErase(t);
            if (t) lineCol = 0xd11919;
          } else if (tool === 'measure') {   // метка привязки под лучом
            aimed = true;
            const m = measurePoint();
            showSnap(m);
            if (m) {
              _v.copy(m.p).applyMatrix4(world.matrixWorld);
              dist = _v.distanceTo(R.origin);
              if (m.p.distanceTo(lastAim) > 0.004) {
                lastAim.copy(m.p);
                clearGroup(tmpG);
                if (measureA) dimObjects(tmpG, measureA.p, m.p);
              }
            }
          }
        }
      }
      const on = dist !== null && dist < 12;
      u.line.scale.z = on ? dist : 4;
      u.line.material.color.set(lineCol);
      u.dot.visible = on;
      if (on) { u.dot.position.z = -dist; u.dot.scale.setScalar(0.004 + dist * 0.007); u.dot.material.color.set(lineCol); }
    }
    if (u.end) { u.end = false; xrSelectEnd(c); }
  }
  if (!handleDrag) setHot(hotH);
  if (hover !== vm.hover) { vm.hover = hover; vm.dirty = true; }
  sticks(dt);
  if (vm.mesh && vm.mesh.parent && vm.mesh.visible && vm.dirty) {
    try { vmDraw(); } catch (e) { vm.dirty = false; console.error('vr menu', e); }
  }
}

async function startXR(mode) {
  if (xr.session) return;
  const type = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
  const overlay = $('#xr-overlay');
  const opt = mode === 'ar' ? ['hit-test', 'dom-overlay', 'hand-tracking'] : ['bounded-floor', 'hand-tracking'];
  const base = mode === 'ar' ? { domOverlay: { root: overlay } } : {};
  if (mode === 'ar') overlay.hidden = false;
  let session = null;
  try {
    xr.refType = 'local-floor';
    session = await navigator.xr.requestSession(type, { ...base, requiredFeatures: ['local-floor'], optionalFeatures: opt });
  } catch {
    try {
      xr.refType = 'local';
      session = await navigator.xr.requestSession(type, { ...base, optionalFeatures: opt });
    } catch (e) {
      overlay.hidden = true;
      toast(`Не удалось запустить ${mode.toUpperCase()}: ${e?.message || e}`, 5000);
      return;
    }
  }
  try {
    select(null);
    setTool('select');
    setView('3d');
    toggleCatalog(false);
    xr.saved = { p: camera.position.clone(), q: camera.quaternion.clone() };
    xr.mode = mode; xr.env = mode !== 'ar'; xr.mini = false; xr.anchored = mode !== 'ar'; xr.aim = null; xr.hit = null;
    controls3d.enabled = false;
    renderer.xr.setReferenceSpaceType(xr.refType);
    await renderer.xr.setSession(session);
    xr.session = session;
    session.addEventListener('end', onXREnd);
    if (mode === 'ar') {
      overlay.append(catalogEl);
      try {
        const vs = await session.requestReferenceSpace('viewer');
        xr.hit = await session.requestHitTestSource({ space: vs });
      } catch { /* без hit-test используем оценку пола */ }
    } else overlay.hidden = true;
    $('#props').hidden = true;
    updateXRVis(); updateXRHint();
  } catch (e) {
    console.error(e);
    toast('Ошибка запуска XR: ' + (e?.message || e), 5000);
    try { await session.end(); } catch { /* уже закрыта */ }
    if (!xr.session) onXREnd();
  }
}
function onXREnd() {
  xr.session = null; xr.mode = null; xr.hit = null; xr.aim = null; xr.mini = false; xr.anchored = true;
  for (const c of ctrls) { c.userData.grab = null; c.userData.start = c.userData.end = c.userData.squeeze = false; }
  $('#xr-overlay').hidden = true;
  document.body.append(catalogEl);
  toggleCatalog(false);
  reticle.visible = tpMarker.visible = false;
  if (tw.mesh) tw.mesh.visible = false;
  tw.by = null;
  world.position.set(0, 0, 0); world.rotation.set(0, 0, 0); world.scale.setScalar(1);
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  if (xr.saved) { camera.position.copy(xr.saved.p); camera.quaternion.copy(xr.saved.q); }
  camera.fov = 50;
  sun.castShadow = true;
  controls3d.enabled = view === '3d';
  updateXRVis();
  setTimeout(() => { resize(); updateProps(); }, 60);
  const next = xr.next;
  xr.next = null;
  if (next) startXR(next);              // переключение VR ⇄ AR из меню в шлеме
}
$('#xr-overlay').addEventListener('beforexrselect', (e) => { if (e.target !== e.currentTarget) e.preventDefault(); });
$('#xrBar').onclick = (e) => {
  const a = e.target.dataset?.xr;
  if (!a) return;
  if (a === 'add') toggleCatalog();
  else if (a === 'rotl' || a === 'rotr') {
    const s = a === 'rotl' ? 1 : -1;
    if (sel()) rotateSel(s * Math.PI / 12);
    else world.rotation.y += s * THREE.MathUtils.degToRad(5);
  } else if (a === 'del') { if (selId) removeItem(selId); }
  else if (a === 'mini') setMini(!xr.mini);
  else if (a === 'anchor') { xr.anchored = false; select(null); updateXRVis(); updateXRHint(); }
  else if (a === 'exit') xr.session?.end();
};

async function quickLook() {            // iPhone / iPad: без WebXR, через AR Quick Look
  try {
    toast('Готовлю сцену для AR…');
    const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
    select(null);
    const data = await new USDZExporter().parseAsync(itemsG);
    const a = document.createElement('a');
    a.rel = 'ar';
    a.href = URL.createObjectURL(new Blob([data], { type: 'model/vnd.usdz+zip' }));
    a.download = 'taburetka.usdz';
    a.append(document.createElement('img'));
    a.click();
  } catch (e) { console.error(e); toast('Не получилось подготовить AR: ' + (e?.message || e), 5000); }
}
async function detectXR() {             // одна кнопка: сквозной режим, если шлем умеет, иначе обычный VR
  let ar = false, vr = false;
  if (navigator.xr) {
    try { vr = await navigator.xr.isSessionSupported('immersive-vr'); } catch { /* нет VR */ }
    try { ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch { /* нет AR */ }
  }
  xr.kind = ar ? 'ar' : vr ? 'vr' : null;
  if (xr.kind) $('#btnVR').hidden = false;
  else if (document.createElement('a').relList?.supports?.('ar')) $('#btnQL').hidden = false;
}
$('#btnVR').onclick = () => xr.kind && startXR(xr.kind);
$('#btnQL').onclick = quickLook;

// ───────────────────────── запуск ─────────────────────────
window.__taburetka = { vm, vmBuild, vmDraw, tw, twDraw, twEnsure };
document.fonts?.load('600 20px Oswald').then(() => { vm.dirty = true; });
document.fonts?.load('20px "PT Mono"').then(() => { vm.dirty = true; rebuildDims(); });
function boot() {
  let data = null;
  const m = location.hash.match(/[#&]p=([\w-]+)/);
  if (m) { try { data = JSON.parse(b64d(m[1])); history.replaceState(null, '', location.pathname + location.search); } catch { toast('Ссылка на проект повреждена'); } }
  if (!data) { try { data = JSON.parse(localStorage.getItem(STORE)); } catch { /* пусто */ } }
  if (!data || !data.room) data = demo();
  load(data);
  cur = serialize();
  save();
  refreshHistoryButtons();
  resize();
  buildCatalog();
  setupControllers();
  detectXR();
  setTool('select');

  let last = 0;
  renderer.setAnimationLoop((t, frame) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    if (renderer.xr.isPresenting) xrTick(frame, dt);
    else ctl().update();
    if (anims.length) runAnims(dt);
    updateConstSize();
    if (renderer.xr.isPresenting || !post) renderer.render(scene, renderer.xr.isPresenting ? camera : cam());
    else { try { post.render(cam()); } catch (e) { console.warn('Затенение отключено', e); post = null; } }
  });
  initPost();
}
boot();
