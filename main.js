import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const BASE_GLB = './54lab.glb';
const STORAGE_KEY = 'labEditor.layout.v1';
const SERVER_LAYOUT_URL = './api/layout';   // present only when the optional server.py is running

// ---------- Renderer / scene ----------
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
camera.position.set(20, 20, 20);

scene.add(new THREE.HemisphereLight(0xffffff, 0x202030, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(10, 20, 6);
scene.add(sun);

const grid = new THREE.GridHelper(40, 40, 0x222244, 0x111122);
scene.add(grid);

// CSS2D overlay for billboard note labels — stays world-anchored, always faces camera.
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.getElementById('stage').appendChild(labelRenderer.domElement);

// ---------- Controls ----------
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

// ⌘ (Mac) / Ctrl (Win/Linux) held at pointer-down swaps left-drag from orbit to pan.
// Helps trackpad users avoid the right-click dance.
canvas.addEventListener('pointerdown', e => {
  orbit.mouseButtons.LEFT = (e.metaKey || e.ctrlKey) ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
});

const tcontrol = new TransformControls(camera, canvas);
tcontrol.setTranslationSnap(null);
tcontrol.setRotationSnap(null);
tcontrol.setScaleSnap(null);
tcontrol.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
tcontrol.addEventListener('change', () => { syncInspectorFromObject(); scheduleSave(); });
scene.add(tcontrol);

// ---------- Layout state ----------
// Each placed object is a THREE.Mesh with userData.kind ('wall' | 'door' | 'box') and userData.name.
const placeable = new THREE.Group();
placeable.name = 'placeable';
scene.add(placeable);

let baseRoot = null;
let baseBounds = null;       // THREE.Box3
let boundsHelper = null;
let selected = null;

const KINDS = {
  wall: { label: 'Wall', color: 0xb89070, size: [3.0, 3.0, 0.12] },
  door: { label: 'Door', color: 0x4488ff, size: [0.9, 2.1, 0.06] },
  box:  { label: 'Box',  color: 0xaaaaaa, size: [1.0, 1.0, 1.0] },
};

// ---------- Base model ----------
const status = document.getElementById('status');
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
loader.setDRACOLoader(draco);

loader.load(
  BASE_GLB,
  (gltf) => {
    baseRoot = gltf.scene;
    baseRoot.name = 'base';
    baseRoot.traverse(o => {
      if (o.isMesh) {
        o.userData.isBase = true;
        // Don't let raycasting on the base swallow our placeable selection clicks easily —
        // we'll explicitly filter in onPointerDown anyway.
      }
    });
    scene.add(baseRoot);

    baseBounds = new THREE.Box3().setFromObject(baseRoot);
    fitCameraToBounds(baseBounds);
    addBoundsHelper(baseBounds);
    sizeTransformControls(baseBounds);

    status.textContent = formatBoundsLabel(baseBounds);
    initLayoutSource();
  },
  (xhr) => {
    if (xhr.lengthComputable) {
      const pct = (xhr.loaded / xhr.total * 100).toFixed(0);
      status.textContent = `loading base model… ${pct}%`;
    }
  },
  (err) => {
    status.textContent = 'failed to load base';
    showErr('GLB load error: ' + (err?.message || err));
  }
);

function formatBoundsLabel(b) {
  const s = new THREE.Vector3(); b.getSize(s);
  return `bounds ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)}`;
}

function showErr(m) {
  const el = document.getElementById('err');
  el.style.display = 'block';
  el.textContent += m + '\n';
}

function fitCameraToBounds(b) {
  const center = new THREE.Vector3(); b.getCenter(center);
  const size = new THREE.Vector3(); b.getSize(size);
  const radius = Math.max(size.x, size.y, size.z) * 0.8 + 0.001;
  const dir = new THREE.Vector3(1, 0.7, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, radius * 1.6);
  camera.near = Math.max(0.05, radius / 1000);
  camera.far  = radius * 100;
  camera.updateProjectionMatrix();
  orbit.target.copy(center);
  orbit.update();
  // Resize the floor grid to roughly match the model footprint
  const span = Math.max(size.x, size.z) * 1.4;
  scene.remove(grid);
  const ng = new THREE.GridHelper(span, Math.round(span));
  ng.material.color.setHex(0x222244);
  ng.position.y = b.min.y;
  scene.add(ng);
}

function addBoundsHelper(b) {
  const size = new THREE.Vector3(); b.getSize(size);
  const center = new THREE.Vector3(); b.getCenter(center);
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const edges = new THREE.EdgesGeometry(geo);
  geo.dispose();
  boundsHelper = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x335577 }));
  boundsHelper.position.copy(center);
  boundsHelper.name = 'bounds';
  scene.add(boundsHelper);
}

