import { debounce, Plugin, MarkdownView } from "obsidian";
import { cursorTrackerExtension } from "./cursor-tracker-extension";
import QuickLRU from 'quick-lru';

/**
 * @typedef {Object} CursorInfo
 * @property {string} file
 * @property {import("obsidian").EditorPosition} cursor
 */

/**
 * @typedef {Object} ActiveFileInfo
 * @property {string} path
 * @property {boolean} initialCursorHasBeenSet
 */

/**
 * @typedef {Object} CursorTrackerSettings
 * @property {CursorInfo[]} fileCursors
 */

/**
 * @type {import("obsidian").Plugin}
 */
export default class CursorTrackerPlugin extends Plugin {
  /**
   * @private
   * @type {CursorTrackerSettings}
   */
  settings = { fileCursors: [] };

  /**
   * @private
   * @type {QuickLRU<string, import("obsidian").EditorPosition>}
   */
  lru = new QuickLRU({ maxSize: 50 });

  /**
   * @private
   * @type {import("obsidian").Debouncer<[], Promise<void>> | null}
   */
  debounceSaveFn = null;

  /**
   * @private
   * @type {boolean}
   */
  layoutReady = false;

  /**
   * @private
   * @type {ActiveFileInfo}
   */
  activeFile = { path: '', initialCursorHasBeenSet: false };

  async onload() {
    await this.loadSettings();

    this.registerEditorExtension(cursorTrackerExtension(this));
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      this.activeFile.path = file?.path ?? '';
      this.activeFile.initialCursorHasBeenSet = false;

      this.onOpen();

      this.activeFile.initialCursorHasBeenSet = true;
    }));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.renameFile(file.path, oldPath)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.deleteFile(file.path)));
    this.registerEvent(this.app.workspace.on('quit', async () => await this.save()));

    // Only allow updating the cursor states once the layout is ready to allow for the first file
    // to properly get its cursor set
    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true
    });
  }

  async onunload() {
    return await this.save();
  }

  async loadSettings() {
    const data = await this.loadData();

    this.settings = Object.assign({}, this.settings, data);

    for (const cursorInfo of this.settings.fileCursors) {
      this.lru.set(cursorInfo.file, cursorInfo.cursor);
    }

    // console.log('initial state: ', this.settings.fileCursors);
  }

  saveSettings() {
    if (this.debounceSaveFn) {
      this.debounceSaveFn();
      return;
    }

    this.debounceSaveFn = debounce(
      async () => {
        this.debounceSaveFn = null;
        await this.save();
      },
      10000,
      true,
    );

    this.debounceSaveFn();
  }

  /**
   * @private
   */
  async save() {
    /** @type {CursorInfo[]} */
    const fileCursors = [];
    for (const entry of this.lru.entriesAscending()) {
      fileCursors.push({
        file: entry[0],
        cursor: entry[1],
      });
    }

    let updateSettings = false;
    if (this.settings.fileCursors.length === fileCursors.length) {
      for (let i = 0; i < fileCursors.length; i++) {
        if (this.settings.fileCursors[i].file !== fileCursors[i].file ||
          this.settings.fileCursors[i].cursor.ch !== fileCursors[i].cursor.ch ||
          this.settings.fileCursors[i].cursor.line !== fileCursors[i].cursor.line
        ) {
          updateSettings = true;
          break;
        }
      }
    } else {
      updateSettings = true;
    }

    if (updateSettings) {
      // console.log('update detected (old, new)', this.settings.fileCursors, fileCursors);
      this.settings.fileCursors = fileCursors;
      await this.saveData(this.settings);
    }/*else {
      console.log('no true update');
    }*/
  }

  /**
   * @private
   */
  onOpen() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      // console.log('View not ready yet...', view);
      return;
    }

    const currentActiveFile = view.file;
    if (currentActiveFile && currentActiveFile.path && this.lru.has(currentActiveFile.path)) {
      const desiredCursorPosition = this.lru.get(currentActiveFile.path) ?? { ch: 0, line: 0 };
      // console.log('open file detected for ' + currentActiveFile.path);
      // console.log('desired cursor: ', desiredCursorPosition);

      const currentCursorPosition = view.editor.getCursor();
      if (desiredCursorPosition && (!currentCursorPosition || (currentCursorPosition.ch === 0 && currentCursorPosition.line === 0))) {
        // console.log('cursor is at the 0, 0 state, so updating it for file ' + currentActiveFile.path + ': ', desiredCursorPosition);
        view.editor.setCursor(desiredCursorPosition ?? 0);
        view.editor.scrollIntoView({
          to: desiredCursorPosition,
          from: desiredCursorPosition,
        }, true);
      } else {
        // console.log('cursor is at a non-zero spot already, so skipping setting its position for file ' + currentActiveFile.path + ': ', currentCursorPosition);
        this.lru.set(view.file.path, currentCursorPosition);
        this.saveSettings();
      }
    }
  }

  async updateCursorPosition() {
    if (!this.layoutReady) {
      // console.log('Skipping cursor position update due to layout not yet having settled.')
      return;
    }

    const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeLeaf || !activeLeaf.file) return;

    if (activeLeaf.file.path !== this.activeFile.path) {
      // console.log('Current active file and the expected active file differ, so the cursor is not ready to have its value updated (old, new)', this.activeFile.path, activeLeaf.file.path);
      return;
    } else if (!this.activeFile.initialCursorHasBeenSet) {
      // console.log('Skipping cursor position update due to initial cursor not having run for the file yet.');
      return;
    }

    /** @type {import("obsidian").EditorPosition | undefined} */
    let oldCursorPosition = undefined;
    if (this.lru.has(activeLeaf.file.path)) {
      oldCursorPosition = this.lru.get(activeLeaf.file.path);
    }

    const currentCursorPosition = activeLeaf.editor.getCursor();
    // console.log(activeLeaf.file.path, oldCursorPosition, currentCursorPosition)
    if (!oldCursorPosition || (currentCursorPosition && oldCursorPosition &&
      (currentCursorPosition.ch !== oldCursorPosition.ch ||
        currentCursorPosition.line !== oldCursorPosition.line)
    )) {
      // console.log('current and old positions are different (old, new) for file ' + activeLeaf.file.path + ': ', oldCursorPosition, currentCursorPosition);
      this.lru.set(activeLeaf.file.path, currentCursorPosition);
      this.saveSettings();
    }
  }

  /**
   * @private
   * @param {string} newPath 
   * @param {string} oldPath 
   */
  renameFile(newPath, oldPath) {
    if (this.lru.has(oldPath)) {
      const cursorPosition = this.lru.get(oldPath);
      this.lru.delete(oldPath);

      if (cursorPosition != undefined) {
        this.lru.set(newPath, cursorPosition);
      }

      this.saveSettings();
    }
  }

  /**
   * @param {string} path 
   */
  deleteFile(path) {
    this.lru.delete(path);
    this.saveSettings();
  }
}