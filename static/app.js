/**
 * Ashh — Document-Grounded AI Chatbot
 * Clean, modern single-page client with streaming SSE, interactive citations, and offline fallback support.
 */

(function () {
  'use strict';

  // Configure marked for safe, clean parsing
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
  }

  // Application State
  const state = {
    currentChatId: null,
    currentChatTitle: 'New Chat',
    chats: [],
    documents: [],
    selectedDocScope: 'all', // 'all' or list of selected doc IDs
    topK: 5,
    activeModel: 'claude-3-5-sonnet-20241022',
    isApiKeyConfigured: false,
    theme: 'light',
    isGenerating: false,
    abortController: null,
    pendingDeleteAction: null,
    attachedFiles: [] // Array of File objects attached directly in composer
  };

  // DOM Elements
  const el = {
    app: document.getElementById('app'),
    sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebar-backdrop'),
    btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
    btnCloseSidebar: document.getElementById('btn-close-sidebar'),
    btnNewChat: document.getElementById('btn-new-chat'),
    chatSearch: document.getElementById('chat-search'),
    btnClearSearch: document.getElementById('btn-clear-search'),
    chatListContainer: document.getElementById('chat-list-container'),
    chatSkeletons: document.getElementById('chat-skeletons'),
    chatEmptyState: document.getElementById('chat-empty-state'),
    chatSearchEmpty: document.getElementById('chat-search-empty'),
    groupToday: document.getElementById('group-today'),
    groupYesterday: document.getElementById('group-yesterday'),
    groupEarlier: document.getElementById('group-earlier'),
    
    // Topbar & Scope
    chatTitleDisplay: document.getElementById('chat-title-display'),
    btnRenameTitle: document.getElementById('btn-rename-title'),
    btnScopeSelector: document.getElementById('btn-scope-selector'),
    scopeMenu: document.getElementById('scope-menu'),
    scopeLabel: document.getElementById('scope-label'),
    scopeRadioAll: document.getElementById('scope-radio-all'),
    scopeDocCheckboxes: document.getElementById('scope-doc-checkboxes'),
    btnExportChat: document.getElementById('btn-export-chat'),

    // Documents
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    btnOpenPasteModal: document.getElementById('btn-open-paste-modal'),
    documentList: document.getElementById('document-list'),
    docSkeletons: document.getElementById('doc-skeletons'),
    docEmptyState: document.getElementById('doc-empty-state'),
    docBadgeCount: document.getElementById('doc-badge-count'),

    // Chat Area
    chatArea: document.getElementById('chat-area'),
    welcomeHero: document.getElementById('welcome-hero'),
    messagesContainer: document.getElementById('messages-container'),

    // Composer
    composerForm: document.getElementById('composer-form'),
    composerBox: document.getElementById('composer-box'),
    composerAttachments: document.getElementById('composer-attachments'),
    composerInput: document.getElementById('composer-input'),
    btnAttachComposer: document.getElementById('btn-attach-composer'),
    composerFileInput: document.getElementById('composer-file-input'),
    btnSend: document.getElementById('btn-send'),
    btnStopGenerating: document.getElementById('btn-stop-generating'),
    charCounter: document.getElementById('char-counter'),
    streamingNotice: document.getElementById('streaming-notice'),

    // Footer & Status
    statusLabel: document.getElementById('status-label'),
    footerStatus: document.getElementById('footer-status'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    themeIconSun: document.getElementById('theme-icon-sun'),
    themeIconMoon: document.getElementById('theme-icon-moon'),
    btnSettings: document.getElementById('btn-settings'),

    // Modals
    citationModal: document.getElementById('citation-modal'),
    citationBadge: document.getElementById('citation-badge'),
    citationDocName: document.getElementById('citation-doc-name'),
    citationDocPage: document.getElementById('citation-doc-page'),
    citationTextContent: document.getElementById('citation-text-content'),
    btnCloseCitation: document.getElementById('btn-close-citation'),
    btnCitationDone: document.getElementById('btn-citation-done'),
    btnCitationCopy: document.getElementById('btn-citation-copy'),

    settingsModal: document.getElementById('settings-modal'),
    settingTopK: document.getElementById('setting-top-k'),
    settingTopKVal: document.getElementById('setting-top-k-val'),
    settingModelName: document.getElementById('setting-model-name'),
    healthDbStatus: document.getElementById('health-db-status'),
    healthChromaStatus: document.getElementById('health-chroma-status'),
    healthApiStatus: document.getElementById('health-api-status'),
    healthChunksCount: document.getElementById('health-chunks-count'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnResetSettings: document.getElementById('btn-reset-settings'),
    btnSaveSettings: document.getElementById('btn-save-settings'),

    confirmModal: document.getElementById('confirm-modal'),
    confirmModalTitle: document.getElementById('confirm-modal-title'),
    confirmModalText: document.getElementById('confirm-modal-text'),
    btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
    btnConfirmProceed: document.getElementById('btn-confirm-proceed'),
    btnCloseConfirm: document.getElementById('btn-close-confirm'),

    renameModal: document.getElementById('rename-modal'),
    renameInput: document.getElementById('rename-input'),
    btnRenameCancel: document.getElementById('btn-rename-cancel'),
    btnRenameSave: document.getElementById('btn-rename-save'),
    btnCloseRename: document.getElementById('btn-close-rename'),

    pasteModal: document.getElementById('paste-modal'),
    pasteDocTitle: document.getElementById('paste-doc-title'),
    pasteDocContent: document.getElementById('paste-doc-content'),
    btnClosePaste: document.getElementById('btn-close-paste'),
    btnPasteCancel: document.getElementById('btn-paste-cancel'),
    btnPasteSave: document.getElementById('btn-paste-save'),

    toastContainer: document.getElementById('toast-container')
  };

  // -------------------------------------------------------------
  // Helpers & Toast Notifications
  // -------------------------------------------------------------

  function showToast(message, type = 'info', actionText = null, onAction = null) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(textSpan);

    if (actionText && onAction) {
      const actionBtn = document.createElement('button');
      actionBtn.className = 'toast-action';
      actionBtn.textContent = actionText;
      actionBtn.onclick = () => {
        onAction();
        toast.remove();
      };
      toast.appendChild(actionBtn);
    }

    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4500);
  }

  function sanitizeHtml(rawHtml) {
    if (window.DOMPurify) {
      return DOMPurify.sanitize(rawHtml, {
        ADD_ATTR: ['target', 'data-citation', 'data-chunk-id']
      });
    }
    return rawHtml;
  }

  function formatRelativeDate(isoString) {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now - date;
      const diffHours = diffMs / (1000 * 60 * 60);

      const isToday = date.toDateString() === now.toDateString();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday = date.toDateString() === yesterday.toDateString();

      if (isToday) return 'today';
      if (isYesterday) return 'yesterday';
      return 'earlier';
    } catch (e) {
      return 'earlier';
    }
  }

  // -------------------------------------------------------------
  // Theme Management
  // -------------------------------------------------------------

  function initTheme() {
    const savedTheme = localStorage.getItem('ashh_theme');
    if (savedTheme) {
      setTheme(savedTheme);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark ? 'dark' : 'light');
    }
  }

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ashh_theme', theme);
    if (theme === 'dark') {
      el.themeIconSun.classList.add('hidden');
      el.themeIconMoon.classList.remove('hidden');
    } else {
      el.themeIconSun.classList.remove('hidden');
      el.themeIconMoon.classList.add('hidden');
    }
  }

  function toggleTheme() {
    setTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  // -------------------------------------------------------------
  // Health & Settings Initialization
  // -------------------------------------------------------------

  async function fetchHealth() {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('Health check error');
      const data = await res.json();
      
      state.activeModel = data.model;
      state.isApiKeyConfigured = data.api_key_configured;

      el.settingModelName.value = data.model;
      el.healthDbStatus.textContent = data.database;
      el.healthChromaStatus.textContent = data.vector_store;
      el.healthApiStatus.textContent = data.api_key_configured ? 'Active (Claude)' : 'Offline (Extractive Mode)';
      el.healthChunksCount.textContent = data.chunk_count;

      if (!data.api_key_configured) {
        el.statusLabel.textContent = 'Offline Mode';
        const dot = el.footerStatus.querySelector('.status-dot');
        if (dot) {
          dot.className = 'status-dot status-offline';
        }
      } else {
        el.statusLabel.textContent = 'Ready (Claude)';
        const dot = el.footerStatus.querySelector('.status-dot');
        if (dot) {
          dot.className = 'status-dot status-ok';
        }
      }
    } catch (err) {
      el.statusLabel.textContent = 'Degraded';
    }
  }

  function loadSettings() {
    const savedTopK = localStorage.getItem('ashh_top_k');
    if (savedTopK) {
      state.topK = parseInt(savedTopK, 10);
      el.settingTopK.value = state.topK;
      el.settingTopKVal.textContent = state.topK;
    }
  }

  function saveSettings() {
    state.topK = parseInt(el.settingTopK.value, 10);
    localStorage.setItem('ashh_top_k', state.topK);
    closeModal(el.settingsModal);
    showToast('Settings saved', 'success');
  }

  function resetSettings() {
    el.settingTopK.value = 5;
    el.settingTopKVal.textContent = '5';
  }

  // -------------------------------------------------------------
  // Document Operations & Dropzone
  // -------------------------------------------------------------

  async function fetchDocuments() {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) throw new Error('Failed to fetch documents');
      state.documents = await res.json();
      renderDocuments();
      updateScopeDropdown();
    } catch (err) {
      showToast('Error loading documents', 'error');
    }
  }

  function renderDocuments() {
    el.docSkeletons.classList.add('hidden');
    el.docBadgeCount.textContent = state.documents.length;

    if (state.documents.length === 0) {
      el.docEmptyState.classList.remove('hidden');
      el.documentList.innerHTML = '';
      el.documentList.appendChild(el.docEmptyState);
      return;
    }

    el.docEmptyState.classList.add('hidden');
    el.documentList.innerHTML = '';

    state.documents.forEach(doc => {
      const item = document.createElement('div');
      item.className = 'doc-item';
      item.innerHTML = `
        <div class="doc-info" title="${doc.name}">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" class="doc-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div class="doc-meta">
            <span class="doc-name">${doc.name}</span>
            <span class="doc-sub">${doc.page_count} ${doc.page_count === 1 ? 'page' : 'pages'} • ${doc.chunk_count} chunks</span>
          </div>
        </div>
        <button class="btn-icon-sm btn-delete-doc" data-id="${doc.id}" data-name="${doc.name}" aria-label="Delete document ${doc.name}" title="Delete document">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      `;

      item.querySelector('.btn-delete-doc').onclick = (e) => {
        e.stopPropagation();
        confirmDeleteDocument(doc.id, doc.name);
      };

      el.documentList.appendChild(item);
    });
  }

  function confirmDeleteDocument(docId, docName) {
    state.pendingDeleteAction = async () => {
      try {
        const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Deletion failed');
        showToast(`Document "${docName}" deleted`, 'success');
        await fetchDocuments();
        await fetchHealth();
      } catch (err) {
        showToast(`Could not delete document: ${err.message}`, 'error');
      }
    };
    openConfirmModal('Delete Document', `Are you sure you want to delete "${docName}"? Its indexed vector chunks will also be removed.`);
  }

  async function handleFileUpload(files) {
    if (!files || files.length === 0) return;

    const validPdfs = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        showToast(`"${file.name}" rejected: Only PDF documents are supported.`, 'error');
        continue;
      }
      if (file.size > 25 * 1024 * 1024) {
        showToast(`"${file.name}" rejected: Exceeds 25 MB limit.`, 'error');
        continue;
      }
      validPdfs.push(file);
    }

    if (validPdfs.length === 0) return;

    const formData = new FormData();
    validPdfs.forEach(f => formData.append('files', f));

    showToast(`Uploading ${validPdfs.length} document(s)...`, 'info');

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Upload failed');
      }

      const data = await res.json();
      showToast(data.message, 'success');

      if (data.skipped_empty_pages && Object.keys(data.skipped_empty_pages).length > 0) {
        for (const [name, pages] of Object.entries(data.skipped_empty_pages)) {
          showToast(`Note: Page(s) ${pages.join(', ')} of "${name}" were empty or scanned and skipped.`, 'info');
        }
      }

      await fetchDocuments();
      await fetchHealth();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // -------------------------------------------------------------
  // Scope Filter Dropdown
  // -------------------------------------------------------------

  function updateScopeDropdown() {
    el.scopeDocCheckboxes.innerHTML = '';
    if (state.documents.length === 0) {
      el.scopeDocCheckboxes.innerHTML = '<span class="empty-hint">No documents available</span>';
      el.scopeLabel.textContent = 'All Documents';
      state.selectedDocScope = 'all';
      return;
    }

    state.documents.forEach(doc => {
      const label = document.createElement('label');
      label.className = 'dropdown-item checkbox-item';
      label.innerHTML = `
        <input type="checkbox" class="scope-checkbox" value="${doc.id}">
        <span class="doc-name" title="${doc.name}">${doc.name}</span>
      `;

      const cb = label.querySelector('input');
      cb.addEventListener('change', onScopeCheckboxChange);
      el.scopeDocCheckboxes.appendChild(label);
    });
  }

  function onScopeCheckboxChange() {
    const checked = Array.from(el.scopeDocCheckboxes.querySelectorAll('.scope-checkbox:checked')).map(c => c.value);
    if (checked.length === 0) {
      el.scopeRadioAll.checked = true;
      state.selectedDocScope = 'all';
      el.scopeLabel.textContent = 'All Documents';
    } else {
      el.scopeRadioAll.checked = false;
      state.selectedDocScope = checked;
      el.scopeLabel.textContent = checked.length === 1 ? '1 Document' : `${checked.length} Documents`;
    }
  }

  el.scopeRadioAll.addEventListener('change', () => {
    if (el.scopeRadioAll.checked) {
      el.scopeDocCheckboxes.querySelectorAll('.scope-checkbox').forEach(c => c.checked = false);
      state.selectedDocScope = 'all';
      el.scopeLabel.textContent = 'All Documents';
    }
  });

  // -------------------------------------------------------------
  // Chat Operations
  // -------------------------------------------------------------

  async function fetchChats() {
    try {
      const res = await fetch('/api/chats');
      if (!res.ok) throw new Error('Failed to load chats');
      state.chats = await res.json();
      renderChatList();

      // Restore last active chat or select first
      const savedChatId = localStorage.getItem('ashh_active_chat');
      if (savedChatId && state.chats.some(c => c.id === savedChatId)) {
        await selectChat(savedChatId);
      } else if (state.chats.length > 0) {
        await selectChat(state.chats[0].id);
      } else {
        await createNewChat();
      }
    } catch (err) {
      showToast('Error loading chat conversations', 'error');
    }
  }

  function renderChatList(filterQuery = '') {
    el.chatSkeletons.classList.add('hidden');
    const query = filterQuery.toLowerCase().trim();

    const filtered = state.chats.filter(c => c.title.toLowerCase().includes(query));

    el.groupToday.classList.add('hidden');
    el.groupYesterday.classList.add('hidden');
    el.groupEarlier.classList.add('hidden');
    el.groupToday.querySelector('.group-items').innerHTML = '';
    el.groupYesterday.querySelector('.group-items').innerHTML = '';
    el.groupEarlier.querySelector('.group-items').innerHTML = '';

    if (state.chats.length === 0) {
      el.chatEmptyState.classList.remove('hidden');
      el.chatSearchEmpty.classList.add('hidden');
      return;
    }
    el.chatEmptyState.classList.add('hidden');

    if (filtered.length === 0) {
      el.chatSearchEmpty.classList.remove('hidden');
      return;
    }
    el.chatSearchEmpty.classList.add('hidden');

    filtered.forEach(chat => {
      const groupKey = formatRelativeDate(chat.updated_at || chat.created_at);
      let targetGroup = el.groupEarlier;
      if (groupKey === 'today') targetGroup = el.groupToday;
      else if (groupKey === 'yesterday') targetGroup = el.groupYesterday;

      targetGroup.classList.remove('hidden');

      const item = document.createElement('div');
      item.className = `chat-item ${chat.id === state.currentChatId ? 'active' : ''}`;
      item.dataset.id = chat.id;
      item.innerHTML = `
        <span class="chat-item-title" title="${chat.title}">${chat.title}</span>
        <div class="chat-item-actions">
          <button class="btn-icon-sm btn-rename" aria-label="Rename conversation" title="Rename">
            <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="btn-icon-sm btn-delete" aria-label="Delete conversation" title="Delete">
            <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          selectChat(chat.id);
          if (window.innerWidth <= 768) closeSidebar();
        }
      });

      item.querySelector('.btn-rename').onclick = (e) => {
        e.stopPropagation();
        openRenameModal(chat.id, chat.title);
      };

      item.querySelector('.btn-delete').onclick = (e) => {
        e.stopPropagation();
        confirmDeleteChat(chat.id, chat.title);
      };

      targetGroup.querySelector('.group-items').appendChild(item);
    });
  }

  async function createNewChat() {
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat' })
      });
      if (!res.ok) throw new Error('Could not create chat');
      const chat = await res.json();
      state.chats.unshift(chat);
      renderChatList(el.chatSearch.value);
      await selectChat(chat.id);
      el.composerInput.focus();
    } catch (err) {
      showToast('Error creating new conversation', 'error');
    }
  }

  async function selectChat(chatId) {
    if (state.isGenerating) {
      showToast('Please wait or stop current generation first', 'info');
      return;
    }

    state.currentChatId = chatId;
    localStorage.setItem('ashh_active_chat', chatId);

    const chat = state.chats.find(c => c.id === chatId);
    state.currentChatTitle = chat ? chat.title : 'New Chat';
    el.chatTitleDisplay.textContent = state.currentChatTitle;

    // Highlight active in list
    document.querySelectorAll('.chat-item').forEach(it => {
      it.classList.toggle('active', it.dataset.id === chatId);
    });

    await loadChatMessages(chatId);
  }

  async function loadChatMessages(chatId) {
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`);
      if (!res.ok) throw new Error('Could not load messages');
      const messages = await res.json();

      el.messagesContainer.innerHTML = '';
      if (messages.length === 0) {
        el.welcomeHero.classList.remove('hidden');
        el.messagesContainer.classList.add('hidden');
      } else {
        el.welcomeHero.classList.add('hidden');
        el.messagesContainer.classList.remove('hidden');
        messages.forEach(msg => appendMessageToUi(msg));
        scrollToBottom();
      }
    } catch (err) {
      showToast('Error loading message history', 'error');
    }
  }

  function confirmDeleteChat(chatId, chatTitle) {
    state.pendingDeleteAction = async () => {
      try {
        const res = await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Deletion failed');
        state.chats = state.chats.filter(c => c.id !== chatId);
        showToast('Conversation deleted', 'success');
        if (state.currentChatId === chatId) {
          if (state.chats.length > 0) {
            await selectChat(state.chats[0].id);
          } else {
            await createNewChat();
          }
        }
        renderChatList(el.chatSearch.value);
      } catch (err) {
        showToast(`Could not delete conversation: ${err.message}`, 'error');
      }
    };
    openConfirmModal('Delete Conversation', `Are you sure you want to delete "${chatTitle}"? This will permanently erase its message history.`);
  }

  function openRenameModal(chatId, currentTitle) {
    state.editingChatId = chatId;
    el.renameInput.value = currentTitle;
    openModal(el.renameModal);
    setTimeout(() => el.renameInput.focus(), 100);
  }

  async function saveRename() {
    const newTitle = el.renameInput.value.trim();
    if (!newTitle) return;
    try {
      const res = await fetch(`/api/chats/${state.editingChatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
      if (!res.ok) throw new Error('Rename failed');
      const updated = await res.json();
      const chat = state.chats.find(c => c.id === state.editingChatId);
      if (chat) chat.title = updated.title;
      if (state.currentChatId === state.editingChatId) {
        state.currentChatTitle = updated.title;
        el.chatTitleDisplay.textContent = updated.title;
      }
      renderChatList(el.chatSearch.value);
      closeModal(el.renameModal);
      showToast('Conversation renamed', 'success');
    } catch (err) {
      showToast(`Rename failed: ${err.message}`, 'error');
    }
  }

  // -------------------------------------------------------------
  // Message UI Rendering & Citations
  // -------------------------------------------------------------

  function renderMarkdownWithCitations(content, citations = []) {
    let html = marked.parse(content || '');
    html = sanitizeHtml(html);

    // Replace bracketed citations [1], [2], etc. with interactive button chips
    html = html.replace(/\[(\d+)\]/g, (match, num) => {
      const citIndex = parseInt(num, 10);
      return `<button class="citation-chip" data-citation="${citIndex}" aria-label="View source citation [${citIndex}]">[${citIndex}]</button>`;
    });

    return html;
  }

  function appendMessageToUi(msg) {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}`;
    row.dataset.id = msg.id;

    if (msg.role === 'user') {
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble-user';
      bubble.textContent = msg.content;
      row.appendChild(bubble);
    } else {
      const body = document.createElement('div');
      body.className = 'message-assistant-body';

      if (msg.is_offline_mode) {
        const offlineBadge = document.createElement('div');
        offlineBadge.className = 'offline-pill';
        offlineBadge.innerHTML = '⚡ Offline Mode (Extractive)';
        body.appendChild(offlineBadge);
      }

      const contentDiv = document.createElement('div');
      contentDiv.className = 'markdown-content';
      contentDiv.innerHTML = renderMarkdownWithCitations(msg.content, msg.citations);
      body.appendChild(contentDiv);

      // Assistant Actions
      const actions = document.createElement('div');
      actions.className = 'assistant-actions';

      // Copy Action
      const btnCopy = document.createElement('button');
      btnCopy.className = 'btn-action';
      btnCopy.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>`;
      btnCopy.onclick = () => {
        navigator.clipboard.writeText(msg.content);
        showToast('Copied to clipboard', 'success');
      };
      actions.appendChild(btnCopy);

      // Regenerate Action
      const btnRegen = document.createElement('button');
      btnRegen.className = 'btn-action';
      btnRegen.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg><span>Regenerate</span>`;
      btnRegen.onclick = () => regenerateLastUserMessage();
      actions.appendChild(btnRegen);

      // Thumbs Up
      const btnThumbsUp = document.createElement('button');
      btnThumbsUp.className = `btn-action ${msg.feedback === 'up' ? 'active' : ''}`;
      btnThumbsUp.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`;
      btnThumbsUp.onclick = () => toggleFeedback(msg.id, 'up', btnThumbsUp, btnThumbsDown);
      actions.appendChild(btnThumbsUp);

      // Thumbs Down
      const btnThumbsDown = document.createElement('button');
      btnThumbsDown.className = `btn-action ${msg.feedback === 'down' ? 'active' : ''}`;
      btnThumbsDown.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>`;
      btnThumbsDown.onclick = () => toggleFeedback(msg.id, 'down', btnThumbsDown, btnThumbsUp);
      actions.appendChild(btnThumbsDown);

      // Sources Expander
      if (msg.citations && msg.citations.length > 0) {
        const btnSources = document.createElement('button');
        btnSources.className = 'btn-action';
        btnSources.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg><span>Sources (${msg.citations.length})</span>`;
        
        const sourcesPanel = document.createElement('div');
        sourcesPanel.className = 'sources-panel hidden';
        const sourcesList = document.createElement('div');
        sourcesList.className = 'sources-list';

        msg.citations.forEach(c => {
          const card = document.createElement('div');
          card.className = 'source-card';
          card.innerHTML = `
            <div class="source-card-top">
              <span class="source-card-title">[${c.citation_id}] ${c.document_name}</span>
              <span class="source-card-page">Page ${c.page}</span>
            </div>
            <div class="source-card-excerpt">"${c.excerpt}"</div>
            <button class="source-card-btn" data-chunk-id="${c.chunk_id}">View full passage</button>
          `;
          card.querySelector('.source-card-btn').onclick = () => openCitationPreview(c);
          sourcesList.appendChild(card);
        });

        sourcesPanel.appendChild(sourcesList);

        btnSources.onclick = () => {
          sourcesPanel.classList.toggle('hidden');
        };

        actions.appendChild(btnSources);
        body.appendChild(actions);
        body.appendChild(sourcesPanel);
      } else {
        body.appendChild(actions);
      }

      // Attach click events to citation chips inside this message
      contentDiv.querySelectorAll('.citation-chip').forEach(chip => {
        chip.onclick = () => {
          const citNum = parseInt(chip.dataset.citation, 10);
          const found = (msg.citations || []).find(c => c.citation_id === citNum);
          if (found) {
            openCitationPreview(found);
          } else {
            showToast(`Source citation [${citNum}] preview not loaded.`, 'info');
          }
        };
      });

      row.appendChild(body);
    }

    el.messagesContainer.appendChild(row);
  }

  async function toggleFeedback(msgId, targetFeedback, activeBtn, otherBtn) {
    const isCurrentlyActive = activeBtn.classList.contains('active');
    const newFeedback = isCurrentlyActive ? null : targetFeedback;

    try {
      const res = await fetch(`/api/messages/${msgId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: newFeedback })
      });
      if (!res.ok) throw new Error('Feedback update failed');

      if (newFeedback) {
        activeBtn.classList.add('active');
        otherBtn.classList.remove('active');
        showToast('Thank you for the feedback!', 'success');
      } else {
        activeBtn.classList.remove('active');
      }
    } catch (err) {
      showToast('Could not record feedback', 'error');
    }
  }

  async function openCitationPreview(citation) {
    el.citationBadge.textContent = `[${citation.citation_id}]`;
    el.citationDocName.textContent = citation.document_name;
    el.citationDocPage.textContent = citation.page;
    el.citationTextContent.textContent = 'Loading full chunk text...';
    openModal(el.citationModal);

    try {
      const res = await fetch(`/api/chunks/${citation.chunk_id}`);
      if (!res.ok) throw new Error('Chunk not found');
      const data = await res.json();
      el.citationTextContent.textContent = data.text;
    } catch (err) {
      el.citationTextContent.textContent = citation.text || citation.excerpt || 'Excerpt text unavailable.';
    }

    el.btnCitationCopy.onclick = () => {
      navigator.clipboard.writeText(el.citationTextContent.textContent);
      showToast('Passage copied to clipboard', 'success');
    };
  }

  // -------------------------------------------------------------
  // Composer Attachments & Message Sending
  // -------------------------------------------------------------

  function addComposerAttachment(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast(`"${file.name}" rejected: Only PDF files can be attached.`, 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showToast(`"${file.name}" rejected: Exceeds 25 MB limit.`, 'error');
      return;
    }
    if (state.attachedFiles.some(f => f.name === file.name && f.size === file.size)) {
      return;
    }
    state.attachedFiles.push(file);
    renderComposerAttachments();
    updateCharCounter();
  }

  function removeComposerAttachment(index) {
    state.attachedFiles.splice(index, 1);
    renderComposerAttachments();
    updateCharCounter();
  }

  function renderComposerAttachments() {
    if (state.attachedFiles.length === 0) {
      el.composerAttachments.classList.add('hidden');
      el.composerAttachments.innerHTML = '';
      return;
    }
    el.composerAttachments.classList.remove('hidden');
    el.composerAttachments.innerHTML = '';

    state.attachedFiles.forEach((file, idx) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const sizeKb = Math.round(file.size / 1024);
      chip.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="attachment-chip-name" title="${file.name}">${file.name}</span>
        <span class="attachment-chip-size">(${sizeKb} KB)</span>
        <button type="button" class="attachment-chip-remove" aria-label="Remove attachment">✕</button>
      `;
      chip.querySelector('.attachment-chip-remove').onclick = () => removeComposerAttachment(idx);
      el.composerAttachments.appendChild(chip);
    });
  }

  async function savePastedDocument() {
    const title = el.pasteDocTitle.value.trim();
    const content = el.pasteDocContent.value.trim();
    if (!title) {
      showToast('Please enter a document title', 'error');
      return;
    }
    if (!content) {
      showToast('Please enter document text content', 'error');
      return;
    }

    try {
      const res = await fetch('/api/documents/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: title, content: content })
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Ingestion failed');
      }
      const data = await res.json();
      showToast(`Document "${data.name}" added successfully (${data.chunk_count} chunks)`, 'success');
      closeModal(el.pasteModal);
      await fetchDocuments();
      await fetchHealth();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function sendMessage(contentOverride = null) {
    if (state.isGenerating) return;

    let content = contentOverride ? contentOverride.trim() : el.composerInput.value.trim();
    const hasAttachments = state.attachedFiles.length > 0;

    if (!content && !hasAttachments) return;

    // If attachments present but no text, default to an analysis prompt
    if (!content && hasAttachments) {
      content = "Please analyze and summarize the attached document(s), highlighting key points, policies, and takeaways.";
    }

    if (!state.currentChatId) {
      await createNewChat();
    }

    // Switch view
    el.welcomeHero.classList.add('hidden');
    el.messagesContainer.classList.remove('hidden');

    // If there are attached files, upload and index them first!
    let attachedDocIds = [];
    if (hasAttachments) {
      const formData = new FormData();
      state.attachedFiles.forEach(f => formData.append('files', f));
      showToast(`Uploading and indexing ${state.attachedFiles.length} attached document(s)...`, 'info');
      try {
        const uploadRes = await fetch('/api/documents', {
          method: 'POST',
          body: formData
        });
        if (!uploadRes.ok) throw new Error('Attachment upload failed');
        const uploadData = await uploadRes.json();
        attachedDocIds = uploadData.documents.map(d => d.id);
        await fetchDocuments();
        await fetchHealth();
      } catch (err) {
        showToast(`Could not process attached file: ${err.message}`, 'error');
        return;
      }
      state.attachedFiles = [];
      renderComposerAttachments();
    }

    // Append User Message to UI
    const tempUserMsg = {
      id: 'usr_' + Date.now(),
      role: 'user',
      content: content
    };
    appendMessageToUi(tempUserMsg);
    scrollToBottom();

    // Clear composer
    el.composerInput.value = '';
    updateComposerHeight();
    updateCharCounter();

    // Prepare Assistant Streaming Placeholder
    state.isGenerating = true;
    state.abortController = new AbortController();
    el.btnSend.disabled = true;
    el.btnStopGenerating.classList.remove('hidden');
    el.streamingNotice.classList.remove('hidden');

    const assistantRow = document.createElement('div');
    assistantRow.className = 'message-row assistant';
    const assistantBody = document.createElement('div');
    assistantBody.className = 'message-assistant-body';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'markdown-content';
    assistantBody.appendChild(contentDiv);

    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    assistantBody.appendChild(cursor);

    assistantRow.appendChild(assistantBody);
    el.messagesContainer.appendChild(assistantRow);
    scrollToBottom();

    let accumulatedText = '';
    let citations = [];
    let isOffline = false;
    let finalMsgId = null;

    try {
      const targetDocScope = attachedDocIds.length > 0
        ? attachedDocIds
        : (state.selectedDocScope === 'all' ? null : state.selectedDocScope);

      const payload = {
        content: content,
        top_k: state.topK,
        document_ids: targetDocScope
      };

      const res = await fetch(`/api/chats/${state.currentChatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: state.abortController.signal
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to submit message');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep last incomplete chunk

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'token') {
              accumulatedText += event.content;
              contentDiv.innerHTML = renderMarkdownWithCitations(accumulatedText, citations);
              scrollToBottom();
            } else if (event.type === 'citations') {
              citations = event.citations || [];
            } else if (event.type === 'done') {
              accumulatedText = event.content;
              isOffline = event.is_offline;
              finalMsgId = event.message_id;
              citations = event.citations || citations;
            } else if (event.type === 'error') {
              showToast(event.message, 'error');
            }
          } catch (e) {
            // ignore malformed chunks
          }
        }
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        accumulatedText += ' *(generation stopped)*';
        showToast('Generation stopped', 'info');
      } else {
        accumulatedText += `\n\n*Error: ${err.message}*`;
        showToast(`Stream error: ${err.message}`, 'error');
      }
    } finally {
      // Clean up cursor and streaming indicators
      cursor.remove();
      state.isGenerating = false;
      state.abortController = null;
      el.btnSend.disabled = false;
      el.btnStopGenerating.classList.add('hidden');
      el.streamingNotice.classList.add('hidden');

      // Re-render final finalized assistant row with action bar & sources
      assistantRow.remove();
      const finalMsg = {
        id: finalMsgId || 'ast_' + Date.now(),
        role: 'assistant',
        content: accumulatedText,
        citations: citations,
        is_offline_mode: isOffline
      };
      appendMessageToUi(finalMsg);
      scrollToBottom();

      // Refresh chat title in sidebar and topbar
      const currentChat = state.chats.find(c => c.id === state.currentChatId);
      if (currentChat && currentChat.title === 'New Chat') {
        const words = content.split(' ');
        const autoTitle = words.slice(0, 6).join(' ') + (words.length > 6 ? '...' : '');
        currentChat.title = autoTitle;
        state.currentChatTitle = autoTitle;
        el.chatTitleDisplay.textContent = autoTitle;
        renderChatList(el.chatSearch.value);
      }
    }
  }

  function stopGenerating() {
    if (state.abortController) {
      state.abortController.abort();
    }
  }

  function regenerateLastUserMessage() {
    const userMessages = el.messagesContainer.querySelectorAll('.message-row.user');
    if (userMessages.length === 0) return;
    const lastUserBubble = userMessages[userMessages.length - 1].querySelector('.message-bubble-user');
    if (!lastUserBubble) return;
    const query = lastUserBubble.textContent;
    sendMessage(query);
  }

  // -------------------------------------------------------------
  // Export Chat
  // -------------------------------------------------------------

  async function exportChatAsMarkdown() {
    if (!state.currentChatId) return;

    try {
      const res = await fetch(`/api/chats/${state.currentChatId}/messages`);
      if (!res.ok) throw new Error('Could not fetch messages');
      const messages = await res.json();

      let md = `# ${state.currentChatTitle}\n\n`;
      md += `*Exported from Ashh on ${new Date().toLocaleString()}*\n\n---\n\n`;

      messages.forEach(msg => {
        if (msg.role === 'user') {
          md += `### User\n${msg.content}\n\n`;
        } else {
          md += `### Ashh${msg.is_offline_mode ? ' (Offline Mode)' : ''}\n${msg.content}\n\n`;
          if (msg.citations && msg.citations.length > 0) {
            md += `#### Sources:\n`;
            msg.citations.forEach(c => {
              md += `- **[${c.citation_id}] ${c.document_name}** (Page ${c.page}): "${c.excerpt}"\n`;
            });
            md += `\n`;
          }
        }
        md += `---\n\n`;
      });

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeTitle = state.currentChatTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      a.href = url;
      a.download = `ashh-${safeTitle}-${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast('Chat exported as Markdown', 'success');
    } catch (err) {
      showToast('Failed to export conversation', 'error');
    }
  }

  // -------------------------------------------------------------
  // Modals Framework
  // -------------------------------------------------------------

  function openModal(modalEl) {
    modalEl.classList.remove('hidden');
  }

  function closeModal(modalEl) {
    modalEl.classList.add('hidden');
  }

  function openConfirmModal(title, message) {
    el.confirmModalTitle.textContent = title;
    el.confirmModalText.textContent = message;
    openModal(el.confirmModal);
  }

  // -------------------------------------------------------------
  // Scroll, Height & Keyboard
  // -------------------------------------------------------------

  function scrollToBottom() {
    el.chatArea.scrollTop = el.chatArea.scrollHeight;
  }

  function updateComposerHeight() {
    el.composerInput.style.height = 'auto';
    el.composerInput.style.height = Math.min(el.composerInput.scrollHeight, 180) + 'px';
  }

  function updateCharCounter() {
    const len = el.composerInput.value.length;
    el.charCounter.textContent = `${len} / 4000`;
    el.btnSend.disabled = (len === 0 && state.attachedFiles.length === 0) || state.isGenerating;
  }

  function toggleSidebar() {
    el.sidebar.classList.toggle('open');
    el.sidebarBackdrop.classList.toggle('active');
  }

  function closeSidebar() {
    el.sidebar.classList.remove('open');
    el.sidebarBackdrop.classList.remove('active');
  }

  // -------------------------------------------------------------
  // Event Listeners Initialization
  // -------------------------------------------------------------

  function initEventListeners() {
    // Theme toggle
    el.btnThemeToggle.onclick = toggleTheme;

    // Sidebar
    el.btnToggleSidebar.onclick = toggleSidebar;
    el.btnCloseSidebar.onclick = closeSidebar;
    el.sidebarBackdrop.onclick = closeSidebar;

    // New chat
    el.btnNewChat.onclick = createNewChat;

    // Search chats
    el.chatSearch.oninput = (e) => {
      const val = e.target.value;
      el.btnClearSearch.classList.toggle('hidden', !val);
      renderChatList(val);
    };

    el.btnClearSearch.onclick = () => {
      el.chatSearch.value = '';
      el.btnClearSearch.classList.add('hidden');
      renderChatList();
    };

    // Rename title from topbar
    el.btnRenameTitle.onclick = () => {
      if (state.currentChatId) {
        openRenameModal(state.currentChatId, state.currentChatTitle);
      }
    };
    el.chatTitleDisplay.onclick = () => {
      if (state.currentChatId) {
        openRenameModal(state.currentChatId, state.currentChatTitle);
      }
    };

    // Scope dropdown toggle
    el.btnScopeSelector.onclick = (e) => {
      e.stopPropagation();
      el.scopeMenu.classList.toggle('hidden');
      const expanded = !el.scopeMenu.classList.contains('hidden');
      el.btnScopeSelector.setAttribute('aria-expanded', expanded);
    };

    document.addEventListener('click', (e) => {
      if (!el.scopeMenu.contains(e.target) && !el.btnScopeSelector.contains(e.target)) {
        el.scopeMenu.classList.add('hidden');
        el.btnScopeSelector.setAttribute('aria-expanded', 'false');
      }
    });

    // Dropzone upload
    el.dropzone.onclick = () => el.fileInput.click();
    el.dropzone.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.fileInput.click();
      }
    };

    el.fileInput.onchange = (e) => {
      handleFileUpload(e.target.files);
      el.fileInput.value = ''; // reset so same file can re-upload if needed
    };

    // Drag and drop handlers
    el.dropzone.ondragover = (e) => {
      e.preventDefault();
      el.dropzone.classList.add('drag-active');
    };

    el.dropzone.ondragleave = (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('drag-active');
    };

    el.dropzone.ondrop = (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('drag-active');
      if (e.dataTransfer && e.dataTransfer.files) {
        handleFileUpload(e.dataTransfer.files);
      }
    };

    // Export
    el.btnExportChat.onclick = exportChatAsMarkdown;

    // Composer
    el.composerInput.oninput = () => {
      updateComposerHeight();
      updateCharCounter();
    };

    el.composerInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    };

    el.composerForm.onsubmit = (e) => {
      e.preventDefault();
      sendMessage();
    };

    el.btnStopGenerating.onclick = stopGenerating;

    // Welcome prompt chips
    document.querySelectorAll('.prompt-chip').forEach(chip => {
      chip.onclick = () => {
        const promptText = chip.dataset.prompt;
        if (promptText) sendMessage(promptText);
      };
    });

    // Modals Close & Cancel
    el.btnCloseCitation.onclick = () => closeModal(el.citationModal);
    el.btnCitationDone.onclick = () => closeModal(el.citationModal);
    document.getElementById('citation-backdrop').onclick = () => closeModal(el.citationModal);

    el.btnSettings.onclick = () => {
      fetchHealth();
      openModal(el.settingsModal);
    };
    el.btnCloseSettings.onclick = () => closeModal(el.settingsModal);
    document.getElementById('settings-backdrop').onclick = () => closeModal(el.settingsModal);
    el.settingTopK.oninput = (e) => el.settingTopKVal.textContent = e.target.value;
    el.btnResetSettings.onclick = resetSettings;
    el.btnSaveSettings.onclick = saveSettings;

    el.btnConfirmCancel.onclick = () => closeModal(el.confirmModal);
    el.btnCloseConfirm.onclick = () => closeModal(el.confirmModal);
    document.getElementById('confirm-backdrop').onclick = () => closeModal(el.confirmModal);
    el.btnConfirmProceed.onclick = async () => {
      if (state.pendingDeleteAction) {
        await state.pendingDeleteAction();
        state.pendingDeleteAction = null;
      }
      closeModal(el.confirmModal);
    };

    el.btnRenameCancel.onclick = () => closeModal(el.renameModal);
    el.btnCloseRename.onclick = () => closeModal(el.renameModal);
    document.getElementById('rename-backdrop').onclick = () => closeModal(el.renameModal);
    el.btnRenameSave.onclick = saveRename;
    el.renameInput.onkeydown = (e) => {
      if (e.key === 'Enter') saveRename();
    };

    // Composer Attachment Button & File Input
    el.btnAttachComposer.onclick = () => el.composerFileInput.click();
    el.composerFileInput.onchange = (e) => {
      if (e.target.files) {
        Array.from(e.target.files).forEach(f => addComposerAttachment(f));
      }
      el.composerFileInput.value = '';
    };

    // Drag and drop onto Composer
    el.composerBox.ondragover = (e) => {
      e.preventDefault();
      el.composerBox.classList.add('drag-over');
    };
    el.composerBox.ondragleave = (e) => {
      e.preventDefault();
      el.composerBox.classList.remove('drag-over');
    };
    el.composerBox.ondrop = (e) => {
      e.preventDefault();
      el.composerBox.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files) {
        Array.from(e.dataTransfer.files).forEach(f => addComposerAttachment(f));
      }
    };

    // Paste Document Modal
    el.btnOpenPasteModal.onclick = () => {
      el.pasteDocTitle.value = '';
      el.pasteDocContent.value = '';
      openModal(el.pasteModal);
      setTimeout(() => el.pasteDocTitle.focus(), 100);
    };
    el.btnClosePaste.onclick = () => closeModal(el.pasteModal);
    el.btnPasteCancel.onclick = () => closeModal(el.pasteModal);
    document.getElementById('paste-backdrop').onclick = () => closeModal(el.pasteModal);
    el.btnPasteSave.onclick = savePastedDocument;

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      // Escape closes modals
      if (e.key === 'Escape') {
        closeModal(el.citationModal);
        closeModal(el.settingsModal);
        closeModal(el.confirmModal);
        closeModal(el.renameModal);
        closeModal(el.pasteModal);
        el.scopeMenu.classList.add('hidden');
      }

      // Ctrl+K or Cmd+K creates new chat
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        createNewChat();
      }
    });
  }

  // -------------------------------------------------------------
  // Main App Bootstrap
  // -------------------------------------------------------------

  async function initApp() {
    initTheme();
    loadSettings();
    initEventListeners();
    await fetchHealth();
    await fetchDocuments();
    await fetchChats();
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
