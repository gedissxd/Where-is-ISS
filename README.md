# Where is the ISS? 🛰️

A real-time tracker for the International Space Station, with a space theme.

- Interactive 3D globe ([globe.gl](https://globe.gl), NASA Blue Marble imagery) with the ISS floating at its real altitude
- Pulsing rings showing the area of Earth the ISS can see
- Orbit path: the last 45 min (solid) and the next 45 min (dashed, animated)
- Live altitude, velocity, daylight/eclipse status and footprint, in km or miles
- The country the ISS is currently over (reverse geocoding)
- Animated starfield background
- Responsive layout that works on phones

No build step. Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

Data from [Where the ISS At](https://wheretheiss.at/). Geocoding by [Nominatim](https://nominatim.openstreetmap.org/).
