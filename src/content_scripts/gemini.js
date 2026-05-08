/**
 * Gemini Chat Exporter - Gemini content script
 * Exports Gemini chat conversations to Markdown with LaTeX preservation
 * Version 4.0.0 - DOM-based extraction (no clipboard dependency)
 */

(function() {
  'use strict';

  const CONFIG = {
    BUTTON_ID: 'gemini-export-btn',
    DROPDOWN_ID: 'gemini-export-dropdown',
    FILENAME_INPUT_ID: 'gemini-filename-input',
    SELECT_DROPDOWN_ID: 'gemini-select-dropdown',
    CHECKBOX_CLASS: 'gemini-export-checkbox',
    SIDEBAR_CHECKBOX_CLASS: 'gemini-sidebar-export-checkbox',
    EXPORT_MODE_NAME: 'gemini-export-mode',
    SIDEBAR_CONTROLS_ID: 'gemini-sidebar-export-controls',
    
    SELECTORS: {
      CHAT_CONTAINER: '[data-test-id="chat-history-container"]',
      CONVERSATION_TURN: 'div.conversation-container',
      USER_QUERY: 'user-query',
      USER_QUERY_TEXT: '.query-text .query-text-line',
      MODEL_RESPONSE: 'model-response',
      MODEL_RESPONSE_CONTENT: 'message-content .markdown',
      CONVERSATION_TITLE: '[data-test-id="conversation-title"]',
      SIDEBAR_CONTAINER: 'nav[role="navigation"]',
      SIDEBAR_ITEM: 'a[href*="/app/"]',
      SIDEBAR_ITEM_TEXT: '.history-item-title, span'
    },
    
    TIMING: {
      SCROLL_DELAY: 2000,
      POPUP_DURATION: 900,
      NOTIFICATION_CLEANUP_DELAY: 1000,
      MAX_SCROLL_ATTEMPTS: 60,
      MAX_STABLE_SCROLLS: 4
    },
    
    STYLES: {
      BUTTON_PRIMARY: '#1a73e8',
      BUTTON_HOVER: '#1765c1',
      DARK_BG: '#111',
      DARK_TEXT: '#fff',
      DARK_BORDER: '#444',
      LIGHT_BG: '#fff',
      LIGHT_TEXT: '#222',
      LIGHT_BORDER: '#ccc'
    },
    
    MATH_BLOCK_SELECTOR: '.math-block[data-math]',
    MATH_INLINE_SELECTOR: '.math-inline[data-math]',
    
    DEFAULT_FILENAME: 'gemini_chat_export',
    MARKDOWN_HEADER: '# Gemini Chat Export',
    EXPORT_TIMESTAMP_FORMAT: 'Exported on:'
  };

  // ============================================================================
  // UTILITY SERVICES
  // ============================================================================
  
  class DateUtils {
    static getDateString() {
      const d = new Date();
      const pad = n => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    static getLocaleString() {
      return new Date().toLocaleString();
    }
  }

  class StringUtils {
    static sanitizeFilename(text) {
      return text
        .replace(/[\\/:*?"<>|.]/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');
    }

    static removeCitations(text) {
      return text
        .replace(/\[cite_start\]/g, '')
        .replace(/\[cite:[\d,\s]+\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
  }

  class DOMUtils {
    static sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    static isDarkMode() {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    static createNotification(message) {
      const popup = document.createElement('div');
      Object.assign(popup.style, {
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: '99999',
        background: '#333',
        color: '#fff',
        padding: '10px 18px',
        borderRadius: '8px',
        fontSize: '1em',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        opacity: '0.95',
        pointerEvents: 'none'
      });
      popup.textContent = message;
      document.body.appendChild(popup);
      setTimeout(() => popup.remove(), CONFIG.TIMING.POPUP_DURATION);
      return popup;
    }
  }

  // ============================================================================
  // FILENAME SERVICE
  // ============================================================================
  
  class FilenameService {
    static getConversationTitle() {
      const titleCard = document.querySelector(CONFIG.SELECTORS.CONVERSATION_TITLE);
      return titleCard ? titleCard.textContent.trim() : '';
    }

    static generate(customFilename, conversationTitle) {
      // Priority: custom > conversation title > page title > timestamp
      if (customFilename && customFilename.trim()) {
        const base = this._sanitizeCustomFilename(customFilename);
        return base || `${CONFIG.DEFAULT_FILENAME}_${DateUtils.getDateString()}`;
      }

      // Try conversation title first
      if (conversationTitle) {
        const safeTitle = StringUtils.sanitizeFilename(conversationTitle);
        if (safeTitle) return `${safeTitle}_${DateUtils.getDateString()}`;
      }

      // Fallback to page title
      const pageTitle = document.querySelector('title')?.textContent.trim();
      if (pageTitle) {
        const safeTitle = StringUtils.sanitizeFilename(pageTitle);
        if (safeTitle) return `${safeTitle}_${DateUtils.getDateString()}`;
      }

      // Final fallback
      return `${CONFIG.DEFAULT_FILENAME}_${DateUtils.getDateString()}`;
    }

    static _sanitizeCustomFilename(filename) {
      let base = filename.trim().replace(/\.[^/.]+$/, '');
      return base.replace(/[^a-zA-Z0-9_\-]/g, '_');
    }
  }

  // ============================================================================
  // SCROLL SERVICE
  // ============================================================================
  
  class ScrollService {
    static async loadAllMessages() {
      const scrollContainer = document.querySelector(CONFIG.SELECTORS.CHAT_CONTAINER);
      if (!scrollContainer) {
        throw new Error('Could not find chat history container. Are you on a Gemini chat page?');
      }

      let stableScrolls = 0;
      let scrollAttempts = 0;
      let lastScrollTop = null;

      while (stableScrolls < CONFIG.TIMING.MAX_STABLE_SCROLLS && 
             scrollAttempts < CONFIG.TIMING.MAX_SCROLL_ATTEMPTS) {
        const currentTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;
        scrollContainer.scrollTop = 0;
        await DOMUtils.sleep(CONFIG.TIMING.SCROLL_DELAY);
        
        const scrollTop = scrollContainer.scrollTop;
        const newTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;
        
        if (newTurnCount === currentTurnCount && (lastScrollTop === scrollTop || scrollTop === 0)) {
          stableScrolls++;
        } else {
          stableScrolls = 0;
        }
        
        lastScrollTop = scrollTop;
        scrollAttempts++;
      }
    }
  }

  // ============================================================================
  // FILE EXPORT SERVICE
  // ============================================================================
  
  class FileExportService {
    static download(content, filenameBase, extension) {
      const mimeTypes = {
        'md': 'text/markdown',
        'html': 'text/html',
        'txt': 'text/plain'
      };

      const blob = new Blob([content], { type: mimeTypes[extension] || 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filenameBase}.${extension}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, CONFIG.TIMING.NOTIFICATION_CLEANUP_DELAY);
    }

    static downloadMarkdown(markdown, filenameBase) {
      this.download(markdown, filenameBase, 'md');
    }

    static async exportToClipboard(markdown) {
      await navigator.clipboard.writeText(markdown);
      alert('Conversation copied to clipboard!');
    }
  }

  // ============================================================================
  // FORMAT CONVERTER SERVICES
  // ============================================================================

  /**
   * Converts Markdown to simple HTML
   */
  class HtmlConverter {
    static convert(markdown, title) {
      // Basic markdown to HTML conversion (very simple)
      let html = markdown
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/---/gim, '<hr>')
        .replace(/\n/gim, '<br>\n');

      return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title || 'Gemini Export'}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
        h2 { margin-top: 30px; border-bottom: 1px solid #eee; }
        blockquote { border-left: 4px solid #eee; padding-left: 15px; color: #666; margin: 20px 0; }
        code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-family: monospace; }
        pre { background: #f4f4f4; padding: 15px; overflow-x: auto; border-radius: 5px; }
        hr { border: 0; border-top: 1px solid #eee; margin: 30px 0; }
    </style>
</head>
<body>
    ${html}
</body>
</html>`;
    }
  }

  /**
   * Converts Markdown to plain text
   */
  class TxtConverter {
    static convert(markdown) {
      return markdown
        .replace(/^#+ /gim, '')
        .replace(/^\> /gim, '')
        .replace(/\*\*/gim, '')
        .replace(/\*/gim, '')
        .replace(/---/gim, '-----------------------')
        .replace(/\[(.*?)\]\(.*?\)/gim, '$1');
    }
  }
  
  class MarkdownConverter {
    constructor() {
      this.turndownService = this._createTurndownService();
    }

    _createTurndownService() {
      if (typeof window.TurndownService !== 'function') {
        return null;
      }

      const service = new window.TurndownService({
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**',
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockFence: '```'
      });

      service.addRule('mathBlock', {
        filter: node => node.nodeType === 1 && node.matches?.(CONFIG.MATH_BLOCK_SELECTOR),
        replacement: (content, node) => {
          const latex = node.getAttribute('data-math') || '';
          return `$$${latex}$$\n\n`;
        }
      });

      service.addRule('mathInline', {
        filter: node => node.nodeType === 1 && node.matches?.(CONFIG.MATH_INLINE_SELECTOR),
        replacement: (content, node) => {
          const latex = node.getAttribute('data-math') || '';
          return `$${latex}$`;
        }
      });

      service.addRule('table', {
        filter: 'table',
        replacement: (content, node) => {
          const rows = Array.from(node.querySelectorAll('tr'));
          if (!rows.length) return '';

          const getCells = row => {
            return Array.from(row.querySelectorAll('th, td')).map(cell => {
              const cellContent = service.turndown(cell.innerHTML);
              return cellContent.replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
            });
          };

          const headerRow = rows[0];
          const headers = getCells(headerRow);
          const separator = headers.map(() => '---');
          const bodyRows = rows.slice(1).map(getCells);

          const lines = [
            `| ${headers.join(' | ')} |`,
            `| ${separator.join(' | ')} |`,
            ...bodyRows.map(cells => `| ${cells.join(' | ')} |`)
          ];

          return `\n${lines.join('\n')}\n\n`;
        }
      });

      service.addRule('lineBreak', {
        filter: 'br',
        replacement: () => '  \n'
      });

      return service;
    }

    extractUserQuery(userQueryElement) {
      if (!userQueryElement) return '';
      
      const queryLines = userQueryElement.querySelectorAll(CONFIG.SELECTORS.USER_QUERY_TEXT);
      if (queryLines.length === 0) {
        const queryText = userQueryElement.querySelector('.query-text, .user-query-container');
        return queryText ? queryText.textContent.trim() : '';
      }
      
      return Array.from(queryLines)
        .map(line => line.textContent.trim())
        .filter(text => text.length > 0)
        .join('\n');
    }

    extractModelResponse(modelResponseElement) {
      if (!modelResponseElement) return '';
      
      const markdownContainer = modelResponseElement.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE_CONTENT);
      if (!markdownContainer) return '';

      let result = '';
      if (this.turndownService) {
        result = this.turndownService.turndown(markdownContainer.innerHTML);
      } else {
        result = FallbackConverter.convertToMarkdown(markdownContainer);
      }
      
      // Remove Gemini citation markers
      return StringUtils.removeCitations(result);
    }
  }

  // ============================================================================
  // FALLBACK CONVERTER (when Turndown unavailable)
  // ============================================================================
  
  class FallbackConverter {
    static convertToMarkdown(container) {
      return Array.from(container.childNodes).map(node => this._blockText(node)).join('');
    }

    static _inlineText(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';

      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const el = node;
      if (el.matches?.(CONFIG.MATH_INLINE_SELECTOR)) {
        const latex = el.getAttribute('data-math') || '';
        return `$${latex}$`;
      }

      const tag = el.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      if (tag === 'b' || tag === 'strong') {
        return `**${Array.from(el.childNodes).map(n => this._inlineText(n)).join('')}**`;
      }
      if (tag === 'i' || tag === 'em') {
        return `*${Array.from(el.childNodes).map(n => this._inlineText(n)).join('')}*`;
      }
      if (tag === 'code') {
        return `\`${el.textContent || ''}\``;
      }

      return Array.from(el.childNodes).map(n => this._inlineText(n)).join('');
    }

    static _blockText(el) {
      if (!el) return '';

      if (el.nodeType === Node.TEXT_NODE) {
        return (el.textContent || '').trim();
      }

      if (el.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = el.tagName.toLowerCase();

      if (el.matches?.(CONFIG.MATH_BLOCK_SELECTOR)) {
        const latex = el.getAttribute('data-math') || '';
        return `$$${latex}$$\n\n`;
      }

      const handlers = {
        h1: () => `# ${this._inlineText(el)}\n\n`,
        h2: () => `## ${this._inlineText(el)}\n\n`,
        h3: () => `### ${this._inlineText(el)}\n\n`,
        h4: () => `#### ${this._inlineText(el)}\n\n`,
        h5: () => `##### ${this._inlineText(el)}\n\n`,
        h6: () => `###### ${this._inlineText(el)}\n\n`,
        p: () => `${this._inlineText(el)}\n\n`,
        hr: () => `---\n\n`,
        blockquote: () => this._convertBlockquote(el),
        pre: () => `\`\`\`\n${el.textContent || ''}\n\`\`\`\n\n`,
        ul: () => this._convertList(el, false),
        ol: () => this._convertList(el, true),
        table: () => this._convertTable(el)
      };

      if (handlers[tag]) {
        return handlers[tag]();
      }

      // Default: process child nodes
      return Array.from(el.childNodes).map(n => this._blockText(n)).join('');
    }

    static _convertBlockquote(el) {
      const lines = Array.from(el.childNodes).map(n => this._blockText(n)).join('').trim().split('\n');
      return lines.map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
    }

    static _convertList(el, isOrdered) {
      const items = Array.from(el.querySelectorAll(':scope > li'));
      const converted = items.map((li, i) => {
        const marker = isOrdered ? `${i + 1}.` : '-';
        return `${marker} ${this._inlineText(li).trim()}`;
      }).join('\n');
      return `${converted}\n\n`;
    }

    static _convertTable(el) {
      const rows = Array.from(el.querySelectorAll('tr'));
      if (!rows.length) return '';
      
      const getCells = row => Array.from(row.querySelectorAll('th,td'))
        .map(cell => this._inlineText(cell).replace(/\n/g, ' ').trim());
      
      const header = getCells(rows[0]);
      const separator = header.map(() => '---');
      const body = rows.slice(1).map(getCells);
      
      const lines = [
        `| ${header.join(' | ')} |`,
        `| ${separator.join(' | ')} |`,
        ...body.map(r => `| ${r.join(' | ')} |`)
      ];
      return `${lines.join('\n')}\n\n`;
    }
  }

  // ============================================================================
  // SIDEBAR MANAGER
  // ============================================================================

  /**
   * Manages the Gemini sidebar, including checkbox injection and bulk export UI
   */
  class SidebarManager {
    constructor() {
      this.observer = null;
    }

    /**
     * Injects checkboxes into the sidebar chat entries
     */
    injectCheckboxes() {
      const items = document.querySelectorAll(CONFIG.SELECTORS.SIDEBAR_ITEM);
      items.forEach(item => {
        if (item.querySelector(`.${CONFIG.SIDEBAR_CHECKBOX_CLASS}`)) return;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = CONFIG.SIDEBAR_CHECKBOX_CLASS;
        checkbox.checked = false;
        checkbox.title = 'Select for bulk export';

        Object.assign(checkbox.style, {
          marginRight: '8px',
          cursor: 'pointer',
          zIndex: '10'
        });

        // Prevent clicking the checkbox from navigating to the chat
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        // Insert at the beginning of the item
        item.prepend(checkbox);
      });
    }

    /**
     * Returns all selected sidebar chat entries
     */
    getSelectedEntries() {
      const selected = [];
      const items = document.querySelectorAll(CONFIG.SELECTORS.SIDEBAR_ITEM);
      items.forEach(item => {
        const cb = item.querySelector(`.${CONFIG.SIDEBAR_CHECKBOX_CLASS}`);
        if (cb && cb.checked) {
          const title = item.querySelector(CONFIG.SELECTORS.SIDEBAR_ITEM_TEXT)?.textContent?.trim() || 'Untitled Chat';
          selected.push({ element: item, title });
        }
      });
      return selected;
    }

    /**
     * Sets the checked state of all sidebar checkboxes
     */
    setAllChecked(checked) {
      document.querySelectorAll(`.${CONFIG.SIDEBAR_CHECKBOX_CLASS}`).forEach(cb => {
        cb.checked = checked;
      });
    }

    /**
     * Starts observing the sidebar for changes to re-inject checkboxes
     */
    observeSidebar() {
      if (this.observer) return;

      const sidebar = document.querySelector(CONFIG.SELECTORS.SIDEBAR_CONTAINER);
      if (!sidebar) return;

      this.observer = new MutationObserver(() => {
        this.injectCheckboxes();
      });

      this.observer.observe(sidebar, { childList: true, subtree: true });
      this.injectCheckboxes();
      this.injectControls();
    }

    /**
     * Injects the bulk export controls into the sidebar
     */
    injectControls() {
      if (document.getElementById(CONFIG.SIDEBAR_CONTROLS_ID)) return;

      const sidebar = document.querySelector(CONFIG.SELECTORS.SIDEBAR_CONTAINER);
      if (!sidebar) return;

      const controls = UIBuilder.createSidebarControls();

      // Try to find a good place to insert - maybe after the "New Chat" button or at the top
      sidebar.prepend(controls);

      this.attachControlListeners(controls);
    }

    /**
     * Attaches event listeners to the sidebar controls
     */
    attachControlListeners(controls) {
      controls.querySelector('#gemini-select-all').addEventListener('click', () => this.setAllChecked(true));
      controls.querySelector('#gemini-deselect-all').addEventListener('click', () => this.setAllChecked(false));
      controls.querySelector('#gemini-bulk-export').addEventListener('click', () => {
        const event = new CustomEvent('gemini-bulk-export-start', {
          detail: {
            format: controls.querySelector('#gemini-bulk-format').value
          }
        });
        document.dispatchEvent(event);
      });
    }

    /**
     * Updates the progress message in the sidebar
     */
    updateProgress(message) {
      const progress = document.getElementById('gemini-bulk-progress');
      if (progress) {
        progress.style.display = message ? 'block' : 'none';
        progress.textContent = message;
      }
    }
  }

  // ============================================================================
  // CHECKBOX MANAGER
  // ============================================================================
  class CheckboxManager {
    createCheckbox(type, container) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = CONFIG.CHECKBOX_CLASS;
      cb.checked = true;
      cb.title = `Include this ${type} message in export`;
      
      Object.assign(cb.style, {
        position: 'absolute',
        right: '28px',
        top: '8px',
        zIndex: '10000',
        transform: 'scale(1.2)'
      });
      
      container.style.position = 'relative';
      container.appendChild(cb);
      return cb;
    }

    injectCheckboxes() {
      const turns = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN);
      
      turns.forEach(turn => {
        // User query checkbox
        const userQueryElem = turn.querySelector(CONFIG.SELECTORS.USER_QUERY);
        if (userQueryElem && !userQueryElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`)) {
          this.createCheckbox('user', userQueryElem);
        }
        
        // Model response checkbox
        const modelRespElem = turn.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE);
        if (modelRespElem && !modelRespElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`)) {
          this.createCheckbox('Gemini', modelRespElem);
        }
      });
    }

    removeAll() {
      document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`).forEach(cb => cb.remove());
    }

    hasAnyChecked() {
      return Array.from(document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`))
        .some(cb => cb.checked);
    }
  }

  // ============================================================================
  // SELECTION MANAGER
  // ============================================================================
  class SelectionManager {
    constructor(checkboxManager) {
      this.checkboxManager = checkboxManager;
      this.lastSelection = 'all';
    }

    applySelection(value) {
      const checkboxes = document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`);
      
      switch(value) {
        case 'all':
          checkboxes.forEach(cb => cb.checked = true);
          break;
        case 'ai':
          document.querySelectorAll(`${CONFIG.SELECTORS.USER_QUERY} .${CONFIG.CHECKBOX_CLASS}`)
            .forEach(cb => cb.checked = false);
          document.querySelectorAll(`${CONFIG.SELECTORS.MODEL_RESPONSE} .${CONFIG.CHECKBOX_CLASS}`)
            .forEach(cb => cb.checked = true);
          break;
        case 'none':
          checkboxes.forEach(cb => cb.checked = false);
          break;
      }
      
      this.lastSelection = value;
    }

    reset() {
      this.lastSelection = 'all';
      const select = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      if (select) select.value = 'all';
    }

    reapplyIfNeeded() {
      const select = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      if (select && this.lastSelection !== 'custom') {
        select.value = this.lastSelection;
        this.applySelection(this.lastSelection);
      }
    }
  }

  // ============================================================================
  // UI BUILDER
  // ============================================================================
  class UIBuilder {
    static getInputStyles(isDark) {
      return isDark 
        ? `background:${CONFIG.STYLES.DARK_BG};color:${CONFIG.STYLES.DARK_TEXT};border:1px solid ${CONFIG.STYLES.DARK_BORDER};`
        : `background:${CONFIG.STYLES.LIGHT_BG};color:${CONFIG.STYLES.LIGHT_TEXT};border:1px solid ${CONFIG.STYLES.LIGHT_BORDER};`;
    }

    static createDropdownHTML() {
      const isDark = DOMUtils.isDarkMode();
      const inputStyles = this.getInputStyles(isDark);
      
      return `
        <div style="margin-top:10px;">
          <label style="margin-right:10px;">
            <input type="radio" name="${CONFIG.EXPORT_MODE_NAME}" value="file" checked>
            Export as file
          </label>
          <label>
            <input type="radio" name="${CONFIG.EXPORT_MODE_NAME}" value="clipboard">
            Export to clipboard
          </label>
        </div>
        <div id="gemini-filename-row" style="margin-top:10px;display:block;">
          <label for="${CONFIG.FILENAME_INPUT_ID}" style="font-weight:bold;">
            Filename <span style='color:#888;font-weight:normal;'>(optional)</span>:
          </label>
          <input id="${CONFIG.FILENAME_INPUT_ID}" type="text" 
                 style="margin-left:8px;padding:2px 8px;width:260px;${inputStyles}" 
                 value="">
          <span style="display:block;font-size:0.95em;color:#888;margin-top:2px;">
            Optional. Leave blank to use chat title or timestamp. 
            Only <b>.md</b> (Markdown) files are supported. Do not include an extension.
          </span>
        </div>
        <div style="margin-top:14px;">
          <label style="font-weight:bold;">Select messages:</label>
          <select id="${CONFIG.SELECT_DROPDOWN_ID}" 
                  style="margin-left:8px;padding:2px 8px;${inputStyles}">
            <option value="all">All</option>
            <option value="ai">Only answers</option>
            <option value="none">None</option>
            <option value="custom">Custom</option>
          </select>
        </div>
      `;
    }

    static createButton() {
      const btn = document.createElement('button');
      btn.id = CONFIG.BUTTON_ID;
      btn.textContent = 'Export Chat';
      
      Object.assign(btn.style, {
        position: 'fixed',
        top: '80px',
        right: '20px',
        zIndex: '9999',
        padding: '8px 16px',
        background: CONFIG.STYLES.BUTTON_PRIMARY,
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontSize: '1em',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        cursor: 'pointer',
        fontWeight: 'bold',
        transition: 'background 0.2s'
      });
      
      btn.addEventListener('mouseenter', () => btn.style.background = CONFIG.STYLES.BUTTON_HOVER);
      btn.addEventListener('mouseleave', () => btn.style.background = CONFIG.STYLES.BUTTON_PRIMARY);
      
      return btn;
    }

    static createDropdown() {
      const dropdown = document.createElement('div');
      dropdown.id = CONFIG.DROPDOWN_ID;
      
      const isDark = DOMUtils.isDarkMode();
      Object.assign(dropdown.style, {
        position: 'fixed',
        top: '124px',
        right: '20px',
        zIndex: '9999',
        border: '1px solid #ccc',
        borderRadius: '6px',
        padding: '10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        display: 'none',
        background: isDark ? '#222' : '#fff',
        color: isDark ? '#fff' : '#222'
      });
      
      dropdown.innerHTML = this.createDropdownHTML();
      return dropdown;
    }

      /**
       * Creates the bulk export controls for the sidebar
       */
      static createSidebarControls() {
        const container = document.createElement('div');
        container.id = CONFIG.SIDEBAR_CONTROLS_ID;

        const isDark = DOMUtils.isDarkMode();
        const inputStyles = this.getInputStyles(isDark);

        Object.assign(container.style, {
          padding: '12px',
          margin: '10px',
          borderRadius: '8px',
          background: isDark ? '#2a2a2a' : '#f0f2f5',
          fontSize: '0.9em',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        });

        container.innerHTML = `
          <div style="font-weight:bold;margin-bottom:4px;">Bulk Export</div>
          <div style="display:flex;gap:8px;">
            <button id="gemini-select-all" style="flex:1;padding:4px;cursor:pointer;border-radius:4px;border:1px solid #ccc;background:${isDark ? '#444' : '#fff'};color:${isDark ? '#fff' : '#000'}">Select All</button>
            <button id="gemini-deselect-all" style="flex:1;padding:4px;cursor:pointer;border-radius:4px;border:1px solid #ccc;background:${isDark ? '#444' : '#fff'};color:${isDark ? '#fff' : '#000'}">Deselect All</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label for="gemini-bulk-format">Format:</label>
            <select id="gemini-bulk-format" style="flex:1;padding:4px;${inputStyles} border-radius:4px;">
              <option value="md">Markdown</option>
              <option value="html">HTML</option>
              <option value="txt">Plain Text</option>
            </select>
          </div>
          <button id="gemini-bulk-export" style="padding:8px;cursor:pointer;background:${CONFIG.STYLES.BUTTON_PRIMARY};color:#fff;border:none;border-radius:4px;font-weight:bold;">Export Selected Chats</button>
          <div id="gemini-bulk-progress" style="display:none;font-size:0.85em;color:#888;text-align:center;"></div>
        `;

        return container;
      }
  }

  function tableToMarkdown(table, service) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';

    const toCells = row => Array.from(row.querySelectorAll('th,td'))
      .map(cell => service.turndown(cell.innerHTML).replace(/\n+/g, ' ').trim());

    const header = toCells(rows[0]);
    const separator = header.map(() => '---');
    const body = rows.slice(1).map(toCells);

    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${separator.join(' | ')} |`,
      ...body.map(r => `| ${r.join(' | ')} |`)
    ];

    return `${lines.join('\n')}\n\n`;
  }

  function inlineText(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node;
    if (el.matches(CONFIG.MATH_INLINE_SELECTOR)) {
      const latex = el.getAttribute('data-math') || '';
      return `$${latex}$`;
    }

    const tag = el.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'b' || tag === 'strong') {
      return `**${Array.from(el.childNodes).map(inlineText).join('')}**`;
    }
    if (tag === 'i' || tag === 'em') {
      return `*${Array.from(el.childNodes).map(inlineText).join('')}*`;
    }
    if (tag === 'code') {
      return `\`${el.textContent || ''}\``;
    }

    return Array.from(el.childNodes).map(inlineText).join('');
  }

  function blockText(el) {
    if (!el) return '';

    if (el.nodeType === Node.TEXT_NODE) {
      return (el.textContent || '').trim();
    }

    if (el.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = el.tagName.toLowerCase();

    if (el.matches(CONFIG.MATH_BLOCK_SELECTOR)) {
      const latex = el.getAttribute('data-math') || '';
      return `$$${latex}$$\n\n`;
    }

    switch (tag) {
      case 'h1': return `# ${inlineText(el)}\n\n`;
      case 'h2': return `## ${inlineText(el)}\n\n`;
      case 'h3': return `### ${inlineText(el)}\n\n`;
      case 'h4': return `#### ${inlineText(el)}\n\n`;
      case 'h5': return `##### ${inlineText(el)}\n\n`;
      case 'h6': return `###### ${inlineText(el)}\n\n`;
      case 'p': return `${inlineText(el)}\n\n`;
      case 'hr': return `---\n\n`;
      case 'blockquote': {
        const lines = Array.from(el.childNodes).map(blockText).join('').trim().split('\n');
        return lines.map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
      }
      case 'pre': {
        const code = el.textContent || '';
        return `\
\
\
${code}\n\
\
\n`;
      }
      case 'ul': {
        const items = Array.from(el.querySelectorAll(':scope > li'))
          .map(li => `- ${inlineText(li).trim()}`)
          .join('\n');
        return `${items}\n\n`;
      }
      case 'ol': {
        const items = Array.from(el.querySelectorAll(':scope > li'))
          .map((li, i) => `${i + 1}. ${inlineText(li).trim()}`)
          .join('\n');
        return `${items}\n\n`;
      }
      case 'table': {
        const rows = Array.from(el.querySelectorAll('tr'));
        if (!rows.length) return '';
        const cells = row => Array.from(row.querySelectorAll('th,td'))
          .map(cell => inlineText(cell).replace(/\n/g, ' ').trim());
        const header = cells(rows[0]);
        const sep = header.map(() => '---');
        const body = rows.slice(1).map(r => cells(r));
        const lines = [
          `| ${header.join(' | ')} |`,
          `| ${sep.join(' | ')} |`,
          ...body.map(r => `| ${r.join(' | ')} |`)
        ];
        return `${lines.join('\n')}\n\n`;
      }
      case 'div':
      case 'section':
      case 'article':
      default: {
        return Array.from(el.childNodes).map(blockText).join('');
      }
    }
  }

  // ============================================================================
  // BULK EXPORT SERVICE
  // ============================================================================

  /**
   * Orchestrates the bulk export of multiple chats
   */
  class BulkExportService {
    constructor(sidebarManager, exportService) {
      this.sidebarManager = sidebarManager;
      this.exportService = exportService;
      this.isExporting = false;
    }

    /**
     * Executes the bulk export process
     */
    async execute(format) {
      if (this.isExporting) return;

      const selectedEntries = this.sidebarManager.getSelectedEntries();
      if (selectedEntries.length === 0) {
        alert('Please select at least one chat to export from the sidebar.');
        return;
      }

      if (!confirm(`Export ${selectedEntries.length} chats as ${format.toUpperCase()}?`)) {
        return;
      }

      this.isExporting = true;
      try {
        for (let i = 0; i < selectedEntries.length; i++) {
          const entry = selectedEntries[i];
          this.sidebarManager.updateProgress(`Exporting ${i + 1} of ${selectedEntries.length}: ${entry.title}...`);

          // Navigate to the chat
          entry.element.click();

          // Wait for chat to load (wait for title or messages)
          await this._waitForChatLoad(entry.title);

          // Use existing logic to export the current chat
          await this.exportService.executeForBulk(format, entry.title);

          // Short delay between exports
          await DOMUtils.sleep(1000);
        }

        DOMUtils.createNotification(`Bulk export of ${selectedEntries.length} chats completed!`);
      } catch (error) {
        console.error('Bulk export error:', error);
        alert(`Bulk export failed: ${error.message}`);
      } finally {
        this.isExporting = false;
        this.sidebarManager.updateProgress('');
      }
    }

    /**
     * Waits for the chat to be loaded after navigation
     */
    async _waitForChatLoad(expectedTitle) {
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        const currentTitle = FilenameService.getConversationTitle();
        const messages = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN);

        // If title matches or we have messages, consider it loaded
        if (messages.length > 0) {
          // Give it a bit more time to be sure it's fully rendered
          await DOMUtils.sleep(1000);
          return;
        }

        await DOMUtils.sleep(1000);
        attempts++;
      }

      throw new Error(`Timed out waiting for chat "${expectedTitle}" to load.`);
    }
  }

  // ============================================================================
  // EXPORT SERVICE
  // ============================================================================
  class ExportService {
    constructor(checkboxManager) {
      this.checkboxManager = checkboxManager;
      this.markdownConverter = new MarkdownConverter();
    }

    _buildMarkdownHeader(conversationTitle) {
      const title = conversationTitle || CONFIG.MARKDOWN_HEADER;
      const timestamp = DateUtils.getLocaleString();
      return `# ${title}\n\n> ${CONFIG.EXPORT_TIMESTAMP_FORMAT} ${timestamp}\n\n---\n\n`;
    }

    async buildMarkdown(turns, conversationTitle) {
      let markdown = this._buildMarkdownHeader(conversationTitle);

      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        DOMUtils.createNotification(`Processing message ${i + 1} of ${turns.length}...`);

        // User message
        const userQueryElem = turn.querySelector(CONFIG.SELECTORS.USER_QUERY);
        if (userQueryElem) {
          const cb = userQueryElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`);
          if (cb?.checked) {
            const userQuery = this.markdownConverter.extractUserQuery(userQueryElem);
            if (userQuery) {
              markdown += `## 👤 You\n\n${userQuery}\n\n`;
            }
          }
        }

        // Model response (DOM-based extraction)
        const modelRespElem = turn.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE);
        if (modelRespElem) {
          const cb = modelRespElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`);
          if (cb?.checked) {
            const modelResponse = this.markdownConverter.extractModelResponse(modelRespElem);
            if (modelResponse) {
              markdown += `## 🤖 Gemini\n\n${modelResponse}\n\n`;
            } else {
              markdown += `## 🤖 Gemini\n\n[Note: Could not extract model response from message ${i + 1}.]\n\n`;
            }
          }
        }

        markdown += '---\n\n';
      }

      return markdown;
    }

    async execute(exportMode, customFilename) {
      try {
        // Load all messages
        await ScrollService.loadAllMessages();

        // Get all turns and inject checkboxes
        const turns = Array.from(document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN));
        this.checkboxManager.injectCheckboxes();

        // Check if any messages selected
        if (!this.checkboxManager.hasAnyChecked()) {
          alert('Please select at least one message to export using the checkboxes or the dropdown.');
          return;
        }

        // Get title and build markdown
        const conversationTitle = FilenameService.getConversationTitle();
        const markdown = await this.buildMarkdown(turns, conversationTitle);

        // Export based on mode
        if (exportMode === 'clipboard') {
          await FileExportService.exportToClipboard(markdown);
        } else {
          const filename = FilenameService.generate(customFilename, conversationTitle);
          FileExportService.downloadMarkdown(markdown, filename);
        }

      } catch (error) {
        console.error('Export error:', error);
        alert(`Export failed: ${error.message}`);
      }
    }

    /**
     * Specialized execution for bulk export to avoid re-initializing sidebar checkboxes
     */
    async executeForBulk(format, title) {
      // Load all messages
      await ScrollService.loadAllMessages();

      // Get all turns
      const turns = Array.from(document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN));

      // Checkboxes are NOT injected here as they might interfere with sidebar ones
      // We assume "All" messages for bulk export for now, or we could inject/reuse logic

      let markdown = this._buildMarkdownHeader(title);
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];

        // User message
        const userQueryElem = turn.querySelector(CONFIG.SELECTORS.USER_QUERY);
        if (userQueryElem) {
          const userQuery = this.markdownConverter.extractUserQuery(userQueryElem);
          if (userQuery) {
            markdown += `## 👤 You\n\n${userQuery}\n\n`;
          }
        }

        // Model response
        const modelRespElem = turn.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE);
        if (modelRespElem) {
          const modelResponse = this.markdownConverter.extractModelResponse(modelRespElem);
          if (modelResponse) {
            markdown += `## 🤖 Gemini\n\n${modelResponse}\n\n`;
          }
        }
        markdown += '---\n\n';
      }

      const filename = FilenameService.generate('', title);

      let finalContent = markdown;
      if (format === 'html') {
        finalContent = HtmlConverter.convert(markdown, title);
      } else if (format === 'txt') {
        finalContent = TxtConverter.convert(markdown);
      }

      FileExportService.download(finalContent, filename, format);
    }
  }

  // ============================================================================
  // EXPORT CONTROLLER
  // ============================================================================
  class ExportController {
    constructor() {
      this.sidebarManager = new SidebarManager();
      this.checkboxManager = new CheckboxManager();
      this.selectionManager = new SelectionManager(this.checkboxManager);
      this.exportService = new ExportService(this.checkboxManager);
      this.bulkExportService = new BulkExportService(this.sidebarManager, this.exportService);
      this.button = null;
      this.dropdown = null;
    }

    init() {
      this.createUI();
      this.attachEventListeners();
      this.observeStorageChanges();

      // Initialize sidebar observation
      this.sidebarManager.observeSidebar();
    }

    createUI() {
      this.button = UIBuilder.createButton();
      this.dropdown = UIBuilder.createDropdown();
      
      document.body.appendChild(this.dropdown);
      document.body.appendChild(this.button);
      
      this.setupFilenameRowToggle();
    }

    setupFilenameRowToggle() {
      const updateFilenameRow = () => {
        const fileRow = this.dropdown.querySelector('#gemini-filename-row');
        const fileRadio = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"][value="file"]`);
        if (fileRow && fileRadio) {
          fileRow.style.display = fileRadio.checked ? 'block' : 'none';
        }
      };

      this.dropdown.querySelectorAll(`input[name="${CONFIG.EXPORT_MODE_NAME}"]`)
        .forEach(radio => radio.addEventListener('change', updateFilenameRow));
      
      updateFilenameRow();
    }

    attachEventListeners() {
      // Button click
      this.button.addEventListener('click', () => this.handleButtonClick());

      // Selection dropdown
      const selectDropdown = this.dropdown.querySelector(`#${CONFIG.SELECT_DROPDOWN_ID}`);
      selectDropdown.addEventListener('change', (e) => this.handleSelectionChange(e.target.value));

      // Checkbox manual changes
      document.addEventListener('change', (e) => {
        if (e.target?.classList?.contains(CONFIG.CHECKBOX_CLASS)) {
          const select = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
          if (select && select.value !== 'custom') {
            select.value = 'custom';
            this.selectionManager.lastSelection = 'custom';
          }
        }
      });

      // Click outside to hide dropdown
      document.addEventListener('mousedown', (e) => {
        if (this.dropdown.style.display !== 'none' && 
            !this.dropdown.contains(e.target) && 
            e.target !== this.button) {
          this.dropdown.style.display = 'none';
        }
      });

      // Bulk export listener
      document.addEventListener('gemini-bulk-export-start', (e) => {
        this.bulkExportService.execute(e.detail.format);
      });
    }

    handleSelectionChange(value) {
      this.checkboxManager.injectCheckboxes();
      this.selectionManager.applySelection(value);
    }

    async handleButtonClick() {
      this.checkboxManager.injectCheckboxes();
      
      if (this.dropdown.style.display === 'none') {
        this.dropdown.style.display = '';
        return;
      }

      this.button.disabled = true;
      this.button.textContent = 'Exporting...';

      try {
        const exportMode = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"]:checked`)?.value || 'file';
        const customFilename = exportMode === 'file' 
          ? this.dropdown.querySelector(`#${CONFIG.FILENAME_INPUT_ID}`)?.value.trim() || ''
          : '';

        this.dropdown.style.display = 'none';
        
        await this.exportService.execute(exportMode, customFilename);

        // Cleanup after export
        this.checkboxManager.removeAll();
        this.selectionManager.reset();
        
        if (exportMode === 'file') {
          const filenameInput = this.dropdown.querySelector(`#${CONFIG.FILENAME_INPUT_ID}`);
          if (filenameInput) filenameInput.value = '';
        }

      } catch (error) {
        console.error('Export error:', error);
      } finally {
        this.button.disabled = false;
        this.button.textContent = 'Export Chat';
      }
    }

    observeStorageChanges() {
      const updateVisibility = () => {
        try {
          if (chrome?.storage?.sync) {
            chrome.storage.sync.get(['hideExportBtn'], (result) => {
              this.button.style.display = result.hideExportBtn ? 'none' : '';
            });
          }
        } catch (e) {
          console.error('Storage access error:', e);
        }
      };

      updateVisibility();

      const observer = new MutationObserver(updateVisibility);
      observer.observe(document.body, { childList: true, subtree: true });

      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'sync' && 'hideExportBtn' in changes) {
            updateVisibility();
          }
        });
      }
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  const controller = new ExportController();
  controller.init();

})();
