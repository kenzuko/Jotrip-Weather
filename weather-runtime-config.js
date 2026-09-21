// JoTrip Weather canonical runtime registry.
// Production consumers must read same-origin normalized runtime only.
// Upstream repositories, branches, raw GitHub URLs and legacy mirrors belong to backend sync only.
window.JOTRIP_WEATHER_RUNTIME = Object.freeze({
  version: "JOTRIP_WEATHER_RUNTIME_V1",
  manifest: "/data/weather-runtime/manifest.json",
  cloud: "/data/weather-runtime/cloud.json",
  compact: "/data/weather-runtime/compact.json",
  current: "/data/weather-runtime/current.json",
  forecast: "/data/weather-runtime/forecast.json",
  marine: "/data/weather-runtime/marine.json",
  meta: "/data/weather-runtime/meta.json"
});
