import { Plugin, TFile } from 'obsidian';
import { Extension } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, PluginValue, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';

// ========================================
// CONFIGURATION SECTION
// ========================================

/**
 * Configuration for emoji code replacements
 * Add new emoji mappings here as needed
 */
const EMOJI_MAPPINGS: Record<string, string> = {
  ':+1:': '👍',
  ':sunglasses:': '😎',
  ':smile:': '😄',
  ':heart:': '❤️',
  ':fire:': '🔥',
  ':rocket:': '🚀',
  ':star:': '⭐',
  ':wink:': '😉',
  ':thumbsup:': '👍',
  ':thumbsdown:': '👎',
  ':laugh:': '😂',
  ':cry:': '😢',
};

/**
 * Configuration for folder-specific link decorations
 * Each entry defines a folder pattern and its corresponding emoji/symbol
 *
 * To add new folders:
 * 1. Add a new key with a descriptive name
 * 2. Set the folderPattern to match your folder structure
 * 3. Choose an emoji for that folder type
 * 4. Optionally customize the CSS class name
 */
interface FolderConfig {
  folderPattern: string | RegExp;  // Pattern to match folder paths
  emoji: string;                   // Emoji to display for this folder
  cssClass?: string;              // Optional CSS class for styling
  description?: string;           // Optional description for documentation
}

const FOLDER_CONFIGURATIONS: Record<string, FolderConfig> = {
  // Important files configuration
  important: {
    folderPattern: /^important\/|\/important\//i,
    emoji: '🚀',
    cssClass: 'important-link-emoji',
    description: 'Files in important folders'
  },

  // Example: Add more folder configurations here
  // You can easily add new ones by following this pattern:

  // archived: {
  //   folderPattern: /^archive\/|\/archive\//i,
  //   emoji: '📦',
  //   cssClass: 'archived-link-emoji',
  //   description: 'Files in archive folders'
  // },

  // projects: {
  //   folderPattern: /^projects\/|\/projects\//i,
  //   emoji: '💼',
  //   cssClass: 'project-link-emoji',
  //   description: 'Files in project folders'
  // },

  // templates: {
  //   folderPattern: /^templates\/|\/templates\//i,
  //   emoji: '📋',
  //   cssClass: 'template-link-emoji',
  //   description: 'Template files'
  // }
};

// ========================================
// WIDGET CLASSES
// ========================================

/**
 * Widget for rendering emoji replacements in the editor
 * Replaces emoji codes like :smile: with actual emojis
 */
class EmojiWidget extends WidgetType {
  constructor(private emoji: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = this.emoji;
    span.className = 'emoji-widget';
    return span;
  }
}

/**
 * Widget for rendering folder-specific emojis next to links
 * Adds contextual emojis based on the linked file's folder location
 */
