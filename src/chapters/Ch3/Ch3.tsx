import { useCallback, useEffect, useRef, useState } from 'react';
import { OptimizedImage } from '@/components/OptimizedImage/OptimizedImage';
import { Prose } from '@/components/Prose';
import {
  ScrollyChapter,
  type ScrollyStep,
} from '@/components/ScrollyChapter/ScrollyChapter';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useViewportActivity } from '@/hooks/useViewportActivity';
import type { EarthMoonSceneHandle } from '@/three/earthMoonScene';
import styles from './Ch3.module.css';

type StepState = {
  withMoon: boolean;
  showEclipse: boolean;
  showFullMoon: boolean;
  showLunarEclipse: boolean;
};

const STEP_STATES: Record<string, StepState> = {
  'tidal-bulges': {
    withMoon: true,
    showEclipse: false,
    showFullMoon: false,
    showLunarEclipse: false,
  },
  'axial-stabilization': {
    withMoon: true,
    showEclipse: false,
    showFullMoon: false,
    showLunarEclipse: false,
  },
  'full-moon-alignment': {
    withMoon: true,
    showEclipse: false,
    showFullMoon: true,
    showLunarEclipse: false,
  },
  'without-moon': {
    withMoon: false,
    showEclipse: false,
    showFullMoon: false,
    showLunarEclipse: false,
  },
  'eclipse-alignment': {
    withMoon: true,
    showEclipse: true,
    showFullMoon: false,
    showLunarEclipse: false,
  },
  'lunar-eclipse-alignment': {
    withMoon: true,
    showEclipse: false,
    showFullMoon: false,
    showLunarEclipse: true,
  },
};

const STEPS: ScrollyStep[] = [
  {
    id: 'tidal-bulges',
    marker: 'tides',
    content: (
      <>
        <h3>Tides are the Moon&apos;s most visible signature</h3>
        <p>
          The Moon's gravity pulls Earth unevenly. The side facing the Moon
          receives the strongest tug, pulling ocean water into a high-tide
          bulge. On the far side, gravity weakens enough that the Moon pulls the
          solid Earth away faster than the distant water, leaving a second bulge
          trailing behind.
        </p>
        <p>
          Between these two bulges, the sea becomes shallow. As Earth rotates,
          coastlines pass through these deep and shallow stretches, experiencing
          two high tides and two low tides each day.
        </p>
      </>
    ),
  },
  {
    id: 'axial-stabilization',
    marker: 'axial stabilization',
    content: (
      <>
        <h3>The Moon steadies Earth&apos;s tilt</h3>
        <p>
          Earth spins at a tilt, leaning about 23.5 degrees away from an upright
          position relative to its orbit around the Sun. That lean is what gives
          the planet seasons, since across the year each hemisphere tips toward
          the Sun and then away from it.
        </p>
        <p>
          The Moon's gravity helps hold that angle steady. Today the tilt drifts
          only about a degree either way over tens of thousands of years, and
          the Moon's pull is a large part of why it stays in such a narrow band.
        </p>
      </>
    ),
  },
  {
    id: 'without-moon',
    marker: 'without the moon',
    content: (
      <>
        <h3>A moonless Earth would wander</h3>
        <p>
          Early models predicted that without the Moon, Earth's tilt could swing
          chaotically by as much as 85 degrees, and for decades a massive moon
          was treated as a requirement for life.
        </p>
        <p>
          Newer simulations have since revised that figure down to about 20
          degrees, enough to make the climate more variable but not
          uninhabitable. Whether a large moon is strictly necessary for a
          livable world remains an open question.
        </p>
      </>
    ),
  },
  {
    id: 'full-moon-alignment',
    marker: 'full moon',
    content: (
      <>
        <h3>When sunlight is reflected straight back to Earth</h3>
        <p>
          Every 29.5 days, the Moon moves directly opposite the Sun with Earth
          positioned in the middle. While this alignment seems like it would
          block the sunlight, the Moon&apos;s orbit is tilted by about five
          degrees compared to Earth&apos;s. This tilt allows the Moon to pass
          above or below Earth&apos;s shadow, where sunlight fully illuminates
          the side facing Earth to create a full moon.
        </p>
      </>
    ),
  },
  {
    id: 'lunar-eclipse-alignment',
    marker: 'lunar eclipse',
    content: (
      <>
        <h3>When sunlight is filtered through Earth's atmosphere</h3>
        <p>
          Two to five times a year, the Moon crosses into Earth's shadow instead
          of passing above or below it. This creates a lunar eclipse. If the
          Moon enters only the faint outer shadow, its face dims so slightly
          that the change is easy to miss.
        </p>
        <p>
          But when the Sun, Earth, and Moon align perfectly, the Moon slides
          fully into the darkest inner shadow: the umbra. The only light
          reaching the lunar surface travels through Earth's atmosphere first.
          The atmosphere scatters away the shorter blue wavelengths, bending the
          remaining red and orange light onto the Moon. This is the same effect
          that reddens a sunset, which is why a total lunar eclipse is nicknamed
          a blood moon.
        </p>
      </>
    ),
  },
  {
    id: 'eclipse-alignment',
    marker: 'solar eclipse',
    content: (
      <>
        <h3>When sunlight is blocked by the Moon</h3>
        <p>
          A solar eclipse occurs when the Moon passes directly between Earth and
          the Sun. This alignment is possible because of a coincidence: the Moon
          is about 400 times smaller than the Sun but also about 400 times
          closer to Earth.
        </p>
        <p>
          This geometry makes the Sun and Moon appear almost the same size from
          Earth. During an eclipse, the Moon's shadow reaches Earth along a
          narrow track, causing the sky to darken briefly as the Moon covers the
          Sun.
        </p>
      </>
    ),
  },
];

