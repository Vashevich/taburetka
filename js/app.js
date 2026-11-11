// Табуретка — планировщик комнаты: 3D в браузере, VR и AR через WebXR.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { CATALOG, fillBlank, EDGE } from './furniture.js';

const LIBS = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/';
const KHR = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/';
const SAMPLES = [
  ['Стул', 'SheenChair'], ['Бархатный диван', 'GlamVelvetSofa'], ['Диван кожа/дерево', 'SheenWoodLeatherSofa'],
  ['Кресло', 'ChairDamaskPurplegold'], ['Лампа', 'IridescenceLamp'], ['Фонарь', 'AnisotropyBarnLamp'],
  ['Растение', 'DiffuseTransmissionPlant'], ['Холодильник', 'CommercialRefrigerator'],
].map(([name, id]) => ({ name, url: `${KHR}${id}/glTF-Binary/${id}.glb` }));
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
const SKY = new THREE.Color('#e9eef2');
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
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48),
  new THREE.MeshStandardMaterial({ color: '#d5dbd3', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
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
  const mk = (t, x, z, rot = 0) => {
    const c = pick(t);
    return { id: uid(), type: t, name: c.name, w: c.w, d: c.d, h: c.h, x, z, y: c.y || 0, rot, color: c.color };
  };
  return {
    v: 1, room: { ...state.room }, snap: 0.05, dims: [],
    items: [mk('bed', -1.2, -1.45), mk('wardrobe', 1.4, -2.2), mk('desk', 1.7, 0.9, -Math.PI / 2),
      mk('chair', 1.1, 0.9, Math.PI / 2), mk('stool', -0.3, 1.3), mk('plant', -1.7, 2.2)],
  };
}

function normalize(d) {
  const num = (v, def) => (Number.isFinite(+v) ? +v : def);
  const room = d.room || {};
  return {
    room: {
      w: clamp(num(room.w, 4), 0.5, 50), d: clamp(num(room.d, 5), 0.5, 50), h: clamp(num(room.h, 2.7), 0.5, 20),
      floor: room.floor || '#d9c7a8', wall: room.wall || '#f4f1ea',
    },
    snap: num(d.snap, 0.05),
    dims: Array.isArray(d.dims) ? d.dims.filter((m) => m && m.a && m.b) : [],
    items: (Array.isArray(d.items) ? d.items : []).filter((i) => i && i.type).map((i) => ({
      ...i, id: i.id || uid(), name: String(i.name || 'Предмет'),
      w: Math.max(0.01, num(i.w, 0.6)), d: Math.max(0.01, num(i.d, 0.6)), h: Math.max(0.005, num(i.h, 0.6)),
      x: num(i.x, 0), z: num(i.z, 0), y: num(i.y, 0), rot: num(i.rot, 0),
    })),
  };
}

const serialize = () => JSON.stringify({ v: 1, room: state.room, snap: state.snap, items: state.items, dims: state.dims });
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
  $('#btnUndo').disabled = !undoStack.length;
  $('#btnRedo').disabled = !redoStack.length;
}

function load(data) {
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
let floorMesh, wallMesh, gridLines, wallEdges, outline;
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

function buildRoom() {
  disposeChildren(roomG);
  const { w, d, h, floor, wall } = state.room;
  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: floor, roughness: 0.95 }));
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;

  const pts = [];
  for (let x = Math.ceil(-w / 2 / 0.5) * 0.5; x <= w / 2 + 1e-6; x += 0.5) pts.push(x, 0, -d / 2, x, 0, d / 2);
  for (let z = Math.ceil(-d / 2 / 0.5) * 0.5; z <= d / 2 + 1e-6; z += 0.5) pts.push(-w / 2, 0, z, w / 2, 0, z);
  gridLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1 }));
  gridLines.position.y = 0.003;

  const wm = new THREE.MeshStandardMaterial({ color: wall, roughness: 1, side: THREE.BackSide });
  const none = new THREE.MeshBasicMaterial({ visible: false });
  const boxGeo = new THREE.BoxGeometry(w, h, d);
  wallMesh = new THREE.Mesh(boxGeo, [wm, wm, wm, none, wm, wm]);   // изнутри видно, снаружи — прозрачно
  wallMesh.position.y = h / 2;
  wallMesh.receiveShadow = true;
  wallEdges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), EDGE);
  wallEdges.position.y = h / 2;

  const o = [-w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2];
  outline = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(o, 3)),
    new THREE.LineBasicMaterial({ color: 0xd9482b }));
  outline.position.y = 0.004;

  for (const m of [floorMesh, gridLines, wallMesh, wallEdges, outline]) m.raycast = () => {};
  roomG.add(floorMesh, gridLines, wallMesh, wallEdges, outline);
  updateXRVis();
}

