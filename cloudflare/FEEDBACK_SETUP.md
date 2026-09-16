# Weather field feedback storage

The public UI sends qualitative field observations to `POST /feedback` on the existing `jotrip-weather-live` Worker.

## D1 setup

1. Create a Cloudflare D1 database named `jotrip-weather-feedback`.
2. Run `cloudflare/schema.sql` against that database.
3. In Worker `jotrip-weather-live` -> Settings/Bindings, add a D1 binding:
   - Variable name: `WEATHER_FEEDBACK`
   - Database: `jotrip-weather-feedback`
4. Save/deploy the Worker.
5. Verify `/feedback/health` returns `{"ok":true,"store":"D1_READY"}`.

## Scientific use policy

- Public feedback is field observation, not calibrated ground truth.
- V1 always stores `calibration_eligible = 0` even when the reporter selects "Có thiết bị đo".
- Feedback may be used for qualitative error discovery and case review.
- Future calibration requires separately verified numeric observations with provenance and timestamp matching.
- The Worker does not store IP address, name, phone number, or other requested identity fields.