function sizeTransformControls(b) {
  const size = new THREE.Vector3(); b.getSize(size);
  const radius = Math.max(size.x, size.y, size.z);
  // Default gizmo size is 1; scale based on bbox so it's always usable.
  tcontrol.setSize(Math.max(0.4, Math.min(2.0, radius * 0.04)));
}

// Animate the camera to a new position/target with eased lerp; ignores user input while running.
let _animRAF = null;
function animateCamera(toPos, toTarget, duration = 350) {
  const fromPos = camera.position.clone();
  const fromTarget = orbit.target.clone();
  const start = performance.now();
  if (_animRAF) cancelAnimationFrame(_animRAF);
  orbit.enabled = false;
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    camera.position.lerpVectors(fromPos, toPos, e);
    orbit.target.lerpVectors(fromTarget, toTarget, e);
    orbit.update();
    if (t < 1) _animRAF = requestAnimationFrame(step);
    else { _animRAF = null; orbit.enabled = true; }
  }
  _animRAF = requestAnimationFrame(step);
}

// Frame an object: keep current view direction, dolly close enough that the object fills ~1/distMul of frame.
const _focusBox = new THREE.Box3();
function focusOn(obj, distMul = 2.4) {
  _focusBox.setFromObject(obj);
  const center = _focusBox.getCenter(new THREE.Vector3());
  const size   = _focusBox.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.1);
  const dir = new THREE.Vector3().subVectors(camera.position, orbit.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
  dir.normalize();
  const newPos = center.clone().addScaledVector(dir, radius * distMul);
  animateCamera(newPos, center);
}

function viewPreset(name) {
  if (!baseBounds) return;
  const center = new THREE.Vector3(); baseBounds.getCenter(center);
  const size = new THREE.Vector3(); baseBounds.getSize(size);
  const radius = Math.max(size.x, size.y, size.z) * 0.8 + 0.001;
  const dist = radius * 1.6;
  const pos = center.clone();
  // Y is up in glTF/Three.js. Top = look down -Y; Front = look toward -Z; Right = look toward -X.
  switch (name) {
    case 'top':   pos.y += dist; pos.z += dist * 0.001; break; // tiny offset to avoid gimbal lock
    case 'front': pos.z += dist; break;
    case 'right': pos.x += dist; break;
    case 'iso':   pos.add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist)); break;
  }
  camera.position.copy(pos);
  orbit.target.copy(center);
  camera.up.set(0, 1, 0);
  orbit.update();
}

// ---------- Add / select / delete ----------
let nameCounter = { wall: 0, door: 0, box: 0 };

function makeObject(kind, opts = {}) {
  const def = KINDS[kind];
  if (!def) throw new Error('unknown kind: ' + kind);
  const [w, h, d] = opts.size || def.size;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(w, h, d);
  mesh.userData.kind = kind;
  nameCounter[kind] = (nameCounter[kind] || 0) + 1;
  mesh.userData.name = opts.name || `${def.label} ${nameCounter[kind]}`;
  placeable.add(mesh);
  return mesh;
}

function addAtTarget(kind) {
  const mesh = makeObject(kind);
  // Place at orbit target with the bottom resting at floor (y = baseBounds.min.y) when we have bounds.
  const t = orbit.target.clone();
  if (baseBounds) {
    t.y = baseBounds.min.y + (mesh.scale.y * 0.5);
  }
  mesh.position.copy(t);
  select(mesh);
  refreshItemList();
  scheduleSave();
}

