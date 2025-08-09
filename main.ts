import { Plugin, PluginSettingTab, Setting, App } from "obsidian";
import {
  Decoration,
  DecorationSet,
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

// ========================================
// Interfaces and defaults
// ========================================

interface FolderConfig {
  folderPattern: string; // Pattern to match folder paths
  emoji: string; // Emoji to display for this folder
  enabled: boolean; // Whether this configuration is enabled
}

interface EmojiPluginSettings {
  folderConfigurations: FolderConfig[];
}

const DEFAULT_SETTINGS: EmojiPluginSettings = {
  folderConfigurations: [
    {
      folderPattern: "add-link-symbols-test-folder",
      emoji: "🚀",
      enabled: false,
    },
  ],
};

// ========================================
// Emoji Text Widgets
// ========================================

/**
 * Simple text widget that just renders the emoji as a text node
 */
class EmojiTextWidget extends WidgetType {
  constructor(private emoji: string) {
    super();
  }

  toDOM(): HTMLElement {
      const span = document.createElement('span');
      span.textContent = this.emoji + " ";
      return span;
  }
}

// ========================================
// EDITOR VIEW PLUGIN
// ========================================

/**
 * Main view plugin that handles live preview decorations
 */
class EmojiViewPlugin implements PluginValue {
  decorations: DecorationSet;
  private plugin: EmojiPlugin;

  constructor(view: EditorView, plugin: EmojiPlugin) {
    this.plugin = plugin;
    this.decorations = this.buildDecorations(view);
  }

  /**
   * Updates decorations when the document or view changes
   */
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  /**
   * Resolves a link text to its actual file path using Obsidian's API
   * @param linkText - The link text from [[linkText]]
   * @returns The resolved file path or null if not found
   */
  private resolveFilePath(linkText: string): string | null {
    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
      linkText,
      ""
    );
    return file ? file.path : null;
  }

  /**
   * Builds all decorations for the current view
   * Steps:
   * 1. Scans each line for links using a regex pattern
   * 2. For each link, resolves its file path
   * 3. Checks if the file path matches any folder configuration
   * 4. If a match is found and the cursor is not in the link range, adds the emoji decoration
   */
  buildDecorations(view: EditorView): DecorationSet {
    const decorations: any[] = [];
    const doc = view.state.doc;
    const selection = view.state.selection.main;

    // Regular expressions for pattern matching
    const linkRegex = /\[\[([^\]|]+)(\|([^\]]+))?\]\]/g;

    // Process each line in the document
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const lineText = line.text;

      // run folder-based link decoration processing
      let linkMatch;
      linkRegex.lastIndex = 0;

      while ((linkMatch = linkRegex.exec(lineText)) !== null) {
        const fullMatch = linkMatch[0];
        const linkPath = linkMatch[1];

        const from = line.from + linkMatch.index;
        const to = from + fullMatch.length;

        // Check if cursor is in the link range
        const cursorInRange = this.isCursorInRange(selection, from, to);

        if (!cursorInRange) {
          // Resolve the actual file path
          const resolvedPath = this.resolveFilePath(linkPath);

          if (resolvedPath) {
            // Check if this file matches any folder configuration from settings
            const folderConfig = getFolderConfigForPath(
              resolvedPath,
              this.plugin.settings.folderConfigurations
            );

            if (folderConfig) {
              // Add emoji as simple text before the link
              decorations.push(
                Decoration.widget({
                  widget: new EmojiTextWidget(folderConfig.emoji),
                  side: -1, // Before the link
                }).range(from)
              );
            }
          }
        }
      }
    }

    return Decoration.set(decorations);
  }

  /**
   * Utility method to check if the cursor is within a given range
   * @param selection - Current selection state
   * @param from - Start position
   * @param to - End position
   * @returns True if cursor is in range, false otherwise
   */
  private isCursorInRange(selection: any, from: number, to: number): boolean {
    return (
      (selection.from >= from && selection.from <= to) ||
      (selection.to >= from && selection.to <= to) ||
      (selection.from <= from && selection.to >= to)
    );
  }
}

// ========================================
// MAIN PLUGIN CLASS
// ========================================

/**
 * Main plugin class that handles initialization and registration
 * This is the entry point for the Obsidian plugin system
 */
export default class EmojiPlugin extends Plugin {
  settings: EmojiPluginSettings;
  private viewPlugin: any;

  /**
   * Creates the CodeMirror view plugin for live preview mode
   * @returns A configured ViewPlugin instance
   */
  private createEmojiViewPlugin() {
    const plugin = this;
    return ViewPlugin.fromClass(
      class extends EmojiViewPlugin {
        constructor(view: EditorView) {
          super(view, plugin);
        }
      },
      {
        decorations: (pluginInstance: EmojiViewPlugin) =>
          pluginInstance.decorations,
      }
    );
  }

