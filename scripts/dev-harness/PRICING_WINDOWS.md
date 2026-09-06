# Windows pricing QA recipe

## Current support boundary

The Windows Electron app currently signs in through the production-mediated
Apple/Google OAuth flow. It does not have the iOS local **Sign In (Developer)**
path or a Firebase Auth emulator connection. Therefore a Windows run cannot
currently authenticate a synthetic `pricing_*` user against the local Auth
emulator and cannot provide a full local pricing-catalogue acceptance result.

The local harness can still be used from Windows for fixture validation and
REST checks, while the interactive pricing UI pass is currently supported on
iOS and macOS.

## 1. Start and seed the Mac harness

Run this on the Mac hosting the emulators:

```bash
cd /Volumes/LEXAR/tempdev/omi
PROVIDER_MODE=offline make dev-up
make dev-status
make seed-pricing-scenario SCENARIO=plan_catalog_matrix
```

The Windows machine must be able to reach the Mac's Python API if you are
testing any non-authenticated REST route. Do not point the Windows app at the
local API and expect OAuth tokens from `based-hardware` to work with the
`demo-omi-local` emulator project.

## 2. Run the Windows app's supported local checks

On Windows, use Node 22 and pnpm 10:

```powershell
cd desktop\windows
nvm use
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm run typecheck
pnpm test
pnpm run dev
```

`pnpm run dev` is useful for Windows layout and Settings rendering checks, but
its normal sign-in remains the cloud OAuth flow. `OMI_E2E_FAKE_AUTH=1` is only a
hermetic UI-test seam; it does not load live pricing fixtures.

## 3. Verify the fixture data from the harness

Use the Mac or a machine with the repository checkout to validate the seeded
catalogue and scenario manifests:

```bash
make list-pricing-scenarios
make seed-pricing-scenario SCENARIO=legacy_and_unknown_plan_resilience
make seed-pricing-scenario SCENARIO=cancellation_and_downgrade_safety
```

For a full Windows pricing UI pass, add a Windows local-emulator sign-in path
that exchanges `/v1/auth/local-dev/custom-token`, then update this recipe.

## 4. Clean up

On the Mac:

```bash
make reset-pricing-scenario SCENARIO=plan_catalog_matrix
make dev-down
```

