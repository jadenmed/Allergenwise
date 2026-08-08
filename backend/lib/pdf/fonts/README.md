# Certificate PDF Fonts

Crimson Text is embedded locally so certificate PDF generation works in offline
and restricted-network environments (e.g., Vercel cold starts without outbound
font fetches).

## Files

| File | Weight | Style | Source URL |
|------|--------|-------|------------|
| `CrimsonText-Regular.ttf` | 400 | normal | https://fonts.gstatic.com/s/crimsontext/v19/wlp2gwHKFkZgtmSR3NB0oRJvaA.ttf |
| `CrimsonText-SemiBold.ttf` | 600 | normal | https://fonts.gstatic.com/s/crimsontext/v19/wlppgwHKFkZgtmSR3NB0oRJXsCx2Cw.ttf |
| `CrimsonText-Italic.ttf` | 400 | italic | https://fonts.gstatic.com/s/crimsontext/v19/wlpogwHKFkZgtmSR3NB0oRJfaghW.ttf |

## License

Crimson Text is licensed under the SIL Open Font License v1.1.  
See `LICENSE.txt` in this directory.  
Copyright 2010 Sebastian Kosch.

## Version

Google Fonts v19 (fetched 2026-05-07). To update, re-download from the URLs above
and regenerate the CSS via:

    curl "https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;1,400" -H "User-Agent: Mozilla/5.0"