  /**
   * Refresh decorations in all open editors
   */
  refreshDecorations() {
    // Trigger a refresh of the editor extensions
    this.app.workspace.updateOptions();
  }

  /**
   * Load settings from data.json
   */
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /**
   * Save settings to data.json
   */
  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Plugin initialization - called when the plugin is loaded
   * Registers all necessary extensions and post-processors
   */
  async onload() {
    // Load settings
    await this.loadSettings();

    // Register settings tab
    this.addSettingTab(new EmojiPluginSettingTab(this.app, this));

    // ========================================
    // LIVE PREVIEW MODE REGISTRATION
    // ========================================
    this.viewPlugin = this.createEmojiViewPlugin();
    this.registerEditorExtension([this.viewPlugin]);
  }
}

// ========================================
// SETTINGS TAB
// ========================================

class EmojiPluginSettingTab extends PluginSettingTab {
  plugin: EmojiPlugin;

  constructor(app: App, plugin: EmojiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Folder Emoji Settings" });

    containerEl.createEl("p", {
      text: "Configure emojis for different folders. Patterns can be simple text or regex (wrapped in forward slashes).",
    });

    // Add button to create new configuration
    new Setting(containerEl)
      .setName("Add new folder configuration")
      .setDesc("Add a new folder pattern and emoji")
      .addButton((button) =>
        button
          .setButtonText("Add")
          .setCta()
          .onClick(() => {
            this.plugin.settings.folderConfigurations.unshift({
              folderPattern: "",
              emoji: "",
              enabled: true,
            });
            this.plugin.saveSettings();
            this.display(); // Refresh the settings display
          })
      );

    // Display all existing configurations
    this.plugin.settings.folderConfigurations.forEach((config, index) => {
      const setting = new Setting(containerEl)
        .setName(`Configuration ${index + 1}`)
        .setDesc("Folder pattern and emoji configuration");

      // Folder pattern input
      setting.addText((text) =>
        text
          .setPlaceholder("e.g., 1-projects or /^projects/")
          .setValue(config.folderPattern)
          .onChange(async (value) => {
            config.folderPattern = value;
            await this.plugin.saveSettings();
            this.plugin.refreshDecorations();
          })
      );

      // Emoji input
      setting.addText((text) =>
        text
          .setPlaceholder("single unicode character")
          .setValue(config.emoji)
          .onChange(async (value) => {
            config.emoji = value;
            await this.plugin.saveSettings();
            this.plugin.refreshDecorations();
          })
      );

      // Enable/disable toggle
      setting.addToggle((toggle) =>
        toggle
          .setValue(config.enabled)
          .onChange(async (value) => {
            config.enabled = value;
            await this.plugin.saveSettings();
            this.plugin.refreshDecorations();
          })
      );

      // Delete button
      setting.addButton((button) =>
        button
          .setButtonText("Delete")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.folderConfigurations.splice(index, 1);
            await this.plugin.saveSettings();
            this.plugin.refreshDecorations();
            this.display(); // Refresh the settings display
          })
      );
    });

    // Reset to defaults button
    new Setting(containerEl)
      .setName("Reset to defaults")
      .setDesc("Reset all configurations to the default settings")
      .addButton((button) =>
        button
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.folderConfigurations = [
              ...DEFAULT_SETTINGS.folderConfigurations,
            ];
            await this.plugin.saveSettings();
            this.plugin.refreshDecorations();
            this.display();
          })
      );
  }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Determines which folder configuration matches a given file path
 * @param filePath - The path of the file to check
 * @param configurations - Array of folder configurations from settings
 * @returns The matching folder configuration or null if no match
 * Note: Both file paths and patterns are treated case-insensitively
 */
function getFolderConfigForPath(
  filePath: string,
  configurations: FolderConfig[]
): FolderConfig | null {
  const normalizedPath = filePath.toLowerCase();

  for (const config of configurations) {
    if (!config.enabled) continue;

    const pattern = config.folderPattern.toLowerCase();

    // Support both exact matches and regex patterns
    if (pattern.startsWith("/") && pattern.endsWith("/")) {
      // Treat as regex if wrapped in forward slashes
      try {
        const regex = new RegExp(pattern.slice(1, -1), "i");
        if (regex.test(filePath)) {
          return config;
        }
      } catch (e) {
        console.warn("Invalid regex pattern:", pattern);
      }
    } else {
      // Treat as simple string match
      if (normalizedPath.includes(pattern)) {
        return config;
      }
    }
  }

  return null;
}
