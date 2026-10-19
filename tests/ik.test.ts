import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, newClip } from '../src/model'
import { fabrik, ikChain, solveIK, jointWorld } from '../src/ik'

function arm() {
  const m = emptyModel()
  m.bones = [
    { name: 'Shoulder', parent: -1, pos: [0, 1, 0] },
    { name: 'Elbow', parent: 0, pos: [0, 1, 0.5] },
    { name: 'Hand', parent: 1, pos: [0, 1, 1] },
  ]
  m.clips = [{ ...newClip('Pose'), frames: 30 }]
  return m
}

describe('IK (FABRIK)', () => {
  it('ikChain walks parents up to depth', () => {
    const m = arm()
    expect(ikChain(m, 2, 2)).toEqual([0, 1, 2])
    expect(ikChain(m, 2, 1)).toEqual([1, 2])
    expect(ikChain(m, 2, 0)).toEqual([2])
  })

  it('fabrik reaches a nearby target and keeps bone lengths', () => {
    const m = arm()
    const world = jointWorld(m, null)
    const chain = [0, 1, 2]
    const lengths = [world[0].distanceTo(world[1]), world[1].distanceTo(world[2])]
    const target = new THREE.Vector3(0.3, 1.1, 0.9)
    const solved = fabrik(world, chain, target)
    expect(solved[2].distanceTo(target)).toBeLessThan(0.05)
    expect(solved[0].distanceTo(world[0])).toBeLessThan(1e-6)
    expect(Math.abs(solved[0].distanceTo(solved[1]) - lengths[0])).toBeLessThan(1e-4)
    expect(Math.abs(solved[1].distanceTo(solved[2]) - lengths[1])).toBeLessThan(1e-4)
  })

  it('solveIK writes rotations that move the hand toward the target', () => {
    const m = arm()
    const clip = m.clips[0]
    const target = new THREE.Vector3(0.4, 1.0, 0.85)
    const keys = solveIK(m, 2, target, 2, 0, clip)
    expect(keys.size).toBeGreaterThanOrEqual(2)
    // apply keys at frame 0
    keys.forEach((k, b) => { (clip.keys[b] ??= {})[0] = k })
    const after = jointWorld(m, 0, clip)
    expect(after[2].distanceTo(target)).toBeLessThan(0.15)
  })
})
