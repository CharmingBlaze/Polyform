import { describe, expect, it, beforeEach } from 'vitest'
import { BEVEL_PARAMS } from '../src/bevel'
import { opById } from '../src/ops'
import { useStore } from '../src/store'
import { useLastOp } from '../src/modal'
import { clampField, fieldKind, materialOptions, KEEP_MATERIAL, fieldsOf, optsOf, schemaFromDefs, visible, XF_PARAMS, xfOptsFrom, xfValues, type OpParamLike } from '../src/oppanel/schema'
import { currentOp, noteTransformCommitted, schemaFor } from '../src/oppanel/lastop'
import { commands } from '../src/commands'

const P = (o: Partial<OpParamLike> & { name: string }): OpParamLike => ({ label: o.name, group: 'main', type: 'number', default: 0, ...o })

describe('MOD-3 schema → fields', () => {
  it('maps enums to selects, bools to checkboxes, bounded ints to sliders, other numbers to number fields', () => {
    expect(fieldKind(P({ name: 'a', type: 'enum', options: ['x', 'y'], default: 'x' }))).toBe('select')
    expect(fieldKind(P({ name: 'a', type: 'axis' }))).toBe('select')
    expect(fieldKind(P({ name: 'b', type: 'bool', default: true }))).toBe('checkbox')
    expect(fieldKind(P({ name: 'c', type: 'int', min: 1, max: 32 }))).toBe('slider')
    expect(fieldKind(P({ name: 'c', type: 'int', min: 1, softMax: 8 }))).toBe('slider')
    expect(fieldKind(P({ name: 'c', type: 'int', min: -1 }))).toBe('number')
    expect(fieldKind(P({ name: 'd', min: 0, max: 1 }))).toBe('number')
  })
  it('BEVEL_PARAMS: main / geometry folders, slider for segments, unit on width, empty Shading folder hidden', () => {
    const f = fieldsOf(BEVEL_PARAMS as readonly OpParamLike[], {})
    expect(f.map(x => x.group)).toEqual(['main', 'geometry'])
    const all = f.flatMap(x => x.fields), by = Object.fromEntries(all.map(x => [x.name, x]))
    expect(by.segments).toMatchObject({ kind: 'slider', min: 1, max: 32, value: 1, int: true })
    expect(by.width).toMatchObject({ kind: 'number', unit: 'm' })
    expect(by.affect).toMatchObject({ kind: 'select', options: ['edges', 'vertices'], value: 0 })
    expect(by.clampOverlap).toMatchObject({ kind: 'checkbox', value: 1 })
    expect(f.find(x => x.group === 'geometry')!.fields.map(x => x.name)).toContain('material')
    expect(by.material).toMatchObject({ kind: 'material', value: -1, int: true })
  })
  it('material-index params: a dropdown of the scene materials, "Keep original" (-1) first', () => {
    expect(fieldKind(P({ name: 'material', type: 'int', min: -1 }))).toBe('material')
    expect(fieldKind(P({ name: 'targetMaterial', type: 'int' }))).toBe('material')
    expect(fieldKind(P({ name: 'slot', type: 'int', ref: 'material' }))).toBe('material')
    expect(fieldKind(P({ name: 'materialize', type: 'bool' }))).toBe('checkbox')
    expect(materialOptions(['Skin', ''])).toEqual([{ value: -1, label: KEEP_MATERIAL }, { value: 0, label: 'Skin' }, { value: 1, label: 'Material 2' }])
    expect(KEEP_MATERIAL).toBe('Keep original')
  })
  it('showIf: Width ↔ Width % follow the width type (enum seen as its option name)', () => {
    const names = (v: Record<string, number>) => fieldsOf(BEVEL_PARAMS as readonly OpParamLike[], v).flatMap(x => x.fields).map(x => x.name)
    expect(names({ widthType: 0 })).toContain('width')
    expect(names({ widthType: 0 })).not.toContain('widthPct')
    expect(names({ widthType: 3 })).toContain('widthPct')
    expect(names({ widthType: 3 })).not.toContain('width')
    expect(optsOf(BEVEL_PARAMS as readonly OpParamLike[], { widthType: 3, clampOverlap: 0 })).toMatchObject({ widthType: 'percent', clampOverlap: false })
  })
  it('visibleWhen works like showIf; one that throws keeps the row', () => {
    expect(visible(P({ name: 'x', visibleWhen: o => o.k === 'on' }), { k: 'off' })).toBe(false)
    expect(visible(P({ name: 'x', showIf: () => { throw new Error('x') } }), {})).toBe(true)
  })
  it('a schema with only main rows yields one folder; an empty schema none', () => {
    expect(fieldsOf([P({ name: 'a' })], {}).map(x => x.group)).toEqual(['main'])
    expect(fieldsOf([], {})).toEqual([])
    expect(fieldsOf([P({ name: 'a', group: 'shading' })], {}).map(x => x.label)).toEqual(['Shading'])
  })
  it('clampField: hard min / max, ints rounded, bools 0 / 1, enums in range', () => {
    expect(clampField(P({ name: 's', type: 'int', min: 1, max: 32 }), 40.4)).toBe(32)
    expect(clampField(P({ name: 's', type: 'int', min: 1, max: 32 }), 2.6)).toBe(3)
    expect(clampField(P({ name: 'w', min: 0, softMax: 10 }), 12)).toBe(12)
    expect(clampField(P({ name: 'b', type: 'bool' }), 5)).toBe(1)
    expect(clampField(P({ name: 'e', type: 'enum', options: ['a', 'b'] }), 7)).toBe(1)
  })
  it('schemaFromDefs maps OpDef params (int / bool / enum / axis)', () => {
    for (const op of Object.values(opById)) {
      const s = schemaFromDefs(op.params)
      expect(s.map(x => x.name)).toEqual(op.params.map(p => p.key))
      s.forEach((p, i) => { const d = op.params[i]; expect(p.type).toBe(d.kind === 'bool' ? 'bool' : d.kind === 'enum' ? 'enum' : d.kind === 'axis' ? 'axis' : d.int ? 'int' : 'number') })
    }
  })
  it('G / R / S rows round-trip their last-op opts', () => {
    const o = { translate: [1, 2, 3], axis: 'x', space: 'global', typed: '1' }
    expect(xfValues('xf.grab', o)).toEqual({ tx: 1, ty: 2, tz: 3 })
    expect(xfOptsFrom('xf.grab', o, { tx: 4, ty: 2, tz: 3 })).toMatchObject({ translate: [4, 2, 3], axis: 'x', space: 'global', typed: undefined })
    expect(xfOptsFrom('xf.rotateModal', { angle: 30, axisVec: [0, 0, 1] }, { angle: 90, ax: 0, ay: 1, az: 0 })).toMatchObject({ angle: 90, axisVec: [0, 1, 0] })
    expect(xfOptsFrom('xf.scaleModal', {}, { sx: 2, sy: 2, sz: 2 })).toMatchObject({ scale: [2, 2, 2], factor: 2 })
    expect(fieldsOf(XF_PARAMS['xf.rotateModal'], xfValues('xf.rotateModal', { angle: 45 })).map(f => f.group)).toEqual(['main', 'geometry'])
  })
})

