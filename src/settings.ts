import { create } from 'zustand'

/** File › Settings (Ctrl+,): open state of the Settings window. */
export const useSettings = create<{ open: boolean }>(() => ({ open: false }))
export const openSettings = () => useSettings.setState({ open: true })
export const closeSettings = () => useSettings.setState({ open: false })
