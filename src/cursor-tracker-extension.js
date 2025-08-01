import {ViewPlugin, ViewUpdate} from '@codemirror/view';
import CursorTrackerPlugin from 'src/main';

/**
 * Create the cursor tracker extension for CodeMirror which just calls out to
 * the plugin in order to let it know when the cursor has had a position change.
 * @param {CursorTrackerPlugin} plugin
 * @returns {import('@codemirror/state').Extension}
 */
export function cursorTrackerExtension(plugin) {
  return ViewPlugin.fromClass(class {
    constructor() {
      this.reportCursor();
    }
    /**
     * @param {ViewUpdate} update
     */
    update(update) {
      if (update.selectionSet) {
        this.reportCursor();
      }
    }
    reportCursor() {
      plugin.updateCursorPosition();
    }
  });
}
