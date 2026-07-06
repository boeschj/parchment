/// <reference types="@react-three/fiber" />
import { Suspense, lazy, useEffect } from "react";
import type { z } from "zod/v4";
import {
  SceneBackground,
  SceneObjectKind,
  Scene3DPropsSchema,
} from "../../shared/catalog/extensions/Scene3D.ts";

type Scene3DProps = z.infer<typeof Scene3DPropsSchema>;
type SceneObject = Scene3DProps["objects"][number];
type Vector3 = [number, number, number];
type RenderProps = { props: Scene3DProps };

// drei's Text is only available inside the lazily-loaded chunk; grab its type
// without a runtime import so label rendering can live at module scope.
type DreiTextComponent = (typeof import("@react-three/drei"))["Text"];

const DEFAULT_HEIGHT_PX = 420;
const DEFAULT_CAMERA_POSITION: Vector3 = [7, 6, 9];
const DEFAULT_LOOK_AT: Vector3 = [0, 0.75, 0];
const DEFAULT_SIZE: Vector3 = [1, 1, 1];
const DEFAULT_OBJECT_COLOR = "#a99a86";
const CAMERA_FOV = 46;

const LIGHT_SURFACE = "#F3F3F3";
const DARK_SURFACE = "#0B0A08";
const LIGHT_LABEL = "#2b2924";
const DARK_LABEL = "#f4f2ec";
const LIGHT_GRID = { center: "#b9b1a1", line: "#d7d0c4" } as const;
const DARK_GRID = { center: "#3a382f", line: "#26241f" } as const;

const GRID_EXTENT = 24;
const GRID_DIVISIONS = 24;
const CYLINDER_SEGMENTS = 24;
const SPHERE_WIDTH_SEGMENTS = 32;
const SPHERE_HEIGHT_SEGMENTS = 24;
const LABEL_GAP = 0.32;
const LABEL_FONT_SIZE = 0.34;
const LABEL_OUTLINE_WIDTH = 0.012;
const DEGREES_TO_RADIANS = Math.PI / 180;

// three's THREE.Side enum values, inlined so the material renderer stays in the
// main chunk without a static `three` import (FrontSide=0, DoubleSide=2).
const THREE_SIDE_FRONT = 0;
const THREE_SIDE_DOUBLE = 2;

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Theme is read straight from the DOM rather than ThemeContext: the offscreen
// PNG-export tree renders without a ThemeProvider, but always in this document.
function isDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}

function resolveSurfaceColor(): string {
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  if (HEX_COLOR.test(token)) return token;
  return isDarkTheme() ? DARK_SURFACE : LIGHT_SURFACE;
}

function resolveLabelColor(): string {
  return isDarkTheme() ? DARK_LABEL : LIGHT_LABEL;
}

function resolveGridColors(): { center: string; line: string } {
  return isDarkTheme() ? DARK_GRID : LIGHT_GRID;
}

function toRadians(rotation: Vector3 | undefined): Vector3 {
  if (!rotation) return [0, 0, 0];
  const [x, y, z] = rotation;
  return [x * DEGREES_TO_RADIANS, y * DEGREES_TO_RADIANS, z * DEGREES_TO_RADIANS];
}

function halfHeightOf(object: SceneObject): number {
  const [diameterOrWidth, height] = object.size ?? DEFAULT_SIZE;
  if (object.kind === SceneObjectKind.Sphere) return diameterOrWidth / 2;
  return height / 2;
}

function labelPositionOf(object: SceneObject): Vector3 {
  const [x, y, z] = object.position;
  if (object.kind === SceneObjectKind.Text) return [x, y, z];
  return [x, y + halfHeightOf(object) + LABEL_GAP, z];
}

function GeometryForKind({ object }: { object: SceneObject }) {
  const [sizeX, sizeY, sizeZ] = object.size ?? DEFAULT_SIZE;
  switch (object.kind) {
    case SceneObjectKind.Box:
      return <boxGeometry args={[sizeX, sizeY, sizeZ]} />;
    case SceneObjectKind.Plane:
      return <planeGeometry args={[sizeX, sizeY]} />;
    case SceneObjectKind.Cylinder: {
      const radius = sizeX / 2;
      return <cylinderGeometry args={[radius, radius, sizeY, CYLINDER_SEGMENTS]} />;
    }
    case SceneObjectKind.Sphere: {
      const radius = sizeX / 2;
      return <sphereGeometry args={[radius, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS]} />;
    }
    default:
      return null;
  }
}

function SceneMesh({ object }: { object: SceneObject }) {
  const opacity = object.opacity ?? 1;
  const color = object.color ?? DEFAULT_OBJECT_COLOR;
  const rotation = toRadians(object.rotation);
  const isTransparent = opacity < 1;
  const materialSide =
    object.kind === SceneObjectKind.Plane ? THREE_SIDE_DOUBLE : THREE_SIDE_FRONT;

  return (
    <mesh position={object.position} rotation={rotation}>
      <GeometryForKind object={object} />
      <meshStandardMaterial
        color={color}
        transparent={isTransparent}
        opacity={opacity}
        side={materialSide}
        roughness={0.82}
        metalness={0.04}
      />
    </mesh>
  );
}

