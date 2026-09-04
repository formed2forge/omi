#!/usr/bin/env python3
"""List synthetic local pricing emulator scenarios."""

from __future__ import annotations

from dev_harness.pricing_scenarios import main

if __name__ == "__main__":
    raise SystemExit(main(["list"]))
