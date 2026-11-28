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

Where they appear: as half a disc on the right of the pop-in of a planet (players and admin). File names: `public/img/planets/<id>.webp`.
Format: square 1024x1024, WebP, one round planet in close-up, centred, filling about 85% of the width, on a flat pure black
background (the page fades the edge). Light from the left, a thin bright atmosphere rim on the lit side.

Important: a player sees this picture before the nature of the world is revealed. So each prompt shows an atmosphere, never the
secret: no readable structure, no hint of the true nature.

Shared block to put at the end of every planet prompt:

```
Round planet in close-up, centred, on a flat pure black background, lit from the left with a thin bright atmospheric rim, painterly dark sci-fi illustration, Warhammer 30,000 Horus Heresy mood, high detail on the surface, no ships, no stations, no text, no border, 1024x1024.
Negative: text, letters, frame, space scenery, stars in the background, other planets, moons, spaceships, cartoon style.
```

| File | Prompt (then add the shared block) |
|---|---|
| `grus.webp` | A temperate imperial world seen from high orbit: wide continents with a few faint clusters of warm golden lights on the night side, large calm steel-grey oceans, thin high clouds. No visible roads or buildings, only the glow of distant cities. |
| `phoenix.webp` | A strikingly pristine world: deep green forests and coastal plains, white swirling cloud banks, turquoise shallow seas, a ring of faint asteroid dust reflected on the atmosphere. Serene, almost too perfect. |
| `leo.webp` | A scorched rocky world swept by solar storms: orange-brown crust, long dark fault lines, thin green aurora crackling around the atmosphere, hot glare on the lit side. Hostile and harsh. |
| `cancer.webp` | A heavy grey-brown world with a dusty polluted atmosphere, faint orange glows scattered across the night side, a violet ragged tear of light bleeding in from one edge of the sphere. Uneasy and unstable. |
| `unicornis.webp` | A windswept world of ochre and rust-coloured steppes and dark mountain ranges, thin brownish smoke columns rising in lines from the plains, copper tint under a warm sun. |
| `scorpius.webp` | A dead grey sphere, cratered and cracked like old ceramic, no atmosphere, a few small dull red flashes scattered on the surface far apart, cold hard shadows. |
| `draco.webp` | A small dark blue-black world with a faint pale green reflection on its surface, calm and mysterious, thin wisps of silver cloud, almost like a polished stone. |

## 3. Map ships

Where they appear: tiny sprites that orbit the planets and cross the map (7 to 14 px on screen; they are tiny, so the silhouette must
read instantly). The page can recolour a flat single-colour shape, so ask for single-colour silhouettes. Delivery: transparent PNG
128x128 or SVG, pointing to the right, i.e. the nose faces east. Names: `public/img/deco/ship-loyalist-1..3.png` and `ship-renegade-1..3.png`.

### Loyalist ships (gold)

```
Top-down silhouette of a small imperial warship, pointing right, long angular gothic hull with a pointed prow, a wider armoured midsection with two short side sponsons, a stepped stern with a single large engine block, symmetrical. Grimdark gothic Imperium of Man style, Warhammer 30,000 naval vessel. Solid flat single-colour silhouette (gold #e6c36a), bold shapes, no internal detail lines thinner than 3 pixels, no gradient, no shading, transparent background, 128x128.
Negative: text, markings, shadow, 3D render, multiple colours, background, star field.
```

Make 3 variants by changing the first words: "a small imperial frigate", "a small imperial cruiser with a long dorsal spine", "a small imperial escort with a swept-back wing profile".

### Renegade ships (red)

```
Top-down silhouette of a small renegade warship, pointing right, jagged asymmetrical hull with a bladed prow, spiked ridges along the flanks, a notched stern with twin engine nozzles, corrupted and aggressive profile. Grimdark Horus Heresy traitor legion style, Warhammer 30,000 naval vessel. Solid flat single-colour silhouette (red #e0452f), bold shapes, no internal detail lines thinner than 3 pixels, no gradient, no shading, transparent background, 128x128.
Negative: text, markings, shadow, 3D render, multiple colours, background, star field.
```

Variants: "a small renegade frigate with a hooked prow", "a small renegade cruiser covered in spikes", "a small renegade raider with forward-swept blades".

### Ships in transit (neutral, for the players who still hold points to invest)

```
Top-down silhouette of a tiny scout shuttle pointing right, slender pointed hull with small swept fins and a single engine, solid flat single colour (pale blue-white #cfe8ff), transparent background, 128x128.
```

## 4. Banners (flags planted on the planets)

Where they appear: tiny flags above a planet, one per tier won (13 px on screen). They must read as "a flag on a pole" and keep the
camp colour. Delivery: transparent PNG 128x128 or SVG, pole on the left, banner waving to the right.
Names: `public/img/deco/banner-loyalist.png` and `banner-renegade.png`.

### Loyalist banner

```
A small imperial war banner on a slim pole, planted upright, the cloth is a long vertical pennant with a swallow-tail bottom edge, slightly waving to the right, a tiny stylised eagle emblem on the cloth, a small finial at the top of the pole. Grimdark gothic Imperium of Man style, Warhammer 30,000. Solid flat single-colour silhouette (gold #e6c36a) with the eagle emblem cut out of the cloth, bold shapes, no gradient, no shading, transparent background, 128x128.
Negative: text, letters, shadow, 3D, multiple colours, background, ground.
```

### Renegade banner

```
A small renegade war banner on a slim spiked pole, planted upright, the cloth is a ragged torn vertical pennant with a jagged bottom edge, waving to the right, a tiny stylised eye emblem on the cloth, a bladed finial at the top of the pole. Grimdark Horus Heresy traitor legion style, Warhammer 30,000. Solid flat single-colour silhouette (red #e0452f) with the eye emblem cut out of the cloth, bold shapes, no gradient, no shading, transparent background, 128x128.
Negative: text, letters, shadow, 3D, multiple colours, background, ground.
```

## 5. Optional extras

- **Smoke clouds** (over the fighting): `Soft grey smoke cloud, billowing, top-down view, semi-transparent, black background removed, 256x256` (3 variants).
- **Bomb flash**: `Bright orange and white explosion flash seen from above, circular blast, transparent background, 256x256`.
- **Scorch mark**: `Black scorched crater with a faint orange glow at the edge, seen from above, soft edges, transparent background, 256x256`.
