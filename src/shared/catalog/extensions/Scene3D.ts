import * as z from "zod/v4";

export const SceneObjectKind = {
  Box: "box",
  Sphere: "sphere",
  Cylinder: "cylinder",
  Plane: "plane",
  Text: "text",
} as const;

const SceneObjectKindSchema = z.enum([
  SceneObjectKind.Box,
  SceneObjectKind.Sphere,
  SceneObjectKind.Cylinder,
  SceneObjectKind.Plane,
  SceneObjectKind.Text,
]);

export const SceneBackground = {
  Auto: "auto",
  Transparent: "transparent",
} as const;

const SceneBackgroundSchema = z.enum([
  SceneBackground.Auto,
  SceneBackground.Transparent,
]);

const Vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

const SceneObjectSchema = z.object({
  kind: SceneObjectKindSchema.describe(
    "Primitive shape. 'box' for walls/tables/furniture/blocks; 'sphere' for balls/nodes/heads/bulbs; 'cylinder' for columns/legs/posts/cans; 'plane' for floors/rugs/screens (a flat quad); 'text' for a free-floating label whose text comes from `label`.",
  ),
  position: Vector3Schema.describe(
    "World position [x, y, z] in meters. y is UP; the ground grid sits at y=0. Rest an object of height h on the floor by centering it at y = h/2.",
  ),
  size: Vector3Schema.optional().describe(
    "Extent [x, y, z]. box/plane: [width, height, depth] (plane ignores depth). cylinder: [diameter, height, diameter]. sphere: [diameter, _, _] (only the first value, the diameter, is read). Defaults to [1, 1, 1].",
  ),
  rotation: Vector3Schema.optional().describe(
    "Rotation in DEGREES [x, y, z]. A plane laid flat as a floor is [-90, 0, 0]; an upright wall stays [0, 0, 0].",
  ),
  color: z
    .string()
    .optional()
    .describe("Hex color, e.g. '#c98a3a'. Defaults to a neutral clay surface."),
  label: z
    .string()
    .optional()
    .describe(
      "Short caption. On a shape it floats just above it (name a zone or part); for kind 'text' it IS the rendered text.",
    ),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("0 = fully transparent, 1 = solid. Default 1. Use ~0.3 for glass, water, or volumes."),
});

const CameraSchema = z.object({
  position: Vector3Schema.describe(
    "Eye position [x, y, z]. Pull back and up for an isometric read, e.g. [8, 7, 10].",
  ),
  lookAt: Vector3Schema.optional().describe(
    "Point the camera aims at. Defaults to the scene center.",
  ),
});

export const Scene3DPropsSchema = z.object({
  objects: z
    .array(SceneObjectSchema)
    .describe(
      "The shapes that make up the scene, drawn in a shared coordinate space. Build layouts by placing boxes/planes/cylinders relative to each other and labelling the important ones. 8-15 objects reads well.",
    ),
  camera: CameraSchema.optional().describe(
    "Starting viewpoint. Omit for a sensible isometric default; the user can always orbit, zoom, and pan.",
  ),
  ground: z
    .boolean()
    .optional()
    .describe(
      "Show a reference grid on the floor plane (y=0). Default true. Set false for objects floating in space (data sculptures).",
    ),
  background: SceneBackgroundSchema.optional().describe(
    "'auto' fills the scene with the canvas surface color and adapts to light/dark; 'transparent' lets the card behind show through. Default 'auto'.",
  ),
  height: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Viewport height in pixels. Default 420. Use 560 for a hero scene, 320 for compact."),
  autoRotate: z
    .boolean()
    .optional()
    .describe("Slowly orbit the camera so the 3D reads at a glance. Default false."),
  title: z.string().optional(),
});

export const Scene3DDefinition = {
  props: Scene3DPropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: orbitable 3D scaffolds the user can rotate, zoom, and pan — room and floor-plan layouts, architecture massing, spatial arrangements, physical-system sketches, and data sculptures. Compose primitives (box/sphere/cylinder/plane/text) in one coordinate space and label the key parts. DO NOT USE FOR: 2D charts (use Chart), node-edge or flow diagrams (use MermaidEditor), or precise CAD — this is an expressive spatial sketch, not an engineering model.",
  example: {
    title: "Reading nook — spatial sketch",
    height: 460,
    autoRotate: true,
    camera: { position: [7, 6, 9], lookAt: [0, 0.9, 0] },
    objects: [
      { kind: SceneObjectKind.Plane, position: [0, 0.01, 0], size: [6, 6, 1], rotation: [-90, 0, 0], color: "#d9d2c5" },
      { kind: SceneObjectKind.Plane, position: [1, 0.03, 1], size: [2.4, 1.6, 1], rotation: [-90, 0, 0], color: "#b98a4b", opacity: 0.9, label: "Rug" },
      { kind: SceneObjectKind.Box, position: [0, 1.4, -3], size: [6, 2.8, 0.12], color: "#c9c1b0" },
      { kind: SceneObjectKind.Box, position: [-3, 1.4, 0], size: [0.12, 2.8, 6], color: "#d0c8b7" },
      { kind: SceneObjectKind.Box, position: [1, 0.75, 1], size: [1.6, 0.1, 0.9], color: "#7a4a24", label: "Table" },
      { kind: SceneObjectKind.Cylinder, position: [1, 0.35, 1], size: [0.14, 0.7, 0.14], color: "#5c3617" },
      { kind: SceneObjectKind.Box, position: [1, 0.45, 1.9], size: [0.5, 0.9, 0.5], color: "#4f6d5a", label: "Chair" },
      { kind: SceneObjectKind.Box, position: [1, 0.45, 0.1], size: [0.5, 0.9, 0.5], color: "#4f6d5a" },
      { kind: SceneObjectKind.Cylinder, position: [-2, 0.9, -2], size: [0.18, 1.8, 0.18], color: "#3b3a36" },
      { kind: SceneObjectKind.Sphere, position: [-2, 1.95, -2], size: [0.45, 0, 0], color: "#ffd9a0", label: "Lamp" },
      { kind: SceneObjectKind.Text, position: [0, 3.2, -2.9], label: "Reading Nook" },
    ],
  },
};
