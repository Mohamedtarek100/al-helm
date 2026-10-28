/**
 * Biometric capability, isolated behind one module.
 *
 * The plugin (`@aparajita/capacitor-biometric-auth`) is Android/iOS-only and is
 * loaded lazily, so the web build and unit tests never import native code.
 * Every failure mode resolves to "unavailable" rather than throwing, which is
 * what lets the app offer a clean PIN-only path on unsupported devices.
 */

export interface BiometricSupport {
  available: boolean
  /** Human-readable strength, for copy only. Never used for a security decision. */
  strength: 'none' | 'weak' | 'strong' | 'unknown'
}

const UNAVAILABLE: BiometricSupport = { available: false, strength: 'none' }

export async function checkBiometricSupport(): Promise<BiometricSupport> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return UNAVAILABLE
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth')
    const info = await BiometricAuth.checkBiometry()
    if (!info?.isAvailable) return UNAVAILABLE
    // `strongBiometryIsAvailable` distinguishes a hardware-backed enrolment.
    const strong = 'strongBiometryIsAvailable' in info && Boolean((info as { strongBiometryIsAvailable?: boolean }).strongBiometryIsAvailable)
    return { available: true, strength: strong ? 'strong' : 'weak' }
  } catch {
    return UNAVAILABLE
  }
}

/**
 * Prompts for biometric authentication.
 * Returns true only when the OS confirmed success.
 */
export async function authenticateWithBiometrics(reason: string, cancelTitle: string): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return false
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth')
    await BiometricAuth.authenticate({ reason, cancelTitle, allowDeviceCredential: false })
    return true
  } catch {
    return false
  }
}