// ───────────────────────── предметы ─────────────────────────
const modelCache = new Map();           // src → {promise} | {scene,size,offset,fit} | {error}
let gltfLoader = null;
function getGLTFLoader() {
  if (gltfLoader) return gltfLoader;
  gltfLoader = new GLTFLoader();
  try {
    gltfLoader.setDRACOLoader(new DRACOLoader().setDecoderPath(LIBS + 'draco/gltf/'));
    gltfLoader.setKTX2Loader(new KTX2Loader().setTranscoderPath(LIBS + 'basis/').detectSupport(renderer));
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  } catch (e) { console.warn(e); }
  return gltfLoader;
}
const extOf = (s) => ((String(s).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();

async function loadTemplate(src) {
  let url = src, name = src, revoke = null;
  if (src.startsWith('idb:')) {
    const rec = await idbGet(src.slice(4));
    if (!rec) throw new Error('файл не найден в памяти этого браузера');
    url = revoke = URL.createObjectURL(rec.blob);
    name = rec.name;
  }
  try {
    const ext = extOf(name);
    let object;
    if (ext === 'obj') {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      object = await new OBJLoader().loadAsync(url);
    } else if (ext === 'stl') {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
      const geo = await new STLLoader().loadAsync(url);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#cfcac0', roughness: 0.8 }));
      mesh.rotation.x = -Math.PI / 2;
      object = new THREE.Group().add(mesh);
    } else if (ext === 'fbx') {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      object = await new FBXLoader().loadAsync(url);
    } else {
      object = (await getGLTFLoader().loadAsync(url)).scene;
    }
    object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) throw new Error('в файле нет геометрии');
    const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-4, 1e-4, 1e-4));
    const c = box.getCenter(new THREE.Vector3());
    // угадываем единицы: метры → как есть, сантиметры/миллиметры → приводим к метрам
    const m = Math.max(size.x, size.y, size.z);
    let k = 1;
    if (m > 8) { k = 0.01; if (m * k > 8) k = 0.001; if (m * k > 8) k = 2 / m; }
    else if (m < 0.03) k = 0.5 / m;
    return { scene: object, size, offset: new THREE.Vector3(-c.x, -box.min.y, -c.z), fit: size.clone().multiplyScalar(k) };
  } finally {
    if (revoke) URL.revokeObjectURL(revoke);
  }
}

function fillModel(it, g) {
  const tpl = modelCache.get(it.src);
  if (tpl && tpl.scene) {
    const inner = tpl.scene.clone(true);
    inner.position.add(tpl.offset);
    const wrap = new THREE.Group().add(inner);
    wrap.scale.set(it.w / tpl.size.x, it.h / tpl.size.y, it.d / tpl.size.z);
    g.add(wrap);
    g.userData.shared = true;           // геометрия общая с шаблоном — не освобождаем
    return;
  }
  const ph = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h, it.d),
    new THREE.MeshStandardMaterial({ color: tpl?.error ? '#d98a7a' : '#9fb6d9', transparent: true, opacity: 0.45 }));
  ph.position.y = it.h / 2;
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(ph.geometry), EDGE);
  e.raycast = () => {};
  ph.add(e);
  g.add(ph);
  if (tpl) return;
  const src = it.src;
  modelCache.set(src, { promise: true });
  loadTemplate(src).then((t) => modelCache.set(src, t), (err) => {
    console.error(err);
    modelCache.set(src, { error: true });
    toast(`Не удалось загрузить «${it.name}»: ${err?.message || 'ошибка сети или CORS'}`, 6000);
  }).then(() => {
    const t = modelCache.get(src);
    for (const o of state.items) {
      if (o.type !== 'model' || o.src !== src) continue;
      if (o.fit && t.scene) { o.w = r3(t.fit.x); o.h = r3(t.fit.y); o.d = r3(t.fit.z); delete o.fit; }
      const og = objs.get(o.id);
      if (og) fillItem(o, og);
    }
    silentSave(); updateGizmo(); updateProps(); updateStatus();
  });
}

