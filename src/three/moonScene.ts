import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BP_DESKTOP } from '@/utils/breakpoints';
import { publicAssetUrl } from '@/utils/publicAssetUrl';

export type FeatureProjection = {
  /** Pixel x relative to the canvas's top-left corner (CSS px). */
  x: number;
  /** Pixel y relative to the canvas's top-left corner (CSS px). */
  y: number;
  /** Apparent radius of the feature in CSS px, accounting for perspective. */
  radius: number;
  /** False when the feature is on the back side of the sphere from the camera. */
  visible: boolean;
};

export type MoonSceneHandle = {
  setOverlay: (overlayId: string | null) => void;
  setCameraTarget: (target: { lat: number; lon: number }) => void;
  getCameraLatLon: () => { lat: number; lon: number };
  setView: (view: string) => void;
  pause: () => void;
  resume: () => void;
  /** Toggle user camera control (drag-to-rotate). */
  setControlsEnabled: (enabled: boolean) => void;
  /**
   * Rotate the camera around the Moon by the given deltas (radians).
   * Cancels any in-flight tween so the rotation is responsive to the
   * caller (e.g. an arrow-key handler).
   */
  rotateBy: (delta: { deltaAzimuth?: number; deltaPolar?: number }) => void;
  /**
   * Project a feature at (lat, lon) with a given km diameter into
   * canvas pixel space, using the current camera.
   * Returns null when the scene isn't ready yet.
   */
  projectFeature: (
    lat: number,
    lon: number,
    diameterKm: number
  ) => FeatureProjection | null;
  dispose: () => void;
} | null;

export type MoonSceneOptions = {
  enableOrbitControls?: boolean;
  autoRotate?: boolean;
  initialTarget?: { lat: number; lon: number };
  /** Honor prefers-reduced-motion: camera target changes snap instantly
   * instead of tweening, and drag has no damping glide. The reader can
   * still rotate the sphere by hand; only automatic motion is removed. */
  reducedMotion?: boolean;
};

const CAMERA_RADIUS_BASE = 2.5;
const CAMERA_FOV_DEG = 45;
// Features within this many degrees of a pole are treated as "polar": their
// longitude is degenerate, so the camera ignores it and keeps its current
// longitude instead (see setCameraTarget). That removes the azimuthal swing
// around the pole that otherwise reads as a twist. The camera still tweens to
// the feature's true latitude, so a polar feature lands centered — at the cost
// of resting very close to the lookAt up-vector singularity at the pole.
const CAMERA_POLAR_THRESHOLD_DEG = 85;
// Sphere (radius 1) plus a little breathing room. Used to pick the
// camera distance that keeps the whole disc inside the canvas on the
// narrower of the two axes.
const FIT_RADIUS = 1.15;

// Measure the element that actually drives layout. The canvas fills its
// parent via CSS (width/height: 100%), so we read the parent's content box
// rather than the canvas's own. This keeps measurements live across resizes:
// renderer.setSize is called with updateStyle=false (see below), so the
// canvas never gets inline px dimensions that would otherwise pin clientWidth.
function getCanvasSize(canvas: HTMLCanvasElement) {
  const box = canvas.parentElement ?? canvas;
  return {
    width: Math.max(box.clientWidth, 1),
    height: Math.max(box.clientHeight, 1),
  };
}

// Distance at which the sphere just fits both axes of a canvas with
// the given aspect. On narrow (portrait) canvases this grows so the
// Moon doesn't clip horizontally.
function fitCameraRadius(aspect: number): number {
  const halfFov = (CAMERA_FOV_DEG * Math.PI) / 180 / 2;
  const byHeight = FIT_RADIUS / Math.tan(halfFov);
  const byWidth = FIT_RADIUS / (Math.tan(halfFov) * aspect);
  return Math.max(CAMERA_RADIUS_BASE, byHeight, byWidth);
}

function slerpOnSphere(
  out: THREE.Vector3,
  from: THREE.Vector3,
  to: THREE.Vector3,
  t: number
) {
  const a = from.length();
  const b = to.length();
  if (a === 0 || b === 0) {
    out.lerpVectors(from, to, t);
    return;
  }
  const cos = Math.min(1, Math.max(-1, from.dot(to) / (a * b)));
  const omega = Math.acos(cos);
  if (omega < 1e-4) {
    out.lerpVectors(from, to, t);
    return;
  }
  const sin = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / sin;
  const wb = Math.sin(t * omega) / sin;
  out.copy(from).multiplyScalar(wa).addScaledVector(to, wb);
}

