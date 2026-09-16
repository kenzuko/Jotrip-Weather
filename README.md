# JoTrip Weather Lab

Standalone public dashboard for JoTrip Weather Lab.

- Production domain: `https://weather.openphuquoc.com`
- UI repository: `kenzuko/Jotrip-Weather`
- Weather data engine: `kenzuko/Jotrip-Lab`, branch `feat/weather-lab-data-engine-v1`
- GitHub Pages publishes `main` from `/ (root)`.
- Live Weather JSON is read directly from the data engine with `cache: no-store`.
- If the raw GitHub Weather JSON endpoint fails, the standalone data bridge retries through the GitHub Contents API.
- Static UI dependencies are pinned to source commit `fa2b76f35cb1b8031023c95508246ceee484152c` so data updates cannot unexpectedly change the public interface.
- Legacy `/weather.html` and `/weather/` URLs redirect to the production root.
- `.github/workflows/qa.yml` validates the static contract and live Weather data on every push and every 6 hours.

The public site intentionally does not duplicate the collector/model pipeline. Data-engine development remains in `Jotrip-Lab`; this repository is the public presentation layer.
