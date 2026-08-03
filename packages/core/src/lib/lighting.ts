export type LightingCircuitState = { readonly enabled: boolean } | null | undefined

export type LightingFixtureState = {
  readonly circuitId: string | null
  readonly enabled: boolean
}

export function resolveLightingFixtureEnabled(
  fixture: LightingFixtureState,
  circuit: LightingCircuitState,
): boolean {
  if (!fixture.enabled) return false
  if (!fixture.circuitId) return true
  return circuit?.enabled === true
}

export function lumensToCandela(lumens: number): number {
  return Math.max(0, lumens) / (4 * Math.PI)
}

export function spotLumensToCandela(lumens: number, beamAngleDegrees: number): number {
  const halfAngle = (Math.max(1, Math.min(179, beamAngleDegrees)) * Math.PI) / 360
  const solidAngle = 2 * Math.PI * (1 - Math.cos(halfAngle))
  return Math.max(0, lumens) / Math.max(solidAngle, 0.0001)
}

export function kelvinToRgb(kelvin: number): readonly [number, number, number] {
  const temperature = Math.max(1000, Math.min(20_000, kelvin)) / 100
  let red: number
  let green: number
  let blue: number

  if (temperature <= 66) {
    red = 255
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661
    blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307
  } else {
    red = 329.698727446 * (temperature - 60) ** -0.1332047592
    green = 288.1221695283 * (temperature - 60) ** -0.0755148492
    blue = 255
  }

  const channel = (value: number) => Math.round(Math.max(0, Math.min(255, value)))
  return [channel(red), channel(green), channel(blue)]
}