describe('MOD-3 one last operation (lastop.ts)', () => {
  beforeEach(() => { useStore.setState({ lastOp: null }); useLastOp.setState({ lastOp: null }) })
  const sel = { verts: [], edges: [], faces: [] }
  it('schemaFor: Bevel → BEVEL_PARAMS, other ops → their params, G/R/S → XF_PARAMS', () => {
    expect(schemaFor('op.mul.bevel').map(p => p.name)).toEqual(BEVEL_PARAMS.map(p => p.name))
    expect(schemaFor('op.mul.bevelVerts').length).toBe(BEVEL_PARAMS.length)
    const other = Object.values(opById).find(o => o.params.length && !o.id.includes('bevel'))!
    expect(schemaFor(`op.${other.id}`).map(p => p.name)).toEqual(other.params.map(p => p.key))
    expect(schemaFor('xf.grab')).toBe(XF_PARAMS['xf.grab'])
  })
  it('the Bevel modal record collapses into the op record; live while rev === version', () => {
    const v = useStore.getState().version
    useStore.setState({ lastOp: { id: 'mul.bevel', params: { width: 0.2, segments: 3 }, sel, rev: v } })
    useLastOp.setState({ lastOp: { id: 'op.mul.bevel', opts: { width: 0.2 } } })
    const c = currentOp()!
    expect(c).toMatchObject({ kind: 'op', id: 'op.mul.bevel', opId: 'mul.bevel', live: true })
    expect(c.values.segments).toBe(3)
    useStore.setState({ version: v + 1 })
    expect(currentOp()!.live).toBe(false)
  })
  it('the newest record wins: a G after an op, an op after a G', () => {
    const v = useStore.getState().version
    useStore.setState({ lastOp: { id: 'mul.bevel', params: {}, sel, rev: v } })
    useLastOp.setState({ lastOp: { id: 'xf.grab', opts: { translate: [1, 0, 0] } } })
    noteTransformCommitted()
    expect(currentOp()).toMatchObject({ kind: 'xf', id: 'xf.grab', live: true, values: { tx: 1, ty: 0, tz: 0 } })
    useStore.setState({ lastOp: { id: 'mul.bevel', params: { segments: 2 }, sel, rev: v } })
    expect(currentOp()).toMatchObject({ kind: 'op', id: 'op.mul.bevel' })
  })
  it('a confirmed modal without a schema is shown but not adjustable', () => {
    useLastOp.setState({ lastOp: { id: 'xf.shrinkFatten', opts: { offset: 0.1 } } })
    expect(currentOp()).toMatchObject({ kind: 'modal', live: false, schema: [] })
  })
  it('F9 = edit.adjustLast and Shift+R = edit.repeatLast are commands', () => {
    expect(commands.find(c => c.id === 'edit.adjustLast')?.keys).toBe('F9')
    expect(commands.find(c => c.id === 'edit.repeatLast')?.keys).toBe('Shift+R')
  })
})
