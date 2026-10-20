import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/io', async orig => ({ ...(await orig<typeof import('../src/io')>()), saveProject: vi.fn() }))
import { saveProject } from '../src/io'
import { addPrimitive, emptyModel } from '../src/model'
import { useStore } from '../src/store'
import { useDialog, answer } from '../src/dialog'
import { exitApp, fileStem, isDirty, newScene, saveAs, saveFile } from '../src/fileActions'

const S = () => useStore.getState()
const tick = () => new Promise(r => setTimeout(r, 0))
function dirtyBox() {
  const m = emptyModel(); addPrimitive(m, 'box'); S().loadModel(m)
  S().edit(mm => { mm.props.author = 'me' }, 'test')
}

describe('file actions', () => {
  beforeEach(() => { S().loadModel(emptyModel()); useStore.setState({ fileName: null }); answer('cancel'); vi.mocked(saveProject).mockClear() })

  it('loading is clean, an edit is dirty, undo back is still a change, saving cleans', () => {
    expect(isDirty()).toBe(false)
    dirtyBox()
    expect(isDirty()).toBe(true)
    S().doUndo()
    expect(isDirty()).toBe(true)
    saveFile()
    expect(isDirty()).toBe(false)
    expect(saveProject).toHaveBeenCalledOnce()
  })

  it('New on a clean scene resets without asking', async () => {
    const m = emptyModel(); addPrimitive(m, 'box'); S().loadModel(m)
    expect(await newScene()).toBe(true)
    expect(S().model.faces.length).toBe(0)
    expect(useDialog.getState().spec).toBeNull()
  })

  it('New with unsaved changes: Cancel keeps, Don’t save resets, Save saves then resets', async () => {
    dirtyBox()
    let p = newScene(); await tick()
    expect(useDialog.getState().spec?.buttons.map(b => b.value)).toEqual(['cancel', 'discard', 'save'])
    answer('cancel'); expect(await p).toBe(false); expect(S().model.faces.length).toBeGreaterThan(0)
    p = newScene(); await tick(); answer('discard')
    expect(await p).toBe(true); expect(S().model.faces.length).toBe(0); expect(saveProject).not.toHaveBeenCalled()
    dirtyBox()
    p = newScene(); await tick(); answer('save')
    expect(await p).toBe(true); expect(saveProject).toHaveBeenCalledOnce(); expect(isDirty()).toBe(false)
  })

  it('Exit: closes when the browser allows, else clears to an empty scene with a notice', async () => {
    dirtyBox()
    const close = vi.fn()
    let p = exitApp(close, () => true); await tick(); answer('discard')
    expect(await p).toBe('closed'); expect(close).toHaveBeenCalledOnce(); expect(S().model.faces.length).toBeGreaterThan(0)
    p = exitApp(close, () => false); await tick(); answer('discard')
    expect(await p).toBe('cleared'); expect(S().model.faces.length).toBe(0); expect(S().toast).toMatch(/close the tab/i)
    dirtyBox()
    p = exitApp(close, () => false); await tick(); answer('cancel')
    expect(await p).toBe('cancelled'); expect(close).toHaveBeenCalledTimes(2)
  })

  it('file name: Save As name, else scene name, else "model"; unsafe characters replaced', async () => {
    expect(fileStem()).toBe('model')
    S().edit(m => { m.props.name = 'Hero: v2/final' }, 'name')
    expect(fileStem()).toBe('Hero_ v2_final')
    const p = saveAs(); await tick()
    expect(useDialog.getState().spec?.input?.value).toBe('Hero_ v2_final')
    answer('save', 'knight.polyform.json')
    expect(await p).toBe(true)
    expect(fileStem()).toBe('knight')
    expect(vi.mocked(saveProject).mock.calls[0][1]).toBe('knight')
  })
})