// Note labels: world-anchored CSS2DObjects placed above each annotated object.
// Created lazily — an object only owns a label once it has a non-empty note.
function ensureNoteLabel(obj) {
  if (obj.userData.label) return obj.userData.label;
  const div = document.createElement('div');
  div.className = 'note-label';
  const label = new CSS2DObject(div);
  scene.add(label);
  obj.userData.label = label;
  return label;
}

function setObjectNote(obj, text) {
  obj.userData.note = text || '';
  if (text && text.trim().length) {
    const label = ensureNoteLabel(obj);
    label.element.textContent = text;
    label.visible = true;
  } else if (obj.userData.label) {
    obj.userData.label.visible = false;
  }
}

function disposeNoteLabel(obj) {
  const label = obj.userData.label;
  if (!label) return;
  scene.remove(label);
  label.element?.remove?.();
  obj.userData.label = null;
}

function deleteObject(obj) {
  if (!obj) return;
  if (selected === obj) deselect();
  disposeNoteLabel(obj);
  placeable.remove(obj);
  obj.geometry?.dispose();
  obj.material?.dispose();
  refreshItemList();
  scheduleSave();
}

function clearAll() {
  while (placeable.children.length) deleteObject(placeable.children[0]);
}

function select(obj) {
  selected = obj;
  tcontrol.attach(obj);
  refreshItemList();
  showInspector(true);
  syncInspectorFromObject();
}

function deselect() {
  selected = null;
  tcontrol.detach();
  refreshItemList();
  showInspector(false);
}

// ---------- Pointer / picking ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointerDownAt = { x: 0, y: 0, t: 0 };

canvas.addEventListener('pointerdown', e => {
  pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', e => {
  // Only treat short, in-place clicks as selection (not orbit drags).
  const dx = e.clientX - pointerDownAt.x;
  const dy = e.clientY - pointerDownAt.y;
  const dt = performance.now() - pointerDownAt.t;
  if (Math.hypot(dx, dy) > 4 || dt > 400) return;
  // Don't pick if the gizmo is currently being interacted with — TransformControls handles that.
  if (tcontrol.dragging) return;

  const rect = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(placeable.children, false);
  if (hits.length) select(hits[0].object);
  else deselect();
});

window.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'w' || e.key === 'W') tcontrol.setMode('translate');
  else if (e.key === 'e' || e.key === 'E') tcontrol.setMode('rotate');
  else if (e.key === 'r' || e.key === 'R') tcontrol.setMode('scale');
  else if (e.key === 'Escape') deselect();
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selected) { e.preventDefault(); deleteObject(selected); }
  } else if (e.key === 'Shift') {
    tcontrol.setTranslationSnap(0.1);
    tcontrol.setRotationSnap(THREE.MathUtils.degToRad(10));
    tcontrol.setScaleSnap(0.1);
  }
});
window.addEventListener('keyup', e => {
  if (e.key === 'Shift') {
    tcontrol.setTranslationSnap(null);
    tcontrol.setRotationSnap(null);
    tcontrol.setScaleSnap(null);
  }
});

// ---------- Sidebar wiring ----------
document.querySelectorAll('button[data-add]').forEach(btn => {
  btn.addEventListener('click', () => addAtTarget(btn.dataset.add));
});
document.querySelectorAll('button[data-view]').forEach(btn => {
  btn.addEventListener('click', () => viewPreset(btn.dataset.view));
});

// OS-aware camera hint
const isMac = /Mac|iPad|iPhone/i.test(navigator.platform || navigator.userAgent || '');
const cmdKey = isMac ? '⌘' : 'Ctrl';
const camHint = document.getElementById('camHint');
camHint.innerHTML = isMac
  ? `<kbd>drag</kbd> orbit · <kbd>${cmdKey}</kbd>+drag pan · <kbd>two-finger scroll</kbd> / pinch zoom<br>` +
    `<kbd>right-click</kbd>+drag also pans (trackpad: <kbd>ctrl</kbd>+click)`
  : `<kbd>left-drag</kbd> orbit · <kbd>right-drag</kbd> or <kbd>${cmdKey}</kbd>+drag pan · <kbd>scroll</kbd> zoom`;
