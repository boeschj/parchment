# 3D scenes (Scene3D)

`Scene3D` sketches an orbitable 3D layout the user can rotate, zoom, and pan —
room and floor-plan scaffolds, architecture massing, physical arrangements, or
data sculptures. Compose primitives in one coordinate space (meters, **y is up**,
ground grid at y=0) and label the parts that matter. Keep the vocabulary small:
`box` (walls/tables/furniture), `plane` (floors/rugs — lay flat with rotation
`[-90, 0, 0]`), `cylinder` (columns/legs/posts), `sphere` (nodes/bulbs), `text`
(a floating caption at its own position). Rest a shape of height `h` on the floor
by centering it at `y = h/2`. Rotation is in **degrees**. Colors are hex; the
scene background and grid adapt to light/dark on their own. Reach for `Chart`
instead for 2D data and `MermaidEditor` for node-edge diagrams — Scene3D is a
spatial sketch, not a chart or a CAD model.

Props: `objects: [{kind: box/sphere/cylinder/plane/text, position [x,y,z], size?,
rotation? (degrees), color?, label?, opacity?}], camera?, ground?, background?
auto/transparent, height?, autoRotate?, title?`.

```json
{
  "root": "room",
  "elements": {
    "room": {
      "type": "Scene3D",
      "props": {
        "title": "Booth layout", "height": 460, "autoRotate": true,
        "camera": {"position": [7, 6, 9], "lookAt": [0, 0.9, 0]},
        "objects": [
          {"kind": "plane", "position": [0, 0, 0], "size": [6, 6, 1], "rotation": [-90, 0, 0], "color": "#d9d2c5"},
          {"kind": "box", "position": [0, 1.4, -3], "size": [6, 2.8, 0.12], "color": "#c9c1b0", "label": "Banner wall"},
          {"kind": "box", "position": [0, 0.5, 0], "size": [2, 1, 1], "color": "#7a4a24", "label": "Demo desk"},
          {"kind": "cylinder", "position": [-2, 0.9, -2], "size": [0.18, 1.8, 0.18], "color": "#3b3a36"},
          {"kind": "sphere", "position": [-2, 1.95, -2], "size": [0.4, 0, 0], "color": "#ffd9a0", "label": "Light"}
        ]
      },
      "children": []
    }
  }
}
```