function fillItem(it, g) {
  disposeChildren(g);
  if (it.type === 'model') fillModel(it, g);
  else fillBlank(g, it.type, it.w, it.d, it.h, it.color);
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
const snapLen = (v) => (state.snap > 0 ? Math.max(state.snap, Math.round(v / state.snap) * state.snap) : v);
const snapRot = (a) => { const s = Math.PI / 12; return state.snap > 0 ? Math.round(a / s) * s : a; };

function spawnXZ() {
  if (renderer.xr.isPresenting) {
    let p = null;
    if (xr.mode === 'ar' && xr.aim) p = xr.aim.clone();
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
  state.items.push(it);
  makeItemObj(it);
  select(it.id);
  commit();
  return it;
}
function addBlank(def) {
  return addItemData({ id: uid(), type: def.type, name: def.name, w: def.w, d: def.d, h: def.h,
    x: 0, z: 0, y: def.y || 0, rot: 0, color: def.color });
}
function addModel(src, name) {
  return addItemData({ id: uid(), type: 'model', src, name, w: 0.6, d: 0.6, h: 0.6, fit: true, keep: true,
    x: 0, z: 0, y: 0, rot: 0 });
}
function normalizeUrl(u) {
  u = u.trim();
  const m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : u;
}
function addModelFromUrl(raw) {
  const url = normalizeUrl(raw);
  if (!/^https?:\/\//i.test(url)) { toast('Нужна ссылка, начинающаяся с https://'); return; }
  const base = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'Модель').replace(/\.[a-z0-9]+$/i, '');
  addModel(url, base || 'Модель');
}
async function addModelFromFile(file) {
  if (!['glb', 'gltf', 'obj', 'stl', 'fbx'].includes(extOf(file.name))) { toast('Поддерживаются GLB, glTF, OBJ, STL, FBX'); return; }
  const key = uid() + uid();
  try { await idbPut(key, { blob: file, name: file.name }); }
  catch { toast('Браузер не дал сохранить файл — модель пропадёт после перезагрузки'); }
  addModel('idb:' + key, file.name.replace(/\.[a-z0-9]+$/i, ''));
}
function removeItem(id) {
  const g = objs.get(id);
  if (g) { disposeChildren(g); itemsG.remove(g); objs.delete(id); }
  state.items = state.items.filter((i) => i.id !== id);
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
  it.rot = snapRot(it.rot + a);
  placeItem(it); updateGizmo(); updateProps(); commit();
}

// ───────────────────────── IndexedDB для файлов с устройства ─────────────────────────
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('taburetka', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const rq = db.transaction('files').objectStore('files').get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

// ───────────────────────── камеры и вид ─────────────────────────
const controls3d = new OrbitControls(camera, canvas);
controls3d.target.set(0, 0.6, 0);
controls3d.maxPolarAngle = Math.PI / 2 - 0.02;
controls3d.minDistance = 0.4;
controls3d.maxDistance = 60;
controls3d.zoomToCursor = true;
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
}
function resize() {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fitOrtho();
}
addEventListener('resize', resize);

// ───────────────────────── лучи и выбор ─────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2(), _inv = new THREE.Matrix4(), _v = new THREE.Vector3(), _c = new THREE.Vector3();

function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
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
    if (o && o.userData.id) return { id: o.userData.id, point: h.point.clone() };
  }
  return null;
}

// ───────────────────────── выделение и «ручки» ─────────────────────────
const SEL = new THREE.LineBasicMaterial({ color: 0x1f6feb, depthTest: false, transparent: true });
const HCOL = { x: 0xd9482b, z: 0x2e9e4f, y: 0x1f6feb };
let handles = [];
const ringR = (it) => Math.hypot(it.w, it.d) / 2 + 0.12;

function select(id) {
  selId = id && item(id) ? id : null;
  updateGizmo(); updateProps(); updateStatus(); updateXRHint();
}
function updateGizmo() {
  for (const c of [...gizmo.children]) { gizmo.remove(c); c.geometry?.dispose(); if (c.material !== SEL) c.material?.dispose?.(); }
  handles = [];
  const it = sel();
  gizmo.visible = !!it;
  if (!it) return;
  gizmo.position.set(it.x, it.y, it.z);
  gizmo.rotation.y = it.rot;
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(it.w + 0.012, it.h + 0.012, it.d + 0.012)), SEL);
  box.position.y = it.h / 2;
  box.renderOrder = 10;
  gizmo.add(box);
  if (tool === 'pull' && !it.lock) {
    for (const [axis, sign, x, y, z] of [['x', 1, it.w / 2, it.h / 2, 0], ['x', -1, -it.w / 2, it.h / 2, 0],
      ['z', 1, 0, it.h / 2, it.d / 2], ['z', -1, 0, it.h / 2, -it.d / 2], ['y', 1, 0, it.h, 0]]) {
      const hm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: HCOL[axis], depthTest: false, transparent: true }));
      hm.position.set(x, y, z);
      hm.renderOrder = 11;
      hm.userData = { axis, sign, cs: coarse ? 0.02 : 0.012 };
      gizmo.add(hm);
      handles.push(hm);
    }
  }
  if (tool === 'rotate' && !it.lock) {
    const r = ringR(it);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.015, r + 0.015, 64),
      new THREE.MeshBasicMaterial({ color: 0x1f6feb, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    ring.renderOrder = 10;
    const tick = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20),
      new THREE.MeshBasicMaterial({ color: 0x1f6feb, side: THREE.DoubleSide, depthTest: false, transparent: true }));
    tick.rotation.x = -Math.PI / 2;
    tick.position.set(0, 0.012, r);
    tick.renderOrder = 11;
    gizmo.add(ring, tick);
  }
}
// высота видимой области (в единицах world) на расстоянии объекта — для элементов постоянного экранного размера
function viewHeightAt(obj) {
  const c = renderer.xr.isPresenting ? camera : cam(), ws = world.scale.x || 1;
  if (c.isOrthographicCamera) return (c.top - c.bottom) / c.zoom / ws;
  obj.getWorldPosition(_v); c.getWorldPosition(_c);
  return (_v.distanceTo(_c) * 2 * Math.tan(THREE.MathUtils.degToRad(c.fov / 2))) / ws;
}
function updateConstSize() {
  for (const h of handles) h.scale.setScalar(h.userData.cs * viewHeightAt(h));
  for (const g of [dimsG, tmpG]) for (const o of g.children) {
    if (!o.userData.label) continue;
    const s = 0.034 * viewHeightAt(o);
    o.scale.set(s * o.userData.aspect, s, 1);
  }
}
function pickHandle() {
  let best = null, bd = Infinity;
  for (const h of handles) {
    h.getWorldPosition(_v);
    const d = ray.ray.distanceToPoint(_v), lim = h.scale.x * (world.scale.x || 1) * 2.4;
    if (d < lim && d < bd) { bd = d; best = h; }
  }
  return best;
}

