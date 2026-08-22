import { describe, expect, it } from 'vitest'
import {
  buildFill,
  buildRowFill,
  densityOf,
  edgeTones,
  edgeTonesRow,
  glyphFor,
  neighbour,
  RAMP,
  seededRandom,
} from './ascii-art'

/** Fixed sequence, so a test never depends on how many draws the code makes. */
const constantRandom = (value: number) => () => value

describe('densityOf', () => {
  it('runs from solid to blank across the ramp', () => {
    expect(densityOf('$')).toBe(1)
    expect(densityOf(' ')).toBe(0)
  })

  it('treats a character outside the ramp as blank', () => {
    expect(densityOf('é')).toBe(0)
  })
})

describe('glyphFor', () => {
  it('round-trips a ramp character through its own density', () => {
    for (const char of RAMP) {
      expect(glyphFor(densityOf(char))).toBe(char)
    }
  })

  it('clamps rather than returning undefined off either end', () => {
    expect(glyphFor(4)).toBe('$')
    expect(glyphFor(-4)).toBe(' ')
  })
})

describe('neighbour', () => {
  it('moves exactly one step along the ramp', () => {
    const i = RAMP.indexOf('W')
    expect(neighbour('W', constantRandom(0))).toBe(RAMP[i - 1])
    expect(neighbour('W', constantRandom(0.9))).toBe(RAMP[i + 1])
  })

  it('reflects at both ends instead of staying put', () => {
    // The heaviest glyph has no heavier neighbour and the lightest has no
    // lighter one; both still have to change, or the ends of the ramp would
    // flicker at half the rate of the middle.
    expect(neighbour('$', constantRandom(0))).toBe(RAMP[1])
    expect(neighbour(' ', constantRandom(0.9))).toBe(RAMP[RAMP.length - 2])
  })

  it('gives up on a character it cannot place', () => {
    expect(neighbour('é', constantRandom(0))).toBeUndefined()
  })
})

describe('edgeTones', () => {
  it('reports one tone per row', () => {
    expect(edgeTones(['$$$$', '    ', '....']).length).toBe(3)
  })

  it('reads darker rows as heavier', () => {
    // Far enough apart that the ±2 smoothing window does not span both. Two
    // adjacent rows would average into each other and come back identical,
    // which is the smoothing working, not a tone being lost.
    const tones = edgeTones(['$$$$', '$$$$', '$$$$', '....', '....', '....'], 4)
    expect(tones[0]).toBeGreaterThan(tones[5] as number)
  })

  it('smooths vertically, so one stray row cannot stripe the fill', () => {
    // A single solid row between blanks must not come back at full strength,
    // or the generated fill grows a hard horizontal line across it.
    const tones = edgeTones(['    ', '$$$$', '    '], 4)
    expect(tones[1]).toBeLessThan(1)
    expect(tones[0]).toBeGreaterThan(0)
  })
})

describe('edgeTonesRow', () => {
  it('reports one tone per column', () => {
    expect(edgeTonesRow(['$$$$', '    ', '....'], 'top').length).toBe(4)
  })

  it('reads a darker top edge as heavier than a lighter one', () => {
    const darkTop = edgeTonesRow(['$$$$$$$$', '........'], 'top', 1)
    const lightTop = edgeTonesRow(['........', '$$$$$$$$'], 'top', 1)
    expect(darkTop[0]).toBeGreaterThan(lightTop[0] as number)
  })

  it('samples the opposite end for the bottom edge', () => {
    const tones = edgeTonesRow(['$$$$$$$$', '        '], 'bottom', 1)
    // Bottom row is all spaces, so the bottom edge reads as unlit.
    expect(tones[0]).toBe(0)
  })

  it('smooths horizontally, so one stray column cannot stripe the fill', () => {
    const tones = edgeTonesRow([' $ ', ' $ '], 'top', 2)
    expect(tones[1]).toBeLessThan(1)
    expect(tones[0]).toBeGreaterThan(0)
  })
})

describe('buildRowFill', () => {
  const tones = [0.8, 0.5, 0.2]

  it('returns the requested number of rows, each as wide as the tones', () => {
    const fill = buildRowFill(tones, 12, seededRandom(1))
    expect(fill.length).toBe(12)
    for (const line of fill) expect(line.length).toBe(tones.length)
  })

  it('is stable for a given seed', () => {
    expect(buildRowFill(tones, 20, seededRandom(7))).toEqual(
      buildRowFill(tones, 20, seededRandom(7)),
    )
  })

  it('thins out towards row 0, away from the picture', () => {
    const fill = buildRowFill([1], 400, seededRandom(3))
    const half = Math.floor(fill.length / 2)
    const ink = (rows: string[]) =>
      rows.reduce(
        (sum, row) => sum + [...row].reduce((s, c) => s + densityOf(c), 0),
        0,
      )

    expect(ink(fill.slice(0, half))).toBeLessThan(ink(fill.slice(half)))
  })

  it('handles a zero-row request without producing undefined entries', () => {
    expect(buildRowFill(tones, 0, seededRandom(5))).toEqual([])
  })
})

describe('buildFill', () => {
  const tones = [0.8, 0.5, 0.2]

  it('returns one row per tone, each exactly the requested width', () => {
    const fill = buildFill(tones, 12, seededRandom(1))
    expect(fill.length).toBe(3)
    for (const line of fill) expect(line.length).toBe(12)
  })

  it('is stable for a given seed', () => {
    // The hero rebuilds its fill on every resize. If this were not stable the
    // whole left half of the band would reshuffle as the window is dragged.
    expect(buildFill(tones, 20, seededRandom(7))).toEqual(
      buildFill(tones, 20, seededRandom(7)),
    )
  })

  it('differs between seeds', () => {
    expect(buildFill(tones, 20, seededRandom(7))).not.toEqual(
      buildFill(tones, 20, seededRandom(8)),
    )
  })

  it('thins out towards the far edge', () => {
    // The fill has to dissolve into the paper on its left, away from the art,
    // rather than ending on a wall of characters.
    const [line] = buildFill([1], 400, seededRandom(3))
    const half = Math.floor((line as string).length / 2)
    const ink = (s: string) =>
      [...s].reduce((sum, char) => sum + densityOf(char), 0)

    expect(ink((line as string).slice(0, half))).toBeLessThan(
      ink((line as string).slice(half)),
    )
  })

  it('emits nothing but blanks for a row with no tone to continue', () => {
    const [line] = buildFill([0], 40, seededRandom(4))
    expect(line).toBe(' '.repeat(40))
  })

  it('handles a zero-width fill without producing undefined rows', () => {
    expect(buildFill(tones, 0, seededRandom(5))).toEqual(['', '', ''])
  })
})
