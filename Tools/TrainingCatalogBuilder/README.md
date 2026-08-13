# Private training catalog builder

This generator reads the local HTML and purchased/reference PDFs, writes a versioned catalog with
stable plan/session IDs, and records source hashes plus week/session counts in a private audit file.
Neither the PDFs nor generated catalog are tracked by Git.

Run from the repository root with a Python environment containing `pdfplumber` and `pypdf`:

```sh
python3 Tools/TrainingCatalogBuilder/build_catalog.py
```

The Ben Parkes 5K, Level 1, and Level 3 kilometer tables are image-only. The builder renders only
their plan pages with Poppler and OCRs them locally with Tesseract. Review
`PrivateTrainingContent/TrainingCatalog.audit.json`, then import each plan as an encrypted Neon
entity:

The current HYROX plan is loaded from the ignored
`PrivateTrainingContent/HyroxMumbai2026.plan.json` override and verified against the ignored
`HYROX Plan.pdf`. It replaces the expired HYROX schedule while retaining the stable
`hyrox-current` plan ID.

```sh
npm run catalog:import
```

The authenticated `/api/training/catalog` endpoint serves the private catalog to the web app. Source
PDFs and generated JSON never enter the public repository or the static PWA cache.