// ───────────────────────── рулетка ─────────────────────────
const DIM = new THREE.LineBasicMaterial({ color: 0xd9482b, depthTest: false, transparent: true });
let measureA = null;
function makeLabel(text) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), font = '600 40px system-ui, sans-serif';
  x.font = font;
  c.width = Math.ceil(x.measureText(text).width) + 32;
  c.height = 64;
  x.font = font;
  x.fillStyle = '#fffdf8';
  x.beginPath();
  if (x.roundRect) x.roundRect(1, 1, c.width - 2, 62, 14); else x.rect(1, 1, c.width - 2, 62);
  x.fill();
  x.strokeStyle = '#d9482b'; x.lineWidth = 3; x.stroke();
  x.fillStyle = '#1d1d1b'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, c.width / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.userData = { label: true, aspect: c.width / c.height };
  sp.renderOrder = 20;
  sp.raycast = () => {};
  return sp;
}
function dimObjects(group, a, b) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), DIM);
  line.renderOrder = 19;
  const lab = makeLabel(fmt(a.distanceTo(b)));
  lab.position.copy(a).add(b).multiplyScalar(0.5);
  group.add(line, lab);
}
function clearGroup(g) {
  for (const c of [...g.children]) { g.remove(c); c.geometry?.dispose(); if (c.material !== DIM) { c.material?.map?.dispose(); c.material?.dispose(); } }
}
function rebuildDims() {
  clearGroup(dimsG);
  for (const m of state.dims) dimObjects(dimsG, new THREE.Vector3(...m.a), new THREE.Vector3(...m.b));
}
function measurePoint() {
  const pk = pickItem();
  if (pk) { world.updateMatrixWorld(true); return world.worldToLocal(pk.point); }
  const p = hitPlaneY(localRay(ray.ray), 0);
  if (p && state.snap > 0) { p.x = Math.round(p.x / state.snap) * state.snap; p.z = Math.round(p.z / state.snap) * state.snap; }
  return p;
}

// ───────────────────────── указатель (мышь / палец) ─────────────────────────
let drag = null, down = null;

