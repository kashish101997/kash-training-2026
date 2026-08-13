# Kash OS Health Sync Shortcut

Kash OS is a web app and cannot access HealthKit directly. The **Kash OS Health Sync** Shortcut is a user-run bridge: Apple’s Shortcuts app asks Health for the samples you approve, then sends only supported summaries to Kash OS.

## Import from Apple Health

Create a Shortcut named **Kash OS Health Sync** with these actions:

1. Choose from Menu: `Import Health` or `Write to Health`.
2. For **Import Health**, use “Find Health Samples” once for each approved type:
   - Weight
   - Body Fat Percentage
   - Lean Body Mass
   - Body Mass Index
   - Waist Circumference
   - Height
   - Blood Glucose
3. Limit each query to samples created since the last successful run. For every result, include its Health sample UUID and start date.
4. Build JSON matching this example:

```json
{
  "samples": [
    {
      "uuid": "HEALTH-SAMPLE-UUID",
      "timestamp": "2026-08-13T06:30:00+05:30",
      "weightKilograms": 94.6
    },
    {
      "uuid": "ANOTHER-HEALTH-SAMPLE-UUID",
      "timestamp": "2026-08-13T06:31:00+05:30",
      "type": "blood_glucose",
      "value": 96,
      "context": "fasting"
    }
  ]
}
```

5. Use “Get Contents of URL”:
   - URL: `https://kash-strap.vercel.app/api/health/shortcut`
   - Method: POST
   - Request body: JSON from step 4
   - Header: `Authorization: Bearer YOUR_HEALTH_SHORTCUT_TOKEN` when the server token is configured.
6. Save the successful run date in a Shortcut variable or local file.

Kash OS deduplicates imported Health samples using the Health sample UUID. Unsupported chest, hip, thigh, arm, calf, and neck measurements stay “Kash OS only.”

## Write a Kash OS measurement to Health

The **Write latest weight to Health** button launches this Shortcut with a Base64-encoded JSON input. Decode the input, inspect the proposed measurement, ask for confirmation, then use “Log Health Sample” for the supported fields. Never log a value without showing it first.

This bridge does not run in the background, does not bypass Health permissions, and is not medical software.
