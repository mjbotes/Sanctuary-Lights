// 3D stage view: stage models, fixtures and live beams.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';

const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const MAX_SPOTS = 24;

const beamVertex = `
  varying float vLen;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLen = position.z;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const beamFragment = `
  uniform vec3 color;
  uniform float strength;
  varying float vLen;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(abs(dot(vNormal, vView)), 1.6);
    float fade = pow(1.0 - clamp(vLen, 0.0, 1.0), 1.4);
    gl_FragColor = vec4(color, strength * fade * rim);
  }`;

// Unit cone from the origin (apex) to z = 1 with radius 1.
function beamGeometry() {
  const g = new THREE.CylinderGeometry(0.03, 1, 1, 28, 1, true);
  g.translate(0, -0.5, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Stage3D {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'stage3d-canvas';
    this.canvas.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06070a);
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.restoreCamera();
    this.controls.addEventListener('end', () => this.saveCamera());

    this.ambient = new THREE.HemisphereLight(0x8899bb, 0x111111, 0.12);
    this.scene.add(this.ambient);
    this.work = new THREE.DirectionalLight(0xffffff, 0);
    this.work.position.set(4, 12, 10);
    this.scene.add(this.work);

    this.stageGroup = new THREE.Group();
    this.modelGroup = new THREE.Group();
    this.fixtureGroup = new THREE.Group();
    this.scene.add(this.stageGroup, this.modelGroup, this.fixtureGroup);

    this.spots = [];
    for (let i = 0; i < MAX_SPOTS; i++) {
      const s = new THREE.SpotLight(0xffffff, 0, 45, 0.3, 0.45, 1.1);
      s.visible = true;
      this.scene.add(s, s.target);
      this.spots.push(s);
    }

    this.transform = new TransformControls(this.camera, this.canvas);
    this.transform.setSize(0.8);
    this.transform.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value && this.transform.object) {
        const f = this.transform.object.userData.fx;
        const p = this.transform.object.position;
        this.onMove && this.onMove(f.id, { x: p.x, y: p.y, z: p.z });
      }
    });
    this.transform.addEventListener('objectChange', () => this.transform.object && this.updateFixture(this.transform.object.userData.fx.id));
    this.scene.add(this.transform.getHelper ? this.transform.getHelper() : this.transform);

    this.fixtures = new Map(); // id -> { group, body, lens, beam, fx, prof, dir0, live }
    this.selection = new Set();
    this.mode = 'view';
    this.haze = 0.35;
    this.loaded = new Map();
    this.raycaster = new THREE.Raycaster();
    this.beamGeo = beamGeometry();
    this.bodyGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.36, 18).rotateX(Math.PI / 2);
    this.hitGeo = new THREE.SphereGeometry(0.45, 8, 6);
    this.lensGeo = new THREE.CircleGeometry(0.12, 20);

    this.setupPointer();
    this.resizeObs = new ResizeObserver(() => this.resize());
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.canvas.isConnected || document.hidden || !this.canvas.clientWidth) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  attach(container, mode) {
    if (this.canvas.parentNode !== container) {
      container.prepend(this.canvas);
      this.resizeObs.disconnect();
      this.resizeObs.observe(container);
    }
    this.mode = mode;
    if (mode !== 'edit') this.transform.detach();
    this.resize();
  }

  resize() {
    const el = this.canvas.parentNode;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----- camera -------------------------------------------------------------
  restoreCamera() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('cam3d')); } catch {}
    if (saved && saved.p && saved.t) {
      this.camera.position.fromArray(saved.p);
      this.controls.target.fromArray(saved.t);
    } else this.view('front');
  }
  saveCamera() {
    try { localStorage.setItem('cam3d', JSON.stringify({ p: this.camera.position.toArray(), t: this.controls.target.toArray() })); } catch {}
  }
  view(name) {
    const st = this.stage || { w: 12, d: 6, h: 0.6 };
    const span = Math.max(st.w, st.d * 1.6, 8);
    const t = new THREE.Vector3(0, st.h + 1.5, -st.d / 2);
    const p = {
      front: [0, st.h + span * 0.35, span * 1.05],
      top: [0, span * 1.6, -st.d / 2 + 0.01],
      side: [span * 1.2, st.h + span * 0.3, -st.d / 2],
      foh: [span * 0.25, 3, span * 1.5],
    }[name] || [0, st.h + span * 0.35, span * 1.05];
    this.camera.position.set(...p);
    this.controls.target.copy(t);
    this.controls.update();
    this.saveCamera();
  }
  setWorkLight(on) {
    this.workOn = on;
    this.work.intensity = on ? 1.6 : 0;
    this.ambient.intensity = on ? 0.9 : 0.12;
  }
  setHaze(v) {
    this.haze = v;
  }

  // ----- show data ----------------------------------------------------------
  setShow(show, profiles) {
    this.profiles = profiles;
    const st = show.stage3d || { stage: { w: 12, d: 6, h: 0.6 }, models: [] };
    const stageKey = JSON.stringify(st);
    if (stageKey !== this.stageKey) {
      this.stageKey = stageKey;
      this.stage = st.stage;
      this.buildStage(st);
    }
    const fxKey = JSON.stringify(show.fixtures.map((f) => [f.id, f.profile, f.pos3d, f.aim, f.beam, f.x, f.y]));
    if (fxKey !== this.fxKey) {
      this.fxKey = fxKey;
      this.buildFixtures(show.fixtures);
    }
  }

  defaultPos(f) {
    const st = this.stage;
    const x = (f.x - 0.5) * st.w * 1.1;
    const z = -st.d + f.y * (st.d + 6);
    return { x, y: 6, z };
  }
  defaultAim(f, pos) {
    const st = this.stage;
    if (pos.z > 0) return { x: pos.x * 0.6, y: st.h + 1.5, z: -st.d / 2 };
    return { x: pos.x, y: st.h, z: pos.z };
  }

  buildStage(st) {
    this.stageGroup.clear();
    const { w, d, h } = st.stage;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.userData.surface = true;
    this.stageGroup.add(floor);
    const grid = new THREE.GridHelper(40, 40, 0x222833, 0x181c24);
    grid.position.y = 0.002;
    this.stageGroup.add(grid);
    if (!st.models.length) {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(w, Math.max(h, 0.01), d), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 }));
      deck.position.set(0, h / 2, -d / 2);
      deck.userData.surface = true;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(w + 4, 8), new THREE.MeshStandardMaterial({ color: 0x1d1f25, roughness: 0.9 }));
      wall.position.set(0, 4, -d - 0.01);
      wall.userData.surface = true;
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, 0.04), new THREE.MeshBasicMaterial({ color: 0x3a4252 }));
      edge.position.set(0, h, 0);
      this.stageGroup.add(deck, wall, edge);
    }
    // Models
    const keep = new Set();
    for (const m of st.models) {
      const key = JSON.stringify(m);
      keep.add(key);
      if (this.loaded.has(key)) continue;
      const holder = new THREE.Group();
      holder.userData.key = key;
      this.loaded.set(key, holder);
      this.modelGroup.add(holder);
      this.loadModel(m)
        .then((obj) => {
          if (m.matrix) {
            obj.matrixAutoUpdate = false;
            obj.matrix.fromArray(m.matrix);
          } else {
            obj.position.set(m.x || 0, m.y || 0, m.z || 0);
            obj.rotation.set(THREE.MathUtils.degToRad(m.rotX || 0), THREE.MathUtils.degToRad(m.rotY || 0), 0, 'YXZ');
            obj.scale.setScalar(m.scale || 1);
          }
          obj.traverse((c) => {
            if (c.isMesh) {
              c.userData.surface = true;
              for (const mat of [].concat(c.material)) if (mat) mat.side = THREE.DoubleSide;
            }
          });
          holder.add(obj);
        })
        .catch((e) => this.onError && this.onError(`Could not load ${m.name || m.file}: ${e.message || e}`));
    }
    for (const [key, holder] of this.loaded) {
      if (!keep.has(key)) {
        this.modelGroup.remove(holder);
        this.loaded.delete(key);
      }
    }
  }

  loadModel(m) {
    const url = `/assets/${m.file.split('/').map(encodeURIComponent).join('/')}`;
    const ext = m.file.split('.').pop().toLowerCase();
    return new Promise((resolve, reject) => {
      if (ext === 'glb' || ext === 'gltf') new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, reject);
      else if (ext === 'obj') new OBJLoader().load(url, resolve, undefined, reject);
      else if (ext === '3ds') {
        const l = new TDSLoader();
        l.load(url, resolve, undefined, reject);
      } else reject(new Error('Unsupported file type'));
    });
  }

  buildFixtures(list) {
    for (const f of this.fixtures.values()) this.fixtureGroup.remove(f.group);
    this.transform.detach();
    this.fixtures.clear();
    for (const fx of list) {
      const prof = this.profiles[fx.profile] || { attrs: [] };
      const pos = fx.pos3d || this.defaultPos(fx);
      const aim = fx.aim || this.defaultAim(fx, pos);
      const group = new THREE.Group();
      group.position.set(pos.x, pos.y, pos.z);
      group.userData.fx = fx;
      const mover = prof.attrs.includes('pan') || prof.attrs.includes('tilt');
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.6, metalness: 0.4, emissive: 0x000000 });
      const body = new THREE.Mesh(mover ? new THREE.BoxGeometry(0.3, 0.3, 0.38) : this.bodyGeo, bodyMat);
      const lens = new THREE.Mesh(this.lensGeo, new THREE.MeshBasicMaterial({ color: 0x000000 }));
      lens.position.z = 0.19;
      body.add(lens);
      const hit = new THREE.Mesh(this.hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.fixtureId = fx.id;
      const beamMat = new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(0, 0, 0) }, strength: { value: 0 } },
        vertexShader: beamVertex, fragmentShader: beamFragment,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(this.beamGeo, beamMat);
      beam.visible = false;
      beam.renderOrder = 2;
      group.add(body, hit, beam);
      this.fixtureGroup.add(group);
      const dir0 = new THREE.Vector3(aim.x - pos.x, aim.y - pos.y, aim.z - pos.z);
      if (dir0.lengthSq() < 1e-6) dir0.set(0, -1, 0);
      this.fixtures.set(fx.id, {
        group, body, lens, beam, fx, prof, mover, aimPoint: new THREE.Vector3(aim.x, aim.y, aim.z),
        live: { c: [0, 0, 0], d: 0, p: 0.5, t: 0.5, z: 0.5 },
      });
      this.updateFixture(fx.id);
    }
    this.applySelection();
  }

  // ----- live updates -------------------------------------------------------
  setLive(live) {
    for (const [id, l] of Object.entries(live || {})) {
      const f = this.fixtures.get(id);
      if (!f) continue;
      f.live = { ...f.live, ...l };
      this.updateFixture(id);
    }
    this.assignSpots();
  }

  direction(f) {
    const d0 = f.aimPoint.clone().sub(f.group.position).normalize();
    if (!f.mover) return d0;
    const pan = ((f.live.p ?? 0.5) - 0.5) * THREE.MathUtils.degToRad(540);
    const tilt = ((f.live.t ?? 0.5) - 0.5) * THREE.MathUtils.degToRad(270);
    let right = new THREE.Vector3().crossVectors(d0, UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    return d0.applyAxisAngle(right, tilt).applyAxisAngle(UP, pan).normalize();
  }

  updateFixture(id) {
    const f = this.fixtures.get(id);
    if (!f) return;
    const dir = this.direction(f);
    f.dir = dir;
    f.body.quaternion.setFromUnitVectors(Z, dir);
    const [r, g, b] = f.live.c || [0, 0, 0];
    const lit = Math.max(r, g, b) / 255;
    const color = new THREE.Color(r / 255, g / 255, b / 255);
    f.lens.material.color.copy(lit > 0.01 ? color.clone().multiplyScalar(1 / Math.max(lit, 0.001)).multiplyScalar(0.4 + 0.6 * lit) : new THREE.Color(0x050505));
    // Beam length: until it reaches the floor, or 18 m
    const pos = f.group.position;
    let len = dir.y < -0.02 ? Math.min(30, pos.y / -dir.y) : 18;
    if (!Number.isFinite(len) || len < 0.5) len = 0.5;
    const zoom = f.prof.attrs.includes('zoom') ? 8 + 42 * (f.live.z ?? 0.5) : f.fx.beam || 25;
    f.angle = THREE.MathUtils.degToRad(zoom);
    const radius = Math.tan(f.angle / 2) * len;
    f.beam.scale.set(radius, radius, len);
    f.beam.quaternion.setFromUnitVectors(Z, dir);
    f.beam.visible = lit > 0.01;
    f.beam.material.uniforms.color.value.copy(lit > 0 ? color.multiplyScalar(1 / lit) : color);
    f.beam.material.uniforms.strength.value = lit * this.haze * 0.55;
    f.len = len;
    f.lit = lit;
  }

  assignSpots() {
    const lit = [...this.fixtures.values()].filter((f) => f.lit > 0.01).sort((a, b) => b.lit - a.lit).slice(0, MAX_SPOTS);
    this.spots.forEach((s, i) => {
      const f = lit[i];
      if (!f) {
        s.intensity = 0;
        return;
      }
      const [r, g, b] = f.live.c;
      s.color.setRGB(r / 255 / f.lit, g / 255 / f.lit, b / 255 / f.lit);
      s.intensity = f.lit * 140;
      s.angle = Math.min(Math.PI / 2.2, f.angle / 2 + 0.03);
      s.position.copy(f.group.position);
      s.target.position.copy(f.group.position).addScaledVector(f.dir, 5);
      s.target.updateMatrixWorld();
    });
  }

  // ----- selection & editing -------------------------------------------------
  setSelection(ids) {
    this.selection = new Set(ids);
    this.applySelection();
  }
  applySelection() {
    for (const [id, f] of this.fixtures) f.body.material.emissive.setHex(this.selection.has(id) ? 0x1d5fbf : 0x000000);
    if (this.mode === 'edit') {
      const only = this.selection.size === 1 ? this.fixtures.get([...this.selection][0]) : null;
      if (only) this.transform.attach(only.group);
      else this.transform.detach();
    }
  }
  startAim(id, cb) {
    this.aiming = { id, cb };
    this.canvas.style.cursor = 'crosshair';
  }

  setupPointer() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      down = null;
      const r = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      if (this.aiming) {
        const surfaces = [];
        this.stageGroup.traverse((c) => c.isMesh && c.userData.surface && surfaces.push(c));
        this.modelGroup.traverse((c) => c.isMesh && surfaces.push(c));
        const hit = this.raycaster.intersectObjects(surfaces, false)[0];
        if (hit) {
          const { cb, id } = this.aiming;
          this.aiming = null;
          this.canvas.style.cursor = '';
          cb(id, { x: hit.point.x, y: hit.point.y, z: hit.point.z });
        }
        return;
      }
      if (this.mode === 'view') return;
      const hits = [];
      for (const f of this.fixtures.values()) hits.push(f.group.children[1]);
      const hit = this.raycaster.intersectObjects(hits, false)[0];
      if (hit) this.onSelect && this.onSelect(hit.object.userData.fixtureId, e.shiftKey || e.metaKey);
      else if (this.mode === 'edit') this.onSelect && this.onSelect(null, false);
    });
  }
}