const toggleBaseBtn = document.getElementById('toggleBase');
toggleBaseBtn.addEventListener('click', () => {
  if (!baseRoot) return;
  baseRoot.visible = !baseRoot.visible;
  toggleBaseBtn.textContent = baseRoot.visible ? 'Hide Base' : 'Show Base';
});
const toggleBoundsBtn = document.getElementById('toggleBounds');
toggleBoundsBtn.addEventListener('click', () => {
  if (!boundsHelper) return;
  boundsHelper.visible = !boundsHelper.visible;
  toggleBoundsBtn.textContent = boundsHelper.visible ? 'Hide Bounds' : 'Show Bounds';
});
document.getElementById('clearBtn').addEventListener('click', () => {
  if (placeable.children.length === 0) return;
  if (confirm(`Delete all ${placeable.children.length} placed objects?`)) clearAll();
});
document.getElementById('exportBtn').addEventListener('click', () => {
  const json = JSON.stringify(serializeLayout(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lab-layout-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById('importBtn').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json';
  inp.onchange = () => {
    const f = inp.files?.[0]; if (!f) return;
    f.text().then(t => {
      try {
        const data = JSON.parse(t);
        clearAll();
        deserializeLayout(data);
        scheduleSave();
      } catch (err) { showErr('Import failed: ' + err.message); }
    });
  };
  inp.click();
});

// ---------- Inspector ----------
const inspectorEl = document.getElementById('inspector');
const inName = document.getElementById('inName');
const inP = ['inPx','inPy','inPz'].map(id => document.getElementById(id));
const inR = ['inRx','inRy','inRz'].map(id => document.getElementById(id));
const inS = ['inSx','inSy','inSz'].map(id => document.getElementById(id));
const inNote = document.getElementById('inNote');

function showInspector(v) { inspectorEl.style.display = v ? 'block' : 'none'; }

function syncInspectorFromObject() {
  if (!selected) return;
  // Don't clobber an input the user is currently typing into.
  if (document.activeElement && document.activeElement.matches('#inspector input, #inspector textarea')) return;
  inName.value = selected.userData.name || '';
  const p = selected.position, r = selected.rotation, s = selected.scale;
  inP[0].value = p.x.toFixed(3); inP[1].value = p.y.toFixed(3); inP[2].value = p.z.toFixed(3);
  inR[0].value = THREE.MathUtils.radToDeg(r.x).toFixed(1);
  inR[1].value = THREE.MathUtils.radToDeg(r.y).toFixed(1);
  inR[2].value = THREE.MathUtils.radToDeg(r.z).toFixed(1);
  inS[0].value = s.x.toFixed(3); inS[1].value = s.y.toFixed(3); inS[2].value = s.z.toFixed(3);
  inNote.value = selected.userData.note || '';
}

inName.addEventListener('input', () => {
  if (!selected) return;
  selected.userData.name = inName.value;
  refreshItemList();
  scheduleSave();
});
inP.forEach((el, i) => el.addEventListener('input', () => {
  if (!selected) return;
  selected.position.setComponent(i, parseFloat(el.value) || 0);
  scheduleSave();
}));
inR.forEach((el, i) => el.addEventListener('input', () => {
  if (!selected) return;
  selected.rotation['xyz'[i]] = THREE.MathUtils.degToRad(parseFloat(el.value) || 0);
  scheduleSave();
}));
inS.forEach((el, i) => el.addEventListener('input', () => {
  if (!selected) return;
  const v = Math.max(0.01, parseFloat(el.value) || 0.01);
  selected.scale.setComponent(i, v);
  scheduleSave();
}));
inNote.addEventListener('input', () => {
  if (!selected) return;
  setObjectNote(selected, inNote.value);
  scheduleSave();
});

// ---------- Item list ----------
const itemsEl = document.getElementById('items');
const emptyEl = document.getElementById('empty');

function refreshItemList() {
  itemsEl.innerHTML = '';
  emptyEl.style.display = placeable.children.length ? 'none' : 'block';
  for (const o of placeable.children) {
    const li = document.createElement('li');
    if (o === selected) li.classList.add('sel');
    const label = document.createElement('span');
    label.textContent = o.userData.name || o.userData.kind;
    label.title = 'click to focus camera on this object';
    label.style.flex = '1';
    label.addEventListener('click', () => { select(o); focusOn(o); });
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.title = 'delete';
    x.addEventListener('click', e => { e.stopPropagation(); deleteObject(o); });
    li.appendChild(label);
    li.appendChild(x);
    itemsEl.appendChild(li);
  }
}

// ---------- Persistence ----------
function serializeLayout() {
  return {
    version: 1,
    items: placeable.children.map(o => ({
      kind: o.userData.kind,
      name: o.userData.name,
      note: o.userData.note || '',
      position: o.position.toArray(),
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
      scale: o.scale.toArray(),
    })),
  };
}

function deserializeLayout(data) {
  if (!data?.items) return;
  for (const it of data.items) {
    const m = makeObject(it.kind, { name: it.name, size: [1, 1, 1] });
    m.position.fromArray(it.position);
    m.rotation.set(it.rotation[0], it.rotation[1], it.rotation[2]);
    m.scale.fromArray(it.scale);
    if (it.note) setObjectNote(m, it.note);
  }
  refreshItemList();
}

// ---------- Storage backends ----------
// Try a server-side endpoint first (server.py provides it). If that's not available we fall
// back to per-browser localStorage. Last-write-wins; no merge / locking. Documented in README.
let serverAvailable = false;
const storageBadge = document.getElementById('storage');

function updateStorageBadge() {
  if (serverAvailable) {
    storageBadge.className = 'shared';
    storageBadge.textContent = 'shared layout';
    storageBadge.title = 'saving to server (visible to everyone)';
  } else {
    storageBadge.className = 'local';
    storageBadge.textContent = 'local only';
    storageBadge.title = 'no server endpoint — saving to this browser only';
  }
}

async function initLayoutSource() {
  // Probe the server. 200 = use it and load. 404 = server is up but empty (still use it for writes).
  try {
    const r = await fetch(SERVER_LAYOUT_URL, { cache: 'no-store' });
    if (r.ok) {
      serverAvailable = true;
      updateStorageBadge();
      const data = await r.json();
      deserializeLayout(data);
      return;
    }
    if (r.status === 404) {
      serverAvailable = true;
      updateStorageBadge();
      return;
    }
  } catch (_) {
    // network/connect error — server isn't running. Fall through.
  }
  serverAvailable = false;
  updateStorageBadge();
  loadLayoutFromStorage();
}

async function persistNow() {
  const data = serializeLayout();
  if (serverAvailable) {
    try {
      const r = await fetch(SERVER_LAYOUT_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error('server PUT ' + r.status);
      return;
    } catch (e) {
      console.warn('server save failed; falling back to localStorage', e);
      serverAvailable = false;
      updateStorageBadge();
    }
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { console.warn('localStorage save failed:', e); }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 300);
}

function loadLayoutFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    deserializeLayout(JSON.parse(raw));
  } catch (e) { console.warn('load failed:', e); }
}

// ---------- Resize / loop ----------
function resize() {
  const stage = document.getElementById('stage');
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const _labelBox = new THREE.Box3();
function updateNoteLabels() {
  // Pin each label to the world-space top of its object's current bounding box, so
  // rotated/scaled objects still get their note hovering above them.
  for (const obj of placeable.children) {
    const label = obj.userData.label;
    if (!label || !label.visible) continue;
    _labelBox.setFromObject(obj);
    const cx = (_labelBox.min.x + _labelBox.max.x) * 0.5;
    const cz = (_labelBox.min.z + _labelBox.max.z) * 0.5;
    label.position.set(cx, _labelBox.max.y, cz);
  }
}

function tick() {
  orbit.update();
  updateNoteLabels();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
