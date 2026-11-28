# Image prompts for Smaragdus

Prompts for an image generator (Numa, Orée, Coda). They are in English because the generators follow it better.
Common rules: no text, no letters, no watermark, no border, flat black or transparent background as said below.

## 1. Camp logos (priority)

Where they appear: next to each planet (20 px), on the big slider (38 px), in front of the scribes' chronicles (30 px),
on the player card (34 px). They must stay readable at 20 px: a bold silhouette, few details, no thin lines.
Colours in the page: gold `#e6c36a` for the Loyalists, red `#e0452f` for the Renegades. Ask for a single flat colour:
the page recolours the file.

### Loyalists: imperial eagle

```
Heraldic emblem of a double-headed imperial eagle, wings raised in a symmetrical V, two heads in profile looking
left and right, stylised feathers cut as bold angular blades, a small cross-shaped shield on the chest, tail
spread as a fan, talons down. Grimdark gothic military insignia, Warhammer 30,000 Horus Heresy Imperium of Man
style, solid flat silhouette in one single colour (gold #e6c36a), thick shapes, no thin lines, no gradient, no
shading, centred, perfectly symmetrical, transparent background, vector style, 1024x1024.
Negative: text, letters, border, frame, background scenery, shadow, 3D, realistic feathers, multiple colours.
```

Variant (simpler, if the first one is too detailed at 20 px):

```
Minimal pictogram of an imperial eagle with raised wings, one head in profile, solid single colour gold silhouette,
very bold geometric shapes, readable at 20 pixels, grimdark gothic style, transparent background, 1024x1024.
```

### Renegades: eye of Horus

```
Heraldic emblem of the Eye of Horus from the Horus Heresy: a stylised almond-shaped eye with a large round iris
and a small pupil, a vertical tear line falling below the eye and two short diagonal strokes beside it, thick
carved strokes like a brand or a seal. Grimdark rebel insignia, Warhammer 30,000 Sons of Horus and Luna Wolves
style, solid flat silhouette in one single colour (red #e0452f), thick shapes, no thin lines, no gradient, no
shading, centred, symmetrical, transparent background, vector style, 1024x1024.
Negative: text, letters, border, frame, background scenery, shadow, 3D, realistic eye, eyelashes, multiple colours.
```

Variant:

```
Minimal pictogram of an almond eye with a round iris and a falling tear stroke, solid single colour red silhouette,
very bold geometric shapes, readable at 20 pixels, grimdark gothic style, transparent background, 1024x1024.
```

What to send back: PNG with transparent background, or SVG if the tool can export it. Name them `public/img/deco/logo-loyalist.png`
and `public/img/deco/logo-renegade.png` (I will plug them in place of the drawn icons).

## 2. Planet portraits

Common format: square 1024x1024, WebP, close-up of a round planet centred on a flat black background (the edge must stay
sharp, the page fades it), light from the left, no ship, no text, dark illustration in the Warhammer 30,000 style.
File names: `public/img/planets/<id>.webp`.

| File | Prompt to add to the common format |
|---|---|
| `grus.webp` | imperial world, administrative capital seen from orbit, continents covered with golden city lights, grey steel oceans, austere vast cities |
| `phoenix.webp` | too-perfect biosphere, lush green continents, white mist, a few discreet crystalline laboratory structures, an unsettling calm eden |
| `leo.webp` | fortress world, rocky hostile planet lit by a green sun, chains of bastions and orbital cannons visible on the surface |
| `cancer.webp` | shipyard world, grey industrial planet, rings of docks and ship hulls in orbit, sky streaked with foundry flames, a violet warp rift on one edge |
| `unicornis.webp` | feudal arsenal world, plains and fortified castles, smoking workshop towns, ochre and copper tones |
| `scorpius.webp` | dead world, cracked grey sphere, craters, no atmosphere, red glows of distant artillery |
| `draco.webp` | small blue-black planet, a large research complex in orbit, pale green reflections |

## 3. Map ships (optional)

Top view, 128x128, transparent background, one flat colour so the page can recolour them, 3 variants each:

```
Tiny imperial cruiser seen from above, angular gothic hull, single flat gold silhouette, transparent background.
```

```
Tiny renegade cruiser seen from above, jagged spiked hull, single flat red silhouette, transparent background.
```
