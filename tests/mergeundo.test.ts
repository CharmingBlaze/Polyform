import { describe, expect, it } from 'vitest'
import * as M from '../src/model'
import { History, materialize } from '../src/history'

const cube = () => { const m = M.emptyModel(); M.addPolys(m, M.boxPolys(1, 1, 1, 1), 'b'); return m }
const shown = (h: History) => materialize(h.resolveAt(h.cur))
/** duplicate every face (one undo step), then move the copy's points by +dx on X */
const dupThenMove = (h: History, m: M.Model, dx: number) => {
  h.begin(m, 'Duplicate'); const faces = M.duplicateFaces(m, m.faces.map((_, i) => i)); h.commit(m)
  const moved = [...new Set(faces.flatMap(f => m.faces[f].v))]
  h.begin(m, 'Move'); moved.forEach(v => { m.verts[v] = [m.verts[v][0] + dx, m.verts[v][1], m.verts[v][2]] })
  return moved
}

describe('MOD-2 mergeUndo: History.amend', () => {
  it('folds the move into the duplicate step: one undo removes the copy and the move', () => {
    const m = cube(), h = new History(); h.reset(m)
    const v0 = m.verts.map(v => [...v]), f0 = m.faces.length
    const moved = dupThenMove(h, m, 2)
    expect(h.amend(m)).toBe(true)
    expect(h.steps.length).toBe(2)
    expect(h.labels()).toEqual(['Open', 'Duplicate'])
    expect(shown(h).verts[moved[0]][0]).toBeCloseTo(m.verts[moved[0]][0])
    const r = h.undo(m)
    expect(r.ok).toBe(true)
    expect(r.model!.faces.length).toBe(f0)
    expect(r.model!.verts.slice(0, v0.length)).toEqual(v0)
    expect(r.model!.verts.length).toBe(v0.length)
    expect(h.canUndo()).toBe(false)
  })
  it('redo brings back the copy at its moved place', () => {
    const m = cube(), h = new History(); h.reset(m)
    const moved = dupThenMove(h, m, 2)
    const x = m.verts[moved[0]][0]
    h.amend(m); h.undo(m)
    const r = h.redo()
    expect(r.model!.verts[moved[0]][0]).toBeCloseTo(x)
  })
  it('a normal commit keeps two steps (two undos)', () => {
    const m = cube(), h = new History(); h.reset(m)
    dupThenMove(h, m, 2); h.commit(m)
    expect(h.labels()).toEqual(['Open', 'Duplicate', 'Move'])
  })
  it('cancel restores the start and leaves the duplicate step alone', () => {
    const m = cube(), h = new History(); h.reset(m)
    const f0 = m.faces.length
    dupThenMove(h, m, 2)
    const back = h.cancel()!
    expect(back.faces.length).toBe(f0 * 2)
    expect(h.labels()).toEqual(['Open', 'Duplicate'])
    expect(h.undo(back).model!.faces.length).toBe(f0)
  })
  it('with nothing to amend it commits normally', () => {
    const m = cube(), h = new History(); h.reset(m)
    h.begin(m, 'Move'); m.verts[0] = [5, 5, 5]
    expect(h.amend(m)).toBe(false)
    expect(h.labels()).toEqual(['Open', 'Move'])
  })
  it('without a pending edit it does nothing', () => {
    const m = cube(), h = new History(); h.reset(m)
    expect(h.amend(m)).toBe(false)
    expect(h.steps.length).toBe(1)
  })
  it('drops redo steps above the amended one', () => {
    const m = cube(), h = new History(); h.reset(m)
    h.begin(m, 'A'); m.verts[0] = [1, 1, 1]; h.commit(m)
    h.begin(m, 'B'); m.verts[1] = [2, 2, 2]; h.commit(m)
    const back = h.undo(m).model!
    h.begin(back, 'C'); back.verts[0] = [3, 3, 3]
    h.amend(back)
    expect(h.labels()).toEqual(['Open', 'A'])
    expect(shown(h).verts[0]).toEqual([3, 3, 3])
  })
})
