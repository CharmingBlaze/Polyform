/** Promise-based in-app dialogs (save changes? / file name), rendered by <DialogHost/>. */
import { create } from 'zustand'

export interface DialogButton { label: string; value: string; primary?: boolean; danger?: boolean }
export interface DialogSpec {
  title: string
  message: string
  buttons: DialogButton[]
  /** a text field (e.g. Save As file name); its value is returned as `text` */
  input?: { label: string; value: string }
  /** what Esc / the close box returns */
  cancel: string
}
interface DialogState { spec: DialogSpec | null; resolve: ((r: { value: string; text: string }) => void) | null }
export const useDialog = create<DialogState>(() => ({ spec: null, resolve: null }))

export function ask(spec: DialogSpec): Promise<{ value: string; text: string }> {
  const prev = useDialog.getState()
  prev.resolve?.({ value: prev.spec?.cancel ?? 'cancel', text: '' })
  return new Promise(resolve => useDialog.setState({ spec, resolve }))
}
export function answer(value: string, text = '') {
  const { resolve } = useDialog.getState()
  useDialog.setState({ spec: null, resolve: null })
  resolve?.({ value, text })
}
