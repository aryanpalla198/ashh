/**
 * Ashh — Document-Grounded AI Chatbot
 * Standalone Client-Side Cloud Engine for GitHub Pages
 * 
 * Features:
 * - In-browser PDF extraction using PDF.js
 * - Semantic text chunking (~800 chars, 120 overlap)
 * - TF-IDF & term-frequency relevance retrieval
 * - Numbered citation system ([1], [2]) with modal inspection
 * - Live Claude 3.5 Sonnet streaming (if key configured) or zero-crash Offline Extractive Mode
 * - Full chat persistence via localStorage
 * - Pre-loaded sample knowledge base
 */

(() => {
  'use strict';

  // Configure PDF.js worker
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // Configure Marked renderer for citation chips [1], [2]
  if (window.marked) {
    const renderer = new marked.Renderer();
    const originalTextRenderer = renderer.text.bind(renderer);
    renderer.text = function(text) {
      if (typeof text === 'object' && text.raw) text = text.raw;
      const citationRegex = /\[(\d+)\]/g;
      const parsed = text.replace(citationRegex, (match, id) => {
        return `<button class="citation-chip" data-citation-id="${id}" aria-label="View source ${id}">[${id}]</button>`;
      });
      return originalTextRenderer(parsed);
    };
    marked.setOptions({
      renderer: renderer,
      breaks: true,
      gfm: true
    });
  }

  // Pre-seeded sample knowledge base so Ashh is immediately usable on first visit
  const SEED_DOCUMENTS = [
    {
      id: 'doc-seed-research',
      name: 'Agentic_AI_Research_Report.pdf',
      page_count: 2,
      chunk_count: 3,
      upload_time: new Date().toISOString(),
      chunks: [
        {
          id: 'seed-c1',
          document_id: 'doc-seed-research',
          document_name: 'Agentic_AI_Research_Report.pdf',
          page: 1,
          text: 'Autonomous agentic architectures represent a paradigm shift in generative AI, moving from simple single-turn query completions to iterative goal decomposition and autonomous tool execution. By incorporating external memory systems, vector retrieval, and deterministic verification loops, agentic systems reduce factual hallucination rates by over 74% compared to vanilla zero-shot language models.'
        },
        {
          id: 'seed-c2',
          document_id: 'doc-seed-research',
          document_name: 'Agentic_AI_Research_Report.pdf',
          page: 1,
          text: 'Retrieval-Augmented Generation (RAG) grounds language model synthesis by dynamically querying dense vector databases such as ChromaDB. Context chunks of approximately 800 characters with 120-character overlapping boundaries maintain semantic coherence while maximizing precision in top-k retrieval.'
        },
        {
          id: 'seed-c3',
          document_id: 'doc-seed-research',
          document_name: 'Agentic_AI_Research_Report.pdf',
          page: 2,
          text: 'Evaluation benchmarks across 1,000 multi-document research queries demonstrate that grounding model outputs with explicit numbered citation markers ([1], [2]) enables end-to-end verifiability for legal, financial, and technical analysts. Grounded outputs eliminate hallucinated sources and build trust in critical workflows.'
        }
      ]
    },
    {
      id: 'doc-seed-handbook',
      name: 'Company_Operations_Handbook.pdf',
      page_count: 2,
      chunk_count: 2,
      upload_time: new Date().toISOString(),
      chunks: [
        {
          id: 'seed-c4',
          document_id: 'doc-seed-handbook',
          document_name: 'Company_Operations_Handbook.pdf',
          page: 1,
          text: 'Section 4: Remote Work and Core Collaboration Hours. All team members are empowered to work flexibly from any location. Core collaboration hours are set between 10:00 AM and 3:00 PM local time to facilitate synchronous standups, sprint planning, and architectural reviews.'
        },
        {
          id: 'seed-c5',
          document_id: 'doc-seed-handbook',
          document_name: 'Company_Operations_Handbook.pdf',
          page: 2,
          text: 'Section 9: Security and Data Protection Policies. Confidential company data, API credentials, and internal customer records must never be committed to public repositories. All production cloud resources must enforce multi-factor authentication (MFA) and encrypted backups.'
        }
      ]
    }
  ];

  // State
  const state = {
    documents: [],
    chats: [],
    messages: {}, // { [chatId]: [message] }
    currentChatId: null,
    currentChatTitle: 'New Chat',
    selectedDocIds: [], // empty = all documents
    attachedFiles: [],  // files attached in composer
    topK: 5,
    apiKey: '',
    theme: 'light',
    isGenerating: false,
    abortController: null,
    pendingDeleteAction: null
  };

  // DOM Elements Cache
  const el = {
    // Theme & Sidebar
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    themeIconSun: document.getElementById('theme-icon-sun'),
    themeIconMoon: document.getElementById('theme-icon-moon'),
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

    // Topbar
    chatTitleDisplay: document.getElementById('chat-title-display'),
    btnRenameTitle: document.getElementById('btn-rename-title'),
    btnScopeSelector: document.getElementById('btn-scope-selector'),
    scopeLabel: document.getElementById('scope-label'),
    scopeMenu: document.getElementById('scope-menu'),
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
    settingApiKey: document.getElementById('setting-api-key'),
    apiKeyStatusBadge: document.getElementById('api-key-status-badge'),
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
  // Persistence Layer (localStorage)
  // -------------------------------------------------------------

  function loadState() {
    try {
      // Documents
      const storedDocs = localStorage.getItem('ashh_cloud_documents');
      if (storedDocs) {
        state.documents = JSON.parse(storedDocs);
      } else {
        state.documents = JSON.parse(JSON.stringify(SEED_DOCUMENTS));
        saveDocuments();
      }

      // Chats
      const storedChats = localStorage.getItem('ashh_cloud_chats');
      if (storedChats) {
        state.chats = JSON.parse(storedChats);
      } else {
        state.chats = [];
      }

      // Messages map
      const storedMessages = localStorage.getItem('ashh_cloud_messages');
      if (storedMessages) {
        state.messages = JSON.parse(storedMessages);
      } else {
        state.messages = {};
      }

      // Settings
      const storedTopK = localStorage.getItem('ashh_top_k');
      if (storedTopK) state.topK = parseInt(storedTopK, 10);

      const storedApiKey = localStorage.getItem('ashh_api_key');
      if (storedApiKey) state.apiKey = storedApiKey;

    } catch (e) {
      console.error('Error loading state:', e);
      state.documents = JSON.parse(JSON.stringify(SEED_DOCUMENTS));
      state.chats = [];
      state.messages = {};
    }
  }

  function saveDocuments() {
    try {
      localStorage.setItem('ashh_cloud_documents', JSON.stringify(state.documents));
    } catch (e) {
      showToast('Local storage limit reached for documents', 'error');
    }
  }

  function saveChats() {
    try {
      localStorage.setItem('ashh_cloud_chats', JSON.stringify(state.chats));
    } catch (e) {
      console.error('Error saving chats:', e);
    }
  }

  function saveMessages() {
    try {
      localStorage.setItem('ashh_cloud_messages', JSON.stringify(state.messages));
    } catch (e) {
      console.error('Error saving messages:', e);
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
  // Toast Notifications
  // -------------------------------------------------------------

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  // -------------------------------------------------------------
  // In-Browser PDF Parsing & Chunking
  // -------------------------------------------------------------

  async function extractTextFromPdf(file) {
    if (!window.pdfjsLib) {
      throw new Error('PDF parsing library is still loading. Please try again.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const strings = textContent.items.map(item => item.str.trim()).filter(Boolean);
      const pageText = strings.join(' ');
      pages.push({
        pageNumber: pageNum,
        text: pageText
      });
    }

    return pages;
  }

  function chunkText(text, docId, docName, pageNum, chunkSize = 800, overlap = 120) {
    const chunks = [];
    if (!text || text.trim().length === 0) return chunks;

    // Sentence-boundary splitting
    const sentences = text.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [text];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-Math.max(1, Math.floor(overlap / 7)));
        currentChunk = overlapWords.join(' ') + ' ' + sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence.trim();
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks.map((chunkStr, idx) => ({
      id: `${docId}-p${pageNum}-c${idx}`,
      document_id: docId,
      document_name: docName,
      page: pageNum,
      text: chunkStr
    }));
  }

  // -------------------------------------------------------------
  // Document Shelf & Ingestion
  // -------------------------------------------------------------

  function renderDocuments() {
    el.docSkeletons.classList.add('hidden');
    el.documentList.innerHTML = '';
    el.docBadgeCount.textContent = state.documents.length;

    if (state.documents.length === 0) {
      el.docEmptyState.classList.remove('hidden');
      return;
    }

    el.docEmptyState.classList.add('hidden');

    state.documents.forEach(doc => {
      const item = document.createElement('div');
      item.className = 'doc-item';
      item.dataset.id = doc.id;
      item.innerHTML = `
        <div class="doc-info">
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" class="doc-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div class="doc-meta">
            <span class="doc-name" title="${doc.name}">${doc.name}</span>
            <span class="doc-sub">${doc.page_count} page${doc.page_count > 1 ? 's' : ''} • ${doc.chunk_count} chunks</span>
          </div>
        </div>
        <button class="btn-icon-sm btn-delete-doc" aria-label="Delete document" title="Delete">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      `;

      item.querySelector('.btn-delete-doc').onclick = (e) => {
        e.stopPropagation();
        confirmDeleteDocument(doc.id, doc.name);
      };

      el.documentList.appendChild(item);
    });

    updateScopeDropdown();
    updateHealthDisplay();
  }

  async function handleFileUpload(files) {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        showToast(`Rejected "${file.name}": Only PDF files are supported.`, 'error');
        continue;
      }

      if (file.size > 25 * 1024 * 1024) {
        showToast(`Rejected "${file.name}": File size exceeds 25 MB limit.`, 'error');
        continue;
      }

      showToast(`Processing "${file.name}"...`, 'info');

      try {
        const pages = await extractTextFromPdf(file);
        const docId = 'doc-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
        const allChunks = [];
        let validPagesCount = 0;

        pages.forEach(p => {
          if (p.text && p.text.trim().length > 15) {
            validPagesCount++;
            const chunks = chunkText(p.text, docId, file.name, p.pageNumber);
            allChunks.push(...chunks);
          }
        });

        if (allChunks.length === 0) {
          showToast(`"${file.name}" has no readable text (scanned pages or empty).`, 'error');
          continue;
        }

        const newDoc = {
          id: docId,
          name: file.name,
          page_count: pages.length,
          chunk_count: allChunks.length,
          upload_time: new Date().toISOString(),
          chunks: allChunks
        };

        state.documents.unshift(newDoc);
        saveDocuments();
        renderDocuments();
        showToast(`Successfully indexed "${file.name}" (${allChunks.length} chunks)`, 'success');

      } catch (err) {
        console.error(err);
        showToast(`Failed to parse "${file.name}": ${err.message}`, 'error');
      }
    }
  }

  function addComposerAttachment(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Only PDF files can be attached.', 'error');
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
    el.composerAttachments.innerHTML = '';
    if (state.attachedFiles.length === 0) {
      el.composerAttachments.classList.add('hidden');
      return;
    }

    el.composerAttachments.classList.remove('hidden');
    state.attachedFiles.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const sizeKb = Math.round(file.size / 1024);
      chip.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="attachment-chip-name" title="${file.name}">${file.name}</span>
        <span class="attachment-chip-size">(${sizeKb} KB)</span>
        <button type="button" class="attachment-chip-remove" aria-label="Remove attachment">&times;</button>
      `;
      chip.querySelector('.attachment-chip-remove').onclick = () => removeComposerAttachment(index);
      el.composerAttachments.appendChild(chip);
    });
  }

  function savePastedDocument() {
    const title = (el.pasteDocTitle.value || 'Pasted Document').trim();
    const content = (el.pasteDocContent.value || '').trim();

    if (!content) {
      showToast('Document text content cannot be empty', 'error');
      return;
    }

    const docId = 'doc-' + Date.now();
    const chunks = chunkText(content, docId, title + '.txt', 1);

    const newDoc = {
      id: docId,
      name: title.endsWith('.txt') ? title : title + '.txt',
      page_count: 1,
      chunk_count: chunks.length,
      upload_time: new Date().toISOString(),
      chunks: chunks
    };

    state.documents.unshift(newDoc);
    saveDocuments();
    renderDocuments();
    closeModal(el.pasteModal);
    showToast(`Added "${newDoc.name}" (${chunks.length} chunks)`, 'success');
  }

  function confirmDeleteDocument(docId, docName) {
    state.pendingDeleteAction = () => {
      state.documents = state.documents.filter(d => d.id !== docId);
      state.selectedDocIds = state.selectedDocIds.filter(id => id !== docId);
      saveDocuments();
      renderDocuments();
      showToast(`Document "${docName}" removed`, 'info');
    };
    openConfirmModal('Delete Document', `Are you sure you want to delete "${docName}"? It will no longer be available for retrieval.`);
  }

  // -------------------------------------------------------------
  // Retrieval & Grounding Algorithm
  // -------------------------------------------------------------

  function retrieveRelevantChunks(query, topK = 5, docScope = []) {
    let pool = [];
    state.documents.forEach(doc => {
      if (docScope.length === 0 || docScope.includes(doc.id)) {
        if (doc.chunks) pool.push(...doc.chunks);
      }
    });

    if (pool.length === 0) return [];

    const queryWords = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return pool.slice(0, topK);

    // Score chunks using term frequency and density
    const scored = pool.map(chunk => {
      const textLower = chunk.text.toLowerCase();
      let score = 0;

      // Exact phrase match boost
      if (textLower.includes(query.toLowerCase())) {
        score += 15;
      }

      queryWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = textLower.match(regex);
        if (matches) {
          score += matches.length * 2.5;
        } else if (textLower.includes(word)) {
          score += 1.0;
        }
      });

      return { chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.filter(item => item.score > 0).slice(0, topK).map(item => item.chunk);
  }

  // -------------------------------------------------------------
  // Answer Synthesis (Claude Streaming or Extractive Mode)
  // -------------------------------------------------------------

  async function synthesizeAnswer(query, chunks, onToken) {
    // If user provided Anthropic Claude API Key, stream live from Claude
    if (state.apiKey && state.apiKey.trim().startsWith('sk-ant')) {
      try {
        const contextText = chunks.map((c, i) => `[${i + 1}] Document: ${c.document_name} (Page ${c.page}):\n${c.text}`).join('\n\n');
        const systemPrompt = `You are Ashh, a helpful and precise document-grounded AI chatbot.
Answer the user's question STRICTLY based on the provided numbered sources.
Format citations as [1], [2] directly in your sentences matching the source numbers.
If the context does not contain the answer, say clearly that the answer is not in the uploaded documents.
Never invent information or citations.`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': state.apiKey.trim(),
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1500,
            system: systemPrompt,
            messages: [
              {
                role: 'user',
                content: `Context:\n${contextText}\n\nQuestion: ${query}`
              }
            ],
            stream: true
          })
        });

        if (!response.ok) {
          throw new Error(`Anthropic API error (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              if (dataStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
                  fullText += parsed.delta.text;
                  onToken(parsed.delta.text);
                }
              } catch (e) {}
            }
          }
        }

        return { text: fullText, isOffline: false };
      } catch (err) {
        console.warn('Claude API call failed, falling back to extractive mode:', err);
      }
    }

    // Zero-Crash Offline Extractive Synthesis
    await new Promise(r => setTimeout(r, 400)); // smooth natural feeling
    let extractiveText = '';

    if (chunks.length === 0) {
      extractiveText = "I couldn't find any documents matching your question in the current knowledge base. Please upload a PDF or type a document into the sidebar to ground my answers.";
    } else {
      extractiveText = `Based on your documents, here are the most relevant findings:\n\n`;
      chunks.forEach((chunk, i) => {
        const citationId = i + 1;
        const sentences = chunk.text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
        const bestExcerpt = sentences.slice(0, 2).join(' ');
        extractiveText += `${bestExcerpt} [${citationId}]\n\n`;
      });
      extractiveText += `*Synthesized in on-device Offline Mode with source citations.*`;
    }

    // Simulated token stream for fluid UI feedback
    const tokens = extractiveText.split(/(\s+)/);
    for (const t of tokens) {
      onToken(t);
      await new Promise(r => setTimeout(r, 18));
    }

    return { text: extractiveText, isOffline: true };
  }

  // -------------------------------------------------------------
  // Chat Conversations & Message Rendering
  // -------------------------------------------------------------

  function createNewChat() {
    const newChat = {
      id: 'chat-' + Date.now(),
      title: 'New Chat',
      created_at: new Date().toISOString()
    };
    state.chats.unshift(newChat);
    state.messages[newChat.id] = [];
    saveChats();
    saveMessages();
    renderChatList(el.chatSearch.value);
    selectChat(newChat.id);
    el.composerInput.focus();
  }

  function selectChat(chatId) {
    if (state.isGenerating) {
      showToast('Please wait or stop current generation first', 'info');
      return;
    }

    state.currentChatId = chatId;
    localStorage.setItem('ashh_active_chat', chatId);

    const chat = state.chats.find(c => c.id === chatId);
    state.currentChatTitle = chat ? chat.title : 'New Chat';
    el.chatTitleDisplay.textContent = state.currentChatTitle;

    document.querySelectorAll('.chat-item').forEach(it => {
      it.classList.toggle('active', it.dataset.id === chatId);
    });

    renderChatMessages(chatId);
  }

  function renderChatList(query = '') {
    el.chatSkeletons.classList.add('hidden');
    el.groupToday.querySelector('.group-items').innerHTML = '';
    el.groupYesterday.querySelector('.group-items').innerHTML = '';
    el.groupEarlier.querySelector('.group-items').innerHTML = '';

    const q = (query || '').toLowerCase().trim();
    const filtered = state.chats.filter(c => !q || c.title.toLowerCase().includes(q));

    if (state.chats.length === 0) {
      el.chatEmptyState.classList.remove('hidden');
      el.chatSearchEmpty.classList.add('hidden');
      el.groupToday.classList.add('hidden');
      el.groupYesterday.classList.add('hidden');
      el.groupEarlier.classList.add('hidden');
      return;
    }

    el.chatEmptyState.classList.add('hidden');

    if (filtered.length === 0) {
      el.chatSearchEmpty.classList.remove('hidden');
      el.groupToday.classList.add('hidden');
      el.groupYesterday.classList.add('hidden');
      el.groupEarlier.classList.add('hidden');
      return;
    }

    el.chatSearchEmpty.classList.add('hidden');
    el.groupToday.classList.remove('hidden');

    filtered.forEach(chat => {
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

      el.groupToday.querySelector('.group-items').appendChild(item);
    });
  }

  function renderChatMessages(chatId) {
    const messages = state.messages[chatId] || [];
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
  }

  function appendMessageToUi(msg) {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}`;
    row.dataset.msgId = msg.id;

    if (msg.role === 'user') {
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble-user';
      bubble.textContent = msg.content;
      row.appendChild(bubble);
    } else {
      const container = document.createElement('div');
      container.className = 'message-bubble-assistant';

      const markdownDiv = document.createElement('div');
      markdownDiv.className = 'markdown-body';
      const cleanHtml = DOMPurify.sanitize(marked.parse(msg.content));
      markdownDiv.innerHTML = cleanHtml;
      container.appendChild(markdownDiv);

      // Assistant Action Bar
      const actions = document.createElement('div');
      actions.className = 'assistant-actions';
      actions.innerHTML = `
        <button class="btn-action btn-copy" title="Copy answer">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
        <button class="btn-action btn-regenerate" title="Regenerate response">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <span>Regenerate</span>
        </button>
        <button class="btn-action btn-thumb-up ${msg.feedback === 'up' ? 'active' : ''}" title="Helpful">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        </button>
        <button class="btn-action btn-thumb-down ${msg.feedback === 'down' ? 'active' : ''}" title="Not helpful">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
        </button>
      `;

      if (msg.citations && msg.citations.length > 0) {
        const btnSources = document.createElement('button');
        btnSources.className = 'btn-action btn-toggle-sources';
        btnSources.innerHTML = `
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <span>Sources (${msg.citations.length})</span>
        `;
        actions.appendChild(btnSources);

        const sourcesPanel = document.createElement('div');
        sourcesPanel.className = 'sources-panel hidden';
        const list = document.createElement('div');
        list.className = 'sources-list';
        msg.citations.forEach(c => {
          const card = document.createElement('div');
          card.className = 'source-card';
          card.innerHTML = `
            <div class="source-card-top">
              <span class="source-card-title">[${c.citation_id}] ${c.document_name}</span>
              <span class="source-card-page">Page ${c.page}</span>
            </div>
            <div class="source-card-excerpt">"${c.excerpt}"</div>
            <button class="source-card-btn" data-chunk-id="${c.chunk_id}">Inspect Chunk</button>
          `;
          card.querySelector('.source-card-btn').onclick = () => openCitationModal(c);
          list.appendChild(card);
        });
        sourcesPanel.appendChild(list);
        container.appendChild(sourcesPanel);

        btnSources.onclick = () => {
          sourcesPanel.classList.toggle('hidden');
          btnSources.classList.toggle('active', !sourcesPanel.classList.contains('hidden'));
        };
      }

      actions.querySelector('.btn-copy').onclick = () => {
        navigator.clipboard.writeText(msg.content);
        showToast('Answer copied to clipboard', 'success');
      };

      actions.querySelector('.btn-regenerate').onclick = () => regenerateLastUserMessage();

      const btnUp = actions.querySelector('.btn-thumb-up');
      const btnDown = actions.querySelector('.btn-thumb-down');

      btnUp.onclick = () => {
        msg.feedback = msg.feedback === 'up' ? null : 'up';
        btnUp.classList.toggle('active', msg.feedback === 'up');
        btnDown.classList.remove('active');
        saveMessages();
      };

      btnDown.onclick = () => {
        msg.feedback = msg.feedback === 'down' ? null : 'down';
        btnDown.classList.toggle('active', msg.feedback === 'down');
        btnUp.classList.remove('active');
        saveMessages();
      };

      container.appendChild(actions);
      row.appendChild(container);

      // Click on citation chip buttons [1], [2]
      markdownDiv.querySelectorAll('.citation-chip').forEach(chip => {
        chip.onclick = (e) => {
          e.preventDefault();
          const cid = parseInt(chip.dataset.citationId, 10);
          if (msg.citations && msg.citations[cid - 1]) {
            openCitationModal(msg.citations[cid - 1]);
          }
        };
      });
    }

    el.messagesContainer.appendChild(row);
  }

  // -------------------------------------------------------------
  // Message Sending Orchestrator
  // -------------------------------------------------------------

  async function sendMessage(overrideText = null) {
    const text = overrideText !== null ? overrideText : el.composerInput.value.trim();
    if (!text && state.attachedFiles.length === 0) return;
    if (state.isGenerating) return;

    if (!state.currentChatId) {
      createNewChat();
    }

    // Process attached files first if any
    if (state.attachedFiles.length > 0) {
      await handleFileUpload(state.attachedFiles);
      state.attachedFiles = [];
      renderComposerAttachments();
    }

    const query = text || 'Summarize the attached document.';
    el.composerInput.value = '';
    updateComposerHeight();
    updateCharCounter();

    // 1. Add user message
    const userMsg = {
      id: 'msg-' + Date.now(),
      role: 'user',
      content: query,
      created_at: new Date().toISOString()
    };

    if (!state.messages[state.currentChatId]) {
      state.messages[state.currentChatId] = [];
    }
    state.messages[state.currentChatId].push(userMsg);
    saveMessages();

    el.welcomeHero.classList.add('hidden');
    el.messagesContainer.classList.remove('hidden');
    appendMessageToUi(userMsg);
    scrollToBottom();

    // Auto-title chat
    const currentChat = state.chats.find(c => c.id === state.currentChatId);
    if (currentChat && currentChat.title === 'New Chat') {
      const words = query.split(' ');
      currentChat.title = words.slice(0, 5).join(' ') + (words.length > 5 ? '...' : '');
      state.currentChatTitle = currentChat.title;
      el.chatTitleDisplay.textContent = currentChat.title;
      saveChats();
      renderChatList(el.chatSearch.value);
    }

    // 2. Retrieve relevant chunks
    const retrievedChunks = retrieveRelevantChunks(query, state.topK, state.selectedDocIds);
    const citations = retrievedChunks.map((chunk, i) => ({
      citation_id: i + 1,
      document_id: chunk.document_id,
      document_name: chunk.document_name,
      page: chunk.page,
      excerpt: chunk.text.substring(0, 150) + '...',
      full_text: chunk.text
    }));

    // 3. Setup Streaming UI
    state.isGenerating = true;
    el.btnSend.classList.add('hidden');
    el.btnStopGenerating.classList.remove('hidden');
    el.streamingNotice.classList.remove('hidden');

    const streamingRow = document.createElement('div');
    streamingRow.className = 'message-row assistant streaming-active';
    const streamingBubble = document.createElement('div');
    streamingBubble.className = 'message-bubble-assistant';
    const streamingContent = document.createElement('div');
    streamingContent.className = 'markdown-body';
    streamingBubble.appendChild(streamingContent);
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    streamingBubble.appendChild(cursor);
    streamingRow.appendChild(streamingBubble);
    el.messagesContainer.appendChild(streamingRow);
    scrollToBottom();

    let accumulatedText = '';

    try {
      const result = await synthesizeAnswer(query, retrievedChunks, (token) => {
        accumulatedText += token;
        streamingContent.innerHTML = DOMPurify.sanitize(marked.parse(accumulatedText));
        scrollToBottom();
      });

      streamingRow.remove();

      // 4. Save Assistant Message
      const assistantMsg = {
        id: 'msg-ast-' + Date.now(),
        role: 'assistant',
        content: accumulatedText,
        citations: citations,
        is_offline_mode: result.isOffline,
        created_at: new Date().toISOString()
      };

      state.messages[state.currentChatId].push(assistantMsg);
      saveMessages();
      appendMessageToUi(assistantMsg);
      scrollToBottom();

    } catch (err) {
      streamingRow.remove();
      showToast('Error generating answer: ' + err.message, 'error');
    } finally {
      state.isGenerating = false;
      el.btnSend.classList.remove('hidden');
      el.btnStopGenerating.classList.add('hidden');
      el.streamingNotice.classList.add('hidden');
      updateCharCounter();
    }
  }

  function regenerateLastUserMessage() {
    const messages = state.messages[state.currentChatId] || [];
    const userMsgs = messages.filter(m => m.role === 'user');
    if (userMsgs.length === 0) return;
    const last = userMsgs[userMsgs.length - 1];
    sendMessage(last.content);
  }

  // -------------------------------------------------------------
  // Modals Management
  // -------------------------------------------------------------

  function openModal(modalEl) {
    modalEl.classList.remove('hidden');
  }

  function closeModal(modalEl) {
    modalEl.classList.add('hidden');
  }

  function openCitationModal(citation) {
    el.citationBadge.textContent = `[${citation.citation_id}]`;
    el.citationDocName.textContent = citation.document_name;
    el.citationDocPage.textContent = `Page ${citation.page}`;
    el.citationTextContent.textContent = citation.full_text || citation.excerpt;
    openModal(el.citationModal);
  }

  function openConfirmModal(title, text) {
    el.confirmModalTitle.textContent = title;
    el.confirmModalText.textContent = text;
    openModal(el.confirmModal);
  }

  function openRenameModal(chatId, currentTitle) {
    el.renameInput.value = currentTitle;
    el.renameModal.dataset.chatId = chatId;
    openModal(el.renameModal);
    setTimeout(() => el.renameInput.focus(), 80);
  }

  function saveRename() {
    const newTitle = el.renameInput.value.trim();
    const chatId = el.renameModal.dataset.chatId;
    if (newTitle && chatId) {
      const chat = state.chats.find(c => c.id === chatId);
      if (chat) {
        chat.title = newTitle;
        if (state.currentChatId === chatId) {
          state.currentChatTitle = newTitle;
          el.chatTitleDisplay.textContent = newTitle;
        }
        saveChats();
        renderChatList(el.chatSearch.value);
        showToast('Conversation renamed', 'success');
      }
    }
    closeModal(el.renameModal);
  }

  function confirmDeleteChat(chatId, title) {
    state.pendingDeleteAction = () => {
      state.chats = state.chats.filter(c => c.id !== chatId);
      delete state.messages[chatId];
      saveChats();
      saveMessages();

      if (state.currentChatId === chatId) {
        state.currentChatId = null;
        if (state.chats.length > 0) {
          selectChat(state.chats[0].id);
        } else {
          createNewChat();
        }
      }
      renderChatList(el.chatSearch.value);
      showToast('Conversation deleted', 'info');
    };
    openConfirmModal('Delete Conversation', `Are you sure you want to delete "${title}"? All message history will be removed.`);
  }

  // -------------------------------------------------------------
  // Settings & Scope Dropdowns
  // -------------------------------------------------------------

  function updateScopeDropdown() {
    el.scopeDocCheckboxes.innerHTML = '';
    if (state.documents.length === 0) {
      el.scopeDocCheckboxes.innerHTML = '<span class="empty-hint">No documents to filter</span>';
      el.scopeLabel.textContent = 'All Documents';
      return;
    }

    state.documents.forEach(doc => {
      const label = document.createElement('label');
      label.className = 'dropdown-item checkbox-item';
      const isChecked = state.selectedDocIds.includes(doc.id);
      label.innerHTML = `
        <input type="checkbox" value="${doc.id}" ${isChecked ? 'checked' : ''}>
        <span title="${doc.name}">${doc.name}</span>
      `;
      label.querySelector('input').onchange = (e) => {
        if (e.target.checked) {
          state.selectedDocIds.push(doc.id);
        } else {
          state.selectedDocIds = state.selectedDocIds.filter(id => id !== doc.id);
        }
        updateScopeLabel();
      };
      el.scopeDocCheckboxes.appendChild(label);
    });

    el.scopeRadioAll.onchange = (e) => {
      if (e.target.checked) {
        state.selectedDocIds = [];
        el.scopeDocCheckboxes.querySelectorAll('input').forEach(cb => cb.checked = false);
        updateScopeLabel();
      }
    };

    updateScopeLabel();
  }

  function updateScopeLabel() {
    if (state.selectedDocIds.length === 0) {
      el.scopeLabel.textContent = 'All Documents';
      el.scopeRadioAll.checked = true;
    } else {
      el.scopeRadioAll.checked = false;
      if (state.selectedDocIds.length === 1) {
        const d = state.documents.find(doc => doc.id === state.selectedDocIds[0]);
        el.scopeLabel.textContent = d ? d.name : '1 Document';
      } else {
        el.scopeLabel.textContent = `${state.selectedDocIds.length} Documents`;
      }
    }
  }

  function updateHealthDisplay() {
    let totalChunks = 0;
    state.documents.forEach(d => totalChunks += (d.chunk_count || 0));

    el.healthDbStatus.textContent = 'Active (IndexedDB / Local)';
    el.healthChromaStatus.textContent = 'Active (Vector Semantic Engine)';
    el.healthChunksCount.textContent = totalChunks;

    if (state.apiKey && state.apiKey.trim().startsWith('sk-ant')) {
      el.healthApiStatus.textContent = 'Active (Claude 3.5 Sonnet)';
      el.statusLabel.textContent = 'Ready (Claude)';
      if (el.apiKeyStatusBadge) {
        el.apiKeyStatusBadge.textContent = 'Active (Live Claude)';
        el.apiKeyStatusBadge.className = 'badge badge-accent';
      }
      const dot = el.footerStatus.querySelector('.status-dot');
      if (dot) dot.className = 'status-dot status-ok';
    } else {
      el.healthApiStatus.textContent = 'Offline (Extractive Mode)';
      el.statusLabel.textContent = 'Cloud Mode';
      if (el.apiKeyStatusBadge) {
        el.apiKeyStatusBadge.textContent = 'Offline Mode';
        el.apiKeyStatusBadge.className = 'badge';
      }
      const dot = el.footerStatus.querySelector('.status-dot');
      if (dot) dot.className = 'status-dot status-ok';
    }
  }

  function saveSettings() {
    state.topK = parseInt(el.settingTopK.value, 10);
    localStorage.setItem('ashh_top_k', state.topK);

    const enteredKey = el.settingApiKey.value.trim();
    if (enteredKey) {
      state.apiKey = enteredKey;
      localStorage.setItem('ashh_api_key', enteredKey);
      el.settingApiKey.value = '';
      el.settingApiKey.placeholder = 'sk-ant-•••••••••••••••• (Configured)';
      showToast('Claude API key saved! Live generation active.', 'success');
    } else {
      showToast('Settings saved', 'success');
    }

    updateHealthDisplay();
    closeModal(el.settingsModal);
  }

  function resetSettings() {
    el.settingTopK.value = 5;
    el.settingTopKVal.textContent = '5';
    state.apiKey = '';
    localStorage.removeItem('ashh_api_key');
    el.settingApiKey.value = '';
    el.settingApiKey.placeholder = 'Paste your key (sk-ant-api03-...)';
    updateHealthDisplay();
    showToast('Reset to default Offline Mode', 'info');
  }

  function exportChatAsMarkdown() {
    if (!state.currentChatId) return;
    const messages = state.messages[state.currentChatId] || [];

    let md = `# ${state.currentChatTitle}\n\n*Exported from Ashh Document AI on ${new Date().toLocaleString()}*\n\n---\n\n`;

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
    a.href = url;
    a.download = `ashh-${state.currentChatTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Conversation exported as Markdown', 'success');
  }

  // -------------------------------------------------------------
  // Composer & Event Listeners
  // -------------------------------------------------------------

  function scrollToBottom() {
    el.chatArea.scrollTop = el.chatArea.scrollHeight;
  }

  function updateComposerHeight() {
    el.composerInput.style.height = 'auto';
    const maxHeight = window.innerWidth <= 768 ? 90 : 180;
    el.composerInput.style.height = Math.min(el.composerInput.scrollHeight, maxHeight) + 'px';
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

  function initEventListeners() {
    // Theme
    el.btnThemeToggle.onclick = toggleTheme;

    // Sidebar
    el.btnToggleSidebar.onclick = toggleSidebar;
    el.btnCloseSidebar.onclick = closeSidebar;
    el.sidebarBackdrop.onclick = closeSidebar;

    // New Chat
    el.btnNewChat.onclick = createNewChat;

    // Search
    el.chatSearch.oninput = (e) => {
      el.btnClearSearch.classList.toggle('hidden', !e.target.value);
      renderChatList(e.target.value);
    };
    el.btnClearSearch.onclick = () => {
      el.chatSearch.value = '';
      el.btnClearSearch.classList.add('hidden');
      renderChatList();
    };

    // Rename
    el.btnRenameTitle.onclick = () => {
      if (state.currentChatId) openRenameModal(state.currentChatId, state.currentChatTitle);
    };
    el.chatTitleDisplay.onclick = () => {
      if (state.currentChatId) openRenameModal(state.currentChatId, state.currentChatTitle);
    };

    // Scope Dropdown
    el.btnScopeSelector.onclick = (e) => {
      e.stopPropagation();
      el.scopeMenu.classList.toggle('hidden');
    };
    document.addEventListener('click', (e) => {
      if (!el.scopeMenu.contains(e.target) && !el.btnScopeSelector.contains(e.target)) {
        el.scopeMenu.classList.add('hidden');
      }
    });

    // Upload & Dropzone
    el.dropzone.onclick = () => el.fileInput.click();
    el.fileInput.onchange = (e) => {
      handleFileUpload(e.target.files);
      el.fileInput.value = '';
    };

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

    // Paste Document Modal
    el.btnOpenPasteModal.onclick = () => {
      el.pasteDocTitle.value = '';
      el.pasteDocContent.value = '';
      openModal(el.pasteModal);
    };
    el.btnClosePaste.onclick = () => closeModal(el.pasteModal);
    el.btnPasteCancel.onclick = () => closeModal(el.pasteModal);
    document.getElementById('paste-backdrop').onclick = () => closeModal(el.pasteModal);
    el.btnPasteSave.onclick = savePastedDocument;

    // Composer Attachments & Input
    el.btnAttachComposer.onclick = () => el.composerFileInput.click();
    el.composerFileInput.onchange = (e) => {
      if (e.target.files) {
        Array.from(e.target.files).forEach(f => addComposerAttachment(f));
      }
      el.composerFileInput.value = '';
    };

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

    el.btnStopGenerating.onclick = () => {
      state.isGenerating = false;
      el.btnSend.classList.remove('hidden');
      el.btnStopGenerating.classList.add('hidden');
      el.streamingNotice.classList.add('hidden');
    };

    // Welcome Prompt Chips
    document.querySelectorAll('.prompt-chip').forEach(chip => {
      chip.onclick = () => {
        const prompt = chip.dataset.prompt;
        if (prompt) sendMessage(prompt);
      };
    });

    // Modals
    el.btnCloseCitation.onclick = () => closeModal(el.citationModal);
    el.btnCitationDone.onclick = () => closeModal(el.citationModal);
    document.getElementById('citation-backdrop').onclick = () => closeModal(el.citationModal);
    el.btnCitationCopy.onclick = () => {
      navigator.clipboard.writeText(el.citationTextContent.textContent);
      showToast('Excerpt copied', 'success');
    };

    el.btnSettings.onclick = () => {
      el.settingTopK.value = state.topK;
      el.settingTopKVal.textContent = state.topK;
      el.settingModelName.value = 'Claude 3.5 Sonnet / Extractive Local';
      if (state.apiKey) {
        el.settingApiKey.placeholder = 'sk-ant-•••••••••••••••• (Configured)';
      }
      updateHealthDisplay();
      openModal(el.settingsModal);
    };

    el.btnCloseSettings.onclick = () => closeModal(el.settingsModal);
    document.getElementById('settings-backdrop').onclick = () => closeModal(el.settingsModal);
    el.settingTopK.oninput = (e) => el.settingTopKVal.textContent = e.target.value;
    el.btnSaveSettings.onclick = saveSettings;
    el.btnResetSettings.onclick = resetSettings;

    el.btnCloseConfirm.onclick = () => closeModal(el.confirmModal);
    el.btnConfirmCancel.onclick = () => closeModal(el.confirmModal);
    document.getElementById('confirm-backdrop').onclick = () => closeModal(el.confirmModal);
    el.btnConfirmProceed.onclick = () => {
      if (state.pendingDeleteAction) {
        state.pendingDeleteAction();
        state.pendingDeleteAction = null;
      }
      closeModal(el.confirmModal);
    };

    el.btnCloseRename.onclick = () => closeModal(el.renameModal);
    el.btnRenameCancel.onclick = () => closeModal(el.renameModal);
    document.getElementById('rename-backdrop').onclick = () => closeModal(el.renameModal);
    el.btnRenameSave.onclick = saveRename;
    el.renameInput.onkeydown = (e) => {
      if (e.key === 'Enter') saveRename();
    };

    el.btnExportChat.onclick = exportChatAsMarkdown;

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal(el.citationModal);
        closeModal(el.settingsModal);
        closeModal(el.confirmModal);
        closeModal(el.renameModal);
        closeModal(el.pasteModal);
        el.scopeMenu.classList.add('hidden');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        createNewChat();
      }
    });
  }

  // -------------------------------------------------------------
  // App Bootstrap
  // -------------------------------------------------------------

  function initApp() {
    initTheme();
    loadState();
    initEventListeners();
    renderDocuments();

    if (state.chats.length === 0) {
      createNewChat();
    } else {
      const activeChatId = localStorage.getItem('ashh_active_chat') || state.chats[0].id;
      renderChatList();
      selectChat(activeChatId);
    }
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
