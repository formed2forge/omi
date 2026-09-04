# Local emulator manual QA runbook

## Daily dev (30 seconds)

```bash
cp backend/.env.local-dev.template backend/.env.local-dev  # once
# set OPENAI_API_KEY, DEEPGRAM_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY
make dev-desktop
```

`make dev-desktop` starts emulators + backends, auto-seeds `happy_path`, and launches **Omi Dev** signed in as `alice`. Override user: `make desktop-run-local DESKTOP_USER=bob`.

Offline (no API keys): `PROVIDER_MODE=offline make dev-desktop`

### Harness-injected defaults (do not put in `.env.local-dev`)

| Setting | Value |
|---------|-------|
| Firebase project | `demo-omi-local` |
| Firestore database | `(default)` |
| Firestore emulator | `127.0.0.1:8085` |
| Auth emulator | `127.0.0.1:9099` |
| Redis | `127.0.0.1:6380` |
| Python API | `http://127.0.0.1:8000` |
| Rust desktop API | `http://127.0.0.1:10201` |
| Encryption / admin | harness test values (not prod) |

Non-secret keys in `backend/.env.local-dev` are **ignored** — see `make dev-status` for warnings.

### Seeded users

| Profile | Email | Password |
|---------|-------|----------|
| `alice` (default) | `alice@local.omi.invalid` | `alice-local-password-030` |
| `bob` | `bob@local.omi.invalid` | `bob-local-password-030` |
| `local_default_user` | `local_default_user@local.omi.invalid` | `local_default_user-local-password-030` |

Pricing / subscription fixtures are a separate kind (`make list-pricing-scenarios`). Those users use `{uid}-local-password-pricing`. See [PRICING_SCENARIOS.md](../../../scripts/dev-harness/PRICING_SCENARIOS.md).

### Pricing / Settings QA

```bash
PROVIDER_MODE=offline make dev-up
make seed-pricing-scenario SCENARIO=plan_catalog_matrix
make desktop-run-local DESKTOP_APP_NAME=omi-pricing DESKTOP_USER=pricing_plus
```

The harness stubs `price_local_*` Stripe catalog rows so Settings can recover Plus / Pro from `current_price_id` even though the wire still says `plan=unlimited`. Do not treat an empty `available_plans` list as a fixture bug — that is live Stripe being unreachable; the stub is the local fix.

Other pricing scenario names: `make list-pricing-scenarios`

### Useful commands

```bash
make dev-init      # one-time backend/.venv setup + template copy
make dev           # services + auto-seed
make dev-status    # endpoints, provider mode, seeded users
make dev-verify    # signed-in check + chat smoke + no aud errors
make dev-down      # stop harness processes
```

For perf testing with a release Rust binary: `OMI_DESKTOP_BACKEND_RELEASE=1 make dev`

---

<details>
<summary>Evidence class / activation framing (QA agents)</summary>

This workflow is for local product-use/manual QA only. It emits `LOCAL_EMULATOR_DEV` metadata and is not dev-cloud proof, production proof, IAM proof, deployed-index proof, telemetry proof, rollback proof, or activation evidence.

### Happy path (explicit steps)

```bash
make dev-up
make seed-memory-scenario SCENARIO=happy_path   # optional; dev-up auto-seeds on first run
make desktop-run-local DESKTOP_USER=alice
make dev-status
make dev-summary
```

The harness supplies instance-scoped filesystem storage for every backend `BUCKET_*` binding. Speech profiles,
conversation audio, and file uploads stay under `.local/dev-harness/<instance>/services/storage` and do not require
or use Google Cloud credentials.

Use offline providers for provider-independent debugging:

```bash
PROVIDER_MODE=offline make dev-up
PROVIDER_MODE=offline make dev-status
```

### Fail-closed scenario

```bash
make seed-memory-scenario SCENARIO=kill_switch
make dev-status
make desktop-run-local DESKTOP_USER=alice
```

Other scenario names: `make list-memory-scenarios`

### Reset

```bash
make dev-reset
```

Reset only clears sentinel-owned local harness state. It does not delete provider logs or provider-retained data from real external processors.

### Session summary labels

- `evidence_class: LOCAL_EMULATOR_DEV`
- `activation_eligible: false`
- `watermark: NOT_ACTIVATION_EVIDENCE`

Protected collection `before_digest`/`after_digest` fields remain `null` until live emulator instrumentation is wired; do not treat as dev-cloud or production no-write proof.

</details>
