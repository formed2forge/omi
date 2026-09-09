#!/usr/bin/env python3
"""Reset a named synthetic local pricing emulator scenario."""

from __future__ import annotations

import os
import sys

from dev_harness.pricing_scenarios import main

if __name__ == "__main__":
    scenario = os.environ.get("SCENARIO") or (sys.argv[1] if len(sys.argv) > 1 else "plan_catalog_matrix")
    extra = sys.argv[2:] if len(sys.argv) > 2 else []
    raise SystemExit(main(["reset", scenario, *extra]))