class FolderLinkWidget extends WidgetType {
  constructor(
    private emoji: string,
    private cssClass: string = 'folder-link-emoji'
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = this.emoji;
    span.className = this.cssClass;
    span.style.marginLeft = '4px';
    return span;
  }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Determines which folder configuration matches a given file path
 * @param filePath - The path of the file to check
 * @returns The matching folder configuration or null if no match
 */
function getFolderConfigForPath(filePath: string): FolderConfig | null {
  const normalizedPath = filePath.toLowerCase();

  for (const [configName, config] of Object.entries(FOLDER_CONFIGURATIONS)) {
    const { folderPattern } = config;

    // Handle both string and RegExp patterns
    if (typeof folderPattern === 'string') {
      if (normalizedPath.includes(folderPattern.toLowerCase())) {
        return config;
      }
    } else if (folderPattern instanceof RegExp) {
      if (folderPattern.test(normalizedPath)) {
        return config;
      }
    }
  }

  return null;
}

// ========================================
// EDITOR VIEW PLUGIN
// ========================================

/**
 * Main view plugin that handles live preview decorations
 * This class manages both emoji replacements and folder-based link decorations
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
    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(linkText, '');
    return file ? file.path : null;
  }

  /**
   * Builds all decorations for the current view
   * Handles both emoji replacements and folder-based link decorations
   */
  buildDecorations(view: EditorView): DecorationSet {
    const decorations: any[] = [];
    const doc = view.state.doc;
    const selection = view.state.selection.main;

    // Regular expressions for pattern matching
    const emojiRegex = /:([a-zA-Z0-9_+-]+):/g;
    const linkRegex = /\[\[([^\]|]+)(\|([^\]]+))?\]\]/g;

    // Process each line in the document
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const lineText = line.text;

      // ========================================
      // EMOJI REPLACEMENT PROCESSING
      // ========================================
      let emojiMatch;
      emojiRegex.lastIndex = 0;

      while ((emojiMatch = emojiRegex.exec(lineText)) !== null) {
        const fullMatch = emojiMatch[0];
        const emojiCode = fullMatch;
        const emoji = EMOJI_MAPPINGS[emojiCode];

        if (emoji) {
          const from = line.from + emojiMatch.index;
          const to = from + fullMatch.length;

          // Check if cursor is in the emoji range (don't replace if cursor is there)
          const cursorInRange = this.isCursorInRange(selection, from, to);

          if (!cursorInRange) {
            decorations.push(
              Decoration.replace({
                widget: new EmojiWidget(emoji),
              }).range(from, to)
            );
          }
        }
      }

      // ========================================
      // FOLDER-BASED LINK DECORATION PROCESSING
      // ========================================
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
            // Check if this file matches any folder configuration
            const folderConfig = getFolderConfigForPath(resolvedPath);

            if (folderConfig) {
              // Add the appropriate emoji decoration after the link
              decorations.push(
                Decoration.widget({
                  widget: new FolderLinkWidget(
                    folderConfig.emoji,
                    folderConfig.cssClass || 'folder-link-emoji'
                  ),
                  side: 1, // Place after the link
                }).range(to)
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
    return (selection.from >= from && selection.from <= to) ||
           (selection.to >= from && selection.to <= to) ||
           (selection.from <= from && selection.to >= to);
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
        decorations: (pluginInstance: EmojiViewPlugin) => pluginInstance.decorations,
      }
    );
  }

  /**
   * Plugin initialization - called when the plugin is loaded
   * Registers all necessary extensions and post-processors
   */
  async onload() {
    // ========================================
    // LIVE PREVIEW MODE REGISTRATION
    // ========================================
    this.registerEditorExtension([this.createEmojiViewPlugin()]);

    // ========================================
    // READING MODE - EMOJI POST PROCESSOR
    // ========================================
    this.registerMarkdownPostProcessor((element, context) => {
      this.processEmojisInReadingMode(element);
    });

    // ========================================
    // READING MODE - FOLDER LINK POST PROCESSOR
    // ========================================
    this.registerMarkdownPostProcessor((element, context) => {
      this.processFolderLinksInReadingMode(element, context);
    });
  }

  /**
   * Processes emoji replacements in reading/preview mode
   * @param element - The DOM element to process
   */
  private processEmojisInReadingMode(element: HTMLElement): void {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes: Text[] = [];
    let node: Text;

    // Collect all text nodes to avoid modifying the tree while iterating
    while (node = walker.nextNode() as Text) {
      textNodes.push(node);
    }

    // Process each text node for emoji patterns
    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      const emojiRegex = /:([a-zA-Z0-9_+-]+):/g;
      let emojiMatch;
      const emojiReplacements: { start: number, end: number, emoji: string }[] = [];

      // Find all emoji patterns in this text node
      while ((emojiMatch = emojiRegex.exec(text)) !== null) {
        const emojiCode = emojiMatch[0];
        const emoji = EMOJI_MAPPINGS[emojiCode];
        if (emoji) {
          emojiReplacements.push({
            start: emojiMatch.index,
            end: emojiMatch.index + emojiMatch[0].length,
            emoji: emoji
          });
        }
      }

      // Apply replacements (process in reverse order to maintain positions)
      if (emojiReplacements.length > 0) {
        this.applyEmojiReplacements(textNode, emojiReplacements, text);
      }
    });
  }

  /**
   * Applies emoji replacements to a text node
   * @param textNode - The text node to modify
   * @param replacements - Array of replacement data
   * @param originalText - The original text content
   */
  private applyEmojiReplacements(
    textNode: Text,
    replacements: { start: number, end: number, emoji: string }[],
    originalText: string
  ): void {
    const parent = textNode.parentNode;
    if (!parent) return;

    let currentText = originalText;

    // Process replacements in reverse order to maintain correct positions
    replacements.reverse().forEach(replacement => {
      const before = currentText.substring(0, replacement.start);
      const after = currentText.substring(replacement.end);

      // Create emoji span element
      const emojiSpan = document.createElement('span');
      emojiSpan.textContent = replacement.emoji;
      emojiSpan.className = 'emoji-replacement';

      // Insert elements in reverse order (after, emoji, before)
      if (after) {
        const afterTextNode = document.createTextNode(after);
        parent.insertBefore(afterTextNode, textNode);
      }

      parent.insertBefore(emojiSpan, textNode);

      if (before) {
        const beforeTextNode = document.createTextNode(before);
        parent.insertBefore(beforeTextNode, textNode);
      }

      currentText = before;
    });

    parent.removeChild(textNode);
  }

  /**
   * Processes folder-based link decorations in reading/preview mode
   * @param element - The DOM element to process
   * @param context - The markdown post processor context
   */
  private processFolderLinksInReadingMode(element: HTMLElement, context: any): void {
    // Find all internal links (rendered as <a> tags with data-href)
    const links = element.querySelectorAll('a.internal-link');

    links.forEach((link: HTMLAnchorElement) => {
      const href = link.getAttribute('data-href');
      if (!href) return;

      // Resolve the actual file path using Obsidian's API
      const file = this.app.metadataCache.getFirstLinkpathDest(
        href,
        context.sourcePath || ''
      );

      if (!file) return;

      // Check if this file matches any folder configuration
      const folderConfig = getFolderConfigForPath(file.path);

      if (folderConfig) {
        // Prevent duplicate decorations
        const existingEmoji = link.querySelector('.folder-link-emoji, .' + folderConfig.cssClass);
        if (existingEmoji) return;

        // Create and append the folder emoji
        const emojiSpan = document.createElement('span');
        emojiSpan.textContent = ' ' + folderConfig.emoji;
        emojiSpan.className = folderConfig.cssClass || 'folder-link-emoji';
        emojiSpan.style.marginLeft = '4px';

        link.appendChild(emojiSpan);

        // Add a class to the link itself for additional styling options
        link.classList.add('has-folder-emoji');
      }
    });
  }
}