function startDrag(d, e) {
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
  if (tool === 'measure') return;
  setRay(e);
  const it = sel(), lr = localRay(ray.ray);
  if (it && tool === 'pull' && !it.lock) {
    const h = pickHandle();
    if (h) {
      down.noTap = true;
      startDrag({ mode: 'pull', id: it.id, axis: h.userData.axis, sign: h.userData.sign, rot: it.rot,
        w0: it.w, d0: it.d, h0: it.h, x0: it.x, z0: it.z, hy: it.y + it.h / 2 }, e);
      return;
    }
  }
  const pk = pickItem();
  if (it && tool === 'rotate' && !it.lock) {
    const p = hitPlaneY(lr, it.y);
    if (p && ((pk && pk.id === it.id) || Math.hypot(p.x - it.x, p.z - it.z) < ringR(it) * 1.3)) {
      down.noTap = true;
      startDrag({ mode: 'rotate', id: it.id, a0: Math.atan2(p.x - it.x, p.z - it.z), rot0: it.rot }, e);
      return;
    }
  }
  if (pk && (e.pointerType === 'mouse' || pk.id === selId)) {
    if (pk.id !== selId) select(pk.id);
    const t = item(pk.id);
    if (t.lock) return;
    world.updateMatrixWorld(true);
    const pl = world.worldToLocal(pk.point);
    startDrag({ mode: 'move', id: t.id, py: pl.y, off: { x: t.x - pl.x, z: t.z - pl.z } }, e);
  }
}
function applyPull(it, d, lr) {
  let f = 1;
  if (d.axis === 'y') {
    const n = cam().getWorldDirection(new THREE.Vector3());
    n.y = 0;
    if (n.lengthSq() < 1e-4) return false;         // вид строго сверху — высоту не потянуть
    n.normalize();
    const den = lr.d.dot(n);
    if (Math.abs(den) < 1e-5) return false;
    const t = new THREE.Vector3(d.x0, 0, d.z0).sub(lr.o).dot(n) / den;
    if (!(t > 0)) return false;
    const nh = snapLen(Math.max(0.01, lr.o.y + lr.d.y * t - it.y));
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
  const ns = snapLen(Math.max(0.02, d.sign * l + size0 / 2));
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
    const it = item(drag.id);
    if (!it) { drag = null; ctl().enabled = true; return; }
    setRay(e);
    const lr = localRay(ray.ray);
    if (drag.mode === 'move') {
      const p = hitPlaneY(lr, drag.py);
      if (!p) return;
      [it.x, it.z] = snapPos(it, p.x + drag.off.x, p.z + drag.off.z);
      placeItem(it);
      gizmo.position.set(it.x, it.y, it.z);
    } else if (drag.mode === 'rotate') {
      const p = hitPlaneY(lr, it.y);
      if (!p) return;
      it.rot = snapRot(drag.rot0 + Math.atan2(p.x - it.x, p.z - it.z) - drag.a0);
      placeItem(it);
      gizmo.rotation.y = it.rot;
    } else if (drag.mode === 'pull') {
      if (!applyPull(it, drag, lr)) return;
      fillItem(it, objs.get(it.id));
      placeItem(it);
      updateGizmo();
    }
    drag.changed = true;
    updateStatus();
    return;
  }
  if (tool === 'measure' && measureA && e.pointerType === 'mouse') {
    setRay(e);
    const p = measurePoint();
    clearGroup(tmpG);
    if (p) dimObjects(tmpG, measureA, p);
  }
}
function onUp(e) {
  if (renderer.xr.isPresenting) return;
  if (drag && e.pointerId === drag.pid) {
    const d = drag;
    drag = null;
    ctl().enabled = true;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* не критично */ }
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
  if (tool === 'measure') {
    const p = measurePoint();
    if (!p) return;
    if (!measureA) measureA = p;
    else {
      state.dims.push({ a: measureA.toArray().map(r3), b: p.toArray().map(r3) });
      measureA = null;
      clearGroup(tmpG);
      rebuildDims();
      commit();
    }
    updateStatus();
    return;
  }
  const pk = pickItem();
  select(pk ? pk.id : null);
}
canvas.addEventListener('pointerdown', onDown, true);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ───────────────────────── интерфейс ─────────────────────────
const HINTS = {
  select: 'Нажмите на предмет и тащите его по полу',
  rotate: 'Выберите предмет и тащите вокруг него — поворот с шагом 15°',
  pull: 'Выберите предмет и тащите цветные шарики на гранях',
  measure: 'Рулетка: укажите первую точку',
};
function updateStatus() {
  const it = sel();
  let s = HINTS[tool];
  if (tool === 'measure' && measureA) s = 'Рулетка: укажите вторую точку';
  else if (it) s = `${it.name} — ${fmt(it.w)} × ${fmt(it.d)} × ${fmt(it.h)}`.replace(/ см(?= ×)/g, '');
  $('#status').textContent = s;
}
function setTool(t) {
  tool = t;
  measureA = null;
  clearGroup(tmpG);
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

const P = { name: $('#pName'), w: $('#pW'), d: $('#pD'), h: $('#pH'), y: $('#pY'), rot: $('#pRot'),
  color: $('#pColor'), keep: $('#pKeep'), lock: $('#pLock') };
const cm = (m) => Math.round(m * 1000) / 10;
function updateProps() {
  const it = sel(), el = $('#props');
  el.hidden = !it || renderer.xr.isPresenting;
  if (!it) return;
  if (document.activeElement !== P.name) P.name.value = it.name;
  P.w.value = cm(it.w); P.d.value = cm(it.d); P.h.value = cm(it.h); P.y.value = cm(it.y);
  P.rot.value = Math.round((((THREE.MathUtils.radToDeg(it.rot) % 360) + 360) % 360) * 10) / 10;
  $('#pColorWrap').hidden = it.type === 'model';
  if (it.type !== 'model') P.color.value = it.color || '#f1eee8';
  P.keep.checked = !!it.keep;
  P.lock.checked = !!it.lock;
}
function editSel(fn, rebuild = true) {
  const it = sel();
  if (!it) return;
  fn(it);
  if (rebuild) fillItem(it, objs.get(it.id));
  placeItem(it); updateGizmo(); updateProps(); updateStatus(); commit();
}
function bindSize(input, key) {
  input.addEventListener('change', () => editSel((it) => {
    const v = clamp(parseFloat(input.value) / 100 || it[key], 0.005, 30), f = v / it[key];
    if (it.keep) { it.w = r3(it.w * f); it.d = r3(it.d * f); it.h = r3(it.h * f); } else it[key] = r3(v);
  }));
}
bindSize(P.w, 'w'); bindSize(P.d, 'd'); bindSize(P.h, 'h');
P.y.addEventListener('change', () => editSel((it) => { it.y = r3(clamp(parseFloat(P.y.value) / 100 || 0, -5, 20)); }, false));
P.rot.addEventListener('change', () => editSel((it) => { it.rot = THREE.MathUtils.degToRad(parseFloat(P.rot.value) || 0); }, false));
P.color.addEventListener('change', () => editSel((it) => { it.color = P.color.value; }));
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
for (const b of $$('#catalog [data-tab]')) b.onclick = () => {
  for (const o of $$('#catalog [data-tab]')) o.classList.toggle('on', o === b);
  $('#tabBlanks').hidden = b.dataset.tab !== 'blanks';
  $('#tabWeb').hidden = b.dataset.tab !== 'web';
};
function afterAdd() { if (innerWidth <= 640 || renderer.xr.isPresenting) toggleCatalog(false); }
function buildCatalog() {
  const thumbs = makeThumbs();
  const grid = $('#tabBlanks');
  for (const def of CATALOG) {
    const b = document.createElement('button');
    if (thumbs[def.type]) { const img = new Image(); img.src = thumbs[def.type]; img.alt = ''; b.append(img); }
    const name = document.createElement('span');
    name.textContent = def.name;
    const dim = document.createElement('small');
    dim.textContent = `${cm(def.w)}×${cm(def.d)}×${cm(def.h)}`;
    b.append(name, dim);
    b.onclick = () => { addBlank(def); afterAdd(); };
    grid.append(b);
  }
  const sg = $('#samples');
  for (const s of SAMPLES) {
    const b = document.createElement('button');
    b.textContent = s.name;
    b.onclick = () => { addModel(s.url, s.name); afterAdd(); };
    sg.append(b);
  }
}
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
$('#mLoad').onclick = () => { const v = $('#mUrl').value; if (v.trim()) { addModelFromUrl(v); $('#mUrl').value = ''; afterAdd(); } };
$('#mUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#mLoad').click(); });
$('#mFile').onclick = () => $('#fileModel').click();
$('#fileModel').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { await addModelFromFile(f); afterAdd(); } };
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) { if (extOf(f.name) === 'json') openProjectFile(f); else addModelFromFile(f); return; }
  const u = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
  if (u && /^https?:/i.test(u)) addModelFromUrl(u);
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
    $('#rFloor').value = R.floor; $('#rWall').value = R.wall; $('#rSnap').value = String(state.snap);
    if (!$('#rSnap').value) $('#rSnap').value = '0.05';
    $('#roomDlg').showModal();
  },
  save() { download(new Blob([JSON.stringify(JSON.parse(cur), null, 1)], { type: 'application/json' }), 'taburetka-project.json'); },
  open() { $('#fileProject').click(); },
  async link() {
    const url = location.origin + location.pathname + '#p=' + b64e(cur);
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
    catch { prompt('Ссылка на проект:', url); }
    if (state.items.some((i) => i.src?.startsWith('idb:'))) toast('Модели из файлов с устройства по ссылке не откроются — у них нет адреса в сети', 6000);
  },
  glb: exportGLB,
  cleardims() { state.dims = []; measureA = null; clearGroup(tmpG); rebuildDims(); commit(); },
  new() { if (confirm('Убрать всю мебель и размеры?')) { state.items = []; state.dims = []; load(JSON.parse(serialize())); commit(); } },
  help() { $('#helpDlg').showModal(); },
};
$('#menu').onclick = (e) => { const a = e.target.dataset?.act; if (a) { $('#menu').hidden = true; MENU[a](); } };
$('#roomDlg').addEventListener('close', () => {
  if ($('#roomDlg').returnValue !== 'ok') return;
  const g = (id, def) => clamp(parseFloat($(id).value) / 100 || def, 0.5, 50);
  state.room = { w: g('#rW', state.room.w), d: g('#rD', state.room.d), h: Math.min(20, g('#rH', state.room.h)),
    floor: $('#rFloor').value, wall: $('#rWall').value };
  state.snap = parseFloat($('#rSnap').value) || 0;
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
  else if (k === 'r' || k === 'к') setTool('rotate');
  else if (k === 'p' || k === 'з') setTool('pull');
  else if (k === 't' || k === 'е') setTool('measure');
  else if (k === 'a' || k === 'ф') toggleCatalog();
  else if (k === 'escape') { if (measureA) setTool('measure'); else if (!catalogEl.hidden) toggleCatalog(false); else select(null); }
  else if ((k === 'delete' || k === 'backspace') && it) removeItem(it.id);
  else if (k === 'q' || k === 'й') rotateSel(Math.PI / 2);
  else if (k === 'e' || k === 'у') rotateSel(-Math.PI / 2);
  else if (k.startsWith('arrow') && it && !it.lock) {
    e.preventDefault();
    const s = state.snap > 0 ? state.snap : 0.01;
    if (k === 'arrowleft') it.x -= s; if (k === 'arrowright') it.x += s;
    if (k === 'arrowup') it.z -= s; if (k === 'arrowdown') it.z += s;
    it.x = r3(it.x); it.z = r3(it.z);
    placeItem(it); updateGizmo(); commit();
  }
});