function latLonToCameraPosition(lat: number, lon: number, radius: number) {
  const phi = ((90 - lat) * Math.PI) / 180;
  // Longitude is negated to match the moon texture (NASA SVS 4720 CGI
  // Moon Kit): its equirectangular image centers on lon 0° and grows
  // east to the right, while three.js SphereGeometry's default UVs put
  // u=0.75 at the 3D point (0, 0, -1). So east +90° must land at -Z.
  const theta = (-lon * Math.PI) / 180;

  return {
    x: radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
}

function normalizeLongitude(lon: number) {
  if (lon <= -180) {
    return lon + 360;
  }
  if (lon > 180) {
    return lon - 360;
  }
  return lon;
}

export function cameraPositionToLatLon(position: {
  x: number;
  y: number;
  z: number;
}) {
  const radius = Math.hypot(position.x, position.y, position.z);
  if (radius === 0) {
    return { lat: 0, lon: 0 };
  }

  const lat =
    90 -
    (Math.acos(Math.min(1, Math.max(-1, position.y / radius))) * 180) / Math.PI;
  const lon = normalizeLongitude(
    -(Math.atan2(position.z, position.x) * 180) / Math.PI
  );

  return {
    lat: Math.max(-90, Math.min(90, lat)),
    lon,
  };
}

export function createMoonScene(
  canvas: HTMLCanvasElement,
  options?: MoonSceneOptions
): MoonSceneHandle {
  if (!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))) {
    return null;
  }

  const { width, height } = getCanvasSize(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // updateStyle=false: let CSS (.canvas { width/height: 100% }) own the
  // display size. Writing inline px here would pin canvas.clientWidth and
  // stop the ResizeObserver from ever seeing a new size.
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1b32);

  let cameraRadius = fitCameraRadius(width / height);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV_DEG,
    width / height,
    0.1,
    100
  );
  camera.position.set(0, 0, cameraRadius);
  camera.lookAt(0, 0, 0);

  let texture2k: THREE.Texture | null = null;
  let texture8k: THREE.Texture | null = null;
  let disposed = false;

  // Declared up front so the texture loader's reveal branch (below) can read it
  // even when a texture resolves synchronously (e.g. a cached image or a test
  // stub), before the controls block that also consumes it runs.
  const reducedMotion = options?.reducedMotion ?? false;

  // Fade-in state. The Moon starts transparent and fades in once its surface
  // texture is applied (see the 2k loader and renderFrame). Without a map the
  // unlit material renders solid white, which flashed in the moment between
  // the canvas mounting and the texture landing, most visibly when the expand
  // dialog opened. Holding opacity at 0 until the texture is ready means the
  // reader only ever sees the real surface emerge from the dark canvas.
  const MOON_REVEAL_MS = 600;
  let moonRevealing = false;
  let moonRevealStart = 0;

  const geometry = new THREE.SphereGeometry(1, 64, 64);
  // The Moon texture already includes its own tonal shading, so render it
  // unlit to preserve the authored brightness and avoid scene-light shifts.
  const material = new THREE.MeshBasicMaterial({
    map: texture2k,
    transparent: true,
    opacity: 0,
  });
  const moon = new THREE.Mesh(geometry, material);
  moon.position.set(0, 0, 0);
  scene.add(moon);

  const textureLoader = new THREE.TextureLoader();

  const loadTexture = (
    primarySrc: string,
    fallbackSrc: string,
    onLoad: (texture: THREE.Texture) => void
  ) => {
    const handleLoad = (loadedTexture: THREE.Texture) => {
      if (disposed) {
        loadedTexture.dispose();
        return;
      }
      onLoad(loadedTexture);
    };

    textureLoader.load(primarySrc, handleLoad, undefined, () => {
      if (primarySrc === fallbackSrc || disposed) {
        return;
      }
      textureLoader.load(fallbackSrc, handleLoad);
    });
  };

  loadTexture(
    publicAssetUrl('/moon/moon-2k.avif'),
    publicAssetUrl('/moon/moon-2k.jpg'),
    (loadedTexture) => {
      loadedTexture.colorSpace = THREE.SRGBColorSpace;
      texture2k = loadedTexture;
      material.map = loadedTexture;
      material.needsUpdate = true;

      // Reveal the now-textured Moon. Snap straight to visible under reduced
      // motion; otherwise arm the fade driven by renderFrame. If the loop is
      // paused when the texture lands, the elapsed time will already exceed
      // MOON_REVEAL_MS by the time it resumes, so the fade snaps to full on the
      // first frame rather than replaying when the reader scrolls it into view.
      if (reducedMotion) {
        material.opacity = 1;
        material.transparent = false;
        material.needsUpdate = true;
      } else {
        moonRevealStart = performance.now();
        moonRevealing = true;
      }

      if (
        window.matchMedia(
          `(min-width: ${BP_DESKTOP}px) and (min-resolution: 2dppx)`
        ).matches
      ) {
        loadTexture(
          publicAssetUrl('/moon/moon-8k.avif'),
          publicAssetUrl('/moon/moon-8k.jpg'),
          (hiResTexture) => {
            hiResTexture.colorSpace = THREE.SRGBColorSpace;
            texture8k = hiResTexture;
            material.map = hiResTexture;
            material.needsUpdate = true;
          }
        );
      }
    }
  );

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.05;
  controls.autoRotate = options?.autoRotate ?? true;
  controls.autoRotateSpeed = 0.3;
  controls.enabled = options?.enableOrbitControls ?? true;

  // Tween source/target for smooth camera moves between steps
  const tweenFrom = new THREE.Vector3().copy(camera.position);
  const tweenTo = new THREE.Vector3().copy(camera.position);
  let tweenStart = 0;
  let tweenDuration = 0;

  let tweenTargetLat = options?.initialTarget?.lat ?? 0;
  let tweenTargetLon = options?.initialTarget?.lon ?? 0;

  const setCameraTarget = (target: { lat: number; lon: number }) => {
    // Near a pole, longitude is degenerate. Forcing the camera to travel to
    // the feature's longitude makes it circle the pole, and azimuthal motion
    // that close to the pole reads as roll — the visible "twist" when
    // targeting Shackleton (-89.67°) from a feature at a very different
    // longitude. So for polar features we keep the camera's current longitude
    // and only change latitude: a clean pitch up the meridian it's already on.
    // The feature's true lat/lon is used by projectFeature for the label, so
    // the annotation stays anchored.
    const isPolar = Math.abs(target.lat) > CAMERA_POLAR_THRESHOLD_DEG;
    tweenTargetLat = target.lat;
    tweenTargetLon = isPolar
      ? cameraPositionToLatLon(camera.position).lon
      : target.lon;
    const { x, y, z } = latLonToCameraPosition(
      tweenTargetLat,
      tweenTargetLon,
      cameraRadius
    );
    tweenTo.set(x, y, z);

    // Reduced motion: snap straight to the target. No tween for the
    // render loop to drive, so cancel any in-flight one.
    if (reducedMotion) {
      tweenDuration = 0;
      camera.position.copy(tweenTo);
      camera.lookAt(0, 0, 0);
      return;
    }

    tweenFrom.copy(camera.position);
    tweenStart = performance.now();
    tweenDuration = 900;
  };

  if (options?.initialTarget) {
    setCameraTarget(options.initialTarget);
  }

  scene.userData.overlayId = null as string | null;
  scene.userData.view = 'default';

  let lastObservedWidth = width;
  let lastObservedHeight = height;
  const resizeObserver = new ResizeObserver(() => {
    const nextSize = getCanvasSize(canvas);
    // Dead-band: ignore sub-pixel jitter. fitCameraRadius is non-linear
    // in aspect, so even a fractional-pixel change pushes the camera
    // distance by a visible amount and reads as the Moon resizing.
    if (
      Math.abs(nextSize.width - lastObservedWidth) < 1 &&
      Math.abs(nextSize.height - lastObservedHeight) < 1
    ) {
      return;
    }
    lastObservedWidth = nextSize.width;
    lastObservedHeight = nextSize.height;
    renderer.setSize(nextSize.width, nextSize.height, false);
    const aspect = nextSize.width / nextSize.height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const nextRadius = fitCameraRadius(aspect);
    if (Math.abs(nextRadius - cameraRadius) > 0.001) {
      cameraRadius = nextRadius;
      // Rescale whatever camera move is currently in flight (or at
      // rest) to the new fit distance, keeping the same lat/lon.
      const { x, y, z } = latLonToCameraPosition(
        tweenTargetLat,
        tweenTargetLon,
        cameraRadius
      );
      tweenTo.set(x, y, z);
      // If not mid-tween, snap position; otherwise let the tween drive.
      if (tweenDuration === 0) {
        camera.position.copy(tweenTo);
        camera.lookAt(0, 0, 0);
      }
    }
  });
  resizeObserver.observe(canvas.parentElement ?? canvas);

  const renderFrame = () => {
    if (tweenDuration > 0) {
      const elapsed = performance.now() - tweenStart;
      const t = Math.min(elapsed / tweenDuration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      // Slerp along the sphere of radius cameraRadius instead of a
      // straight lerp. A straight line between two points on the
      // sphere cuts through the origin; for nearly-antipodal targets
      // (e.g. South Pole–Aitken from a nearside feature) that would
      // plunge the camera toward the Moon mid-tween and read as a
      // dramatic zoom-in.
      slerpOnSphere(camera.position, tweenFrom, tweenTo, eased);
      camera.lookAt(0, 0, 0);
      if (t >= 1) tweenDuration = 0;
    }
    if (moonRevealing) {
      const t = Math.min(
        (performance.now() - moonRevealStart) / MOON_REVEAL_MS,
        1
      );
      // easeOutCubic, matching the camera tween's easing.
      material.opacity = 1 - Math.pow(1 - t, 3);
      if (t >= 1) {
        material.opacity = 1;
        material.transparent = false;
        material.needsUpdate = true;
        moonRevealing = false;
      }
    }
    controls.update();
    renderer.render(scene, camera);
  };

  let isLoopRunning = false;

  const resume = () => {
    if (disposed || isLoopRunning) {
      return;
    }

    isLoopRunning = true;
    renderer.setAnimationLoop(renderFrame);
  };

  const pause = () => {
    if (!isLoopRunning) {
      return;
    }

    isLoopRunning = false;
    renderer.setAnimationLoop(null);
  };

  resume();

  // Reused vectors for projectFeature so we don't allocate per frame.
  const projCenter = new THREE.Vector3();
  const projEdge = new THREE.Vector3();
  const projAxis = new THREE.Vector3();
  const projTangent = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const MOON_RADIUS_KM = 1737;

  return {
    setOverlay(overlayId: string | null) {
      scene.userData.overlayId = overlayId;
    },
    setCameraTarget,
    getCameraLatLon() {
      return cameraPositionToLatLon(camera.position);
    },
    setView(view: string) {
      scene.userData.view = view;
    },
    pause,
    resume,
    setControlsEnabled(enabled: boolean) {
      controls.enabled = enabled;
    },
    rotateBy({ deltaAzimuth = 0, deltaPolar = 0 }) {
      // Cancel any in-flight camera tween so the keyboard rotation
      // takes effect immediately rather than fighting with the easing.
      tweenDuration = 0;
      const spherical = new THREE.Spherical().setFromVector3(camera.position);
      spherical.theta += deltaAzimuth;
      // Clamp polar angle away from the poles to avoid gimbal flip.
      const EPS = 0.05;
      spherical.phi = Math.max(
        EPS,
        Math.min(Math.PI - EPS, spherical.phi + deltaPolar)
      );
      camera.position.setFromSpherical(spherical);
      camera.lookAt(0, 0, 0);
    },
    projectFeature(
      lat: number,
      lon: number,
      diameterKm: number
    ): FeatureProjection | null {
      const phi = ((90 - lat) * Math.PI) / 180;
      // See latLonToCameraPosition for why longitude is negated.
      const theta = (-lon * Math.PI) / 180;

      // Unit vector from sphere center to the feature's surface point.
      projCenter.set(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      );

      // Visible if the surface normal at the feature has a component
      // toward the camera (dot product > 0).
      toCamera.copy(camera.position).sub(projCenter).normalize();
      const visible = toCamera.dot(projCenter) > 0;

      // Pick a tangent direction perpendicular to the center vector,
      // then rotate around the axis perpendicular to both to get a
      // point on the sphere one feature-radius away along the surface.
      if (Math.abs(projCenter.y) < 0.98) {
        projTangent.set(-projCenter.z, 0, projCenter.x).normalize();
      } else {
        projTangent.set(1, 0, 0);
      }
      projAxis.crossVectors(projCenter, projTangent).normalize();
      const arcAngle = diameterKm / 2 / MOON_RADIUS_KM;
      projEdge.copy(projCenter).applyAxisAngle(projAxis, arcAngle);

      // Project center and edge through the camera to NDC.
      projCenter.project(camera);
      projEdge.project(camera);

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = ((projCenter.x + 1) / 2) * w;
      const cy = ((1 - projCenter.y) / 2) * h;
      const ex = ((projEdge.x + 1) / 2) * w;
      const ey = ((1 - projEdge.y) / 2) * h;

      const radius = Math.hypot(ex - cx, ey - cy);
      return { x: cx, y: cy, radius, visible };
    },
    dispose() {
      disposed = true;
      pause();
      resizeObserver.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      texture2k?.dispose();
      texture8k?.dispose();
      renderer.dispose();
    },
  };
}