function Ch3Visual({
  activeStepId,
  animate,
}: {
  activeStepId: string | null;
  animate: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<EarthMoonSceneHandle>(null);
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [sceneReady, setSceneReady] = useState(false);
  const [shouldLoadScene, setShouldLoadScene] = useState(false);
  const { targetRef, isNearViewport, isVisible } =
    useViewportActivity<HTMLDivElement>({
      rootMargin: '320px 0px',
    });

  useEffect(() => {
    if (isNearViewport) {
      setShouldLoadScene(true);
    }
  }, [isNearViewport]);

  useEffect(() => {
    if (!shouldLoadScene) return;

    let disposed = false;
    import('@/three/earthMoonScene')
      .then(({ createEarthMoonScene }) => {
        if (disposed || !canvasRef.current) return;
        const handle = createEarthMoonScene(canvasRef.current, { animate });
        if (handle === null) {
          setWebglAvailable(false);
          return;
        }
        sceneRef.current = handle;
        if (!isVisible) {
          handle.pause();
        }
        setSceneReady(true);
      })
      .catch(() => {
        if (!disposed) setWebglAvailable(false);
      });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setSceneReady(false);
    };
  }, [animate, isVisible, shouldLoadScene]);

  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return;

    if (isVisible) {
      sceneRef.current.resume();
      return;
    }

    sceneRef.current.pause();
  }, [isVisible, sceneReady]);

  // Runs once on scene-ready to apply the initial step's state, and
  // again whenever the active step changes.
  useEffect(() => {
    if (!sceneReady || !sceneRef.current || !activeStepId) return;
    const state = STEP_STATES[activeStepId];
    if (!state) return;
    sceneRef.current.setWithMoon(state.withMoon);
    sceneRef.current.setShowEclipse(state.showEclipse);
    sceneRef.current.setShowFullMoon(state.showFullMoon);
    sceneRef.current.setShowLunarEclipse(state.showLunarEclipse);
  }, [sceneReady, activeStepId]);

  if (!webglAvailable) {
    return (
      <div ref={targetRef} className={styles.visualSlot}>
        <OptimizedImage
          className={styles.fallbackDiagram}
          src="/ch3/with-moon.svg"
          alt="Schematic showing the Sun, Earth, and Moon in alignment"
        />
      </div>
    );
  }

  return (
    <div ref={targetRef} className={styles.visualSlot}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <p className={styles.scaleNote}>not to scale</p>
    </div>
  );
}

export default function Ch3() {
  const reducedMotion = useReducedMotion();
  const [activeStepId, setActiveStepId] = useState<string>(STEPS[0].id);

  const handleActiveStepChange = useCallback((id: string) => {
    setActiveStepId(id);
  }, []);

  return (
    <>
      <Prose className={styles.intro}>
        <IntroProse />
      </Prose>
      <ScrollyChapter
        variant="immersive"
        ariaLabel="The Earth-Moon system"
        initialStepId={STEPS[0].id}
        onActiveStepChange={handleActiveStepChange}
        visual={
          <Ch3Visual activeStepId={activeStepId} animate={!reducedMotion} />
        }
        steps={STEPS}
      />
    </>
  );
}

function IntroProse() {
  return (
    <>
      <p>
        Most moons are too small for their gravity to influence the planets they
        orbit. Earth's moon is different: at a quarter of Earth's diameter, its
        gravity reaches across space to pull on Earth. The clearest proof is the
        sea, where the ocean rises and falls twice daily, drawn up from 384,400
        kilometers away.
      </p>
      <p>
        The Moon's gravity isn't its only reach. Once in a while, it slips
        between Earth and the Sun, casting its shadow over the planet and
        turning day to dusk for a few minutes. This brief loss of sunlight is
        enough to change conditions on the ground, a reminder that the Moon can
        affect Earth by where it stands, not just by how hard it pulls.
      </p>
    </>
  );
}
