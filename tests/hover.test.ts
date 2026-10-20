import { describe, expect, it } from 'vitest'
import { interaction, setHoverFace } from '../src/interaction'

describe('hover sync state (UV-14)', () => {
  it('tracks the hovered face and where it is hovered; a clear only clears its own side', () => {
    setHoverFace(3, '3d')
    expect(interaction.hoverFace).toEqual({ face: 3, from: '3d' })
    setHoverFace(-1, 'uv') // the UV editor leaving does not clear a 3D hover
    expect(interaction.hoverFace).toEqual({ face: 3, from: '3d' })
    setHoverFace(5, 'uv')
    expect(interaction.hoverFace).toEqual({ face: 5, from: 'uv' })
    setHoverFace(-1, 'uv')
    expect(interaction.hoverFace).toBeNull()
  })
})