// ───────────────────────── WebXR: VR и AR ─────────────────────────
const xr = { session: null, mode: null, anchored: true, mini: false, hit: null, aim: null, saved: null, refType: 'local-floor' };
const xray = new THREE.Raycaster();
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.115, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xd9482b, depthTest: false, transparent: true }));
reticle.visible = false;
reticle.renderOrder = 30;
rig.add(reticle);
const tpMarker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.22, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x1f6feb, depthTest: false, transparent: true }));
tpMarker.visible = false;
tpMarker.renderOrder = 30;
scene.add(tpMarker);

let palette = null;
function buildPalette() {
  const g = new THREE.Group();
  const acts = [...CATALOG.map((d) => ({ label: d.name, act: 'add:' + d.type })),
    { label: 'Копия', act: 'dup', bg: '#1d1d1b', fg: '#fff' }, { label: '⟳ 90°', act: 'rot', bg: '#1d1d1b', fg: '#fff' },
    { label: 'Удалить', act: 'del', bg: '#b3261e', fg: '#fff' }, { label: 'Макет ⇄ 1:1', act: 'mini', bg: '#1f6feb', fg: '#fff' },
    { label: 'Отменить', act: 'undo', bg: '#1d1d1b', fg: '#fff' }, { label: 'Выход', act: 'exit', bg: '#1d1d1b', fg: '#fff' }];
  const cols = 4, bw = 0.072, bh = 0.03, gap = 0.004, rows = Math.ceil(acts.length / cols);
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(cols * (bw + gap) + gap, rows * (bh + gap) + gap),
    new THREE.MeshBasicMaterial({ color: 0xf6f1e7 }));
  bg.position.z = -0.002;
  g.add(bg);
  const buttons = [];
  acts.forEach((a, i) => {
    const c = document.createElement('canvas');
    c.width = 288; c.height = 120;
    const x = c.getContext('2d');
    x.fillStyle = a.bg || '#fffdf8';
    x.fillRect(0, 0, 288, 120);
    x.fillStyle = a.fg || '#1d1d1b';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    let fs = 44;
    do { x.font = `600 ${fs}px system-ui, sans-serif`; fs -= 2; } while (x.measureText(a.label).width > 268 && fs > 16);
    x.fillText(a.label, 144, 62);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set((i % cols - (cols - 1) / 2) * (bw + gap), ((rows - 1) / 2 - Math.floor(i / cols)) * (bh + gap), 0);
    m.userData.act = a.act;
    g.add(m);
    buttons.push(m);
  });
  g.userData.buttons = buttons;
  g.position.set(0, 0.17, -0.07);
  g.rotation.x = -0.65;
  return g;
}
function paletteAction(act) {
  if (act.startsWith('add:')) addBlank(CATALOG.find((d) => d.type === act.slice(4)));
  else if (act === 'dup') { if (selId) duplicate(selId); }
  else if (act === 'rot') rotateSel(-Math.PI / 2);
  else if (act === 'del') { if (selId) removeItem(selId); }
  else if (act === 'mini') setMini(!xr.mini);
  else if (act === 'undo') undo();
  else if (act === 'exit') xr.session?.end();
}

