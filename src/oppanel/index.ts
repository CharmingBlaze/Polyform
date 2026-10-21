/**
 * MOD-3 · public entry of the operator-panel layer for other features. The tool-options slot (dockslot.ts) is the
 * piece tools use; lastop / actions / schema are imported directly by the panel and commands (lazy, to keep
 * commands.ts free of cycles), so they are not re-exported here.
 */
export { setDockTool, clearDockTool, getDockTool, subscribeDockTool, useDockTool, type DockTool } from './dockslot'
