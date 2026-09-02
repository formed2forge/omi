// Hermetic guard for the Linux RPM packaging contract.
//
// electron-builder `rpm.depends` REPLACES its v26 default runtime set
// (gtk3/nss/libnotify/…) rather than appending. Dropping that list would
// ship an RPM that installs on Fedora but fails to launch. The OCR/xprop
// extras must keep Fedora/RHEL names, not the Debian ones used by `deb`.
//
// This asserts the production config object (imported, not a source scrape).
// The packaged proof is CI `rpm -qpR` / `rpm -qpl` after `pnpm build:linux`.
import { describe, it, expect } from 'vitest'
import builderConfig from '../electron-builder.config.mjs'
import {
  LINUX_PRODUCT_NAME,
  WINDOWS_PRODUCT_NAME,
  resolveElectronBuilderProductName
} from './electron-builder-product-name.mjs'

const RPM_RUNTIME_DEFAULTS = [
  'gtk3',
  'libnotify',
  'nss',
  'libXScrnSaver',
  '(libXtst or libXtst6)',
  'xdg-utils',
  'at-spi2-core',
  '(libuuid or libuuid1)'
]

const RPM_OMI_EXTRAS = ['tesseract', 'tesseract-langpack-eng', '(xprop or xorg-x11-utils)']

describe('Linux RPM packaging', () => {
  it('uses a space-free productName for Linux so /opt install paths are rpm-safe', () => {
    expect(LINUX_PRODUCT_NAME).not.toMatch(/\s/)
    expect(resolveElectronBuilderProductName(['node', 'electron-builder', '--linux'])).toBe(
      LINUX_PRODUCT_NAME
    )
    expect(resolveElectronBuilderProductName(['node', 'electron-builder', '--win'])).toBe(
      WINDOWS_PRODUCT_NAME
    )
    // Vitest imports the config without --linux, so the default export keeps
    // the Windows display name; packaging argv selects Linux at pack time.
    expect(builderConfig.productName).toBe(WINDOWS_PRODUCT_NAME)
  })

  it('includes rpm next to AppImage and deb', () => {
    expect(builderConfig.linux.target).toEqual(['AppImage', 'deb', 'rpm'])
  })

  it('keeps electron-builder RPM runtime depends and adds Fedora OCR/xprop extras', () => {
    const depends = builderConfig.rpm.depends
    expect(depends).toEqual([...RPM_RUNTIME_DEFAULTS, ...RPM_OMI_EXTRAS])
  })

  it('does not copy Debian package names into rpm.depends', () => {
    const depends = builderConfig.rpm.depends
    // Exact names — `xorg-x11-utils` is the older-RHEL RPM package, not Debian's `x11-utils`.
    expect(depends).not.toContain('tesseract-ocr')
    expect(depends).not.toContain('tesseract-ocr-eng')
    expect(depends).not.toContain('x11-utils')
    expect(depends).not.toContain('libxss1')
    expect(depends).not.toContain('libnotify4')
  })

  it('recommends tray + portal front-end via fpm rpm tags (RpmOptions has no recommends)', () => {
    expect(builderConfig.rpm.fpm).toEqual([
      '--rpm-tag=Recommends: libappindicator-gtk3',
      '--rpm-tag=Recommends: xdg-desktop-portal'
    ])
  })
})