function SceneLabels({
  objects,
  color,
  Text,
}: {
  objects: SceneObject[];
  color: string;
  Text: DreiTextComponent;
}) {
  const surfaceColor = resolveSurfaceColor();
  return (
    <>
      {objects.map((object, index) => (
        <Text
          key={index}
          position={labelPositionOf(object)}
          fontSize={LABEL_FONT_SIZE}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={LABEL_OUTLINE_WIDTH}
          outlineColor={surfaceColor}
        >
          {object.label}
        </Text>
      ))}
    </>
  );
}

function SceneSkeleton({ height }: { height: number }) {
  return (
    <div
      className="animate-pulse bg-muted"
      style={{ height, borderBottomLeftRadius: "var(--radius)", borderBottomRightRadius: "var(--radius)" }}
    />
  );
}

// The 3D stack (three + fiber + drei, ~600KB) is code-split out of the main
// bundle: this factory runs only when a Scene3D slot first renders. Everything
// that touches drei (Canvas, OrbitControls, Text) lives in the closure; all the
// mesh/geometry rendering above uses r3f intrinsics and needs no runtime import.
const RENDER_PUMP_DELAYS_MS = [0, 60, 180, 450, 950] as const;

const SceneViewport = lazy(async () => {
  const [{ Canvas, useThree }, { OrbitControls, Text }] = await Promise.all([
    import("@react-three/fiber"),
    import("@react-three/drei"),
  ]);

  // Paints a few synchronous frames that do NOT depend on requestAnimationFrame.
  // The PNG-export path renders this scene offscreen and rasterizes the WebGL
  // buffer with html-to-image; when the canvas tab is backgrounded, rAF is
  // throttled and r3f's own loop never draws, so the export would come out
  // blank. Forcing gl.render fills the (preserved) buffer regardless.
  function RenderPump() {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const camera = useThree((state) => state.camera);
    useEffect(() => {
      let cancelled = false;
      const paint = () => {
        if (!cancelled) gl.render(scene, camera);
      };
      const timers = RENDER_PUMP_DELAYS_MS.map((delay) => setTimeout(paint, delay));
      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    }, [gl, scene, camera]);
    return null;
  }

  function SceneViewport({ props }: RenderProps) {
    const cameraPosition = props.camera?.position ?? DEFAULT_CAMERA_POSITION;
    const target = props.camera?.lookAt ?? DEFAULT_LOOK_AT;
    const showGround = props.ground ?? true;
    const autoRotate = props.autoRotate ?? false;
    const isTransparent = props.background === SceneBackground.Transparent;
    const surfaceColor = resolveSurfaceColor();
    const labelColor = resolveLabelColor();
    const gridColors = resolveGridColors();
    const meshObjects = props.objects.filter((object) => object.kind !== SceneObjectKind.Text);
    const labelObjects = props.objects.filter((object) => object.label !== undefined);

    return (
      <Canvas
        dpr={[1, 2]}
        camera={{ position: cameraPosition, fov: CAMERA_FOV }}
        gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
      >
        {isTransparent ? null : <color attach="background" args={[surfaceColor]} />}
        <RenderPump />
        <ambientLight intensity={0.75} />
        <hemisphereLight color="#ffffff" groundColor="#8d8674" intensity={0.5} />
        <directionalLight position={[6, 10, 6]} intensity={1.1} />
        <directionalLight position={[-6, 4, -4]} intensity={0.35} />
        {showGround ? (
          <gridHelper args={[GRID_EXTENT, GRID_DIVISIONS, gridColors.center, gridColors.line]} />
        ) : null}
        {meshObjects.map((object, index) => (
          <SceneMesh key={index} object={object} />
        ))}
        <SceneLabels objects={labelObjects} color={labelColor} Text={Text} />
        <OrbitControls
          target={target}
          enableDamping
          autoRotate={autoRotate}
          autoRotateSpeed={0.8}
          makeDefault
        />
      </Canvas>
    );
  }

  return { default: SceneViewport };
});

export function Scene3D({ props }: RenderProps) {
  const height = props.height ?? DEFAULT_HEIGHT_PX;

  return (
    <div
      className="bg-card text-card-foreground overflow-hidden"
      style={{ borderRadius: "var(--radius)" }}
    >
      {props.title ? (
        <>
          <header className="px-6 py-4">
            <h2 className="text-base font-semibold tracking-tight">{props.title}</h2>
          </header>
          <hr className="hairline mx-6" />
        </>
      ) : null}
      <div style={{ height, width: "100%" }}>
        <Suspense fallback={<SceneSkeleton height={height} />}>
          <SceneViewport props={props} />
        </Suspense>
      </div>
    </div>
  );
}
