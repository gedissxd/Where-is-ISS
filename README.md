# Where is the ISS? 🛰️

A real-time tracker for the International Space Station, with a space theme.

- Live interactive map (Leaflet + dark CARTO tiles) with the ISS marker and its visibility footprint
- Ground track: the last 45 min of orbit (solid) and the next 45 min (dashed)
- Live altitude, velocity, daylight/eclipse status and footprint, in km or miles
- The country the ISS is currently over (reverse geocoding)
- Animated, interactive starfield background
- Responsive layout that works on phones

No build step. Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

Data from [Where the ISS At](https://wheretheiss.at/). Geocoding by [Nominatim](https://nominatim.openstreetmap.org/).
