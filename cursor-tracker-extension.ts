import { ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Extension } from '@codemirror/state';
import CursorTrackerPlugin from "main";

export function cursorTrackerExtension(plugin: CursorTrackerPlugin): Extension {
  return ViewPlugin.fromClass(class {
    constructor() {
      this.reportCursor();
    }
    update(update: ViewUpdate) {
      if (update.selectionSet) {
        this.reportCursor();
      }
    }
    reportCursor() {
     plugin.updateCursorPosition();
    }
  });
}