const ctrls = [];
function setupControllers() {
  const factory = new XRControllerModelFactory();
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.userData = { src: null, grab: null, start: false, end: false, squeeze: false, turned: false };
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x1f6feb }));
    line.scale.z = 4;
    line.visible = false;
    c.add(line);
    c.addEventListener('connected', (e) => {
      c.userData.src = e.data;
      line.visible = e.data.targetRayMode === 'tracked-pointer';
      if (e.data.handedness === 'left' && e.data.targetRayMode === 'tracked-pointer') { if (!palette) palette = buildPalette(); c.add(palette); }
    });
    c.addEventListener('disconnected', () => {
      const u = c.userData;
      if (u.grab) u.end = true;
      u.src = null; u.squeeze = false;
      line.visible = false;
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
  if (xr.mode !== 'vr' || !c.visible) return;
  const p = floorPoint(ctrlRay(c));
  if (!p) return;
  const h = camera.getWorldPosition(new THREE.Vector3());
  rig.position.x += p.x - h.x;
  rig.position.z += p.z - h.z;
}
function paletteHit(R) {
  if (!palette || !palette.parent || !palette.parent.visible) return null;
  xray.ray.copy(R);
  const h = xray.intersectObjects(palette.userData.buttons, false)[0];
  return h ? h.object : null;
}
function xrSelectStart(c, R) {
  if (xr.mode === 'ar' && !xr.anchored) { if (xr.aim) anchorWorld(xr.aim); return; }
  if (!c.visible) return;
  const btn = paletteHit(R);
  if (btn) { paletteAction(btn.userData.act); return; }
  ray.ray.copy(R);
  const pk = pickItem();
  if (!pk) { select(null); return; }
  select(pk.id);
  const it = item(pk.id);
  if (it.lock) return;
  world.updateMatrixWorld(true);
  const pl = world.worldToLocal(pk.point);
  c.userData.grab = { id: it.id, py: pl.y, off: { x: it.x - pl.x, z: it.z - pl.z }, changed: false, turned: false };
}
function xrDrag(c, R, dt) {
  const g = c.userData.grab, it = item(g.id);
  if (!it) { c.userData.grab = null; return; }
  if (c.visible) {
    const p = hitPlaneY(localRay(R), g.py);
    if (p && p.distanceTo(new THREE.Vector3(it.x, g.py, it.z)) < 30) {
      [it.x, it.z] = snapPos(it, p.x + g.off.x, p.z + g.off.z);
      g.changed = true;
    }
  }
  const ax = c.userData.src?.gamepad?.axes;
  const sx = ax ? (Math.abs(ax[2] ?? 0) > Math.abs(ax[0] ?? 0) ? ax[2] : ax[0]) || 0 : 0;
  if (Math.abs(sx) > 0.35) { it.rot -= sx * dt * 1.8; g.changed = g.turned = true; }
  placeItem(it);
  gizmo.position.set(it.x, it.y, it.z);
  gizmo.rotation.y = it.rot;
}
function xrSelectEnd(c) {
  const g = c.userData.grab;
  c.userData.grab = null;
  if (!g) return;
  const it = item(g.id);
  if (it && g.turned) { it.rot = snapRot(it.rot); placeItem(it); updateGizmo(); }
  if (g.changed) commit();
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
  if (xr.mode === 'vr') {
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
  const ar = xr.mode === 'ar', bare = ar && !xr.mini;
  ground.visible = !ar && !xr.mini;
  scene.background = ar ? null : SKY;
  floorMesh.visible = gridLines.visible = wallMesh.visible = wallEdges.visible = !bare;
  outline.visible = bare;
  world.visible = !ar || xr.anchored;
  const b = $('[data-xr="mini"]');
  if (b) b.textContent = xr.mini ? 'Размер 1:1' : 'Макет';
}
function updateXRHint() {
  if (xr.mode !== 'ar') return;
  const it = sel();
  $('#xrHint').textContent = !xr.anchored ? 'Наведите прицел на пол и коснитесь экрана — сюда встанет центр комнаты'
    : it ? `${it.name}: тащите пальцем, ⟲ ⟳ — поворот` : 'Коснитесь предмета, чтобы выбрать. ⟲ ⟳ поворачивают всю комнату';
}
function locomotion(dt) {
  if (xr.mode !== 'vr') return;
  for (const c of ctrls) {
    const u = c.userData, src = u.src;
    if (u.squeeze && c.visible) {
      const p = floorPoint(ctrlRay(c));
      tpMarker.visible = !!p;
      if (p) tpMarker.position.copy(p).setY(p.y + 0.01);
    }
    const ax = src?.gamepad?.axes;
    if (!ax || u.grab) continue;
    const x = (Math.abs(ax[2] ?? 0) > Math.abs(ax[0] ?? 0) ? ax[2] : ax[0]) || 0;
    const y = (Math.abs(ax[3] ?? 0) > Math.abs(ax[1] ?? 0) ? ax[3] : ax[1]) || 0;
    if (src.handedness === 'left') {
      if (Math.hypot(x, y) < 0.2) continue;
      const f = camera.getWorldDirection(new THREE.Vector3());
      f.y = 0; f.normalize();
      const r = new THREE.Vector3(-f.z, 0, f.x);
      rig.position.addScaledVector(f, -y * 1.6 * dt).addScaledVector(r, x * 1.6 * dt);
    } else if (Math.abs(x) > 0.6) {
      if (u.turned) continue;
      u.turned = true;
      const a = -Math.sign(x) * Math.PI / 6, h = camera.getWorldPosition(new THREE.Vector3());
      rig.position.sub(h).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a).add(h);
      rig.rotation.y += a;
    } else if (Math.abs(x) < 0.3) u.turned = false;
  }
}
function xrTick(frame, dt) {
  rig.updateMatrixWorld(true);
  updateAim(frame);
  for (const c of ctrls) {
    const u = c.userData;
    const R = ctrlRay(c);
    if (u.start) { u.start = false; xrSelectStart(c, R); }
    if (u.grab) xrDrag(c, R, dt);
    else if (palette?.parent) {
      const hb = paletteHit(R);
      for (const b of palette.userData.buttons) if (b.userData.hover === c) { b.userData.hover = null; b.material.color.set(0xffffff); }
      if (hb) { hb.userData.hover = c; hb.material.color.set(0x9cc4ff); }
    }
    if (u.end) { u.end = false; xrSelectEnd(c); }
  }
  locomotion(dt);
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
    setView('3d');
    toggleCatalog(false);
    xr.saved = { p: camera.position.clone(), q: camera.quaternion.clone() };
    xr.mode = mode; xr.mini = false; xr.anchored = mode !== 'ar'; xr.aim = null; xr.hit = null;
    controls3d.enabled = false;
    sun.castShadow = false;
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
  world.position.set(0, 0, 0); world.rotation.set(0, 0, 0); world.scale.setScalar(1);
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  if (xr.saved) { camera.position.copy(xr.saved.p); camera.quaternion.copy(xr.saved.q); }
  camera.fov = 50;
  sun.castShadow = true;
  controls3d.enabled = view === '3d';
  updateXRVis();
  setTimeout(() => { resize(); updateProps(); }, 60);
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
async function detectXR() {
  let ar = false;
  if (navigator.xr) {
    try { if (await navigator.xr.isSessionSupported('immersive-vr')) $('#btnVR').hidden = false; } catch { /* нет VR */ }
    try { ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch { /* нет AR */ }
  }
  if (ar) $('#btnAR').hidden = false;
  else if (document.createElement('a').relList?.supports?.('ar')) $('#btnQL').hidden = false;
}
$('#btnVR').onclick = () => startXR('vr');
$('#btnAR').onclick = () => startXR('ar');
$('#btnQL').onclick = quickLook;

// ───────────────────────── запуск ─────────────────────────
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
    updateConstSize();
    renderer.render(scene, renderer.xr.isPresenting ? camera : cam());
  });
}
boot();
